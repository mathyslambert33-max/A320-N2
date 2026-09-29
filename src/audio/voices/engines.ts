/**
 * CFM56-5B engines and the 131-9A APU (outside the pressure hull → exterior bus + leak paths).
 */
import { AudioCore, POS, Voice, db, type VarReader, type Vec3 } from '../core';
import {
  apuLevels, apuShaftHz, apuStarterHz, apuWhineHz, clamp, engCoreShaftHz, engCoreWhineHz, engFanBpfHz,
  engFanShaftHz, engineLevels, engStarterHz, isLit, lag2, smoothstep,
} from '../mappings';
import type { OneShots } from '../oneshots';

/** Engine component levels (dB) before the hull path — calibrated for the captain seat. */
const ENG_DB = {
  airRush: 2,
  starter: -13,
  core: -12,
  sub: -18,
  fanTone: -22,
  fanBroad: -13,
  combustion: -4,
  buzz: -21,
  leak: -13,
};

export class EngineVoice extends Voice {
  readonly pos: Vec3;
  private out: GainNode;
  private gAir: GainNode; private bpAir: BiquadFilterNode;
  private gStarter: GainNode; private gCore: GainNode; private gSub: GainNode;
  private gFan: GainNode; private gFanB: GainNode; private bpFan: BiquadFilterNode;
  private gComb: GainNode; private lpComb: BiquadFilterNode;
  private gBuzz: GainNode;
  private oStarter?: OscillatorNode; private oCore?: OscillatorNode; private oSub?: OscillatorNode;
  private oFan?: OscillatorNode; private oBuzz?: OscillatorNode;
  private lit = false;
  private prevValve = 0;
  private nextSpark = 0;
  private sparkSide = 0;
  private flutter = 1;
  private sv = 0;
  private cur = { n1: 0, n2: 0 };

  constructor(core: AudioCore, readonly n: 1 | 2, private shots: OneShots) {
    super(core, `eng${n}`);
    this.idleStop = 3;
    this.pos = n === 1 ? POS.eng1 : POS.eng2;
    const pan = this.bus(core.panner(this.pos, 'eq', 1, 0), core.exteriorBus);
    this.out = core.gain(1, pan);
    this.leak(this.out, db(ENG_DB.leak));
    this.gAir = core.gain(0, this.out);
    this.bpAir = core.filter('bandpass', 1300, 0.7, this.gAir);
    this.gStarter = core.gain(0, this.out);
    this.gCore = core.gain(0, this.out);
    this.gSub = core.gain(0, this.out);
    this.gFan = core.gain(0, this.out);
    this.gFanB = core.gain(0, this.out);
    this.bpFan = core.filter('bandpass', 400, 0.5, this.gFanB);
    this.gComb = core.gain(0, this.out);
    this.lpComb = core.filter('lowpass', 200, 0.6, this.gComb);
    this.gBuzz = core.gain(0, core.filter('lowpass', 2500, 0.6, this.out));
  }

  private read(v: VarReader) {
    const p = `S:ENG${this.n}_`;
    return {
      n1: v.get(`${p}N1`), n2: v.get(`${p}N2`), egt: v.get(`${p}EGT`), ff: v.get(`${p}FF`),
      startValve: v.get(`${p}START_VALVE`), ignA: v.get(`${p}IGN_A`), ignB: v.get(`${p}IGN_B`),
      state: v.get(`${p}STATE`), oat: v.has('G:ENV_OAT') ? v.get('G:ENV_OAT') : 15,
    };
  }

  update(dt: number, v: VarReader): void {
    const e = this.read(v);
    // Start valve: ~1 s opening/closing travel; audible valve thump on each transition.
    const valve = e.startValve > 0.5 ? 1 : 0;
    if (valve !== this.prevValve) this.shots.exterior('valve', this.pos, valve ? 0 : -4);
    this.prevValve = valve;
    this.sv = lag2(this.sv, valve, dt, 0.5, 0.35);
    const L = engineLevels({ ...e, startValve: this.sv });

    // Light-off whump.
    const lit = isLit(e);
    if (lit && !this.lit && e.n2 < 50 && e.n2 > 5) this.shots.exterior('whump', this.pos, -10);
    this.lit = lit;

    // Igniters (A and B alternate when both on): faint snaps ~1.6 Hz each.
    const now = this.core.now;
    const ign = (e.ignA > 0 ? 1 : 0) + (e.ignB > 0 ? 1 : 0);
    if (ign > 0) {
      if (this.nextSpark < now) this.nextSpark = now + 0.05;
      while (this.nextSpark < now + 0.1) {
        this.shots.exterior('igniter', this.pos, 0, this.nextSpark);
        this.nextSpark += (ign === 2 ? 0.31 : 0.62) * (0.95 + Math.random() * 0.1);
        this.sparkSide ^= 1;
      }
    }

    const total = L.airRush + L.starter + L.core + L.fanBroad + L.combustion;
    this.cur = e;
    if (!this.run(total, dt)) return;
    // Turbulent flutter on combustion / air rush.
    this.flutter = lag2(this.flutter, 0.85 + Math.random() * 0.3, dt, 0.08, 0.08);
    const n1 = e.n1, n2 = e.n2;
    this.set(this.gAir.gain, db(ENG_DB.airRush) * L.airRush * this.flutter, 0.06);
    this.set(this.bpAir.frequency, 600 + 30 * clamp(n2, 0, 60), 0.2);
    this.set(this.gStarter.gain, db(ENG_DB.starter) * L.starter, 0.08);
    this.set(this.gCore.gain, db(ENG_DB.core) * L.core, 0.08);
    this.set(this.gSub.gain, db(ENG_DB.sub) * smoothstep(3, 30, n2), 0.1);
    this.set(this.gFan.gain, db(ENG_DB.fanTone) * L.fanTone, 0.1);
    this.set(this.gFanB.gain, db(ENG_DB.fanBroad) * L.fanBroad, 0.1);
    this.set(this.bpFan.frequency, 250 + n1 * 11, 0.2);
    this.set(this.gComb.gain, db(ENG_DB.combustion) * L.combustion * (0.9 + 0.2 * this.flutter), 0.05);
    this.set(this.lpComb.frequency, 150 + 3 * clamp(n1, 0, 100), 0.2);
    this.set(this.gBuzz.gain, db(ENG_DB.buzz) * L.buzz, 0.2);
    if (this.oStarter) this.set(this.oStarter.frequency, engStarterHz(n2), 0.06);
    if (this.oCore) this.set(this.oCore.frequency, engCoreWhineHz(n2), 0.06);
    if (this.oSub) this.set(this.oSub.frequency, Math.max(8, engCoreShaftHz(n2)) * 2, 0.06);
    if (this.oFan) this.set(this.oFan.frequency, Math.max(20, engFanBpfHz(n1)), 0.08);
    if (this.oBuzz) this.set(this.oBuzz.frequency, Math.max(10, engFanShaftHz(n1)), 0.08);
  }

  protected build(): void {
    const c = this.core;
    const e = this.cur;
    this.srcs.push(c.noise('white', this.bpAir));
    this.srcs.push(c.noise('pink', this.bpFan));
    this.srcs.push(c.noise('brown', this.lpComb));
    this.oStarter = c.osc([1, 0.45, 0.25, 0.12], engStarterHz(e.n2), this.gStarter);
    this.oCore = c.osc([1, 0.55, 0.3, 0.2, 0.1, 0.06], engCoreWhineHz(e.n2), this.gCore);
    this.oSub = c.osc([1, 0.3], Math.max(8, engCoreShaftHz(e.n2)) * 2, this.gSub);
    this.oFan = c.osc([1, 0.4, 0.2], Math.max(20, engFanBpfHz(e.n1)), this.gFan);
    this.oBuzz = c.osc('sawtooth', Math.max(10, engFanShaftHz(e.n1)), this.gBuzz);
    this.srcs.push(this.oStarter, this.oCore, this.oSub, this.oFan, this.oBuzz);
  }

  protected override onStop(): void {
    this.oStarter = this.oCore = this.oSub = this.oFan = this.oBuzz = undefined;
  }
}

const APU_DB = { starter: -32, whine: -33, shaft: -40, roar: -29, combustion: -26, flap: -40, leak: -6 };

/**
 * APU 131-9A in the tail cone (~32 m aft): DC starter whine, light-off, turbine whine + exhaust roar
 * heard faintly through the structure (clearly when a door/window is open), intake flap motor.
 */
export class ApuVoice extends Voice {
  private out: GainNode;
  private gStarter: GainNode; private gWhine: GainNode; private gShaft: GainNode;
  private gRoar: GainNode; private bpRoar: BiquadFilterNode; private gComb: GainNode; private gFlap: GainNode;
  private oStarter?: OscillatorNode; private oWhine?: OscillatorNode; private oShaft?: OscillatorNode;
  private lit = false;
  private prevFlap = 0;
  private flapMove = 0;
  private prevN = 0;
  private n = 0;

  constructor(core: AudioCore, private shots: OneShots) {
    super(core, 'apu');
    this.idleStop = 3;
    const pan = this.bus(core.panner(POS.apu, 'eq', 1, 0), core.exteriorBus);
    this.out = core.gain(1, pan);
    this.leak(this.out, db(APU_DB.leak));
    this.gStarter = core.gain(0, core.filter('lowpass', 1800, 0.7, this.out));
    this.gWhine = core.gain(0, this.out);
    this.gShaft = core.gain(0, this.out);
    this.gRoar = core.gain(0, this.out);
    this.bpRoar = core.filter('bandpass', 700, 0.5, this.gRoar);
    this.gComb = core.gain(0, core.filter('lowpass', 220, 0.6, this.out));
    this.gFlap = core.gain(0, core.filter('bandpass', 900, 1.2, this.out));
  }

  update(dt: number, v: VarReader): void {
    const n = v.get('S:APU_N');
    const egt = v.get('S:APU_EGT');
    const oat = v.has('G:ENV_OAT') ? v.get('G:ENV_OAT') : 15;
    const flap = v.get('S:APU_FLAP_POS');
    const moving = dt > 0 && Math.abs(flap - this.prevFlap) / dt > 0.005 ? 1 : 0;
    this.prevFlap = flap;
    this.flapMove = lag2(this.flapMove, moving, dt, 0.05, 0.25);
    // Starter engaged: from the sys var, or inferred from a rising N below the 55 % cut-out.
    const rising = dt > 0 && n > this.prevN + 0.01 * dt;
    this.prevN = n;
    this.n = n;
    const starting = v.has('S:APU_STARTING') ? v.get('S:APU_STARTING') : rising && n < 56 ? 1 : 0;
    const L = apuLevels({ n, egt, starting, bleed: v.get('S:APU_BLEED_VALVE'), oat });
    const lit = egt > oat + 120 && n > 3;
    if (lit && !this.lit && n < 40) this.shots.exterior('whump', POS.apu, -22);
    this.lit = lit;
    if (!this.run(L.starter + L.whine + L.roar + L.combustion + this.flapMove, dt)) return;
    const bleed = v.get('S:APU_BLEED_VALVE') > 0 ? 1 : 0;
    this.set(this.gStarter.gain, db(APU_DB.starter) * L.starter, 0.1);
    this.set(this.gWhine.gain, db(APU_DB.whine) * L.whine, 0.1);
    this.set(this.gShaft.gain, db(APU_DB.shaft) * L.whine, 0.1);
    this.set(this.gRoar.gain, db(APU_DB.roar) * L.roar, 0.15);
    this.set(this.bpRoar.frequency, 350 + 6 * clamp(n, 0, 105), 0.3);
    this.set(this.gComb.gain, db(APU_DB.combustion) * L.combustion, 0.15);
    this.set(this.gFlap.gain, db(APU_DB.flap) * this.flapMove, 0.05);
    const load = 1 - 0.012 * bleed;
    if (this.oWhine) this.set(this.oWhine.frequency, apuWhineHz(n) * load, 0.15);
    if (this.oShaft) this.set(this.oShaft.frequency, Math.max(5, apuShaftHz(n) * load), 0.15);
    if (this.oStarter) this.set(this.oStarter.frequency, apuStarterHz(n), 0.1);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.noise('pink', this.bpRoar));
    this.srcs.push(c.noise('brown', this.gComb));
    this.oStarter = c.osc('sawtooth', apuStarterHz(this.n), this.gStarter);
    this.oWhine = c.osc([1, 0.5, 0.35, 0.2, 0.1], apuWhineHz(this.n), this.gWhine);
    this.oShaft = c.osc([1, 0.4], Math.max(5, apuShaftHz(this.n)), this.gShaft);
    // Intake flap actuator: small geared DC motor.
    this.srcs.push(c.osc('sawtooth', 160, this.gFlap));
    this.srcs.push(this.oStarter, this.oWhine, this.oShaft);
  }

  protected override onStop(): void {
    this.oStarter = this.oWhine = this.oShaft = undefined;
  }
}
