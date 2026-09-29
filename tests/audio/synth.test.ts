import { describe, expect, it } from 'vitest';
import {
  CAVALRY_NOTES, CAVALRY_PERIOD, CCHORD_FREQS, CHIME_F0, CLICKS, CRC_PERIOD, loopNoise, peak, renderBuzzer, renderCabinChime,
  renderCavalry, renderCChord, renderClick, renderCrcChime, renderCricket, renderFwcClick, renderRoomIR, renderSingleChime,
  renderTripleClick, renderWhump, rms,
} from '../../src/audio/synth';
import { mulberry32 } from '../../src/audio/mappings';

const SR = 48000;

/** Goertzel power of frequency f in buf[from, to). */
function power(buf: Float32Array, f: number, from = 0, to = buf.length): number {
  const w = (2 * Math.PI * f) / SR;
  const k = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = from; i < to; i++) {
    const s = buf[i] + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return (s1 * s1 + s2 * s2 - k * s1 * s2) / Math.max(1, to - from);
}

function finite(buf: Float32Array): boolean {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return false;
  return true;
}

describe('noise loops', () => {
  for (const color of ['white', 'pink', 'brown'] as const) {
    it(`${color} noise: finite, normalised, loopable`, () => {
      const b = loopNoise(SR, 1, color, 3);
      expect(b.length).toBe(SR);
      expect(finite(b)).toBe(true);
      expect(rms(b)).toBeCloseTo(0.25, 2);
      // Seam: the jump from the last to the first sample is no bigger than typical sample-to-sample steps.
      let steps = 0;
      for (let i = 1; i < b.length; i++) steps += Math.abs(b[i] - b[i - 1]);
      const mean = steps / (b.length - 1);
      expect(Math.abs(b[0] - b[b.length - 1])).toBeLessThan(mean * 6);
    });
  }
});

describe('FWC aural alerts', () => {
  it('single chime: A5 fundamental, clean edges, decays', () => {
    const b = renderSingleChime(SR);
    expect(finite(b)).toBe(true);
    expect(peak(b)).toBeLessThanOrEqual(0.8001);
    expect(Math.abs(b[0])).toBeLessThan(1e-3);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(1e-3);
    const n = Math.round(0.25 * SR);
    expect(power(b, CHIME_F0, 0, n)).toBeGreaterThan(20 * power(b, CHIME_F0 * 0.8, 0, n));
    expect(power(b, CHIME_F0, 0, n)).toBeGreaterThan(20 * power(b, CHIME_F0 * 1.25, 0, n));
    expect(rms(b, b.length - Math.round(0.2 * SR))).toBeLessThan(rms(b, 0, Math.round(0.2 * SR)) * 0.1);
  });

  it('CRC chime decays faster than the single chime (so repetitions stay distinct)', () => {
    const sc = renderSingleChime(SR);
    const crc = renderCrcChime(SR);
    const i0 = Math.round(CRC_PERIOD * SR);
    const i1 = i0 + Math.round(0.1 * SR);
    expect(rms(crc, i0, i1) / peak(crc)).toBeLessThan(rms(sc, i0, i1) / peak(sc));
    expect(CRC_PERIOD).toBeGreaterThan(0.25);
    expect(CRC_PERIOD).toBeLessThan(0.55);
  });

  it('cavalry charge: 1.5 s motif following the bugle notes', () => {
    const b = renderCavalry(SR);
    expect(b.length).toBe(Math.round(CAVALRY_PERIOD * SR));
    expect(finite(b)).toBe(true);
    const freqs = [...new Set(CAVALRY_NOTES.map((n) => n[0]))];
    let t = 0.005;
    for (const [f, d] of CAVALRY_NOTES) {
      const from = Math.round((t + 0.02) * SR);
      const to = Math.round((t + d - 0.02) * SR);
      const best = freqs.reduce((a, g) => (power(b, g, from, to) > power(b, a, from, to) ? g : a), freqs[0]);
      expect(best).toBe(f);
      t += d;
    }
    const total = CAVALRY_NOTES.reduce((a, n) => a + n[1], 0);
    expect(total).toBeGreaterThan(1.2);
    expect(total).toBeLessThanOrEqual(CAVALRY_PERIOD);
  });

  it('C chord contains C, E and G', () => {
    const b = renderCChord(SR, 1.5);
    expect(b.length).toBe(Math.round(1.5 * SR));
    const ref = power(b, 600);
    for (const f of CCHORD_FREQS) expect(power(b, f)).toBeGreaterThan(50 * ref);
    expect(Math.abs(b[0])).toBeLessThan(1e-3);
  });

  it('looping C chord and buzzer are seamless', () => {
    for (const b of [renderCChord(SR, 2, true), renderBuzzer(SR, 1, true)]) {
      let steps = 0;
      for (let i = 1; i < b.length; i++) steps = Math.max(steps, Math.abs(b[i] - b[i - 1]));
      expect(Math.abs(b[0] - b[b.length - 1])).toBeLessThanOrEqual(steps * 1.05);
    }
  });

  it('triple click: three pulses within half a second', () => {
    const b = renderTripleClick(SR);
    expect(b.length / SR).toBeLessThanOrEqual(0.56);
    const win = Math.round(0.01 * SR);
    const env: number[] = [];
    for (let i = 0; i + win <= b.length; i += win) env.push(rms(b, i, i + win));
    const thr = Math.max(...env) * 0.3;
    let pulses = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > thr && (i === 0 || env[i - 1] <= thr)) pulses++;
    expect(pulses).toBe(3);
    const single = renderFwcClick(SR);
    expect(single.length / SR).toBeLessThan(0.15);
  });

  it('buzzer and cricket render', () => {
    const bz = renderBuzzer(SR, 1.2);
    expect(bz.length).toBe(Math.round(1.2 * SR));
    expect(power(bz, 370)).toBeGreaterThan(10 * power(bz, 300));
    const cr = renderCricket(SR);
    expect(finite(cr)).toBe(true);
    expect(power(cr, 4200)).toBeGreaterThan(10 * power(cr, 3000));
  });

  it('cabin chimes', () => {
    for (const t of ['lo', 'hi', 'hilo'] as const) {
      const b = renderCabinChime(SR, t);
      expect(finite(b)).toBe(true);
      expect(peak(b)).toBeGreaterThan(0.5);
    }
    const lo = renderCabinChime(SR, 'lo');
    expect(power(lo, 587.3, 0, SR / 4)).toBeGreaterThan(20 * power(lo, 830.6, 0, SR / 4));
  });
});

describe('mechanical clicks', () => {
  for (const [kind, spec] of Object.entries(CLICKS)) {
    it(`${kind}: finite, bounded, click-free start`, () => {
      const b = renderClick(SR, spec, mulberry32(1));
      expect(b.length).toBe(Math.round(spec.len * SR));
      expect(finite(b)).toBe(true);
      expect(peak(b)).toBeLessThanOrEqual(0.9001);
      expect(peak(b)).toBeGreaterThan(0.5);
      expect(Math.abs(b[0])).toBeLessThan(0.05);
      expect(Math.abs(b[b.length - 1])).toBeLessThan(0.02);
      expect(spec.db).toBeLessThan(0);
    });
  }

  it('variants differ (natural variation)', () => {
    const a = renderClick(SR, CLICKS.pb, mulberry32(1));
    const b = renderClick(SR, CLICKS.pb, mulberry32(2));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(1);
  });

  it('heavy clunks are lower than switch snaps', () => {
    const centroid = (buf: Float32Array) => {
      let num = 0, den = 0;
      for (const f of [100, 200, 400, 800, 1600, 3200, 6400]) {
        const p = power(buf, f);
        num += p * Math.log2(f);
        den += p;
      }
      return num / den;
    };
    const detent = renderClick(SR, CLICKS.detent, mulberry32(5));
    const sw = renderClick(SR, CLICKS.sw, mulberry32(5));
    expect(centroid(detent)).toBeLessThan(centroid(sw));
  });
});

describe('misc buffers', () => {
  it('light-off whump is a low-frequency thud', () => {
    const b = renderWhump(SR);
    expect(finite(b)).toBe(true);
    expect(power(b, 50)).toBeGreaterThan(100 * power(b, 2000));
  });

  it('room impulse response: stereo, decaying', () => {
    const [l, r] = renderRoomIR(SR, 0.25);
    expect(l.length).toBe(r.length);
    const n = l.length;
    expect(rms(l, 0, n / 4)).toBeGreaterThan(10 * rms(l, (3 * n) / 4, n));
  });
});
