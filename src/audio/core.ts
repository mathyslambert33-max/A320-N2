/**
 * Web Audio plumbing shared by all voices: mixing buses, hull transmission, leak paths through the
 * openings (sliding windows, cockpit door + L1 door), helpers to create nodes, and the Voice base class
 * (sources are created on demand and stopped when a voice has been silent for a while).
 *
 * Routing
 *
 *   interior voices ──panner(HRTF)──► interior ─┐
 *   clicks (pool) ─────────────────────► interior ┤
 *   exterior voices ─panner──► exteriorBus ─► hull LP ─► hullGain ─┤
 *                   └─(mono)─► extMono ─┬► winCapt LP ► gain ► panner(window L) ─┤
 *                                       ├► winFo ...                              ├► cockpitBus ─► master ─► limiter ─► out
 *                                       └► door LP ► gain ► panner(cockpit door) ┤
 *   cabin sounds ─► cabinIn ─► door LP ─► gain ─► panner(cockpit door) ──────────┘
 *   FWC alerts ─► alertBus ─► loudspeaker panners (CAPT, F/O) ─► master   (+ small room reverb)
 *
 * All positions are in the aircraft BODY frame (metres, +X right, +Y up, −Z forward); the listener is
 * placed in the same frame (camera pose relative to app.aircraft), so the geometry is identical to
 * world space and nothing needs updating when the aircraft is pushed back.
 */
import { loopNoise, renderRoomIR, type Mono, type NoiseColor } from './synth';
import { dbToGain } from './mappings';

export type Vec3 = readonly [number, number, number];

/** Leak path through an opening: src → low-pass → gain → panner (linked only while open). */
export interface Leak {
  lp: BiquadFilterNode;
  gain: GainNode;
  pan: PannerNode;
  linked: boolean;
  /** Audio time since which the opening has been closed (0 = open). */
  offSince: number;
}

/** Reads a sim variable (with self-test overrides). */
export interface VarReader {
  get(name: string): number;
  has(name: string): boolean;
}

/** Body-frame positions of the sound sources (m). */
export const POS = {
  captEye: [-0.53, 1.18, 0] as Vec3,
  avionicsBay: [0.1, -1.1, 1.3] as Vec3,
  elecBay: [0.3, -1.05, 0.5] as Vec3,
  panelGrille: [0, 0.9, -0.95] as Vec3,
  ovhdVent: [0, 2.05, -0.25] as Vec3,
  sideVentCapt: [-0.95, 1.35, 0.3] as Vec3,
  sideVentFo: [0.95, 1.35, 0.3] as Vec3,
  floorDuct: [0, -0.4, 1.2] as Vec3,
  loudspeakerCapt: [-0.85, 1.62, -0.1] as Vec3,
  loudspeakerFo: [0.85, 1.62, -0.1] as Vec3,
  ckptDoor: [0, 1.0, 1.75] as Vec3,
  cabin: [0, 1.0, 5] as Vec3,
  eng1: [-5.75, -1.7, 12.5] as Vec3,
  eng2: [5.75, -1.7, 12.5] as Vec3,
  apu: [0, 1.4, 32] as Vec3,
  ptu: [0.4, -2.2, 12.8] as Vec3,
  yPump: [1.1, -2.2, 13.2] as Vec3,
  bPump: [-1.1, -2.2, 13.2] as Vec3,
  packs: [0, -2.1, 11] as Vec3,
  fuelPumps: [0, -1.6, 12] as Vec3,
  xfeed: [0, -1.8, 12] as Vec3,
  windowCapt: [-0.98, 1.25, -0.15] as Vec3,
  windowFo: [0.98, 1.25, -0.15] as Vec3,
  wiperCapt: [-0.55, 1.2, -1.2] as Vec3,
  wiperFo: [0.55, 1.2, -1.2] as Vec3,
  doorL1: [-1.9, 0.9, 3.4] as Vec3,
  jetbridge: [-4.5, 0.6, 3.4] as Vec3,
  tug: [0, -2.7, -5.5] as Vec3,
  gpu: [2.8, -2.9, -1.2] as Vec3,
  noseGear: [0, -2.4, 2.4] as Vec3,
};

export class AudioCore {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly muteGain: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly cockpitBus: GainNode;
  readonly alertBus: GainNode;
  readonly interior: GainNode;
  readonly exteriorBus: GainNode;
  readonly extMono: GainNode;
  readonly cabinIn: GainNode;
  readonly reverbIn: GainNode;
  readonly hull: { lp: BiquadFilterNode; shelf: BiquadFilterNode; gain: GainNode };
  readonly leak: {
    winCapt: Leak;
    winFo: Leak;
    door: Leak;
    cabin: Leak;
  };
  /** While a voice builds its sources, helper nodes created here are recorded (released on stop). */
  capture: AudioNode[] | null = null;
  private noiseBufs = new Map<NoiseColor, AudioBuffer>();
  private waves = new Map<string, PeriodicWave>();

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -4;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;
    this.limiter.connect(ctx.destination);
    this.muteGain = this.gain(1, this.limiter);
    this.master = this.gain(0.64, this.muteGain);
    this.cockpitBus = this.gain(0.64, this.master);
    this.alertBus = this.gain(0.81, undefined);
    this.interior = this.gain(1, this.cockpitBus);

    // Small damped flight-deck room.
    this.reverbIn = this.gain(1, undefined);
    const conv = ctx.createConvolver();
    const [l, r] = renderRoomIR(ctx.sampleRate);
    conv.buffer = this.buffer([l, r]);
    const rvOut = this.gain(0.22, this.master);
    this.reverbIn.connect(conv).connect(rvOut);

    // FWC loudspeakers (both sides; the captain hears mostly the left one).
    const lsC = this.panner(POS.loudspeakerCapt, 'eq', 0.5, 1, this.master);
    const lsF = this.panner(POS.loudspeakerFo, 'eq', 0.5, 1, this.master);
    this.alertBus.connect(lsC);
    this.alertBus.connect(lsF);
    const alertRv = this.gain(0.35, this.reverbIn);
    this.alertBus.connect(alertRv);

    // Through-the-hull path for everything outside the pressure hull (mass law: highs are lost).
    this.exteriorBus = this.gain(1, undefined);
    const lp = this.filter('lowpass', 800, 0.5);
    const shelf = this.filter('highshelf', 2500, 0.7);
    shelf.gain.value = -10;
    const hg = this.gain(1, this.cockpitBus);
    this.exteriorBus.connect(lp).connect(shelf).connect(hg);
    this.hull = { lp, shelf, gain: hg };

    // Leak paths through the openings.
    this.extMono = this.gain(1, undefined);
    this.extMono.channelCount = 1;
    this.extMono.channelCountMode = 'explicit';
    const mkLeak = (pos: Vec3, fc: number, src: AudioNode, mode: 'hrtf' | 'eq' = 'hrtf', linked = false): Leak => {
      const f = this.filter('lowpass', fc, 0.6);
      const pan = this.panner(pos, mode, 0.8, 1, this.cockpitBus);
      const g = this.gain(0);
      src.connect(f).connect(g);
      if (linked) g.connect(pan);
      return { lp: f, gain: g, pan, linked, offSince: 0 };
    };
    this.cabinIn = this.gain(1, undefined);
    this.leak = {
      winCapt: mkLeak(POS.windowCapt, 9000, this.extMono),
      winFo: mkLeak(POS.windowFo, 9000, this.extMono),
      door: mkLeak(POS.ckptDoor, 4500, this.extMono),
      cabin: mkLeak(POS.ckptDoor, 1000, this.cabinIn, 'eq', true),
    };
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  buffer(data: Mono | Mono[]): AudioBuffer {
    const chans = Array.isArray(data) ? data : [data];
    const b = this.ctx.createBuffer(chans.length, chans[0].length, this.ctx.sampleRate);
    chans.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  noiseBuffer(color: NoiseColor): AudioBuffer {
    let b = this.noiseBufs.get(color);
    if (!b) {
      const seed = color === 'white' ? 101 : color === 'pink' ? 202 : 303;
      b = this.buffer(loopNoise(this.ctx.sampleRate, color === 'brown' ? 6 : 4, color, seed));
      this.noiseBufs.set(color, b);
    }
    return b;
  }

  gain(v: number, dest?: AudioNode | AudioParam): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest as AudioNode);
    this.capture?.push(g);
    return g;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707, dest?: AudioNode): BiquadFilterNode {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    if (dest) n.connect(dest);
    this.capture?.push(n);
    return n;
  }

  /**
   * Panner at a body-frame position. 'hrtf' for close interior sources, 'eq' (equal-power) for
   * distant/diffuse ones. rolloff 0 → no distance attenuation (levels baked into the voice).
   */
  panner(pos: Vec3, mode: 'hrtf' | 'eq', ref = 1, rolloff = 0, dest?: AudioNode): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = mode === 'hrtf' ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 10000;
    setPannerPos(p, pos);
    if (dest) p.connect(dest);
    return p;
  }

  /** Cached PeriodicWave from harmonic amplitudes [h1, h2, h3, …] (sine phases). */
  wave(harmonics: number[]): PeriodicWave {
    const key = harmonics.join(',');
    let w = this.waves.get(key);
    if (!w) {
      const imag = new Float32Array(harmonics.length + 1);
      const real = new Float32Array(harmonics.length + 1);
      harmonics.forEach((a, i) => (imag[i + 1] = a));
      w = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
      this.waves.set(key, w);
    }
    return w;
  }

  /** Looping noise source started at a random offset (decorrelated between voices). */
  noise(color: NoiseColor, dest: AudioNode | AudioNode[], rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer(color);
    s.loop = true;
    s.playbackRate.value = rate;
    for (const d of Array.isArray(dest) ? dest : [dest]) s.connect(d);
    s.start(this.now, Math.random() * s.buffer.duration);
    return s;
  }

  osc(kind: OscillatorType | number[], hz: number, dest: AudioNode | AudioNode[] | AudioParam): OscillatorNode {
    const o = this.ctx.createOscillator();
    if (Array.isArray(kind)) o.setPeriodicWave(this.wave(kind));
    else o.type = kind;
    o.frequency.value = hz;
    for (const d of Array.isArray(dest) ? dest : [dest]) o.connect(d as AudioNode);
    o.start(this.now);
    return o;
  }

  /** Soft-clip waveshaper (drive ≥ 1). */
  shaper(drive: number, dest?: AudioNode): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    w.curve = c;
    w.oversample = 'none';
    if (dest) w.connect(dest);
    this.capture?.push(w);
    return w;
  }
}

/** Cancel future automation while holding the current value (no jump). */
export function hold(param: AudioParam, t: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else param.cancelScheduledValues(t);
}

export function setPannerPos(p: PannerNode, pos: Vec3, when?: number): void {
  if (p.positionX && when !== undefined) {
    p.positionX.setValueAtTime(pos[0], when);
    p.positionY.setValueAtTime(pos[1], when);
    p.positionZ.setValueAtTime(pos[2], when);
  } else if (p.positionX) {
    p.positionX.value = pos[0];
    p.positionY.value = pos[1];
    p.positionZ.value = pos[2];
  } else {
    (p as any).setPosition(pos[0], pos[1], pos[2]);
  }
}

/**
 * Base class for continuous voices: persistent graph (gains, filters, panners) + transient sources
 * created by `build()` when the voice becomes audible and stopped after `idleStop` s of silence.
 */
export abstract class Voice {
  running = false;
  protected srcs: AudioScheduledSourceNode[] = [];
  private silentFor = 0;
  private last = new Map<AudioParam, number>();
  protected idleStop = 1.5;
  private links: Array<[AudioNode, AudioNode]> = [];
  private owned: AudioNode[] = [];
  private linked = false;
  private gen = 0;

  constructor(protected readonly core: AudioCore, readonly name: string) {}

  /**
   * Register the connection of this voice's output to a shared bus. It is only made while the voice
   * runs: idle voice sub-graphs are detached from the rendering graph and cost no CPU at all.
   */
  protected bus<T extends AudioNode>(node: T, to: AudioNode): T {
    this.links.push([node, to]);
    if (this.linked) node.connect(to);
    return node;
  }

  /** Mono send of `from` into the exterior leak bus (openings), with a linear gain. */
  protected leak(from: AudioNode, gain: number): GainNode {
    const g = this.core.gain(gain);
    from.connect(g);
    this.bus(g, this.core.extMono);
    return g;
  }

  private setLinked(on: boolean): void {
    if (on === this.linked) return;
    this.linked = on;
    for (const [a, b] of this.links) {
      try {
        if (on) a.connect(b);
        else a.disconnect(b);
      } catch { /* already (dis)connected */ }
    }
  }

  abstract update(dt: number, v: VarReader): void;

  /** Create + start the source nodes (push them into this.srcs). */
  protected abstract build(): void;

  /** Called when sources are stopped (reset per-run state). */
  protected onStop(): void {}

  /** Manage start/stop from the voice's audible level (linear). Returns true when running. */
  protected run(level: number, dt: number): boolean {
    if (level > 1e-3) {
      this.silentFor = 0;
      if (!this.running) {
        this.running = true;
        this.gen++;
        this.last.clear();
        this.setLinked(true);
        this.owned = [];
        this.core.capture = this.owned;
        try {
          this.build();
        } finally {
          this.core.capture = null;
        }
      }
    } else if (this.running) {
      this.silentFor += dt;
      if (this.silentFor > this.idleStop) this.stop();
    }
    return this.running;
  }

  stop(): void {
    if (!this.running) return;
    const t = this.core.now + 0.05;
    for (const s of this.srcs) {
      try {
        s.stop(t);
      } catch { /* already stopped */ }
      const prev = s.onended;
      s.onended = (ev) => {
        if (prev) prev.call(s, ev);
        s.disconnect();
      };
    }
    this.srcs = [];
    this.running = false;
    this.last.clear();
    this.onStop();
    // Detach from the buses once the tails have died out (unless restarted meanwhile) and release the
    // helper nodes created by build().
    const g = ++this.gen;
    const owned = this.owned;
    this.owned = [];
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        for (const n of owned) n.disconnect();
        if (this.gen === g && !this.running) this.setLinked(false);
      }, 600);
    }
  }

  /** Smoothly drive an AudioParam toward `value` (skips redundant automation events). */
  protected set(param: AudioParam, value: number, tau = 0.08): void {
    if (!Number.isFinite(value)) return;
    const prev = this.last.get(param);
    if (prev !== undefined && Math.abs(value - prev) <= 2e-3 * Math.max(Math.abs(value), Math.abs(prev)) + 1e-7) return;
    this.last.set(param, value);
    param.setTargetAtTime(value, this.core.now, tau);
  }

  /** Set a param immediately (for freshly built sources). */
  protected jump(param: AudioParam, value: number): void {
    if (!Number.isFinite(value)) return;
    param.cancelScheduledValues(this.core.now);
    param.setValueAtTime(value, this.core.now);
    this.last.set(param, value);
  }
}

export const db = dbToGain;
