import { describe, expect, it } from 'vitest';
import { setControl } from '../../src/core/headless';
import { runUntil, setup } from './helpers';

describe('Fire protection', () => {
  it('ENG 1 TEST: FIRE pb, SQUIB, DISCH, pedestal FIRE and S:FIRE_ENG1_TEST while held', async () => {
    const { sim } = await setup('bat');
    sim.set('C:FIRE_ENG1_TEST', 1);
    sim.run(0.5);
    for (const l of ['FIRE_ENG1_PB', 'ENG1_FIRE', 'FIRE_ENG1_AGENT1_SQUIB', 'FIRE_ENG1_AGENT1_DISCH', 'FIRE_ENG1_AGENT2_SQUIB', 'FIRE_ENG1_AGENT2_DISCH']) {
      expect(sim.get(`L:${l}`), l).toBe(1);
    }
    expect(sim.get('S:FIRE_ENG1_TEST')).toBe(1);
    expect(sim.get('S:FIRE_ENG1_DET')).toBe(1);
    expect(sim.get('L:FIRE_ENG2_PB')).toBe(0);
    sim.set('C:FIRE_ENG1_TEST', 0);
    sim.run(0.2);
    expect(sim.get('L:FIRE_ENG1_PB')).toBe(0);
    expect(sim.get('L:FIRE_ENG1_AGENT1_DISCH')).toBe(0);
    expect(sim.get('S:FIRE_ENG1_TEST')).toBe(0);
  });

  it('APU TEST and no lights without power', async () => {
    const { sim } = await setup('none');
    sim.set('C:FIRE_APU_TEST', 1);
    sim.run(0.5);
    expect(sim.get('L:FIRE_APU_PB')).toBe(0);
    expect(sim.get('S:FIRE_APU_TEST')).toBe(0);
    const r = await setup('bat');
    r.sim.set('C:FIRE_APU_TEST', 1);
    r.sim.run(0.5);
    expect(r.sim.get('L:FIRE_APU_PB')).toBe(1);
    expect(r.sim.get('L:FIRE_APU_AGENT_SQUIB')).toBe(1);
    expect(r.sim.get('L:FIRE_APU_AGENT_DISCH')).toBe(1);
    expect(r.sim.get('S:FIRE_APU_TEST')).toBe(1);
    expect(r.sim.get('S:FIRE_APU_DET')).toBe(1);
  });

  it('engine fire: pb released arms the squibs, AGENT 1 discharges the bottle, fire out', async () => {
    const { sim, svc } = await setup('bat');
    svc.debug.injectFire('ENG2', true, 1);
    sim.run(0.5);
    expect(sim.get('L:FIRE_ENG2_PB')).toBe(1);
    expect(sim.get('L:ENG2_FIRE')).toBe(1);
    expect(sim.get('L:FIRE_ENG2_AGENT1_SQUIB')).toBe(0);
    setControl(sim, 'FIRE_ENG2_PB', 1); // released
    sim.run(0.2);
    expect(sim.get('L:FIRE_ENG2_AGENT1_SQUIB')).toBe(1);
    expect(sim.get('S:FIRE_ENG2_SQUIB_ARMED')).toBe(1);
    sim.set('C:FIRE_ENG2_AGENT1', 1);
    sim.run(0.2);
    sim.set('C:FIRE_ENG2_AGENT1', 0);
    const t = runUntil(sim, () => sim.getB('L:FIRE_ENG2_AGENT1_DISCH'), 5);
    expect(t).toBeLessThan(2);
    expect(sim.get('L:FIRE_ENG2_AGENT1_SQUIB')).toBe(0);
    expect(sim.get('L:FIRE_ENG2_AGENT2_SQUIB')).toBe(1);
    expect(sim.get('S:FIRE_ENG2_AGENT1_DISCH')).toBe(1);
    sim.run(6);
    expect(sim.get('S:FIRE_ENG2_FIRE')).toBe(0);
    expect(sim.get('L:FIRE_ENG2_PB')).toBe(0);
  });

  it('APU fire on ground: automatic discharge after 3 s', async () => {
    const { sim, svc } = await setup('bat');
    svc.debug.injectFire('APU');
    sim.run(2);
    expect(sim.get('S:FIRE_APU_DET')).toBe(1);
    expect(sim.get('S:FIRE_APU_AGENT_DISCH')).toBe(0);
    sim.run(3);
    expect(sim.get('S:FIRE_APU_AGENT_DISCH')).toBe(1);
    expect(sim.get('L:FIRE_APU_AGENT_DISCH')).toBe(1);
  });

  it('cargo smoke test: DISCH while held, then two SMOKE cycles', async () => {
    const { sim } = await setup('bat');
    sim.set('C:CARGO_SMOKE_TEST', 1);
    sim.run(0.5);
    expect(sim.get('L:CARGO_SMOKE_FWD_DISCH_DISCH')).toBe(1);
    expect(sim.get('L:CARGO_SMOKE_AFT_DISCH_DISCH')).toBe(1);
    sim.set('C:CARGO_SMOKE_TEST', 0);
    sim.run(1);
    expect(sim.get('L:CARGO_SMOKE_FWD_DISCH_DISCH')).toBe(0);
    expect(sim.get('L:CARGO_SMOKE_FWD_DISCH_SMOKE')).toBe(1);
    expect(sim.get('S:SMOKE_CARGO_AFT_DET')).toBe(1);
    sim.run(3); // t ≈ 4.5 s: between the cycles
    expect(sim.get('S:SMOKE_CARGO_FWD_DET')).toBe(0);
    sim.run(2); // t ≈ 6.5 s: second cycle
    expect(sim.get('S:SMOKE_CARGO_FWD_DET')).toBe(1);
    sim.run(4);
    expect(sim.get('S:SMOKE_CARGO_FWD_DET')).toBe(0);
    expect(sim.get('S:FIRE_CARGO_TEST')).toBe(0);
  });

  it('APU AUTO EXTING TEST (MAINT): TEST then OK', async () => {
    const { sim } = await setup('bat');
    sim.set('C:MAINT_APU_AUTOEXT_TEST', 1);
    sim.run(1);
    expect(sim.get('L:MAINT_APU_AUTOEXT_TEST_TEST')).toBe(1);
    expect(sim.get('L:MAINT_APU_AUTOEXT_TEST_OK')).toBe(0);
    sim.run(2.5);
    expect(sim.get('L:MAINT_APU_AUTOEXT_TEST_OK')).toBe(1);
    sim.set('C:MAINT_APU_AUTOEXT_TEST', 0);
    sim.run(0.2);
    expect(sim.get('L:MAINT_APU_AUTOEXT_TEST_TEST')).toBe(0);
  });
});
