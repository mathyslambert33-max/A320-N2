/**
 * Air conditioning (A320 FCOM DSC-21-20): two packs with their flow control valves (FCV), pack
 * controllers, one zone controller (CKPT / FWD CABIN / AFT CABIN), hot air pressure-regulating valve
 * with trim air valves, recirculation (CAB FANS), emergency RAM AIR inlet, cabin thermal model.
 *
 * Pack flow control valve (pneumatically operated, electrically controlled):
 *  - opens when the PACK pb is ON unless: upstream pressure < 8 psi (valve cannot open), ENG FIRE pb
 *    of the same side released, DITCHING ON, pack overheat, or engine start:
 *      · on ground, both valves close as soon as the ENG MODE selector is at IGN/START and an engine is
 *        not yet started; they reopen 30 s after the 2nd engine N2 exceeds 50 % (the delay avoids a
 *        second closure during the start of the other engine);
 *      · a valve also closes while an engine start valve is open on its side (or on the other side
 *        with the X BLEED valve open) — covers the manual start / dry crank / in-flight starts.
 *  - PACK FAULT light (amber): FCV position disagrees with the commanded position — in particular the
 *    PACK pb ON with no bleed air (inlet pressure < 8 psi for 5 s) → both PACK FAULT lights are lit when
 *    the aircraft is on external power before the APU bleed is ON (as on the real aircraft) — or pack
 *    over-heat. Not lit during the engine-start closure (commanded closed).
 *  - Flow: PACK FLOW LO 80 % / NORM 100 % / HI 120 %; HI is forced when the APU bleed supplies the packs
 *    or in single-pack operation.
 * Zone temperature selectors: 18 °C (COLD) … 24 °C (12 o'clock) … 30 °C (HOT).
 */
import type { Sim } from '../../core/sim';
import type { TimeOfDay } from '../../core/settings';
import {
  acPowered, ac1, ac2, clamp, clamp01, DelayOff, DelayOn, dc1, dc2, engMode, fireReleased, lag, oat, onGround, pbIn,
} from './common';
import type { BleedModel } from './bleed';
import type { Fadec } from './fadec';

/** Pack flow at NORM (kg/s). */
export const PACK_NOMINAL_FLOW = 0.45;
const RECIRC_FLOW = 0.55;

export const ZONES = ['CKPT', 'FWD', 'AFT'] as const;
export type Zone = (typeof ZONES)[number];

export function selectedTemp(pot: number): number {
  return 18 + 12 * clamp01(pot);
}

export class PacksModel {
  valvePos = [0, 0];
  cmdOpen = [false, false];
  flowNorm = [0, 0];
  flowKg = [0, 0];
  factor = [1, 1];
  outTemp: [number, number];
  compTemp: [number, number];
  bypass = [0.5, 0.5];
  fault = [false, false];
  overheat = [false, false];
  startClosed = [false, false];
  private startDelay = [new DelayOff(30), new DelayOff(30)];
  private lowInlet = [new DelayOn(5), new DelayOn(5)];
  private failClosed = [new DelayOn(17), new DelayOn(17)];
  private failOpen = [new DelayOn(30), new DelayOn(30)];

  zoneTemp: [number, number, number];
  ductTemp: [number, number, number];
  trim = [0, 0, 0];
  private integ = [0, 0, 0];
  selTemp = [24, 24, 24];
  hotAirValve = false;
  hotAirFault = false;
  ramAirValve = false;
  cabFansOn = false;
  /** Fresh + recirculated flow into the cabin (kg/s), for the pressurisation model. */
  freshFlow = 0;
  ramFlow = 0;
  /** Failure injection. */
  failPackOverheat = [false, false];
  failDuctOverheat = false;

  constructor(oatC: number, private tod: () => TimeOfDay) {
    this.outTemp = [oatC, oatC];
    this.compTemp = [oatC, oatC];
    const s = PacksModel.solar(tod());
    this.zoneTemp = [oatC + s.ckpt * 0.55, oatC + s.cab * 0.55, oatC + s.cab * 0.6];
    this.ductTemp = [...this.zoneTemp];
  }

  /** Equivalent temperature rise from sun + internal loads (°C) for the cockpit and the cabin. */
  static solar(tod: TimeOfDay): { ckpt: number; cab: number } {
    return tod === 'day' ? { ckpt: 6.5, cab: 4.5 } : tod === 'dusk' ? { ckpt: 2, cab: 1.5 } : { ckpt: 0.3, cab: 0.5 };
  }

  update(sim: Sim, dt: number, bleed: BleedModel, eng: [Fadec, Fadec], ditching: boolean, cabDeltaP: number): void {
    const t = oat(sim);
    const gnd = onGround(sim);
    const mode = engMode(sim);
    const xOpen = bleed.xbleedPos > 0.5;
    const bothStarted = eng[0].runningOrStarted() && eng[1].runningOrStarted();
    const sel = Math.round(sim.has('C:AIR_PACK_FLOW') ? sim.get('C:AIR_PACK_FLOW') : 1);
    const selFactor = sel === 0 ? 0.8 : sel === 2 ? 1.2 : 1.0;

    /* ---------------- pack flow control valves ---------------- */
    for (const i of [0, 1] as const) {
      const n = (i + 1) as 1 | 2;
      const pb = pbIn(sim, `AIR_PACK${n}`);
      const powered = n === 1 ? dc1(sim) || ac1(sim) : dc2(sim) || ac2(sim);
      const startRaw = (gnd && mode === 2 && !bothStarted) || eng[i].startInProgress() || (xOpen && eng[1 - i].startInProgress());
      this.startClosed[i] = this.startDelay[i].update(startRaw, dt);
      if (this.failPackOverheat[i] && this.valvePos[i] > 0.5) this.overheat[i] = true;
      if (this.compTemp[i] > 230 || this.outTemp[i] > 95) this.overheat[i] = true;
      if (this.overheat[i] && !pb && !this.failPackOverheat[i] && this.compTemp[i] < 200) this.overheat[i] = false;
      const allowed = pb && powered && !fireReleased(sim, n) && !ditching && !this.overheat[i];
      this.cmdOpen[i] = allowed && !this.startClosed[i];
      const inlet = bleed.press[i];
      const target = this.cmdOpen[i] && inlet >= 8 ? 1 : 0;
      this.valvePos[i] = lag(this.valvePos[i], target, 0.8, dt);
      if (Math.abs(this.valvePos[i] - target) < 0.01) this.valvePos[i] = target;
      const low = this.lowInlet[i].update(this.cmdOpen[i] && inlet < 8, dt);
      const fc = this.failClosed[i].update(this.cmdOpen[i] && this.valvePos[i] < 0.5, dt);
      const fo = this.failOpen[i].update(!this.cmdOpen[i] && this.valvePos[i] > 0.5, dt);
      this.fault[i] = powered && (low || fc || fo || this.overheat[i]);
    }
    const open = [this.valvePos[0] > 0.5, this.valvePos[1] > 0.5];
    for (const i of [0, 1] as const) {
      let f = selFactor;
      if (bleed.apuValve) f = 1.2; // APU bleed supply: HI flow
      if (open[i] !== open[1 - i]) f = 1.2; // single pack operation
      this.factor[i] = f;
      const inletFrac = clamp01(bleed.press[i] / 12);
      this.flowNorm[i] = f * this.valvePos[i] * inletFrac;
      this.flowKg[i] = PACK_NOMINAL_FLOW * this.flowNorm[i];
      bleed.packDemand[i] = PACK_NOMINAL_FLOW * f * this.valvePos[i];
    }

    /* ---------------- zone controller ---------------- */
    const ctlPowered = acPowered(sim) || dc1(sim) || dc2(sim);
    const pots = ['AIR_TEMP_CKPT', 'AIR_TEMP_FWD', 'AIR_TEMP_AFT'];
    for (let z = 0; z < 3; z++) this.selTemp[z] = selectedTemp(sim.has(`C:${pots[z]}`) ? sim.get(`C:${pots[z]}`) : 0.5);
    const freshKg = this.flowKg[0] + this.flowKg[1];
    this.freshFlow = freshKg;

    // Hot air pressure regulating valve: opens with the HOT AIR pb ON and at least one pack operating.
    const hotPb = pbIn(sim, 'AIR_HOT_AIR');
    if (this.failDuctOverheat || this.ductTemp.some((d) => d > 88)) this.hotAirFault = true;
    if (this.hotAirFault && !hotPb && !this.failDuctOverheat && this.ductTemp.every((d) => d < 70)) this.hotAirFault = false;
    this.hotAirValve = hotPb && ctlPowered && !this.hotAirFault && (open[0] || open[1]);

    const dd = [0, 0, 0];
    for (let z = 0; z < 3; z++) {
      const e = this.selTemp[z] - this.zoneTemp[z];
      if (freshKg > 0.05) this.integ[z] = clamp(this.integ[z] + 0.004 * e * dt, -12, 12);
      dd[z] = clamp(this.selTemp[z] + 3.5 * e + this.integ[z], 2, 70);
    }
    const packDemandTemp = this.hotAirValve ? Math.min(dd[0], dd[1], dd[2]) : (dd[0] + dd[1] + dd[2]) / 3;

    /* ---------------- packs thermodynamics ---------------- */
    for (const i of [0, 1] as const) {
      const flowing = this.flowNorm[i] > 0.05;
      if (flowing) {
        const maxOut = Math.max(5, Math.min(70, bleed.temp[i] - 20));
        const tgt = clamp(packDemandTemp, 2, maxOut);
        this.outTemp[i] = lag(this.outTemp[i], tgt, 12, dt);
        this.bypass[i] = lag(this.bypass[i], clamp01((this.outTemp[i] - 2) / 68), 3, dt);
        const comp = t + 40 + 90 * (1 - this.bypass[i]) * Math.sqrt(this.factor[i]) + 0.15 * (bleed.temp[i] - 180);
        this.compTemp[i] = lag(this.compTemp[i], comp, 20, dt);
      } else {
        this.outTemp[i] = lag(this.outTemp[i], t, 240, dt);
        this.compTemp[i] = lag(this.compTemp[i], t, 300, dt);
      }
    }

    /* ---------------- recirculation, ram air, mixer ---------------- */
    this.cabFansOn = pbIn(sim, 'VENT_CAB_FANS') && acPowered(sim);
    this.ramAirValve = pbIn(sim, 'AIR_RAM_AIR') && !ditching && (dc1(sim) || dc2(sim) || acPowered(sim));
    this.ramFlow = this.ramAirValve && !gnd && cabDeltaP < 1 ? 0.35 : 0;
    const recirc = this.cabFansOn ? RECIRC_FLOW : 0;
    const w = [0.1, 0.45, 0.45];
    const cabAvg = w[0] * this.zoneTemp[0] + w[1] * this.zoneTemp[1] + w[2] * this.zoneTemp[2];
    const tFresh = freshKg > 0.01 ? (this.flowKg[0] * this.outTemp[0] + this.flowKg[1] * this.outTemp[1]) / freshKg : t;
    const qIn = freshKg + this.ramFlow;
    const tIn = qIn > 0.01 ? (freshKg * tFresh + this.ramFlow * t) / qIn : t;
    const qTot = qIn + recirc;
    const tMix = qTot > 0.01 ? (qIn * tIn + recirc * cabAvg) / qTot : cabAvg;

    /* ---------------- zones ---------------- */
    const s = PacksModel.solar(this.tod());
    const doorL1 = sim.get('G:DOOR_PAX_L1');
    const doorsOpen = Math.max(doorL1, sim.get('G:DOOR_PAX_R1'), sim.get('G:DOOR_PAX_L2'), sim.get('G:DOOR_PAX_R2'));
    const ckptDoor = sim.has('G:DOOR_CKPT') ? sim.get('G:DOOR_CKPT') : 1;
    const avionicsHeat = acPowered(sim) ? 1.5 : 0;
    const envEq = [t + s.ckpt + avionicsHeat, t + s.cab, t + s.cab * 1.05];
    const tauEnv = [2600 - 900 * ckptDoor * doorL1, 3000 - 1700 * doorsOpen, 3200 - 1000 * doorsOpen];
    const tauFlow = [200, 480, 480];
    const flowFrac = (freshKg + this.ramFlow + recirc * 0.35) / (2 * PACK_NOMINAL_FLOW + RECIRC_FLOW * 0.35);
    for (let z = 0; z < 3; z++) {
      this.trim[z] = this.hotAirValve && freshKg > 0.05 ? lag(this.trim[z], clamp01((dd[z] - tMix) / 35), 4, dt) : lag(this.trim[z], 0, 2, dt);
      const ductTarget = qTot > 0.02 ? tMix + this.trim[z] * 35 * clamp01(freshKg / 0.4) : this.zoneTemp[z];
      this.ductTemp[z] = lag(this.ductTemp[z], ductTarget, 6, dt);
      const dT = ((this.ductTemp[z] - this.zoneTemp[z]) * flowFrac) / tauFlow[z] + (envEq[z] - this.zoneTemp[z]) / Math.max(400, tauEnv[z]);
      this.zoneTemp[z] += dT * dt;
    }
    // Cockpit / cabin exchange through the open cockpit door.
    if (ckptDoor > 0.2) {
      const k = (dt / 900) * ckptDoor;
      const d = (this.zoneTemp[1] - this.zoneTemp[0]) * k;
      this.zoneTemp[0] += d;
      this.zoneTemp[1] -= d * 0.15;
    }
  }

  publish(sim: Sim): void {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    sim.set('S:PACK1_VALVE', this.valvePos[0] > 0.5 ? 1 : 0);
    sim.set('S:PACK2_VALVE', this.valvePos[1] > 0.5 ? 1 : 0);
    sim.set('S:PACK1_FLOW', Math.round(this.flowNorm[0] * 1000) / 1000);
    sim.set('S:PACK2_FLOW', Math.round(this.flowNorm[1] * 1000) / 1000);
    sim.set('S:PACK1_OUT_TEMP', r1(this.outTemp[0]));
    sim.set('S:PACK2_OUT_TEMP', r1(this.outTemp[1]));
    sim.set('S:PACK1_COMP_TEMP', r1(this.compTemp[0]));
    sim.set('S:PACK2_COMP_TEMP', r1(this.compTemp[1]));
    sim.set('S:PACK1_BYPASS', Math.round(this.bypass[0] * 100) / 100);
    sim.set('S:PACK2_BYPASS', Math.round(this.bypass[1] * 100) / 100);
    sim.set('S:PACK1_FAULT', this.fault[0] ? 1 : 0);
    sim.set('S:PACK2_FAULT', this.fault[1] ? 1 : 0);
    sim.set('S:PACK1_START_CLOSED', this.startClosed[0] ? 1 : 0);
    sim.set('S:PACK2_START_CLOSED', this.startClosed[1] ? 1 : 0);
    sim.set('S:COND_CKPT_TEMP', r1(this.zoneTemp[0]));
    sim.set('S:COND_FWD_TEMP', r1(this.zoneTemp[1]));
    sim.set('S:COND_AFT_TEMP', r1(this.zoneTemp[2]));
    sim.set('S:COND_CKPT_DUCT', r1(this.ductTemp[0]));
    sim.set('S:COND_FWD_DUCT', r1(this.ductTemp[1]));
    sim.set('S:COND_AFT_DUCT', r1(this.ductTemp[2]));
    sim.set('S:COND_CKPT_TRIM', Math.round(this.trim[0] * 100) / 100);
    sim.set('S:COND_FWD_TRIM', Math.round(this.trim[1] * 100) / 100);
    sim.set('S:COND_AFT_TRIM', Math.round(this.trim[2] * 100) / 100);
    sim.set('S:COND_CKPT_SEL', r1(this.selTemp[0]));
    sim.set('S:COND_FWD_SEL', r1(this.selTemp[1]));
    sim.set('S:COND_AFT_SEL', r1(this.selTemp[2]));
    sim.set('S:COND_HOT_AIR_VALVE', this.hotAirValve ? 1 : 0);
    sim.set('S:COND_HOT_AIR_FAULT', this.hotAirFault ? 1 : 0);
    sim.set('S:COND_RAM_AIR_VALVE', this.ramAirValve ? 1 : 0);
    sim.set('S:VENT_CAB_FANS_ON', this.cabFansOn ? 1 : 0);
  }
}
