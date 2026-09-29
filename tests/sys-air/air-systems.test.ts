/**
 * Pneumatics, air conditioning, pressurisation, ventilation, anti-ice and the overhead lights on ground.
 */
import { describe, expect, it } from 'vitest';
import { apuBleedOn, first, master, mode, pb, record, rig } from './helpers';

describe('FADEC power supply (CFM56-5B)', () => {
  it('FADECs powered 5 min after aircraft power-up, then off; IGN/START, MASTER or FADEC GND PWR repower them', async () => {
    const r = await rig();
    const { sim } = r;
    expect(sim.get('S:ENG1_FADEC_ON')).toBe(1);
    expect(sim.get('S:ENG2_FADEC_ON')).toBe(1);
    const s = record(sim, 310, ['S:ENG1_FADEC_ON', 'S:ENG2_FADEC_ON'], 1);
    const off = first(s, (x) => x['S:ENG1_FADEC_ON'] === 0)!;
    expect(off.t).toBeGreaterThan(295);
    expect(off.t).toBeLessThan(302);
    expect(s[s.length - 1]['S:ENG2_FADEC_ON']).toBe(0);
    mode(sim, 2);
    sim.run(0.2);
    expect(sim.get('S:ENG1_FADEC_ON')).toBe(1);
    expect(sim.get('S:ENG2_FADEC_ON')).toBe(1);
    mode(sim, 1);
    sim.run(0.2);
    expect(sim.get('S:ENG1_FADEC_ON')).toBe(0);
    pb(sim, 'MAINT_FADEC_GND_PWR2', 1);
    sim.run(0.2);
    expect(sim.get('S:ENG2_FADEC_ON')).toBe(1);
    expect(sim.get('S:ENG1_FADEC_ON')).toBe(0);
    expect(sim.get('L:MAINT_FADEC_GND_PWR2_ON')).toBe(1);
    pb(sim, 'MAINT_FADEC_GND_PWR2', 0);
    master(sim, 1, true);
    sim.run(0.2);
    expect(sim.get('S:ENG1_FADEC_ON')).toBe(1);
    expect(sim.get('S:ENG2_FADEC_ON')).toBe(0);
  });

  it('no aircraft power: FADECs off', async () => {
    const r = await rig({ power: false });
    expect(r.sim.get('S:ENG1_FADEC_ON')).toBe(0);
    expect(r.sim.get('S:ENG2_FADEC_ON')).toBe(0);
  });
});

describe('bleed and packs on ground', () => {
  it('external power only (no bleed air): both PACK FAULT lights after 5 s, valves closed', async () => {
    const r = await rig();
    const { sim } = r;
    sim.run(6);
    expect(sim.get('S:PACK1_VALVE')).toBe(0);
    expect(sim.get('S:PACK2_VALVE')).toBe(0);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(1);
    expect(sim.get('L:AIR_PACK2_FAULT')).toBe(1);
    expect(sim.get('S:BLEED_PRESS_1')).toBeLessThan(1);
    // Pack pb OFF: FAULT out, OFF light on.
    pb(sim, 'AIR_PACK1', 0);
    sim.run(0.5);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(0);
    expect(sim.get('L:AIR_PACK1_OFF')).toBe(1);
  });

  it('APU BLEED ON: X BLEED (AUTO) opens, both packs open at HI flow, FAULT lights out', async () => {
    const r = await rig();
    const { sim } = r;
    sim.run(6);
    apuBleedOn(r);
    sim.run(5);
    expect(sim.get('L:AIR_APU_BLEED_ON')).toBe(1);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(1);
    expect(sim.get('S:BLEED_ENG1_VALVE')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
    expect(sim.get('S:PACK1_FLOW')).toBeGreaterThan(1.1);
    expect(sim.get('L:AIR_PACK1_FAULT')).toBe(0);
    expect(sim.get('L:AIR_PACK2_FAULT')).toBe(0);
    expect(sim.get('S:BLEED_PRESS_1')).toBeGreaterThan(25);
    expect(sim.get('S:BLEED_PRESS_2')).toBeGreaterThan(25);
    // X BLEED SHUT: the right duct loses the APU air → PACK 2 closes.
    sim.set('C:AIR_XBLEED', 0);
    sim.run(10);
    expect(sim.get('S:BLEED_XBLEED_VALVE')).toBe(0);
    expect(sim.get('S:BLEED_PRESS_2')).toBeLessThan(8);
    expect(sim.get('S:PACK2_VALVE')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
  });

  it('packs cool the cabin towards the selected temperature', async () => {
    const r = await rig({ timeOfDay: 'day' });
    const { sim } = r;
    apuBleedOn(r);
    const t0 = sim.get('S:COND_FWD_TEMP');
    sim.set('C:AIR_TEMP_FWD', 0.25); // 21 °C
    sim.run(900);
    const t1 = sim.get('S:COND_FWD_TEMP');
    expect(Math.abs(t1 - 21)).toBeLessThan(Math.abs(t0 - 21) + 0.01);
    expect(Math.abs(t1 - 21)).toBeLessThan(2.5);
    expect(sim.get('S:COND_FWD_SEL')).toBe(21);
    expect(sim.get('S:PACK1_OUT_TEMP')).toBeLessThan(25);
    expect(sim.get('S:COND_HOT_AIR_VALVE')).toBe(1);
  });

  it('ENG FIRE pb released closes the pack valve on its side', async () => {
    const r = await rig();
    const { sim } = r;
    apuBleedOn(r);
    sim.set('C:FIRE_ENG1_PB', 1);
    sim.run(3);
    expect(sim.get('S:PACK1_VALVE')).toBe(0);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
  });

  it('APU bleed leak: APU BLEED FAULT light', async () => {
    const r = await rig();
    const { sim } = r;
    apuBleedOn(r);
    r.air.fail('apuLeak', 1, true);
    sim.run(2);
    expect(sim.get('L:AIR_APU_BLEED_FAULT')).toBe(1);
  });
});

describe('wing anti-ice', () => {
  it('on ground, WING pb ON opens the valves for a 30 s test only (with bleed air)', async () => {
    const r = await rig();
    const { sim } = r;
    apuBleedOn(r);
    pb(sim, 'AI_WING', 1);
    const s = record(sim, 40, ['S:AI_WING_VALVE_L', 'S:AI_WING_VALVE_R', 'L:AI_WING_ON', 'L:AI_WING_FAULT'], 0.2);
    const open = first(s, (x) => x['S:AI_WING_VALVE_L'] === 1 && x['S:AI_WING_VALVE_R'] === 1)!;
    expect(open.t).toBeLessThan(2);
    const closed = first(s, (x) => x.t > open.t && x['S:AI_WING_VALVE_L'] === 0)!;
    expect(closed.t).toBeGreaterThan(29);
    expect(closed.t).toBeLessThan(33);
    expect(s[s.length - 1]['L:AI_WING_ON']).toBe(1);
    expect(s[s.length - 1]['L:AI_WING_FAULT']).toBe(0);
    // FAULT only transiently (valve travel).
    expect(s.filter((x) => x['L:AI_WING_FAULT'] === 1).length).toBeLessThan(15);
  });

  it('ENG ANTI ICE pb ON with the engine stopped: valve stays closed → FAULT (position disagree)', async () => {
    const r = await rig();
    const { sim } = r;
    pb(sim, 'AI_ENG1', 1);
    sim.run(2);
    expect(sim.get('S:AI_ENG1_VALVE')).toBe(0);
    expect(sim.get('L:AI_ENG1_ON')).toBe(1);
    expect(sim.get('L:AI_ENG1_FAULT')).toBe(1);
  });

  it('probe/window heat: AUTO → off on ground engines stopped; pb ON forces heating', async () => {
    const r = await rig();
    const { sim } = r;
    expect(sim.get('S:AI_PROBE_HEAT')).toBe(0);
    pb(sim, 'AI_PROBE_WINDOW', 1);
    sim.run(0.5);
    expect(sim.get('S:AI_PROBE_HEAT')).toBe(1);
    expect(sim.get('S:AI_TAT_HEAT')).toBe(0);
    expect(sim.get('L:AI_PROBE_WINDOW_ON')).toBe(1);
  });
});

describe('pressurisation on ground', () => {
  it('AUTO: outflow valve fully open, ΔP ≈ 0, cabin alt = field, LDG ELEV AUTO (FMGS or 291 ft LFPO)', async () => {
    const r = await rig();
    const { sim } = r;
    apuBleedOn(r);
    sim.run(20);
    expect(sim.get('S:PRESS_OUTFLOW')).toBe(1);
    expect(Math.abs(sim.get('S:PRESS_DELTA_P'))).toBeLessThan(0.03);
    expect(Math.abs(sim.get('S:PRESS_CAB_VS'))).toBeLessThan(50);
    expect(sim.get('S:PRESS_ACTIVE_SYS')).toBe(1);
    expect(sim.get('S:PRESS_LDG_ELEV')).toBe(291);
    expect(sim.get('S:PRESS_LDG_ELEV_AUTO')).toBe(1);
    expect(sim.get('L:PRESS_MODE_SEL_FAULT')).toBe(0);
    sim.set('S:FMGS_DEST_ELEV', 1500);
    sim.run(0.5);
    expect(sim.get('S:PRESS_LDG_ELEV')).toBe(1500);
    sim.set('C:PRESS_LDG_ELEV', 5); // +2000 ft
    sim.run(0.5);
    expect(sim.get('S:PRESS_LDG_ELEV')).toBe(2000);
    expect(sim.get('S:PRESS_LDG_ELEV_AUTO')).toBe(0);
  });

  it('MAN: MODE SEL MAN light, MAN V/S CTL DN closes the outflow valve (≈ 25 s full travel)', async () => {
    const r = await rig();
    const { sim } = r;
    pb(sim, 'PRESS_MODE_SEL', 0);
    sim.run(0.5);
    expect(sim.get('L:PRESS_MODE_SEL_MAN')).toBe(1);
    expect(sim.get('S:PRESS_MAN')).toBe(1);
    sim.set('C:PRESS_MAN_VS', 2);
    sim.run(12.5);
    const ov = sim.get('S:PRESS_OUTFLOW');
    expect(ov).toBeGreaterThan(0.4);
    expect(ov).toBeLessThan(0.6);
    sim.set('C:PRESS_MAN_VS', 1);
    sim.run(2);
    expect(sim.get('S:PRESS_OUTFLOW')).toBeCloseTo(ov, 2);
  });

  it('DITCHING closes the outflow valve, the packs and the avionics vent valves', async () => {
    const r = await rig();
    const { sim } = r;
    apuBleedOn(r);
    pb(sim, 'PRESS_DITCHING', 1);
    sim.run(10);
    expect(sim.get('L:PRESS_DITCHING_ON')).toBe(1);
    expect(sim.get('S:PRESS_OUTFLOW')).toBe(0);
    expect(sim.get('S:PACK1_VALVE')).toBe(0);
    expect(sim.get('S:VENT_INLET_VALVE')).toBe(0);
    expect(sim.get('S:VENT_EXTRACT_VALVE')).toBe(0);
  });

  it('both CPCs unpowered → MODE SEL FAULT (with annunciator power)', async () => {
    const r = await rig();
    const { sim } = r;
    // Only the annunciators stay powered.
    r.fake.power = false;
    sim.register({ name: 'test.ann', order: 21, update: (_dt, s) => s.set('S:ANN_POWER', 1) });
    sim.run(1);
    expect(sim.get('L:PRESS_MODE_SEL_FAULT')).toBe(1);
    expect(sim.get('S:PRESS_CPC1_FAULT')).toBe(1);
  });
});

describe('ventilation', () => {
  it('ground, warm skin: open-circuit (inlet & extract open), blower & extract fans running', async () => {
    const r = await rig();
    const { sim } = r;
    sim.run(5);
    expect(sim.get('S:VENT_BLOWER_ON')).toBe(1);
    expect(sim.get('S:VENT_EXTRACT_ON')).toBe(1);
    expect(sim.get('S:VENT_INLET_VALVE')).toBe(1);
    expect(sim.get('S:VENT_EXTRACT_VALVE')).toBe(1);
    expect(sim.get('L:VENT_BLOWER_FAULT')).toBe(0);
  });

  it('BLOWER OVRD: blower off, closed-circuit; both OVRD: smoke config (extract partially open)', async () => {
    const r = await rig();
    const { sim } = r;
    pb(sim, 'VENT_BLOWER', 0);
    sim.run(5);
    expect(sim.get('L:VENT_BLOWER_OVRD')).toBe(1);
    expect(sim.get('S:VENT_BLOWER_ON')).toBe(0);
    expect(sim.get('S:VENT_INLET_VALVE')).toBe(0);
    expect(sim.get('S:VENT_EXTRACT_VALVE')).toBe(0);
    pb(sim, 'VENT_EXTRACT', 0);
    sim.run(5);
    expect(sim.get('L:VENT_EXTRACT_OVRD')).toBe(1);
    expect(sim.get('S:VENT_EXTRACT_VALVE')).toBeCloseTo(0.3, 1);
  });

  it('avionics smoke → BLOWER and EXTRACT FAULT lights', async () => {
    const r = await rig();
    const { sim } = r;
    sim.register({ name: 'test.smoke', order: 21, update: (_dt, s) => s.set('S:VENT_AVNCS_SMOKE', 1) });
    sim.run(1);
    expect(sim.get('L:VENT_BLOWER_FAULT')).toBe(1);
    expect(sim.get('L:VENT_EXTRACT_FAULT')).toBe(1);
  });

  it('aft cargo isolation valves: OFF closes them (OFF light), aft cargo smoke closes them too', async () => {
    const r = await rig();
    const { sim } = r;
    sim.run(1);
    expect(sim.get('S:CARGO_VENT_AFT_VALVE')).toBe(1);
    expect(sim.get('S:CARGO_VENT_AFT_FAN')).toBe(1);
    pb(sim, 'CARGO_VENT_AFT_ISOL', 0);
    sim.run(6);
    expect(sim.get('L:CARGO_VENT_AFT_ISOL_OFF')).toBe(1);
    expect(sim.get('L:CARGO_VENT_AFT_ISOL_FAULT')).toBe(0);
    expect(sim.get('S:CARGO_VENT_AFT_VALVE')).toBe(0);
    pb(sim, 'CARGO_VENT_AFT_ISOL', 1);
    sim.run(6);
    sim.register({ name: 'test.cargo', order: 21, update: (_dt, s) => s.set('S:SMOKE_CARGO_AFT_DET', 1) });
    sim.run(6);
    expect(sim.get('S:CARGO_VENT_AFT_VALVE')).toBe(0);
    expect(sim.get('S:CARGO_VENT_AFT_FAN')).toBe(0);
  });
});

describe('lights', () => {
  it('all lights off without annunciator power; N1 MODE lights never lit (CFM)', async () => {
    const r = await rig({ power: false });
    const { sim } = r;
    pb(sim, 'AIR_PACK1', 0);
    pb(sim, 'ENG_MAN_START1', 1);
    sim.run(1);
    expect(sim.get('L:AIR_PACK1_OFF')).toBe(0);
    expect(sim.get('L:ENG_MAN_START1_ON')).toBe(0);
    const r2 = await rig();
    pb(r2.sim, 'AIR_RAM_AIR', 1);
    pb(r2.sim, 'VENT_CAB_FANS', 0);
    pb(r2.sim, 'AIR_HOT_AIR', 0);
    pb(r2.sim, 'AIR_ENG1_BLEED', 0);
    r2.sim.run(1);
    expect(r2.sim.get('L:AIR_RAM_AIR_ON')).toBe(1);
    expect(r2.sim.get('S:COND_RAM_AIR_VALVE')).toBe(1);
    expect(r2.sim.get('L:VENT_CAB_FANS_OFF')).toBe(1);
    expect(r2.sim.get('S:VENT_CAB_FANS_ON')).toBe(0);
    expect(r2.sim.get('L:AIR_HOT_AIR_OFF')).toBe(1);
    expect(r2.sim.get('L:AIR_ENG1_BLEED_OFF')).toBe(1);
    for (const l of ['L:ENG_N1_MODE1_FAULT', 'L:ENG_N1_MODE1_ON', 'L:ENG_N1_MODE2_FAULT', 'L:ENG_N1_MODE2_ON']) {
      expect(r2.sim.get(l)).toBe(0);
    }
  });
});

describe('presets', () => {
  it("'enginesRunning' puts both engines at stabilised idle with MASTERs ON and the bleeds on", async () => {
    const r = await rig();
    const { sim } = r;
    r.air.preset('enginesRunning');
    sim.run(10);
    for (const n of [1, 2]) {
      expect(sim.get(`S:ENG${n}_RUNNING`)).toBe(1);
      expect(sim.get(`S:ENG${n}_N1`)).toBeGreaterThan(18.8);
      expect(sim.get(`S:ENG${n}_N1`)).toBeLessThan(21);
      expect(sim.get(`C:ENG_MASTER${n}`)).toBe(0);
    }
    expect(sim.get('S:BLEED_ENG1_VALVE')).toBe(1);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:AI_PROBE_HEAT')).toBe(1);
  });

  it("event 'sys-air:preset' works as well", async () => {
    const r = await rig();
    r.sim.emit('sys-air:preset', { name: 'engine2Running' });
    r.sim.run(5);
    expect(r.sim.get('S:ENG2_RUNNING')).toBe(1);
    expect(r.sim.get('S:ENG1_RUNNING')).toBe(0);
  });
});
