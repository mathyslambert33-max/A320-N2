/**
 * Reinforced cockpit door in the rear bulkhead (centreline, opening 0.80 × 1.93 m), hinged on the captain's
 * side and opening forward into the flight deck (≈ 98°). Clicking the leaf or its handle toggles it; the swing is
 * animated and published as G:DOOR_CKPT (0 closed..1 open). From the flight deck the door can always be opened
 * (the electric strikes only lock it against the cabin side). Initial state: open (aircraft at the gate).
 * External writes of G:DOOR_CKPT (EFB, scenarios) are followed with the same animation.
 *
 * Behind the door: a simple forward entrance area (galley on the right, lavatory door on the left, cabin
 * partition aft), so the open door does not look into the void.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { DOOR, REAR_Z, DEG } from './geom';
import { MergeBag } from './surf';
import { shellMats } from './mats';
import { doorStep } from './logic';

export interface DoorParts {
  root: THREE.Group;
  update(dt: number): void;
  blockers: THREE.Object3D[];
}

const OPEN_DEG = 98;
const BULK_T = 0.08; // bulkhead thickness at the door frame

export function buildDoor(app: App): DoorParts {
  const M = shellMats();
  const K = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'shell:door';
  const sim = app.sim;

  // ---- frame: jamb reveals through the bulkhead thickness + trim around the opening (cockpit side)
  const fr = new MergeBag();
  const W = DOOR.x1 - DOOR.x0, H = DOOR.height;
  for (const x of [DOOR.x0, DOOR.x1]) {
    fr.at(geo.box(0.004, H, BULK_T), M.liningDark, x + (x < 0 ? -0.002 : 0.002), H / 2, REAR_Z + BULK_T / 2);
    fr.at(geo.roundedBox(0.055, H + 0.03, 0.022, 0.008), M.trim, x + (x < 0 ? -0.024 : 0.024), (H + 0.03) / 2, REAR_Z - 0.006);
  }
  fr.at(geo.box(W, 0.004, BULK_T), M.liningDark, 0, H + 0.002, REAR_Z + BULK_T / 2);
  fr.at(geo.roundedBox(W + 0.1, 0.055, 0.022, 0.008), M.trim, 0, H + 0.024, REAR_Z - 0.006);
  // threshold plate
  fr.at(geo.roundedBox(W, 0.008, BULK_T + 0.04, 0.003), M.rail, 0, 0.004, REAR_Z + BULK_T / 2);
  // door stop strip on the latch jamb (cabin side of the opening) and strike plates
  fr.at(geo.box(0.012, H - 0.04, 0.012), M.rubberBoot, DOOR.x1 - 0.006, H / 2, REAR_Z + 0.062);
  for (const y of [0.35, 1.0, 1.6]) fr.at(geo.roundedBox(0.02, 0.09, 0.03, 0.004), K.chrome, DOOR.x1 - 0.004, y, REAR_Z + 0.03);
  const frame = fr.build('shell:door_frame');
  root.add(frame);

  // ---- leaf (hinge at the captain-side jamb; cockpit face 5 mm behind the bulkhead face)
  const hinge = new THREE.Group();
  hinge.position.set(DOOR.x0 + 0.004, 0, REAR_Z + 0.005);
  root.add(hinge);
  const lf = new MergeBag();
  const LW = W - 0.01, LH = H - 0.015, T = DOOR.t;
  const cx = LW / 2 + 0.002;
  lf.at(geo.roundedBox(LW, LH, T, 0.006), M.doorLining, cx, LH / 2 + 0.006, T / 2);
  // cockpit-side details: inset border, kick plate, decompression grille, viewer, handle escutcheon, placard
  lf.at(geo.box(LW - 0.1, 0.004, 0.003), M.liningDark, cx, 1.86, -0.0005);
  lf.at(geo.box(LW - 0.1, 0.004, 0.003), M.liningDark, cx, 0.3, -0.0005);
  lf.at(geo.box(0.004, 1.56, 0.003), M.liningDark, 0.05 + 0.002, 1.08, -0.0005);
  lf.at(geo.box(0.004, 1.56, 0.003), M.liningDark, LW - 0.048, 1.08, -0.0005);
  lf.at(geo.box(LW - 0.02, 0.1, 0.004), M.trim, cx, 0.06, -0.001);
  lf.at(geo.box(0.46, 0.16, 0.003), M.grille, cx, 0.19, -0.0015);
  lf.at(geo.cylZ(0.012, 0.014, 0.008, 20), K.chrome, cx, 1.56, -0.007);
  lf.at(geo.cylZ(0.006, 0.006, 0.0085, 16), K.black, cx, 1.56, -0.007);
  lf.at(geo.box(0.16, 0.1, 0.002), M.placard, cx, 1.36, -0.0012);
  // latch bolt indicator window and manual deadbolt knob above the handle
  lf.at(geo.roundedBox(0.05, 0.05, 0.01, 0.006), K.bezel, LW - 0.08, 1.22, -0.005);
  lf.at(geo.cylZ(0.012, 0.012, 0.02, 16), K.knobGrey, LW - 0.08, 1.22, -0.03);
  // handle: escutcheon + lever (cockpit side) and the same on the cabin side
  lf.at(geo.roundedBox(0.05, 0.16, 0.012, 0.006), K.chrome, LW - 0.07, 1.02, -0.006);
  lf.at(geo.roundedBox(0.13, 0.024, 0.024, 0.01), K.chrome, LW - 0.115, 1.03, -0.035);
  lf.at(geo.cylZ(0.012, 0.012, 0.03, 16), K.chrome, LW - 0.07, 1.03, -0.03);
  lf.at(geo.roundedBox(0.05, 0.16, 0.012, 0.006), K.chrome, LW - 0.07, 1.02, T + 0.006);
  lf.at(geo.roundedBox(0.13, 0.024, 0.024, 0.01), K.chrome, LW - 0.115, 1.03, T + 0.035);
  // piano hinge
  lf.at(geo.cylZ(0.008, 0.008, LH, 12), K.darkMetal, -0.002, LH / 2 + 0.006, 0.0, -Math.PI / 2);
  const leaf = lf.build('shell:door_leaf', { dynamic: true });
  hinge.add(leaf);

  // ---- state & interaction
  sim.init('G:DOOR_CKPT', 1);
  let open = sim.get('G:DOOR_CKPT');
  let target = open;
  let written = open;
  const apply = () => { hinge.rotation.y = open * OPEN_DEG * DEG; };
  apply();
  app.kit.interactive(leaf, {
    id: 'DOOR_CKPT_LEAF',
    ref: hinge,
    cursor: 'push',
    onDown: () => {
      target = target > 0.5 ? 0 : 1;
      sim.emit('sfx', { kind: target ? 'door_open' : 'door_close', id: 'DOOR_CKPT_LEAF', x: 0.3, y: 1.0, z: REAR_Z });
    },
    describe: () => ({
      name: 'Cockpit door', fr: 'Porte du poste de pilotage — clic pour ouvrir / fermer', id: 'DOOR_CKPT_LEAF',
      state: open > 0.98 ? 'OPEN' : open < 0.02 ? 'CLOSED' : `${Math.round(open * 100)} %`,
    }),
  });

  // ---- forward entrance area (behind the door)
  root.add(buildVestibule(app));

  return {
    root,
    blockers: [frame],
    update(dt) {
      const ext = sim.get('G:DOOR_CKPT');
      if (Math.abs(ext - written) > 1e-6) target = ext > 0.5 ? 1 : ext; // written by someone else
      if (open !== target) {
        open = doorStep(open, target, dt);
        apply();
        if (open === 0 && target === 0) sim.emit('sfx', { kind: 'door_latch', id: 'DOOR_CKPT_LEAF', x: 0.3, y: 1.0, z: REAR_Z });
      }
      const w = Math.round(open * 1000) / 1000;
      if (w !== written) { written = w; sim.set('G:DOOR_CKPT', w); }
    },
  };
}

/** Forward entrance area seen through the open door: galley (right), lavatory (left), cabin partition. */
function buildVestibule(app: App): THREE.Group {
  const M = shellMats();
  const K = app.kit.mats;
  const b = new MergeBag();
  const z0 = REAR_Z + BULK_T, z1 = 3.35;
  const yC = 2.2;
  // floor, ceiling
  const fl = new THREE.PlaneGeometry(2.6, z1 - z0).rotateX(-Math.PI / 2);
  b.at(fl, M.carpet, 0, 0.0, (z0 + z1) / 2);
  const ce = new THREE.PlaneGeometry(2.6, z1 - z0).rotateX(Math.PI / 2);
  b.at(ce, M.cabinWall, 0, yC, (z0 + z1) / 2);
  // back face of the bulkhead (cabin side)
  const bk = new THREE.PlaneGeometry(2.6, yC);
  b.at(bk, M.cabinWall, 0, yC / 2, z0 + 0.001);
  // lavatory (left): wall with the lav door facing +x
  b.at(geo.box(0.04, yC, 1.2), M.cabinWall, -0.62, yC / 2, z0 + 0.6);
  b.at(geo.roundedBox(0.03, 1.9, 0.62, 0.01), M.cabinWall, -0.595, 0.97, z0 + 0.62);
  b.at(geo.roundedBox(0.02, 0.05, 0.12, 0.006), K.chrome, -0.575, 1.0, z0 + 0.4);
  b.at(geo.box(0.005, 0.05, 0.14), M.placard, -0.578, 1.62, z0 + 0.62);
  // galley (right): stainless cart bays + upper compartments
  b.at(geo.box(0.04, yC, 1.3), M.cabinWall, 0.62, yC / 2, z0 + 0.65);
  for (let i = 0; i < 3; i++) {
    b.at(geo.roundedBox(0.02, 1.0, 0.36, 0.01), M.galley, 0.6, 0.52, z0 + 0.2 + i * 0.4);
    b.at(geo.roundedBox(0.03, 0.03, 0.12, 0.008), K.darkMetal, 0.585, 0.95, z0 + 0.2 + i * 0.4);
    b.at(geo.roundedBox(0.02, 0.3, 0.36, 0.01), M.galley, 0.6, 1.62, z0 + 0.2 + i * 0.4);
  }
  b.at(geo.box(0.03, 0.02, 1.2), M.galley, 0.6, 1.05, z0 + 0.6);
  // cabin partition aft with a curtain
  b.at(geo.box(2.6, yC, 0.04), M.cabinWall, 0, yC / 2, z1);
  b.at(geo.box(0.9, 1.95, 0.02), M.seatFabric, 0, 0.99, z1 - 0.03);
  // side walls of the entrance area
  b.at(geo.box(0.04, yC, z1 - z0), M.cabinWall, -1.3, yC / 2, (z0 + z1) / 2);
  b.at(geo.box(0.04, yC, z1 - z0), M.cabinWall, 1.3, yC / 2, (z0 + z1) / 2);
  // ceiling light panel (emissive, the cabin lighting is on at the gate)
  const light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1, 0.95, 0.86), emissiveIntensity: 1.6, roughness: 0.6 });
  light.name = 'cabinLight';
  b.at(geo.box(0.9, 0.01, 1.2), light, 0, yC - 0.006, (z0 + z1) / 2);
  const g = b.build('shell:vestibule', { castShadow: false });
  return g;
}
