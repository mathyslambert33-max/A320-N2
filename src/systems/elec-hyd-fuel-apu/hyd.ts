/**
 * A320 hydraulics (FCOM DSC-29): GREEN (ENG 1 pump), BLUE (electric pump, RAT), YELLOW (ENG 2 pump,
 * electric pump, hand pump for the cargo doors), bidirectional PTU G↔Y. DOM-free.
 *
 *  - EDP: pressurises when the ENG PUMP pb is ON (the solenoid depressurises the pump when OFF; no
 *    power → pump pressurises), the hydraulic fire shut-off valve is open (ENG FIRE pb in) and N2 turns.
 *  - BLUE ELEC PUMP (AC BUS 1), AUTO: runs in flight, or on ground when one engine is running, or with
 *    BLUE PUMP OVRD ON (maintenance panel).
 *  - YELLOW ELEC PUMP (AC BUS 2): pb ON, or automatically during cargo door operation (then PTU
 *    inhibited during the operation and 40 s after).
 *  - PTU (AUTO): runs when |ΔP G−Y| > 500 psi, stops below ≈ 90 psi. Inhibited on ground when one ENG
 *    MASTER is ON and the other OFF with the parking brake ON or the NWS towing pin inserted — hence the
 *    "barking dog" at the second engine start or when the parking brake is released with one engine
 *    running. When the system it feeds has no pump of its own, leakage makes the PTU cycle (barks).
 *  - Low-pressure FAULTs: EDP / BLUE inhibited on ground when the engine oil pressure is low (engine not
 *    running); YELLOW elec pump FAULT only when the pump is commanded and powered.
 *  - RAT: RAT MAN ON (HYD or EMER ELEC panel, HOT BUS powered) or automatic when AC BUS 1+2 are lost
 *    above 100 kt; pressurises BLUE only with airflow (> 100 kt).
 * Values: 3000 psi nominal, low-pressure switches 1450/1750 psi (hysteresis), EDP section 1740/2200.
 * Reservoirs (normal level, gear down): G ≈ 14 L, B ≈ 6 L, Y ≈ 12.5 L (FlyByWire A32NX data).
 */
import type { Sim } from '../../core/sim';
import { clamp, lag, approach } from '../../core/sim';
import type { Model } from './model';
import {
  DelayOff, PressWatcher, Wander, airspeed, engMasterOn, engN2, engOilLow, engRunning, fireReleased, onGround,
  parkBrakeOn, pbIn,
} from './common';

type Sys = 'G' | 'B' | 'Y';
const SYS: Sys[] = ['G', 'B', 'Y'];

export class HydModel {
  press: Record<Sys, number> = { G: 0, B: 0, Y: 0 };
  qty: Record<Sys, number>;
  private baseQty: Record<Sys, number>;
  /** Pump outlet delivering (for SD HYD / ECAM). */
  edpOn: [boolean, boolean] = [false, false];
  bPumpOn = false;
  yPumpOn = false;
  bPumpSpeed = 0;
  yPumpSpeed = 0;
  ptuActive = false;
  ptuDir = 0;
  ptuEnabled = true;
  ratPos = 0;
  ratCmd = false;
  fireValveOpen: [boolean, boolean] = [true, true];
  /** Yellow flow capacity available this tick (used by the brake accumulator). */
  yCap = 0;
  cargoDoorPump = false;
  // fault flags (for lights)
  edpFault: [boolean, boolean] = [false, false];
  bFault = false;
  yFault = false;
  ptuFault = false;
  private lowHyst: Record<string, boolean> = { E1: true, E2: true, B: true, Y: true };
  private ptuDeact: number;
  private ptuAct: number;
  private ptuCargoInhibit = new DelayOff(40);
  private cargoHold = 0;
  private lastDoor = [0, 0];
  private ratPress!: [PressWatcher, PressWatcher];
  private w: Wander[];

  constructor(private m: Model) {
    const r = m.rng;
    this.baseQty = { G: 13.8 + 0.4 * r(), B: 5.8 + 0.3 * r(), Y: 12.4 + 0.4 * r() };
    this.qty = { ...this.baseQty };
    this.ptuAct = 500 + 10 * (r() - 0.5);
    this.ptuDeact = 90 + 30 * (r() - 0.5);
    this.w = [0, 1, 2].map(() => new Wander(r, 1.2));
  }

  init(sim: Sim): void {
    this.ratPress = [new PressWatcher(sim, 'HYD_RAT_MAN_ON'), new PressWatcher(sim, 'EMER_ELEC_RAT_MAN_ON')];
    this.lastDoor = [sim.get('G:DOOR_CARGO_FWD'), sim.get('G:DOOR_CARGO_AFT')];
  }

  update(dt: number, sim: Sim): void {
    const m = this.m;
    const e = m.elec;
    const gnd = onGround(sim);
    const spd = airspeed(sim);
    const n2 = [engN2(sim, 1), engN2(sim, 2)];
    const running = [engRunning(sim, 1), engRunning(sim, 2)];

    // ---------------- fire shut-off valves (DC ESS / DC 2 motors) ----------------
    for (let i = 0; i < 2; i++) {
      const released = fireReleased(sim, i === 0 ? 'FIRE_ENG1_PB' : 'FIRE_ENG2_PB');
      if (e.dcEss || e.dc2) this.fireValveOpen[i] = !released;
    }

    // ---------------- cargo door operation (yellow elec pump auto) ----------------
    const doors = [sim.get('G:DOOR_CARGO_FWD'), sim.get('G:DOOR_CARGO_AFT')];
    let doorStep = 0;
    let doorMoving = false;
    for (let i = 0; i < 2; i++) {
      const d = Math.abs(doors[i] - this.lastDoor[i]);
      if (d > 0) { doorMoving = true; doorStep = Math.max(doorStep, d); }
      this.lastDoor[i] = doors[i];
    }
    // A door step (instant change) = one full door cycle (~15 s of pump run); continuous motion = while moving + 3 s.
    if (doorStep >= 0.5) this.cargoHold = Math.max(this.cargoHold, 15);
    else if (doorMoving) this.cargoHold = Math.max(this.cargoHold, 3);
    this.cargoHold = Math.max(0, this.cargoHold - dt);
    const cargoOp = this.cargoHold > 0;
    this.ptuCargoInhibit.update(cargoOp, dt);

    // ---------------- pumps ----------------
    const yPb = pbIn(sim, 'HYD_YELLOW_ELEC_PUMP');
    const yPowered = e.ac2 || (cargoOp && e.acGndFlt);
    const yCmd = yPb || cargoOp;
    this.yPumpOn = yCmd && yPowered;
    this.yPumpSpeed = approach(this.yPumpSpeed, this.yPumpOn ? 1 : 0, this.yPumpOn ? 2.5 : 0.7, dt);
    this.cargoDoorPump = cargoOp && this.yPumpOn && !yPb;

    const bAuto = pbIn(sim, 'HYD_BLUE_ELEC_PUMP');
    const ovrd = pbIn(sim, 'MAINT_BLUE_PUMP_OVRD');
    const bCmd = bAuto && (!gnd || running[0] || running[1] || ovrd);
    this.bPumpOn = bCmd && e.ac1;
    this.bPumpSpeed = approach(this.bPumpSpeed, this.bPumpOn ? 1 : 0, this.bPumpOn ? 2.5 : 0.7, dt);

    const edpCap = [0, 1].map((i) => {
      const pb = pbIn(sim, i === 0 ? 'HYD_ENG1_PUMP' : 'HYD_ENG2_PUMP');
      const solenoidPowered = i === 0 ? e.dc1 || e.dcEss : e.dc2 || e.dcEss;
      const pressurise = (pb || !solenoidPowered) && this.fireValveOpen[i];
      return pressurise ? 1.6 * clamp((n2[i] - 6) / 14, 0, 1) : 0;
    });

    // ---------------- RAT ----------------
    const hotPwr = e.hot1 || e.hot2;
    const manRat = this.ratPress[0].consume() || this.ratPress[1].consume();
    if (manRat && hotPwr) this.ratCmd = true;
    if (!e.ac1 && !e.ac2 && spd > 100 && !gnd) this.ratCmd = true;
    this.ratPos = approach(this.ratPos, this.ratCmd ? 1 : this.ratPos, 1 / 4, dt);
    const ratCap = this.ratPos >= 1 ? 0.8 * clamp((spd - 100) / 40, 0, 1) : 0;

    // ---------------- capacities ----------------
    const cap: Record<Sys, number> = {
      G: edpCap[0],
      B: this.bPumpSpeed * 0.55 + ratCap,
      Y: edpCap[1] + this.yPumpSpeed * 0.55,
    };

    // ---------------- PTU ----------------
    const ptuPb = pbIn(sim, 'HYD_PTU');
    const m1 = engMasterOn(sim, 1);
    const m2 = engMasterOn(sim, 2);
    const pin = sim.getB('G:GND_TOWBAR');
    const ptuCtlPowered = e.dcGndFlt;
    const enableIfPowered = ptuPb && (!gnd || (m1 && m2) || (!m1 && !m2) || (!parkBrakeOn(sim) && !pin)) &&
      !(this.ptuCargoInhibit.out && !yPb);
    this.ptuEnabled = ptuPb && (!ptuCtlPowered || enableIfPowered);
    const dP = this.press.G - this.press.Y;
    if (this.ptuEnabled && this.qty.G > 3 && this.qty.Y > 3) {
      if (!this.ptuActive && Math.abs(dP) > this.ptuAct && Math.max(this.press.G, this.press.Y) > 1200) {
        this.ptuActive = true;
        this.ptuDir = dP > 0 ? 1 : -1;
      } else if (this.ptuActive && (Math.abs(dP) < this.ptuDeact || Math.sign(dP) !== this.ptuDir)) {
        this.ptuActive = false;
      }
    } else this.ptuActive = false;
    if (!this.ptuActive) this.ptuDir = 0;
    const ptuTo: Sys | '' = this.ptuActive ? (this.ptuDir > 0 ? 'Y' : 'G') : '';
    const ptuFrom: Sys | '' = this.ptuActive ? (this.ptuDir > 0 ? 'G' : 'Y') : '';

    // ---------------- pressures ----------------
    const accu = m.brk.accuPress;
    for (const s of SYS) {
      let c = cap[s];
      let target = 3000;
      if (s === ptuTo) {
        const high = this.press[ptuFrom as Sys];
        c += 1.4 * clamp(high / 3000, 0, 1);
        if (cap[s] < 0.05) target = high - 40;
      }
      if (s === ptuFrom && cap[s] < 1.2) target = 3000 - 280 * (1 - cap[s] / 1.2);
      // An elec pump alone cannot outrun the brake accumulator filling (Y)
      if (s === 'Y' && accu > 0 && accu < this.press.Y + 50 && cap.Y < 1) target = Math.min(target, Math.max(accu + 250, 1200));
      if (c > 0.01) {
        this.press[s] += (target - this.press[s]) * (1 - Math.exp(-dt * 2.2 * c));
      } else {
        // No supply: leakage through the servo-valves; accumulators slow the decay near the precharge.
        const tau = this.press[s] > 1900 ? 12 : 5;
        this.press[s] = Math.max(0, this.press[s] - (this.press[s] / tau) * dt);
      }
    }
    this.yCap = cap.Y + (ptuTo === 'Y' ? 1.4 * clamp(this.press.G / 3000, 0, 1) : 0);

    this.edpOn = [edpCap[0] > 0.3 && this.press.G > 1740, edpCap[1] > 0.3 && this.press.Y > 1740];

    // ---------------- reservoirs ----------------
    const accuFluidL = m.brk.accuFluidGal * 3.785;
    this.qty.G = lag(this.qty.G, this.baseQty.G - 0.7 * (this.press.G / 3000), 4, dt);
    this.qty.B = lag(this.qty.B, this.baseQty.B - 0.5 * (this.press.B / 3000), 4, dt);
    this.qty.Y = lag(this.qty.Y, this.baseQty.Y - 0.7 * (this.press.Y / 3000) - accuFluidL + 1.9, 4, dt);

    // ---------------- faults ----------------
    const hyst = (k: string, p: number, lo: number, hi: number) => {
      if (p > hi) this.lowHyst[k] = false;
      else if (p < lo) this.lowHyst[k] = true;
      return this.lowHyst[k];
    };
    for (let i = 0; i < 2; i++) {
      const pb = pbIn(sim, i === 0 ? 'HYD_ENG1_PUMP' : 'HYD_ENG2_PUMP');
      const sectionP = edpCap[i] > 0.05 ? this.press[i === 0 ? 'G' : 'Y'] * clamp(edpCap[i] / 0.4, 0, 1) : 0;
      const low = hyst(i === 0 ? 'E1' : 'E2', sectionP, 1740, 2200) && pb;
      const inhibit = engOilLow(sim, i + 1) && gnd;
      this.edpFault[i] = low && !inhibit;
    }
    const bLow = hyst('B', this.bPumpOn ? this.press.B * this.bPumpSpeed : 0, 1450, 1750) && this.bPumpOn;
    this.bFault = bLow && !(engOilLow(sim, 1) && engOilLow(sim, 2) && gnd && !ovrd);
    this.yFault = hyst('Y', this.press.Y, 1450, 1750) && this.yPumpOn && this.yPumpSpeed > 0.9;
    this.ptuFault = false;

    // elec loads
    e.extraAc.AC2 += this.yPumpOn ? 1.6 + 4.2 * this.yPumpSpeed * clamp(1 - this.press.Y / 3000 + (ptuFrom === 'Y' ? 0.5 : 0), 0.15, 1) : 0;
    e.extraAc.AC1 += this.bPumpOn ? 1.5 + 3.5 * this.bPumpSpeed * clamp(1 - this.press.B / 3000, 0.15, 1) : 0;

    this.publish(sim);
  }

  private publish(sim: Sim): void {
    const set = (k: string, v: number | boolean) => sim.set(k, v);
    const w = this.w.map((x) => x.step(1 / 30));
    SYS.forEach((k, i) => {
      const p = this.press[k];
      set(`S:HYD_${k}_PRESS`, Math.round(p > 2500 ? p + 6 * w[i] : p));
      set(`S:HYD_${k}_QTY`, Math.round(this.qty[k] * 100) / 100);
      set(`S:HYD_${k}_RSVR_LO_LVL`, this.qty[k] < (k === 'B' ? 2 : 3));
      set(`S:HYD_${k}_RSVR_OVHT`, 0);
      set(`S:HYD_${k}_RSVR_LO_AIR`, 0);
      set(`S:HYD_${k}_LEAK_VALVE`, pbIn(sim, `MAINT_HYD_LEAK_${k}`));
    });
    set('S:HYD_PTU_ACTIVE', this.ptuActive);
    set('S:HYD_PTU_DIR', this.ptuDir);
    set('S:HYD_PTU_ENABLED', this.ptuEnabled);
    set('S:HYD_Y_ELEC_PUMP_ON', this.yPumpOn);
    set('S:HYD_B_ELEC_PUMP_ON', this.bPumpOn);
    set('S:HYD_Y_ELEC_PUMP_CARGO', this.cargoDoorPump);
    set('S:HYD_ENG1_PUMP_ON', this.edpOn[0]);
    set('S:HYD_ENG2_PUMP_ON', this.edpOn[1]);
    set('S:HYD_ENG1_PUMP_LO_PR', this.edpFault[0]);
    set('S:HYD_ENG2_PUMP_LO_PR', this.edpFault[1]);
    set('S:HYD_B_ELEC_PUMP_LO_PR', this.bFault);
    set('S:HYD_Y_ELEC_PUMP_LO_PR', this.yFault);
    set('S:HYD_G_FIRE_VALVE', this.fireValveOpen[0]);
    set('S:HYD_Y_FIRE_VALVE', this.fireValveOpen[1]);
    set('S:HYD_RAT_DEPLOYED', Math.round(this.ratPos * 1000) / 1000);
  }
}
