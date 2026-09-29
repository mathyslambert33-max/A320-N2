/**
 * End-to-end SOP sequence at the stand: cold & dark → BAT → EXT PWR → APU start → APU BLEED →
 * EXT PWR OFF (APU GEN takes over) → GPU disconnected.
 */
import { describe, expect, it } from 'vitest';
import { press, setControl } from '../../src/core/headless';
import { litLights, runUntil, setup } from './helpers';

describe('SOP sequence: cold & dark → EXT PWR → APU → APU BLEED', () => {
  it('behaves like the aircraft at every step', async () => {
    const sim = await setup();
    // 1. Preliminary cockpit preparation: BAT check (> 25.5 V) with the pbs OFF
    expect(sim.get('S:ELEC_BAT1_V')).toBeGreaterThan(25.5);
    expect(sim.get('S:ELEC_BAT2_V')).toBeGreaterThan(25.5);
    expect(litLights(sim)).toEqual(['ELEC_EXT_PWR_AVAIL']);
    // 2. BAT 1 + 2 AUTO
    setControl(sim, 'ELEC_BAT1', 1);
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(1);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(0);
    expect(sim.get('L:ELEC_AC_ESS_FEED_FAULT')).toBe(1);
    // 3. EXT PWR ON
    setControl(sim, 'ELEC_EXT_PWR', 1);
    sim.run(1);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);
    expect(sim.get('L:ELEC_AC_ESS_FEED_FAULT')).toBe(0);
    expect(sim.get('S:ELEC_BAT1_A')).toBeGreaterThan(5); // charging
    sim.run(120);
    // 4. APU MASTER SW ON, START
    setControl(sim, 'APU_MASTER', 1);
    sim.run(3);
    expect(sim.get('S:APU_FLAP_POS')).toBeGreaterThan(0.1);
    expect(sim.get('S:FUEL_APU_FEED')).toBe(1);
    press(sim, 'APU_START');
    expect(sim.get('L:APU_START_ON')).toBe(1);
    runUntil(sim, () => sim.getB('S:APU_STARTING'), 15);
    expect(sim.get('S:ELEC_BAT1_CONTACTOR')).toBe(1);
    runUntil(sim, () => sim.getB('L:APU_START_AVAIL'), 70);
    expect(sim.get('L:APU_START_ON')).toBe(0);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(0);
    expect(sim.get('L:ELEC_APU_GEN_FAULT')).toBe(0);
    sim.run(20);
    // 5. APU BLEED ON
    setControl(sim, 'AIR_APU_BLEED', 1);
    sim.run(3);
    expect(sim.get('S:APU_BLEED_VALVE')).toBe(1);
    expect(sim.get('S:APU_BLEED_PRESS')).toBeGreaterThan(30);
    // 6. EXT PWR OFF (before pushback): no-break transfer to APU GEN, AVAIL comes back
    let lost = false;
    const un = sim.watch('S:ELEC_AC_POWERED', (v) => { if (!v) lost = true; });
    setControl(sim, 'ELEC_EXT_PWR', 0);
    sim.run(1);
    un();
    expect(lost).toBe(false);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(1);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(1);
    expect(sim.get('L:ELEC_EXT_PWR_ON')).toBe(0);
    // 7. Ground crew disconnects the GPU
    sim.set('G:GND_EXT_PWR', 0);
    sim.run(1);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(0);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);
    const lit = litLights(sim);
    expect(lit).toEqual(['APU_MASTER_ON', 'APU_START_AVAIL', 'ELEC_GEN1_FAULT', 'ELEC_GEN2_FAULT']);
  });
});
