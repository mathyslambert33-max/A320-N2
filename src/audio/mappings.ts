/**
 * Pure (DOM-free) helpers of the audio engine: sim state → sound parameters, envelopes, rhythm
 * generators. Everything here is unit tested (tests/audio/mappings.test.ts).
 *
 * Physical references used for the mappings (CFM56-5B / 131-9A / A320 systems):
 *  - CFM56-5B: N1 100 % = 5000 rpm, 36 fan blades → fan blade-passing frequency (BPF) 3000 Hz at 100 % N1,
 *    ≈ 590 Hz at ground idle (N1 ≈ 19.5 %). N2 100 % = 14460 rpm (241 Hz shaft).
 *    Auto start: start valve opens → N2 rises on the air turbine starter, igniter at ~16 % N2,
 *    fuel at ~22 % N2, light-off (EGT rise), start valve closes at ~50 % N2, idle ≈ 58-60 % N2.
 *  - APU 131-9A: 100 % ≈ 49 300 rpm (≈ 820 Hz shaft); DC electric starter, ignition ~7 %, starter cut-out
 *    ~55 %, AVAIL at 95 % + 2 s.
 *  - PTU "barking dog": the PTU repeatedly accelerates and stalls as the ΔP between green and yellow
 *    crosses its 500 psi threshold → pulsed low growls (~0.3-0.45 s) separated by ~0.5-1 s.
 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Hermite smoothstep between e0 and e1 (0 below, 1 above). */
export function smoothstep(e0: number, e1: number, x: number): number {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g <= 1e-9 ? -180 : 20 * Math.log10(g));

/** Perceptual volume curve for the settings sliders (0..1 → linear gain). */
export function volumeToGain(v: number): number {
  const x = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  // Roughly -40 dB at 0.1, -12 dB at 0.5, 0 dB at 1 (x^2 curve).
  return x * x;
}

/** First-order lag with separate rise / fall time constants (s). */
export function lag2(cur: number, target: number, dt: number, tauUp: number, tauDown: number): number {
  const tau = target > cur ? tauUp : tauDown;
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Deterministic PRNG (mulberry32) — tests and reproducible buffers. Returns floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ envelopes */

/**
 * Linear-attack / exponential-decay envelope used by one-shot buffers.
 * attack s, decay = time constant s; returns 0 before t=0.
 */
export function attackDecay(t: number, attack: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return attack <= 0 ? 1 : t / attack;
  return Math.exp(-(t - attack) / Math.max(1e-6, decay));
}

/**
 * Sustained note envelope (attack, sustain, release; total `dur` includes the release).
 * Uses raised-cosine edges so the waveform never jumps (no clicks).
 */
export function noteEnv(t: number, dur: number, attack: number, release: number): number {
  if (t < 0 || t > dur) return 0;
  const a = Math.max(1e-4, attack);
  const r = Math.max(1e-4, release);
  if (t < a) return 0.5 - 0.5 * Math.cos((Math.PI * t) / a);
  if (t > dur - r) return 0.5 - 0.5 * Math.cos((Math.PI * (dur - t)) / r);
  return 1;
}

/* ------------------------------------------------------------------ engines (CFM56-5B) */

export const CFM = {
  N1_RPM_100: 5000,
  N2_RPM_100: 14460,
  FAN_BLADES: 36,
  IDLE_N2: 58.5,
  IDLE_N1: 19.5,
  IDLE_FF: 290, // kg/h per engine at ground idle
};

/** Fan blade-passing frequency (Hz) for N1 in %. */
export const engFanBpfHz = (n1: number) => (clamp(n1, 0, 120) / 100) * (CFM.N1_RPM_100 / 60) * CFM.FAN_BLADES;
/** Fan shaft rotation frequency (Hz) — the "buzz-saw" fundamental at high N1. */
export const engFanShaftHz = (n1: number) => (clamp(n1, 0, 120) / 100) * (CFM.N1_RPM_100 / 60);
/** HP spool shaft frequency (Hz). */
export const engCoreShaftHz = (n2: number) => (clamp(n2, 0, 120) / 100) * (CFM.N2_RPM_100 / 60);
/**
 * The audible "core whine" (HP compressor / accessory gearbox tones as heard through the fuselage):
 * rises from ~100 Hz at 0 % to ≈ 1.4 kHz at idle and ~2.3 kHz at 100 % N2.
 */
export const engCoreWhineHz = (n2: number) => 90 + clamp(n2, 0, 120) * 22.5;
/** Air turbine starter whine (geared ~4.5:1 above the HP spool) — only while the start valve is open. */
export const engStarterHz = (n2: number) => 160 + clamp(n2, 0, 70) * 52;

export interface EngineInput {
  n1: number;
  n2: number;
  egt: number;
  ff: number;
  startValve: number; // 0..1
  oat: number;
}

export interface EngineLevels {
  /** Bleed air rushing into the starter duct (start valve open). */
  airRush: number;
  /** Air turbine starter whine. */
  starter: number;
  /** HP core whine. */
  core: number;
  /** Fan tone (BPF). */
  fanTone: number;
  /** Fan broadband roar. */
  fanBroad: number;
  /** Combustion / exhaust rumble. */
  combustion: number;
  /** Buzz-saw (multiple pure tones) — only at high N1. */
  buzz: number;
}

/** Linear levels 0..~1 of each engine component (relative, before the voice's master gain). */
export function engineLevels(e: EngineInput): EngineLevels {
  const n2 = clamp(e.n2, 0, 120);
  const n1 = clamp(e.n1, 0, 120);
  const sv = clamp(e.startValve, 0, 1);
  // Starter air: builds as soon as the valve opens; the starter unloads a bit as N2 rises.
  const airRush = sv * (0.55 + 0.45 * smoothstep(0, 20, n2)) * (1 - 0.35 * smoothstep(35, 55, n2));
  const starter = sv * smoothstep(0.5, 12, n2) * (0.6 + 0.4 * smoothstep(10, 45, n2));
  const core = smoothstep(1, 25, n2) * (0.35 + 0.65 * smoothstep(15, 60, n2)) * (1 + 0.6 * smoothstep(60, 100, n2));
  const fanTone = smoothstep(3, 19, n1) * (0.5 + 0.5 * smoothstep(15, 60, n1)) * (1 + 1.5 * smoothstep(40, 100, n1));
  const fanBroad = smoothstep(2, 20, n1) * (0.35 + 0.65 * Math.pow(n1 / 100, 1.3) * 3);
  // Combustion: needs fuel flow and hot EGT.
  const hot = smoothstep(e.oat + 40, e.oat + 250, e.egt);
  const fuel = smoothstep(20, CFM.IDLE_FF, e.ff);
  const combustion = hot * fuel * (0.7 + 0.3 * smoothstep(CFM.IDLE_FF, CFM.IDLE_FF * 6, e.ff) * 4);
  const buzz = smoothstep(75, 95, n1);
  return { airRush, starter, core, fanTone, fanBroad, combustion, buzz };
}

/**
 * Light-off detection: returns true on the tick where combustion is first established
 * (fuel flowing, EGT rising above ambient + 60 °C) after being unlit.
 */
export function isLit(e: { egt: number; ff: number; oat: number }): boolean {
  return e.ff > 30 && e.egt > e.oat + 60;
}

/* ------------------------------------------------------------------ APU (131-9A) */

/** Main turbine whine (Hz) heard from the tail cone. */
export const apuWhineHz = (n: number) => 120 + clamp(n, 0, 110) * 27;
/** Shaft tone (Hz). */
export const apuShaftHz = (n: number) => (clamp(n, 0, 110) / 100) * (49300 / 60);
/** DC starter motor whine (Hz) — geared to the APU shaft. */
export const apuStarterHz = (n: number) => 70 + clamp(n, 0, 60) * 13;

export interface ApuLevels {
  starter: number;
  whine: number;
  roar: number;
  combustion: number;
}

export function apuLevels(a: { n: number; egt: number; starting: number; bleed: number; oat: number }): ApuLevels {
  const n = clamp(a.n, 0, 110);
  // Starter engaged from 0 to ~55 % during the start sequence.
  const starter = (a.starting > 0 ? 1 : 0) * smoothstep(0, 4, n) * (1 - smoothstep(50, 58, n));
  const whine = smoothstep(2, 40, n) * (0.4 + 0.6 * smoothstep(30, 100, n));
  const roar = smoothstep(5, 100, n) * (1 + 0.35 * clamp(a.bleed, 0, 1));
  const combustion = smoothstep(a.oat + 60, a.oat + 350, a.egt) * smoothstep(5, 20, n);
  return { starter, whine, roar, combustion };
}

/* ------------------------------------------------------------------ PTU barking */

export interface Bark {
  /** Delay from the previous bark end to this bark start (s). */
  gap: number;
  /** Bark duration (s). */
  dur: number;
  /** Shaft frequency at bark start / peak (Hz). */
  f0: number;
  fPeak: number;
  /** Relative amplitude 0..1. */
  amp: number;
}

/**
 * Next bark of the PTU "barking dog". `n` = bark index since the PTU became active; the first
 * barks are the strongest and most spaced, then the rhythm tightens and softens.
 */
export function nextBark(rnd: () => number, n: number): Bark {
  const settle = clamp(n / 8, 0, 1);
  return {
    gap: n === 0 ? 0 : lerp(0.55, 0.28, settle) + rnd() * lerp(0.5, 0.25, settle),
    dur: 0.28 + rnd() * 0.17,
    f0: 38 + rnd() * 6,
    fPeak: 88 + rnd() * 22 - 12 * settle,
    amp: lerp(1, 0.7, settle) * (0.85 + 0.15 * rnd()),
  };
}

/* ------------------------------------------------------------------ openings / hull transmission */

export interface OpeningsInput {
  windowCapt: number; // 0..1
  windowFo: number;
  doorL1: number; // 0..1
  ckptDoor: number; // 0..1 (open)
  jetbridge: number; // 0/1 docked
}

export interface Openings {
  /** Leak gains of the openings (0..1). */
  windowCapt: number;
  windowFo: number;
  /** Path cabin → cockpit door → L1 door → outside. */
  door: number;
  /** Cutoff of the through-the-hull low-pass (Hz). */
  hullCutoff: number;
  /** Gain of the through-the-hull path. */
  hullGain: number;
  /** Low-pass cutoff on the door path (Hz) — jet bridge tunnel muffles the apron. */
  doorCutoff: number;
}

export function openings(o: OpeningsInput): Openings {
  // A sliding window opens as a large gap next to the ear: the leak rises steeply with the first cm.
  const w = (x: number) => Math.sqrt(clamp(x, 0, 1));
  const door = clamp(o.doorL1, 0, 1) * clamp(o.ckptDoor, 0, 1);
  const open = clamp(Math.max(w(o.windowCapt), w(o.windowFo)) + 0.3 * door, 0, 1);
  return {
    windowCapt: w(o.windowCapt),
    windowFo: w(o.windowFo),
    door: door * (o.jetbridge > 0.5 ? 0.55 : 1),
    hullCutoff: lerp(650, 1100, open),
    hullGain: lerp(1, 1.25, open),
    doorCutoff: o.jetbridge > 0.5 ? 1400 : 4500,
  };
}

/* ------------------------------------------------------------------ diesel engines (tug, GPU) */

/** Firing frequency of a 4-stroke diesel (Hz). */
export const dieselFiringHz = (rpm: number, cylinders: number) => (rpm / 60) * (cylinders / 2);

/* ------------------------------------------------------------------ wipers */

export interface WiperTrack {
  pos: number;
  vel: number;
  dir: number;
}

/**
 * Update a wiper tracker with a new blade position. Returns 'reverse' when the blade changes
 * direction (end-of-stroke thump), else null.
 */
export function trackWiper(t: WiperTrack, pos: number, dt: number): 'reverse' | null {
  if (dt <= 0) return null;
  const v = (pos - t.pos) / dt;
  t.pos = pos;
  t.vel = t.vel + (v - t.vel) * clamp(dt / 0.05, 0, 1);
  const dir = Math.abs(v) < 0.02 ? 0 : Math.sign(v);
  let ev: 'reverse' | null = null;
  if (dir !== 0 && t.dir !== 0 && dir !== t.dir) ev = 'reverse';
  if (dir !== 0) t.dir = dir;
  return ev;
}

/* ------------------------------------------------------------------ fans */

/**
 * Avionics ventilation fan speed dynamics (normalised 0..1): AC induction motors reach speed in
 * ~2-3 s and coast down in ~6-8 s.
 */
export function fanSpin(cur: number, on: boolean, dt: number): number {
  return lag2(cur, on ? 1 : 0, dt, 0.9, 2.6);
}

/** Relative level of a fan given its normalised speed (aero noise ∝ speed^5 in dB terms → ~speed^2.5 amplitude). */
export const fanLevel = (speed: number) => Math.pow(clamp(speed, 0, 1.2), 2.5);

/* ------------------------------------------------------------------ misc */

/** Scheduling helper: stable repeating clock (returns the next tick time after `now`). */
export function nextTick(last: number, period: number, now: number): number {
  if (period <= 0) return now;
  let t = last + period;
  if (t < now) t = now + ((period - ((now - last) % period)) % period);
  return t;
}
