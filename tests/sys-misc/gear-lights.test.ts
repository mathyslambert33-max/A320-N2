import { describe, expect, it } from 'vitest';
import { press as press0, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';

/** Momentary press followed by a short pause (the pb is seen released before the next press). */
const press = (sim: Sim, id: string) => { press0(sim, id); sim.run(0.1); };
import { hyd, irs, power, sample, setup } from './helpers';

describe('Landing gear, autobrake, steering, RA, tyres', () => {
  it('gear DOWN lights need LGCIU 1 + annunciator power', async () => {
    let r = await setup('none');
    expect(r.sim.get('L:GEAR_L_DOWN')).toBe(0);
    expect(r.sim.get('S:GEAR_N_POS')).toBe(1);
    r = await setup('bat');
    expect(r.sim.get('L:GEAR_L_DOWN')).toBe(1);
    expect(r.sim.get('L:GEAR_NOSE_DOWN')).toBe(1);
    expect(r.sim.get('L:GEAR_R_UNLK')).toBe(0);
    expect(r.sim.get('L:GEAR_LEVER_RED')).toBe(0);
    expect(r.sim.get('S:GEAR_DOORS_CLOSED')).toBe(1);
  });

  it('gear retraction in flight with green pressure (doors, UNLK, up-locked)', async () => {
    const { sim } = await setup('full');
    hyd(sim, 3000, 3000, 3000);
    sim.set('G:AC_ON_GROUND', 0);
    sim.set('G:AC_RADALT_FT', 400);
    sim.set('C:GEAR_LEVER', 0);
    sim.run(5);
    expect(sim.get('L:GEAR_L_UNLK')).toBe(1);
    expect(sim.get('S:GEAR_DOORS_CLOSED')).toBe(0);
    sim.run(15);
    expect(sim.get('S:GEAR_L_POS')).toBe(0);
    expect(sim.get('L:GEAR_L_UNLK')).toBe(0);
    expect(sim.get('L:GEAR_L_DOWN')).toBe(0);
    expect(sim.get('S:GEAR_DOORS_CLOSED')).toBe(1);
    expect(sim.get('L:GEAR_LEVER_RED')).toBe(1); // < 750 ft, thrust idle, gear up
    expect(sim.get('S:RA_ALT')).toBe(400);
  });

  it('autobrake: arming conditions, MAX on ground, press again to disarm', async () => {
    const { sim, svc } = await setup('full');
    press(sim, 'AUTOBRK_MAX');
    expect(sim.get('S:AUTOBRK_MODE')).toBe(0); // no green pressure / IRs
    hyd(sim, 3000, 3000, 3000);
    irs(sim, 1);
    sim.run(30);
    svc.debug.forceAligned();
    sim.run(0.5);
    press(sim, 'AUTOBRK_MAX');
    expect(sim.get('S:AUTOBRK_MODE')).toBe(3);
    expect(sim.get('L:AUTOBRK_MAX_ON')).toBe(1);
    press(sim, 'AUTOBRK_LO');
    expect(sim.get('S:AUTOBRK_MODE')).toBe(1);
    expect(sim.get('L:AUTOBRK_MAX_ON')).toBe(0);
    expect(sim.get('L:AUTOBRK_LO_ON')).toBe(1);
    press(sim, 'AUTOBRK_LO');
    expect(sim.get('S:AUTOBRK_MODE')).toBe(0);
    press(sim, 'AUTOBRK_MED');
    expect(sim.get('S:AUTOBRK_MODE')).toBe(2);
    setControl(sim, 'ASKID_NWSTRG', 1); // A/SKID OFF → disarmed
    sim.run(0.2);
    expect(sim.get('S:AUTOBRK_MODE')).toBe(0);
  });

  it('nose wheel steering: tiller ±75° at low speed, fading with speed; castor without NWS', async () => {
    const { sim } = await setup('full');
    sim.set('S:NWS_AVAIL', 1);
    sim.set('C:TILLER_CAPT', 1);
    sim.run(5);
    expect(sim.get('S:NWS_ANGLE')).toBeCloseTo(75, 0);
    sim.set('C:TILLER_CAPT', 0);
    sim.set('C:RUDDER', 1);
    sim.run(5);
    expect(sim.get('S:NWS_ANGLE')).toBeCloseTo(6, 0);
    sim.set('G:AC_GS_KT', 45);
    sim.set('C:RUDDER', 0);
    sim.set('C:TILLER_CAPT', 1);
    sim.run(5);
    expect(sim.get('S:NWS_ANGLE')).toBeCloseTo(37.5, 0);
    sim.set('S:NWS_AVAIL', 0);
    sim.set('G:AC_GS_KT', 10);
    sim.run(30);
    expect(Math.abs(sim.get('S:NWS_ANGLE'))).toBeLessThan(1);
  });

  it('tyre pressures and radio altimeter on ground', async () => {
    const { sim } = await setup('full');
    sim.run(1);
    for (let n = 1; n <= 6; n++) {
      const p = sim.get(`S:TIRE_PRESS_${n}`);
      expect(p).toBeGreaterThan(n <= 4 ? 185 : 165);
      expect(p).toBeLessThan(n <= 4 ? 215 : 195);
    }
    expect(sim.get('S:RA_ALT')).toBe(0);
    expect(sim.get('S:RA_VALID')).toBe(1);
    power(sim, 'bat');
    sim.run(0.2);
    expect(sim.get('S:RA_VALID')).toBe(0);
  });
});

describe('Lighting and signs', () => {
  it('ANN LT TEST only when the annunciators are powered; DIM', async () => {
    const r = await setup('none');
    setControl(r.sim, 'INTLT_ANN_LT', 0);
    r.sim.run(0.2);
    expect(r.sim.get('S:INTLT_ANN_TEST')).toBe(0);
    power(r.sim, 'bat');
    r.sim.run(0.2);
    expect(r.sim.get('S:INTLT_ANN_TEST')).toBe(1);
    setControl(r.sim, 'INTLT_ANN_LT', 2);
    r.sim.run(0.2);
    expect(r.sim.get('S:INTLT_ANN_TEST')).toBe(0);
    expect(r.sim.get('S:INTLT_ANN_DIM')).toBe(1);
  });

  it('dome light works on the hot battery bus (cold & dark); integral lighting needs AC', async () => {
    const { sim } = await setup('hot');
    setControl(sim, 'INTLT_DOME', 0);
    setControl(sim, 'INTLT_OVHD_INTEG', 0.8);
    sim.run(0.2);
    expect(sim.get('S:INTLT_DOME')).toBe(1);
    expect(sim.get('S:INTLT_INTEG_OVHD')).toBe(0);
    setControl(sim, 'INTLT_DOME', 1);
    sim.run(0.2);
    expect(sim.get('S:INTLT_DOME')).toBeCloseTo(0.35, 2);
    power(sim, 'full');
    sim.run(0.2);
    expect(sim.get('S:INTLT_INTEG_OVHD')).toBeCloseTo(0.8, 2);
    power(sim, 'none');
    sim.run(0.2);
    expect(sim.get('S:INTLT_DOME')).toBe(0);
  });

  it('exterior lights: beacon flashes with AC, strobe AUTO off on ground, landing lights extend', async () => {
    const { sim } = await setup('bat');
    setControl(sim, 'EXTLT_BEACON', 0);
    expect(sample(sim, 'S:EXTLT_BEACON', 2)).toEqual(new Set([0]));
    power(sim, 'full');
    expect(sample(sim, 'S:EXTLT_BEACON', 2)).toEqual(new Set([0, 1]));
    setControl(sim, 'EXTLT_STROBE', 1);
    expect(sample(sim, 'S:EXTLT_STROBE', 2)).toEqual(new Set([0]));
    setControl(sim, 'EXTLT_STROBE', 0);
    expect(sample(sim, 'S:EXTLT_STROBE', 2)).toEqual(new Set([0, 1]));
    setControl(sim, 'EXTLT_NAV_LOGO', 0);
    setControl(sim, 'EXTLT_NOSE', 1);
    setControl(sim, 'EXTLT_LAND_L', 0);
    sim.run(4);
    expect(sim.get('S:EXTLT_NAV')).toBe(1);
    expect(sim.get('S:EXTLT_LOGO')).toBe(1);
    expect(sim.get('S:EXTLT_TAXI')).toBe(1);
    expect(sim.get('S:EXTLT_TO')).toBe(0);
    expect(sim.get('S:EXTLT_LAND_L')).toBe(0);
    expect(sim.get('S:EXTLT_LAND_L_EXT')).toBeGreaterThan(0.4);
    sim.run(5);
    expect(sim.get('S:EXTLT_LAND_L')).toBe(1);
    expect(sim.get('S:EXTLT_LAND_R')).toBe(0);
  });

  it('cabin signs with chime', async () => {
    const { sim } = await setup('full');
    let chimes = 0;
    sim.on('cabin:chime', () => chimes++);
    setControl(sim, 'SIGNS_SEAT_BELTS', 0);
    sim.run(0.2);
    expect(sim.get('S:SIGNS_SEATBELTS')).toBe(1);
    setControl(sim, 'SIGNS_NO_SMOKING', 1); // AUTO, gear down
    sim.run(0.2);
    expect(sim.get('S:SIGNS_NOSMOKING')).toBe(1);
    expect(sim.get('S:SIGNS_EXIT')).toBe(1);
    expect(chimes).toBe(2);
    setControl(sim, 'SIGNS_EMER_EXIT_LT', 1);
    sim.run(0.2);
    expect(sim.get('S:SIGNS_EMER_LT')).toBe(0);
    power(sim, 'bat'); // DC SHED ESS lost → emergency lights
    sim.run(0.2);
    expect(sim.get('S:SIGNS_EMER_LT')).toBe(1);
  });
});
