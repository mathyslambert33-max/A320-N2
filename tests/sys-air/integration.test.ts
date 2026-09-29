/**
 * Integration with the real sys-elec (APU, bleed, fuel, electrical network) and sys-misc modules:
 * APU running with APU BLEED ON → ENG MODE IGN/START → MASTER 2 → MASTER 1 → generators on line.
 */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic } from '../../src/core/headless';
import installAir from '../../src/systems/air-eng/index';
import installElec from '../../src/systems/elec-hyd-fuel-apu/index';
import installMisc from '../../src/systems/misc/index';
import { first, master, mode, pb, record } from './helpers';

describe('sys-air + sys-elec + sys-misc', () => {
  it('engine start on the real APU bleed, generators come on line, APU bleed OFF → engine bleed', async () => {
    const app = headlessApp();
    await installLogic(app, [installElec, installMisc, installAir]);
    const sim = app.sim;
    sim.run(0.5);
    (sim.services['sys-elec'] as { preset(n: string): boolean }).preset('apuRunning');
    sim.run(10);
    expect(sim.getB('S:APU_BLEED_VALVE')).toBe(true);
    expect(sim.get('S:BLEED_PRESS_1')).toBeGreaterThan(25);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(1);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(0);

    mode(sim, 2);
    sim.run(3);
    expect(sim.get('S:PACK1_VALVE')).toBe(0);
    master(sim, 2, true);
    const s2 = record(sim, 60, ['S:ENG2_N2', 'S:ENG2_STATE', 'S:ENG2_START_FAULT', 'S:BLEED_PRESS_2'], 0.5);
    expect(s2.every((x) => x['S:ENG2_START_FAULT'] === 0)).toBe(true);
    const run2 = first(s2, (x) => x['S:ENG2_STATE'] === 3);
    expect(run2).toBeDefined();
    expect(run2!.t).toBeGreaterThan(38);
    expect(run2!.t).toBeLessThan(58);
    master(sim, 1, true);
    const s1 = record(sim, 60, ['S:ENG1_STATE', 'S:ENG1_START_FAULT'], 0.5);
    expect(s1.every((x) => x['S:ENG1_START_FAULT'] === 0)).toBe(true);
    expect(first(s1, (x) => x['S:ENG1_STATE'] === 3)).toBeDefined();
    expect(sim.get('S:ENG1_N1')).toBeGreaterThan(18.5);
    expect(sim.get('S:ENG2_N1')).toBeGreaterThan(18.5);
    // Engine-driven generators, fuel, hydraulics follow.
    expect(sim.getB('S:FUEL_ENG1_LP_VALVE')).toBe(true);
    expect(sim.getB('S:ELEC_AC1_BUS')).toBe(true);
    expect(sim.get('S:HYD_G_PRESS')).toBeGreaterThan(2500);

    mode(sim, 1);
    pb(sim, 'AIR_APU_BLEED', 0);
    sim.run(40);
    expect(sim.get('S:BLEED_ENG1_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_ENG2_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
    expect(sim.get('L:AIR_ENG1_BLEED_FAULT')).toBe(0);
    expect(sim.get('L:ENG1_FAULT')).toBe(0);
    expect(sim.get('L:ENG2_FAULT')).toBe(0);
  });

  it("sys-air 'enginesRunning' preset keeps running with the real fuel system", async () => {
    const app = headlessApp();
    await installLogic(app, [installElec, installMisc, installAir]);
    const sim = app.sim;
    sim.run(0.5);
    (sim.services['sys-elec'] as { preset(n: string): boolean }).preset('apuRunning');
    (sim.services['sys-air'] as { preset(n: string): void }).preset('enginesRunning');
    sim.run(30);
    expect(sim.get('S:ENG1_RUNNING')).toBe(1);
    expect(sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(sim.getB('S:ELEC_AC1_BUS')).toBe(true);
  });
});
