/**
 * Full cockpit preparation by key presses only (FCOM PRO-NOR-SOP-01 "FMGS PREPARATION"):
 * INIT A -> F-PLN (departure, airway, arrival, discontinuity) -> RAD NAV -> INIT B -> PERF TAKE OFF.
 */
import { describe, expect, it } from 'vitest';
import { headlessApp } from '../../src/core/headless';
import { installMcduLogic } from '../../src/avionics/mcdu/index';
import { enter, irsAligning, lines, powerUp, press } from '../../src/avionics/mcdu/testing';
import { isLeg } from '../../src/core/fmgs-api';

function setup() {
  const app = headlessApp();
  const mod = installMcduLogic(app);
  app.sim.start();
  powerUp(app.sim);
  irsAligning(app.sim);
  return { sim: app.sim, mod, m: mod.units[0] };
}

const idents = (items: ReturnType<ReturnType<typeof setup>['mod']['fmgs']['activePlan']>) =>
  items.map((i) => (isLeg(i) ? i.point.ident : 'DISCO'));

describe('FMGS preparation by key presses', () => {
  it('builds LFBD 23 CNA6P CNA B19 AMB AMB9W ODILO ILS25 LFPO', () => {
    const { sim, mod, m } = setup();
    const f = mod.fmgs;
    const scratch = () => lines(m)[13].trim();

    // ---- INIT A
    press(sim, 1, 'INIT');
    enter(sim, 1, 'LFBD/LFPO', 'R1');
    press(sim, 1, 'L6'); // ROUTE SELECTION: RETURN (no company route)
    enter(sim, 1, 'LFPG', 'L2');
    enter(sim, 1, 'SIM6205', 'L3');
    enter(sim, 1, '25', 'L5');
    enter(sim, 1, 'FL350', 'L6');
    press(sim, 1, 'R3'); // ALIGN IRS
    expect(f.irsAlignSent).toBe(true);
    expect(idents(f.activePlan())).toEqual(['LFBD', 'DISCO', 'LFPO']);

    // ---- F-PLN: DEPARTURE (LAT REV at origin)
    press(sim, 1, 'FPLN');
    expect(lines(m)[2]).toMatch(/^LFBD /);
    press(sim, 1, 'L1');
    expect(m.page.id).toBe('LAT_REV');
    expect(lines(m)[0]).toContain('LAT REV FROM LFBD');
    press(sim, 1, 'L1');
    expect(m.page.id).toBe('DEPARTURE');
    expect(lines(m)[3]).toContain('AVAILABLE RUNWAYS');
    // runways 05, 11, 23, 29 -> 23 is the third line (L4)
    expect(lines(m)[8]).toContain('<23');
    press(sim, 1, 'L4');
    expect(f.tmpy).toBeTruthy();
    expect(lines(m)[2]).toMatch(/^23/);
    expect(m.render().colorOf(2, '23')).toBe('y'); // temporary
    expect(lines(m)[3]).toContain('SIDS');
    expect(lines(m)[4]).toContain('<CNA6P');
    press(sim, 1, 'L2');
    expect(lines(m)[2]).toContain('CNA6P');
    expect(lines(m)[12]).toContain('<ERASE');
    expect(lines(m)[12]).toContain('INSERT*');
    press(sim, 1, 'R6'); // INSERT
    expect(f.tmpy).toBeUndefined();
    expect(m.page.id).toBe('FPLN_A');
    expect(idents(f.activePlan())).toEqual(['LFBD23', 'BD230', 'BD923', 'ROVFU', 'CNA', 'DISCO', 'LFPO']);
    expect(sim.get('S:FMGS_FPLN_DONE')).toBe(0);

    // ---- AIRWAYS from CNA: B19 to AMB
    const cnaRow = lines(m).findIndex((l) => l.startsWith('CNA '));
    expect(cnaRow).toBeGreaterThan(0);
    press(sim, 1, `L${cnaRow / 2}`);
    expect(lines(m)[0]).toContain('LAT REV FROM CNA');
    press(sim, 1, 'R5');
    expect(m.page.id).toBe('AIRWAYS');
    enter(sim, 1, 'UT158', 'L1');
    expect(scratch()).toBe('AWY/WPT MISMATCH');
    press(sim, 1, 'CLR', 'CLR', 'CLR', 'CLR', 'CLR', 'CLR');
    enter(sim, 1, 'B19', 'L1');
    enter(sim, 1, 'AMB', 'R1');
    expect(lines(m)[2]).toContain('B19');
    expect(lines(m)[2]).toContain('AMB');
    press(sim, 1, 'R6');
    const afterAwy = idents(f.activePlan());
    expect(afterAwy.slice(4, afterAwy.indexOf('AMB') + 1)).toEqual(['CNA', 'VERAC', 'POI', 'OMARI', 'AMB']);
    expect(f.activePlan().find((i) => isLeg(i) && i.point.ident === 'POI')!).toMatchObject({ via: 'B19' });

    // ---- ARRIVAL (LAT REV at destination: L6 on F-PLN)
    press(sim, 1, 'FPLN', 'L6');
    expect(lines(m)[0]).toContain('LAT REV FROM LFPO');
    press(sim, 1, 'R1');
    expect(m.page.id).toBe('ARRIVAL');
    expect(lines(m)[5]).toContain('APPR');
    press(sim, 1, 'UP'); // ILS06, ILS07, ILS24 -> ILS07, ILS24, ILS25
    expect(lines(m)[10]).toContain('<ILS25');
    press(sim, 1, 'L5');
    expect(lines(m)[2]).toMatch(/^ILS25/);
    // VIAS
    press(sim, 1, 'L2');
    expect(lines(m)[3]).toContain('APPR VIAS');
    const viaRow = lines(m).findIndex((l) => l.startsWith('<ODILO'));
    press(sim, 1, `L${viaRow / 2}`);
    expect(lines(m)[2]).toContain('ODILO');
    // STARS (list filtered for RWY 25)
    expect(lines(m)[5]).toContain('STARS');
    expect(lines(m)[6]).toContain('<AMB9W');
    press(sim, 1, 'L3');
    expect(lines(m)[2]).toContain('AMB9W');
    press(sim, 1, 'R6');
    const full = idents(f.activePlan());
    expect(full).not.toContain('DISCO');
    const amb = full.indexOf('AMB');
    expect(full.slice(amb, amb + 5)).toEqual(['AMB', 'DIBES', 'CAD', 'SOTIP', 'ODILO']);
    expect(full).toContain('FPO25');
    expect(full[full.indexOf('LFPO25') + 1]).toBe('(700)'); // missed approach
    sim.run(0.1);
    expect(sim.get('S:FMGS_FPLN_DONE')).toBe(1);
    expect(f.arrivalRunway()?.ident).toBe('RW25');
    expect(sim.get('S:FMGS_DEST_ELEV')).toBe(288);

    // F-PLN shows the constraints (magenta) of the STAR
    press(sim, 1, 'FPLN', 'AIRPORT');
    expect(lines(m).join('\n')).toContain('LFPO25');

    // ---- RAD NAV (autotuned)
    sim.run(0.5);
    press(sim, 1, 'RADNAV');
    expect(lines(m)[2]).toMatch(/^BMC\/113\.75/);
    expect(sim.get('S:NAV_VOR1_FREQ')).toBeCloseTo(113.75);
    expect(sim.get('S:NAV_ILS_FREQ')).toBeGreaterThan(108);
    expect(sim.get('S:NAV_ILS_CRS')).toBe(225);

    // ---- INIT B
    press(sim, 1, 'INIT', 'NEXT');
    expect(m.page.id).toBe('INIT_B');
    expect(lines(m)[2]).toContain('□□□.□/□□.□');
    enter(sim, 1, '57.6/27.4', 'R1');
    expect(lines(m)[6]).toContain('PLANNING');
    press(sim, 1, 'R3'); // FUEL PLANNING
    sim.run(4);
    const block = f.block!;
    expect(block).toBeGreaterThan(4500);
    expect(block).toBeLessThan(7500);
    enter(sim, 1, '6.2', 'R2');
    sim.run(0.5);
    const lb = lines(m);
    expect(lb[4]).toMatch(/^2\.\d\/00[45]\d/); // TRIP/TIME
    expect(lb[8]).toContain('63.6/'); // TOW
    expect(sim.get('S:FMGS_ZFW')).toBe(57600);
    expect(sim.get('S:FMGS_ZFWCG')).toBeCloseTo(27.4);
    expect(sim.get('S:FMGS_BLOCK')).toBe(6200);
    expect(sim.get('S:FMGS_TOW')).toBe(63600);
    expect(sim.get('S:FMGS_INIT_B_DONE')).toBe(1);

    // ---- PERF TAKE OFF
    press(sim, 1, 'PERF');
    expect(m.page.id).toBe('PERF_TO');
    let lp = lines(m);
    expect(lp[2]).toMatch(/^□□□/);
    expect(lp[2]).toMatch(/23$/);
    expect(lp[2]).toMatch(/F=1\d\d/);
    expect(lp[8]).toMatch(/^5000/); // TRANS ALT
    expect(lp[10]).toMatch(/^1660\/1660/); // THR RED/ACC (RWY 23 elevation 151 ft + 1500)
    enter(sim, 1, '142', 'L1');
    enter(sim, 1, '144', 'L2');
    enter(sim, 1, '148', 'L3');
    enter(sim, 1, '1/UP1.0', 'R3');
    enter(sim, 1, '58', 'R4');
    sim.run(0.1);
    lp = lines(m);
    expect(lp[6]).toMatch(/1\/UP1\.0$/);
    expect(lp[8]).toMatch(/58°$/);
    expect(sim.get('S:FMGS_V1')).toBe(142);
    expect(sim.get('S:FMGS_VR')).toBe(144);
    expect(sim.get('S:FMGS_V2')).toBe(148);
    expect(sim.get('S:FMGS_FLEX')).toBe(58);
    expect(sim.get('S:FMGS_TO_CONF')).toBe(1);
    expect(sim.get('S:FMGS_THS_FOR')).toBe(1);
    expect(sim.get('S:FMGS_THR_RED')).toBe(1660);
    expect(sim.get('S:FMGS_PERF_TO_DONE')).toBe(1);
    expect(sim.get('S:FMGS_TRANS_ALT')).toBe(5000);

    // predictions available in the F-PLN
    press(sim, 1, 'FPLN');
    const lf = lines(m);
    expect(lf[12]).toMatch(/^LFPO25\s+00[45]\d/);
    expect(f.activePlan().some((i) => isLeg(i) && i.predAlt !== undefined)).toBe(true);
    expect(f.pseudoWaypoints().map((p) => p.ident)).toContain('(T/C)');
    expect(f.pseudoWaypoints().map((p) => p.ident)).toContain('(T/D)');
  });

  it('V1/VR/V2 DISAGREE and CHECK TAKE OFF DATA after a runway change', () => {
    const { sim, mod, m } = setup();
    const f = mod.fmgs;
    press(sim, 1, 'INIT');
    enter(sim, 1, 'LFBDLFPO1', 'L1');
    press(sim, 1, 'PERF');
    enter(sim, 1, '150', 'L1');
    enter(sim, 1, '144', 'L2');
    expect(lines(m)[13]).toContain('V1/VR/V2 DISAGREE');
    expect(m.render().colorOf(13, 'V1/VR')).toBe('a');
    press(sim, 1, 'CLR');
    enter(sim, 1, '142', 'L1');
    enter(sim, 1, '148', 'L3');
    sim.run(0.1);
    expect(sim.get('S:FMGS_V1')).toBe(142);
    // new runway 05 via DEPARTURE
    press(sim, 1, 'FPLN', 'L1', 'L1', 'NEXT');
    expect(lines(m)[3]).toContain('AVAILABLE RUNWAYS');
    press(sim, 1, 'L2'); // RWY 05
    press(sim, 1, 'L2'); // CNA6Q
    press(sim, 1, 'R6'); // INSERT
    expect(f.active!.depRwy!.ident).toBe('05');
    expect(f.v1).toBeUndefined();
    sim.run(0.1);
    expect(sim.get('S:FMGS_V1')).toBe(0);
    press(sim, 1, 'PERF');
    expect(lines(m)[13]).toBe('CHECK TAKE OFF DATA     ');
    expect(m.render().colorOf(13, 'CHECK')).toBe('a');
    expect(lines(m)[2]).toMatch(/05$/);
    enter(sim, 1, '140', 'L1');
    expect(f.messages.find((x) => x.text === 'CHECK TAKE OFF DATA')).toBeUndefined();
  });

  it('F-PLN revisions: delete a waypoint (TMPY), DIR TO, manual radio tuning', () => {
    const { sim, mod, m } = setup();
    const f = mod.fmgs;
    press(sim, 1, 'INIT');
    enter(sim, 1, 'LFBDLFPO1', 'L1');
    press(sim, 1, 'FPLN');
    // clear BD923 (third line) -> temporary F-PLN in yellow
    press(sim, 1, 'CLR', 'L3');
    expect(f.tmpy).toBeTruthy();
    expect(lines(m)[0]).toContain('TMPY');
    expect(m.render().colorOf(0, 'TMPY')).toBe('y');
    expect(lines(m)[12]).toContain('<ERASE');
    press(sim, 1, 'L6'); // ERASE
    expect(f.tmpy).toBeUndefined();
    expect(idents(f.activePlan())).toContain('BD923');
    // insertion of an unknown waypoint
    enter(sim, 1, 'XXXXX', 'L3');
    expect(lines(m)[13]).toContain('NOT IN DATA BASE');
    press(sim, 1, 'CLR', 'CLR', 'CLR', 'CLR', 'CLR', 'CLR', 'CLR');
    // DIR TO CNA
    press(sim, 1, 'DIR');
    enter(sim, 1, 'CNA', 'L1');
    expect(lines(m)[2]).toMatch(/^CNA/);
    press(sim, 1, 'R6');
    const ids = idents(f.activePlan());
    expect(ids[1]).toBe('T-P');
    expect(ids[2]).toBe('CNA');
    // RAD NAV manual tuning, CLR back to autotune
    press(sim, 1, 'RADNAV');
    enter(sim, 1, 'CNA', 'L1');
    sim.run(0.1);
    expect(sim.get('S:NAV_VOR1_FREQ')).toBeCloseTo(114.65);
    expect(sim.get('S:NAV_VOR1_AUTO')).toBe(0);
    expect(m.render().smallAt(2, 0)).toBe(false);
    enter(sim, 1, '225', 'L2');
    sim.run(0.1);
    expect(sim.get('S:NAV_VOR1_CRS')).toBe(225);
    enter(sim, 1, '110.2', 'L3');
    expect(lines(m)[13]).toContain('ENTRY OUT OF RANGE');
    press(sim, 1, 'CLR', 'CLR', 'CLR', 'CLR', 'CLR', 'CLR');
    press(sim, 1, 'CLR', 'L1');
    sim.run(0.1);
    expect(sim.get('S:NAV_VOR1_FREQ')).toBeCloseTo(113.75);
    expect(sim.get('S:NAV_VOR1_AUTO')).toBe(1);
    expect(m.render().smallAt(2, 0)).toBe(true);
  });

  it('INIT B format errors and range checks', () => {
    const { sim, m } = setup();
    press(sim, 1, 'INIT');
    enter(sim, 1, 'LFBDLFPO1', 'L1');
    press(sim, 1, 'NEXT');
    enter(sim, 1, '5A.6', 'R1');
    expect(lines(m)[13].trim()).toBe('FORMAT ERROR');
    press(sim, 1, 'CLR');
    press(sim, 1, 'CLR', 'CLR', 'CLR', 'CLR');
    enter(sim, 1, '/55.0', 'R1');
    expect(lines(m)[13].trim()).toBe('ENTRY OUT OF RANGE');
    press(sim, 1, 'CLR');
    press(sim, 1, 'CLR', 'CLR', 'CLR', 'CLR', 'CLR');
    enter(sim, 1, '25.0', 'R2');
    expect(lines(m)[13].trim()).toBe('ENTRY OUT OF RANGE');
  });
});
