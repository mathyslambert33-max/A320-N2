import { describe, expect, it } from 'vitest';
import { setup, power, press } from './helpers';
import { rudTrimText, wxrTilt, PRINTER_TEST_LENGTH } from '../../src/cockpit/pedestal/logic/misc';
import {
  TLA, thrustDrag, thrustStep, tlaAngle, flapsGate, spdBrkCanArm, spdBrkDrag, clampTrim, thsForCg,
} from '../../src/cockpit/pedestal/logic/levers';

describe('RUD TRIM window, WXR, printer', () => {
  it('formats the rudder trim position with L / R and one decimal', () => {
    expect(rudTrimText(0).text).toBe('L 0.0');
    expect(rudTrimText(1.24).text).toBe('R 1.2');
    expect(rudTrimText(-12.36).text).toBe('L12.4');
    expect(rudTrimText(25).text).toBe('R20.0');
    // at zero the last side is kept
    expect(rudTrimText(0.02, 'R').text).toBe('R 0.0');
  });

  it('powers the RUD TRIM indicator from the FAC supplies and validates it with a FAC', async () => {
    const { sim, ped } = await setup('bat');
    expect(sim.get('S:RUD_TRIM_IND_POWERED')).toBe(0);
    power(sim, 'full');
    sim.set('S:FCTL_FAC1_ON', 0);
    sim.set('S:FCTL_FAC2_ON', 0);
    sim.set('S:FCTL_RUD_TRIM', -3.4);
    sim.run(0.1);
    expect(sim.get('S:RUD_TRIM_IND_POWERED')).toBe(1);
    expect(sim.get('S:RUD_TRIM_IND_VALID')).toBe(0);
    sim.set('S:FCTL_FAC1_ON', 1);
    sim.run(0.1);
    expect(sim.get('S:RUD_TRIM_IND_VALID')).toBe(1);
    expect(ped.misc.rudTrim().text).toBe('L 3.4');
  });

  it('WX radar panel state', async () => {
    const { sim } = await setup('full');
    expect(sim.get('S:WXR_SYS')).toBe(0); // OFF at cold & dark
    expect(sim.get('S:WXR_PWS')).toBe(0); // PWS OFF
    sim.set('C:WXR_SYS', 0);
    sim.set('C:WXR_PWS', 0);
    sim.set('C:WXR_TILT', 0.75);
    sim.set('C:WXR_MODE', 3);
    sim.run(0.1);
    expect(sim.get('S:WXR_SYS')).toBe(1);
    expect(sim.get('S:WXR_ON')).toBe(1);
    expect(sim.get('S:WXR_PWS')).toBe(1);
    expect(sim.get('S:WXR_TILT')).toBeCloseTo(7.5, 3);
    expect(sim.get('S:WXR_MODE')).toBe(3);
    expect(wxrTilt(0)).toBe(-15);
  });

  it('printer: FEED advances the paper while held, TEST prints a strip, tear-off clears it', async () => {
    const { sim } = await setup('full');
    sim.set('C:PRINTER_FEED', 1);
    sim.run(1);
    sim.set('C:PRINTER_FEED', 0);
    const fed = sim.get('S:PRINTER_PAPER');
    expect(fed).toBeGreaterThan(0.015);
    press(sim, 'PRINTER_TEST');
    sim.run(8);
    expect(sim.get('S:PRINTER_PAPER')).toBeCloseTo(fed + PRINTER_TEST_LENGTH, 2);
    sim.emit('printer:tear');
    sim.run(0.1);
    expect(sim.get('S:PRINTER_PAPER')).toBe(0);
  });
});

describe('lever mechanics', () => {
  it('thrust lever detents capture the lever and reverse needs the latch', () => {
    expect(thrustDrag(24.2, false, false)).toBe(TLA.CL);
    expect(thrustDrag(30, false, false)).toBe(30);
    expect(thrustDrag(-8, false, false)).toBe(TLA.IDLE);
    expect(thrustDrag(-7, true, false)).toBe(TLA.REV_IDLE);
    expect(thrustDrag(-12, true, false)).toBe(-12);
    expect(thrustDrag(-25, true, false)).toBe(TLA.MAX_REV);
    expect(thrustDrag(10, false, true)).toBe(TLA.IDLE); // from reverse, stops at idle
    expect(thrustStep(0, 1, false)).toBe(TLA.CL);
    expect(thrustStep(25, 1, false)).toBe(TLA.FLX);
    expect(thrustStep(45, 1, false)).toBe(45);
    expect(thrustStep(0, -1, false)).toBe(0);
    expect(thrustStep(0, -1, true)).toBe(TLA.REV_IDLE);
    expect(thrustStep(-6, -1, true)).toBe(TLA.MAX_REV);
    expect(thrustStep(-20, 1, true)).toBe(TLA.REV_IDLE);
    expect(thrustStep(-6, 1, true)).toBe(TLA.IDLE);
    expect(tlaAngle(-20)).toBeLessThan(-20);
    expect(tlaAngle(45)).toBe(45);
  });

  it('flaps lever gates at 1 and 3 stop a single movement', () => {
    expect(flapsGate(0, 4)).toBe(1);
    expect(flapsGate(1, 4)).toBe(3);
    expect(flapsGate(3, 4)).toBe(4);
    expect(flapsGate(4, 0)).toBe(3);
    expect(flapsGate(3, 0)).toBe(1);
    expect(flapsGate(1, 0)).toBe(0);
    expect(flapsGate(2, 1)).toBe(1);
    expect(flapsGate(2, 3)).toBe(3);
    expect(flapsGate(0, 1)).toBe(1);
  });

  it('speed brake: ½ detent, arming only in RET', () => {
    expect(spdBrkDrag(0.02)).toBe(0);
    expect(spdBrkDrag(0.52)).toBe(0.5);
    expect(spdBrkDrag(0.3)).toBe(0.3);
    expect(spdBrkDrag(1.2)).toBe(1);
    expect(spdBrkCanArm(0)).toBe(true);
    expect(spdBrkCanArm(0.5)).toBe(false);
  });

  it('pitch trim range and CG take-off scale', () => {
    expect(clampTrim(20)).toBe(13.5);
    expect(clampTrim(-9)).toBe(-4);
    expect(thsForCg(17)).toBeCloseTo(3.8, 5);
    expect(thsForCg(40)).toBeCloseTo(-2.5, 5);
    expect(thsForCg(30)).toBeGreaterThan(0);
  });
});
