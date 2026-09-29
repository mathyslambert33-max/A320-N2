import { describe, expect, it } from 'vitest';
import { press as press0, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';

/** Momentary press followed by a short pause (the pb is seen released before the next press). */
const press = (sim: Sim, id: string) => { press0(sim, id); sim.run(0.1); };
import { power, sample, setup } from './helpers';

describe('Misc panels', () => {
  it('cold & dark (BAT only): white OFF / blue ON lights follow the pbs', async () => {
    const { sim } = await setup('bat');
    // catalog cold & dark: CREW SUPPLY OUT → OFF light; GPWS pbs IN → no light
    expect(sim.get('L:OXY_CREW_SUPPLY_OFF')).toBe(1);
    expect(sim.get('L:GPWS_SYS_OFF')).toBe(0);
    expect(sim.get('L:RCDR_GND_CTL_ON')).toBe(0);
    setControl(sim, 'RCDR_GND_CTL', 1);
    setControl(sim, 'OXY_CREW_SUPPLY', 1);
    setControl(sim, 'GPWS_TERR', 0);
    setControl(sim, 'COCKPIT_DOOR_VIDEO', 0);
    setControl(sim, 'MAIN_TERR_ON_ND_CAPT', 1);
    sim.run(0.2);
    expect(sim.get('L:RCDR_GND_CTL_ON')).toBe(1);
    expect(sim.get('L:OXY_CREW_SUPPLY_OFF')).toBe(0);
    expect(sim.get('S:OXY_CREW_SUPPLY_ON')).toBe(1);
    expect(sim.get('L:GPWS_TERR_OFF')).toBe(1);
    expect(sim.get('L:COCKPIT_DOOR_VIDEO_OFF')).toBe(1);
    expect(sim.get('L:MAIN_TERR_ON_ND_CAPT_ON')).toBe(1);
    expect(sim.get('S:OXY_CREW_PRESS')).toBeGreaterThan(1700);
    power(sim, 'none');
    sim.run(0.2);
    expect(sim.get('L:RCDR_GND_CTL_ON')).toBe(0);
    expect(sim.get('L:GPWS_TERR_OFF')).toBe(0);
  });

  it('GPWS self-test on ground: G/S then GPWS lights and aural messages', async () => {
    const { sim } = await setup('full');
    const msgs: string[] = [];
    sim.on('gpws:aural', (p: { msg: string }) => msgs.push(p.msg));
    press(sim, 'MAIN_GPWS_GS_CAPT');
    sim.run(0.5);
    expect(sim.get('L:MAIN_GPWS_GS_CAPT_GS')).toBe(1);
    expect(sim.get('S:GPWS_TEST')).toBe(1);
    sim.run(2.5);
    expect(sim.get('L:MAIN_GPWS_GS_FO_GPWS')).toBe(1);
    expect(sim.get('L:MAIN_GPWS_GS_CAPT_GS')).toBe(0);
    sim.run(10);
    expect(sim.get('S:GPWS_TEST')).toBe(0);
    expect(msgs).toEqual(['GLIDE SLOPE', 'PULL UP', 'WINDSHEAR', 'TERRAIN TERRAIN PULL UP']);
  });

  it('EVAC command, EMER CALL, cabin calls', async () => {
    const { sim } = await setup('bat');
    setControl(sim, 'EVAC_COMMAND', 1);
    expect(sample(sim, 'L:EVAC_COMMAND_EVAC', 2)).toEqual(new Set([0, 1]));
    expect(sim.get('L:EVAC_COMMAND_ON')).toBe(1);
    expect(sim.get('S:EVAC_HORN')).toBe(1);
    press(sim, 'EVAC_HORN_SHUTOFF');
    expect(sim.get('S:EVAC_HORN')).toBe(0);
    setControl(sim, 'EVAC_COMMAND', 0);
    sim.run(0.2);
    expect(sim.get('L:EVAC_COMMAND_ON')).toBe(0);
    let mech = 0;
    const chimes: string[] = [];
    sim.on('calls:mech', () => mech++);
    sim.on('cabin:chime', (p: { type: string }) => chimes.push(p.type));
    press(sim, 'CALLS_MECH');
    press(sim, 'CALLS_FWD');
    press(sim, 'CALLS_EMER');
    expect(mech).toBe(1);
    expect(chimes).toEqual(['hi', 'hilo']);
    expect(sim.get('L:CALLS_EMER_ON')).toBe(1);
    press(sim, 'CALLS_EMER');
    expect(sim.get('L:CALLS_EMER_ON')).toBe(0);
  });

  it('wipers sweep with AC and park when switched OFF', async () => {
    const { sim } = await setup('full');
    setControl(sim, 'WIPER_CAPT', 2);
    let max = 0;
    for (let i = 0; i < 60; i++) { sim.run(1 / 30); max = Math.max(max, sim.get('S:WIPER_CAPT_POS')); }
    expect(max).toBeGreaterThan(0.9);
    setControl(sim, 'WIPER_CAPT', 0);
    sim.run(2);
    expect(sim.get('S:WIPER_CAPT_POS')).toBe(0);
    expect(sim.get('S:WIPER_FO_POS')).toBe(0);
  });

  it('pax oxygen MASK MAN ON → SYS ON until TMR RESET; cockpit door', async () => {
    const { sim } = await setup('full');
    press(sim, 'OXY_MASK_MAN_ON');
    expect(sim.get('L:OXY_PAX_SYS_ON')).toBe(1);
    expect(sim.get('S:OXY_PAX_MASKS')).toBe(1);
    press(sim, 'MAINT_OXY_TMR_RESET');
    expect(sim.get('L:OXY_PAX_SYS_ON')).toBe(0);
    expect(sim.get('S:CKPT_DOOR_LOCKED')).toBe(1);
    setControl(sim, 'DOOR_CKPT', 0);
    sim.run(0.5);
    expect(sim.get('S:CKPT_DOOR_LOCKED')).toBe(0);
    setControl(sim, 'DOOR_CKPT', 1);
    sim.run(3);
    expect(sim.get('S:CKPT_DOOR_LOCKED')).toBe(1);
    sim.set('G:DOOR_CKPT', 1);
    sim.run(0.2);
    expect(sim.get('L:DOOR_CKPT_OPEN')).toBe(1);
    expect(sim.get('S:CKPT_DOOR_OPEN')).toBe(1);
  });

  it('avionics smoke injection → S:VENT_AVNCS_SMOKE', async () => {
    const { sim, svc } = await setup('bat');
    expect(sim.get('S:VENT_AVNCS_SMOKE')).toBe(0);
    svc.debug.injectSmoke('AVNCS');
    sim.run(0.2);
    expect(sim.get('S:VENT_AVNCS_SMOKE')).toBe(1);
  });
});
