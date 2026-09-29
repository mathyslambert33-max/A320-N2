/**
 * APU — Hamilton Sundstrand (Pratt & Whitney) APS 3200, the standard APU of the A320ceo family.
 * FCOM DSC-49. DOM-free.
 *
 * Sequence (MASTER SW ON → START):
 *  - MASTER SW ON: ECB powered (DC BAT bus) and self-test, air intake flap opens (8-13 s travel),
 *    APU LP fuel valve opens (fuel.ts), APU fuel pump runs if no tank pump pressure.
 *  - START: blue ON light; the starter (DC BAT bus, both battery contactors closed) is energised
 *    only when the flap is fully open; ignition 1.5 s later; light-off ≈ 10 % N; EGT peak
 *    ≈ 700-760 °C around 40-45 % N; starter cut-out at 55 % N; AVAIL 2 s after N > 95 % (or N > 99.5 %)
 *    ≈ 46 s after the starter engaged; ON goes out, AVAIL green. Stabilised N 100 %, EGT ≈ 340-350 °C
 *    (+10-15 °C with APU GEN load, up to +90 °C with bleed demand).
 *    N(t), EGT(N) and the run-down N(t) use the polynomial fits of recorded APS 3200 data published
 *    by the FlyByWire A32NX project (APS3200.md).
 *  - MASTER SW OFF: if the APU bleed was used during the previous 60 s, cooling run for 60 s
 *    (APU still AVAIL, APU GEN still supplying), then fuel shut-off, run-down (≈ 50 s to 0 %), flap
 *    closes at N < 7 %. A new start is only possible once N = 0.
 *  - Automatic shutdown (MASTER SW FAULT light): APU fire on ground, APU FIRE pb released, DC power
 *    loss during start, no fuel pressure, no light-off / slow start, EGT over-temperature.
 */
import type { Sim } from '../../core/sim';
import { clamp, lag, approach } from '../../core/sim';
import type { Model } from './model';
import { PressWatcher, Wander, fireReleased, onGround, oat, pbIn } from './common';

const START_N = [-0.08013606018640967, 2.129832736394534, 3.928273438786404, -1.88613299921213, 0.42749452749180916,
  -0.05757707967690426, 0.005022142795451004, -0.00029612873626050866, 0.00001204152497871946, -0.00000033829604438116,
  0.00000000645140818528, -0.00000000007974743535, 0.00000000000057654695, -0.00000000000000185126];
const START_EGT = [-92.3417137705543, -14.36417426895237, 12.210567963472547, -3.005504263233662, 0.3808066398934025,
  -0.02679731462093699, 0.001163901295794232, -0.0000332668380497951, 0.00000064601180727581, -0.00000000859285727074,
  0.00000000007717119413, -0.00000000000044761099, 0.00000000000000151429, -0.00000000000000000227];
const STOP_N = [100.22975364965701, -24.692008355859773, 2.6116524551318787, 0.006812541903222142, -0.03134644787752123,
  0.0036345606954833213, -0.00021794252200618456, 0.00000798097055109138, -0.00000018481154462604, 0.00000000264691628669,
  -0.00000000002143677577, 0.00000000000007515448];
const poly = (c: number[], x: number) => {
  let r = 0;
  let p = 1;
  for (const k of c) { r += k * p; p *= x; }
  return r;
};
/** N (%) vs seconds since ignition (valid 0..45.12 s). */
const startN = (t: number) => (t <= 0 ? 0 : clamp(poly(START_N, Math.min(t, 45.12)), 0, 100));
/** Run-down N (%) vs seconds since fuel cut from 100 % (valid 0..49.4 s). */
const stopN = (t: number) => clamp(poly(STOP_N, Math.min(t, 49.411)), 0, 100);

export type ApuState = 'off' | 'starting' | 'running' | 'stopping';
export type ApuFault = '' | 'FIRE' | 'DC_POWER' | 'FUEL_PRESS' | 'NO_LIGHT_OFF' | 'SLOW_START' | 'EGT_OVERTEMP';

export class ApuModel {
  state: ApuState = 'off';
  n = 0;
  egt = 15;
  /** Air intake flap 0 closed .. 1 open. */
  flap = 0;
  available = false;
  genAvailable = false;
  /** START pb ON light (start requested / in progress). */
  startOn = false;
  fault: ApuFault = '';
  ecbOn = false;
  bleedValvePos = 0;
  bleedPress = 0;
  fuelFlow = 0;
  fuelUsed = 0;
  starterDemandA = 0;
  cooldownLeft = 0;
  masterWasOn = false;
  /** ECB command to the APU LP fuel valve (MASTER SW ON, kept open during the cooling run). */
  lpValveCmd = false;

  private flapTravel: number;
  private since = 0; // s since starter engaged
  private stopT = 0;
  private stopFactor = 1;
  private nAbove95 = 0;
  private bleedClosedFor = 1e9;
  private starterUnpowered = 0;
  private noFuel = 0;
  private lit = false;
  private egtPeakScale: number;
  private egtBase: number;
  private egtLoad = 0;
  private ecbTest = 0;
  private startPress!: PressWatcher;
  private wn: Wander;
  private we: Wander;

  constructor(private m: Model) {
    const r = m.rng;
    this.flapTravel = 8 + 5 * r();
    this.egtPeakScale = 0.97 + 0.08 * r();
    this.egtBase = 338 + 12 * r();
    this.wn = new Wander(r, 1.5);
    this.we = new Wander(r, 4);
  }

  init(sim: Sim): void {
    this.startPress = new PressWatcher(sim, 'APU_START');
    this.egt = oat(sim);
  }

  /** Force a running APU (scenario presets). */
  setRunning(sim: Sim): void {
    this.state = 'running';
    this.n = 100;
    this.flap = 1;
    this.egt = this.egtBase + 12;
    this.egtLoad = this.egt;
    this.available = true;
    this.genAvailable = true;
    this.startOn = false;
    this.fault = '';
    this.masterWasOn = true;
    this.lit = true;
    sim.set('C:APU_MASTER', 1);
  }

  update(dt: number, sim: Sim): void {
    const m = this.m;
    const master = pbIn(sim, 'APU_MASTER');
    const firePb = fireReleased(sim, 'FIRE_APU_PB');
    const fireGround = sim.getB('S:FIRE_APU_DET') && onGround(sim) && !sim.getB('S:FIRE_APU_TEST');
    const bleedPb = pbIn(sim, 'AIR_APU_BLEED');
    const dcPowered = m.elec.dcBat;
    const powered = dcPowered || this.n > 70;
    const T = oat(sim);

    // ECB on / self-test
    const wasOn = this.ecbOn;
    this.ecbOn = powered && (master || this.flap > 0.001 || this.state !== 'off');
    if (this.ecbOn && !wasOn) this.ecbTest = 2.5;
    this.ecbTest = Math.max(0, this.ecbTest - dt);
    if (!this.ecbOn) this.fault = '';

    // Faults that force an emergency / automatic shutdown
    if (this.ecbOn || this.state !== 'off') {
      if (firePb || fireGround) this.setFault('FIRE');
    }

    // START pb (momentary, ON light latched by the ECB)
    const pressed = this.startPress.consume();
    if (pressed && master && this.ecbOn && !this.fault && !this.available) this.startOn = true;

    // MASTER SW OFF: cooling period if bleed used in the last 60 s
    if (!master && this.masterWasOn && (this.state === 'running' || this.state === 'starting')) {
      if (this.state === 'running' && this.bleedClosedFor < 60 && !this.fault) this.cooldownLeft = 60;
      else this.beginStop();
    }
    if (master && this.cooldownLeft > 0) this.cooldownLeft = 0; // back ON during the cooling run: keeps running
    this.masterWasOn = master;

    // ---------------- turbine state machine ----------------
    this.starterDemandA = 0;
    switch (this.state) {
      case 'off': {
        this.n = 0;
        if (this.ecbOn && master && this.startOn && this.flap >= 1 && !this.fault && this.ecbTest <= 0) {
          this.state = 'starting';
          this.since = 0;
          this.lit = false;
          this.nAbove95 = 0;
          this.starterUnpowered = 0;
          this.noFuel = 0;
          this.fuelUsed = 0;
          sim.emit('apu:start');
        }
        break;
      }
      case 'starting': {
        const starterCmd = this.n < 55 && !this.fault;
        if (starterCmd) {
          // DC starter: inrush then ~600 A falling to ~150 A at cut-out (55 % N)
          this.starterDemandA = (this.since < 0.4 ? 900 : 150 + 450 * (1 - this.n / 55)) * (0.97 + 0.03 * this.wn.v);
          if (!m.elec.starterPowered) this.starterUnpowered += dt;
          else this.starterUnpowered = 0;
          if (this.starterUnpowered > 0.6) { this.setFault('DC_POWER'); break; }
        }
        const advancing = !starterCmd || m.elec.starterPowered;
        if (advancing) {
          // Low voltage on the starter (BAT-only start) slows the acceleration slightly.
          const vFactor = starterCmd ? clamp((m.elec.vDcBat - 14) / 11, 0.55, 1.05) : 1;
          this.since += dt * vFactor;
        }
        const t = this.since - 1.5; // ignition 1.5 s after the starter
        const nNew = startN(t);
        this.n = Math.max(this.n, nNew);
        const fuelOk = sim.getB('S:FUEL_APU_FEED');
        if (t > 0) {
          if (!fuelOk) this.noFuel += dt;
          else this.noFuel = 0;
          if (this.noFuel > 4) { this.setFault(this.lit ? 'FUEL_PRESS' : 'NO_LIGHT_OFF'); break; }
        }
        // EGT: follows the recorded curve once light-off happened (curve above current EGT).
        const curve = T + (poly(START_EGT, this.n) - 15) * this.egtPeakScale;
        if (t > 0 && fuelOk && curve > this.egt + 2) this.lit = true;
        if (this.lit) this.egt = lag(this.egt, curve, 0.6, dt);
        else this.egt = lag(this.egt, T, 60, dt);
        if (this.egt > 900) { this.setFault('EGT_OVERTEMP'); break; }
        if (this.since > 75) { this.setFault('SLOW_START'); break; }
        if (this.n > 95) this.nAbove95 += dt;
        if (this.n >= 99.95) {
          this.state = 'running';
          this.n = 100;
          this.egtLoad = this.egt;
        }
        break;
      }
      case 'running': {
        this.n = 100 + 0.12 * this.wn.step(dt);
        const genLoad = m.elec.genLoad.APU;
        const bleedDemand = this.bleedValvePos * (0.45 + 0.55 * clamp(this.bleedFlowDemand(sim), 0, 1.2));
        const target = this.egtBase + (T - 15) * 0.9 + genLoad * 0.3 + 95 * bleedDemand + 3 * this.we.step(dt);
        this.egtLoad = lag(this.egtLoad, target, 12, dt);
        this.egt = lag(this.egt, this.egtLoad, 3, dt);
        if (!sim.getB('S:FUEL_APU_FEED')) {
          this.noFuel += dt;
          if (this.noFuel > 3) this.setFault('FUEL_PRESS');
        } else this.noFuel = 0;
        if (this.cooldownLeft > 0) {
          this.cooldownLeft -= dt;
          if (this.cooldownLeft <= 0) { this.cooldownLeft = 0; this.beginStop(); }
        }
        break;
      }
      case 'stopping': {
        this.stopT += dt;
        this.n = stopN(this.stopT) * this.stopFactor;
        // After fuel shut-off the EGT collapses quickly, then cools slowly.
        const target = T + (this.egt - T > 150 ? 120 : 30) * (this.n / 100);
        this.egt = lag(this.egt, target, this.n > 20 ? 6 : 40, dt);
        if (this.n <= 0.05) {
          this.n = 0;
          this.state = 'off';
        }
        break;
      }
    }
    if (this.state === 'off') this.egt = lag(this.egt, T, 240, dt);

    // START ON light / AVAIL
    this.available = !this.fault && (
      (this.state === 'starting' && (this.nAbove95 >= 2 || this.n > 99.5)) ||
      this.state === 'running' ||
      (this.state === 'stopping' && this.n > 95));
    this.genAvailable = this.available && !firePb;
    if (this.available || this.fault || (!master && this.state !== 'starting')) this.startOn = false;

    // ---------------- air intake flap (DC BAT bus) ----------------
    const flapOpen = this.ecbOn && (
      (this.state === 'off' && master) || this.state === 'starting' || this.state === 'running' ||
      (this.state === 'stopping' && (master || this.n >= 7)));
    if (dcPowered) this.flap = approach(this.flap, flapOpen ? 1 : 0, 1 / this.flapTravel, dt);

    // ---------------- bleed valve ----------------
    const bleedCmd = this.ecbOn && this.fault !== 'FIRE' && !firePb && master && this.n > 95 && bleedPb && this.state !== 'stopping';
    this.bleedValvePos = approach(this.bleedValvePos, bleedCmd ? 1 : 0, 1 / 1.5, dt);
    if (this.bleedValvePos > 0.01) this.bleedClosedFor = 0;
    else this.bleedClosedFor += dt;
    const demand = this.bleedFlowDemand(sim);
    const pAvail = this.n > 90 ? 39 - 5.5 * clamp(demand, 0, 1.3) + 0.6 * this.we.v : 0;
    this.bleedPress = pAvail * clamp(this.bleedValvePos * 1.2, 0, 1) * clamp((this.n - 90) / 8, 0, 1);

    // ---------------- fuel flow ----------------
    if (this.state === 'starting' && this.lit) this.fuelFlow = 35 + 75 * (this.n / 100);
    else if (this.state === 'running') this.fuelFlow = 98 + m.elec.genLoad.APU * 0.2 + 38 * this.bleedValvePos * (0.4 + 0.6 * clamp(demand, 0, 1.2));
    else this.fuelFlow = 0;
    this.fuelUsed += (this.fuelFlow * dt) / 3600;

    this.lpValveCmd = this.ecbOn && this.fault !== 'FIRE' && !firePb &&
      (master || this.state === 'starting' || (this.state === 'running' && this.cooldownLeft > 0));

    // DC loads: ECB, flap actuator, APU LP valve (DC BAT bus)
    if (this.ecbOn && this.n < 70) m.elec.extraDc.DC_BAT += 4;
    if (flapOpen ? this.flap < 1 : this.flap > 0) m.elec.extraDc.DC_BAT += 2;

    this.publish(sim, master);
  }

  private bleedFlowDemand(sim: Sim): number {
    return (sim.get('S:PACK1_FLOW') + sim.get('S:PACK2_FLOW')) * 0.45
      + (sim.getB('S:ENG1_START_VALVE') || sim.getB('S:ENG2_START_VALVE') ? 0.9 : 0)
      + (sim.getB('S:AI_WING_VALVE_L') ? 0.2 : 0);
  }

  private setFault(f: ApuFault): void {
    if (this.fault) return;
    this.fault = f;
    this.cooldownLeft = 0;
    this.startOn = false;
    if (this.state === 'starting' || this.state === 'running') this.beginStop();
  }

  private beginStop(): void {
    this.state = 'stopping';
    // Enter the recorded run-down curve at the point matching the current N.
    this.stopFactor = 1;
    let t = 0;
    while (t < 49 && stopN(t) > this.n) t += 0.05;
    this.stopT = t;
    this.cooldownLeft = 0;
  }

  private publish(sim: Sim, master: boolean): void {
    const set = (k: string, v: number | boolean) => sim.set(k, v);
    const on = this.ecbOn;
    set('S:APU_N', Math.round(clamp(this.n, 0, 101) * 10) / 10);
    set('S:APU_EGT', Math.round(this.egt));
    set('S:APU_AVAIL', this.available);
    set('S:APU_FLAP_POS', Math.round(this.flap * 1000) / 1000);
    set('S:APU_FLAP_OPEN', this.flap >= 1);
    set('S:APU_STARTING', this.state === 'starting');
    set('S:APU_START_ON', this.startOn);
    set('S:APU_BLEED_VALVE', this.bleedValvePos >= 0.99);
    set('S:APU_BLEED_VALVE_POS', Math.round(this.bleedValvePos * 100) / 100);
    set('S:APU_BLEED_PRESS', Math.round(this.bleedPress * 10) / 10);
    set('S:APU_FUEL_USED', Math.round(this.fuelUsed * 10) / 10);
    set('S:APU_FUEL_FLOW', Math.round(this.fuelFlow));
    set('S:APU_OIL_LOW', 0);
    set('S:APU_SHUTTING_DOWN', this.cooldownLeft > 0 || this.state === 'stopping' || (this.state === 'off' && !master && this.flap > 0.001));
    set('S:APU_COOLDOWN', this.cooldownLeft > 0);
    set('S:APU_ECB_ON', on);
    set('S:APU_FAULT', this.fault ? 1 : 0);
    set('S:APU_AUTO_SHUTDOWN', !!this.fault && this.fault !== 'FIRE');
    set('S:APU_EMER_SHUTDOWN', this.fault === 'FIRE');
    set('S:APU_LOW_FUEL_PRESS', this.fault === 'FUEL_PRESS');
    set('S:APU_STATE', this.state === 'off' ? 0 : this.state === 'starting' ? 1 : this.state === 'running' ? 2 : 3);
    const warn = this.state === 'starting' ? 900 : 682;
    set('S:APU_EGT_WARN', warn);
    set('S:APU_EGT_CAUTION', warn - 33);
  }
}
