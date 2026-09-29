import { describe, expect, it } from 'vitest';
import { press, setControl } from '../../src/core/headless';
import { hyd, runUntil, sample, setup } from './helpers';

describe('Flight controls', () => {
  it('cold & dark: ailerons and elevators drooped, no computer', async () => {
    const { sim } = await setup('none');
    sim.run(1);
    expect(sim.get('S:FCTL_AIL_L')).toBeCloseTo(25, 0);
    expect(sim.get('S:FCTL_AIL_R')).toBeCloseTo(25, 0);
    expect(sim.get('S:FCTL_ELEV_L')).toBeCloseTo(17, 0);
    expect(sim.get('S:FCTL_ELEV_R')).toBeCloseTo(17, 0);
    expect(sim.get('S:FCTL_ELAC1_ON')).toBe(0);
    expect(sim.get('L:FLTCTL_ELAC1_FAULT')).toBe(0);
  });

  it('computers: 8 s power-up test with FAULT light, OFF light when pb out', async () => {
    const { sim } = await setup('full');
    sim.run(2);
    expect(sim.get('L:FLTCTL_ELAC1_FAULT')).toBe(1);
    expect(sim.get('L:FLTCTL_SEC3_FAULT')).toBe(1);
    expect(sim.get('S:FCTL_ELAC1_ON')).toBe(0);
    sim.run(7);
    expect(sim.get('L:FLTCTL_ELAC1_FAULT')).toBe(0);
    expect(sim.get('S:FCTL_ELAC1_ON')).toBe(1);
    expect(sim.get('S:FCTL_FAC2_ON')).toBe(1);
    setControl(sim, 'FLTCTL_SEC2', 0);
    sim.run(0.2);
    expect(sim.get('L:FLTCTL_SEC2_OFF')).toBe(1);
    expect(sim.get('S:FCTL_SEC2_ON')).toBe(0);
    setControl(sim, 'FLTCTL_SEC2', 1);
    sim.run(1);
    expect(sim.get('L:FLTCTL_SEC2_FAULT')).toBe(1); // new test after pb ON
  });

  it('F/CTL check with hydraulics: full deflections', async () => {
    const { sim } = await setup('full');
    hyd(sim, 3000, 3000, 3000);
    sim.run(10);
    expect(sim.get('S:FCTL_AIL_L')).toBeCloseTo(0, 0);
    expect(sim.get('S:FCTL_ELEV_L')).toBeCloseTo(0, 0);
    sim.set('C:SIDESTICK_CAPT_Y', 1); // full aft
    sim.run(2);
    expect(sim.get('S:FCTL_ELEV_L')).toBeCloseTo(-30, 0);
    expect(sim.get('S:FCTL_ELEV_R')).toBeCloseTo(-30, 0);
    sim.set('C:SIDESTICK_CAPT_Y', -1); // full forward
    sim.run(2);
    expect(sim.get('S:FCTL_ELEV_L')).toBeCloseTo(17, 0);
    sim.set('C:SIDESTICK_CAPT_Y', 0);
    sim.set('C:SIDESTICK_CAPT_X', 1); // full right
    sim.run(2);
    expect(sim.get('S:FCTL_AIL_L')).toBeCloseTo(25, 0);
    expect(sim.get('S:FCTL_AIL_R')).toBeCloseTo(-25, 0);
    for (const n of [2, 3, 4, 5]) expect(sim.get(`S:FCTL_SPLR_R${n}`)).toBeCloseTo(35, 0);
    expect(sim.get('S:FCTL_SPLR_R1')).toBe(0);
    expect(sim.get('S:FCTL_SPLR_L3')).toBe(0);
    sim.set('C:SIDESTICK_CAPT_X', 0);
    sim.set('C:RUDDER', -1);
    sim.run(2);
    expect(sim.get('S:FCTL_RUDDER')).toBeCloseTo(-25, 0);
    sim.set('C:RUDDER', 0);
    sim.set('C:SPDBRK_LEVER', 1);
    sim.run(2);
    for (const n of [2, 3, 4]) expect(sim.get(`S:FCTL_SPLR_L${n}`)).toBeCloseTo(40, 0);
    expect(sim.get('S:FCTL_SPLR_L5')).toBe(0);
  });

  it('flaps 1 on ground = 1+F (18/10): timing with both systems, half speed with one, none without', async () => {
    let r = await setup('full');
    hyd(r.sim, 3000, 3000, 3000);
    r.sim.run(9);
    r.sim.set('C:FLAPS_LEVER', 1);
    const t = runUntil(r.sim, () => r.sim.get('S:FCTL_FLAPS_CONF') === 1.5 && !r.sim.getB('S:FCTL_FLAPS_MOVING'), 40);
    expect(r.sim.get('S:FCTL_SLATS')).toBeCloseTo(18, 1);
    expect(r.sim.get('S:FCTL_FLAPS')).toBeCloseTo(10, 1);
    expect(t).toBeGreaterThan(12);
    expect(t).toBeLessThan(17);
    r.sim.set('C:FLAPS_LEVER', 4);
    r.sim.run(0.5);
    runUntil(r.sim, () => !r.sim.getB('S:FCTL_FLAPS_MOVING') && !r.sim.getB('S:FCTL_SLATS_MOVING'), 40);
    expect(r.sim.get('S:FCTL_SLATS')).toBeCloseTo(27, 1);
    expect(r.sim.get('S:FCTL_FLAPS')).toBeCloseTo(35, 1);
    expect(r.sim.get('S:FCTL_FLAPS_CONF')).toBe(4);

    r = await setup('full');
    hyd(r.sim, 3000, 0, 0); // green only: half speed
    r.sim.set('C:FLAPS_LEVER', 1);
    const t2 = runUntil(r.sim, () => r.sim.get('S:FCTL_FLAPS_CONF') === 1.5, 60);
    expect(t2).toBeGreaterThan(25);
    expect(t2).toBeLessThan(33);

    r = await setup('full');
    hyd(r.sim, 0, 0, 0);
    r.sim.set('C:FLAPS_LEVER', 3);
    r.sim.run(20);
    expect(r.sim.get('S:FCTL_FLAPS')).toBe(0);
    expect(r.sim.get('S:FCTL_FLAPS_CONF_TARGET')).toBe(3);
  });

  it('THS follows the trim wheel with hydraulics; rudder trim needs a FAC', async () => {
    const { sim } = await setup('full');
    sim.set('C:PITCH_TRIM', 4);
    sim.run(2);
    expect(sim.get('S:FCTL_THS')).toBe(0);
    hyd(sim, 3000, 0, 3000);
    sim.run(5);
    expect(sim.get('S:FCTL_THS')).toBeCloseTo(4, 1);
    sim.run(5); // FAC test over
    setControl(sim, 'RUD_TRIM', 2);
    sim.run(3);
    setControl(sim, 'RUD_TRIM', 1);
    expect(sim.get('S:FCTL_RUD_TRIM')).toBeGreaterThan(2.8);
    expect(sim.get('S:FCTL_RUD_TRIM')).toBeLessThan(3.2);
    press(sim, 'RUD_TRIM_RESET');
    sim.run(3);
    expect(sim.get('S:FCTL_RUD_TRIM')).toBe(0);
  });

  it('sidestick priority and dual input', async () => {
    const { sim } = await setup('full');
    sim.run(9);
    sim.set('C:SIDESTICK_CAPT_X', 0.5);
    sim.set('C:SIDESTICK_FO_X', 0.5);
    expect(sample(sim, 'L:PRIO_CAPT', 2)).toEqual(new Set([0, 1])); // flashing green
    expect(sim.get('S:FCTL_DUAL_INPUT')).toBe(1);
    sim.set('C:SIDESTICK_CAPT_TAKEOVER', 1);
    sim.run(0.5);
    expect(sim.get('L:PRIO_FO_ARROW')).toBe(1);
    expect(sim.get('L:PRIO_CAPT')).toBe(1);
    expect(sim.get('S:FCTL_PRIORITY')).toBe(1);
    expect(sim.get('S:FCTL_STICK_ROLL')).toBeCloseTo(0.5, 2);
    sim.set('C:SIDESTICK_CAPT_TAKEOVER', 0);
    sim.run(0.5);
    expect(sim.get('S:FCTL_PRIORITY')).toBe(0);
    expect(sim.get('L:PRIO_FO_ARROW')).toBe(0);
  });
});
