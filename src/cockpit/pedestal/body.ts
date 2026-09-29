/**
 * Pedestal structure (aircraft body frame, metres): side walls down to the floor, wide forward section
 * (x ±0.2575, three 146 / 214 / 146 mm panel columns) and narrower aft section (x ±0.1955), fairing to the main
 * instrument panel under the SD, dark backing under the panels, wheel-slot wells, rim lips, kick plates and the
 * sloping aft face with its ventilation grille and the cockpit handset.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { ANCHORS, anchorMatrix } from '../layout';
import { pedMats, extrudeX } from './lib';

/** Key body-frame dimensions shared with build.ts. */
export const BODY = {
  yTop: 0.58,
  zBreak: -0.40,
  /** End of the wide section (step) and aft end of the top. */
  zStep: -0.105,
  zAft: 0.1556,
  /** Aft face bottom (the lower aft face slopes aft). */
  zAftFloor: 0.205,
  /** Outer half widths. */
  wWide: 0.2575,
  wNarrow: 0.1955,
  /** Wall thickness. */
  t: 0.006,
  /** Slope end (slope-local y) at the fairing, and the fairing top height / main panel face z. */
  sFront: 0.108,
  yFairing: 0.6614,
  zPanelFace: -0.6544,
};

export function buildBody(app: App): THREE.Group {
  const M = materials();
  const PM = pedMats();
  const B = BODY;
  const paint: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const cavity: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  const add = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, mtx?: THREE.Matrix4) => {
    const n = geo.normalise(g);
    if (mtx) n.applyMatrix4(mtx);
    list.push(n);
  };
  const fwdM = anchorMatrix(ANCHORS.PED_FWD);
  const slopePt = (s: number): [number, number] => {
    const p = new THREE.Vector3(0, s, 0).applyMatrix4(fwdM);
    return [p.y, p.z];
  };
  const [yS, zS] = slopePt(B.sFront);

  // ---- side walls, wide section: top edge = fairing → slope → flat
  const wideProfile: Array<[number, number]> = [
    [0, B.zPanelFace], [B.yFairing, B.zPanelFace], [yS, zS], [B.yTop, B.zBreak], [B.yTop, B.zStep], [0, B.zStep],
  ];
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? B.wWide - B.t : -B.wWide;
    add(paint, extrudeX(wideProfile, x0, x0 + B.t));
  }
  // step face (aft end of the wide section)
  for (const s of [-1, 1]) {
    const xa = s > 0 ? B.wNarrow - B.t : -B.wWide, xb = s > 0 ? B.wWide : -B.wNarrow + B.t;
    add(paint, extrudeX([[0, B.zStep - B.t], [B.yTop, B.zStep - B.t], [B.yTop, B.zStep], [0, B.zStep]], xa, xb));
  }
  // side walls, narrow section with the sloping aft face
  const narrowProfile: Array<[number, number]> = [[0, B.zStep - B.t], [B.yTop, B.zStep - B.t], [B.yTop, B.zAft], [0, B.zAftFloor]];
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? B.wNarrow - B.t : -B.wNarrow;
    add(paint, extrudeX(narrowProfile, x0, x0 + B.t));
  }
  // aft face (sloping plate) and front face (hidden under the main panel)
  add(paint, extrudeX([[B.yTop, B.zAft - B.t], [B.yTop, B.zAft], [0, B.zAftFloor], [0, B.zAftFloor - B.t]], -B.wNarrow + B.t, B.wNarrow - B.t));
  add(paint, extrudeX([[0, B.zPanelFace], [B.yFairing, B.zPanelFace], [B.yFairing, B.zPanelFace + B.t], [0, B.zPanelFace + B.t]], -B.wWide + B.t, B.wWide - B.t));
  // fairing: flat cap from the slope's forward edge to the main panel face, just under the SD bezel
  add(trim, extrudeX([[yS - 0.004, zS], [B.yFairing + 0.0015, zS + 0.002], [B.yFairing + 0.0015, B.zPanelFace + 0.001], [yS - 0.004, B.zPanelFace + 0.001]], -B.wWide, B.wWide));

  // ---- dark backing under the panels (visible through the seams)
  const bY = B.yTop - 0.0075;
  add(dark, geo.box(2 * (B.wWide - B.t), 0.003, B.zStep - B.zBreak), new THREE.Matrix4().makeTranslation(0, bY, (B.zStep + B.zBreak) / 2));
  add(dark, geo.box(2 * (B.wNarrow - B.t), 0.003, B.zAft - B.zStep), new THREE.Matrix4().makeTranslation(0, bY, (B.zAft + B.zStep) / 2));
  {
    const len = B.sFront + 0.13;
    const g = geo.box(2 * (B.wWide - B.t), len, 0.003);
    add(dark, g, fwdM.clone().multiply(new THREE.Matrix4().makeTranslation(0, (B.sFront - 0.13) / 2, -0.0075)));
  }

  // ---- rim lips along the top edges of the side walls
  const lip = (a: [number, number], b: [number, number], x: number, w = 0.009) => {
    const dy = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dy, dz);
    const g = geo.roundedBox(w, 0.009, len + 0.004, 0.0035);
    const ang = Math.atan2(-dy, dz); // rotation about X so the box's +z follows a→b
    const mtx = new THREE.Matrix4().makeTranslation(x, (a[0] + b[0]) / 2 + 0.0015, (a[1] + b[1]) / 2).multiply(new THREE.Matrix4().makeRotationX(ang));
    add(trim, g, mtx);
  };
  for (const s of [-1, 1]) {
    const xw = s * (B.wWide - 0.0035), xn = s * (B.wNarrow - 0.0035);
    lip([yS, zS], [B.yTop, B.zBreak], xw);
    lip([B.yTop, B.zBreak], [B.yTop, B.zStep], xw);
    lip([B.yTop, B.zStep - 0.003], [B.yTop, B.zAft], xn);
    // step lip across the wide section's aft edge
    const g = geo.roundedBox(B.wWide - B.wNarrow + 0.004, 0.009, 0.009, 0.0035);
    add(trim, g, new THREE.Matrix4().makeTranslation(s * (B.wNarrow + B.wWide) / 2, B.yTop + 0.0015, B.zStep - 0.0015));
  }
  add(trim, geo.roundedBox(2 * B.wNarrow, 0.009, 0.009, 0.0035), new THREE.Matrix4().makeTranslation(0, B.yTop + 0.0015, B.zAft - 0.0012));

  // ---- kick plates (dark band at the floor)
  const kick = 0.075;
  for (const s of [-1, 1]) {
    add(trim, geo.box(0.003, kick, B.zStep - B.zPanelFace), new THREE.Matrix4().makeTranslation(s * (B.wWide + 0.0015), kick / 2, (B.zStep + B.zPanelFace) / 2));
    add(trim, geo.box(0.003, kick, B.zAftFloor - B.zStep), new THREE.Matrix4().makeTranslation(s * (B.wNarrow + 0.0015), kick / 2, (B.zAftFloor + B.zStep) / 2));
    add(trim, geo.box(B.wWide - B.wNarrow, kick, 0.003), new THREE.Matrix4().makeTranslation(s * (B.wWide + B.wNarrow) / 2, kick / 2, B.zStep + 0.0015));
  }

  // ---- aft face: ventilation grille (ribs) on the lower part, handset cradle on the upper part
  const aftN = new THREE.Vector3(0, B.zAftFloor - B.zAft, B.yTop).normalize(); // outward normal of the aft face (y, z)
  const onAft = (h: number, out: number) => {
    // point on the aft face at height h (0..yTop), pushed `out` along the normal
    const t = h / B.yTop;
    const z = B.zAftFloor + (B.zAft - B.zAftFloor) * t;
    return new THREE.Vector3(0, h + aftN.y * out, z + aftN.z * out);
  };
  const faceTilt = Math.atan2(B.zAftFloor - B.zAft, B.yTop); // face leans aft at the bottom
  for (let i = 0; i < 9; i++) {
    const p = onAft(0.1 + i * 0.013, 0.002);
    add(dark, geo.roundedBox(0.3, 0.0045, 0.004, 0.0015), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationX(-faceTilt)));
  }
  {
    // cockpit interphone handset in its cradle (upper aft face)
    const rx = new THREE.Matrix4().makeRotationX(-faceTilt);
    const c = onAft(0.43, 0.004);
    add(dark, geo.roundedBox(0.17, 0.05, 0.008, 0.004), new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(rx));
    const hp = onAft(0.43, 0.017);
    add(cavity, geo.roundedBox(0.15, 0.03, 0.02, 0.009), new THREE.Matrix4().makeTranslation(hp.x, hp.y, hp.z).multiply(rx));
    for (const s of [-1, 1]) {
      const ep = onAft(0.43, 0.022);
      add(cavity, geo.roundedBox(0.034, 0.042, 0.022, 0.01), new THREE.Matrix4().makeTranslation(ep.x + s * 0.066, ep.y, ep.z).multiply(rx));
    }
  }

  const g = new THREE.Group();
  g.name = 'PED:body';
  const mk = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string, cast = true) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(geo.mergeGeometries(list)!, mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    g.add(mesh);
    app.interaction.addBlocker(mesh);
  };
  mk(paint, M.paint, 'PED:body:walls');
  mk(dark, PM.cavity, 'PED:body:backing', false);
  mk(trim, PM.trim, 'PED:body:trim');
  mk(cavity, new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.5, metalness: 0.05 }), 'PED:body:handset');
  return g;
}

/** Wheel wells of the pitch trim wheels, in the PED anchor frame (dark cavity boxes under the slots). */
export function wheelWells(): THREE.Mesh {
  const PM = pedMats();
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const x = s * 0.0935;
    // floor of the slot (hides the lower part of the wheel) and inner walls
    parts.push(geo.normalise(geo.box(0.0275, 0.26, 0.004)).translate(x, 0.325, -0.024));
    parts.push(geo.normalise(geo.box(0.0015, 0.26, 0.022)).translate(s * 0.0795, 0.325, -0.013));
    parts.push(geo.normalise(geo.box(0.0015, 0.26, 0.022)).translate(s * 0.1072, 0.325, -0.013));
  }
  const mesh = new THREE.Mesh(geo.mergeGeometries(parts)!, PM.cavity);
  mesh.name = 'PED:wells';
  return mesh;
}
