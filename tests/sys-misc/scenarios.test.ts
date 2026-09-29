import { describe, expect, it } from 'vitest';
import { scenarios } from '../../src/dev/scenarios/sys-misc';
import { setup } from './helpers';

describe('dev scenarios (sys-misc)', () => {
  it('every scenario runs headless', async () => {
    for (const [name, fn] of Object.entries(scenarios)) {
      const { sim } = await setup('full');
      fn(sim);
      expect(() => sim.run(3), name).not.toThrow();
    }
  });

  it('fireTest lights the fire panel; aligned gives NAV', async () => {
    let r = await setup('full');
    scenarios.fireTest(r.sim);
    r.sim.run(0.5);
    expect(r.sim.get('L:FIRE_ENG1_PB')).toBe(1);
    expect(r.sim.get('L:FIRE_APU_AGENT_DISCH')).toBe(1);
    expect(r.sim.get('L:ENG2_FIRE')).toBe(1);
    r = await setup('full');
    scenarios.aligned(r.sim);
    r.sim.run(2);
    expect(r.sim.get('S:ADIRS_IR1_STATE')).toBe(2);
    expect(r.sim.get('S:ADIRS_CAPT_ADR_VALID')).toBe(1);
  });
});
