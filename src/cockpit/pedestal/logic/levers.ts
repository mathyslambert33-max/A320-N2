/**
 * Mechanical behaviour of the pedestal levers (DOM-free, unit-tested): thrust lever detents and reverse latch,
 * flaps lever gates, speed brake detent / ground spoiler arming, pitch trim wheel.
 */

/** Thrust lever TLA detents (deg): MAX REV, REV IDLE, IDLE, CL, FLX/MCT, TOGA. */
export const TLA = { MAX_REV: -20, REV_IDLE: -6, IDLE: 0, CL: 25, FLX: 35, TOGA: 45 } as const;
export const TLA_DETENTS = [TLA.MAX_REV, TLA.REV_IDLE, TLA.IDLE, TLA.CL, TLA.FLX, TLA.TOGA];
/** TLA degrees of lever travel over which a detent holds the lever while dragging ("notch" feel). */
export const TLA_CAPTURE = 1.6;

/** Physical lever angle (deg, + forward) for a TLA: the reverse range is a little longer than its TLA span. */
export function tlaAngle(tla: number): number {
  return tla >= 0 ? tla : tla * 1.3;
}

/**
 * Thrust lever position for a raw (unsnapped) drag value. Detents capture the lever within ±TLA_CAPTURE.
 * Reverse (below IDLE) is only reachable with the reverse latch lifted (`latch`); forward thrust is not
 * reachable from the reverse range in the same action (`fromReverse`: the lever stops at IDLE).
 */
export function thrustDrag(raw: number, latch: boolean, fromReverse: boolean): number {
  let v = Math.max(TLA.MAX_REV, Math.min(TLA.TOGA, raw));
  if (!latch && v < TLA.IDLE) v = TLA.IDLE;
  if (fromReverse && v > TLA.IDLE) v = TLA.IDLE;
  for (const d of TLA_DETENTS) if (Math.abs(v - d) <= TLA_CAPTURE) return d;
  return Math.round(v * 10) / 10;
}

/** Next detent from `cur` in direction dir (+1 forward / −1 aft); reverse detents need the latch. */
export function thrustStep(cur: number, dir: 1 | -1, latch: boolean): number {
  const eps = 0.05;
  const list = TLA_DETENTS.filter((d) => latch || d >= TLA.IDLE || cur < TLA.IDLE - eps);
  if (dir > 0) {
    const n = list.find((d) => d > cur + eps);
    // from the reverse range, the lever stops at IDLE
    if (n !== undefined && cur < TLA.IDLE - eps && n > TLA.IDLE) return TLA.IDLE;
    return n ?? cur;
  }
  const n = [...list].reverse().find((d) => d < cur - eps);
  if (n !== undefined && n < TLA.IDLE && !latch) return cur;
  return n ?? cur;
}

/** Flaps lever positions 0, 1, 2, 3, FULL (= 4). Gates at 1 and 3 stop a single movement. */
export const FLAP_GATES = [1, 3];

/**
 * Flaps lever: target position for a single continuous movement started at `start`. The lever cannot pass a gate
 * (1 or 3) that lies strictly between the start position and the target in one movement.
 */
export function flapsGate(start: number, target: number): number {
  const t = Math.max(0, Math.min(4, target));
  if (t > start) { for (const g of FLAP_GATES) if (g > start && g < t) return g; }
  else if (t < start) { for (const g of [...FLAP_GATES].reverse()) if (g < start && g > t) return g; }
  return t;
}

/** Speed brake: the lever can only be pulled up (ground spoilers ARM) in the RET position. */
export const SPDBRK_RET_TOL = 0.02;
export function spdBrkCanArm(lever: number): boolean {
  return lever <= SPDBRK_RET_TOL;
}
/** Speed brake drag: the ½ detent captures ±0.035, RET ±0.03. */
export function spdBrkDrag(raw: number): number {
  const v = Math.max(0, Math.min(1, raw));
  if (v <= 0.03) return 0;
  if (Math.abs(v - 0.5) <= 0.035) return 0.5;
  if (v >= 0.985) return 1;
  return Math.round(v * 100) / 100;
}

/** Pitch trim wheel: THS command range (deg, + nose up) and wheel rotation per THS degree. */
export const PITCH_TRIM_MIN = -4;
export const PITCH_TRIM_MAX = 13.5;
export const TRIM_WHEEL_DEG_PER_THS = 60;
export function clampTrim(v: number): number {
  return Math.round(Math.max(PITCH_TRIM_MIN, Math.min(PITCH_TRIM_MAX, v)) * 100) / 100;
}

/** Take-off THS setting for a CG (%MAC), the relation engraved on the CG scale next to the trim wheels. */
export function thsForCg(cg: number): number {
  return 3.8 - (cg - 17) * (6.3 / 23);
}
