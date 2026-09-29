/**
 * DOM-free helpers for the shell's moving parts (unit-tested in tests/shell).
 */

/** Exponential return toward 0 (spring-loaded controls released by the player). Snaps below `eps`. */
export function springBack(v: number, dt: number, tau = 0.09, eps = 0.002): number {
  const n = v * Math.exp(-dt / tau);
  return Math.abs(n) < eps ? 0 : n;
}

/** Clamp to [lo, hi]. */
export const clampv = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Cockpit door swing: moves `cur` (0 closed..1 open) toward `target` with an ease (slow start/end),
 * `period` = full swing time in seconds.
 */
export function doorStep(cur: number, target: number, dt: number, period = 1.6): number {
  if (cur === target) return cur;
  const d = target - cur;
  // speed profile: faster mid-swing, slower near the stops (door closer / check)
  const mid = 1 - Math.abs(cur - 0.5) * 1.2;
  const speed = (1 / period) * (0.55 + 0.9 * Math.max(0, mid));
  const step = Math.sign(d) * speed * dt;
  return Math.abs(step) >= Math.abs(d) ? target : cur + step;
}

/** Sidestick deflection angles (radians) for normalised inputs: roll ±20°, pitch ±16° (A320). */
export function stickAngles(x: number, y: number): { roll: number; pitch: number } {
  const D = Math.PI / 180;
  return { roll: clampv(x, -1, 1) * 20 * D, pitch: clampv(y, -1, 1) * 16 * D };
}

/** Rudder pedal fore/aft offsets (m, + = aft) for a rudder input (−1 left..+1 right) and a travel. */
export function pedalOffsets(rudder: number, travel: number): { left: number; right: number } {
  const r = clampv(rudder, -1, 1);
  return { left: travel * r, right: -travel * r };
}
