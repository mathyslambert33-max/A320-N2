/**
 * Cockpit layout anchors (lead-owned). Aircraft body frame: metres, +X right (F/O side), +Y up,
 * −Z forward (nose), origin on the centreline at cockpit floor level, Z = 0 at the pilots' eye station.
 *
 * Every panel module builds its geometry in a LOCAL frame and places it with `placeAt(obj, ANCHORS.X)`.
 * Local frame convention for all anchors: +X = right (as seen by the seated pilots),
 * +Y = "up" of the panel drawing, +Z = panel normal pointing TOWARD the pilots (out of the face).
 * The face of the panels lies in the local plane z = 0.
 */
import * as THREE from 'three';

export const EYE_CAPT = new THREE.Vector3(-0.53, 1.28, 0.0);
export const EYE_FO = new THREE.Vector3(0.53, 1.28, 0.0);

export interface Anchor {
  name: string;
  /** Origin of the local frame, aircraft body coordinates. */
  origin: THREE.Vector3;
  /** Local axes expressed in body coordinates (orthonormal, right-handed). */
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  /** Nominal extent of the area in local metres (for reference/fitting). */
  width: number;
  height: number;
  desc: string;
}

const deg = THREE.MathUtils.degToRad;

function anchor(name: string, origin: [number, number, number], y: THREE.Vector3, z: THREE.Vector3, width: number, height: number, desc: string): Anchor {
  const Y = y.clone().normalize();
  const Z = z.clone().normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  return { name, origin: new THREE.Vector3(...origin), x: X, y: Y, z: Z, width, height, desc };
}

/** Frame whose drawing-up is "up" and normal faces aft, reclined back by `tilt` (top further from pilots). */
function upright(tiltDeg: number) {
  const t = deg(tiltDeg);
  return { y: new THREE.Vector3(0, Math.cos(t), -Math.sin(t)), z: new THREE.Vector3(0, Math.sin(t), Math.cos(t)) };
}
/** Frame for a panel facing down toward the pilots (overhead): drawing-up = aft, sloping up aft by `slope`. */
function overhead(slopeDeg: number) {
  const s = deg(slopeDeg);
  return { y: new THREE.Vector3(0, Math.sin(s), Math.cos(s)), z: new THREE.Vector3(0, -Math.cos(s), Math.sin(s)) };
}
/** Frame for a panel facing up (pedestal/consoles): drawing-up = forward, face tilted toward the pilots by `tilt`. */
function horizontal(tiltDeg: number) {
  const t = deg(tiltDeg);
  // drawing-up points forward and up (for a face that faces up-aft when tilt > 0)
  return { y: new THREE.Vector3(0, Math.sin(t), -Math.cos(t)), z: new THREE.Vector3(0, Math.cos(t), Math.sin(t)) };
}

const U12 = upright(12);
const O10 = overhead(10);
const O22 = overhead(22);
const H0 = horizontal(0);
const H20 = horizontal(20);

export const ANCHORS = {
  /**
   * Main instrument panel, one plane reclined 12°. Origin = centre of the upper DU row (E/WD centre).
   * DU row at local y = 0: PFD1 x=−0.60, ND1 x=−0.39, E/WD x=0, ND2 x=+0.39, PFD2 x=+0.60.
   * SD at (0, −0.212). Lateral panels (loudspeaker, lights, XFR…) outboard of the PFDs (|x| 0.72..0.92).
   * Knee/lower panels down to local y ≈ −0.26 at the sides; centre panel down to y ≈ −0.33 where the pedestal starts.
   */
  MAIN: anchor('MAIN', [0, 0.97, -0.72], U12.y, U12.z, 1.9, 0.62, 'Main instrument panel (DUs, ISIS, gear, clock, lateral panels)'),

  /**
   * Glareshield front face (FCU, EFIS control panels, warning lights). Origin = FCU face centre.
   * The face is reclined 40° (normal toward the pilots and upward); moved back from the first estimate
   * (1.10, −0.63, 25°) so the PFD/ND tops (FMA) stay visible from EYE_CAPT (mainpanel agent, 2026-09-29).
   * The glareshield top surface continues forward from the top edge (local y ≈ +0.05) to the
   * windshield base at about body (y 1.08, z −0.95..−0.97). Width ≈ 1.9 m (straight across x ±0.95).
   * Standby compass on the centre windshield post, bracket top ≈ (0, 1.66), card ≈ (0, 1.585, −0.772).
   */
  GLARE: anchor('GLARE', [0, 1.111, -0.749], new THREE.Vector3(0, Math.cos(deg(40)), -Math.sin(deg(40))), new THREE.Vector3(0, Math.sin(deg(40)), Math.cos(deg(40))), 1.9, 0.1, 'Glareshield: EFIS CP L, FCU, EFIS CP R, MASTER WARN/CAUT, AUTOLAND, CHRONO, PRIO'),

  /**
   * Overhead forward panel. Origin = centre of the forward overhead panel. Drawing-up = aft
   * (like the FCOM overhead diagrams: ADIRS at the top = aft, EXT LT/APU/SIGNS/INT LT at the bottom = forward).
   * Face normal points down toward the pilots; slope 10° (aft end higher).
   * Size ≈ 0.73 m (5 columns of 146 mm: left col, 3 centre cols, right col) x 0.95 m.
   * Forward edge ≈ body (y 1.75, z −0.78); aft edge ≈ (y 1.915, z +0.155).
   */
  OVHD: anchor('OVHD', [0, 1.832, -0.3125], O10.y, O10.z, 0.73, 0.95, 'Forward overhead panel'),

  /**
   * Aft overhead (maintenance panel + circuit breaker panels), continues aft of OVHD with a steeper slope.
   * Origin = centre; forward edge touches the aft edge of OVHD.
   */
  OVHD_AFT: anchor('OVHD_AFT', [0, 2.009, 0.387], O22.y, O22.z, 0.73, 0.5, 'Aft overhead: maintenance panel & C/B panels'),

  /**
   * Pedestal main (flat) section top. Origin = centre of the flat top surface.
   * Drawing-up = forward. Flat top at body y 0.58 from z −0.40 (front, where the sloped MCDU section starts)
   * to z +0.45 (aft). Width 0.44 m (x −0.22..+0.22).
   */
  PED: anchor('PED', [0, 0.58, 0.025], H0.y, H0.z, 0.44, 0.85, 'Pedestal flat section (RMP/ACP, thrust levers, ENG masters, flaps, speedbrake, trims, park brake, ATC, WXR, door, lighting, printer)'),

  /**
   * Pedestal front sloped section (MCDUs, and panels between them). Origin = its centre.
   * Face tilted 20° toward the pilots; aft edge meets PED front edge at body (y 0.58, z −0.40);
   * forward edge ≈ (y 0.669, z −0.644) just below the SD lower edge.
   */
  PED_FWD: anchor('PED_FWD', [0, 0.6245, -0.522], H20.y, H20.z, 0.44, 0.26, 'Pedestal front: MCDU 1 & 2'),

  /** Captain side console (sidestick, tiller, armrest area, oxygen mask box, reading light). Drawing-up = forward. */
  CONSOLE_CAPT: anchor('CONSOLE_CAPT', [-0.94, 0.66, -0.15], H0.y, H0.z, 0.24, 0.9, 'Captain lateral console'),
  /** F/O side console (mirror). */
  CONSOLE_FO: anchor('CONSOLE_FO', [0.94, 0.66, -0.15], H0.y, H0.z, 0.24, 0.9, 'F/O lateral console'),
} satisfies Record<string, Anchor>;

export type AnchorName = keyof typeof ANCHORS;

/** Matrix mapping local anchor coordinates to aircraft body coordinates. */
export function anchorMatrix(a: Anchor): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(a.x, a.y, a.z).setPosition(a.origin);
}

/** Place an object built in the anchor's local frame. */
export function placeAt<T extends THREE.Object3D>(obj: T, a: Anchor): T {
  const m = anchorMatrix(a);
  m.decompose(obj.position, obj.quaternion, obj.scale);
  return obj;
}

/** Convert a local anchor point to body coordinates. */
export function localToBody(a: Anchor, x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(anchorMatrix(a));
}

/** Reference geometry of the cockpit volume (shell agent refines). */
export const COCKPIT = {
  floorY: 0,
  /** Eye height above the cockpit floor. */
  eyeY: 1.28,
  /** Seat reference points (centre of seat pan top). */
  seatCapt: new THREE.Vector3(-0.53, 0.52, 0.18),
  seatFo: new THREE.Vector3(0.53, 0.52, 0.18),
  /** Rudder pedals centre per side (at the pedal pivot). */
  pedalsCapt: new THREE.Vector3(-0.53, 0.18, -0.78),
  pedalsFo: new THREE.Vector3(0.53, 0.18, -0.78),
  /** Cockpit door (centre, floor). */
  door: new THREE.Vector3(0, 0, 1.35),
  /** Approximate inner half-width at shoulder height. */
  halfWidth: 1.08,
  ceilingY: 2.08,
  /** Aircraft geometry relative to the body frame origin (A320). */
  noseTipZ: -2.9,
  noseGearZ: 2.2,
  mainGearZ: 14.84,
  /**
   * Cockpit floor above the apron (m), level with the cabin floor: A320 door 1 sill is 3.42–3.73 m depending on
   * weight (Airbus AC doc), eye ≈ floor + eyeY ≈ 4.7 m (published cockpit eye height ≈ 4.55 m, 14 ft 11 in).
   */
  floorHeightAboveGround: 3.4,
};

