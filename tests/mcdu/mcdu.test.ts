import { beforeEach, describe, expect, it } from 'vitest';
import { headlessApp } from '../../src/core/headless';
import install, { installMcduLogic, type McduModule } from '../../src/avionics/mcdu/index';
import { FMGC_INIT_S } from '../../src/avionics/mcdu/fmgs/fmgs';
import { enter, irsAligning, lines, powerUp, press, type } from '../../src/avionics/mcdu/testing';
import type { Sim } from '../../src/core/sim';

let sim: Sim;
let mod: McduModule;
const m1 = () => mod.units[0];
const scratch = () => lines(m1())[13].trimEnd();

function setup() {
  const app = headlessApp();
  mod = installMcduLogic(app);
  sim = app.sim;
  sim.start();
}

describe('installation', () => {
  it('installs through the module entry point in a headless app and registers the FMGS service', async () => {
    const app = headlessApp();
    await install(app as any);
    expect(app.sim.services.fmgs).toBeTruthy();
    expect(typeof app.sim.services.fmgs.activePlan).toBe('function');
    app.sim.run(1);
    expect(app.sim.get('S:FMGS_POWERED')).toBe(0);
  });
});

describe('power-up', () => {
  beforeEach(setup);

  it('stays dark without AC power', () => {
    sim.run(5);
    expect(m1().powered).toBe(false);
    expect(lines(m1()).join('').trim()).toBe('');
  });

  it('shows the MCDU MENU while the FMGC initialises, then the A/C STATUS page', () => {
    sim.set('S:ELEC_AC_ESS_BUS', 1);
    sim.set('S:ELEC_AC_ESS_SHED', 1);
    sim.set('S:ELEC_AC2_BUS', 1);
    sim.run(1);
    expect(lines(m1()).join('').trim()).toBe(''); // self test
    sim.run(3);
    expect(lines(m1())[0]).toContain('MCDU MENU');
    expect(sim.get('S:FMGS_POWERED')).toBe(0);
    // function keys inactive while the FMGC is not available
    press(sim, 1, 'INIT');
    expect(m1().page.id).toBe('MENU');
    sim.run(FMGC_INIT_S);
    expect(sim.get('S:FMGS_POWERED')).toBe(1);
    expect(lines(m1())[0]).toContain('A320-200');
    expect(lines(m1())[2]).toContain('CFM56-5B4/P');
    expect(m1().render().colorOf(2, 'CFM56')).toBe('g');
  });

  it('MCDU2 is powered by AC BUS 2 only', () => {
    sim.set('S:ELEC_AC_ESS_BUS', 1);
    sim.set('S:ELEC_AC_ESS_SHED', 1);
    sim.set('S:ELEC_AC2_BUS', 0);
    sim.set('S:ELEC_AC_POWERED', 1);
    sim.run(5);
    expect(sim.get('S:MCDU1_POWERED')).toBe(1);
    expect(sim.get('S:MCDU2_POWERED')).toBe(0);
  });

  it('BRT / DIM keys change the display brightness', () => {
    powerUp(sim);
    const b = m1().brightness;
    press(sim, 1, 'DIM', 'DIM');
    expect(m1().brightness).toBeCloseTo(b - 0.2);
    press(sim, 1, 'BRT');
    expect(m1().brightness).toBeCloseTo(b - 0.1);
  });
});

describe('scratchpad', () => {
  beforeEach(() => { setup(); powerUp(sim); press(sim, 1, 'INIT'); });

  it('types, deletes with CLR and writes CLR when empty', () => {
    type(sim, 1, 'ABC');
    expect(scratch()).toBe('ABC');
    press(sim, 1, 'CLR');
    expect(scratch()).toBe('AB');
    press(sim, 1, 'CLR', 'CLR', 'CLR');
    expect(scratch()).toBe('CLR');
    press(sim, 1, 'CLR');
    expect(scratch()).toBe('');
  });

  it('limits the entry to 22 characters', () => {
    type(sim, 1, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(m1().scratch.length).toBe(22);
  });

  it('+/- toggles the sign, OVFY writes the overfly symbol', () => {
    press(sim, 1, 'PLUSMINUS');
    expect(scratch()).toBe('-');
    press(sim, 1, 'PLUSMINUS');
    expect(scratch()).toBe('+');
    press(sim, 1, 'CLR', 'OVFY');
    expect(scratch()).toBe('Δ');
  });

  it('FORMAT ERROR keeps the entry, which comes back after CLR', () => {
    enter(sim, 1, 'LFBD-LFPO', 'R1');
    expect(scratch()).toBe('FORMAT ERROR');
    expect(m1().render().colorOf(13, 'FORMAT')).toBe('w');
    press(sim, 1, 'CLR');
    expect(scratch()).toBe('LFBD-LFPO');
  });

  it('NOT IN DATA BASE for unknown airports', () => {
    enter(sim, 1, 'LFBD/LFXX', 'R1');
    expect(scratch()).toBe('NOT IN DATA BASE');
  });

  it('NOT ALLOWED on a field that is not modifiable', () => {
    enter(sim, 1, '25', 'L5'); // COST INDEX before FROM/TO
    expect(scratch()).toBe('NOT ALLOWED');
  });

  it('ENTRY OUT OF RANGE', () => {
    enter(sim, 1, 'LFBD/LFPO', 'R1');
    press(sim, 1, 'L6'); // ROUTE SELECTION -> RETURN
    enter(sim, 1, '450', 'L6');
    expect(scratch()).toBe('ENTRY OUT OF RANGE');
  });

  it('shows the MCDU MENU with SELECT DESIRED SYSTEM', () => {
    press(sim, 1, 'MENU');
    expect(lines(m1())[0]).toContain('MCDU MENU');
    expect(scratch()).toBe('SELECT DESIRED SYSTEM');
    press(sim, 1, 'L1');
    expect(m1().page.fmgc).not.toBe(false);
  });

  it('each MCDU has its own scratchpad and page', () => {
    type(sim, 1, 'ABC');
    press(sim, 2, 'FPLN');
    expect(mod.units[1].scratch).toBe('');
    expect(mod.units[1].page.id).toBe('FPLN_A');
    expect(m1().page.id).toBe('INIT_A');
  });
});

describe('INIT A', () => {
  beforeEach(() => { setup(); powerUp(sim); irsAligning(sim); press(sim, 1, 'INIT'); });

  it('shows amber boxes for mandatory data', () => {
    const l = lines(m1());
    expect(l[0]).toContain('INIT');
    expect(l[2]).toContain('□□□□□□□□□□');
    expect(l[2]).toContain('□□□□/□□□□');
    expect(m1().render().colorOf(2, '□')).toBe('a');
    expect(l[6]).toContain('□□□□□□□□');
  });

  it('FROM/TO opens ROUTE SELECTION, then CI / CRZ FL / FLT NBR entries', () => {
    enter(sim, 1, 'LFBD/LFPO', 'R1');
    expect(m1().page.id).toBe('ROUTE_SELECTION');
    expect(lines(m1()).join('\n')).toContain('LFBDLFPO1');
    press(sim, 1, 'L6');
    expect(m1().page.id).toBe('INIT_A');
    let l = lines(m1());
    expect(l[2]).toContain('LFBD/LFPO');
    expect(l[10]).toContain('□□□');
    expect(l[12]).toContain('□□□□□/---°');
    expect(l[8]).toMatch(/4449\.\dN.*000\d\d\.\dW/);
    enter(sim, 1, '25', 'L5');
    enter(sim, 1, '350', 'L6');
    enter(sim, 1, 'SIM6205', 'L3');
    sim.run(0.1);
    l = lines(m1());
    expect(l[10]).toContain('25');
    expect(l[12]).toContain('FL350/-54°');
    expect(l[6]).toContain('SIM6205');
    expect(sim.get('S:FMGS_CRZ_FL')).toBe(350);
    expect(sim.get('S:FMGS_CI')).toBe(25);
    expect(sim.get('S:FMGS_INIT_A_DONE')).toBe(1);
  });

  it('ALIGN IRS sends the position to the ADIRS and disappears', () => {
    const got: any[] = [];
    sim.on('adirs:position', (p) => got.push(p));
    enter(sim, 1, 'LFBDLFPO1', 'L1');
    expect(lines(m1())[6]).toContain('ALIGN IRS→');
    expect(m1().render().colorOf(6, 'ALIGN')).toBe('a');
    press(sim, 1, 'R3');
    expect(got).toHaveLength(1);
    expect(got[0].lat).toBeCloseTo(44.8286, 3);
    expect(got[0].lon).toBeCloseTo(-0.7153, 3);
    expect(lines(m1())[6]).not.toContain('ALIGN IRS');
  });

  it('CO RTE fills the whole INIT A and the flight plan', () => {
    enter(sim, 1, 'LFBDLFPO1', 'L1');
    const l = lines(m1());
    expect(l[2]).toContain('LFBDLFPO1');
    expect(l[2]).toContain('LFBD/LFPO');
    expect(l[4]).toContain('LFPG');
    expect(l[10]).toMatch(/^25/);
    expect(l[12]).toContain('FL350');
    const plan = mod.fmgs.activePlan();
    const idents = plan.map((i) => ('point' in i ? i.point.ident : '----'));
    expect(idents.slice(0, 5)).toEqual(['LFBD23', 'BD230', 'BD923', 'ROVFU', 'CNA']);
    expect(idents).toContain('POI');
    expect(idents).toContain('AMB');
    expect(idents).toContain('ODILO');
    expect(idents).toContain('LFPO25');
    expect(idents).not.toContain('----'); // no discontinuity
    expect(mod.fmgs.departureRunway()?.ident).toBe('RW23');
    sim.run(0.1);
    expect(sim.get('S:FMGS_DEP_RWY_HDG')).toBe(225);
  });
});
