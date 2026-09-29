import { describe, expect, it } from 'vitest';
import { setControl } from '../../src/core/headless';
import { irs, runUntil, setupWithElec } from './helpers';

/** sys-elec + sys-misc: cockpit preparation sequence from cold & dark at LFBD. */
describe('sys-misc with sys-elec', () => {
  it('cold & dark → BAT → IRs NAV on battery (ON BAT) → EXT PWR → aligned after MCDU position', async () => {
    const { sim } = await setupWithElec();
    // cold & dark: nothing lit, dome available on the hot bus
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(0);
    expect(sim.get('L:GEAR_L_DOWN')).toBe(0);
    setControl(sim, 'INTLT_DOME', 0);
    sim.run(0.2);
    expect(sim.get('S:INTLT_DOME')).toBe(1);

    // BAT 1 + 2 AUTO
    setControl(sim, 'ELEC_BAT1', 1);
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(sim.get('S:ANN_POWER')).toBe(1);
    expect(sim.get('L:FLTCTL_ELAC1_OFF')).toBe(0);
    expect(sim.get('L:OXY_CREW_SUPPLY_OFF')).toBe(1);

    // ANN LT TEST (powered)
    setControl(sim, 'INTLT_ANN_LT', 0);
    sim.run(0.1);
    expect(sim.get('S:INTLT_ANN_TEST')).toBe(1);
    setControl(sim, 'INTLT_ANN_LT', 1);
    sim.run(0.1);
    expect(sim.get('S:INTLT_ANN_TEST')).toBe(0);

    // IRs NAV on batteries: ADIRU 1 (and 3) on battery → ON BAT light
    irs(sim, 1);
    sim.run(3);
    expect(sim.get('S:ADIRS_IR1_ON_BAT')).toBe(1);
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(1);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1);

    // EXT PWR ON: AC back, ON BAT goes out
    const gpu = sim.get('G:GND_EXT_PWR');
    if (!gpu) sim.set('G:GND_EXT_PWR', 1);
    sim.run(1);
    setControl(sim, 'ELEC_EXT_PWR', sim.get('C:ELEC_EXT_PWR') ? 0 : 1);
    sim.run(2);
    expect(sim.get('S:ELEC_AC_ESS_BUS')).toBe(1);
    expect(sim.get('S:ADIRS_ON_BAT_SUPPLY')).toBe(0);

    // MCDU INIT A: ALIGN IRS
    sim.emit('adirs:position', { lat: 44.8309, lon: -0.7044 });
    sim.run(0.1);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(1);
    runUntil(sim, () => sim.get('S:ADIRS_IR1_ALIGNED') === 1, 440);
    sim.run(20); // IR 2 was restarted when AC came back (it was not on battery)
    expect(sim.get('S:ADIRS_IR2_ALIGNED')).toBe(1);
    expect(sim.get('S:ADIRS_IR3_ALIGNED')).toBe(1);
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(0);
    expect(sim.get('L:ADIRS_ON_BAT')).toBe(0);
    expect(sim.get('S:ADIRS_ADR1_ON')).toBe(1);
    expect(sim.get('L:GEAR_L_DOWN')).toBe(1);
  });
});
