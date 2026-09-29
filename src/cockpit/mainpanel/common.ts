/**
 * Shared helpers for the main panel / glareshield module.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo, type PanelBuilder, type Handle } from '../kit';
import type { Anchor } from '../layout';

export const DEG = Math.PI / 180;

/**
 * Glareshield frame actually used by this module.
 *
 * The lead's GLARE anchor (origin (0, 1.10, −0.63), face tilted 25°) puts the glareshield lower edge
 * 11 cm aft of the main panel: seen from the design eye it hides the top ~25 % of the PFDs/NDs
 * (FMA lines). Real A320: the whole DUs are visible under the glareshield. We keep the width and
 * the windshield-base contact point (y 1.08, z −0.95) and move the face forward/up and recline it
 * to 40°, so that its lower edge sits just above the sight line to the DU bezel tops (15.8° below
 * the horizon from EYE_CAPT) while the FCU remains well readable.
 */
export const GLARE_MP: Anchor = (() => {
  const t = 40 * DEG;
  return {
    name: 'GLARE_MP',
    origin: new THREE.Vector3(0, 1.111, -0.749),
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, Math.cos(t), -Math.sin(t)),
    z: new THREE.Vector3(0, Math.sin(t), Math.cos(t)),
    width: 1.9,
    height: 0.09,
    desc: 'Glareshield face as built by mainpanel (reclined 40°, see docs/vars/mainpanel.md)',
  };
})();

/** Collects static geometry per material and merges it into one mesh per material. */
export class Batch {
  private readonly lists = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(g: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4): void {
    const gg = geo.normalise(g);
    if (m) gg.applyMatrix4(m);
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(gg);
  }

  /** Add at a position with an optional Euler rotation (degrees, XYZ order). */
  at(g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx * DEG, ry * DEG, rz * DEG)).setPosition(x, y, z);
    this.add(g, mat, m);
  }

  build(name: string, shadows = true): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, list] of this.lists) {
      const merged = geo.mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}:static`;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    this.lists.clear();
    return g;
  }
}

let _screw: { head: THREE.BufferGeometry; slot: THREE.BufferGeometry } | null = null;
/** Small Phillips screw (DU bezels, instruments). */
export function screwGeo(): { head: THREE.BufferGeometry; slot: THREE.BufferGeometry } {
  if (_screw) return _screw;
  const head = geo.latheZ('mpScrew', [[0, 0], [0.0021, 0], [0.0021, 0.0004], [0.0017, 0.0009], [0, 0.001]], 16);
  const a = new THREE.BoxGeometry(0.0026, 0.0005, 0.0003);
  a.translate(0, 0, 0.001);
  const b = a.clone();
  b.rotateZ(Math.PI / 2);
  const slot = geo.mergeGeometries([geo.normalise(a), geo.normalise(b)])!;
  _screw = { head, slot };
  return _screw;
}

export function addScrew(p: PanelBuilder, M: App['kit']['mats'], x: number, y: number, z: number): void {
  const s = screwGeo();
  p.addStatic(s.head, M.darkMetal, x, y, z, 0);
  p.addStatic(s.slot, M.black, x, y, z, 25);
}

/** Handle registered on the meshes of a kit control (to extend its hit area with extra meshes). */
export function handleOf(obj: THREE.Object3D): Handle | undefined {
  let h: Handle | undefined;
  obj.traverse((o) => { if (!h && o.userData.handle) h = o.userData.handle as Handle; });
  return h;
}

/** Add extra meshes to the rotating part of a kit knob (enc/rot/pot root) and make them clickable. */
export function decorateKnob(app: App, root: THREE.Group, extras: THREE.Object3D[]): void {
  const knob = root.children[0] as THREE.Group;
  const h = handleOf(knob);
  for (const e of extras) {
    e.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    knob.add(e);
    if (h) app.interaction.register(e, h);
  }
}

export interface RingOptions {
  rIn: number;
  rOut: number;
  h?: number;
  /** Tab angle (deg, clockwise from 12 o'clock) for each position. */
  angles: number[];
  labels: string[];
  labelAngles?: number[];
  labelRadius: number;
  labelSize?: number;
}

/**
 * Concentric selector ring around a knob (EFIS in Hg / hPa ring, FCU 100 / 1000 ring) bound to a
 * catalog 'sw' control. Click = next position (left/right half), wheel = step, drag-free.
 */
export function ringSelector(app: App, p: PanelBuilder, id: string, x: number, y: number, o: RingOptions): THREE.Group {
  const kit = app.kit;
  const M = kit.mats;
  const def = kit.def(id);
  const n = def.pos?.length ?? o.angles.length;
  const h = o.h ?? 0.0045;
  const root = new THREE.Group();
  root.name = id;
  p.add(root, x, y, 0);
  const ring = new THREE.Group();
  root.add(ring);
  const body = new THREE.Mesh(
    geo.latheZ(`mpRing${o.rIn}|${o.rOut}|${h}`, [[o.rIn, 0], [o.rOut, 0], [o.rOut, h * 0.75], [o.rOut - 0.0006, h], [o.rIn, h], [o.rIn, 0]], 48),
    M.knobKnurl,
  );
  const tab = new THREE.Mesh(geo.roundedBox(0.0036, 0.0055, h * 0.9, 0.0008), M.knob);
  tab.position.set(0, o.rOut + 0.002, h * 0.45);
  const idx = new THREE.Mesh(geo.box(0.0007, 0.004, 0.0003), M.white);
  idx.position.set(0, o.rOut + 0.0022, h * 0.9 + 0.0002);
  ring.add(body, tab, idx);
  ring.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  let cur = o.angles[def.init ?? 0] ?? 0;
  ring.rotation.z = -cur * DEG;
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const v = Math.max(0, Math.min(n - 1, Math.round(sim.get(`C:${id}`))));
      cur += (o.angles[v] - cur) * Math.min(1, dt * 25);
      ring.rotation.z = -cur * DEG;
    },
  });
  const step = (dir: number) => {
    const v = Math.round(kit.sim.get(`C:${id}`));
    let nv = v + dir;
    if (n === 2) nv = v ? 0 : 1; // two-position ring: any action toggles
    nv = Math.max(0, Math.min(n - 1, nv));
    if (nv !== v) kit.setControl(id, nv, root, 'rot');
  };
  const handle: Handle = {
    id,
    ref: root,
    cursor: 'rotate',
    onDown: (e) => step((e.local.x >= 0 ? 1 : -1) * (e.button === 2 ? -1 : 1)),
    onWheel: (s) => step(s > 0 ? 1 : -1),
    describe: () => kit.describe(def),
  };
  app.interaction.register(ring, handle);
  const la = o.labelAngles ?? o.angles;
  o.labels.forEach((t, i) => {
    const a = la[i] * DEG;
    p.label(t, x + Math.sin(a) * o.labelRadius, y + Math.cos(a) * o.labelRadius, { size: o.labelSize ?? 0.0019 });
  });
  return root;
}

/** Profile (in the local (y, z) plane) extruded along X over [x0, x1]. Points are [y, z]. */
export function extrudeX(pts: Array<[number, number]>, x0: number, x1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  // shape coordinates: sx = −z, sy = y ; after rotateY(+90°): x' = extrusion, z' = −sx = z
  pts.forEach(([y, z], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  g.computeVertexNormals();
  return g;
}
