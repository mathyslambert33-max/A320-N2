/**
 * FADEC ground start protections (CFM56-5B, FCOM DSC-70 + "ENG n START FAULT" procedure):
 * start valve fault (no bleed air), ignition fault (no light-up) with automatic dry crank and recycle on
 * both igniters, EGT over-limit (hot start) with reduced fuel schedule, compressor stall, manual start
 * and dry crank.
 */
import { describe, expect, it } from 'vitest';
import { apuBleedOn, first, master, mode, pb, record, rig, type Sample } from './helpers';

const K = ['S:ENG2_N2', 'S:ENG2_EGT', 'S:ENG2_FF', 'S:ENG2_STATE', 'S:ENG2_START_FAULT', 'S:ENG2_START_ATTEMPT',
  'S:ENG2_START_VALVE', 'S:ENG2_IGN_A', 'S:ENG2_IGN_B', 'S:ENG2_HP_FUEL_VALVE', 'L:ENG2_FAULT'];

async function startEng2(opts: { bleed?: boolean; fail?: 'ign' | 'hotStart' | 'stall' } = {}) {
  const r = await rig();
  if (opts.bleed !== false) apuBleedOn(r);
  mode(r.sim, 2);
  r.sim.run(3);
  if (opts.fail) r.air.fail(opts.fail, 2, true);
  master(r.sim, 2, true);
  return r;
}

describe('start without bleed air', () => {
  it('start valve cannot open → START VALVE FAULT, start aborted, ENG 2 FAULT light, cleared by MASTER OFF', async () => {
    const r = await startEng2({ bleed: false });
    const s = record(r.sim, 20, K, 0.1);
    const f = first(s, (x) => x['S:ENG2_START_FAULT'] > 0)!;
    expect(f['S:ENG2_START_FAULT']).toBe(5);
    expect(f.t).toBeGreaterThan(3);
    expect(f.t).toBeLessThan(12);
    const last = s[s.length - 1];
    expect(last['S:ENG2_STATE']).toBe(5);
    expect(last['L:ENG2_FAULT']).toBe(1);
    expect(last['S:ENG2_N2']).toBeLessThan(1);
    expect(s.every((x) => x['S:ENG2_HP_FUEL_VALVE'] === 0 && x['S:ENG2_IGN_A'] === 0 && x['S:ENG2_IGN_B'] === 0)).toBe(true);
    master(r.sim, 2, false);
    r.sim.run(1);
    expect(r.sim.get('L:ENG2_FAULT')).toBe(0);
    expect(r.sim.get('S:ENG2_START_FAULT')).toBe(0);
  });
});

describe('ignition fault (no light-up)', () => {
  let s: Sample[];
  it('fuel on at 22 % N2, no light-up within 15 s → IGN FAULT, fuel & ignition off, starter kept on (dry crank)', async () => {
    const r = await startEng2({ fail: 'ign' });
    s = record(r.sim, 110, K, 0.1);
    const fuel = first(s, (x) => x['S:ENG2_HP_FUEL_VALVE'] === 1)!;
    const f = first(s, (x) => x['S:ENG2_START_FAULT'] > 0)!;
    expect(f['S:ENG2_START_FAULT']).toBe(1);
    expect(f.t - fuel.t).toBeGreaterThan(14);
    expect(f.t - fuel.t).toBeLessThan(16.5);
    expect(f['S:ENG2_HP_FUEL_VALVE']).toBe(0);
    expect(f['L:ENG2_FAULT']).toBe(1);
    // Dry crank: start valve open, no fuel, no ignition for 30 s.
    const crank = s.filter((x) => x.t > f.t + 0.2 && x.t < f.t + 29.5);
    expect(crank.every((x) => x['S:ENG2_START_VALVE'] === 1 && x['S:ENG2_HP_FUEL_VALVE'] === 0)).toBe(true);
    expect(crank.every((x) => x['S:ENG2_IGN_A'] === 0 && x['S:ENG2_IGN_B'] === 0)).toBe(true);
    expect(Math.max(...s.map((x) => x['S:ENG2_EGT']))).toBeLessThan(100);
  });

  it('second attempt after 30 s with both igniters, then final abort (valve closed, fault kept)', () => {
    const f = first(s, (x) => x['S:ENG2_START_FAULT'] > 0)!;
    const retry = first(s, (x) => x['S:ENG2_START_ATTEMPT'] === 2)!;
    expect(retry.t - f.t).toBeGreaterThan(29);
    expect(retry.t - f.t).toBeLessThan(31.5);
    expect(s.some((x) => x['S:ENG2_START_ATTEMPT'] === 2 && x['S:ENG2_IGN_A'] === 1 && x['S:ENG2_IGN_B'] === 1)).toBe(true);
    const last = s[s.length - 1];
    expect(last['S:ENG2_START_ATTEMPT']).toBe(2);
    expect(last['S:ENG2_STATE']).toBe(5);
    expect(last['S:ENG2_START_VALVE']).toBe(0);
    expect(last['S:ENG2_HP_FUEL_VALVE']).toBe(0);
    expect(last['L:ENG2_FAULT']).toBe(1);
  });
});

describe('hot start', () => {
  it('EGT reaches the 725 °C start limit → EGT OVERLIMIT abort; recycle with reduced fuel succeeds', async () => {
    const r = await startEng2({ fail: 'hotStart' });
    const s = record(r.sim, 110, K, 0.1);
    const f = first(s, (x) => x['S:ENG2_START_FAULT'] > 0)!;
    expect(f['S:ENG2_START_FAULT']).toBe(2);
    expect(f['S:ENG2_EGT']).toBeGreaterThanOrEqual(725);
    expect(f['S:ENG2_EGT']).toBeLessThan(760);
    expect(f['S:ENG2_HP_FUEL_VALVE']).toBe(0);
    const second = s.filter((x) => x['S:ENG2_START_ATTEMPT'] === 2);
    expect(second.length).toBeGreaterThan(0);
    expect(Math.max(...second.map((x) => x['S:ENG2_EGT']))).toBeLessThan(725);
    const last = s[s.length - 1];
    expect(last['S:ENG2_STATE']).toBe(3);
    expect(last['S:ENG2_START_FAULT']).toBe(0);
    expect(last['L:ENG2_FAULT']).toBe(0);
  });
});

describe('compressor stall', () => {
  it('N2 stagnates with a rising EGT → STALL abort, 3 attempts then aborted', async () => {
    const r = await startEng2({ fail: 'stall' });
    const s = record(r.sim, 160, K, 0.1);
    const f = first(s, (x) => x['S:ENG2_START_FAULT'] > 0)!;
    expect(f['S:ENG2_START_FAULT']).toBe(3);
    expect(f['S:ENG2_N2']).toBeLessThan(40);
    expect(f['S:ENG2_EGT']).toBeLessThan(725);
    const last = s[s.length - 1];
    expect(last['S:ENG2_START_ATTEMPT']).toBe(3);
    expect(last['S:ENG2_STATE']).toBe(5);
  });
});

describe('manual start and dry crank', () => {
  it('MAN START → start valve; MASTER ON at > 20 % N2 → fuel + both igniters; starter cut at 50 %', async () => {
    const r = await rig();
    apuBleedOn(r);
    const { sim } = r;
    mode(sim, 2);
    sim.run(3);
    pb(sim, 'ENG_MAN_START2', 1);
    sim.run(0.5);
    expect(sim.get('L:ENG_MAN_START2_ON')).toBe(1);
    let s = record(sim, 30, K, 0.1);
    expect(first(s, (x) => x['S:ENG2_START_VALVE'] === 1)!.t).toBeLessThan(2);
    // No fuel / ignition until MASTER ON.
    expect(s.every((x) => x['S:ENG2_HP_FUEL_VALVE'] === 0 && x['S:ENG2_IGN_A'] === 0 && x['S:ENG2_IGN_B'] === 0)).toBe(true);
    expect(sim.get('S:ENG2_N2')).toBeGreaterThan(20);
    master(sim, 2, true);
    s = record(sim, 50, K, 0.1);
    expect(s[3]['S:ENG2_HP_FUEL_VALVE']).toBe(1);
    expect(s[3]['S:ENG2_IGN_A']).toBe(1);
    expect(s[3]['S:ENG2_IGN_B']).toBe(1);
    const closed = first(s, (x) => x['S:ENG2_START_VALVE'] === 0)!;
    expect(closed['S:ENG2_N2']).toBeGreaterThanOrEqual(49.5);
    expect(s[s.length - 1]['S:ENG2_STATE']).toBe(3);
    pb(sim, 'ENG_MAN_START2', 0);
    mode(sim, 1);
    sim.run(2);
    expect(sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(sim.get('L:ENG_MAN_START2_ON')).toBe(0);
  });

  it('dry crank: MODE CRANK + MAN START ON motors the core without fuel or ignition', async () => {
    const r = await rig();
    apuBleedOn(r);
    const { sim } = r;
    mode(sim, 0);
    sim.run(1);
    pb(sim, 'ENG_MAN_START1', 1);
    const s = record(sim, 40, ['S:ENG1_N2', 'S:ENG1_START_VALVE', 'S:ENG1_HP_FUEL_VALVE', 'S:ENG1_IGN_A', 'S:ENG1_IGN_B', 'S:ENG1_STATE'], 0.5);
    expect(s.every((x) => x['S:ENG1_HP_FUEL_VALVE'] === 0 && x['S:ENG1_IGN_A'] === 0 && x['S:ENG1_IGN_B'] === 0)).toBe(true);
    expect(s[s.length - 1]['S:ENG1_START_VALVE']).toBe(1);
    expect(s[s.length - 1]['S:ENG1_STATE']).toBe(1);
    const n2 = s[s.length - 1]['S:ENG1_N2'];
    expect(n2).toBeGreaterThan(20);
    expect(n2).toBeLessThan(32);
    pb(sim, 'ENG_MAN_START1', 0);
    sim.run(3);
    expect(sim.get('S:ENG1_START_VALVE')).toBe(0);
  });
});
