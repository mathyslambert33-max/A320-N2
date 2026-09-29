/**
 * Aft flight deck: coat stowage (left rear corner) with the folded 4th-occupant seat on its forward face,
 * folded 3rd-occupant seat on the bulkhead right of the door, rear right circuit-breaker panel, and the
 * emergency equipment where it is on the A320 (decorative): portable Halon fire extinguisher and protective
 * gloves behind the captain's seat, crash axe and portable oxygen bottle with mask on the right rear,
 * smoke hood (PBE) container, flashlights, life-vest pouches on the jump seats, escape-rope stowages in the
 * ceiling above each sliding window, flight-deck loudspeaker grilles.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { REAR_Z, DOOR, W0, wallX, DEG, planAt, Y_WALL_TOP } from './geom';
import { MergeBag, loft, superellipse } from './surf';
import { shellMats } from './mats';
import { superEllipsoid } from './seats';
import { ceilMap } from './structure';

export function buildRear(app: App): { root: THREE.Group; blockers: THREE.Object3D[] } {
  const M = shellMats();
  const K = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'shell:rear';
  const b = new MergeBag();

  // ---- coat stowage: tall cabinet in the left rear corner (inboard face at x −0.50, forward face at z 0.95)
  const cz0 = 0.95, cz1 = REAR_Z, cx0 = -1.25, cx1 = -0.5, cyTop = 2.12;
  b.at(geo.roundedBox(cx1 - cx0, cyTop, cz1 - cz0, 0.012), M.lining, (cx0 + cx1) / 2, cyTop / 2, (cz0 + cz1) / 2);
  // forward face: closet door with a handle and a louvred vent; the folded 4th-occupant seat below
  const dxC = (cx1 + -0.98) / 2;
  b.at(geo.box(0.44, 1.9, 0.006), M.doorLining, dxC, 1.08, cz0 - 0.003);
  b.at(geo.box(0.44, 0.004, 0.008), M.liningDark, dxC, 0.13, cz0 - 0.004);
  b.at(geo.roundedBox(0.02, 0.12, 0.03, 0.008), K.chrome, cx1 - 0.05, 1.3, cz0 - 0.02);
  for (let i = 0; i < 6; i++) b.at(geo.box(0.26, 0.008, 0.006), M.liningDark, dxC, 1.82 - i * 0.022, cz0 - 0.006);
  b.at(geo.box(0.12, 0.05, 0.002), M.placard, dxC, 1.95, cz0 - 0.007);
  // inboard face panel seams
  b.at(geo.box(0.004, 2.0, 0.004), M.liningDark, cx1 + 0.001, 1.0, (cz0 + cz1) / 2);

  // ---- 4th occupant folding seat (stowed on the closet front)
  foldedSeat(b, new THREE.Vector3(dxC, 0.0, cz0 - 0.004), new THREE.Vector3(0, 0, -1), app);
  // ---- 3rd occupant folding seat (stowed on the bulkhead right of the door)
  foldedSeat(b, new THREE.Vector3(0.7, 0.0, REAR_Z - 0.002), new THREE.Vector3(0, 0, -1), app);

  // ---- rear right circuit-breaker panel (on the side wall aft of the fixed window)
  const cb = buildCbPanel(app);
  root.add(cb);

  // ---- emergency equipment
  // Halon fire extinguisher behind the captain's seat, low on the left wall, strap bracket
  const exX = -(W0(0.25) - 0.075), exZ = 0.72;
  b.add(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.05, 0), new THREE.Vector2(0.055, 0.01), new THREE.Vector2(0.055, 0.3),
    new THREE.Vector2(0.045, 0.33), new THREE.Vector2(0.02, 0.345), new THREE.Vector2(0.018, 0.36),
  ], 28).translate(exX, 0.06, exZ), M.fireRed);
  b.at(geo.roundedBox(0.03, 0.05, 0.1, 0.008), K.black, exX, 0.44, exZ - 0.01);
  b.at(geo.roundedBox(0.02, 0.012, 0.12, 0.004), K.black, exX, 0.47, exZ - 0.03, 0, 0, 0);
  b.at(geo.cylZ(0.009, 0.009, 0.05, 12), K.chrome, exX, 0.41, exZ - 0.06);
  b.at(geo.box(0.07, 0.1, 0.002), M.placard, exX + 0.056, 0.26, exZ);
  for (const y of [0.14, 0.3]) b.at(geo.box(0.125, 0.025, 0.125), K.darkMetal, exX, y, exZ);
  b.at(geo.box(0.02, 0.4, 0.1), K.darkMetal, exX - 0.065, 0.24, exZ);
  // protective gloves pouch next to it
  b.at(geo.roundedBox(0.03, 0.18, 0.12, 0.01), M.seatFabric, -(W0(0.5) - 0.02), 0.52, 0.72);
  // smoke hood (PBE) container further aft on the left wall
  b.at(geo.roundedBox(0.12, 0.2, 0.16, 0.01), M.yellow, -(wallX(0.5, 0.86) - 0.06), 0.36, 0.86);
  b.at(geo.box(0.002, 0.06, 0.1), M.placard, -(wallX(0.5, 0.86) - 0.121), 0.4, 0.86);
  // crash axe on the right rear, below the C/B panel
  const axX = wallX(0.3, 1.1) - 0.03;
  b.add(loft([0, 0.35].map((t, i) => ({ c: new THREE.Vector3(axX, 0.14 + t, 1.1), x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, 1), pts: superellipse(0.012, 0.018, 2.5, 12) }))).translate(0, 0, 0) as THREE.BufferGeometry, M.yellow);
  b.at(geo.box(0.012, 0.05, 0.13), K.chrome, axX, 0.52, 1.13);
  b.at(geo.box(0.014, 0.035, 0.03), K.black, axX, 0.5, 1.07);
  for (const y of [0.2, 0.42]) b.at(geo.box(0.035, 0.02, 0.05), K.darkMetal, axX + 0.012, y, 1.1);
  // portable oxygen bottle with mask (right rear, near the 3rd-occupant seat)
  const obX = wallX(0.3, 1.24) - 0.07;
  b.add(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(0.055, 0), new THREE.Vector2(0.06, 0.02), new THREE.Vector2(0.06, 0.34), new THREE.Vector2(0.03, 0.38), new THREE.Vector2(0.015, 0.4),
  ], 24).translate(obX, 0.05, 1.24), M.bottleGreen);
  b.at(geo.roundedBox(0.04, 0.05, 0.04, 0.008), K.chrome, obX, 0.46, 1.24);
  b.at(geo.roundedBox(0.07, 0.05, 0.05, 0.02), M.yellow, obX - 0.06, 0.4, 1.24);
  for (const y of [0.12, 0.3]) b.at(geo.box(0.13, 0.02, 0.13), K.darkMetal, obX, y, 1.24);
  // flashlights in clips (left rear and right rear)
  for (const [x, z] of [[-(W0(1.2) - 0.03), 0.92], [wallX(1.2, 1.28) - 0.03, 1.28]] as const) {
    b.at(geo.cylZ(0.018, 0.02, 0.2, 16), K.darkMetal, x, 1.1, z, -Math.PI / 2);
    b.at(geo.box(0.02, 0.025, 0.04), K.black, x, 1.17, z);
  }
  // observer oxygen mask stowage boxes
  b.at(geo.roundedBox(0.14, 0.11, 0.07, 0.01), K.paintDark, dxC, 1.55, cz0 - 0.04);
  b.at(geo.roundedBox(0.14, 0.11, 0.07, 0.01), K.paintDark, 0.7, 1.62, REAR_Z - 0.04);

  // ---- escape rope stowage hatches in the ceiling above the sliding windows
  const pT = planAt(Y_WALL_TOP);
  for (const s of [-1, 1]) {
    const u = -0.2 - pT.zt;
    const c = ceilMap(u, 0.3, new THREE.Vector3());
    const du = ceilMap(u + 0.01, 0.3, new THREE.Vector3()).sub(c).normalize();
    const dw = ceilMap(u, 0.31, new THREE.Vector3()).sub(c).normalize();
    const n = new THREE.Vector3().crossVectors(du, dw).normalize();
    const m = new THREE.Matrix4().makeBasis(du, dw, n).setPosition(c.clone().addScaledVector(n, 0.004));
    const mm = s < 0 ? new THREE.Matrix4().makeScale(-1, 1, 1).multiply(m) : m;
    b.add(geo.roundedBox(0.3, 0.1, 0.008, 0.004).clone(), M.liningDark, mm);
    b.add(geo.box(0.1, 0.028, 0.003).clone().translate(0, 0, 0.005), M.placard, mm);
    b.add(geo.roundedBox(0.04, 0.012, 0.012, 0.004).clone().translate(0.1, 0, 0.008), K.chrome, mm);
  }
  // ---- loudspeaker grilles in the ceiling above each pilot
  for (const s of [-1, 1]) {
    const u = -0.08 - pT.zt;
    const c = ceilMap(u, 0.55, new THREE.Vector3());
    const du = ceilMap(u + 0.01, 0.55, new THREE.Vector3()).sub(c).normalize();
    const dw = ceilMap(u, 0.56, new THREE.Vector3()).sub(c).normalize();
    const n = new THREE.Vector3().crossVectors(du, dw).normalize();
    const m = new THREE.Matrix4().makeBasis(du, dw, n).setPosition(c.clone().addScaledVector(n, 0.002));
    const mm = s < 0 ? new THREE.Matrix4().makeScale(-1, 1, 1).multiply(m) : m;
    b.add(geo.cylZ(0.065, 0.068, 0.006, 40).clone(), K.bezel, mm);
    b.add(geo.cylZ(0.058, 0.058, 0.0065, 40).clone(), M.grille, mm);
  }
  const g = b.build('shell:rear');
  root.add(g);
  void DOOR; void DEG;
  return { root, blockers: [g] };
}

/** Folded jump seat: seat pan folded up against the wall, backrest cushion + headrest, harness straps. */
function foldedSeat(b: MergeBag, base: THREE.Vector3, n: THREE.Vector3, app: App): void {
  const M = shellMats();
  const K = app.kit.mats;
  const x = base.x, z = base.z + n.z * 0.0;
  // frame rails on the wall
  for (const dx of [-0.19, 0.19]) b.at(geo.box(0.025, 1.1, 0.02), K.darkMetal, x + dx, 0.75, z - 0.012);
  // folded seat pan (vertical), cushion facing forward
  const pan = superEllipsoid(0.2, 0.19, 0.035, 0.3, 0.25, 28, 14);
  b.at(pan, M.seatFabric, x, 0.62, z - 0.055);
  b.at(geo.roundedBox(0.4, 0.38, 0.02, 0.01), K.darkMetal, x, 0.62, z - 0.02);
  // backrest cushion and headrest on the wall above
  const back = superEllipsoid(0.2, 0.22, 0.035, 0.3, 0.25, 28, 14);
  b.at(back, M.seatFabric, x, 1.12, z - 0.04);
  const head = superEllipsoid(0.12, 0.08, 0.03, 0.3, 0.3, 20, 10);
  b.at(head, M.seatFabric, x, 1.44, z - 0.035);
  // harness straps hanging
  for (const dx of [-0.08, 0.08]) b.at(geo.box(0.04, 0.55, 0.004), M.webbing, x + dx, 1.08, z - 0.078);
  b.at(geo.cylZ(0.03, 0.03, 0.01, 24), K.chrome, x, 0.8, z - 0.085);
  // life vest pouch under the folded pan
  b.at(geo.roundedBox(0.22, 0.08, 0.06, 0.015), M.orange, x, 0.36, z - 0.035);
}

/** Rear right C/B panel: grey panel with rows of circuit breakers (instanced) and engraved row labels. */
function buildCbPanel(app: App): THREE.Group {
  const g = new THREE.Group();
  g.name = 'shell:cb_panel';
  const W = 0.56, H = 0.8;
  const p = app.kit.panel({ name: 'REAR_CB_121VU', width: W, height: H, zone: 'ovhd', thickness: 0.006, pxPerM: 2600 });
  const rows = 12, cols = 18;
  const pos: Array<[number, number]> = [];
  const names = ['AFS', 'FMGC', 'FCU', 'EFIS', 'ELAC', 'SEC', 'FAC', 'ECB', 'FWC', 'SDAC', 'DMC', 'ADIRU', 'LGCIU', 'BSCU', 'CFDIU', 'FUEL', 'HYD', 'ENG'];
  for (let r = 0; r < rows; r++) {
    const y = H / 2 - 0.06 - r * 0.058;
    if (r % 5 === 4) { p.line([[-W / 2 + 0.02, y + 0.02], [W / 2 - 0.02, y + 0.02]], 0.0006, 0.6); continue; }
    for (let c = 0; c < cols; c++) {
      if ((r * 7 + c * 3) % 11 === 0) continue;
      const x = -W / 2 + 0.035 + c * 0.029;
      pos.push([x, y]);
      if (c % 3 === 0) p.label(names[(r + c) % names.length], x + 0.0145, y + 0.017, { size: 0.0019 });
    }
    p.label(String.fromCharCode(65 + r), -W / 2 + 0.015, y, { size: 0.0024 });
  }
  p.label('121VU', 0, -H / 2 + 0.018, { size: 0.0032 });
  const face = p.finish();
  g.add(face);
  // instanced breaker heads (black collars + white ring bands)
  const head = geo.cylZ(0.0055, 0.006, 0.012, 14);
  const ring = geo.cylZ(0.0058, 0.0058, 0.002, 14);
  const hm = new THREE.InstancedMesh(head, app.kit.mats.knob, pos.length);
  const rm = new THREE.InstancedMesh(ring, shellMats().white, pos.length);
  const m = new THREE.Matrix4();
  pos.forEach(([x, y], i) => {
    m.makeTranslation(x, y, 0);
    hm.setMatrixAt(i, m);
    m.makeTranslation(x, y, 0.008);
    rm.setMatrixAt(i, m);
  });
  g.add(hm, rm);
  // place on the right wall aft of the fixed window, following the wall's inward lean (normal from the wall)
  const zc = 1.02, yc = 1.2;
  const P = new THREE.Vector3(wallX(yc, zc), yc, zc);
  const dy = new THREE.Vector3(wallX(yc + 0.05, zc) - wallX(yc - 0.05, zc), 0.1, 0).normalize();
  const nrm = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), dy).normalize(); // points −x (into the cockpit)
  const right = new THREE.Vector3().crossVectors(dy, nrm);
  const basis = new THREE.Matrix4().makeBasis(right, dy, nrm).setPosition(P.clone().addScaledVector(nrm, 0.034));
  g.applyMatrix4(basis);
  // housing behind the panel, reaching into the wall
  const box = new THREE.Mesh(geo.roundedBox(W + 0.03, H + 0.03, 0.08, 0.008), shellMats().liningDark);
  box.applyMatrix4(basis.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.045)));
  box.castShadow = true; box.receiveShadow = true;
  const wrap = new THREE.Group();
  wrap.add(g, box);
  return wrap;
}
