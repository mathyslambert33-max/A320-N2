import { describe, expect, it } from 'vitest';
import { setControl } from '../../src/core/headless';
import { SCENARIO } from '../../src/core/scenario';
import { batsOn, engine, extOn, litLights, master, runUntil, setup } from './helpers';

describe('FUEL', () => {
  it('tanks initialised from the scenario (FOB 6200 kg)', async () => {
    const sim = await setup();
    expect(sim.get('S:FUEL_LI_KG')).toBe(SCENARIO.fuel.leftInner);
    expect(sim.get('S:FUEL_RO_KG')).toBe(SCENARIO.fuel.rightOuter);
    expect(sim.get('S:FUEL_FOB_KG')).toBe(6200);
    expect(sim.get('S:FUEL_ENG1_LP_VALVE')).toBe(0);
  });

  it('pump lights: FAULT on batteries only (no AC), running with AC, OFF light when released', async () => {
    const sim = await setup();
    batsOn(sim);
    for (const p of ['L_PUMP1', 'L_PUMP2', 'R_PUMP1', 'R_PUMP2']) expect(sim.get(`L:FUEL_${p}_FAULT`), p).toBe(1);
    expect(sim.get('L:FUEL_CTR_PUMP1_FAULT')).toBe(0);
    expect(sim.get('S:FUEL_PUMP_L1_ON')).toBe(0);
    extOn(sim);
    sim.run(2);
    for (const p of ['L1', 'L2', 'R1', 'R2']) expect(sim.get(`S:FUEL_PUMP_${p}_ON`), p).toBe(1);
    expect(sim.get('S:FUEL_PUMP_C1_ON')).toBe(0); // MODE SEL AUTO, no engine running
    expect(litLights(sim).filter((l) => l.startsWith('FUEL'))).toEqual([]);
    setControl(sim, 'FUEL_L_PUMP1', 0);
    sim.run(2);
    expect(sim.get('L:FUEL_L_PUMP1_OFF')).toBe(1);
    expect(sim.get('L:FUEL_L_PUMP1_FAULT')).toBe(0);
    expect(sim.get('S:FUEL_PUMP_L1_ON')).toBe(0);
    setControl(sim, 'FUEL_MODE_SEL', 0);
    sim.run(0.5);
    expect(sim.get('L:FUEL_MODE_SEL_MAN')).toBe(1);
    expect(sim.get('S:FUEL_PUMP_C1_ON')).toBe(1); // MAN: pb ON → running (dry: empty centre tank)
    expect(sim.get('L:FUEL_CTR_PUMP1_FAULT')).toBe(1);
  });

  it('X FEED: ON immediately, OPEN only when the valve is fully open', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    setControl(sim, 'FUEL_XFEED', 1);
    sim.run(0.5);
    expect(sim.get('L:FUEL_XFEED_ON')).toBe(1);
    expect(sim.get('L:FUEL_XFEED_OPEN')).toBe(0);
    expect(sim.get('S:FUEL_XFEED_MOVING')).toBe(1);
    sim.run(1.5);
    expect(sim.get('L:FUEL_XFEED_OPEN')).toBe(1);
    expect(sim.get('S:FUEL_XFEED_OPEN')).toBe(1);
    expect(sim.get('S:FUEL_XFEED_MOVING')).toBe(0);
    setControl(sim, 'FUEL_XFEED', 0);
    sim.run(0.3);
    expect(sim.get('L:FUEL_XFEED_OPEN')).toBe(0);
    expect(sim.get('L:FUEL_XFEED_ON')).toBe(0);
  });

  it('LP valves follow ENG MASTER and close with the ENG FIRE pb; consumption and FUEL USED', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(2);
    master(sim, 1, true);
    master(sim, 2, true);
    sim.run(2);
    expect(sim.get('S:FUEL_ENG1_LP_VALVE')).toBe(1);
    expect(sim.get('S:FUEL_ENG1_FEED')).toBe(1);
    engine(sim, 1, 60);
    engine(sim, 2, 60);
    sim.set('S:ENG1_FF', 300);
    sim.set('S:ENG2_FF', 300);
    const fob0 = sim.get('S:FUEL_FOB_KG');
    sim.run(600);
    const used1 = sim.get('S:FUEL_USED_1');
    expect(used1).toBeGreaterThan(48);
    expect(used1).toBeLessThan(52);
    const burnt = fob0 - sim.get('S:FUEL_FOB_KG');
    expect(burnt).toBeGreaterThan(100 + 15); // engines + APU (~120 kg/h)
    expect(burnt).toBeLessThan(100 + 30);
    expect(sim.get('S:FUEL_LI_KG')).toBeLessThan(sim.get('S:FUEL_RI_KG')); // APU burns from the left side
    setControl(sim, 'FIRE_ENG2_PB', 1);
    sim.run(2);
    expect(sim.get('S:FUEL_ENG2_LP_VALVE')).toBe(0);
    // FUEL USED reset when the ENG MASTER is set ON again on ground
    master(sim, 1, false);
    sim.run(1);
    master(sim, 1, true);
    sim.run(1);
    expect(sim.get('S:FUEL_USED_1')).toBe(0);
  });

  it('centre tank AUTO: 2 min run after engine start, feeds with slats retracted, MODE SEL FAULT logic', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    const f = sim.services['sys-elec'].model.fuel;
    f.qty.C = 1500;
    sim.run(2);
    // centre fuel while the wing tanks are not full (3100 kg < 5000 kg per wing): MODE SEL FAULT
    expect(sim.get('L:FUEL_MODE_SEL_FAULT')).toBe(1);
    expect(sim.get('S:FUEL_PUMP_C1_ON')).toBe(0);
    sim.set('S:FCTL_SLATS', 18); // slats extended (CONF 1+F)
    master(sim, 2, true);
    sim.run(1);
    expect(sim.get('S:FUEL_PUMP_C1_ON')).toBe(1); // 2-minute run after engine start, even with slats out
    engine(sim, 2, 60);
    sim.set('S:ENG2_FF', 300);
    sim.run(125);
    expect(sim.get('S:FUEL_PUMP_C2_ON')).toBe(0);
    expect(sim.get('L:FUEL_CTR_PUMP2_FAULT')).toBe(0); // inhibited: stopped by the AUTO logic
    sim.set('S:FCTL_SLATS', 0);
    sim.run(2);
    expect(sim.get('S:FUEL_PUMP_C2_ON')).toBe(1);
    expect(sim.get('S:FUEL_CTR_PUMPS_ON')).toBe(1);
    const c0 = sim.get('S:FUEL_C_KG');
    const ri0 = sim.get('S:FUEL_RI_KG');
    sim.run(60);
    expect(sim.get('S:FUEL_C_KG')).toBeLessThan(c0 - 3); // centre pumps have priority
    expect(sim.get('S:FUEL_RI_KG')).toBe(ri0);
  });

  it('outer tank transfer valves open when the inner tank reaches 750 kg', async () => {
    const sim = await setup();
    sim.services['sys-elec'].model.fuel.qty.LI = 760;
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(1);
    expect(sim.get('S:FUEL_OUTER_XFR_L')).toBe(0);
    runUntil(sim, () => sim.getB('S:FUEL_OUTER_XFR_L'), 900, 1);
    const lo = sim.get('S:FUEL_LO_KG');
    sim.run(60);
    expect(sim.get('S:FUEL_LO_KG')).toBeLessThan(lo);
  });
});
