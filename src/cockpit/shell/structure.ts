/**
 * Flight-deck structure: side walls + corner posts + windshield frame (one continuous lining surface per side
 * with the window openings and rounded reveals), ceiling linings around the overhead console, floor with carpet,
 * forward lower wall (pedal area), main-panel / glareshield side closures, rear bulkhead with the door opening.
 * All in the aircraft body frame. The right side is built and mirrored.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import {
  DEG, WS, WINDOWS, REAR_Z, DOOR, Y_WALL_TOP, Y_CEIL_AFT, OVHD_X, OVHD_Z_FWD, OVHD_Z_AFT, OVHD_FWD_CORNER,
  planAt, wallPoint, wallX, uSide, uFrame, ovhdJoinY, zWs, W0, type P2, type WindowDef,
} from './geom';
import { paramSurface, roundedOutline, ringStrip, surfNormal, mirrorX, MergeBag, toSimple, type SurfMap } from './surf';
import { shellMats } from './mats';
import { geo } from '../kit';
import { ANCHORS, anchorMatrix } from '../layout';

/** Lip radius of the lining around window openings. */
export const LIP = 0.012;
const Z_END = REAR_Z + 0.012;

/* ------------------------------------------------------------------ */
/* Wall surface (right side)                                            */
/* ------------------------------------------------------------------ */

export const wallMap: SurfMap = (u, v, out) => wallPoint(u, v, out);

/** Natural window coordinates → wall parameters (u, y). */
export function toParam(w: WindowDef, p: P2): P2 {
  return w.frame === 'ws' ? [uFrame(p[0], p[1]), p[1]] : [uSide(p[0], p[1]), p[1]];
}

/** Point of a window outline (offset m, depth d behind the lining) in body coordinates (right side). */
export function windowRing(w: WindowDef, m: number, d: number): THREE.Vector3[] {
  const n = new THREE.Vector3();
  return roundedOutline(w.pts, w.radii, m, 8, 8).map((p) => {
    const [u, y] = toParam(w, p);
    const P = wallPoint(u, y, new THREE.Vector3());
    surfNormal(wallMap, u, y, n);
    return P.addScaledVector(n, -d);
  });
}

/** Wall surface patch at depth `d` behind the lining, restricted to a window outline offset by m. */
export function windowPatch(w: WindowDef, m: number, d: number, maxLen = 0.1): THREE.BufferGeometry {
  const outline = roundedOutline(w.pts, w.radii, m, 8, 8).map((p) => toParam(w, p));
  return paramSurface(outline, [], wallMap, { maxLen, maxSag: 0.0008, offset: -d, uvScale: 1 });
}

function wallDomain(): { outer: P2[]; holes: P2[][] } {
  const outer: P2[] = [];
  const N = 24;
  const uEnd = (y: number) => Z_END - planAt(y).zt;
  // bottom (y = 0) front → aft
  outer.push([planAt(0).uArc, 0]);
  outer.push([uEnd(0), 0]);
  // aft end up
  for (let i = 1; i <= N; i++) { const y = (Y_WALL_TOP * i) / N; outer.push([uEnd(y), y]); }
  // top aft → forward (to the overhead side on the frame plane)
  outer.push([uFrame(OVHD_X, Y_WALL_TOP), Y_WALL_TOP]);
  outer.push([uFrame(OVHD_X, 1.87), 1.87]);
  outer.push([planAt(1.87).uC, 1.87]);
  // centreline down to the frame bottom
  for (let i = 1; i <= 8; i++) { const y = 1.87 - ((1.87 - WS.FRAME_BOTTOM) * i) / 8; outer.push([planAt(y).uC, y]); }
  // along the frame bottom to the fillet start, then down the fillet start line
  outer.push([planAt(WS.FRAME_BOTTOM).uArc, WS.FRAME_BOTTOM]);
  for (let i = 1; i < N; i++) { const y = WS.FRAME_BOTTOM * (1 - i / N); outer.push([planAt(y).uArc, y]); }
  const holes = (['ws', 'slide', 'fixed'] as const).map((k) => roundedOutline(WINDOWS[k].pts, WINDOWS[k].radii, LIP, 8, 8).map((p) => toParam(WINDOWS[k], p)));
  return { outer, holes };
}

/** Reveal (rounded lip + wall) of one window opening, right side. */
function revealGeometry(w: WindowDef): THREE.BufferGeometry {
  const prof: Array<[number, number]> = [];
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * (Math.PI / 2); prof.push([LIP * (1 - Math.sin(a)), LIP * (1 - Math.cos(a))]); }
  prof.push([0, w.reveal]);
  const rings = prof.map(([m, d]) => windowRing(w, m, d));
  // face toward the opening centre
  const c = new THREE.Vector3();
  for (const p of rings[rings.length - 1]) c.add(p);
  c.multiplyScalar(1 / rings[0].length);
  return ringStrip(rings, { closed: true, faceToward: c });
}

/* ------------------------------------------------------------------ */
/* Ceiling (right side)                                                 */
/* ------------------------------------------------------------------ */

const _t = new THREE.Vector3(), _t2 = new THREE.Vector3();
function wallTopTangent(u: number, out: THREE.Vector3): THREE.Vector3 {
  wallPoint(u, Y_WALL_TOP + 0.002, out);
  wallPoint(u, Y_WALL_TOP - 0.002, _t2);
  return out.sub(_t2).normalize();
}

/** Ceiling: from the wall top (sun-visor rail) up and inboard to the overhead housing side (or x = OVHD_X aft of it). */
export const ceilMap: SurfMap = (u, w, out) => {
  const A = wallPoint(u, Y_WALL_TOP, new THREE.Vector3());
  const tA = wallTopTangent(u, _t);
  const B = A.z <= OVHD_Z_FWD ? OVHD_FWD_CORNER.clone() : new THREE.Vector3(OVHD_X, ovhdJoinY(A.z), A.z);
  const L = A.distanceTo(B);
  const C1 = A.clone().addScaledVector(tA, L * 0.42);
  const C2 = B.clone().add(new THREE.Vector3(L * 0.38, -0.02 * L, 0));
  const s = 1 - w;
  out.set(0, 0, 0)
    .addScaledVector(A, s * s * s)
    .addScaledVector(C1, 3 * s * s * w)
    .addScaledVector(C2, 3 * s * w * w)
    .addScaledVector(B, w * w * w);
  return out;
};

function ceilingGeometry(): THREE.BufferGeometry {
  const u0 = uFrame(OVHD_X, Y_WALL_TOP);
  const u1 = Z_END - planAt(Y_WALL_TOP).zt;
  const outer: P2[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) outer.push([u0 + ((u1 - u0) * i) / N, 0]);
  outer.push([u1, 1]);
  for (let i = N - 1; i >= 0; i--) outer.push([u0 + ((u1 - u0) * i) / N, 1]);
  return paramSurface(outer, [], ceilMap, { maxLen: 0.1, maxSag: 0.001 });
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

export interface StructureParts {
  root: THREE.Group;
  /** Meshes that block the pointer ray. */
  blockers: THREE.Object3D[];
}

export function buildStructure(app: App): StructureParts {
  const M = shellMats();
  const K = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'shell:structure';
  const bag = new MergeBag();

  // --- walls with openings (right, mirrored left)
  const { outer, holes } = wallDomain();
  const wall = paramSurface(outer, holes, wallMap, { maxLen: 0.1, maxSag: 0.0008 });
  bag.both(wall, M.lining);
  for (const k of ['ws', 'slide', 'fixed'] as const) bag.both(revealGeometry(WINDOWS[k]), M.lining);

  // --- ceiling
  const ceil = ceilingGeometry();
  bag.both(ceil, M.lining);
  // centre strip aft of the overhead console
  const strip = new THREE.PlaneGeometry(2 * OVHD_X + 0.02, Z_END - OVHD_Z_AFT + 0.03);
  strip.rotateX(Math.PI / 2);
  bag.at(strip, M.lining, 0, Y_CEIL_AFT + 0.001, (Z_END + OVHD_Z_AFT - 0.03) / 2);

  // --- floor (carpet) inside the wall outline at y = 0
  bag.add(floorGeometry(), M.carpet);
  // --- forward lower wall (pedal area front), from the floor to the glareshield underside
  const zf = zWs(WS.FRAME_BOTTOM);
  const fw = new THREE.PlaneGeometry(2 * planAt(0.5).xfe + 0.01, WS.FRAME_BOTTOM + 0.02);
  bag.at(fw, M.liningDark, 0, (WS.FRAME_BOTTOM + 0.02) / 2 - 0.001, zf + 0.001);

  // --- main panel side closures & glareshield extensions (both sides)
  sideClosures(bag, app);

  // --- rear bulkhead with the door opening
  bag.add(bulkheadGeometry(), M.lining);

  // --- trims: sun-visor rails along the wall top, sill line, post covers
  trims(bag);

  const g = bag.build('shell:structure', { castShadow: (m) => m !== M.carpet });
  root.add(g);
  void K; void DEG;
  return { root, blockers: [g] };
}

/** Floor outline: the wall plan curve at y = 0 on both sides, closed at the front by the forward wall. */
function floorGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const p0 = planAt(0);
  const N = 40;
  const uEnd = Z_END - p0.zt;
  const v = new THREE.Vector3();
  // right side from the front (fillet start) to the rear
  for (let i = 0; i <= N; i++) {
    const u = p0.uArc + ((uEnd - p0.uArc) * i) / N;
    wallPoint(u, 0, v);
    pts.push(new THREE.Vector2(v.x, v.z));
  }
  // left side from the rear to the front
  for (let i = N; i >= 0; i--) {
    const u = p0.uArc + ((uEnd - p0.uArc) * i) / N;
    wallPoint(u, 0, v);
    pts.push(new THREE.Vector2(-v.x, v.z));
  }
  const shape = new THREE.Shape(pts);
  const g = new THREE.ShapeGeometry(shape, 1);
  // shape is in (x, z) → rotate so that shape y becomes +z, facing up
  g.rotateX(Math.PI / 2);
  // after rotateX(+90°): (x, y, 0) → (x, 0, y) ; normal (0,0,1) → (0,-1,0): flip to face up
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  const idx = g.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  return g;
}

/** Bulkhead section at z = REAR_Z (wall + ceiling outline) with the door opening, facing forward. */
function bulkheadGeometry(): THREE.BufferGeometry {
  const right: THREE.Vector2[] = [];
  // wall at z = REAR_Z from the floor up
  const N = 18;
  for (let i = 0; i <= N; i++) { const y = (Y_WALL_TOP * i) / N; right.push(new THREE.Vector2(wallX(y, REAR_Z) + 0.01, y)); }
  // ceiling section at this station
  const u = REAR_Z - planAt(Y_WALL_TOP).zt;
  const v = new THREE.Vector3();
  for (let i = 1; i <= 12; i++) { ceilMap(u, i / 12, v); right.push(new THREE.Vector2(v.x + 0.01 * (1 - i / 12), v.y + 0.01)); }
  right.push(new THREE.Vector2(0, Y_CEIL_AFT + 0.01));
  const pts: THREE.Vector2[] = [];
  // door notch: from (x1, 0) go up the right jamb, across the head, down the left jamb
  const H = DOOR.height, r = 0.06;
  pts.push(new THREE.Vector2(DOOR.x1, 0));
  for (const p of right) pts.push(p);
  for (let i = right.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(-right[i].x, right[i].y));
  pts.push(new THREE.Vector2(DOOR.x0, 0));
  pts.push(new THREE.Vector2(DOOR.x0, H - r));
  for (let i = 1; i < 6; i++) { const a = Math.PI - (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(DOOR.x0 + r + r * Math.cos(a), H - r + r * Math.sin(a))); }
  pts.push(new THREE.Vector2(DOOR.x0 + r, H));
  pts.push(new THREE.Vector2(DOOR.x1 - r, H));
  for (let i = 1; i < 6; i++) { const a = Math.PI / 2 - (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(DOOR.x1 - r + r * Math.cos(a), H - r + r * Math.sin(a))); }
  pts.push(new THREE.Vector2(DOOR.x1, H - r));
  // ShapeGeometry (body XY plane) faces +z whatever the input orientation; the bulkhead must face −z.
  const shape = new THREE.Shape(pts);
  const g = new THREE.ShapeGeometry(shape, 1);
  const idx = g.getIndex()!;
  for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 0, -1);
  g.translate(0, 0, REAR_Z);
  return g;
}

/** Main panel outboard closures (from the lateral panels to the wall) and glareshield extensions. */
function sideClosures(bag: MergeBag, app: App): void {
  const K = app.kit.mats;
  const Mm = anchorMatrix(ANCHORS.MAIN);
  // main panel: pilot panel spans local y −0.262..0.115 at |x| ≤ 0.934; extend to the wall and down to the console top
  const yTop = 0.115, yBot = -0.33;
  const w = 0.2, x0 = 0.934;
  const slab = geo.roundedBox(w, yTop - yBot, 0.15, 0.004);
  for (const s of [1, -1]) {
    const m = new THREE.Matrix4().makeTranslation(s * (x0 + w / 2), (yTop + yBot) / 2, -0.075 + 0.0005);
    bag.add(slab, K.paint, Mm.clone().multiply(m));
  }
  // glareshield: same profile as mainpanel's housing (GLARE_MP frame), x 0.95 → 1.13
  const t = 40 * DEG;
  const G = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, Math.cos(t), -Math.sin(t)), new THREE.Vector3(0, Math.sin(t), Math.cos(t))).setPosition(0, 1.111, -0.749);
  const face: Array<[number, number]> = [[-0.045, 0], [0.046, 0], [0.046, -0.05], [-0.035, -0.05], [-0.0495, -0.03], [-0.0485, -0.008], [-0.047, -0.002]];
  const nose: Array<[number, number]> = [[0.046, 0]];
  const cx = 0.0565, cz = 0.0015, r = 0.0105;
  for (let i = 0; i <= 10; i++) { const a = (-100 + i * 19) * DEG; nose.push([cx + r * Math.sin(a), cz + r * Math.cos(a) * 0.95]); }
  const top: Array<[number, number]> = [...nose, [0.1075, -0.18], [0.1085, -0.2], [0.085, -0.2], [0.046, -0.05]];
  for (const s of [1, -1]) {
    const a = s > 0 ? 0.95 : -1.13, b = s > 0 ? 1.13 : -0.95;
    bag.add(extrudeX(face, a, b), K.paint, G);
    bag.add(extrudeX(top, a, b), K.antiGlare, G);
  }
}

/** Profile (y, z) extruded along X over [x0, x1] (same convention as mainpanel's extrudeX). */
export function extrudeX(pts: Array<[number, number]>, x0: number, x1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach(([y, z], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Sun-visor rails, window sill line, centre post cover. */
function trims(bag: MergeBag): void {
  const M = shellMats();
  // sun-visor rail: small rounded profile along the wall top, from the corner post aft to the fixed window
  const p0 = planAt(Y_WALL_TOP);
  const rail: THREE.Vector3[] = [];
  const n = new THREE.Vector3();
  for (let i = 0; i <= 30; i++) {
    const u = p0.uArc * 0.6 + ((0.78 - p0.zt - p0.uArc * 0.6) * i) / 30;
    const P = wallPoint(u, Y_WALL_TOP - 0.004, new THREE.Vector3());
    surfNormal(wallMap, u, Y_WALL_TOP - 0.004, n);
    rail.push(P.addScaledVector(n, 0.006));
  }
  const curve = new THREE.CatmullRomCurve3(rail);
  const tube = new THREE.TubeGeometry(curve, 60, 0.0065, 8, false);
  bag.both(tube, M.trim);
  // centre post cover: rounded bar on the windshield frame plane (x = 0), from the glareshield to the header
  const post: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const y = 1.06 + ((1.875 - 1.06) * i) / 12;
    post.push(new THREE.Vector3(0, y, zWs(y)));
  }
  const up = new THREE.Vector3(0, 1, WS.SLOPE).normalize();
  const nrm = new THREE.Vector3(0, -WS.SLOPE, 1).normalize();
  const sec = roundedRectSection(0.074, 0.03, 0.012);
  const rings = post.map((c) => sec.map(([a, b]) => c.clone().add(new THREE.Vector3(a, 0, 0)).addScaledVector(nrm, b)));
  void up;
  bag.add(ringStrip(rings, { closed: true, faceToward: post[6].clone().addScaledVector(nrm, 0.5) }), M.lining);
  // cap at the top
  void W0;
}

/** Half-rounded bar section: width w, depth d (0 → d, toward +b), corner radius r; open at b = 0. */
function roundedRectSection(w: number, d: number, r: number): P2[] {
  const out: P2[] = [];
  const hw = w / 2;
  out.push([-hw, -0.004]);
  for (let i = 0; i <= 6; i++) { const a = Math.PI - (i / 6) * (Math.PI / 2); out.push([-hw + r + r * Math.cos(a), d - r + r * Math.sin(a)]); }
  for (let i = 0; i <= 6; i++) { const a = Math.PI / 2 - (i / 6) * (Math.PI / 2); out.push([hw - r + r * Math.cos(a), d - r + r * Math.sin(a)]); }
  out.push([hw, -0.004]);
  return out;
}

export { toSimple, mirrorX };
