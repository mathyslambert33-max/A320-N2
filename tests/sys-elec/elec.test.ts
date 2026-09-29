import { describe, expect, it } from 'vitest';
import { press, setControl } from '../../src/core/headless';
import { batsOn, engine, extOn, litLights, master, runUntil, setup } from './helpers';

describe('ELEC — cold & dark', () => {
  it('everything unpowered but the battery voltages are readable (hot buses)', async () => {
    const sim = await setup();
    for (const b of ['DC_BAT_BUS', 'DC_ESS_BUS', 'DC1_BUS', 'DC2_BUS', 'AC1_BUS', 'AC2_BUS', 'AC_ESS_BUS', 'AC_ESS_SHED', 'DC_ESS_SHED', 'STAT_INV', 'AC_POWERED', 'ANN_POWER'])
      expect(sim.get(`S:ELEC_${b}`), b).toBe(0);
    expect(sim.get('S:ELEC_HOT_BUS1')).toBe(1);
    expect(sim.get('S:ELEC_HOT_BUS2')).toBe(1);
    for (const n of [1, 2]) {
      const v = sim.get(`S:ELEC_BAT${n}_V`);
      expect(v).toBeGreaterThan(25.5); // SOP check "BAT voltage > 25.5 V"
      expect(v).toBeLessThan(26.3);
      expect(sim.get(`S:ELEC_BAT${n}_A`)).toBe(0);
    }
    // Dark cockpit: only the GPCU-powered EXT PWR AVAIL legend (GPU connected at the stand).
    expect(litLights(sim)).toEqual(['ELEC_EXT_PWR_AVAIL']);
  });

  it('no GPU → completely dark overhead', async () => {
    const sim = await setup({ gpu: false });
    expect(litLights(sim)).toEqual([]);
  });
});

describe('ELEC — batteries only (ground, < 50 kt)', () => {
  it('BAT AUTO powers DC BAT, DC ESS (via HOT BUS 2) and the static inverter; AC ESS and SHED buses unpowered', async () => {
    const sim = await setup();
    setControl(sim, 'ELEC_BAT1', 1);
    sim.run(0.5);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(0); // BCL power-up delay (1 s)
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_BAT1_CONTACTOR')).toBe(1);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(1);
    expect(sim.get('S:ELEC_DC_ESS_BUS')).toBe(1);
    expect(sim.get('S:ELEC_DC_ESS_SHED')).toBe(0);
    expect(sim.get('S:ELEC_STAT_INV')).toBe(1);
    expect(sim.get('S:ELEC_AC_STAT_INV_BUS')).toBe(1);
    expect(sim.get('S:ELEC_AC_ESS_BUS')).toBe(0);
    expect(sim.get('S:ELEC_AC_ESS_SHED')).toBe(0);
    expect(sim.get('S:ELEC_DC1_BUS')).toBe(0);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(0);
    // discharging: voltage sags a little, current negative
    expect(sim.get('S:ELEC_BAT1_A')).toBeLessThan(-5);
    expect(sim.get('S:ELEC_BAT1_V')).toBeLessThan(25.8);
    expect(sim.get('S:ELEC_BAT1_V')).toBeGreaterThan(24.5);
    const lit = litLights(sim);
    expect(lit).toContain('ELEC_AC_ESS_FEED_FAULT');
    expect(lit).toContain('ELEC_GEN1_FAULT');
    expect(lit).toContain('ELEC_GEN2_FAULT');
    expect(lit).toContain('FUEL_L_PUMP1_FAULT'); // wing pumps are AC powered
    expect(lit).not.toContain('ELEC_BAT1_OFF');
    expect(lit).not.toContain('HYD_ENG1_PUMP_FAULT'); // inhibited on ground, engine stopped
    expect(lit).not.toContain('FUEL_CTR_PUMP1_FAULT'); // MODE SEL AUTO: centre pumps stopped
  });

  it('BAT 1 OFF with BAT 2 AUTO: BAT 1 OFF light on', async () => {
    const sim = await setup();
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(litLights(sim)).toContain('ELEC_BAT1_OFF');
    expect(litLights(sim)).not.toContain('ELEC_BAT2_OFF');
  });

  it('battery endurance: discharge protection opens the contactors on ground below 23 V', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('lowBattery');
    batsOn(sim);
    runUntil(sim, () => sim.get('S:ELEC_BAT1_CONTACTOR') === 0, 3 * 3600, 1);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(0);
  });
});

describe('ELEC — external power', () => {
  it('EXT PWR AVAIL → ON feeds AC 1+2 through the bus ties, TRs → DC 1/2 → DC BAT → DC ESS; AC ESS from AC 1', async () => {
    const sim = await setup();
    batsOn(sim);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(1);
    extOn(sim);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    expect(sim.get('L:ELEC_EXT_PWR_ON')).toBe(1);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(0);
    for (const b of ['AC1_BUS', 'AC2_BUS', 'AC_ESS_BUS', 'AC_ESS_SHED', 'DC1_BUS', 'DC2_BUS', 'DC_BAT_BUS', 'DC_ESS_BUS', 'DC_ESS_SHED', 'AC_POWERED', 'BUS_TIE1', 'BUS_TIE2'])
      expect(sim.get(`S:ELEC_${b}`), b).toBe(1);
    expect(sim.get('S:ELEC_STAT_INV')).toBe(0);
    expect(sim.get('S:ELEC_AC1_SRC')).toBe(4);
    expect(sim.get('S:ELEC_AC_ESS_FROM_AC2')).toBe(0);
    expect(Math.round(sim.get('S:ELEC_EXT_V'))).toBe(115);
    expect(Math.round(sim.get('S:ELEC_EXT_HZ'))).toBe(400);
    const tr1 = sim.get('S:ELEC_TR1_V');
    expect(tr1).toBeGreaterThan(27);
    expect(tr1).toBeLessThan(29);
    expect(sim.get('S:ELEC_TR1_A')).toBeGreaterThan(30);
    // batteries charging (~28 V, current decaying)
    expect(sim.get('S:ELEC_BAT1_V')).toBeGreaterThan(27.3);
    const i0 = sim.get('S:ELEC_BAT1_A');
    expect(i0).toBeGreaterThan(10);
    sim.run(300);
    expect(sim.get('S:ELEC_BAT1_A')).toBeLessThan(i0);
    expect(litLights(sim)).not.toContain('ELEC_AC_ESS_FEED_FAULT');
    expect(litLights(sim)).not.toContain('FUEL_L_PUMP1_FAULT');
  });

  it('EXT PWR pb with GPU not available does nothing; losing the GPU drops the ON light', async () => {
    const sim = await setup({ gpu: false });
    batsOn(sim);
    extOn(sim);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(0);
    expect(sim.get('L:ELEC_EXT_PWR_ON')).toBe(0);
    sim.set('G:GND_EXT_PWR', 1);
    sim.run(1);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(1);
    extOn(sim); // one push
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    sim.set('G:GND_EXT_PWR', 0);
    sim.run(1);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(0);
    expect(sim.get('L:ELEC_EXT_PWR_ON')).toBe(0);
    expect(sim.get('S:ELEC_STAT_INV')).toBe(1);
  });

  it('BCL: end of charge (< 4 A for 10 s) opens the battery contactors, voltage then decays at rest', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    const t = runUntil(sim, () => sim.get('S:ELEC_BAT1_CONTACTOR') === 0, 3600, 1);
    expect(t).toBeGreaterThan(300);
    expect(sim.get('S:ELEC_BAT1_A')).toBe(0);
    const v = sim.get('S:ELEC_BAT1_V');
    expect(v).toBeGreaterThan(26.5);
    sim.run(1200);
    expect(sim.get('S:ELEC_BAT1_V')).toBeLessThan(v);
  });

  it('BUS TIE OFF isolates AC 1 / AC 2 (EXT PWR cannot feed them); AC ESS FEED ALTN with auto transfer', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    setControl(sim, 'ELEC_BUS_TIE', 0);
    sim.run(1);
    expect(sim.get('L:ELEC_BUS_TIE_OFF')).toBe(1);
    expect(sim.get('S:ELEC_AC1_BUS')).toBe(0);
    expect(sim.get('S:ELEC_AC2_BUS')).toBe(0);
    setControl(sim, 'ELEC_BUS_TIE', 1);
    sim.run(1);
    setControl(sim, 'ELEC_AC_ESS_FEED', 0);
    sim.run(0.5);
    expect(sim.get('L:ELEC_AC_ESS_FEED_ALTN')).toBe(1);
    expect(sim.get('S:ELEC_AC_ESS_FROM_AC2')).toBe(1);
    expect(sim.get('S:ELEC_AC_ESS_BUS')).toBe(1);
  });
});

describe('ELEC — generators', () => {
  it('APU GEN supplies when AVAIL and EXT PWR not ON; EXT PWR has priority; transfer without break', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    sim.services['sys-elec'].preset('apuRunningExt');
    sim.run(2);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(0);
    expect(sim.get('L:ELEC_APU_GEN_FAULT')).toBe(0); // inhibited when EXT PWR supplies
    let lost = false;
    const un = sim.watch('S:ELEC_AC1_BUS', (v) => { if (!v) lost = true; });
    extOn(sim); // EXT PWR OFF
    un();
    expect(lost).toBe(false);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(1);
    expect(sim.get('S:ELEC_AC1_SRC')).toBe(3);
    expect(sim.get('L:ELEC_EXT_PWR_AVAIL')).toBe(1);
    const load = sim.get('S:ELEC_APU_GEN_LOAD');
    expect(load).toBeGreaterThan(20);
    expect(load).toBeLessThan(70);
    expect(Math.round(sim.get('S:ELEC_APU_GEN_HZ'))).toBeGreaterThanOrEqual(399);
    // APU GEN pb OFF: AC lost (EXT not ON), OFF light
    setControl(sim, 'ELEC_APU_GEN', 0);
    sim.run(0.5);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(0);
    expect(sim.get('L:ELEC_APU_GEN_OFF')).toBe(1);
  });

  it('engine generators come on line (N2 ≥ 55 %), onside GEN priority, GEN FAULT goes out', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(2);
    expect(sim.get('L:ELEC_GEN2_FAULT')).toBe(1);
    master(sim, 2, true);
    engine(sim, 2, 30);
    sim.run(3);
    expect(sim.get('S:ELEC_GEN2_ON')).toBe(0);
    engine(sim, 2, 60);
    sim.run(2);
    expect(sim.get('S:ELEC_GEN2_ON')).toBe(1);
    expect(sim.get('L:ELEC_GEN2_FAULT')).toBe(0);
    expect(sim.get('S:ELEC_AC2_SRC')).toBe(2);
    expect(sim.get('S:ELEC_AC1_SRC')).toBe(3); // APU GEN feeds AC 1 through bus tie 1
    master(sim, 1, true);
    engine(sim, 1, 60);
    sim.run(2);
    expect(sim.get('S:ELEC_GEN1_ON')).toBe(1);
    expect(sim.get('S:ELEC_APU_GEN_ON')).toBe(0);
    expect(sim.get('S:ELEC_BUS_TIE1')).toBe(0);
    expect(sim.get('S:ELEC_GEN1_LOAD')).toBeGreaterThan(5);
    expect(litLights(sim).filter((l) => l.startsWith('ELEC_'))).toEqual(['ELEC_EXT_PWR_AVAIL']); // GPU still plugged
    // IDG temperature rises with the engine running
    sim.run(300);
    expect(sim.get('S:ELEC_IDG1_TEMP')).toBeGreaterThan(60);
  });

  it('IDG disconnect is irreversible: GEN FAULT, AC 1 taken over via bus tie', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    master(sim, 1, true);
    master(sim, 2, true);
    engine(sim, 1, 60);
    engine(sim, 2, 60);
    sim.run(3);
    expect(sim.get('S:ELEC_GEN1_ON')).toBe(1);
    press(sim, 'ELEC_IDG1');
    sim.run(2);
    expect(sim.get('S:ELEC_IDG1_DISC')).toBe(1);
    expect(sim.get('S:ELEC_GEN1_ON')).toBe(0);
    expect(sim.get('L:ELEC_GEN1_FAULT')).toBe(1);
    expect(sim.get('S:ELEC_AC1_BUS')).toBe(1);
    expect(sim.get('S:ELEC_AC1_SRC')).toBe(3); // APU GEN takes AC 1 over
    sim.run(10);
    expect(sim.get('S:ELEC_IDG1_DISC')).toBe(1);
  });

  it('single engine generator only: galley shed', async () => {
    const sim = await setup();
    batsOn(sim);
    master(sim, 2, true);
    engine(sim, 2, 60);
    sim.run(3);
    expect(sim.get('S:ELEC_GEN2_ON')).toBe(1);
    expect(sim.get('S:ELEC_AC1_BUS')).toBe(1);
    expect(sim.get('S:ELEC_GALLEY_SHED')).toBe(1);
  });
});
