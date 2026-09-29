/**
 * Dev scenarios (src/dev/scenarios/sys-air.ts) with the real sys-elec + sys-misc + sys-air modules,
 * applied before the sim starts (as the dev harness does), and in display-only mode (no sys-air).
 */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import { scenarios } from '../../src/dev/scenarios/sys-air';
import installAir from '../../src/systems/air-eng/index';
import installElec from '../../src/systems/elec-hyd-fuel-apu/index';
import installMisc from '../../src/systems/misc/index';
import { first, master, record } from './helpers';

async function withScenario(name: string): Promise<Sim> {
  const app = headlessApp();
  await installLogic(app, [installElec, installMisc, installAir]);
  scenarios[name](app.sim);
  return app.sim;
}

describe('sys-air dev scenarios (full systems)', () => {
  it('enginesRunning: both engines at idle on engine bleed, APU BLEED OFF, MODE NORM', async () => {
    const sim = await withScenario('enginesRunning');
    sim.run(30);
    expect(sim.get('S:ENG1_RUNNING')).toBe(1);
    expect(sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(sim.get('C:ENG_MODE')).toBe(1);
    expect(sim.get('C:AIR_APU_BLEED')).toBe(0);
    expect(sim.get('S:BLEED_ENG1_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.getB('S:ELEC_AC2_BUS')).toBe(true);
    expect(sim.get('S:ENG1_IGN_A') + sim.get('S:ENG1_IGN_B')).toBe(0);
  });

  it('engine2Running: ENG 2 at idle, MODE IGN/START without continuous ignition; MASTER 1 then starts ENG 1', async () => {
    const sim = await withScenario('engine2Running');
    sim.run(5);
    expect(sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(sim.get('C:ENG_MODE')).toBe(2);
    expect(sim.get('S:ENG2_IGN_A') + sim.get('S:ENG2_IGN_B')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(0);
    master(sim, 1, true);
    const s = record(sim, 60, ['S:ENG1_STATE'], 0.5);
    expect(first(s, (x) => x['S:ENG1_STATE'] === 3)).toBeDefined();
  });

  it('eng2Starting: the automatic start of ENG 2 runs to idle', async () => {
    const sim = await withScenario('eng2Starting');
    const s = record(sim, 60, ['S:ENG2_STATE', 'S:ENG2_START_FAULT'], 0.5);
    expect(s.every((x) => x['S:ENG2_START_FAULT'] === 0)).toBe(true);
    expect(first(s, (x) => x['S:ENG2_STATE'] === 3)).toBeDefined();
  });

  it('eng2StartNoBleed: START VALVE FAULT, ENG 2 FAULT light', async () => {
    const sim = await withScenario('eng2StartNoBleed');
    sim.run(20);
    expect(sim.get('S:ENG2_START_FAULT')).toBe(5);
    expect(sim.get('L:ENG2_FAULT')).toBe(1);
  });

  it('apuBleed: packs running on APU bleed', async () => {
    const sim = await withScenario('apuBleed');
    sim.run(20);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(0);
  });
});

describe('sys-air dev scenarios (display-only, module not installed)', () => {
  it('writes plausible static engine values', () => {
    const app = headlessApp();
    scenarios.enginesRunning(app.sim);
    expect(app.sim.get('S:ENG1_N1')).toBeCloseTo(19.6, 1);
    expect(app.sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(app.sim.get('S:ENG_THR_LIMIT_N1')).toBeGreaterThan(80);
    scenarios.eng2Starting(app.sim);
    expect(app.sim.get('S:ENG2_STATE')).toBe(2);
  });
});
