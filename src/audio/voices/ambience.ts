/**
 * Exterior airport ambience at LFBD: distant jet rumble bed, wind around the nose, a neighbour's APU at
 * the adjacent stand (comes and goes), and random events (distant take-off roll on RWY 23, a jet taxiing
 * past, a ground vehicle reversing beeper, a jet starting its engines at a nearby stand).
 * Everything is outside → heard through the hull (very faint) and through the openings (door / windows).
 */
import { AudioCore, Voice, db, setPannerPos, type VarReader, type Vec3 } from '../core';
import { clamp, lag2 } from '../mappings';

type EventKind = 'takeoff' | 'taxi' | 'beeper' | 'engstart';

interface Live { end: number; nodes: AudioNode[]; srcs: AudioScheduledSourceNode[] }

export class AirportAmbience extends Voice {
  private gBedL: GainNode; private gBedR: GainNode; private gFar: GainNode; private gWind: GainNode;
  private gWindLo: GainNode; private gWindHi: GainNode; private gNb: GainNode;
  private gust = 0.5;
  private gustT = 0.5;
  private bed = 1;
  private nbOn = 0;
  private nbTimer = 30;
  private nextEvent = 0;
  private live: Live[] = [];
  private night = false;

  constructor(core: AudioCore, private isNight: () => boolean) {
    super(core, 'ambience');
    this.idleStop = 5;
    const mk = (pos: Vec3, leakDb: number) => {
      const p = this.bus(core.panner(pos, 'eq', 1, 0), core.exteriorBus);
      const g = core.gain(0, p);
      this.leak(g, db(leakDb));
      return g;
    };
    this.gBedL = mk([-60, -3, -40], 0);
    this.gBedR = mk([60, -3, 20], 0);
    this.gFar = mk([-200, 0, -300], 0);
    this.gWind = mk([0, 1.8, -1.5], 0);
    // Two fixed bands cross-faded by the gusts (no per-sample filter automation → cheap).
    this.gWindLo = core.gain(0, core.filter('bandpass', 330, 0.7, this.gWind));
    this.gWindHi = core.gain(0, core.filter('bandpass', 720, 0.8, this.gWind));
    this.gNb = mk([45, -1, 15], 0);
  }

  update(dt: number, v: VarReader): void {
    this.night = this.isNight();
    if (!this.run(1, dt)) return;
    const now = this.core.now;
    // Wind gusts: smooth random walk.
    if (Math.random() < dt / 2.5) this.gustT = 0.3 + Math.random() * 0.9;
    this.gust = lag2(this.gust, this.gustT, dt, 1.2, 1.8);
    const kt = v.has('G:ENV_WIND_KT') ? v.get('G:ENV_WIND_KT') : 6;
    const w = clamp(kt / 12, 0.1, 2.5);
    this.set(this.gWind.gain, db(-33) * w * this.gust, 0.3);
    const hi = clamp((this.gust - 0.3) / 0.9, 0, 1) * Math.min(1, Math.sqrt(w));
    this.set(this.gWindLo.gain, 1 - 0.5 * hi, 0.4);
    this.set(this.gWindHi.gain, 0.3 + 0.9 * hi, 0.4);
    // Distant jets bed: slow breathing.
    if (Math.random() < dt / 6) this.bed = 0.7 + Math.random() * 0.6;
    const bedDb = this.night ? -36 : -31;
    this.set(this.gBedL.gain, db(bedDb) * this.bed, 2);
    this.set(this.gBedR.gain, db(bedDb) * (1.6 - this.bed * 0.6), 2);
    this.set(this.gFar.gain, db(this.night ? -44 : -38) * this.bed, 2);
    // Neighbour APU comes and goes (minutes).
    this.nbTimer -= dt;
    if (this.nbTimer <= 0) {
      this.nbOn = this.nbOn > 0 ? 0 : 1;
      this.nbTimer = this.nbOn ? 90 + Math.random() * 240 : 60 + Math.random() * 200;
    }
    this.set(this.gNb.gain, db(-33) * this.nbOn * (this.night ? 0.6 : 1), 4);
    // Random events.
    if (this.nextEvent === 0) this.nextEvent = now + 8 + Math.random() * 20;
    this.live = this.live.filter((l) => {
      if (l.end < now) {
        for (const n of l.nodes) n.disconnect();
        return false;
      }
      return true;
    });
    if (now >= this.nextEvent && this.live.length < 3) {
      const r = Math.random();
      const kind: EventKind = r < 0.3 ? 'takeoff' : r < 0.6 ? 'taxi' : r < 0.85 ? 'beeper' : 'engstart';
      this.spawn(kind, now + 0.05);
      const mean = this.night ? 100 : 40;
      this.nextEvent = now + mean * (0.4 + Math.random() * 1.2);
    }
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.noise('brown', c.filter('lowpass', 200, 0.5, this.gBedL)));
    this.srcs.push(c.noise('brown', c.filter('lowpass', 180, 0.5, this.gBedR)));
    this.srcs.push(c.noise('pink', c.filter('bandpass', 700, 0.3, this.gFar)));
    this.srcs.push(c.noise('white', [this.gWindLo, this.gWindHi]));
    // Neighbour APU: turbine whine + exhaust roar.
    this.srcs.push(c.osc([1, 0.4, 0.3, 0.15], 2870, c.gain(0.08, this.gNb)));
    this.srcs.push(c.noise('pink', c.gain(0.6, c.filter('bandpass', 950, 0.5, this.gNb))));
  }

  protected override onStop(): void {
    for (const l of this.live) for (const s of l.srcs) try { s.stop(); } catch { /* */ }
    this.live = [];
  }

  /** Spawn a transient distant event (own nodes, released at the end). */
  private spawn(kind: EventKind, t: number): void {
    const c = this.core;
    const nodes: AudioNode[] = [];
    const srcs: AudioScheduledSourceNode[] = [];
    const pan = c.panner([0, 0, -500], 'eq', 1, 0, c.exteriorBus);
    const env = c.gain(0, pan);
    const leak = c.gain(1, c.extMono);
    env.connect(leak);
    nodes.push(pan, env, leak);
    const g = env.gain;
    const moveP = (a: Vec3, b: Vec3, t0: number, t1: number) => {
      setPannerPos(pan, a, t0);
      if (pan.positionX) {
        pan.positionX.linearRampToValueAtTime(b[0], t1);
        pan.positionY.linearRampToValueAtTime(b[1], t1);
        pan.positionZ.linearRampToValueAtTime(b[2], t1);
      }
    };
    const noise = (color: 'pink' | 'brown' | 'white', dest: AudioNode, end: number) => {
      const s = c.ctx.createBufferSource();
      s.buffer = c.noiseBuffer(color);
      s.loop = true;
      s.connect(dest);
      s.start(t, Math.random() * s.buffer.duration);
      s.stop(end);
      srcs.push(s);
    };
    const osc = (kindO: OscillatorType | number[], hz: number, dest: AudioNode, end: number) => {
      const o = c.ctx.createOscillator();
      if (Array.isArray(kindO)) o.setPeriodicWave(c.wave(kindO));
      else o.type = kindO;
      o.frequency.value = hz;
      o.connect(dest);
      o.start(t);
      o.stop(end);
      srcs.push(o);
      return o;
    };
    let end = t;
    if (kind === 'takeoff') {
      // Take-off roll on RWY 23 ~1.2 km away: roar builds, passes, fades (≈ 45 s).
      const dur = 45;
      end = t + dur;
      const peak = db(this.night ? -30 : -27);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak * 0.5, t + 6);
      g.linearRampToValueAtTime(peak, t + 18);
      g.linearRampToValueAtTime(peak * 0.4, t + 30);
      g.linearRampToValueAtTime(0, t + dur);
      const lr = Math.random() < 0.5 ? -1 : 1;
      moveP([lr * -900, 0, -800], [lr * 900, 150, -1200], t, t + dur);
      const lp = c.filter('lowpass', 500, 0.5, env);
      nodes.push(lp);
      noise('brown', lp, end);
      const pg = c.gain(0.35, env);
      const lp2 = c.filter('bandpass', 1100, 0.5, pg);
      nodes.push(lp2, pg);
      noise('pink', lp2, end);
    } else if (kind === 'taxi') {
      // A jet taxiing past on the apron/taxiway ~150 m away (≈ 30 s): idle whine + roar.
      const dur = 30;
      end = t + dur;
      const peak = db(-30);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + dur * 0.5);
      g.linearRampToValueAtTime(0, t + dur);
      const lr = Math.random() < 0.5 ? -1 : 1;
      moveP([lr * -300, -2, -150], [lr * 300, -2, -120], t, t + dur);
      const bp = c.filter('bandpass', 800, 0.5, env);
      nodes.push(bp);
      noise('pink', bp, end);
      const wg = c.gain(0.12, env);
      nodes.push(wg);
      const o = osc([1, 0.5, 0.25], 1250, wg, end);
      // Doppler-ish pitch drift.
      o.frequency.setValueAtTime(1290, t);
      o.frequency.linearRampToValueAtTime(1210, t + dur);
    } else if (kind === 'beeper') {
      // Ground vehicle reversing beeper (≈ 1.15 kHz, 1 Hz), 5-9 s, 20-50 m away.
      const dur = 5 + Math.random() * 4;
      end = t + dur;
      const pos: Vec3 = [(Math.random() - 0.5) * 60, -3, -10 + Math.random() * 40];
      moveP(pos, pos, t, t + dur);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(db(-34), t + 0.3);
      g.setValueAtTime(db(-34), t + dur - 0.3);
      g.linearRampToValueAtTime(0, t + dur);
      const gate = c.gain(0, env);
      nodes.push(gate);
      for (let k = t + 0.1; k < t + dur - 0.2; k += 1.0) {
        gate.gain.setValueAtTime(0, k);
        gate.gain.linearRampToValueAtTime(1, k + 0.01);
        gate.gain.setValueAtTime(1, k + 0.5);
        gate.gain.linearRampToValueAtTime(0, k + 0.51);
      }
      const lp = c.filter('lowpass', 4000, 0.7, gate);
      nodes.push(lp);
      osc('square', 1150, lp, end);
    } else {
      // A jet at a nearby stand starting an engine (≈ 50 s): starter whine rising, light-off rumble.
      const dur = 50;
      end = t + dur;
      const pos: Vec3 = [(Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 80), -2, 30 + Math.random() * 60];
      moveP(pos, pos, t, t + dur);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(db(-36), t + 5);
      g.linearRampToValueAtTime(db(-31), t + 30);
      g.setValueAtTime(db(-31), t + dur - 8);
      g.linearRampToValueAtTime(0, t + dur);
      const wg = c.gain(0.15, env);
      nodes.push(wg);
      const o = osc([1, 0.5, 0.3, 0.15], 300, wg, end);
      o.frequency.setValueAtTime(300, t);
      o.frequency.linearRampToValueAtTime(900, t + 18);
      o.frequency.linearRampToValueAtTime(1350, t + 35);
      const rlp = c.filter('lowpass', 300, 0.5, env);
      const rg = c.gain(0, rlp);
      nodes.push(rg, rlp);
      rg.gain.setValueAtTime(0, t + 14);
      rg.gain.linearRampToValueAtTime(1, t + 20);
      noise('brown', rg, end);
    }
    this.live.push({ end: end + 0.5, nodes, srcs });
  }

  /** Debug / self-test: trigger an event now. */
  trigger(kind: EventKind): void {
    if (!this.running) return;
    this.spawn(kind, this.core.now + 0.05);
  }
}
