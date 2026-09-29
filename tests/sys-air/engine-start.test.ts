/**
 * Full automatic engine start on APU bleed (FCOM PRO-NOR-SOP "Engine start", DSC-70 auto start):
 * APU BLEED ON → ENG MODE IGN/START → MASTER 2 ON → ENG 2 stabilised → MASTER 1 ON → ENG 1 stabilised,
 * then APU BLEED OFF / MODE NORM (engine bleed takes over), thrust limits, spool-up and shutdown.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { apuBleedOn, first, master, mode, pb, record, rig, type Rig, type Sample } from './helpers';

const ENG2 = ['S:ENG2_N1', 'S:ENG2_N2', 'S:ENG2_EGT', 'S:ENG2_FF', 'S:ENG2_STATE', 'S:ENG2_START_VALVE', 'S:ENG2_IGN_A',
  'S:ENG2_IGN_B', 'S:ENG2_HP_FUEL_VALVE', 'S:PACK1_VALVE', 'S:PACK2_VALVE', 'S:BLEED_PRESS_2', 'S:BLEED_PRESS_1'];
const ENG1 = ENG2.map((v) => v.replace('ENG2', 'ENG1'));
const max = (s: Sample[], v: string) => Math.max(...s.map((x) => x[v]));

describe('automatic engine start ENG 2 then ENG 1 (APU bleed)', () => {
  let r: Rig;
  let s2: Sample[];
  let s1: Sample[];
  let before: Record<string, number>;

  beforeAll(async () => {
    r = await rig();
    apuBleedOn(r);
    before = { pack1: r.sim.get('S:PACK1_VALVE'), xbleed: r.sim.get('S:BLEED_XBLEED_VALVE'), duct: r.sim.get('S:BLEED_PRESS_1') };
    mode(r.sim, 2);
    r.sim.run(3);
    before.pack1Ign = r.sim.get('S:PACK1_VALVE');
    before.pack2Ign = r.sim.get('S:PACK2_VALVE');
    before.ductIgn = r.sim.get('S:BLEED_PRESS_2');
    master(r.sim, 2, true);
    s2 = record(r.sim, 60, ENG2, 0.1);
    master(r.sim, 1, true);
    s1 = record(r.sim, 60, ENG1, 0.1);
  });

  it('APU bleed supplies both ducts through the X BLEED (AUTO) and the packs run', () => {
    expect(before.xbleed).toBe(1);
    expect(before.pack1).toBe(1);
    expect(before.duct).toBeGreaterThan(25);
    expect(before.duct).toBeLessThan(40);
  });

  it('pack valves close when IGN/START is selected on ground (duct pressure rises for the start)', () => {
    expect(before.pack1Ign).toBe(0);
    expect(before.pack2Ign).toBe(0);
    expect(before.ductIgn).toBeGreaterThan(35);
  });

  it('ENG 2: start valve opens, ignition at ~16 % N2, fuel at ~22 % N2', () => {
    const sv = first(s2, (x) => x['S:ENG2_START_VALVE'] === 1)!;
    expect(sv.t).toBeLessThan(2);
    const ign = first(s2, (x) => x['S:ENG2_IGN_A'] === 1 || x['S:ENG2_IGN_B'] === 1)!;
    expect(ign['S:ENG2_N2']).toBeGreaterThanOrEqual(15.9);
    expect(ign['S:ENG2_N2']).toBeLessThan(17.5);
    expect(ign.t).toBeGreaterThan(5);
    expect(ign.t).toBeLessThan(12);
    // One igniter only on a normal ground start (ENG 2 starts on igniter B here, ENG 1 on A).
    expect(s2.some((x) => x['S:ENG2_IGN_A'] === 1 && x['S:ENG2_IGN_B'] === 1)).toBe(false);
    const fuel = first(s2, (x) => x['S:ENG2_HP_FUEL_VALVE'] === 1)!;
    expect(fuel['S:ENG2_N2']).toBeGreaterThanOrEqual(21.9);
    expect(fuel['S:ENG2_N2']).toBeLessThan(23.5);
    const ff = first(s2, (x) => x['S:ENG2_FF'] > 0)!;
    expect(ff.t - fuel.t).toBeLessThan(1);
    expect(ff['S:ENG2_FF']).toBeLessThan(260);
  });

  it('ENG 2: light-off within ~10 s of fuel, EGT peak 450-700 °C (limit 725)', () => {
    const fuel = first(s2, (x) => x['S:ENG2_HP_FUEL_VALVE'] === 1)!;
    const lit = first(s2, (x) => x.t > fuel.t && x['S:ENG2_EGT'] > 100)!;
    expect(lit.t - fuel.t).toBeLessThan(10);
    const egtMax = max(s2, 'S:ENG2_EGT');
    expect(egtMax).toBeGreaterThan(450);
    expect(egtMax).toBeLessThan(700);
  });

  it('ENG 2: start valve closes and ignition stops at ~50 % N2', () => {
    const open = first(s2, (x) => x['S:ENG2_START_VALVE'] === 1)!;
    const closed = first(s2, (x) => x.t > open.t && x['S:ENG2_START_VALVE'] === 0)!;
    expect(closed['S:ENG2_N2']).toBeGreaterThanOrEqual(49.5);
    expect(closed['S:ENG2_N2']).toBeLessThan(54);
    const afterClose = s2.filter((x) => x.t > closed.t + 0.5);
    expect(afterClose.every((x) => x['S:ENG2_IGN_A'] === 0 && x['S:ENG2_IGN_B'] === 0)).toBe(true);
  });

  it('ENG 2: stabilised idle ≈ N1 19-20 %, N2 ≈ 59 %, EGT ≈ 380-420 °C, FF ≈ 280-320 kg/h, 40-55 s after MASTER ON', () => {
    const run = first(s2, (x) => x['S:ENG2_STATE'] === 3)!;
    expect(run.t).toBeGreaterThan(40);
    expect(run.t).toBeLessThan(55);
    const last = s2[s2.length - 1];
    expect(last['S:ENG2_N1']).toBeGreaterThan(18.8);
    expect(last['S:ENG2_N1']).toBeLessThan(20.8);
    expect(last['S:ENG2_N2']).toBeGreaterThan(57.5);
    expect(last['S:ENG2_N2']).toBeLessThan(61);
    expect(last['S:ENG2_EGT']).toBeGreaterThan(360);
    expect(last['S:ENG2_EGT']).toBeLessThan(440);
    expect(last['S:ENG2_FF']).toBeGreaterThan(260);
    expect(last['S:ENG2_FF']).toBeLessThan(330);
    expect(r.sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(r.sim.get('S:ENG2_START_FAULT')).toBe(0);
    expect(r.sim.get('L:ENG2_FAULT')).toBe(0);
  });

  it('APU duct pressure dips when the start valve opens and recovers', () => {
    const minDuct = Math.min(...s2.filter((x) => x['S:ENG2_START_VALVE'] === 1).map((x) => x['S:BLEED_PRESS_2']));
    expect(minDuct).toBeLessThan(before.ductIgn - 4);
    expect(minDuct).toBeGreaterThan(22);
  });

  it('packs stay closed during the ENG 2 start (MODE still IGN/START, ENG 1 not started)', () => {
    expect(s2.every((x) => x['S:PACK1_VALVE'] === 0 && x['S:PACK2_VALVE'] === 0)).toBe(true);
  });

  it('ENG 1 starts the same way on the other igniter', () => {
    const run = first(s1, (x) => x['S:ENG1_STATE'] === 3)!;
    expect(run.t).toBeGreaterThan(40);
    expect(run.t).toBeLessThan(55);
    expect(s1.some((x) => x['S:ENG1_IGN_A'] === 1)).toBe(true);
    expect(s1.some((x) => x['S:ENG1_IGN_B'] === 1)).toBe(false);
    const egtMax = max(s1, 'S:ENG1_EGT');
    expect(egtMax).toBeGreaterThan(450);
    expect(egtMax).toBeLessThan(700);
    expect(r.sim.get('S:ENG1_N1')).toBeGreaterThan(18.8);
    expect(r.sim.get('S:ENG1_N1')).toBeLessThan(20.8);
  });

  it('pack valves reopen 30 s after the end of the second start', () => {
    // Record continues from the end of the ENG 1 record: packs open within 30 s of ENG 1 stabilising.
    const runT = first(s1, (x) => x['S:ENG1_STATE'] === 3)!.t;
    const svClosed = first(s1, (x) => x.t > 2 && x['S:ENG1_START_VALVE'] === 0)!.t;
    const s = record(r.sim, 40, ['S:PACK1_VALVE', 'S:PACK2_VALVE'], 0.2);
    const reopen = first(s, (x) => x['S:PACK1_VALVE'] === 1 && x['S:PACK2_VALVE'] === 1);
    expect(reopen).toBeDefined();
    const tReopen = 60 + reopen!.t;
    expect(tReopen - svClosed).toBeGreaterThan(28);
    expect(tReopen - svClosed).toBeLessThan(34);
    expect(tReopen).toBeGreaterThan(runT);
  });

  it('after APU BLEED OFF and MODE NORM, the engine bleeds take over and the X BLEED closes', () => {
    const { sim } = r;
    mode(sim, 1);
    pb(sim, 'AIR_APU_BLEED', 0);
    r.fake.apuBleed = false;
    sim.run(10);
    expect(sim.get('S:BLEED_ENG1_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_ENG2_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(0);
    expect(sim.get('S:BLEED_PRESS_1')).toBeGreaterThan(35);
    expect(sim.get('S:BLEED_PRESS_1')).toBeLessThan(50);
    expect(sim.get('S:BLEED_TEMP_1')).toBeGreaterThan(120);
    expect(sim.get('S:BLEED_TEMP_1')).toBeLessThan(220);
    // HP valve open at idle (low stage pressure too low).
    expect(sim.get('S:BLEED_ENG1_HP_VALVE')).toBe(1);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
    // Pack flow back to normal (no longer forced HI by the APU bleed).
    expect(sim.get('S:PACK1_FLOW')).toBeGreaterThan(0.9);
    expect(sim.get('S:PACK1_FLOW')).toBeLessThan(1.1);
    expect(sim.get('L:AIR_ENG1_BLEED_FAULT')).toBe(0);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(0);
    expect(sim.get('L:AIR_APU_BLEED_ON')).toBe(0);
  });

  it('thrust limits: TOGA ≈ 84-86 % N1 at LFBD, FLX 58 lower, TOGA spool-up in ≈ 8 s', () => {
    const { sim } = r;
    expect(sim.get('S:ENG_THR_LIMIT_TYPE')).toBe(0);
    const toga = sim.get('S:ENG_TOGA_N1');
    expect(toga).toBeGreaterThan(84);
    expect(toga).toBeLessThan(86.5);
    expect(sim.get('S:ENG_MCT_N1')).toBeLessThan(toga);
    expect(sim.get('S:ENG_CLB_N1')).toBeLessThan(sim.get('S:ENG_MCT_N1'));
    sim.set('S:FMGS_FLEX', 58);
    sim.run(0.5);
    expect(sim.get('S:ENG_THR_LIMIT_TYPE')).toBe(1);
    expect(sim.get('S:ENG_FLX_TEMP')).toBe(58);
    const flx = sim.get('S:ENG_THR_LIMIT_N1');
    expect(flx).toBeLessThan(toga - 2);
    expect(flx).toBeGreaterThan(75);

    sim.set('C:THR_LEVER1', 45);
    sim.set('C:THR_LEVER2', 45);
    const s = record(sim, 12, ['S:ENG1_N1', 'S:ENG1_EGT', 'S:ENG1_FF', 'S:PRESS_OUTFLOW', 'S:PRESS_DELTA_P'], 0.5);
    expect(sim.get('S:ENG_THR_LIMIT_TYPE')).toBe(0);
    const at8 = first(s, (x) => x.t >= 8)!;
    expect(at8['S:ENG1_N1']).toBeGreaterThan(toga - 1.5);
    const last = s[s.length - 1];
    expect(Math.abs(last['S:ENG1_N1'] - toga)).toBeLessThan(0.8);
    expect(last['S:ENG1_FF']).toBeGreaterThan(2900);
    expect(last['S:ENG1_FF']).toBeLessThan(3800);
    expect(last['S:ENG1_EGT']).toBeLessThan(950);
    expect(last['S:ENG1_EGT']).toBeGreaterThan(650);
    // Take-off pre-pressurisation on ground.
    expect(last['S:PRESS_OUTFLOW']).toBeLessThan(0.9);
    expect(last['S:PRESS_DELTA_P']).toBeGreaterThan(0.02);
    expect(last['S:PRESS_DELTA_P']).toBeLessThan(0.2);
  });

  it('back to idle and shutdown: N1 back to idle within ≈ 12 s, N2 spools down, EGT cools', () => {
    const { sim } = r;
    sim.set('C:THR_LEVER1', 0);
    sim.set('C:THR_LEVER2', 0);
    sim.run(12);
    expect(sim.get('S:ENG1_N1')).toBeLessThan(22);
    master(sim, 1, false);
    sim.run(1);
    expect(sim.get('S:ENG1_HP_FUEL_VALVE')).toBe(0);
    expect(sim.get('S:ENG1_FF')).toBeLessThan(5);
    const s = record(sim, 120, ['S:ENG1_N2', 'S:ENG1_EGT', 'S:ENG1_STATE', 'S:ENG1_RUNNING'], 1);
    expect(s[0]['S:ENG1_RUNNING']).toBe(0);
    const n2At30 = first(s, (x) => x.t >= 30)!['S:ENG1_N2'];
    expect(n2At30).toBeLessThan(20);
    expect(s[s.length - 1]['S:ENG1_N2']).toBeLessThan(1);
    expect(s[s.length - 1]['S:ENG1_EGT']).toBeLessThan(200);
    // ENG 2 still running.
    expect(sim.get('S:ENG2_RUNNING')).toBe(1);
  });
});
