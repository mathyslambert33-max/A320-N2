import { describe, expect, it } from 'vitest';
import { power, rig, set, turn, knob, pb } from './helpers';
import { ISIS_STATE } from '../../src/avionics/pfdnd/logic/isis';

describe('ISIS', () => {
  it('initialises for 90 s after power-up', async () => {
    const sim = await rig();
    expect(sim.get('S:ISIS_STATE')).toBe(ISIS_STATE.OFF);
    set(sim, { 'S:ELEC_DC_ESS_BUS': 1 });
    sim.run(1);
    expect(sim.get('S:ISIS_STATE')).toBe(ISIS_STATE.INIT);
    expect(sim.get('S:ISIS_INIT_REMAIN')).toBeGreaterThanOrEqual(89);
    expect(sim.get('S:ISIS_INIT_REMAIN')).toBeLessThanOrEqual(90);
    sim.run(90);
    expect(sim.get('S:ISIS_STATE')).toBe(ISIS_STATE.ON);
  });

  it('rides through short interruptions', async () => {
    const sim = await rig({ warm: true });
    power(sim, false);
    sim.run(1);
    power(sim);
    sim.run(0.2);
    expect(sim.get('S:ISIS_STATE')).toBe(ISIS_STATE.ON);
    power(sim, false);
    sim.run(3);
    power(sim);
    sim.run(0.2);
    expect(sim.get('S:ISIS_STATE')).toBe(ISIS_STATE.INIT);
  });

  it('is supplied by the HOT BUS in flight only above 50 kt', async () => {
    const sim = await rig();
    set(sim, { 'S:ELEC_HOT_BUS1': 1 });
    sim.run(0.5);
    expect(sim.getB('S:ISIS_POWERED')).toBe(false);
    set(sim, { 'S:ADIRS_IAS': 120 });
    sim.run(0.5);
    expect(sim.getB('S:ISIS_POWERED')).toBe(true);
  });

  it('baro, STD, LS, brightness', async () => {
    const sim = await rig({ warm: true });
    turn(sim, 'ISIS_BARO', 4);
    expect(sim.get('S:ISIS_BARO_HPA')).toBe(1017);
    knob(sim, 'ISIS_BARO', 'push');
    expect(sim.getB('S:ISIS_BARO_STD')).toBe(true);
    pb(sim, 'ISIS_LS');
    expect(sim.getB('S:ISIS_LS')).toBe(true);
    pb(sim, 'ISIS_MINUS');
    expect(sim.get('S:ISIS_BRT')).toBeCloseTo(0.7, 5);
  });
});
