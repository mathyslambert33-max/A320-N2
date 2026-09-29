/**
 * Interior (pressurised) system sounds: avionics ventilation, electrical hum, air-conditioning outlets,
 * cabin air heard through the cockpit door.
 */
import { AudioCore, POS, Voice, db, type VarReader } from '../core';
import { clamp, fanLevel, fanSpin, lag2, smoothstep } from '../mappings';

const acPowered = (v: VarReader) => v.get('S:ELEC_AC_POWERED') > 0 || v.get('S:ELEC_AC1_BUS') > 0 || v.get('S:ELEC_AC2_BUS') > 0;
const dcPowered = (v: VarReader) => v.get('S:ELEC_DC_BAT_BUS') > 0 || v.get('S:ELEC_DC_ESS_BUS') > 0 || v.get('S:ELEC_DC1_BUS') > 0;

/**
 * Avionics ventilation: blower + extract fans in the avionics bay under the floor, and the air drawn
 * through the instrument panels. This is THE characteristic sound of a powered Airbus flight deck:
 * a broadband whoosh with a soft rising whine when AC power arrives, coasting down over several
 * seconds when power is removed.
 */
export class AvionicsFans extends Voice {
  private sB = 0;
  private sE = 0;
  private gBroad: GainNode;
  private bpBroad: BiquadFilterNode;
  private gHiss: GainNode;
  private hpHiss: BiquadFilterNode;
  private gToneB: GainNode;
  private gToneE: GainNode;
  private gLfo: GainNode;
  private oscB?: OscillatorNode;
  private oscE?: OscillatorNode;
  private hissBase: GainNode;

  constructor(core: AudioCore) {
    super(core, 'avionics-fans');
    const bay = this.bus(core.panner(POS.avionicsBay, 'eq', 1.2, 1), core.interior);
    const grille = this.bus(core.panner(POS.panelGrille, 'hrtf', 0.8, 1), core.interior);
    this.gBroad = core.gain(0, bay);
    this.bpBroad = core.filter('bandpass', 650, 0.55, this.gBroad);
    this.gToneB = core.gain(0, bay);
    this.gToneE = core.gain(0, bay);
    // Hiss through the panel grilles, gently modulated (air turbulence).
    this.hissBase = core.gain(1, grille);
    this.gHiss = core.gain(0, this.hissBase);
    this.hpHiss = core.filter('highpass', 2200, 0.5);
    const lp = core.filter('lowpass', 7500, 0.5, this.gHiss);
    this.hpHiss.connect(lp);
    this.gLfo = core.gain(0, this.hissBase.gain);
  }

  update(dt: number, v: VarReader): void {
    const ac = acPowered(v);
    const blower = v.has('S:VENT_BLOWER_ON') ? v.get('S:VENT_BLOWER_ON') > 0 : ac;
    const extract = v.has('S:VENT_EXTRACT_ON') ? v.get('S:VENT_EXTRACT_ON') > 0 : ac;
    this.sB = fanSpin(this.sB, blower, dt);
    this.sE = fanSpin(this.sE, extract, dt);
    const lB = fanLevel(this.sB);
    const lE = fanLevel(this.sE);
    const level = Math.max(lB, lE);
    if (!this.run(level, dt)) return;
    this.set(this.gBroad.gain, db(-5) * (0.6 * lB + 0.6 * lE), 0.05);
    this.set(this.bpBroad.frequency, 380 + 320 * Math.max(this.sB, this.sE), 0.1);
    this.set(this.gHiss.gain, db(-11) * lE, 0.05);
    this.set(this.hpHiss.frequency, 1500 + 900 * this.sE, 0.1);
    this.set(this.gLfo.gain, 0.12 * lE, 0.2);
    // Motor/impeller whines (subtle), slightly different so they beat.
    if (this.oscB) this.set(this.oscB.frequency, 25 + 590 * this.sB, 0.05);
    if (this.oscE) this.set(this.oscE.frequency, 25 + 707 * this.sE, 0.05);
    this.set(this.gToneB.gain, db(-30) * lB * (0.4 + 0.6 * smoothstep(0.2, 0.8, this.sB)), 0.05);
    this.set(this.gToneE.gain, db(-32) * lE * (0.4 + 0.6 * smoothstep(0.2, 0.8, this.sE)), 0.05);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.noise('pink', this.bpBroad));
    this.srcs.push(c.noise('white', this.hpHiss));
    this.oscB = c.osc([1, 0.45, 0.2, 0.1], 25 + 590 * this.sB, this.gToneB);
    this.oscE = c.osc([1, 0.35, 0.25, 0.08], 25 + 707 * this.sE, this.gToneE);
    this.srcs.push(this.oscB, this.oscE, c.osc('sine', 0.21, this.gLfo));
  }

  protected override onStop(): void {
    this.oscB = this.oscE = undefined;
  }

  /** Instantly set the fan speeds to their steady state (when audio starts mid-session). */
  settle(v: VarReader): void {
    const ac = acPowered(v);
    this.sB = (v.has('S:VENT_BLOWER_ON') ? v.get('S:VENT_BLOWER_ON') > 0 : ac) ? 1 : 0;
    this.sE = (v.has('S:VENT_EXTRACT_ON') ? v.get('S:VENT_EXTRACT_ON') > 0 : ac) ? 1 : 0;
  }
}

/**
 * Electrical: 400 Hz network hum (transformers, TRs) under the floor when AC is supplied, the static
 * inverter whine, and the very faint whine of DC-powered equipment on batteries only.
 */
export class ElecHum extends Voice {
  private gAc: GainNode;
  private gInv: GainNode;
  private gDc: GainNode;
  private oscAc?: OscillatorNode;
  private ac = 0;
  private inv = 0;
  private dc = 0;

  constructor(core: AudioCore) {
    super(core, 'elec-hum');
    const p = this.bus(core.panner(POS.elecBay, 'eq', 1, 0), core.interior);
    const lp = core.filter('lowpass', 2500, 0.5, p);
    this.gAc = core.gain(0, lp);
    this.gInv = core.gain(0, p);
    this.gDc = core.gain(0, p);
  }

  private hz(v: VarReader): number {
    for (const s of ['EXT', 'APU_GEN', 'GEN1', 'GEN2']) {
      const on = s === 'EXT' ? v.get('S:ELEC_EXT_PWR_ON') : v.get(`S:ELEC_${s}_ON`);
      const f = v.get(`S:ELEC_${s}_HZ`);
      if (on > 0 && f > 300 && f < 500) return f;
    }
    return 400;
  }

  update(dt: number, v: VarReader): void {
    const ac = acPowered(v) ? 1 : 0;
    // Ground power units hum a little louder in the network than the IDG/APU gen (subjective, subtle).
    const ext = v.get('S:ELEC_EXT_PWR_ON') > 0 ? 1.3 : 1;
    this.ac = lag2(this.ac, ac * ext, dt, 0.05, 0.3);
    this.inv = lag2(this.inv, v.get('S:ELEC_STAT_INV') > 0 ? 1 : 0, dt, 0.2, 0.3);
    this.dc = lag2(this.dc, dcPowered(v) ? 1 : 0, dt, 0.1, 0.3);
    if (!this.run(this.ac + this.inv + this.dc, dt)) return;
    this.set(this.gAc.gain, db(-46) * this.ac, 0.04);
    this.set(this.gInv.gain, db(-54) * this.inv, 0.1);
    this.set(this.gDc.gain, db(-56) * this.dc, 0.1);
    if (this.oscAc) this.set(this.oscAc.frequency, this.hz(v), 0.5);
  }

  protected build(): void {
    const c = this.core;
    // Transformer hum: magnetostriction at 2× line frequency dominates, plus odd harmonics.
    this.oscAc = c.osc([0.35, 1, 0.3, 0.45, 0.1, 0.18], 400, this.gAc);
    this.srcs.push(this.oscAc);
    this.srcs.push(c.osc([1, 0, 0.3, 0, 0.12], 400, this.gInv));
    // DC equipment: faint high electronic whine (power supplies / coil whine) + a hint of hiss.
    this.srcs.push(c.osc('sine', 3920, this.gDc));
    const hp = c.filter('bandpass', 6000, 2, this.gDc);
    const g = c.gain(0.15, hp);
    this.srcs.push(c.noise('white', g));
  }

  protected override onStop(): void {
    this.oscAc = undefined;
  }
}

/**
 * Air conditioning: fresh air from the packs through the cockpit outlets (overhead + lateral) and
 * the mixer duct rumble under the floor. Level follows PACK1_FLOW + PACK2_FLOW.
 */
export class PackAir extends Voice {
  private flow = 0;
  private gVent: GainNode;
  private gSide: GainNode;
  private bpVent: BiquadFilterNode;
  private hpSide: BiquadFilterNode;
  private gDuct: GainNode;
  private gAcm: GainNode;
  private oscAcm?: OscillatorNode;
  private lfo: GainNode;

  constructor(core: AudioCore) {
    super(core, 'pack-air');
    const ov = this.bus(core.panner(POS.ovhdVent, 'hrtf', 1, 1), core.interior);
    this.gVent = core.gain(0, ov);
    this.bpVent = core.filter('bandpass', 1100, 0.45, this.gVent);
    const sideC = this.bus(core.panner(POS.sideVentCapt, 'eq', 0.6, 1), core.interior);
    const sideF = this.bus(core.panner(POS.sideVentFo, 'eq', 0.6, 1), core.interior);
    this.gSide = core.gain(0);
    this.gSide.connect(sideC);
    this.gSide.connect(sideF);
    this.hpSide = core.filter('highpass', 1800, 0.5, this.gSide);
    const duct = this.bus(core.panner(POS.floorDuct, 'eq', 1, 0), core.interior);
    this.gDuct = core.gain(0, core.filter('lowpass', 260, 0.6, duct));
    // Air cycle machines in the (unpressurised) pack bay: faint whine through the structure.
    const pk = this.bus(core.panner(POS.packs, 'eq', 1, 0), core.exteriorBus);
    this.gAcm = core.gain(0, pk);
    this.leak(this.gAcm, 0.25);
    this.lfo = core.gain(0, this.gVent.gain);
  }

  update(dt: number, v: VarReader): void {
    const target = clamp(v.get('S:PACK1_FLOW'), 0, 1.3) + clamp(v.get('S:PACK2_FLOW'), 0, 1.3);
    this.flow = lag2(this.flow, target, dt, 0.6, 0.8);
    const f = this.flow;
    if (!this.run(f, dt)) return;
    const a = Math.sqrt(f / 2);
    this.set(this.gVent.gain, db(-10) * a, 0.1);
    this.set(this.lfo.gain, db(-10) * a * 0.12, 0.3);
    this.set(this.bpVent.frequency, 800 + 350 * a, 0.2);
    this.set(this.gSide.gain, db(-18) * a, 0.1);
    this.set(this.gDuct.gain, db(-15) * a, 0.1);
    this.set(this.gAcm.gain, db(-36) * clamp(f, 0, 1), 0.3);
    if (this.oscAcm) this.set(this.oscAcm.frequency, 2350 + 260 * clamp(f / 2, 0, 1.2), 0.5);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.noise('pink', this.bpVent));
    this.srcs.push(c.noise('white', this.hpSide));
    this.srcs.push(c.noise('brown', this.gDuct));
    this.oscAcm = c.osc([1, 0.3, 0.15], 2400, this.gAcm);
    this.srcs.push(this.oscAcm);
    this.srcs.push(c.osc('sine', 0.13, this.lfo));
  }

  protected override onStop(): void {
    this.oscAcm = undefined;
  }
}

/**
 * Cabin air heard through the cockpit door (recirculation fans + cabin outlets). Goes through the
 * cabin → cockpit-door path whose filter/gain depend on the door being open.
 */
export class CabinAir extends Voice {
  private g: GainNode;
  private lvl = 0;
  constructor(core: AudioCore) {
    super(core, 'cabin-air');
    this.g = core.gain(0, this.bus(core.filter('lowpass', 3000, 0.5), core.cabinIn));
  }

  update(dt: number, v: VarReader): void {
    const ac = acPowered(v);
    const fans = ac && v.get('C:VENT_CAB_FANS') > 0 ? 1 : 0;
    const packs = clamp((v.get('S:PACK1_FLOW') + v.get('S:PACK2_FLOW')) / 2, 0, 1.2);
    this.lvl = lag2(this.lvl, 0.6 * fans + 0.5 * packs, dt, 1.5, 3);
    if (!this.run(this.lvl, dt)) return;
    this.set(this.g.gain, db(-14) * this.lvl, 0.2);
  }

  protected build(): void {
    this.srcs.push(this.core.noise('pink', this.g));
  }
}

/**
 * CVR TEST: while the pb is held (CVR running, parking brake set, on ground — computed by sys-misc as
 * S:RCDR_CVR_TEST) a low-frequency test signal sounds through both flight-deck loudspeakers, at the
 * level of the LOUDSPEAKER knobs (silent when both are at OFF).
 */
export class CvrTestVoice extends Voice {
  private g: GainNode;
  private lvl = 0;
  constructor(core: AudioCore) {
    super(core, 'cvr-test');
    this.g = core.gain(0, this.bus(core.filter('bandpass', 420, 1.2), core.alertBus));
  }

  update(dt: number, v: VarReader): void {
    const ls = Math.max(v.get('C:MAIN_LOUDSPEAKER_CAPT'), v.get('C:MAIN_LOUDSPEAKER_FO'));
    const target = v.get('S:RCDR_CVR_TEST') > 0 ? clamp(ls, 0, 1) : 0;
    this.lvl = lag2(this.lvl, target, dt, 0.03, 0.06);
    if (!this.run(this.lvl, dt)) return;
    this.set(this.g.gain, db(-16) * this.lvl, 0.02);
  }

  protected build(): void {
    this.srcs.push(this.core.osc([1, 0.18, 0.06], 400, this.g));
  }
}
