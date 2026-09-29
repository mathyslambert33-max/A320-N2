/**
 * Overhead console structure: leather-covered surround (with the chamfered forward end of the rack),
 * side housing walls and lips, the forward "eyebrow", the step between the forward rack and the aft
 * panels, and the dark rails/backing visible between the plates. One merged mesh per material and anchor.
 */
import * as THREE from 'three';
import { geo } from '../kit';
import { MM, ovhdMats } from './lib';
import { Y_FWD, Y_AFT, SIDE_D, CHAMFER, GAP } from './fwd';

const m = (v: number) => v * MM;

function place(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  return geo.normalise(g).translate(x, y, z);
}

function surround(outer: [number, number, number, number], hole: Array<[number, number]>, z0: number, z1: number): THREE.BufferGeometry {
  const [x0, y0, x1, y1] = outer.map(m);
  const s = new THREE.Shape();
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
  const h = new THREE.Path();
  hole.forEach(([x, y], i) => (i ? h.lineTo(m(x), m(y)) : h.moveTo(m(x), m(y))));
  h.closePath();
  s.holes.push(h);
  const bevel = 0.0015;
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0 - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, z0 + bevel);
  return g;
}

function housing(yMin: number, yMax: number, opts: { front?: boolean; back?: boolean }): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const len = m(yMax - yMin), yc = m((yMax + yMin) / 2);
  for (const s of [-1, 1]) {
    // side wall up into the ceiling
    out.push(place(geo.box(0.01, len, 0.12), s * 0.36, yc, -0.052));
    // protruding rounded lip along the outer edge
    out.push(place(geo.roundedBox(0.022, len, 0.024, 0.006), s * 0.354, yc, 0.004));
  }
  if (opts.front) {
    out.push(place(geo.box(0.73, 0.01, 0.12), 0, m(yMin) + 0.005, -0.052));
    out.push(place(geo.roundedBox(0.73, 0.03, 0.026, 0.008), 0, m(yMin) + 0.013, 0.005));
  }
  if (opts.back) out.push(place(geo.box(0.73, 0.01, 0.12), 0, m(yMax) - 0.005, -0.052));
  return out;
}

function finishMeshes(root: THREE.Group, parts: THREE.BufferGeometry[], backing: THREE.BufferGeometry[], name: string): void {
  const OM = ovhdMats();
  const g1 = geo.mergeGeometries(parts.map((p) => geo.normalise(p)))!;
  const frame = new THREE.Mesh(g1, OM.leather);
  frame.name = `${name}:frame`;
  frame.castShadow = true;
  frame.receiveShadow = true;
  const g2 = geo.mergeGeometries(backing.map((p) => geo.normalise(p)))!;
  const back = new THREE.Mesh(g2, OM.backing);
  back.name = `${name}:backing`;
  back.receiveShadow = true;
  root.add(frame, back);
}

/** OVHD anchor: surround with the forward rack outline + the aft strip, housing, nose, step lip. */
export function buildFrameFwd(root: THREE.Group): void {
  const yInner = Y_AFT - SIDE_D - GAP;
  const yOuter = yInner + CHAMFER;
  const yC = Y_FWD - GAP;
  const hole: Array<[number, number]> = [
    [-316.5, 470], [316.5, 470], [316.5, yOuter], [167.5, yInner], [165.5, yInner], [165.5, yC + 16],
    [150, yC], [-150, yC], [-165.5, yC + 16], [-165.5, yInner], [-167.5, yInner], [-316.5, yOuter],
  ];
  const parts = [surround([-365, -475, 365, 475], hole, -0.012, 0.008), ...housing(-475, 475, { front: true })];
  // step between the forward rack and the aft strip
  parts.push(place(geo.roundedBox(0.633, 0.0058, 0.011, 0.0018), 0, m(Y_AFT + 3), 0.0005));
  const backing = [place(geo.box(0.634, m(470 - yC + 2), 0.003), 0, m((470 + yC) / 2), -0.0062)];
  // Dzus rails between the columns (slightly raised strips carrying the fasteners)
  for (const s of [-1, 1]) backing.push(place(geo.box(0.0034, m(470 - yInner), 0.0016), s * 0.1665, m((470 + yInner) / 2), -0.0042));
  finishMeshes(root, parts, backing, 'OVHD');
}

/** OVHD_AFT anchor. */
export function buildFrameAft(root: THREE.Group): void {
  const hole: Array<[number, number]> = [[-316.5, -247.8], [316.5, -247.8], [316.5, 245.8], [-316.5, 245.8]];
  const parts = [surround([-365, -250, 365, 250], hole, -0.012, 0.008), ...housing(-250, 250, { back: true })];
  const backing = [place(geo.box(0.634, 0.494, 0.003), 0, -0.001, -0.0062)];
  for (const s of [-1, 1]) backing.push(place(geo.box(0.0034, 0.494, 0.0016), s * 0.1665, -0.001, -0.0042));
  finishMeshes(root, parts, backing, 'OVHD_AFT');
}
