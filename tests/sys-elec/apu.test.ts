import { describe, expect, it } from 'vitest';
import { press, setControl } from '../../src/core/headless';
import { batsOn, extOn, runUntil, setup } from './helpers';

describe('APU (APS 3200)', () => {
  it('start timeline: flap, starter, light-off, EGT peak, AVAIL, ON light', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    setControl(sim, 'APU_MASTER', 1);
    sim.run(0.2);
    expect(sim.get('L:APU_MASTER_ON')).toBe(1);
    press(sim, 'APU_START'); // pressed immediately: memorised until the flap is fully open
    expect(sim.get('L:APU_START_ON')).toBe(1);
    expect(sim.get('S:APU_N')).toBe(0);
    const tFlap = runUntil(sim, () => sim.get('S:APU_FLAP_POS') >= 1, 30);
    expect(tFlap).toBeGreaterThan(6);
    expect(tFlap).toBeLessThan(14);
    sim.run(0.1); // starter engaged once the flap is fully open
    expect(sim.get('S:APU_STARTING')).toBe(1);
    let peak = 0;
    let nAtPeak = 0;
    let starterSeen = false;
    let minBatV = 99;
    const t0 = sim.time;
    runUntil(sim, () => {
      const e = sim.get('S:APU_EGT');
      if (e > peak) { peak = e; nAtPeak = sim.get('S:APU_N'); }
      if (sim.getB('S:ELEC_APU_STARTER')) starterSeen = true;
      minBatV = Math.min(minBatV, sim.get('S:ELEC_BAT1_V'));
      return sim.getB('S:APU_AVAIL');
    }, 90);
    const tAvail = sim.time - t0;
    expect(tAvail).toBeGreaterThan(40);
    expect(tAvail).toBeLessThan(55);
    expect(starterSeen).toBe(true);
    expect(peak).toBeGreaterThan(650);
    expect(peak).toBeLessThan(900);
    expect(nAtPeak).toBeGreaterThan(30);
    expect(nAtPeak).toBeLessThan(60);
    expect(minBatV).toBeLessThan(25.5); // DC BAT bus sags while cranking
    expect(sim.get('S:APU_N')).toBeGreaterThan(95);
    expect(sim.get('L:APU_START_AVAIL')).toBe(1);
    expect(sim.get('L:APU_START_ON')).toBe(0);
    sim.run(90);
    expect(sim.get('S:APU_N')).toBeGreaterThan(99);
    expect(sim.get('S:APU_EGT')).toBeGreaterThan(300);
    expect(sim.get('S:APU_EGT')).toBeLessThan(450);
    expect(sim.get('S:APU_FUEL_FLOW')).toBeGreaterThan(80);
    expect(sim.get('S:APU_FUEL_FLOW')).toBeLessThan(160);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(0); // EXT PWR still ON has priority
    extOn(sim);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(1);
  });

  it('APU BLEED: valve opens at N > 95 % with the pb ON, 35-40 psi, EGT rises', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    setControl(sim, 'AIR_APU_BLEED', 0);
    sim.run(60);
    const egt0 = sim.get('S:APU_EGT');
    expect(sim.get('S:APU_BLEED_VALVE')).toBe(0);
    expect(sim.get('S:APU_BLEED_PRESS')).toBe(0);
    setControl(sim, 'AIR_APU_BLEED', 1);
    sim.run(3);
    expect(sim.get('S:APU_BLEED_VALVE')).toBe(1);
    const p = sim.get('S:APU_BLEED_PRESS');
    expect(p).toBeGreaterThan(30);
    expect(p).toBeLessThan(42);
    sim.run(60);
    expect(sim.get('S:APU_EGT')).toBeGreaterThan(egt0 + 20);
  });

  it('MASTER OFF after bleed use: 60 s cooling run (still AVAIL), then run-down, flap closes at N < 7 %', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(10);
    setControl(sim, 'AIR_APU_BLEED', 0);
    sim.run(10);
    setControl(sim, 'APU_MASTER', 0);
    sim.run(1);
    expect(sim.get('L:APU_MASTER_ON')).toBe(0);
    expect(sim.get('S:APU_SHUTTING_DOWN')).toBe(1);
    expect(sim.get('S:APU_COOLDOWN')).toBe(1);
    sim.run(55);
    expect(sim.get('S:APU_N')).toBeGreaterThan(99);
    expect(sim.get('S:APU_AVAIL')).toBe(1);
    const tStop = runUntil(sim, () => sim.get('S:APU_N') < 95, 20);
    expect(tStop).toBeLessThan(10);
    expect(sim.get('S:APU_FLAP_POS')).toBe(1);
    runUntil(sim, () => sim.get('S:APU_N') < 7, 60);
    expect(sim.get('S:APU_FLAP_POS')).toBeGreaterThan(0.9);
    runUntil(sim, () => sim.get('S:APU_FLAP_POS') === 0, 30);
    runUntil(sim, () => sim.get('S:APU_N') === 0 && !sim.getB('S:APU_SHUTTING_DOWN'), 60);
    expect(sim.get('S:APU_FAULT')).toBe(0);
  });

  it('MASTER OFF without recent bleed use: immediate shutdown (no cooling run)', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    setControl(sim, 'AIR_APU_BLEED', 0);
    sim.run(90);
    setControl(sim, 'APU_MASTER', 0);
    sim.run(5);
    expect(sim.get('S:APU_COOLDOWN')).toBe(0);
    expect(sim.get('S:APU_N')).toBeLessThan(60);
    expect(sim.get('S:APU_AVAIL')).toBe(0);
  });

  it('restart inhibited during run-down: START memorised, new start only once N = 0', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    setControl(sim, 'AIR_APU_BLEED', 0);
    sim.run(90);
    setControl(sim, 'APU_MASTER', 0);
    sim.run(4);
    setControl(sim, 'APU_MASTER', 1);
    press(sim, 'APU_START');
    expect(sim.get('S:APU_STARTING')).toBe(0);
    runUntil(sim, () => sim.getB('S:APU_STARTING'), 90);
    expect(sim.get('S:APU_N')).toBeLessThan(5);
    runUntil(sim, () => sim.getB('S:APU_AVAIL'), 90);
  });

  it('start with the BAT pbs OFF (EXT PWR on): starter not powered → automatic shutdown, MASTER SW FAULT', async () => {
    const sim = await setup();
    extOn(sim);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(1);
    setControl(sim, 'APU_MASTER', 1);
    sim.run(0.5);
    press(sim, 'APU_START');
    runUntil(sim, () => sim.getB('L:APU_MASTER_FAULT'), 30);
    expect(sim.get('S:APU_AUTO_SHUTDOWN')).toBe(1);
    expect(sim.get('S:APU_AVAIL')).toBe(0);
    expect(sim.get('L:APU_START_ON')).toBe(0);
    // FAULT reset by MASTER OFF (once the flap has closed)
    setControl(sim, 'APU_MASTER', 0);
    runUntil(sim, () => !sim.getB('L:APU_MASTER_FAULT'), 30);
  });

  it('start on batteries only: APU fuel pump runs from the static inverter, battery sag ~20 V', async () => {
    const sim = await setup({ gpu: false });
    batsOn(sim);
    setControl(sim, 'APU_MASTER', 1);
    sim.run(1);
    press(sim, 'APU_START');
    let minV = 99;
    runUntil(sim, () => { minV = Math.min(minV, sim.get('S:ELEC_BAT1_V')); return sim.getB('S:APU_AVAIL'); }, 100);
    expect(sim.get('S:FUEL_APU_PUMP_ON')).toBe(1);
    expect(minV).toBeGreaterThan(17);
    expect(minV).toBeLessThan(23.5);
    sim.run(3);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(1);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);
    expect(sim.get('S:FUEL_APU_PUMP_ON')).toBe(0); // L TK pumps now running
  });

  it('APU FIRE pb released: emergency shutdown, LP valve closed, bleed closed', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(5);
    expect(sim.get('S:APU_BLEED_VALVE')).toBe(1);
    setControl(sim, 'FIRE_APU_PB', 1);
    sim.run(3);
    expect(sim.get('S:APU_EMER_SHUTDOWN')).toBe(1);
    expect(sim.get('L:APU_MASTER_FAULT')).toBe(1);
    expect(sim.get('S:APU_BLEED_VALVE')).toBe(0);
    expect(sim.get('S:FUEL_APU_LP_VALVE')).toBe(0);
    expect(sim.get('S:APU_AVAIL')).toBe(0);
  });
});
