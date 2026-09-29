import { describe, it, expect } from 'vitest';
import { springBack, doorStep, stickAngles, pedalOffsets } from '../../src/cockpit/shell/logic';

describe('shell logic', () => {
  it('spring-loaded controls return to exactly 0', () => {
    let v = 1;
    let t = 0;
    while (v !== 0 && t < 2) { v = springBack(v, 1 / 60); t += 1 / 60; }
    expect(v).toBe(0);
    expect(t).toBeLessThan(0.8);
    expect(springBack(-0.5, 1 / 60)).toBeLessThan(0);
    expect(springBack(-0.5, 1 / 60)).toBeGreaterThan(-0.5);
  });

  it('door swings open and closed in about 1.6 s and stops exactly at the target', () => {
    let d = 0;
    let t = 0;
    while (d < 1 && t < 5) { d = doorStep(d, 1, 1 / 30); t += 1 / 30; }
    expect(d).toBe(1);
    expect(t).toBeGreaterThan(1.0);
    expect(t).toBeLessThan(2.4);
    t = 0;
    while (d > 0 && t < 5) { d = doorStep(d, 0, 1 / 30); t += 1 / 30; }
    expect(d).toBe(0);
    // partial target
    expect(doorStep(0.5, 0.5, 0.1)).toBe(0.5);
  });

  it('sidestick deflections: roll ±20°, pitch ±16°, clamped', () => {
    const a = stickAngles(1, -1);
    expect(a.roll * 180 / Math.PI).toBeCloseTo(20, 6);
    expect(a.pitch * 180 / Math.PI).toBeCloseTo(-16, 6);
    expect(stickAngles(3, 0).roll).toBeCloseTo(stickAngles(1, 0).roll, 9);
  });

  it('rudder pedals: left pedal forward for left rudder', () => {
    const l = pedalOffsets(-1, 0.085);
    expect(l.left).toBeCloseTo(-0.085, 9); // forward = −z
    expect(l.right).toBeCloseTo(0.085, 9);
    const r = pedalOffsets(0.5, 0.085);
    expect(r.right).toBeLessThan(0);
    expect(r.left + r.right).toBeCloseTo(0, 9);
  });
});
