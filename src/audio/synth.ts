/**
 * Offline (pure JS, DOM-free) synthesis of the one-shot sounds: Airbus FWC aural alerts, cabin chime,
 * mechanical clicks of the cockpit controls, relays, light-off whump, noise loops, small-room impulse
 * response. Everything returns Float32Arrays at a given sample rate; the engine copies them into
 * AudioBuffers. Unit tested (tests/audio/synth.test.ts).
 *
 * Sound design notes (see docs/vars/audio.md):
 *  - Single chime (SC, amber caution): one bright electronic "ding", ~0.5 s audible, bell-like but
 *    harmonic (electronic tone generator), fundamental A5.
 *  - Continuous repetitive chime (CRC, red warning): the same chime, shorter decay, repeated ~2.7/s.
 *  - Cavalry charge (AP disconnect): brassy fast ascending bugle fanfare ("Charge!": sol-do-mi-sol, mi-sol),
 *    ~1.5 s per motif (FCOM: 1.5 s after an instinctive disconnect, continuous after a failure).
 *  - C chord (altitude alert): C-E-G organ-like chord, 1.5 s (continuous when deviating).
 *  - Click / triple click: short woody "tock" pulses (triple click = 3 pulses within 0.5 s).
 *  - Buzzer: harsh square buzz with 50 Hz rasp (cabin/mech call).
 *  - Cricket: 4 kHz chirps (stall), provided for completeness.
 */
import { attackDecay, clamp, mulberry32, noteEnv } from './mappings';

export type Mono = Float32Array;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ utils */

export function peak(buf: Mono): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(buf: Mono, from = 0, to = buf.length): number {
  let s = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / n);
}

export function normalize(buf: Mono, target = 0.9): Mono {
  const p = peak(buf);
  if (p > 0) {
    const k = target / p;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

/** Raised-cosine fade in / out (ms) — guarantees click-free starts and ends. */
export function fadeEdges(buf: Mono, sr: number, inMs: number, outMs: number): Mono {
  const ni = Math.min(buf.length, Math.round((inMs / 1000) * sr));
  const no = Math.min(buf.length, Math.round((outMs / 1000) * sr));
  for (let i = 0; i < ni; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / ni);
  for (let i = 0; i < no; i++) buf[buf.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / no);
  return buf;
}

/** Simple one-pole filters (in place). */
function onePoleLP(buf: Mono, sr: number, fc: number): void {
  const a = Math.exp((-TAU * fc) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i] + a * y;
    buf[i] = y;
  }
}
function onePoleHP(buf: Mono, sr: number, fc: number): void {
  const a = Math.exp((-TAU * fc) / sr);
  let y = 0;
  let xp = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    y = a * (y + x - xp);
    xp = x;
    buf[i] = y;
  }
}

/* ------------------------------------------------------------------ noise */

export type NoiseColor = 'white' | 'pink' | 'brown';

/**
 * Seamlessly loopable noise (the tail is equal-power cross-faded into the head).
 * RMS normalised to ~0.25.
 */
export function loopNoise(sr: number, seconds: number, color: NoiseColor, seed = 1): Mono {
  const rnd = mulberry32(seed);
  const n = Math.max(64, Math.round(seconds * sr));
  const x = Math.min(Math.round(0.05 * sr), n >> 2);
  const raw = new Float32Array(n + x);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'white') raw[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      // Leaky integrator (brown / red noise), DC-safe.
      br = 0.985 * br + w * 0.15;
      raw[i] = br;
    }
  }
  if (color === 'brown') onePoleHP(raw, sr, 12);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < x; i++) {
    const t = i / x;
    // head sample i blends tail sample n+i (which follows sample n-1 continuously)
    out[i] = raw[n + i] * Math.cos((t * Math.PI) / 2) + raw[i] * Math.sin((t * Math.PI) / 2);
  }
  const r = rms(out);
  if (r > 0) for (let i = 0; i < n; i++) out[i] *= 0.25 / r;
  return out;
}

/* ------------------------------------------------------------------ additive helpers */

interface Partial { ratio: number; amp: number; decay: number; detune?: number }

function addBell(out: Mono, sr: number, start: number, f0: number, partials: Partial[], attack: number, gain: number, rnd: () => number): void {
  const i0 = Math.round(start * sr);
  for (const p of partials) {
    const f = f0 * p.ratio * (1 + (p.detune ?? 0));
    if (f >= sr * 0.45) continue;
    const ph = rnd() * TAU;
    const len = Math.min(out.length - i0, Math.round((p.decay * 7 + attack) * sr));
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      out[i0 + i] += gain * p.amp * attackDecay(t, attack, p.decay) * Math.sin(TAU * f * t + ph);
    }
  }
}

/** Band-limited sawtooth-like brass tone with a brightness envelope. */
function addBrassNote(out: Mono, sr: number, start: number, dur: number, f: number, gain: number): void {
  const i0 = Math.round(start * sr);
  const len = Math.min(out.length - i0, Math.round(dur * sr));
  const nH = Math.max(1, Math.min(14, Math.floor((sr * 0.45) / f)));
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = noteEnv(t, dur, 0.012, 0.03);
    // Pitch scoop at the onset (lip attack) + light vibrato on long notes.
    const scoop = 1 - 0.03 * Math.exp(-t / 0.018);
    const vib = 1 + 0.004 * Math.sin(TAU * 5.8 * t) * Math.min(1, t / 0.15);
    const bright = 0.45 + 0.55 * Math.min(1, t / 0.03);
    const ph = TAU * f * scoop * vib * t;
    let s = 0;
    for (let h = 1; h <= nH; h++) {
      // Brass spectrum: strong low harmonics, rolled off above the 6th; brightness opens with the attack.
      const a = (h <= 3 ? 1 / h : Math.pow(bright, (h - 3) * 0.5) / Math.pow(h, 1.15));
      s += a * Math.sin(h * ph);
    }
    out[i0 + i] += gain * env * s;
  }
}

/* ------------------------------------------------------------------ FWC aural alerts */

export const CHIME_F0 = 880; // A5
export const CRC_PERIOD = 0.37; // s between chimes of the continuous repetitive chime
export const CAVALRY_NOTES: Array<[number, number]> = [
  // [frequency Hz, duration s] — "Charge!" bugle motif transposed to C5, played fast.
  [523.25, 0.1], [698.46, 0.1], [880.0, 0.1], [1046.5, 0.27], [880.0, 0.1], [1046.5, 0.62],
];
export const CAVALRY_PERIOD = 1.5;
export const CCHORD_FREQS = [523.25, 659.26, 783.99];

const CHIME_PARTIALS: Partial[] = [
  { ratio: 1, amp: 1, decay: 0.34 },
  { ratio: 2, amp: 0.3, decay: 0.2, detune: 0.0015 },
  { ratio: 3, amp: 0.11, decay: 0.12 },
  { ratio: 4.16, amp: 0.06, decay: 0.07 },
  { ratio: 5.43, amp: 0.035, decay: 0.045 },
];

/** Single chime (amber caution). */
export function renderSingleChime(sr: number, seed = 7): Mono {
  const out = new Float32Array(Math.round(1.1 * sr));
  addBell(out, sr, 0, CHIME_F0, CHIME_PARTIALS, 0.004, 1, mulberry32(seed));
  return fadeEdges(normalize(out, 0.8), sr, 0.5, 60);
}

/** One chime of the continuous repetitive chime (red warning) — to be re-triggered every CRC_PERIOD. */
export function renderCrcChime(sr: number, seed = 9): Mono {
  const out = new Float32Array(Math.round(0.6 * sr));
  const partials = CHIME_PARTIALS.map((p) => ({ ...p, decay: p.decay * 0.62 }));
  addBell(out, sr, 0, CHIME_F0, partials, 0.003, 1, mulberry32(seed));
  return fadeEdges(normalize(out, 0.8), sr, 0.5, 60);
}

/** Cavalry charge: one motif followed by silence up to CAVALRY_PERIOD (loopable by re-triggering). */
export function renderCavalry(sr: number): Mono {
  const out = new Float32Array(Math.round(CAVALRY_PERIOD * sr));
  let t = 0.005;
  for (const [f, d] of CAVALRY_NOTES) {
    addBrassNote(out, sr, t, d - 0.008, f, 1);
    t += d;
  }
  // Mild saturation like a small loudspeaker driven hard.
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 0.9);
  onePoleLP(out, sr, 7000);
  return fadeEdges(normalize(out, 0.8), sr, 0.5, 20);
}

/** Frequency rounded to an integer number of cycles over `len` seconds (seamless loops). */
const loopFreq = (f: number, len: number) => Math.round(f * len) / len;

/**
 * C chord (altitude alert). `dur` seconds with soft edges, or — when `loop` — a seamlessly loopable
 * 2 s sustain segment (no edges).
 */
export function renderCChord(sr: number, dur = 1.5, loop = false): Mono {
  const len = loop ? 2 : dur;
  const out = new Float32Array(Math.round(len * sr));
  const freqs = CCHORD_FREQS.map((f) => (loop ? loopFreq(f, len) : f));
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    const ph = k * 1.3;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const env = loop ? 1 : noteEnv(t, dur, 0.03, 0.09);
      // Organ-like: fundamental + weak odd/even harmonics.
      const x = TAU * f * t + ph;
      out[i] += env * (Math.sin(x) + 0.28 * Math.sin(2 * x) + 0.16 * Math.sin(3 * x) + 0.06 * Math.sin(5 * x));
    }
  }
  return normalize(out, 0.75);
}

function addTock(out: Mono, sr: number, start: number, gain: number, rnd: () => number): void {
  addBell(out, sr, start, 1650, [
    { ratio: 1, amp: 1, decay: 0.009 },
    { ratio: 1.78, amp: 0.55, decay: 0.006 },
    { ratio: 3.1, amp: 0.25, decay: 0.003 },
  ], 0.0006, gain, rnd);
  const i0 = Math.round(start * sr);
  for (let i = 0; i < Math.round(0.004 * sr) && i0 + i < out.length; i++) {
    out[i0 + i] += gain * 0.35 * (rnd() * 2 - 1) * Math.exp(-i / (0.0008 * sr));
  }
}

/** FWC "click" (single pulse). */
export function renderFwcClick(sr: number): Mono {
  const out = new Float32Array(Math.round(0.12 * sr));
  addTock(out, sr, 0.001, 1, mulberry32(3));
  return fadeEdges(normalize(out, 0.7), sr, 0.1, 10);
}

/** FWC "triple click" (3 pulses within 0.5 s). */
export function renderTripleClick(sr: number): Mono {
  const out = new Float32Array(Math.round(0.55 * sr));
  const rnd = mulberry32(4);
  for (const t of [0.001, 0.166, 0.332]) addTock(out, sr, t, 1, rnd);
  return fadeEdges(normalize(out, 0.7), sr, 0.1, 10);
}

/**
 * Buzzer: square-ish 370 Hz tone with a 50 Hz rasp. `loop` → seamless 1 s segment.
 */
export function renderBuzzer(sr: number, dur = 1.2, loop = false): Mono {
  const len = loop ? 1 : dur;
  const out = new Float32Array(Math.round(len * sr));
  const f = loop ? loopFreq(370, len) : 370;
  const nH = Math.floor((sr * 0.4) / f);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let s = 0;
    for (let h = 1; h <= nH; h += 2) s += Math.sin(TAU * f * h * t) / h;
    const rasp = 0.75 + 0.25 * Math.sign(Math.sin(TAU * 50 * t));
    const env = loop ? 1 : noteEnv(t, dur, 0.006, 0.02);
    out[i] = env * s * rasp;
  }
  onePoleLP(out, sr, 5000);
  return normalize(out, 0.6);
}

/** Cricket (stall warning): 3 chirps per 0.5 s cycle, loopable (1 s). */
export function renderCricket(sr: number): Mono {
  const out = new Float32Array(Math.round(1 * sr));
  for (const c0 of [0, 0.5]) {
    for (let k = 0; k < 3; k++) {
      const t0 = c0 + k * 0.045;
      const i0 = Math.round(t0 * sr);
      const n = Math.round(0.03 * sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        out[i0 + i] += noteEnv(t, 0.03, 0.004, 0.008) * Math.sin(TAU * 4200 * t) * (0.7 + 0.3 * Math.sin(TAU * 700 * t));
      }
    }
  }
  return normalize(out, 0.6);
}

/**
 * Cabin chime (CIDS): 'lo' single low chime (seat belts / no smoking), 'hi' single high chime
 * (passenger call), 'hilo' high-low (attendant call).
 */
export function renderCabinChime(sr: number, type: 'lo' | 'hi' | 'hilo' = 'lo'): Mono {
  const out = new Float32Array(Math.round(2.2 * sr));
  const rnd = mulberry32(11);
  const partials: Partial[] = [
    { ratio: 1, amp: 1, decay: 0.55 },
    { ratio: 2.01, amp: 0.22, decay: 0.25 },
    { ratio: 3, amp: 0.08, decay: 0.12 },
  ];
  if (type === 'lo') addBell(out, sr, 0, 587.3, partials, 0.006, 1, rnd);
  else if (type === 'hi') addBell(out, sr, 0, 830.6, partials, 0.005, 1, rnd);
  else {
    addBell(out, sr, 0, 830.6, partials, 0.005, 1, rnd);
    addBell(out, sr, 0.62, 659.3, partials, 0.005, 1, rnd);
  }
  return fadeEdges(normalize(out, 0.8), sr, 0.5, 80);
}

/* ------------------------------------------------------------------ mechanical clicks */

export interface Impact {
  /** Time offset (s). */
  t: number;
  amp: number;
  /** [frequency Hz, amplitude, decay time-constant s] */
  modes: Array<[number, number, number]>;
  noise?: { amp: number; decay: number; hp: number; lp: number };
}

export interface ClickSpec {
  impacts: Impact[];
  /** Level of this kind in dB (applied by the engine). */
  db: number;
  /** Length of the rendered buffer (s). */
  len: number;
}

/** Catalogue of mechanical sounds, keyed by sfx kind (or special id family). */
export const CLICKS: Record<string, ClickSpec> = {
  // Airbus square latching pushbutton: plunger bottoming "clack" + latch.
  pb: {
    db: -6, len: 0.12, impacts: [
      { t: 0, amp: 1, modes: [[230, 0.45, 0.012], [1850, 0.8, 0.01], [3100, 0.5, 0.007], [5200, 0.3, 0.004]], noise: { amp: 0.6, decay: 0.003, hp: 1500, lp: 9000 } },
      { t: 0.028, amp: 0.55, modes: [[2400, 0.7, 0.006], [4300, 0.5, 0.004]], noise: { amp: 0.5, decay: 0.002, hp: 2500, lp: 10000 } },
    ],
  },
  pbm: {
    db: -9, len: 0.08, impacts: [
      { t: 0, amp: 1, modes: [[260, 0.35, 0.01], [2100, 0.7, 0.008], [3600, 0.5, 0.005]], noise: { amp: 0.5, decay: 0.0025, hp: 1500, lp: 9000 } },
    ],
  },
  pbmUp: {
    db: -16, len: 0.05, impacts: [
      { t: 0, amp: 1, modes: [[2600, 0.6, 0.005], [4800, 0.4, 0.003]], noise: { amp: 0.4, decay: 0.0015, hp: 2500, lp: 10000 } },
    ],
  },
  // Toggle switch: sharp metallic snap.
  sw: {
    db: -6, len: 0.07, impacts: [
      { t: 0, amp: 1, modes: [[1250, 0.4, 0.008], [4400, 0.9, 0.009], [6900, 0.6, 0.006]], noise: { amp: 1, decay: 0.0015, hp: 3000, lp: 14000 } },
      { t: 0.0045, amp: 0.3, modes: [[4400, 0.6, 0.006]], noise: { amp: 0.6, decay: 0.001, hp: 3000, lp: 12000 } },
    ],
  },
  swm: {
    db: -8, len: 0.07, impacts: [
      { t: 0, amp: 1, modes: [[1300, 0.4, 0.007], [4100, 0.9, 0.008], [6500, 0.5, 0.005]], noise: { amp: 0.9, decay: 0.0015, hp: 3000, lp: 13000 } },
    ],
  },
  // Rotary selector detent (overhead rotaries are chunky: spring + ball detent).
  rot: {
    db: -11, len: 0.06, impacts: [
      { t: 0, amp: 1, modes: [[1500, 0.6, 0.006], [2900, 0.8, 0.005], [5200, 0.4, 0.003]], noise: { amp: 0.5, decay: 0.0015, hp: 2000, lp: 11000 } },
      { t: 0.011, amp: 0.45, modes: [[2900, 0.6, 0.004]], noise: { amp: 0.4, decay: 0.001, hp: 2500, lp: 10000 } },
    ],
  },
  rotm: {
    db: -11, len: 0.06, impacts: [
      { t: 0, amp: 1, modes: [[1450, 0.6, 0.006], [3000, 0.8, 0.005]], noise: { amp: 0.5, decay: 0.0015, hp: 2000, lp: 11000 } },
    ],
  },
  pot: {
    db: -27, len: 0.03, impacts: [
      { t: 0, amp: 1, modes: [[3200, 0.5, 0.003]], noise: { amp: 0.4, decay: 0.002, hp: 1500, lp: 8000 } },
    ],
  },
  // FCU / EFIS encoder detent: small crisp tick.
  enc: {
    db: -14, len: 0.03, impacts: [
      { t: 0, amp: 1, modes: [[3600, 0.7, 0.003], [6100, 0.4, 0.002]], noise: { amp: 0.5, decay: 0.001, hp: 2500, lp: 12000 } },
    ],
  },
  // FCU / EFIS knob PUSH (dome switch under the knob) and PULL (spring-loaded pop).
  push: {
    db: -10, len: 0.06, impacts: [
      { t: 0, amp: 1, modes: [[420, 0.3, 0.01], [1800, 0.7, 0.006], [3900, 0.5, 0.004]], noise: { amp: 0.4, decay: 0.0015, hp: 1500, lp: 9000 } },
    ],
  },
  pull: {
    db: -10, len: 0.06, impacts: [
      { t: 0, amp: 1, modes: [[380, 0.3, 0.012], [1500, 0.7, 0.007], [3300, 0.5, 0.004]], noise: { amp: 0.4, decay: 0.0015, hp: 1200, lp: 8000 } },
      { t: 0.009, amp: 0.3, modes: [[2600, 0.5, 0.004]] },
    ],
  },
  // MCDU key: soft rubbery tick (rubber dome + key cap).
  key: {
    db: -13, len: 0.09, impacts: [
      { t: 0, amp: 1, modes: [[520, 0.6, 0.01], [1300, 0.6, 0.008], [2400, 0.25, 0.005]], noise: { amp: 0.35, decay: 0.004, hp: 300, lp: 3500 } },
      { t: 0.048, amp: 0.3, modes: [[1500, 0.4, 0.005]], noise: { amp: 0.2, decay: 0.002, hp: 400, lp: 3000 } },
    ],
  },
  // Guard (hinged plastic cover): hollow plastic clack + small rattle.
  guard: {
    db: -8, len: 0.12, impacts: [
      { t: 0, amp: 1, modes: [[780, 0.6, 0.02], [2100, 0.7, 0.014], [3900, 0.4, 0.008]], noise: { amp: 0.7, decay: 0.004, hp: 800, lp: 8000 } },
      { t: 0.014, amp: 0.35, modes: [[2500, 0.5, 0.008]], noise: { amp: 0.3, decay: 0.002, hp: 1000, lp: 8000 } },
    ],
  },
  // Generic lever travel: friction + stop.
  lever: {
    db: -12, len: 0.16, impacts: [
      { t: 0, amp: 0.5, modes: [], noise: { amp: 0.6, decay: 0.03, hp: 500, lp: 2500 } },
      { t: 0.05, amp: 1, modes: [[340, 0.6, 0.02], [1100, 0.5, 0.012], [2600, 0.3, 0.006]], noise: { amp: 0.4, decay: 0.003, hp: 600, lp: 7000 } },
    ],
  },
  // Thrust lever / flap lever detent: heavier clunk.
  detent: {
    db: -13, len: 0.2, impacts: [
      { t: 0, amp: 1, modes: [[160, 0.8, 0.035], [480, 0.6, 0.02], [1250, 0.5, 0.012], [3000, 0.3, 0.005]], noise: { amp: 0.5, decay: 0.004, hp: 400, lp: 6000 } },
    ],
  },
  // ENG MASTER lever-lock switch: pull (unlock) then heavy snap.
  engMaster: {
    db: -7, len: 0.2, impacts: [
      { t: 0, amp: 0.45, modes: [[1800, 0.5, 0.006], [3500, 0.4, 0.004]], noise: { amp: 0.4, decay: 0.0015, hp: 2000, lp: 10000 } },
      { t: 0.085, amp: 1, modes: [[300, 0.7, 0.02], [1500, 0.6, 0.01], [4200, 0.6, 0.007]], noise: { amp: 0.8, decay: 0.002, hp: 1500, lp: 12000 } },
    ],
  },
  // Parking brake handle: pull, ratchet, rotate, clunk.
  parkBrake: {
    db: -8, len: 0.3, impacts: [
      { t: 0, amp: 0.4, modes: [[2200, 0.5, 0.004]], noise: { amp: 0.4, decay: 0.002, hp: 1500, lp: 8000 } },
      { t: 0.05, amp: 0.4, modes: [[2300, 0.5, 0.004]], noise: { amp: 0.4, decay: 0.002, hp: 1500, lp: 8000 } },
      { t: 0.1, amp: 0.4, modes: [[2250, 0.5, 0.004]], noise: { amp: 0.4, decay: 0.002, hp: 1500, lp: 8000 } },
      { t: 0.16, amp: 1, modes: [[140, 0.9, 0.05], [420, 0.6, 0.025], [1100, 0.4, 0.012]], noise: { amp: 0.5, decay: 0.004, hp: 300, lp: 5000 } },
    ],
  },
  // Landing gear lever: pull out, travel, lock.
  gear: {
    db: -8, len: 0.35, impacts: [
      { t: 0, amp: 0.4, modes: [[900, 0.4, 0.01]], noise: { amp: 0.4, decay: 0.01, hp: 500, lp: 4000 } },
      { t: 0.12, amp: 1, modes: [[120, 1, 0.06], [380, 0.6, 0.03], [950, 0.4, 0.015]], noise: { amp: 0.5, decay: 0.005, hp: 300, lp: 5000 } },
    ],
  },
  // Sliding window latch / handle.
  window: {
    db: -10, len: 0.25, impacts: [
      { t: 0, amp: 1, modes: [[210, 0.8, 0.04], [760, 0.5, 0.02], [1900, 0.3, 0.01]], noise: { amp: 0.6, decay: 0.006, hp: 300, lp: 5000 } },
    ],
  },
  // Pitch trim wheel: ratchety clicks.
  trim: {
    db: -15, len: 0.05, impacts: [
      { t: 0, amp: 1, modes: [[1900, 0.6, 0.004], [3400, 0.4, 0.003]], noise: { amp: 0.5, decay: 0.0015, hp: 1500, lp: 9000 } },
    ],
  },
  // Electrical contactor / relay in the avionics & electrical bay (under the floor).
  relay: {
    db: -14, len: 0.08, impacts: [
      { t: 0, amp: 1, modes: [[190, 0.8, 0.018], [900, 0.6, 0.01], [2600, 0.4, 0.005]], noise: { amp: 0.5, decay: 0.002, hp: 600, lp: 7000 } },
      { t: 0.006, amp: 0.4, modes: [[900, 0.5, 0.006]] },
    ],
  },
  // Pneumatic valve slam (start valve, pack valve) heard through the structure.
  valve: {
    db: -24, len: 0.25, impacts: [
      { t: 0, amp: 1, modes: [[95, 0.9, 0.06], [260, 0.5, 0.03], [700, 0.25, 0.012]], noise: { amp: 0.3, decay: 0.01, hp: 100, lp: 1500 } },
    ],
  },
  // Igniter spark (heard faintly through the structure).
  igniter: {
    db: -30, len: 0.03, impacts: [
      { t: 0, amp: 1, modes: [[3500, 0.5, 0.002]], noise: { amp: 1, decay: 0.0012, hp: 2000, lp: 12000 } },
    ],
  },
};

/**
 * Render one mechanical click. `rnd` adds natural variation (±4 % frequency, ±15 % decay, ±2 dB).
 */
export function renderClick(sr: number, spec: ClickSpec, rnd: () => number): Mono {
  const out = new Float32Array(Math.round(spec.len * sr));
  const fj = 1 + (rnd() - 0.5) * 0.08;
  for (const imp of spec.impacts) {
    const t0 = imp.t * (1 + (rnd() - 0.5) * 0.2);
    const i0 = Math.round(t0 * sr);
    const a = imp.amp * (1 + (rnd() - 0.5) * 0.3);
    for (const [f, amp, decay] of imp.modes) {
      const ff = f * fj * (1 + (rnd() - 0.5) * 0.03);
      if (ff >= sr * 0.45) continue;
      const d = decay * (1 + (rnd() - 0.5) * 0.3);
      const ph = rnd() * TAU;
      const n = Math.min(out.length - i0, Math.round(d * 8 * sr));
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        out[i0 + i] += a * amp * attackDecay(t, 0.00025, d) * Math.sin(TAU * ff * t + ph);
      }
    }
    if (imp.noise) {
      const nz = imp.noise;
      const n = Math.min(out.length - i0, Math.round(nz.decay * 8 * sr) + 8);
      const tmp = new Float32Array(n);
      for (let i = 0; i < n; i++) tmp[i] = (rnd() * 2 - 1) * attackDecay(i / sr, 0.0002, nz.decay);
      onePoleHP(tmp, sr, nz.hp);
      onePoleLP(tmp, sr, Math.min(nz.lp, sr * 0.45));
      for (let i = 0; i < n; i++) out[i0 + i] += a * nz.amp * tmp[i] * 2;
    }
  }
  return fadeEdges(normalize(out, 0.9), sr, 0.05, 3);
}

/* ------------------------------------------------------------------ engine / system one-shots */

/** Light-off "whump": low thud + rumble burst. */
export function renderWhump(sr: number, seed = 21): Mono {
  const rnd = mulberry32(seed);
  const len = Math.round(1.6 * sr);
  const out = new Float32Array(len);
  let br = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    br = 0.995 * br + (rnd() * 2 - 1) * 0.08;
    const env = attackDecay(t, 0.05, 0.45);
    out[i] = br * env + 0.6 * Math.sin(TAU * (48 - 10 * Math.min(1, t)) * t) * attackDecay(t, 0.03, 0.25);
  }
  onePoleLP(out, sr, 180);
  onePoleLP(out, sr, 300);
  onePoleHP(out, sr, 20);
  return fadeEdges(normalize(out, 0.9), sr, 2, 100);
}

/**
 * Small-room impulse response (flight deck: small, heavily damped, RT60 ≈ 0.25 s). Returns [L, R].
 */
export function renderRoomIR(sr: number, rt60 = 0.25, seed = 5): [Mono, Mono] {
  const len = Math.round(rt60 * 1.2 * sr);
  const tau = rt60 / 6.9;
  const mk = (s: number) => {
    const rnd = mulberry32(s);
    const b = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      b[i] = (rnd() * 2 - 1) * Math.exp(-t / tau) * clamp(t / 0.002, 0, 1);
    }
    // Early reflections (panels, windshield, ceiling at 0.5-1.5 m).
    for (const [d, g] of [[0.0021, 0.5], [0.0034, 0.35], [0.0052, 0.3], [0.0078, 0.2]] as const) {
      const i = Math.round((d + rnd() * 0.0006) * sr);
      if (i < len) b[i] += g * (rnd() < 0.5 ? -1 : 1);
    }
    onePoleLP(b, sr, 5500);
    return normalize(b, 0.5);
  };
  return [mk(seed), mk(seed + 101)];
}
