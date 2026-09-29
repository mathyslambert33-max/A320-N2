import { describe, expect, it } from 'vitest';
import { setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import { batsOn, engine, extOn, master, runUntil, setup } from './helpers';

/** Count PTU activations (barks) during `seconds`. */
function barks(sim: Sim, seconds: number): number {
  let n = 0;
  let last = sim.get('S:HYD_PTU_ACTIVE');
  for (let i = 0; i < Math.round(seconds * 30); i++) {
    sim.run(1 / 30);
    const a = sim.get('S:HYD_PTU_ACTIVE');
    if (a && !last) n++;
    last = a;
  }
  return n;
}

describe('HYD / brakes — cold & dark', () => {
  it('no hydraulic pressure, accumulator partly bled, parking brake held by the accumulator', async () => {
    const sim = await setup();
    for (const s of ['G', 'B', 'Y']) expect(sim.get(`S:HYD_${s}_PRESS`)).toBe(0);
    const acc = sim.get('S:BRK_ACCU_PRESS');
    expect(acc).toBeGreaterThanOrEqual(1900);
    expect(acc).toBeLessThanOrEqual(2800);
    const l = sim.get('S:BRK_PRESS_L');
    expect(l).toBeGreaterThan(1800);
    expect(l).toBeLessThanOrEqual(2110);
    expect(sim.get('S:BRK_PRESS_R')).toBe(l);
    expect(sim.get('S:BRK_PARK_ON')).toBe(1);
    expect(sim.get('S:NWS_AVAIL')).toBe(0);
    expect(sim.get('S:HYD_G_QTY')).toBeGreaterThan(12);
    expect(sim.get('S:HYD_B_QTY')).toBeGreaterThan(5);
    const t = sim.get('S:BRK_TEMP_1');
    expect(Math.abs(t - sim.get('G:ENV_OAT'))).toBeLessThan(2);
  });
});

describe('HYD — yellow electric pump & brake accumulator', () => {
  it('Y ELEC PUMP recharges the accumulator to ~3000 psi and pressurises yellow; NWS available', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    setControl(sim, 'HYD_YELLOW_ELEC_PUMP', 1);
    sim.run(0.2);
    expect(sim.get('L:HYD_YELLOW_ELEC_PUMP_ON')).toBe(1);
    expect(sim.get('S:HYD_Y_ELEC_PUMP_ON')).toBe(1);
    const t = runUntil(sim, () => sim.get('S:BRK_ACCU_PRESS') > 2900, 30);
    expect(t).toBeLessThan(15);
    expect(sim.get('S:HYD_Y_PRESS')).toBeGreaterThan(2700);
    expect(sim.get('S:NWS_AVAIL')).toBe(1);
    setControl(sim, 'ASKID_NWSTRG', 1); // OFF
    sim.run(0.5);
    expect(sim.get('S:NWS_AVAIL')).toBe(0);
    setControl(sim, 'ASKID_NWSTRG', 0);
    sim.set('G:GND_TOWBAR', 1); // towing pin inserted
    sim.run(0.5);
    expect(sim.get('S:NWS_AVAIL')).toBe(0);
    sim.set('G:GND_TOWBAR', 0);
    // pump OFF: yellow decays, accumulator keeps its charge (check valve)
    setControl(sim, 'HYD_YELLOW_ELEC_PUMP', 0);
    sim.run(60);
    expect(sim.get('S:HYD_Y_PRESS')).toBeLessThan(300);
    expect(sim.get('S:BRK_ACCU_PRESS')).toBeGreaterThan(2850);
    expect(sim.get('S:BRK_PRESS_L')).toBeGreaterThan(2000); // parking brake still ON
  });

  it('Y ELEC PUMP ON without AC power: pump does not run and no FAULT', async () => {
    const sim = await setup({ gpu: false });
    batsOn(sim);
    setControl(sim, 'HYD_YELLOW_ELEC_PUMP', 1);
    sim.run(3);
    expect(sim.get('S:HYD_Y_ELEC_PUMP_ON')).toBe(0);
    expect(sim.get('L:HYD_YELLOW_ELEC_PUMP_FAULT')).toBe(0);
    expect(sim.get('L:HYD_YELLOW_ELEC_PUMP_ON')).toBe(1);
  });

  it('accumulator alone gives about 7 full brake applications', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('accuCharged');
    batsOn(sim);
    setControl(sim, 'PARK_BRK', 0);
    sim.run(1);
    let apps = 0;
    while (sim.get('S:BRK_ACCU_PRESS') > 0 && apps < 20) {
      sim.set('C:BRAKE_L', 1);
      sim.set('C:BRAKE_R', 1);
      sim.run(1);
      if (sim.get('S:BRK_PRESS_L') > 1000) apps++;
      sim.set('C:BRAKE_L', 0);
      sim.set('C:BRAKE_R', 0);
      sim.run(1);
    }
    expect(apps).toBeGreaterThanOrEqual(6);
    expect(apps).toBeLessThanOrEqual(10);
    // accumulator exhausted → parking brake no longer effective
    setControl(sim, 'PARK_BRK', 1);
    sim.run(1);
    expect(sim.get('S:BRK_PARK_ON')).toBe(0);
  });

  it('pedal braking uses the alternate circuit when green is not pressurised (triple indicator), limited with A/SKID OFF', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('accuCharged');
    batsOn(sim);
    setControl(sim, 'PARK_BRK', 0);
    sim.run(1);
    expect(sim.get('S:BRK_PRESS_L')).toBe(0);
    sim.set('C:BRAKE_L', 0.5);
    sim.run(1);
    expect(sim.get('S:BRK_PRESS_L')).toBeGreaterThan(1000);
    expect(sim.get('S:BRK_PRESS_R')).toBe(0);
    setControl(sim, 'ASKID_NWSTRG', 1);
    sim.set('C:BRAKE_L', 1);
    sim.run(1);
    expect(sim.get('S:BRK_PRESS_L')).toBeLessThanOrEqual(1160);
  });
});

describe('HYD — PTU (barking dog)', () => {
  it('inhibited at first engine start with parking brake ON, barks when released, runs at the 2nd engine start', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(2);
    // ENG 2 started first (yellow: brakes / NWS)
    master(sim, 2, true);
    engine(sim, 2, 62);
    sim.run(10);
    expect(sim.get('S:HYD_Y_PRESS')).toBeGreaterThan(2800);
    expect(sim.get('S:HYD_ENG2_PUMP_ON')).toBe(1);
    expect(sim.get('S:HYD_G_PRESS')).toBeLessThan(100);
    expect(sim.get('S:HYD_B_PRESS')).toBeGreaterThan(2500); // blue elec pump AUTO: one engine running
    expect(sim.get('S:HYD_PTU_ENABLED')).toBe(0);
    expect(barks(sim, 10)).toBe(0);
    // Parking brake released with one engine running, no towing pin → PTU runs Y→G
    setControl(sim, 'PARK_BRK', 0);
    sim.run(0.2);
    expect(sim.get('S:HYD_PTU_ACTIVE')).toBe(1);
    expect(sim.get('S:HYD_PTU_DIR')).toBe(-1);
    expect(barks(sim, 10)).toBeGreaterThanOrEqual(2);
    expect(sim.get('S:HYD_G_PRESS')).toBeGreaterThan(2000);
    // Tow bar connected (pin inserted): inhibited again
    sim.set('G:GND_TOWBAR', 1);
    setControl(sim, 'PARK_BRK', 1);
    sim.run(1);
    expect(sim.get('S:HYD_PTU_ENABLED')).toBe(0);
    sim.set('G:GND_TOWBAR', 0);
    sim.run(20);
    expect(sim.get('S:HYD_G_PRESS')).toBeLessThan(500);
    // ENG 1 MASTER ON: both masters ON → inhibition ends → barking dog while ENG 1 spools
    master(sim, 1, true);
    sim.run(0.2);
    expect(sim.get('S:HYD_PTU_ACTIVE')).toBe(1);
    sim.run(2);
    expect(sim.get('S:HYD_G_PRESS')).toBeGreaterThan(2400);
    for (let n2 = 0; n2 <= 60; n2 += 5) { engine(sim, 1, n2); sim.run(2); }
    sim.run(5);
    expect(sim.get('S:HYD_ENG1_PUMP_ON')).toBe(1);
    expect(barks(sim, 20)).toBe(0);
  });

  it('PTU pb OFF: no transfer; PTU OFF light', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    setControl(sim, 'HYD_PTU', 0);
    setControl(sim, 'HYD_YELLOW_ELEC_PUMP', 1);
    sim.run(10);
    expect(sim.get('L:HYD_PTU_OFF')).toBe(1);
    expect(sim.get('S:HYD_PTU_ACTIVE')).toBe(0);
    expect(sim.get('S:HYD_G_PRESS')).toBe(0);
  });

  it('cargo door operation runs the yellow elec pump and inhibits the PTU for 40 s', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    sim.set('G:DOOR_CARGO_FWD', 0); // ground crew closes the forward cargo door
    sim.run(2);
    expect(sim.get('S:HYD_Y_ELEC_PUMP_ON')).toBe(1);
    expect(sim.get('S:HYD_Y_ELEC_PUMP_CARGO')).toBe(1);
    expect(sim.get('S:HYD_PTU_ACTIVE')).toBe(0);
    expect(sim.get('L:HYD_YELLOW_ELEC_PUMP_ON')).toBe(0);
    sim.run(20);
    expect(sim.get('S:HYD_Y_ELEC_PUMP_ON')).toBe(0);
  });
});

describe('HYD — pumps & FAULT lights', () => {
  it('EDP FAULT inhibited engine stopped on ground; FAULT when running with ENG FIRE pb released; OFF light', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    sim.run(2);
    expect(sim.get('L:HYD_ENG1_PUMP_FAULT')).toBe(0);
    master(sim, 1, true);
    engine(sim, 1, 60);
    sim.run(3);
    expect(sim.get('S:HYD_G_PRESS')).toBeGreaterThan(2800);
    expect(sim.get('L:HYD_ENG1_PUMP_FAULT')).toBe(0);
    setControl(sim, 'FIRE_ENG1_PB', 1);
    sim.run(10);
    expect(sim.get('S:HYD_G_FIRE_VALVE')).toBe(0);
    expect(sim.get('L:HYD_ENG1_PUMP_FAULT')).toBe(1);
    setControl(sim, 'FIRE_ENG1_PB', 0);
    setControl(sim, 'HYD_ENG1_PUMP', 0);
    sim.run(3);
    expect(sim.get('L:HYD_ENG1_PUMP_OFF')).toBe(1);
    expect(sim.get('L:HYD_ENG1_PUMP_FAULT')).toBe(0);
  });

  it('BLUE ELEC PUMP AUTO: off on ground with engines stopped, BLUE PUMP OVRD forces it', async () => {
    const sim = await setup();
    batsOn(sim);
    extOn(sim);
    sim.run(3);
    expect(sim.get('S:HYD_B_ELEC_PUMP_ON')).toBe(0);
    expect(sim.get('L:HYD_BLUE_ELEC_PUMP_FAULT')).toBe(0);
    setControl(sim, 'MAINT_BLUE_PUMP_OVRD', 1);
    sim.run(4);
    expect(sim.get('L:MAINT_BLUE_PUMP_OVRD_ON')).toBe(1);
    expect(sim.get('S:HYD_B_ELEC_PUMP_ON')).toBe(1);
    expect(sim.get('S:HYD_B_PRESS')).toBeGreaterThan(2500);
    setControl(sim, 'HYD_BLUE_ELEC_PUMP', 0);
    sim.run(1);
    expect(sim.get('L:HYD_BLUE_ELEC_PUMP_OFF')).toBe(1);
    expect(sim.get('S:HYD_B_ELEC_PUMP_ON')).toBe(0);
  });

  it('brakes heat when braking while moving; HOT light above 300 °C; BRK FAN', async () => {
    const sim = await setup();
    sim.services['sys-elec'].preset('apuRunning');
    setControl(sim, 'HYD_YELLOW_ELEC_PUMP', 1);
    setControl(sim, 'PARK_BRK', 0);
    sim.run(5);
    const t0 = sim.get('S:BRK_TEMP_1');
    sim.set('G:AC_GS_KT', 20);
    sim.set('C:BRAKE_L', 0.4);
    sim.set('C:BRAKE_R', 0.4);
    sim.run(5);
    sim.set('G:AC_GS_KT', 0);
    sim.set('C:BRAKE_L', 0);
    sim.set('C:BRAKE_R', 0);
    expect(sim.get('S:BRK_TEMP_1')).toBeGreaterThan(t0 + 5);
    sim.services['sys-elec'].model.brk.temps[2] = 320;
    sim.run(0.5);
    expect(sim.get('L:BRK_FAN_HOT')).toBe(1);
    setControl(sim, 'BRK_FAN', 1);
    sim.run(1);
    expect(sim.get('L:BRK_FAN_ON')).toBe(1);
    expect(sim.get('S:BRK_FAN_RUNNING')).toBe(1);
    sim.run(600);
    expect(sim.get('S:BRK_TEMP_3')).toBeLessThan(300);
  });
});
