/**
 * First-person head model (owner: ui) — pure math, no Three.js / DOM (unit-tested).
 *
 * Body frame (docs/ARCHITECTURE.md): metres, +X right (F/O side), +Y up, −Z forward. Angles in radians:
 * yaw > 0 turns the head LEFT (rotation about +Y), pitch > 0 looks UP. The head offset is relative to the
 * design eye point of the seat (EYE_CAPT (−0.53, 1.28, 0) / EYE_FO (+0.53, 1.28, 0)).
 */

export type Seat = 'capt' | 'fo';
export type Vec3 = [number, number, number];

export const EYE: Record<Seat, Vec3> = { capt: [-0.53, 1.28, 0], fo: [0.53, 1.28, 0] };

const D = Math.PI / 180;

/** Head translation limits for the captain (a seated, belted pilot); mirrored in X for the F/O. */
export const HEAD_LIMITS = {
  /** outboard (toward the side window) … inboard (over the pedestal). */
  x: [-0.2, 0.36] as [number, number],
  /** slouch … sit up. */
  y: [-0.22, 0.1] as [number, number],
  /** lean forward … back into the headrest. */
  z: [-0.3, 0.14] as [number, number],
};

/** Angular limits (captain; yaw mirrored for the F/O): turning inboard reaches back to the cockpit door. */
export const ANGLE_LIMITS = {
  yawOutboard: 140 * D,
  yawInboard: 170 * D,
  pitchDown: -75 * D,
  pitchUp: 80 * D,
};

export interface Pose {
  /** Head offset from the seat's design eye point (m, body frame). */
  off: Vec3;
  yaw: number;
  pitch: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Sign that converts a captain-side lateral quantity to the given seat (+1 captain, −1 F/O). */
export const side = (seat: Seat) => (seat === 'capt' ? 1 : -1);

export function clampAngles(seat: Seat, yaw: number, pitch: number): [number, number] {
  const s = side(seat);
  // captain: yaw ∈ [−inboard, +outboard] ; F/O: mirrored
  const lo = s > 0 ? -ANGLE_LIMITS.yawInboard : -ANGLE_LIMITS.yawOutboard;
  const hi = s > 0 ? ANGLE_LIMITS.yawOutboard : ANGLE_LIMITS.yawInboard;
  return [clamp(yaw, lo, hi), clamp(pitch, ANGLE_LIMITS.pitchDown, ANGLE_LIMITS.pitchUp)];
}

export function clampHead(seat: Seat, off: Vec3): Vec3 {
  const s = side(seat);
  const [x0, x1] = HEAD_LIMITS.x;
  const xlo = s > 0 ? x0 : -x1, xhi = s > 0 ? x1 : -x0;
  // Leaning far forward is only possible sitting up a little (the glareshield is ahead and below).
  const zlo = HEAD_LIMITS.z[0] + 0.12 * smooth(-0.08, -0.22, off[1]);
  return [clamp(off[0], xlo, xhi), clamp(off[1], HEAD_LIMITS.y[0], HEAD_LIMITS.y[1]), clamp(off[2], zlo, HEAD_LIMITS.z[1])];
}

/**
 * Automatic torso twist when looking far to the side / back: the head moves inboard and aft so the seat back
 * does not fill the view (added to the player's own offset before clamping).
 */
export function torsoTwist(seat: Seat, yaw: number): Vec3 {
  const s = side(seat);
  const inboard = -yaw * s; // > 0 when turning toward the aisle
  const k = smooth(75 * D, 165 * D, Math.abs(yaw));
  const x = inboard > 0 ? 0.2 * k * s : -0.06 * k * s;
  return [x, 0.02 * k, 0.07 * k];
}

/** Yaw/pitch that aim from `eye` at `target` (body frame). */
export function aim(eye: Vec3, target: Vec3): [number, number] {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
  const h = Math.hypot(dx, dz);
  return [Math.atan2(-dx, -dz), Math.atan2(dy, h)];
}

export type PresetId = 'normal' | 'overhead' | 'pedestal' | 'ecam' | 'fcu' | 'other' | 'left' | 'right' | 'door' | 'efb';

export interface PresetDef {
  label: string;
  /** Head offset (captain; mirrored for the F/O). */
  off: Vec3;
  /** Aim point (captain body coordinates; mirrored for the F/O) … */
  target?: Vec3;
  /** … or fixed angles (captain; yaw mirrored). */
  yaw?: number;
  pitch?: number;
  zoom?: number;
}

/** Preset views; several variants cycle when the same key is pressed again. */
export const PRESETS: Record<PresetId, PresetDef[]> = {
  normal: [{ label: 'Vue normale', off: [0, 0, 0], yaw: 0, pitch: -12 * D }],
  overhead: [
    { label: 'Panneau supérieur', off: [0.08, 0.03, 0.06], target: [0, 1.806, -0.46] },
    { label: 'Panneau supérieur arrière (ADIRS)', off: [0.1, 0.0, 0.03], target: [-0.2, 1.87, -0.1] },
  ],
  pedestal: [
    { label: 'Pylône : MCDU', off: [0.12, -0.06, -0.1], target: [-0.09, 0.64, -0.53] },
    { label: 'Pylône : manettes et ENG MASTER', off: [0.16, -0.05, -0.02], target: [0.0, 0.6, -0.06] },
    { label: 'Pylône arrière : frein de parc, radio', off: [0.18, -0.02, 0.06], target: [0.0, 0.6, 0.3] },
  ],
  ecam: [{ label: 'ECAM', off: [0.1, 0, -0.05], target: [0, 0.87, -0.7] }],
  fcu: [{ label: 'FCU et EFIS', off: [0.05, 0, -0.04], target: [-0.1, 1.11, -0.75] }],
  other: [{ label: 'Planche de bord opposée', off: [0.05, 0, 0], target: [0.5, 0.95, -0.72] }],
  left: [{ label: 'Regard à gauche (fenêtre)', off: [-0.07, 0, -0.03], yaw: 82 * D, pitch: -10 * D }],
  right: [{ label: 'Regard à droite', off: [0.06, 0, 0], yaw: -80 * D, pitch: -8 * D }],
  door: [{ label: 'Porte du poste', off: [0.22, 0.02, 0.08], target: [0, 1.1, 1.35] }],
  efb: [{ label: 'Tablette EFB', off: [-0.06, -0.04, -0.08], target: [-0.9, 0.93, -0.5], zoom: 1.25 }],
};

/** Resolve a preset variant into a pose for a seat. `efbTarget` overrides the tablet position (captain frame). */
export function presetPose(seat: Seat, id: PresetId, variant = 0, efbTarget?: Vec3): Pose & { zoom: number; label: string } {
  const list = PRESETS[id];
  const p = list[((variant % list.length) + list.length) % list.length];
  const s = side(seat);
  const off: Vec3 = [p.off[0] * s, p.off[1], p.off[2]];
  let yaw: number, pitch: number;
  const tgt = id === 'efb' && efbTarget ? efbTarget : p.target;
  if (tgt) {
    const eye: Vec3 = [EYE[seat][0] + off[0], EYE[seat][1] + off[1], EYE[seat][2] + off[2]];
    [yaw, pitch] = aim(eye, [tgt[0] * s, tgt[1], tgt[2]]);
  } else {
    yaw = (p.yaw ?? 0) * s;
    pitch = p.pitch ?? 0;
  }
  const [cy, cp] = clampAngles(seat, yaw, pitch);
  return { off: clampHead(seat, off), yaw: cy, pitch: cp, zoom: p.zoom ?? 1, label: p.label };
}

/** Ease in/out (cubic). */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
