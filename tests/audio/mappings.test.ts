import { describe, expect, it } from 'vitest';
import {
  apuLevels, apuWhineHz, attackDecay, CFM, dbToGain, dieselFiringHz, engCoreShaftHz, engCoreWhineHz, engFanBpfHz,
  engineLevels, engStarterHz, fanLevel, fanSpin, gainToDb, isLit, lag2, mulberry32, nextBark, nextTick, noteEnv,
  openings, smoothstep, trackWiper, volumeToGain,
} from '../../src/audio/mappings';

const OFF = { n1: 0, n2: 0, egt: 19, ff: 0, startValve: 0, oat: 19 };

describe('basic helpers', () => {
  it('smoothstep is clamped and monotonic', () => {
    expect(smoothstep(0, 10, -5)).toBe(0);
    expect(smoothstep(0, 10, 15)).toBe(1);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 6);
    let prev = -1;
    for (let x = 0; x <= 10; x += 0.5) {
      const y = smoothstep(0, 10, x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it('volume curve maps 0..1 to 0..1 perceptually', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25, 6);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(Number.NaN)).toBe(0);
  });

  it('dB conversions round-trip', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(gainToDb(dbToGain(-23))).toBeCloseTo(-23, 6);
  });

  it('lag2 uses separate rise/fall time constants', () => {
    let up = 0;
    let dn = 1;
    for (let i = 0; i < 30; i++) {
      up = lag2(up, 1, 1 / 30, 0.5, 5);
      dn = lag2(dn, 0, 1 / 30, 0.5, 5);
    }
    expect(up).toBeGreaterThan(0.8); // 1 s at tau 0.5
    expect(dn).toBeGreaterThan(0.75); // 1 s at tau 5
  });

  it('envelopes start and end at zero (click-free)', () => {
    expect(noteEnv(0, 1, 0.02, 0.05)).toBe(0);
    expect(noteEnv(1, 1, 0.02, 0.05)).toBeCloseTo(0, 6);
    expect(noteEnv(0.5, 1, 0.02, 0.05)).toBe(1);
    expect(attackDecay(0, 0.01, 0.1)).toBe(0);
    expect(attackDecay(0.01, 0.01, 0.1)).toBeCloseTo(1, 6);
    expect(attackDecay(0.11, 0.01, 0.1)).toBeCloseTo(Math.exp(-1), 6);
  });

  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('nextTick keeps a stable grid', () => {
    expect(nextTick(0, 0.5, 0.2)).toBe(0.5);
    expect(nextTick(0, 0.5, 1.2)).toBeCloseTo(1.5, 9);
  });
});

describe('CFM56-5B mappings', () => {
  it('fan blade passing frequency: 36 blades at 5000 rpm', () => {
    expect(engFanBpfHz(100)).toBeCloseTo(3000, 6);
    expect(engFanBpfHz(CFM.IDLE_N1)).toBeCloseTo(585, 0);
  });

  it('HP shaft 14460 rpm → 241 Hz', () => {
    expect(engCoreShaftHz(100)).toBeCloseTo(241, 0);
  });

  it('core whine and starter whine rise with N2', () => {
    expect(engCoreWhineHz(0)).toBeLessThan(150);
    expect(engCoreWhineHz(58.5)).toBeGreaterThan(1200);
    expect(engCoreWhineHz(58.5)).toBeLessThan(1600);
    for (let n = 0; n < 60; n += 5) {
      expect(engCoreWhineHz(n + 5)).toBeGreaterThan(engCoreWhineHz(n));
      expect(engStarterHz(n + 5)).toBeGreaterThan(engStarterHz(n));
    }
  });

  it('an engine at rest is silent', () => {
    const L = engineLevels(OFF);
    for (const v of Object.values(L)) expect(v).toBeCloseTo(0, 6);
  });

  it('start valve alone gives air rush, N2 gives starter/core whine', () => {
    const valveOnly = engineLevels({ ...OFF, startValve: 1 });
    expect(valveOnly.airRush).toBeGreaterThan(0.4);
    expect(valveOnly.core).toBe(0);
    const cranking = engineLevels({ ...OFF, startValve: 1, n2: 20, n1: 3 });
    expect(cranking.starter).toBeGreaterThan(0.5);
    expect(cranking.core).toBeGreaterThan(0.1);
    expect(cranking.combustion).toBe(0); // no fuel yet
  });

  it('combustion needs fuel flow AND hot EGT', () => {
    expect(engineLevels({ ...OFF, n2: 30, ff: 200, egt: 19 }).combustion).toBe(0);
    expect(engineLevels({ ...OFF, n2: 30, ff: 0, egt: 500 }).combustion).toBe(0);
    expect(engineLevels({ ...OFF, n2: 58.5, n1: 19.5, ff: 290, egt: 440 }).combustion).toBeGreaterThan(0.6);
  });

  it('the starter stops contributing once the start valve is closed', () => {
    expect(engineLevels({ ...OFF, n2: 58.5, n1: 19.5, ff: 290, egt: 440, startValve: 0 }).starter).toBe(0);
  });

  it('core level increases through the start', () => {
    let prev = -1;
    for (let n2 = 0; n2 <= 60; n2 += 2) {
      const c = engineLevels({ ...OFF, n2 }).core;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('light-off detection', () => {
    expect(isLit({ egt: 19, ff: 200, oat: 19 })).toBe(false);
    expect(isLit({ egt: 150, ff: 200, oat: 19 })).toBe(true);
    expect(isLit({ egt: 300, ff: 0, oat: 19 })).toBe(false);
  });
});

describe('APU mappings', () => {
  it('silent at rest, whine rises with N', () => {
    const L = apuLevels({ n: 0, egt: 19, starting: 0, bleed: 0, oat: 19 });
    expect(L.whine + L.roar + L.starter + L.combustion).toBe(0);
    expect(apuWhineHz(100)).toBeGreaterThan(apuWhineHz(50));
    const run = apuLevels({ n: 100, egt: 400, starting: 0, bleed: 0, oat: 19 });
    expect(run.whine).toBeGreaterThan(0.9);
    expect(run.starter).toBe(0);
  });

  it('starter only below the 55 % cut-out while starting', () => {
    expect(apuLevels({ n: 30, egt: 300, starting: 1, bleed: 0, oat: 19 }).starter).toBeGreaterThan(0.9);
    expect(apuLevels({ n: 60, egt: 500, starting: 1, bleed: 0, oat: 19 }).starter).toBe(0);
  });

  it('bleed load increases the roar', () => {
    const a = apuLevels({ n: 100, egt: 400, starting: 0, bleed: 0, oat: 19 }).roar;
    const b = apuLevels({ n: 100, egt: 400, starting: 0, bleed: 1, oat: 19 }).roar;
    expect(b).toBeGreaterThan(a);
  });
});

describe('PTU barking rhythm', () => {
  it('barks are 0.28-0.45 s long, separated by gaps, first one immediate', () => {
    const rnd = mulberry32(7);
    const first = nextBark(rnd, 0);
    expect(first.gap).toBe(0);
    for (let i = 0; i < 40; i++) {
      const b = nextBark(rnd, i);
      expect(b.dur).toBeGreaterThanOrEqual(0.28);
      expect(b.dur).toBeLessThanOrEqual(0.45);
      if (i > 0) {
        expect(b.gap).toBeGreaterThan(0.25);
        expect(b.gap).toBeLessThan(1.1);
      }
      expect(b.fPeak).toBeGreaterThan(b.f0);
      expect(b.amp).toBeGreaterThan(0.5);
      expect(b.amp).toBeLessThanOrEqual(1);
    }
  });

  it('rhythm tightens as the PTU keeps running', () => {
    const avgGap = (from: number) => {
      const rnd = mulberry32(3);
      let s = 0;
      for (let i = from; i < from + 20; i++) s += nextBark(rnd, i).gap;
      return s / 20;
    };
    expect(avgGap(20)).toBeLessThan(avgGap(1));
  });
});

describe('openings', () => {
  const closed = { windowCapt: 0, windowFo: 0, doorL1: 0, ckptDoor: 0, jetbridge: 0 };
  it('closed aircraft: no leak, low hull cutoff', () => {
    const o = openings(closed);
    expect(o.windowCapt).toBe(0);
    expect(o.windowFo).toBe(0);
    expect(o.door).toBe(0);
    expect(o.hullCutoff).toBeLessThan(700);
  });
  it('window leak rises steeply with the first centimetres', () => {
    expect(openings({ ...closed, windowCapt: 0.1 }).windowCapt).toBeGreaterThan(0.3);
    expect(openings({ ...closed, windowCapt: 1 }).windowCapt).toBe(1);
  });
  it('L1 door leaks only if the cockpit door is open; the jet bridge muffles it', () => {
    expect(openings({ ...closed, doorL1: 1, ckptDoor: 0 }).door).toBe(0);
    const open = openings({ ...closed, doorL1: 1, ckptDoor: 1 });
    const bridge = openings({ ...closed, doorL1: 1, ckptDoor: 1, jetbridge: 1 });
    expect(open.door).toBe(1);
    expect(bridge.door).toBeLessThan(open.door);
    expect(bridge.doorCutoff).toBeLessThan(open.doorCutoff);
  });
});

describe('fans, wipers, diesels', () => {
  it('avionics fans spin up in ~3 s and coast down slower', () => {
    let s = 0;
    for (let i = 0; i < 90; i++) s = fanSpin(s, true, 1 / 30);
    expect(s).toBeGreaterThan(0.9);
    let d = 1;
    for (let i = 0; i < 90; i++) d = fanSpin(d, false, 1 / 30);
    expect(d).toBeGreaterThan(0.2);
    for (let i = 0; i < 300; i++) d = fanSpin(d, false, 1 / 30);
    expect(d).toBeLessThan(0.05);
    expect(fanLevel(0)).toBe(0);
    expect(fanLevel(1)).toBe(1);
  });

  it('wiper tracker detects each end of stroke', () => {
    const tr = { pos: 0, vel: 0, dir: 0 };
    let rev = 0;
    const per = 1.2;
    for (let i = 1; i <= Math.round((2 * per) * 30); i++) {
      const t = i / 30;
      const pos = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / per);
      if (trackWiper(tr, pos, 1 / 30) === 'reverse') rev++;
    }
    expect(rev).toBeGreaterThanOrEqual(3);
    expect(rev).toBeLessThanOrEqual(4);
  });

  it('diesel firing frequency', () => {
    expect(dieselFiringHz(1500, 4)).toBe(50);
    expect(dieselFiringHz(800, 6)).toBe(40);
  });
});
