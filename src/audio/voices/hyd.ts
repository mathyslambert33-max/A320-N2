/**
 * Hydraulics (electric pumps, PTU "barking dog"), fuel pumps and small valve motors — all located
 * in the unpressurised belly / wheel wells → exterior bus (heard through the floor structure).
 */
import { AudioCore, POS, Voice, db, hold, type VarReader, type Vec3 } from '../core';
import { clamp, lag2, nextBark, type Bark } from '../mappings';

const acPowered = (v: VarReader) => v.get('S:ELEC_AC_POWERED') > 0 || v.get('S:ELEC_AC1_BUS') > 0 || v.get('S:ELEC_AC2_BUS') > 0;
const dcPowered = (v: VarReader) => v.get('S:ELEC_DC_BAT_BUS') > 0 || v.get('S:ELEC_DC_ESS_BUS') > 0 || v.get('S:ELEC_DC1_BUS') > 0 || v.get('S:ELEC_DC2_BUS') > 0;

/**
 * Electric hydraulic pump (yellow: AC motor pump in the right wheel well area; blue: left).
 * AC induction motor hum (2× line frequency) + axial piston pump whine (9 pistons) + fluid noise;
 * pitch drops slightly and the flow noise decreases as system pressure builds.
 */
export class ElecPumpVoice extends Voice {
  private spd = 0;
  private gMotor: GainNode; private gPiston: GainNode; private gFlow: GainNode;
  private oPiston?: OscillatorNode; private oRotor?: OscillatorNode;

  constructor(core: AudioCore, private sys: 'Y' | 'B', private level = 0) {
    super(core, `hyd-${sys}-pump`);
    const pos = sys === 'Y' ? POS.yPump : POS.bPump;
    const pan = this.bus(core.panner(pos, 'eq', 1, 0), core.exteriorBus);
    const out = core.gain(db(level), pan);
    this.leak(out, db(-8));
    this.gMotor = core.gain(0, out);
    this.gPiston = core.gain(0, out);
    this.gFlow = core.gain(0, core.filter('bandpass', 1500, 0.9, out));
  }

  update(dt: number, v: VarReader): void {
    const on = v.get(this.sys === 'Y' ? 'S:HYD_Y_ELEC_PUMP_ON' : 'S:HYD_B_ELEC_PUMP_ON') > 0;
    this.spd = lag2(this.spd, on ? 1 : 0, dt, 0.35, 1.2);
    if (!this.run(this.spd, dt)) return;
    const p = clamp(v.get(this.sys === 'Y' ? 'S:HYD_Y_PRESS' : 'S:HYD_B_PRESS') / 3000, 0, 1.1);
    const s = this.spd;
    const load = 1 - 0.035 * p;
    this.set(this.gMotor.gain, db(-28) * s * s, 0.08);
    this.set(this.gPiston.gain, db(-25) * s * s * (0.8 + 0.2 * p), 0.08);
    this.set(this.gFlow.gain, db(-24) * s * (1 - 0.55 * p), 0.15);
    if (this.oPiston) this.set(this.oPiston.frequency, 20 + 1130 * s * load, 0.08);
    if (this.oRotor) this.set(this.oRotor.frequency, 10 + 370 * s * load, 0.08);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.osc([0.2, 1, 0.15, 0.3], 400, this.gMotor)); // 800 Hz magnetostriction dominant
    this.oRotor = c.osc([1, 0.3], 10 + 370 * this.spd, this.gMotor);
    this.oPiston = c.osc([1, 0.55, 0.35, 0.2, 0.12, 0.08], 20 + 1130 * this.spd, this.gPiston);
    this.srcs.push(this.oRotor, this.oPiston, c.noise('pink', this.gFlow));
  }

  protected override onStop(): void {
    this.oPiston = this.oRotor = undefined;
  }
}

/**
 * PTU "barking dog": the PTU repeatedly accelerates under load and stalls as the green/yellow ΔP
 * crosses its threshold. Synthesis: a shaft-rate sawtooth growl + 9× piston ripple, AM-modulated
 * mechanical noise, soft-clipped and low-passed; each bark is an envelope + speed sweep scheduled
 * ahead on the audio clock. After ~7 s of continuous activity it settles into a steady drone.
 */
export class PtuVoice extends Voice {
  private speed?: ConstantSourceNode;
  private gBark: GainNode;
  private gOut: GainNode;
  private gSawF: GainNode; private gPisF: GainNode; private gAm: GainNode; private noiseG: GainNode;
  private shaperIn: GainNode;
  private active = false;
  private activeFor = 0;
  private barkIdx = 0;
  private nextAt = 0;
  private pending: Bark | null = null;
  private steady = false;
  private idleFor = 0;
  private rnd = Math.random;

  constructor(core: AudioCore) {
    super(core, 'ptu');
    this.idleStop = 2.5;
    const pan = this.bus(core.panner(POS.ptu, 'eq', 1, 0), core.exteriorBus);
    this.gOut = core.gain(db(-7), pan);
    this.leak(this.gOut, db(-6));
    this.gBark = core.gain(0, this.gOut);
    const lp = core.filter('lowpass', 1300, 0.8, this.gBark);
    const sh = core.shaper(2.2, lp);
    this.shaperIn = core.gain(0.8, sh);
    // Frequency drivers (connected to oscillator frequency params when running).
    this.gSawF = core.gain(1);
    this.gPisF = core.gain(9);
    // Noise → gain modulated by the shaft saw (rasp synchronised to shaft rotation).
    this.noiseG = core.gain(0.5, core.filter('bandpass', 380, 0.7, this.shaperIn));
    this.gAm = core.gain(0.45, this.noiseG.gain);
  }

  update(dt: number, v: VarReader): void {
    const act = v.get('S:HYD_PTU_ACTIVE') > 0;
    const now = this.core.now;
    if (act && !this.active) {
      // Rising edge: bark immediately (unless one is in progress).
      this.activeFor = 0;
      this.steady = false;
      if (this.idleFor > 3) this.barkIdx = 0;
      if (this.nextAt < now + 0.02) this.nextAt = now + 0.02;
      this.pending = null;
    }
    this.active = act;
    this.activeFor = act ? this.activeFor + dt : 0;
    this.idleFor = act ? 0 : this.idleFor + dt;
    const bark = this.running && (act || this.nextAt > now);
    if (!this.run(act || bark ? 1 : 0, dt)) return;
    const sp = this.speed!;
    if (act && this.activeFor > 7) {
      if (!this.steady) {
        this.steady = true;
        hold(this.gBark.gain, now);
        hold(sp.offset, now);
        this.gBark.gain.setTargetAtTime(0.5, now, 0.4);
        sp.offset.setTargetAtTime(66, now, 0.5);
      }
      return;
    }
    if (!act) {
      if (this.steady) {
        this.steady = false;
        hold(this.gBark.gain, now);
        hold(sp.offset, now);
        this.gBark.gain.setTargetAtTime(0, now, 0.15);
        sp.offset.setTargetAtTime(25, now, 0.3);
      }
      return;
    }
    // Schedule barks ahead of the audio clock.
    while (this.nextAt < now + 0.15) {
      const b = this.pending ?? nextBark(this.rnd, this.barkIdx++);
      this.pending = null;
      const t = Math.max(this.nextAt, now + 0.01);
      const g = this.gBark.gain;
      const f = sp.offset;
      f.setTargetAtTime(b.f0, t - 0.005, 0.01);
      f.setTargetAtTime(b.fPeak, t, b.dur * 0.3);
      f.setTargetAtTime(b.f0 * 0.8, t + b.dur * 0.8, 0.07);
      g.setTargetAtTime(b.amp, t, 0.02);
      g.setTargetAtTime(b.amp * 0.8, t + b.dur * 0.55, 0.05);
      g.setTargetAtTime(0, t + b.dur, 0.045);
      const nb = nextBark(this.rnd, this.barkIdx++);
      this.pending = nb;
      this.nextAt = t + b.dur + nb.gap;
    }
  }

  protected build(): void {
    const c = this.core;
    const sp = (this.speed = c.ctx.createConstantSource());
    sp.offset.value = 30;
    sp.connect(this.gSawF);
    sp.connect(this.gPisF);
    sp.start();
    const saw = c.ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 0;
    this.gSawF.connect(saw.frequency);
    saw.connect(this.shaperIn);
    saw.connect(this.gAm);
    saw.start();
    const pis = c.ctx.createOscillator();
    pis.setPeriodicWave(c.wave([1, 0.6, 0.4, 0.25, 0.15]));
    pis.frequency.value = 0;
    this.gPisF.connect(pis.frequency);
    const pg = c.gain(0.35, c.filter('bandpass', 650, 1.1, this.shaperIn));
    pis.connect(pg);
    pis.start();
    this.srcs.push(sp, saw, pis, c.noise('pink', this.noiseG));
  }

  protected override onStop(): void {
    this.speed = undefined;
    // Release the old oscillators' frequency inputs (re-connected by the next build).
    this.gSawF.disconnect();
    this.gPisF.disconnect();
    this.gBark.gain.cancelScheduledValues(this.core.now);
    this.gBark.gain.setValueAtTime(0, this.core.now);
  }
}

/** Wing tank fuel pumps (AC motors in the tanks): barely audible hum, mostly with a window open. */
export class FuelPumpsVoice extends Voice {
  private g: GainNode;
  private lvl = 0;
  constructor(core: AudioCore) {
    super(core, 'fuel-pumps');
    const pan = this.bus(core.panner(POS.fuelPumps, 'eq', 1, 0), core.exteriorBus);
    this.g = core.gain(0, pan);
    this.leak(this.g, db(-10));
  }

  update(dt: number, v: VarReader): void {
    let n = 0;
    if (acPowered(v)) {
      for (const id of ['FUEL_L_PUMP1', 'FUEL_L_PUMP2', 'FUEL_R_PUMP1', 'FUEL_R_PUMP2']) if (v.get(`C:${id}`) > 0) n++;
      if (v.get('S:FUEL_C_KG') > 50) for (const id of ['FUEL_CTR_PUMP1', 'FUEL_CTR_PUMP2']) if (v.get(`C:${id}`) > 0 && v.get('S:ENG1_RUNNING') + v.get('S:ENG2_RUNNING') > 0) n++;
    }
    this.lvl = lag2(this.lvl, Math.sqrt(n / 4), dt, 0.8, 1.5);
    if (!this.run(this.lvl, dt)) return;
    this.set(this.g.gain, db(-47) * this.lvl, 0.2);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.osc([0.3, 1, 0.2, 0.25], 400, this.g));
    const bp = c.filter('bandpass', 900, 1, this.g);
    this.srcs.push(c.noise('pink', c.gain(0.5, bp)));
  }
}

/**
 * Small electric valve / flap actuator motor (X FEED valve, …): runs for `travel` s after its
 * command changes (or while `moving` is reported).
 */
export class ValveMotorVoice extends Voice {
  private g: GainNode;
  private runUntil = 0;
  private lvl = 0;
  private prevCmd = NaN;
  private oM?: OscillatorNode;

  constructor(core: AudioCore, name: string, pos: Vec3, private cmdVar: string, private travel: number, private dbLevel: number) {
    super(core, name);
    const pan = this.bus(core.panner(pos, 'eq', 1, 0), core.exteriorBus);
    this.g = core.gain(0, core.filter('bandpass', 1100, 1.1, pan));
    this.leak(this.g, db(-6));
  }

  update(dt: number, v: VarReader): void {
    const cmd = v.get(this.cmdVar);
    const now = this.core.now;
    // A 0/1 command runs the motor for its travel time; a position (0..1) runs it while it moves.
    if (!Number.isNaN(this.prevCmd) && cmd !== this.prevCmd && dcPowered(v)) {
      const step = Math.abs(cmd - this.prevCmd) >= 0.5;
      this.runUntil = Math.max(this.runUntil, now + (step ? this.travel : 0.3));
    }
    this.prevCmd = cmd;
    this.lvl = lag2(this.lvl, now < this.runUntil ? 1 : 0, dt, 0.05, 0.12);
    if (!this.run(this.lvl, dt)) return;
    this.set(this.g.gain, db(this.dbLevel) * this.lvl, 0.03);
    if (this.oM) this.set(this.oM.frequency, 150 + 12 * Math.sin(now * 9), 0.05);
  }

  protected build(): void {
    this.oM = this.core.osc('sawtooth', 150, this.g);
    this.srcs.push(this.oM);
  }

  protected override onStop(): void {
    this.oM = undefined;
  }
}
