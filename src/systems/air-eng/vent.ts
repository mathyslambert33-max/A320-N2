/**
 * Avionics equipment ventilation (A320 FCOM DSC-21-40, skin heat exchanger standard) and aft cargo
 * compartment ventilation.
 *
 * AEVC (Avionics Equipment Ventilation Computer, 28 VDC) + blower fan and extract fan (115 VAC),
 * skin air inlet valve and skin air extract valve (motor driven, ≈ 4 s):
 *  - Open-circuit (ground, skin temperature > 12 °C rising / 9 °C falling): inlet & extract valves open.
 *  - Closed-circuit (ground cold / flight): both closed (skin heat exchanger).
 *  - Take-off (thrust levers at T.O on ground): inlet closed, extract partially open.
 *  - Flight intermediate (warm skin > 35 °C): extract partially open.
 *  - BLOWER pb OVRD: closed-circuit config, blower fan stops, air-conditioning air added.
 *  - EXTRACT pb OVRD: closed-circuit config, extract fan keeps running; both OVRD = smoke config
 *    (extract valve partially open, blower off).
 *  - DITCHING: both valves closed.
 *  - FAULT lights: low blowing / extract pressure (fan not running while commanded), or avionics smoke
 *    (S:VENT_AVNCS_SMOKE from sys-misc) → both FAULT lights.
 * Aft cargo ventilation: AFT ISOL VALVE pb (AUTO/OFF): inlet & outlet isolation valves + extract fan;
 * valves close on OFF, on aft cargo smoke, or without DC power. FAULT: valve disagree.
 */
import type { Sim } from '../../core/sim';
import { ac1, ac2, clamp, dc1, dc2, DelayOn, oat, onGround, pbIn } from './common';

export class VentModel {
  blowerOn = false;
  extractOn = false;
  inlet = 1;
  extract = 1;
  blowerFault = false;
  extractFault = false;
  private openCircuit = true;
  private blowerLow = new DelayOn(5);
  private extractLow = new DelayOn(5);
  /** Aft cargo ventilation. */
  cargoValve = 1;
  cargoFan = false;
  cargoFault = false;
  private cargoDisagree = new DelayOn(12);

  constructor(sim: Sim) {
    // Aircraft parked (warm skin): open-circuit valves open.
    this.openCircuit = oat(sim) > 9;
    this.inlet = this.extract = this.openCircuit ? 1 : 0;
  }

  update(sim: Sim, dt: number, ditching: boolean, toPower: boolean): void {
    const aevc = dc1(sim) || dc2(sim);
    const blowerAuto = pbIn(sim, 'VENT_BLOWER');
    const extractAuto = pbIn(sim, 'VENT_EXTRACT');
    const smoke = sim.getB('S:VENT_AVNCS_SMOKE');
    const gnd = onGround(sim);
    const skin = gnd ? oat(sim) : (sim.has('S:ADIRS_SAT') ? sim.get('S:ADIRS_SAT') : oat(sim)) + 10;

    this.blowerOn = blowerAuto && ac1(sim);
    this.extractOn = ac2(sim);

    if (skin > 12) this.openCircuit = true;
    else if (skin < 9) this.openCircuit = false;

    let inletT = 0;
    let extractT = 0;
    if (ditching) { inletT = 0; extractT = 0; }
    else if (!blowerAuto && !extractAuto) { inletT = 0; extractT = 0.3; }
    else if (!blowerAuto || !extractAuto) { inletT = 0; extractT = 0; }
    else if (gnd && toPower) { inletT = 0; extractT = 0.3; }
    else if (gnd) { inletT = this.openCircuit ? 1 : 0; extractT = this.openCircuit ? 1 : 0; }
    else { inletT = 0; extractT = skin > 35 ? 0.3 : 0; }
    if (aevc) {
      this.inlet = clamp(this.inlet + Math.sign(inletT - this.inlet) * Math.min(Math.abs(inletT - this.inlet), dt / 4), 0, 1);
      this.extract = clamp(this.extract + Math.sign(extractT - this.extract) * Math.min(Math.abs(extractT - this.extract), dt / 4), 0, 1);
    }
    const bl = this.blowerLow.update(aevc && blowerAuto && !this.blowerOn, dt);
    const ex = this.extractLow.update(aevc && !this.extractOn, dt);
    this.blowerFault = aevc && (bl || smoke);
    this.extractFault = aevc && (ex || smoke);

    /* ---------------- aft cargo ventilation ---------------- */
    const cargoPb = pbIn(sim, 'CARGO_VENT_AFT_ISOL');
    const cargoSmoke = sim.getB('S:FIRE_CARGO_AFT_SMOKE') || sim.getB('S:SMOKE_CARGO_AFT_DET');
    const dcOk = dc1(sim) || dc2(sim);
    const cmd = cargoPb && !cargoSmoke && dcOk;
    if (dcOk) this.cargoValve = clamp(this.cargoValve + (cmd ? dt : -dt) / 5, 0, 1);
    this.cargoFan = cmd && this.cargoValve > 0.9 && ac1(sim);
    this.cargoFault = dcOk && this.cargoDisagree.update((this.cargoValve > 0.5) !== cmd, dt);
  }

  publish(sim: Sim): void {
    sim.set('S:VENT_BLOWER_ON', this.blowerOn ? 1 : 0);
    sim.set('S:VENT_EXTRACT_ON', this.extractOn ? 1 : 0);
    sim.set('S:VENT_INLET_VALVE', Math.round(this.inlet * 100) / 100);
    sim.set('S:VENT_EXTRACT_VALVE', Math.round(this.extract * 100) / 100);
    sim.set('S:VENT_BLOWER_FAULT', this.blowerFault ? 1 : 0);
    sim.set('S:VENT_EXTRACT_FAULT', this.extractFault ? 1 : 0);
    sim.set('S:CARGO_VENT_AFT_VALVE', Math.round(this.cargoValve * 100) / 100);
    sim.set('S:CARGO_VENT_AFT_FAN', this.cargoFan ? 1 : 0);
  }
}
