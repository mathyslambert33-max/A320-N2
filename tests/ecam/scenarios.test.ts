import { describe, expect, it } from 'vitest';
import { scenarios } from '../../src/dev/scenarios/ecam';
import { SdPage } from '../../src/avionics/ecam/logic/types';
import { rig } from './helpers';

describe('ECAM dev scenarios (headless)', () => {
  for (const name of Object.keys(scenarios)) {
    it(`${name} runs`, async () => {
      const r = await rig();
      scenarios[name](r.sim);
      r.sim.run(3);
      expect(r.ecam.core.duUpper.mode).toBe('ON');
    });
  }

  it('enginesRunning: phase 2, WHEEL page, no warning', async () => {
    const r = await rig();
    scenarios.enginesRunning(r.sim);
    r.sim.run(3);
    expect(r.ecam.flightPhase()).toBe(2);
    expect(r.sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.WHEEL);
    expect(r.warnings().filter((w) => w.displayed)).toEqual([]);
  });

  it('fireTest: ENG 1 FIRE warning', async () => {
    const r = await rig();
    scenarios.fireTest(r.sim);
    r.sim.run(1);
    expect(r.sim.get('S:FWC_MASTER_WARN')).toBe(1);
    expect(r.left()[0]).toBe('ENG 1 FIRE');
  });

  it('toMemoDone: T.O CONFIG NORMAL', async () => {
    const r = await rig();
    scenarios.toMemoDone(r.sim);
    r.sim.run(3);
    expect(r.left()).toContain('T.O CONFIG NORMAL');
  });

  it('sdSTS: STATUS page after CLR', async () => {
    const r = await rig();
    scenarios.sdSTS(r.sim);
    r.sim.run(3);
    expect(r.sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.STS);
  });
});
