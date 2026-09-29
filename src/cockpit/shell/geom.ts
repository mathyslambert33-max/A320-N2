/**
 * Shell reference geometry (A320 flight deck). Aircraft body frame: metres, +X right (F/O), +Y up,
 * −Z forward, origin on the centreline at floor level, Z = 0 at the pilots' design eye station.
 *
 * Everything the other modules may need to match (window positions, door, cockpit extent) is exported
 * as plain numbers in `SHELL_GEOM` and documented in docs/vars/shell.md.
 *
 * Fixed by the sibling modules (not changed here):
 *  - glareshield top reaches the windshield base at (y 1.07, z −0.96/−0.97), straight across x ±0.95 (mainpanel);
 *  - standby compass case on the centre windshield post at (0, 1.585, −0.772), bracket back face z ≈ −0.83;
 *  - overhead console x ±0.365, forward edge (y 1.75, z −0.78), aft end of OVHD_AFT (y 2.10, z 0.62), housing 0.11 m.
 *
 * The windshield inner frame face is one plane (both panes coplanar, inclined 13° from the vertical) so that its
 * base line coincides with the straight glareshield; the "corner posts" are a rounded fillet between that plane
 * and the side walls whose radius grows with height (upper nose more rounded), as on the real flight deck.
 */
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Cubic Hermite interpolation through a table (xs ascending), clamped outside. */
export function table(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const m = ys.map((_, i) => {
    if (i === 0) return (ys[1] - ys[0]) / (xs[1] - xs[0]);
    if (i === n - 1) return (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
    return (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
  });
  return (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]) * 0; // clamped
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/* ------------------------------------------------------------------ */
/* Windshield                                                           */
/* ------------------------------------------------------------------ */

/** Windshield inner frame face: z = Z0 + SLOPE·(y − Y0). Both panes coplanar (13.0° from vertical). */
export const WS = {
  Y0: 1.075,
  Z0: -0.975,
  SLOPE: 0.2314,
  /** Glass (inner surface) behind the frame face, measured along the plane normal. */
  GLASS_DEPTH: 0.03,
  /** Glass thickness (laminated, ≈ 25 mm on the A320 windshield). */
  GLASS_T: 0.025,
  /** Clear opening (reveal wall) of each pane, right pane in (x, y) on the frame plane. */
  SILL: 1.085,
  TOP_C: 1.745,
  TOP_O: 1.668,
  X_POST: 0.04,
  X_BOT: 0.875,
  X_TOP: 0.7,
  /** Frame width outboard of the glass before the corner fillet starts. */
  FRAME_W: 0.055,
  /** Lower edge of the frame surface (hidden under the glareshield top). */
  FRAME_BOTTOM: 1.03,
} as const;

export const zWs = (y: number) => WS.Z0 + WS.SLOPE * (y - WS.Y0);
/** Unit normal of the windshield frame plane, pointing into the cockpit (aft, slightly down). */
export const WS_NORMAL = new THREE.Vector3(0, -WS.SLOPE, 1).normalize();
/** Unit "up" direction inside the windshield plane. */
export const WS_UP = new THREE.Vector3(0, 1, WS.SLOPE).normalize();

/** Outboard x of the right windshield clear opening at height y. */
export function glassOutX(y: number): number {
  const t = clamp((y - WS.SILL) / (WS.TOP_O - WS.SILL), 0, 1.4);
  return WS.X_BOT + (WS.X_TOP - WS.X_BOT) * t;
}

/* ------------------------------------------------------------------ */
/* Side walls                                                           */
/* ------------------------------------------------------------------ */

/** Inner lining half-width of the straight side walls (z ≤ 0.75) as a function of height. */
export const W0 = table(
  [0, 0.3, 0.66, 1.0, 1.3, 1.5, 1.65, 1.75, 1.9, 2.05],
  [0.985, 1.03, 1.065, 1.08, 1.065, 1.025, 0.975, 0.93, 0.85, 0.74],
);

/** Side wall half-width at (y, z): the nose widens behind the fixed windows toward the rear bulkhead. */
export const wallX = (y: number, z: number) => W0(y) + 0.1 * smoothstep(0.75, 1.4, z);

/** Rear bulkhead (forward face) station and cockpit door. */
export const REAR_Z = 1.35;
export const DOOR = {
  /** Clear opening. */
  x0: -0.4,
  x1: 0.4,
  height: 1.93,
  /** Leaf thickness (reinforced door). */
  t: 0.05,
  /** Hinge on the captain's side; the door opens forward into the cockpit (≈ 100°). */
  hingeX: -0.4,
  openDeg: 100,
};

/** Height where the side wall lining meets the ceiling lining (sun-visor rail). */
export const Y_WALL_TOP = 1.75;
/** Ceiling height of the flat centre strip aft of the overhead console. */
export const Y_CEIL_AFT = 2.21;
/** Overhead console housing side (x) and its forward/aft stations. */
export const OVHD_X = 0.366;
export const OVHD_Z_FWD = -0.795;
export const OVHD_Z_AFT = 0.62;
export const OVHD_FWD_CORNER = new THREE.Vector3(OVHD_X, 1.86, OVHD_Z_FWD);

/** Height of the ceiling lining where it meets the overhead housing side at station z. */
export function ovhdJoinY(z: number): number {
  if (z <= 0.155) return 1.832 + 0.1763 * (Math.max(z, OVHD_Z_FWD) + 0.3125) + 0.1;
  if (z <= OVHD_Z_AFT) return 1.915 + 0.404 * (z - 0.155) + 0.095;
  return lerp(2.198, Y_CEIL_AFT, smoothstep(OVHD_Z_AFT, OVHD_Z_AFT + 0.08, z));
}

/* ------------------------------------------------------------------ */
/* Plan-view wall curve (right side)                                    */
/* ------------------------------------------------------------------ */

export interface PlanAt {
  y: number;
  /** Windshield plane z at this height (clamped below the frame bottom). */
  zw: number;
  /** x where the corner fillet leaves the windshield plane. */
  xfe: number;
  /** Fillet radius. */
  r: number;
  /** z where the fillet becomes tangent to the side wall. */
  zt: number;
  /** u of the fillet start (u < this: windshield frame plane). */
  uArc: number;
  /** u at the centreline (x = 0) on the windshield frame plane. */
  uC: number;
}

/**
 * Wall surface parameterisation (right side, x > 0): u = arc length along the plan curve measured from the
 * point where the corner fillet meets the straight side wall (u > 0 aft along the side wall, u < 0 around the
 * fillet then inboard along the windshield frame plane), y = height.
 */
export function planAt(y: number): PlanAt {
  const yc = Math.max(y, WS.FRAME_BOTTOM);
  const zw = zWs(yc);
  const xfe = glassOutX(yc) + WS.FRAME_W;
  const r = Math.max(0.03, W0(y) - xfe);
  const uArc = (-r * Math.PI) / 2;
  return { y, zw, xfe, r, zt: zw + r, uArc, uC: uArc - xfe };
}

/** Point of the wall surface at (u, y) (right side). */
export function wallPoint(u: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const p = planAt(y);
  if (u >= 0) {
    const z = p.zt + u;
    return out.set(wallX(y, z), y, z);
  }
  if (u >= p.uArc) {
    const phi = Math.PI / 2 + u / p.r;
    return out.set(p.xfe + p.r * Math.sin(phi), y, p.zw + p.r - p.r * Math.cos(phi));
  }
  return out.set(p.xfe + (u - p.uArc), y, p.zw);
}

/** u of a point on the straight side wall at station z (height y). */
export const uSide = (z: number, y: number) => z - planAt(y).zt;
/** u of a point on the windshield frame plane at lateral position x (height y). */
export const uFrame = (x: number, y: number) => {
  const p = planAt(y);
  return x - p.xfe + p.uArc;
};

/* ------------------------------------------------------------------ */
/* Windows (outlines of the reveal walls, right side)                   */
/* ------------------------------------------------------------------ */

export type P2 = [number, number];

export interface WindowDef {
  name: string;
  /** Convex polygon (CCW in the natural frame), natural coordinates: (x, y) on the windshield plane or (z, y) on the side wall. */
  pts: P2[];
  /** Corner radius per vertex. */
  radii: number[];
  frame: 'ws' | 'side';
  /** Reveal depth (lining face → reveal wall end) and glass depth (inner surface). */
  reveal: number;
  glass: number;
}

/** Sliding window front edge (at height y): a constant distance aft of the corner-fillet tangent line. */
export const slideFrontZ = (y: number) => planAt(y).zt + 0.08;

export const WINDOWS: Record<'ws' | 'slide' | 'fixed', WindowDef> = {
  /** Windshield (right pane): clear area ≈ 0.48 m² (A320: 0.52 m² incl. edge). */
  ws: {
    name: 'windshield',
    pts: [[WS.X_POST, WS.SILL], [WS.X_BOT, WS.SILL], [WS.X_TOP, WS.TOP_O], [WS.X_POST, WS.TOP_C]],
    radii: [0.025, 0.05, 0.07, 0.03],
    frame: 'ws',
    reveal: 0.03,
    glass: 0.03,
  },
  /** Sliding window (opening, the sash covers ≈ 25 mm all round → clear area ≈ 0.36 m²). */
  slide: {
    name: 'sliding window',
    pts: [[slideFrontZ(1.035), 1.035], [0.05, 1.035], [0.05, 1.625], [slideFrontZ(1.625), 1.625]],
    radii: [0.05, 0.05, 0.05, 0.06],
    frame: 'side',
    reveal: 0.028,
    glass: 0.05,
  },
  /** Fixed rear side window (upper edge sloping down aft, ≈ 0.25 m² clear). */
  fixed: {
    name: 'fixed window',
    pts: [[0.16, 1.06], [0.62, 1.06], [0.7, 1.42], [0.16, 1.6]],
    radii: [0.05, 0.07, 0.09, 0.05],
    frame: 'side',
    reveal: 0.028,
    glass: 0.06,
  },
};

/** Sliding window travel (aft) when fully open, and inward unlatching offset. */
export const SLIDE_TRAVEL = 0.5;
export const SLIDE_UNLATCH = 0.016;

/* ------------------------------------------------------------------ */
/* Seats / pedals / consoles                                            */
/* ------------------------------------------------------------------ */

export const SEAT = {
  /** Seat reference (centre of the seat pan top), captain; F/O mirrored. From layout.COCKPIT. */
  capt: new THREE.Vector3(-0.53, 0.52, 0.18),
  /** Backrest recline from vertical. */
  recline: 13 * DEG,
};

export const PEDALS = {
  /** Pedal pair centre (captain), pedal spacing (centre to centre) and travel. */
  capt: new THREE.Vector3(-0.53, 0.0, -0.82),
  spacing: 0.29,
  travel: 0.085,
};

/** Numbers published for the other modules (docs/vars/shell.md). */
export const SHELL_GEOM = {
  floorY: 0,
  rearBulkheadZ: REAR_Z,
  door: { ...DOOR, z: REAR_Z },
  windshieldPlane: { y0: WS.Y0, z0: WS.Z0, slope: WS.SLOPE, glassDepth: WS.GLASS_DEPTH, glassThickness: WS.GLASS_T },
  windows: WINDOWS,
  wallTopY: Y_WALL_TOP,
  ceilingAftY: Y_CEIL_AFT,
  slideTravel: SLIDE_TRAVEL,
};
