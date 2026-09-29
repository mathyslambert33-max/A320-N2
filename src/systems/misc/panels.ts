/**
 * Miscellaneous overhead / main panel / pedestal items (FCOM DSC-21, 23, 25, 31, 34, 35, 52):
 * EVAC, CALLS, GPWS (+ GPWS/G/S & TERR ON ND pbs), RCDR, OXYGEN, WIPERS/RAIN RPLNT, cockpit door (CDLS),
 * COCKPIT DOOR VIDEO, PA (3rd occupant), MAINT panel lights (except FADEC GND PWR, BLUE PUMP OVRD, HYD LEAK),
 * avionics smoke detection signal. (Avionics / cargo ventilation and ENG N1 MODE belong to sys-air.)
 *
 * Latching pb convention: C = 1 pressed IN. White OFF lights = pb OUT; blue ON lights = pb IN.
 */
import { type Ctx, b2n, flash1Hz, Edge } from './common';

/** EGPWS short self-test sequence (s from the press): lights and aural messages. */
const GPWS_TEST: Array<{ t: number; msg: string }> = [
  { t: 0.5, msg: 'GLIDE SLOPE' },
  { t: 2.5, msg: 'PULL UP' },
  { t: 4.0, msg: 'WINDSHEAR' },
  { t: 6.5, msg: 'TERRAIN TERRAIN PULL UP' },
];
const GPWS_TEST_LEN = 12;

export class PanelsModel {
  // EVAC
  private evacHornOff = false;
  // CALLS
  private emerCall = false;
  private emerT = 0;
  private edges: Record<string, Edge> = {};
  // GPWS
  private gpwsTestT = -1;
  private gpwsNext = 0;
  // RCDR
  private powerT = 0;
  private engStopT = 1e9;
  private cvrEraseT = 0;
  // OXY
  paxMasks = false;
  private paxSysOn = false;
  // wipers
  private wiperPhase = [0, 0];
  private wiperRate = [0, 0];
  // door
  private unlockT = 0;
  avncsSmoke = false;
  // rain repellent
  private rplnt = [0, 0];

  private edge(id: string, v: number): boolean {
    const e = (this.edges[id] ??= new Edge());
    return e.rise(v > 0.5);
  }

  update(c: Ctx): void {
    this.evac(c);
    this.calls(c);
    this.gpws(c);
    this.rcdr(c);
    this.oxy(c);
    this.wipers(c);
    this.door(c);
    this.misc(c);
    this.ventilation(c);
  }

  private evac(c: Ctx): void {
    const { sim, t, p } = c;
    const pwr = p.dcBat || p.dcEss;
    const cmd = sim.get('C:EVAC_COMMAND') > 0.5;
    if (!cmd) this.evacHornOff = false;
    if (this.edge('EVAC_HORN_SHUTOFF', sim.get('C:EVAC_HORN_SHUTOFF'))) this.evacHornOff = true;
    const active = pwr && cmd;
    sim.set('L:EVAC_COMMAND_EVAC', b2n(p.ann && active && flash1Hz(t)));
    sim.set('L:EVAC_COMMAND_ON', b2n(p.ann && active));
    sim.set('S:EVAC_ACTIVE', active);
    sim.set('S:EVAC_HORN', active && !this.evacHornOff);
    sim.set('S:EVAC_CAPT_ONLY', Math.round(sim.get('C:EVAC_CAPT_PURS')) === 1);
  }

  private calls(c: Ctx): void {
    const { sim, dt, t, p } = c;
    const cids = p.dcEss || p.dc1 || p.dc2;
    if (this.edge('CALLS_MECH', sim.get('C:CALLS_MECH')) && cids) sim.emit('calls:mech', {});
    if (this.edge('CALLS_FWD', sim.get('C:CALLS_FWD')) && cids) sim.emit('cabin:chime', { type: 'hi' });
    if (this.edge('CALLS_AFT', sim.get('C:CALLS_AFT')) && cids) sim.emit('cabin:chime', { type: 'hi' });
    if (this.edge('CALLS_ALL', sim.get('C:CALLS_ALL')) && cids) sim.emit('cabin:chime', { type: 'hi' });
    sim.set('S:CALLS_MECH', cids && sim.get('C:CALLS_MECH') > 0.5);
    if (this.edge('CALLS_EMER', sim.get('C:CALLS_EMER')) && cids) {
      this.emerCall = !this.emerCall;
      this.emerT = 0;
      if (this.emerCall) sim.emit('cabin:chime', { type: 'hilo' });
    }
    if (this.emerCall) {
      this.emerT += dt;
      if (this.emerT > 60 || !cids) this.emerCall = false; // answered by the cabin crew
    }
    sim.set('L:CALLS_EMER_CALL', b2n(p.ann && this.emerCall && flash1Hz(t)));
    sim.set('L:CALLS_EMER_ON', b2n(p.ann && this.emerCall));
    sim.set('S:CALLS_EMER', this.emerCall);
  }

  private gpws(c: Ctx): void {
    const { sim, dt, p } = c;
    const pwr = p.ac1 || p.acEss;
    const sysOn = sim.get('C:GPWS_SYS') > 0.5;
    const gsModeOn = sim.get('C:GPWS_GS_MODE') > 0.5;
    const flapModeOn = sim.get('C:GPWS_FLAP_MODE') > 0.5;
    const flap3 = sim.get('C:GPWS_LDG_FLAP3') > 0.5;
    const terrOn = sim.get('C:GPWS_TERR') > 0.5;
    const ann = p.ann;
    sim.set('L:GPWS_SYS_FAULT', 0);
    sim.set('L:GPWS_SYS_OFF', b2n(ann && !sysOn));
    sim.set('L:GPWS_GS_MODE_OFF', b2n(ann && !gsModeOn));
    sim.set('L:GPWS_FLAP_MODE_OFF', b2n(ann && !flapModeOn));
    sim.set('L:GPWS_LDG_FLAP3_ON', b2n(ann && flap3));
    sim.set('L:GPWS_TERR_FAULT', 0);
    sim.set('L:GPWS_TERR_OFF', b2n(ann && !terrOn));

    // Self-test: GPWS/G/S pb pressed on ground (system powered and ON).
    const pressed = this.edge('MAIN_GPWS_GS_CAPT', sim.get('C:MAIN_GPWS_GS_CAPT')) ||
      this.edge('MAIN_GPWS_GS_FO', sim.get('C:MAIN_GPWS_GS_FO'));
    if (pressed && pwr && sysOn && c.onGround && this.gpwsTestT < 0) { this.gpwsTestT = 0; this.gpwsNext = 0; }
    if (!pwr || !sysOn) this.gpwsTestT = -1;
    let gsLt = false;
    let gpwsLt = false;
    if (this.gpwsTestT >= 0) {
      this.gpwsTestT += dt;
      while (this.gpwsNext < GPWS_TEST.length && this.gpwsTestT >= GPWS_TEST[this.gpwsNext].t) {
        sim.emit('gpws:aural', { msg: GPWS_TEST[this.gpwsNext].msg, test: true });
        this.gpwsNext++;
      }
      const tt = this.gpwsTestT;
      gsLt = tt < 2.5;
      gpwsLt = tt >= 2.5 && tt < 6.5;
      if (tt > GPWS_TEST_LEN) this.gpwsTestT = -1;
    }
    const inTest = this.gpwsTestT >= 0;
    sim.set('L:MAIN_GPWS_GS_CAPT_GS', b2n(ann && gsLt));
    sim.set('L:MAIN_GPWS_GS_FO_GS', b2n(ann && gsLt));
    sim.set('L:MAIN_GPWS_GS_CAPT_GPWS', b2n(ann && gpwsLt));
    sim.set('L:MAIN_GPWS_GS_FO_GPWS', b2n(ann && gpwsLt));
    sim.set('S:GPWS_POWERED', pwr);
    sim.set('S:GPWS_SYS_ON', pwr && sysOn);
    sim.set('S:GPWS_GS_MODE_ON', gsModeOn);
    sim.set('S:GPWS_FLAP_MODE_ON', flapModeOn);
    sim.set('S:GPWS_LDG_FLAP3', flap3);
    sim.set('S:GPWS_TERR_ON', pwr && terrOn);
    sim.set('S:GPWS_TEST', inTest);
    sim.set('S:GPWS_TERR_TEST', inTest && this.gpwsTestT >= 6.5);

    const terrCapt = sim.get('C:MAIN_TERR_ON_ND_CAPT') > 0.5;
    const terrFo = sim.get('C:MAIN_TERR_ON_ND_FO') > 0.5;
    sim.set('L:MAIN_TERR_ON_ND_CAPT_ON', b2n(ann && terrCapt));
    sim.set('L:MAIN_TERR_ON_ND_FO_ON', b2n(ann && terrFo));
    sim.set('S:TERR_ON_ND_CAPT', terrCapt);
    sim.set('S:TERR_ON_ND_FO', terrFo);
  }

  private rcdr(c: Ctx): void {
    const { sim, dt, p } = c;
    const ac = p.acEss || p.ac1 || p.ac2;
    const gndCtl = sim.get('C:RCDR_GND_CTL') > 0.5;
    this.powerT = ac ? this.powerT + dt : 0;
    const engRunning = sim.getB('S:ENG1_RUNNING') || sim.getB('S:ENG2_RUNNING');
    this.engStopT = engRunning ? 0 : this.engStopT + dt;
    const auto = !c.onGround || engRunning || this.engStopT < 300 || this.powerT < 300;
    const on = ac && (gndCtl || auto);
    sim.set('L:RCDR_GND_CTL_ON', b2n(p.ann && gndCtl));
    sim.set('S:RCDR_CVR_ON', on);
    sim.set('S:RCDR_DFDR_ON', on);
    const parkBrk = Math.round(sim.get('C:PARK_BRK')) === 1;
    const testHeld = sim.get('C:RCDR_CVR_TEST') > 0.5 && on && parkBrk && c.onGround;
    if (this.edge('RCDR_CVR_TEST', testHeld ? 1 : 0)) sim.emit('rcdr:cvr_test', {});
    sim.set('S:RCDR_CVR_TEST', testHeld);
    const eraseHeld = sim.get('C:RCDR_CVR_ERASE') > 0.5 && on && parkBrk && c.onGround;
    const wasErase = this.cvrEraseT;
    this.cvrEraseT = eraseHeld ? this.cvrEraseT + dt : 0;
    if (wasErase < 2 && this.cvrEraseT >= 2) sim.emit('rcdr:cvr_erase', {});
  }

  private oxy(c: Ctx): void {
    const { sim, p } = c;
    const supply = sim.get('C:OXY_CREW_SUPPLY') > 0.5;
    const oat = sim.get('G:ENV_OAT');
    const crewPress = 1850 * (273.15 + oat) / 294.15;
    sim.set('L:OXY_CREW_SUPPLY_OFF', b2n(p.ann && !supply));
    sim.set('S:OXY_CREW_SUPPLY_ON', supply);
    sim.set('S:OXY_CREW_PRESS', Math.round(crewPress));
    // Pax masks: MASK MAN ON (guarded) or cabin altitude > 14 000 ft (± 250 ft).
    const cids = p.dcEss || p.dc1 || p.dc2 || p.dcBat;
    const man = this.edge('OXY_MASK_MAN_ON', sim.get('C:OXY_MASK_MAN_ON')) && cids;
    const auto = sim.get('S:PRESS_CAB_ALT') > 14000 && cids;
    if (man || (auto && !this.paxMasks)) { this.paxMasks = true; this.paxSysOn = true; }
    if (this.edge('MAINT_OXY_TMR_RESET', sim.get('C:MAINT_OXY_TMR_RESET'))) this.paxSysOn = false;
    sim.set('L:OXY_PAX_SYS_ON', b2n(p.ann && this.paxSysOn));
    sim.set('S:OXY_PAX_MASKS', this.paxMasks);
    sim.set('S:OXY_PAX_SYS_ON', this.paxSysOn);
    sim.set('L:OXY_HIGH_ALT_LDG_ON', b2n(p.ann && sim.get('C:OXY_HIGH_ALT_LDG') > 0.5));
    sim.set('L:MAINT_OXY_TMR_RESET_FAULT', 0);
    const mtC = sim.get('C:OXY_MASK_TEST_CAPT') > 0.5 && supply;
    const mtF = sim.get('C:OXY_MASK_TEST_FO') > 0.5 && supply;
    if (this.edge('OXY_MASK_TEST_CAPT', mtC ? 1 : 0)) sim.emit('oxy:mask_test', { side: 'CAPT' });
    if (this.edge('OXY_MASK_TEST_FO', mtF ? 1 : 0)) sim.emit('oxy:mask_test', { side: 'FO' });
    sim.set('S:OXY_MASK_FLOW_CAPT', mtC);
    sim.set('S:OXY_MASK_FLOW_FO', mtF);
  }

  private wipers(c: Ctx): void {
    const { sim, dt, p } = c;
    const sel = [Math.round(sim.get('C:WIPER_CAPT')), Math.round(sim.get('C:WIPER_FO'))]; // 0 OFF, 1 SLOW, 2 FAST
    const pwr = [p.ac1 || p.acEss, p.ac2 || p.ac1];
    for (let i = 0; i < 2; i++) {
      if (!pwr[i]) continue;
      const s = sel[i];
      if (s > 0) this.wiperRate[i] = s === 2 ? 1 / 0.95 : 1 / 1.5;
      let ph = this.wiperPhase[i];
      if (s > 0) ph += this.wiperRate[i] * dt;
      else if (ph % 1 > 1e-9) {
        // park: finish the current cycle
        const next = Math.ceil(ph);
        ph = Math.min(next, ph + (this.wiperRate[i] || 1 / 1.5) * dt);
      }
      if (ph > 1000) ph -= Math.floor(ph);
      this.wiperPhase[i] = ph;
    }
    const pos = (ph: number) => Math.round(((1 - Math.cos(2 * Math.PI * (ph % 1))) / 2) * 1000) / 1000;
    sim.set('S:WIPER_CAPT_POS', pos(this.wiperPhase[0]));
    sim.set('S:WIPER_FO_POS', pos(this.wiperPhase[1]));
    // Rain repellent: one dose per press, inhibited on ground with engines stopped.
    const engRunning = sim.getB('S:ENG1_RUNNING') || sim.getB('S:ENG2_RUNNING');
    const allowed = (p.dc1 || p.dcEss) && (!c.onGround || engRunning);
    const pressC = this.edge('RAIN_RPLNT_CAPT', sim.get('C:RAIN_RPLNT_CAPT'));
    const pressF = this.edge('RAIN_RPLNT_FO', sim.get('C:RAIN_RPLNT_FO'));
    if (pressC && allowed) { this.rplnt[0] = 1.5; sim.emit('rain:rplnt', { side: 'CAPT' }); }
    if (pressF && allowed) { this.rplnt[1] = 1.5; sim.emit('rain:rplnt', { side: 'FO' }); }
    this.rplnt = this.rplnt.map((v) => Math.max(0, v - dt));
    sim.set('S:RAIN_RPLNT_CAPT', this.rplnt[0] > 0);
    sim.set('S:RAIN_RPLNT_FO', this.rplnt[1] > 0);
  }

  private door(c: Ctx): void {
    const { sim, dt, p } = c;
    const cdls = p.dc1 || p.dcEss;
    const sel = Math.round(sim.get('C:DOOR_CKPT')); // 0 UNLOCK (momentary), 1 NORM, 2 LOCK
    if (sel === 0) this.unlockT = 2; else this.unlockT = Math.max(0, this.unlockT - dt);
    // Fail-safe: the electric strikes unlock without power.
    const locked = cdls && this.unlockT <= 0;
    const open = sim.has('G:DOOR_CKPT') ? sim.get('G:DOOR_CKPT') : 0;
    sim.set('S:CKPT_DOOR_LOCKED', locked && open < 0.02);
    sim.set('S:CKPT_DOOR_LOCK_SEL', sel === 2);
    if (sim.has('G:DOOR_CKPT')) sim.set('S:CKPT_DOOR_OPEN', Math.round(open * 1000) / 1000);
    sim.set('L:DOOR_CKPT_OPEN', b2n(p.ann && cdls && open >= 0.02));
    sim.set('L:DOOR_CKPT_FAULT', 0);
    const video = sim.get('C:COCKPIT_DOOR_VIDEO') > 0.5;
    sim.set('L:COCKPIT_DOOR_VIDEO_OFF', b2n(p.ann && !video));
    sim.set('S:CKPT_DOOR_VIDEO_ON', video && (p.ac1 || p.ac2 || p.acEss));
  }

  private misc(c: Ctx): void {
    const { sim, p } = c;
    const ann = p.ann;
    sim.set('S:OVHD_PA_ACTIVE', sim.get('C:OVHD_PA') > 0.5 && (p.dcEss || p.dc1));
    const svce = sim.get('C:MAINT_SVCE_INT_OVRD') > 0.5;
    const avLt = sim.get('C:MAINT_AVIONICS_COMPT_LT') > 0.5;
    sim.set('L:MAINT_SVCE_INT_OVRD_ON', b2n(ann && svce));
    sim.set('L:MAINT_AVIONICS_COMPT_LT_ON', b2n(ann && avLt));
    sim.set('S:SVCE_INT_OVRD', svce);
    sim.set('S:AVNCS_COMPT_LT', avLt && (p.dcEss || p.dc1 || p.acAny));
  }

  private ventilation(c: Ctx): void {
    const { sim, p } = c;
    // Avionics ventilation, cargo AFT ISOL valve and ENG N1 MODE are modelled by sys-air (src/systems/air-eng);
    // sys-misc only provides the avionics smoke detector signal (debug injection).
    sim.set('S:VENT_AVNCS_SMOKE', this.avncsSmoke && (p.dcEss || p.dcBat));
  }
}
