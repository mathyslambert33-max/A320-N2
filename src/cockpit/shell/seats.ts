/**
 * Pilot seats (Ipeco-style A320 crew seats), decorative: base on two floor tracks, seat pan and backrest with
 * side bolsters and lumbar contour under sheepskin covers, adjustable headrest, two armrests (outboard one with
 * the position scale for sidestick flying), 5-point harness with rotary buckle, life-vest pouch under the pan.
 *
 * Geometry is derived from the design eye: the seat reference point (SRP = hip point, junction of the pan and
 * backrest surfaces) is 0.78 m below and 0.12 m aft of the eye → (±0.53, 0.50, 0.12). Seat pan top ≈ 0.52 m,
 * pan front edge z ≈ −0.33, backrest reclined 13°.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { DEG } from './geom';
import { MergeBag, loft, superellipse } from './surf';
import { shellMats } from './mats';

export const SRP = new THREE.Vector3(-0.53, 0.5, 0.12);
const RECLINE = 13 * DEG;

type Deform = (p: THREE.Vector3, u: number, v: number) => void;

/**
 * Super-ellipsoid (half axes a, b, c; exponents: e1 vertical, e2 horizontal; small = boxy) with an optional
 * deformation callback (u around 0..1, v bottom→top 0..1). Indexed, smooth normals.
 */
export function superEllipsoid(a: number, b: number, c: number, e1: number, e2: number, nu = 40, nv = 20, deform?: Deform): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const sp = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const phi = -Math.PI / 2 + v * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const th = u * Math.PI * 2;
      const cp = sp(Math.cos(phi), e1);
      p.set(a * cp * sp(Math.cos(th), e2), b * sp(Math.sin(phi), e1), c * cp * sp(Math.sin(th), e2));
      if (deform) deform(p, u, v);
      pos.push(p.x, p.y, p.z);
      uv.push(u * 4, v * 2);
    }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a0 = j * (nu + 1) + i, a1 = a0 + 1, b0 = a0 + nu + 1, b1 = b0 + 1;
    idx.push(a0, b0, a1, a1, b0, b1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // box-projected UVs (metres × 4): no pole pinching on the cushion tops
  {
    const P = g.getAttribute('position') as THREE.BufferAttribute;
    const N = g.getAttribute('normal') as THREE.BufferAttribute;
    const U = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
      const x = P.getX(i) * 4, y = P.getY(i) * 4, z = P.getZ(i) * 4;
      if (ay >= ax && ay >= az) U.setXY(i, x, z);
      else if (ax >= az) U.setXY(i, z, y);
      else U.setXY(i, x, y);
    }
  }
  // weld the seam normals (u = 0 and u = 1 columns) and the poles
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j <= nv; j++) {
    const i0 = j * (nu + 1), i1 = i0 + nu;
    const x = n.getX(i0) + n.getX(i1), y = n.getY(i0) + n.getY(i1), z = n.getZ(i0) + n.getZ(i1);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i0, x / l, y / l, z / l); n.setXYZ(i1, x / l, y / l, z / l);
  }
  return g;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** One seat in its local frame: origin = SRP, +x = right, +y up, −z forward. `inboard` = +1 if inboard is +x. */
function buildSeat(app: App, inboard: number): THREE.Group {
  const M = shellMats();
  const K = app.kit.mats;
  const g = new THREE.Group();
  const bag = new MergeBag();
  const W = 0.5;

  // ---- seat pan (sheepskin cushion with raised sides and a rounded front "waterfall")
  const pan = superEllipsoid(W / 2, 0.05, 0.235, 0.28, 0.22, 44, 18, (p) => {
    const ax = Math.abs(p.x) / (W / 2);
    if (p.y > 0) {
      p.y += 0.022 * smooth(0.55, 0.92, ax) - 0.01 * (1 - ax * ax) * (1 - (p.z / 0.235) ** 2);
      p.y -= 0.018 * smooth(-0.1, -0.235, p.z); // front edge rolls down
    }
  });
  bag.at(pan, M.sheepskin, 0, -0.03, -0.225);
  // pan shell / frame under the cushion
  bag.at(geo.roundedBox(0.46, 0.05, 0.44, 0.015), M.seatMetal, 0, -0.095, -0.215);

  // ---- backrest (shell + sheepskin cushion with lumbar and bolsters), reclined
  const back = new THREE.Group();
  back.rotation.x = RECLINE; // top moves aft (+z)
  g.add(back);
  const bb = new MergeBag();
  const cushion = superEllipsoid(W / 2 - 0.01, 0.31, 0.055, 0.3, 0.25, 44, 26, (p) => {
    const ax = Math.abs(p.x) / (W / 2);
    const vy = (p.y + 0.31) / 0.62; // 0 bottom .. 1 top
    if (p.z < 0) {
      // front face: side bolsters forward, lumbar bulge low, slight hollow for the shoulders
      p.z -= 0.035 * smooth(0.6, 0.95, ax) + 0.02 * Math.exp(-(((vy - 0.28) / 0.14) ** 2)) * (1 - ax * ax);
    }
    // taper toward the top (shoulders narrower)
    p.x *= 1 - 0.1 * smooth(0.6, 1, vy);
  });
  bb.at(cushion, M.sheepskin, 0, 0.34, 0.03);
  // rigid shell behind (dark fabric/plastic), a bit larger
  const shell = superEllipsoid(W / 2 + 0.005, 0.325, 0.045, 0.22, 0.2, 40, 20, (p) => {
    const vy = (p.y + 0.325) / 0.65;
    p.x *= 1 - 0.1 * smooth(0.6, 1, vy);
  });
  bb.at(shell, M.seatFabric, 0, 0.335, 0.085);
  // headrest on two posts
  const hr = superEllipsoid(0.15, 0.095, 0.045, 0.3, 0.3, 32, 16, (p) => { if (p.z < 0) p.z -= 0.012 * (1 - (p.x / 0.15) ** 2); });
  bb.at(hr, M.sheepskin, 0, 0.8, 0.06);
  bb.at(superEllipsoid(0.155, 0.1, 0.03, 0.25, 0.25, 28, 12), M.seatFabric, 0, 0.8, 0.1);
  for (const sx of [-0.07, 0.07]) bb.at(geo.cylZ(0.007, 0.007, 0.1, 12), K.chrome, sx, 0.66, 0.1, -Math.PI / 2);
  // harness: shoulder straps from the top guide down the front of the backrest
  for (const sx of [-0.085, 0.085]) {
    const pts = [
      new THREE.Vector3(sx * 0.5, 0.7, 0.07), new THREE.Vector3(sx * 0.8, 0.665, -0.015), new THREE.Vector3(sx, 0.5, -0.045),
      new THREE.Vector3(sx * 1.05, 0.3, -0.052), new THREE.Vector3(sx * 0.9, 0.12, -0.05), new THREE.Vector3(sx * 0.6, 0.02, -0.04),
    ];
    bb.add(strap(pts, 0.045, new THREE.Vector3(0, 0, -1)), M.webbing);
  }
  bb.at(geo.roundedBox(0.09, 0.03, 0.05, 0.008), M.seatMetal, 0, 0.7, 0.08);
  back.add(bb.build('seat:back'));

  // ---- lap belts and crotch strap on the pan, rotary buckle
  const buckle = new THREE.Vector3(0, 0.03, -0.3);
  for (const sx of [-1, 1]) {
    const pts = [new THREE.Vector3(sx * 0.235, -0.03, -0.02), new THREE.Vector3(sx * 0.2, 0.024, -0.1), new THREE.Vector3(sx * 0.1, 0.03, -0.23), buckle.clone().add(new THREE.Vector3(sx * 0.03, 0, 0))];
    bag.add(strap(pts, 0.045, new THREE.Vector3(0, 1, 0)), M.webbing);
    // shoulder straps continue from the backrest bottom to the buckle
    const sp = [new THREE.Vector3(sx * 0.055, 0.03, -0.03), new THREE.Vector3(sx * 0.05, 0.034, -0.15), buckle.clone().add(new THREE.Vector3(sx * 0.02, 0.004, 0.02))];
    bag.add(strap(sp, 0.04, new THREE.Vector3(0, 1, 0)), M.webbing);
  }
  bag.add(strap([new THREE.Vector3(0, -0.07, -0.47), new THREE.Vector3(0, 0.005, -0.44), buckle.clone().add(new THREE.Vector3(0, 0, -0.03))], 0.045, new THREE.Vector3(0, 1, 0)), M.webbing);
  bag.add(geo.cylZ(0.035, 0.037, 0.012, 32).clone().rotateX(-Math.PI / 2).translate(buckle.x, buckle.y, buckle.z), K.chrome);
  bag.add(geo.cylZ(0.022, 0.022, 0.004, 24).clone().rotateX(-Math.PI / 2).translate(buckle.x, buckle.y + 0.012, buckle.z), K.knobGrey);

  // ---- armrests (both down): pad on a pivot arm at the backrest sides; outboard one with the adjust knob
  for (const side of [-1, 1]) {
    const ax = side * (W / 2 + 0.035);
    const arm = new MergeBag();
    arm.at(geo.roundedBox(0.07, 0.045, 0.3, 0.018), M.leather, 0, 0, -0.12);
    arm.at(geo.roundedBox(0.03, 0.05, 0.05, 0.01), M.seatMetal, 0, -0.035, 0.02);
    if (side !== inboard) {
      // outboard: armrest height/tilt adjust wheel + position scale
      arm.at(geo.cylZ(0.02, 0.02, 0.012, 24), K.knobKnurl, side * 0.038, -0.01, 0.02, 0, (side * Math.PI) / 2, 0);
      arm.at(geo.box(0.002, 0.03, 0.05), M.white, side * 0.036, -0.03, -0.03);
    }
    const am = arm.build('seat:arm');
    am.position.set(ax, 0.22, 0.05);
    g.add(am);
  }

  // ---- base: carriage on the floor tracks, column, shroud, adjustment levers, life-vest pouch
  const base = new MergeBag();
  const yF = -SRP.y; // floor
  base.at(geo.roundedBox(0.4, 0.05, 0.5, 0.01), M.seatMetal, 0, yF + 0.045, -0.1);
  for (const sx of [-0.17, 0.17]) {
    base.at(geo.roundedBox(0.05, 0.03, 0.48, 0.008), K.darkMetal, sx, yF + 0.03, -0.1);
    for (const sz of [-0.3, 0.1]) base.at(geo.cylZ(0.016, 0.016, 0.03, 16), K.darkMetal, sx, yF + 0.028, sz, 0, Math.PI / 2, 0);
  }
  // column: dark metal structure with a front access cover, the vertical-adjustment actuator and side plates
  base.at(geo.roundedBox(0.26, 0.34, 0.3, 0.015), M.seatMetal, 0, yF + 0.24, -0.12);
  base.at(geo.roundedBox(0.2, 0.26, 0.01, 0.006), M.seatFabric, 0, yF + 0.25, -0.272);
  for (const sx of [-0.135, 0.135]) base.at(geo.roundedBox(0.012, 0.3, 0.26, 0.004), K.darkMetal, sx, yF + 0.24, -0.12);
  base.at(geo.cylZ(0.022, 0.022, 0.26, 16), K.chrome, 0, yF + 0.2, -0.02, -Math.PI / 2);
  base.at(geo.roundedBox(0.36, 0.05, 0.4, 0.015), M.seatMetal, 0, -0.145, -0.16);
  // fore/aft lever (front, under the pan) and height lever (inboard side)
  base.at(geo.roundedBox(0.16, 0.012, 0.02, 0.005), K.chrome, 0, -0.08, -0.43);
  base.at(geo.roundedBox(0.03, 0.018, 0.028, 0.006), M.gripBlack, 0, -0.08, -0.445);
  base.at(geo.roundedBox(0.012, 0.012, 0.12, 0.004), K.chrome, inboard * 0.19, -0.08, -0.33);
  base.at(geo.roundedBox(0.024, 0.02, 0.04, 0.006), M.gripBlack, inboard * 0.19, -0.08, -0.4);
  // recline lever on the outboard side of the pan
  base.at(geo.roundedBox(0.012, 0.012, 0.1, 0.004), K.chrome, -inboard * 0.245, -0.03, -0.02);
  base.at(geo.roundedBox(0.022, 0.024, 0.036, 0.006), M.gripBlack, -inboard * 0.245, -0.03, -0.08);
  // life vest pouch under the pan front
  base.at(geo.roundedBox(0.24, 0.06, 0.1, 0.02), M.orange, 0, -0.16, -0.36);
  base.at(geo.box(0.12, 0.02, 0.002), M.placard, 0, -0.16, -0.411);
  g.add(base.build('seat:base'));
  g.add(bag.build('seat:pan'));
  return g;
}

/** Flat strap (width w) following a smooth path, lying on a surface with normal `up` (approx). */
function strap(pts: THREE.Vector3[], w: number, up: THREE.Vector3): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = 24;
  const secs = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
    secs.push({ c: c.clone().addScaledVector(nrm, 0.003), x: side, y: nrm, pts: superellipse(w / 2, 0.0022, 8, 8) });
  }
  return loft(secs);
}

export function buildSeats(app: App): THREE.Group {
  const root = new THREE.Group();
  root.name = 'shell:seats';
  // captain: inboard = +x
  const c = buildSeat(app, 1);
  c.position.copy(SRP);
  c.name = 'seat:CAPT';
  const f = buildSeat(app, -1);
  f.position.set(-SRP.x, SRP.y, SRP.z);
  f.name = 'seat:FO';
  root.add(c, f);
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  // floor tracks (two per seat)
  const tr = new MergeBag();
  const M = shellMats();
  for (const sx of [SRP.x, -SRP.x]) for (const dx of [-0.17, 0.17]) {
    tr.at(geo.box(0.036, 0.012, 1.0), M.rail, sx + dx, 0.006, 0.02);
    tr.at(geo.box(0.012, 0.0015, 0.98), app.kit.mats.black, sx + dx, 0.0125, 0.02);
  }
  root.add(tr.build('shell:seat_tracks', { castShadow: false }));
  return root;
}
