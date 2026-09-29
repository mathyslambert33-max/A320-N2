import { afterAll, describe, expect, it } from 'vitest';
import { setControl } from '../../src/core/headless';
import { SCENARIO } from '../../src/core/scenario';
import { settings } from '../../src/core/settings';
import { alignDuration } from '../../src/systems/misc/adirs';
import { irs, power, runUntil, sample, setup } from './helpers';

afterAll(() => settings.set('irsAlign', 'real'));

describe('ADIRS alignment', () => {
  it('alignment duration: 300 s / cos(lat), fast 90 s, instant 5 s, > 82° impossible', () => {
    expect(alignDuration('real', 44.83095)).toBeCloseTo(423.1, 0);
    expect(alignDuration('real', 0)).toBe(300);
    expect(alignDuration('real', 65)).toBe(600);
    expect(alignDuration('real', 78)).toBe(1020);
    expect(alignDuration('real', 85)).toBe(Infinity);
    expect(alignDuration('fast', 44)).toBe(90);
    expect(alignDuration('instant', 44)).toBe(5);
  });

  it('NAV alignment at LFBD with MCDU position entry (≈ 7 min 03 s), ON BAT test, lights', async () => {
    const { sim } = await setup('full');
    irs(sim, 1);
    sim.run(1);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_ALIGN_REMAIN')).toBeGreaterThan(420);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(0);
    // ON BAT light: on 5 s from t = 10.5 s during the power-up test
    sim.run(8);
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(0);
    sim.run(3); // t ≈ 12 s
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(1);
    expect(sim.get('S:ADIRS_ON_BAT')).toBe(1);
    sim.run(5); // t ≈ 17 s
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(0);
    // ADR valid after 18 s, attitude after 28 s
    sim.run(2);
    expect(sim.get('S:ADIRS_ADR1_ON')).toBe(1);
    sim.run(10);
    expect(sim.get('S:ADIRS_IR1_ATT_VALID')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_HDG_VALID')).toBe(0);
    // MCDU INIT A ALIGN IRS → at t ≈ 120 s
    sim.run(90);
    sim.emit('adirs:position', { lat: sim.get('G:AC_LAT'), lon: sim.get('G:AC_LON') });
    sim.run(0.1);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(1);
    const t = runUntil(sim, () => sim.get('S:ADIRS_IR1_STATE') === 2, 400) + 120.1 + 1;
    expect(t).toBeGreaterThan(418);
    expect(t).toBeLessThan(428);
    sim.run(0.5);
    for (const n of [1, 2, 3]) {
      expect(sim.get(`S:ADIRS_IR${n}_STATE`)).toBe(2);
      expect(sim.get(`S:ADIRS_IR${n}_ALIGNED`)).toBe(1);
      expect(sim.get(`S:ADIRS_IR${n}_ALIGN_REMAIN`)).toBe(0);
    }
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(0);
    expect(sim.get('L:ADIRS_IR2_ALIGN')).toBe(0);
    expect(sim.get('S:ADIRS_LAT')).toBeCloseTo(SCENARIO.stand.lat, 3);
    expect(sim.get('S:ADIRS_LON')).toBeCloseTo(SCENARIO.stand.lon, 3);
    expect(sim.get('S:ADIRS_HDG_TRUE')).toBeCloseTo(298, 1);
    expect(sim.get('S:ADIRS_HDG_MAG')).toBeCloseTo(298 - sim.get('G:AC_MAGVAR'), 1);
    expect(sim.get('S:ADIRS_GS')).toBe(0);
    expect(sim.get('S:ADIRS_CAPT_NAV_VALID')).toBe(1);
    expect(Math.abs(sim.get('S:ADIRS_BARO_ALT_STD'))).toBeLessThan(1000);
    expect(sim.get('S:ADIRS_SAT')).toBeCloseTo(sim.get('G:ENV_OAT'), 0);
  });

  it('without position the countdown stops at 1 min and the ALIGN lights flash; entry completes it', async () => {
    const { sim } = await setup('full');
    irs(sim, 1);
    sim.run(400);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_ALIGN_REMAIN')).toBe(60);
    expect(sim.get('S:ADIRS_IR1_ALIGN_FAULT')).toBe(1);
    expect(sample(sim, 'L:ADIRS_IR1_ALIGN', 2)).toEqual(new Set([0, 1]));
    sim.run(300);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_ALIGNED')).toBe(0);
    // a wrong position (2° away from the memorised one) is rejected
    sim.emit('adirs:position', { lat: sim.get('G:AC_LAT') + 2, lon: sim.get('G:AC_LON') });
    sim.run(1);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(0);
    sim.emit('adirs:position', { lat: 44.831, lon: -0.704 });
    sim.run(0.1);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_ALIGN_FAULT')).toBe(0);
    const t = runUntil(sim, () => sim.get('S:ADIRS_IR1_ALIGNED') === 1, 70);
    expect(t).toBeGreaterThan(58);
    expect(t).toBeLessThan(62);
  });

  it('settings.irsAlign fast (90 s) and instant (5 s)', async () => {
    let r = await setup('full', { align: 'fast' });
    irs(r.sim, 1);
    r.sim.run(1);
    r.sim.emit('adirs:position', { lat: 44.83, lon: -0.70 });
    let t = runUntil(r.sim, () => r.sim.get('S:ADIRS_IR2_ALIGNED') === 1, 120) + 1;
    expect(t).toBeGreaterThan(88);
    expect(t).toBeLessThan(92);
    r = await setup('full', { align: 'instant' });
    irs(r.sim, 1);
    r.sim.run(0.5);
    r.sim.emit('adirs:position', { lat: 44.83, lon: -0.70 });
    t = runUntil(r.sim, () => r.sim.get('S:ADIRS_IR3_ALIGNED') === 1, 20) + 0.5;
    expect(t).toBeLessThan(6);
    // instant mode still waits for the position
    r = await setup('full', { align: 'instant' });
    irs(r.sim, 1);
    r.sim.run(30);
    expect(r.sim.get('S:ADIRS_IR1_ALIGNED')).toBe(0);
    expect(r.sim.get('S:ADIRS_IR1_ALIGN_FAULT')).toBe(1);
  });

  it('excess motion restarts the alignment', async () => {
    const { sim } = await setup('full', { align: 'fast' });
    irs(sim, 1);
    sim.run(50);
    sim.set('G:AC_GS_KT', 3);
    sim.run(2);
    expect(sim.get('S:ADIRS_IR1_ALIGN_FAULT')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_ALIGN_REMAIN')).toBe(90);
    sim.set('G:AC_GS_KT', 0);
    sim.run(5);
    expect(sim.get('S:ADIRS_IR1_ALIGN_FAULT')).toBe(0);
    expect(sim.get('S:ADIRS_IR1_ALIGN_REMAIN')).toBeLessThan(90);
    expect(sim.get('S:ADIRS_IR1_ALIGN_REMAIN')).toBeGreaterThan(85);
  });

  it('fast realignment: OFF → NAV within 5 s when aligned = 30 s, position kept, no ON BAT test', async () => {
    const { sim, svc } = await setup('full');
    irs(sim, 1);
    sim.run(30);
    svc.debug.forceAligned();
    sim.run(1);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(2);
    irs(sim, 0, [1]);
    sim.run(3);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(0);
    irs(sim, 1, [1]);
    sim.run(1);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_POS_OK')).toBe(1);
    let onBat = false;
    const t = runUntil(sim, () => { onBat ||= sim.getB('L:ADIRS_ON_BAT'); return sim.get('S:ADIRS_IR1_ALIGNED') === 1; }, 40) + 1;
    expect(t).toBeGreaterThan(29);
    expect(t).toBeLessThan(32);
    expect(onBat).toBe(false);
  });

  it('ATT mode: attitude after 28 s, heading only after entry', async () => {
    const { sim } = await setup('full');
    irs(sim, 2, [1]);
    sim.run(20);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(3);
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(1); // attitude initialisation
    sim.run(10);
    expect(sim.get('S:ADIRS_IR1_ATT_VALID')).toBe(1);
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(0);
    expect(sim.get('S:ADIRS_IR1_HDG_VALID')).toBe(0);
    sim.emit('adirs:heading', { hdg: 297 });
    sim.run(0.5);
    expect(sim.get('S:ADIRS_IR1_HDG_VALID')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_NAV_VALID')).toBe(0);
  });

  it('on battery: ADIRU 1 stays, ADIRU 2 shuts down after 5 min; ON BAT light', async () => {
    const { sim } = await setup('hot');
    irs(sim, 1);
    sim.run(2);
    expect(sim.get('S:ADIRS_IR1_ON_BAT')).toBe(1);
    expect(sim.get('S:ADIRS_ON_BAT')).toBe(1);
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(1); // hot-bus supplied light
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(0); // annunciators not powered (BAT pbs OFF)
    sim.run(300);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);
    expect(sim.get('S:ADIRS_IR2_STATE')).toBe(0);
    expect(sim.get('S:ADIRS_IR3_STATE')).toBe(0);
    // AC back: IR 2 restarts from scratch, ON BAT goes out after the power-up test
    power(sim, 'full');
    sim.run(20);
    expect(sim.get('S:ADIRS_IR2_STATE')).toBe(1);
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(0);
    expect(sim.get('S:ADIRS_ON_BAT_SUPPLY')).toBe(0);
  });

  it('IR/ADR pushbuttons OFF disconnect the outputs', async () => {
    const { sim, svc } = await setup('full');
    irs(sim, 1);
    sim.run(30);
    svc.debug.forceAligned();
    sim.run(0.5);
    setControl(sim, 'ADIRS_ADR1', 0);
    setControl(sim, 'ADIRS_IR2', 0);
    sim.run(0.5);
    expect(sim.get('L:ADIRS_ADR1_OFF')).toBe(1);
    expect(sim.get('S:ADIRS_ADR1_ON')).toBe(0);
    expect(sim.get('S:ADIRS_IR2_NAV_VALID')).toBe(0);
    expect(sim.get('S:ADIRS_IR2_STATE')).toBe(2); // still aligned internally
    svc.debug.setFault('IR3', true);
    sim.run(0.5);
    expect(sim.get('L:ADIRS_IR3_FAULT')).toBe(1);
    expect(sim.get('S:ADIRS_IR3_STATE')).toBe(4);
  });
});
