/**
 * Ground equipment and external horns: pushback tug and GPU diesels, jet bridge, nose-gear-bay horn
 * (ADIRS on battery / APU fire on ground), cockpit EVAC horn.
 */
import { AudioCore, POS, Voice, db, type VarReader, type Vec3 } from '../core';
import { clamp, dieselFiringHz, lag2 } from '../mappings';

export interface DieselState {
  on: boolean;
  rpm: number;
  /** 0..1 engine load (brighter, louder combustion). */
  load: number;
  /** 0..1 transmission / generator whine level. */
  whine: number;
  whineHz: number;
}

/**
 * Generic 4-stroke diesel: firing-rate sawtooth through a soft clipper (combustion knock), half-order
 * lope, AM-modulated injector/valve-train clatter, exhaust hiss, plus a whine (transmission or
 * alternator).
 */
export class DieselVoice extends Voice {
  private lvl = 0;
  private rpm = 0;
  private wander = 1;
  private load = 0;
  private gFire: GainNode; private lpFire: BiquadFilterNode; private gSub: GainNode;
  private gClat: GainNode; private gExh: GainNode; private gWhine: GainNode; private clatAm: GainNode; private clatMod: GainNode;
  private oFire?: OscillatorNode; private oSub?: OscillatorNode; private oWhine?: OscillatorNode;
  private whineHz = 400;

  constructor(core: AudioCore, name: string, pos: Vec3, private cylinders: number, private dbLevel: number, leakDb: number,
    private drive: (v: VarReader) => DieselState) {
    super(core, name);
    this.idleStop = 3;
    const pan = this.bus(core.panner(pos, 'eq', 1, 0), core.exteriorBus);
    const out = core.gain(db(dbLevel), pan);
    this.leak(out, db(leakDb - dbLevel));
    this.gFire = core.gain(0);
    this.lpFire = core.filter('lowpass', 500, 0.9, out);
    this.gFire.connect(core.shaper(3, this.lpFire));
    this.gSub = core.gain(0, core.filter('lowpass', 150, 0.7, out));
    this.gClat = core.gain(0, core.filter('bandpass', 1500, 0.7, out));
    // Clatter: noise amplitude-modulated at the firing rate (0.5 ± 0.45).
    this.clatMod = core.gain(0.5, this.gClat);
    this.clatAm = core.gain(0.45, this.clatMod.gain);
    this.gExh = core.gain(0, core.filter('lowpass', 2500, 0.5, out));
    this.gWhine = core.gain(0, out);
  }

  update(dt: number, v: VarReader): void {
    const s = this.drive(v);
    this.lvl = lag2(this.lvl, s.on ? 1 : 0, dt, 1.2, 1.0);
    this.rpm = lag2(this.rpm || s.rpm, s.rpm, dt, 1.2, 1.8);
    this.load = lag2(this.load, s.load, dt, 0.6, 1.2);
    this.wander = lag2(this.wander, 0.985 + Math.random() * 0.03, dt, 0.4, 0.4);
    this.whineHz = s.whineHz;
    if (!this.run(this.lvl, dt)) return;
    const f = dieselFiringHz(this.rpm * this.wander, this.cylinders);
    const l = this.lvl;
    this.set(this.gFire.gain, 0.8 * l, 0.1);
    this.set(this.lpFire.frequency, 350 + 700 * this.load, 0.2);
    this.set(this.gSub.gain, 0.5 * l, 0.1);
    this.set(this.gClat.gain, 0.35 * l * (0.6 + 0.4 * this.load), 0.1);
    this.set(this.gExh.gain, 0.3 * l * (0.3 + 0.7 * this.load), 0.2);
    this.set(this.gWhine.gain, 0.12 * l * clamp(s.whine, 0, 1), 0.3);
    if (this.oFire) this.set(this.oFire.frequency, f, 0.1);
    if (this.oSub) this.set(this.oSub.frequency, f / 2, 0.1);
    if (this.oWhine) this.set(this.oWhine.frequency, s.whineHz, 0.3);
  }

  protected build(): void {
    const c = this.core;
    const f = dieselFiringHz(this.rpm || 800, this.cylinders);
    this.oFire = c.osc('sawtooth', f, [this.gFire, this.clatAm]);
    this.oSub = c.osc('sine', f / 2, this.gSub);
    this.oWhine = c.osc([1, 0.4, 0.3, 0.1], this.whineHz, this.gWhine);
    this.srcs.push(this.oFire, this.oSub, this.oWhine, c.noise('pink', this.clatMod), c.noise('pink', this.gExh));
  }

  protected override onStop(): void {
    this.oFire = this.oSub = this.oWhine = undefined;
  }
}

/**
 * On/off gate modulator: a square LFO → 25 Hz low-pass (soft edges, no clicks) → ±0.5 into a gain
 * param whose base value is 0.5 → the gain toggles between 0 and 1. Helper nodes are released when
 * the LFO stops.
 */
function gateOsc(c: AudioCore, rateHz: number, param: AudioParam): OscillatorNode {
  const lp = c.filter('lowpass', 25, 0.5);
  const g = c.gain(0.5, param);
  lp.connect(g);
  const o = c.osc('square', rateHz, lp);
  o.onended = () => { lp.disconnect(); g.disconnect(); };
  return o;
}

/** Pushback tug: idles while the tow bar is connected, revs up while pushing. */
export function tugDrive(v: VarReader): DieselState {
  const push = v.get('G:GND_PUSHBACK') === 1;
  const towbar = v.get('G:GND_TOWBAR') > 0;
  const gs = Math.abs(v.get('G:AC_GS_KT'));
  return {
    on: push || towbar,
    rpm: push ? 1500 + 120 * clamp(gs / 3, 0, 1) : 760,
    load: push ? 0.85 : 0.12,
    whine: push ? 0.3 + 0.7 * clamp(gs / 3, 0, 1) : 0,
    whineHz: 280 + 160 * clamp(gs / 3, 0, 1.5),
  };
}

/** Ground power unit (diesel generator set) near the nose. */
export function gpuDrive(v: VarReader): DieselState {
  const on = v.get('G:GND_EXT_PWR') > 0;
  const loaded = v.get('S:ELEC_EXT_PWR_ON') > 0;
  return { on, rpm: 1500, load: loaded ? 0.55 : 0.2, whine: 1, whineHz: 400 };
}

/**
 * Jet bridge: HVAC / 400 Hz converter hum at the L1 door while docked; drive motors + warning beeper
 * for ~12 s when it moves (G:JETBRIDGE changes).
 */
export class JetbridgeVoice extends Voice {
  private lvl = 0;
  private moveUntil = 0;
  private prev = NaN;
  private gHum: GainNode; private gMove: GainNode; private gBeep: GainNode; private oBeepGate?: OscillatorNode;
  private mv = 0;

  constructor(core: AudioCore) {
    super(core, 'jetbridge');
    const pan = this.bus(core.panner(POS.jetbridge, 'eq', 1, 0), core.exteriorBus);
    const out = core.gain(db(-20), pan);
    // Mostly heard through the open L1 door.
    this.leak(out, db(-14));
    this.gHum = core.gain(0, out);
    this.gMove = core.gain(0, core.filter('bandpass', 700, 0.8, out));
    this.gBeep = core.gain(0, out);
  }

  update(dt: number, v: VarReader): void {
    const docked = v.get('G:JETBRIDGE') > 0.5 ? 1 : 0;
    const now = this.core.now;
    if (!Number.isNaN(this.prev) && docked !== this.prev) this.moveUntil = now + 12;
    this.prev = docked;
    this.lvl = lag2(this.lvl, docked, dt, 2, 2);
    this.mv = lag2(this.mv, now < this.moveUntil ? 1 : 0, dt, 0.4, 0.8);
    if (!this.run(this.lvl + this.mv, dt)) return;
    this.set(this.gHum.gain, 0.5 * this.lvl, 0.3);
    this.set(this.gMove.gain, 0.8 * this.mv, 0.2);
    this.set(this.gBeep.gain, 0.3 * (this.mv > 0.5 ? 1 : 0), 0.05);
  }

  protected build(): void {
    const c = this.core;
    // HVAC fan + 400 Hz converter hum.
    const bp = c.filter('bandpass', 380, 0.6, this.gHum);
    this.srcs.push(c.noise('pink', bp));
    this.srcs.push(c.osc([0.4, 1, 0.2, 0.15], 400, c.gain(0.15, this.gHum)));
    // Drive motors (electric, geared) — noise + whine.
    this.srcs.push(c.noise('pink', this.gMove));
    this.srcs.push(c.osc('sawtooth', 115, c.gain(0.3, this.gMove)));
    // Warning beeper: 2.9 kHz gated at 1.25 Hz.
    const gate = c.gain(0.5, this.gBeep);
    this.srcs.push(c.osc('square', 2900, c.gain(0.25, c.filter('lowpass', 5000, 0.7, gate))));
    this.oBeepGate = gateOsc(c, 1.25, gate.gain);
    this.srcs.push(this.oBeepGate);
  }

  protected override onStop(): void {
    this.oBeepGate = undefined;
  }
}

/**
 * Horn with an on/off pattern: nose-gear-bay external horn (ADIRS on battery on ground → intermittent;
 * APU fire on ground → continuous) or the cockpit EVAC horn.
 */
export class HornVoice extends Voice {
  private g: GainNode;
  private gate: GainNode;
  private lvl = 0;
  private mode: 'off' | 'cont' | 'inter' = 'off';
  private gateOsc?: OscillatorNode;

  constructor(core: AudioCore, name: string, pos: Vec3, exterior: boolean, private dbLevel: number,
    private freqs: [number, number], private rateHz: number, private drive: (v: VarReader) => 'off' | 'cont' | 'inter') {
    super(core, name);
    const pan = exterior ? this.bus(core.panner(pos, 'eq', 1, 0), core.exteriorBus) : this.bus(core.panner(pos, 'hrtf', 0.8, 1), core.interior);
    const out = core.gain(db(dbLevel), pan);
    if (exterior) this.leak(out, db(-2));
    this.g = core.gain(0, out);
    this.gate = core.gain(1, core.shaper(2.5, core.filter('bandpass', 900, 0.6, this.g)));
  }

  update(dt: number, v: VarReader): void {
    const m = this.drive(v);
    this.lvl = lag2(this.lvl, m === 'off' ? 0 : 1, dt, 0.02, 0.05);
    if (!this.run(this.lvl, dt)) return;
    this.set(this.g.gain, this.lvl, 0.01);
    if (m !== this.mode && m !== 'off') {
      this.mode = m;
      if (this.gateOsc) {
        this.gateOsc.stop();
        this.gateOsc = undefined;
      }
      const now = this.core.now;
      this.gate.gain.cancelScheduledValues(now);
      if (m === 'inter') {
        this.gate.gain.setValueAtTime(0.5, now);
        this.gateOsc = gateOsc(this.core, this.rateHz, this.gate.gain);
        this.srcs.push(this.gateOsc);
      } else this.gate.gain.setTargetAtTime(1, now, 0.01);
    }
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.osc('sawtooth', this.freqs[0], this.gate), c.osc('sawtooth', this.freqs[1], this.gate));
    this.mode = 'off';
  }

  protected override onStop(): void {
    this.gateOsc = undefined;
    this.mode = 'off';
  }
}
