/**
 * Speed brake lever (RET … ½ … FULL, pull up in RET = ground spoilers ARM), flaps lever (0 / 1 / 2 / 3 / FULL, lifted
 * out of each detent, gates at 1 and 3) with their plates, and the PARKING BRK handle (pull & turn).
 * Plate coordinates in mm (origin = plate centre, +y forward); levers pivot under the plate.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Handle } from '../kit';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, m, pedMats, DEG, canvasTexture, extrudeX, roundedSlab } from './lib';
import { flapsGate, spdBrkCanArm, spdBrkDrag } from './logic/levers';

/** Lever pivot depth under the plate face and arm length to the handle (m). */
const PIV_Z = -0.12;
const ARM = 0.19;

/** Slot with brush seals and a dark bottom. */
function slot(pl: Plate, x: number, y0: number, y1: number, w = 11): void {
  const M = materials();
  const PM = pedMats();
  const len = y1 - y0, cy = (y0 + y1) / 2;
  pl.addStatic(geo.rectRing(m(w + 3.4), m(len + 3.4), m(w), m(len), 0.0012, 0.003), M.bezel, x, cy, 0);
  pl.addStatic(geo.box(m(w), m(len), 0.0006), PM.cavity, x, cy, -0.0035);
  for (const s of [-1, 1]) pl.addStatic(geo.box(m(w / 2 - 0.6), m(len), 0.0008), PM.brush, x + s * (w / 4 + 0.3), cy, -0.0006);
}

/** Angle (deg, + forward) of a lever whose handle sits over plate y (mm) at the plate surface radius. */
const angleForY = (yRel: number) => Math.asin(Math.max(-1, Math.min(1, m(yRel) / -PIV_Z))) / DEG;

/* ------------------------------------------------------------------ */

export function buildSpeedBrake(app: App): THREE.Group {
  const kit = app.kit;
  const M = materials();
  const PM = pedMats();
  const pl = new Plate(app, 'PED_SPDBRK', 146, 88.9);
  const sx = 42.5, yRet = 19.5, yFull = -26;
  pl.label(['SPEED', 'BRAKE'], -20, -2, 3.0);
  slot(pl, sx, yFull - 7, yRet + 9, 10.5);
  // scale: RET, 1/2, FULL both sides
  const ys = (v: number) => yRet + (yFull - yRet) * v;
  for (const side of [-1, 1]) {
    const lx = sx + side * 13;
    pl.line([[sx + side * 7.5, ys(0)], [sx + side * 7.5, ys(1)]], 0.5);
    for (const v of [0, 0.25, 0.5, 0.75, 1]) pl.line([[sx + side * 7.5, ys(v)], [sx + side * (v % 0.5 === 0 ? 10.5 : 9.2), ys(v)]], 0.5);
    pl.label('RET', lx + side * 1.5, ys(0), 2.1);
    pl.label('1/2', lx, ys(0.5), 2.1);
    pl.label('FULL', lx + side * 2, ys(1), 2.1);
    // "pull up to arm" arrows
    pl.line([[sx + side * 10, ys(0) + 3], [sx + side * 10, 33.5]], 0.5);
    pl.arrowHead(sx + side * 10, 35.5, 0, 2);
  }
  // GND SPLRS ARMED box
  pl.rect(sx, 39.2, 40, 5.4, 0.5);
  pl.label('GND SPLRS ARMED', sx, 39.2, 1.9);
  // lever
  const pivot = new THREE.Group();
  pl.add(pivot, sx, 0, PIV_Z / 0.001);
  const lift = new THREE.Group();
  lift.name = 'SPDBRK_ARM'; // pulled up = ground spoilers armed
  pivot.add(lift);
  const arm = new THREE.Mesh(extrudeX([[-0.005, 0], [0.005, 0], [0.004, ARM - 0.012], [-0.004, ARM - 0.012]], -0.0032, 0.0032, 0.0006), PM.leverArm);
  lift.add(arm);
  const handle = new THREE.Group();
  handle.name = 'SPDBRK_LEVER';
  handle.position.z = ARM;
  lift.add(handle);
  // handle: rounded black paddle, concave top
  const hb = new THREE.Mesh(roundedSlab(0.026, 0.03, 0.007, -0.009, 0.007, 0.0022), PM.gripBlack);
  const lip = new THREE.Mesh(geo.roundedBox(0.028, 0.006, 0.006, 0.002), PM.gripBlack);
  lip.position.set(0, 0.014, 0.005);
  handle.add(hb, lip);
  hb.castShadow = lip.castShadow = arm.castShadow = true;
  const LID = 'SPDBRK_LEVER', AID = 'SPDBRK_ARM';
  const ldef = kit.def(LID), adef = kit.def(AID);
  const angOf = (v: number) => angleForY(ys(v) - 0) ;
  let shown = kit.sim.get(`C:${LID}`);
  let up = kit.sim.get(`C:${AID}`) > 0.5 ? 1 : 0;
  const apply = () => { pivot.rotation.x = -angOf(shown) * DEG; lift.position.z = up * 0.009; };
  apply();
  kit.addInstance({
    id: LID,
    sync: (sim, dt) => {
      const v = sim.get(`C:${LID}`);
      shown += (v - shown) * Math.min(1, dt * 20);
      const ut = sim.get(`C:${AID}`) > 0.5 ? 1 : 0;
      up += (ut - up) * Math.min(1, dt * 14);
      apply();
    },
  });
  let raw = 0, moved = 0, pullAcc = 0;
  const setLever = (v: number) => {
    const cur = kit.sim.get(`C:${LID}`);
    if (v === cur) return;
    if (v > 0.001 && kit.sim.get(`C:${AID}`) > 0.5) kit.setControl(AID, 0, handle, null); // lever pushed down out of RET: disarmed
    kit.sim.set(`C:${LID}`, v);
    kit.sim.emit(`${LID}:change`, { value: v, old: cur });
    if ((cur < 0.5 && v >= 0.5) || (cur > 0.5 && v <= 0.5) || v === 0 || v === 1) kit.sfx('detent', LID, handle);
  };
  const setArm = (a: number) => {
    if (a && !spdBrkCanArm(kit.sim.get(`C:${LID}`))) return;
    if (Math.round(kit.sim.get(`C:${AID}`)) !== a) kit.setControl(AID, a, handle, 'pull');
  };
  const h: Handle = {
    id: LID, ref: pivot, cursor: 'drag',
    onDown: () => { raw = kit.sim.get(`C:${LID}`); moved = 0; pullAcc = 0; },
    onDrag: (_dx, dy) => {
      moved += Math.abs(dy);
      const cur = kit.sim.get(`C:${LID}`);
      // at RET, moving the mouse up (forward) pulls the lever up: ARM
      if (cur <= 0.001 && dy < 0) { pullAcc -= dy; if (pullAcc > 18) setArm(1); return; }
      pullAcc = 0;
      raw = Math.max(-0.05, Math.min(1.05, raw + dy / 190));
      setLever(spdBrkDrag(raw));
    },
    onUp: (e) => {
      if (moved >= 3) return;
      const cur = kit.sim.get(`C:${LID}`);
      if (e.button === 2) setLever(cur < 0.25 ? 0.5 : 1);
      else if (cur <= 0.001) setArm(kit.sim.get(`C:${AID}`) > 0.5 ? 0 : 1);
      else setLever(cur > 0.5 ? 0.5 : 0);
    },
    onWheel: (s) => {
      const cur = kit.sim.get(`C:${LID}`);
      if (s > 0) { if (cur <= 0.001) setArm(1); else setLever(Math.max(0, Math.ceil(cur * 4 - 1.001) / 4)); }
      else { if (kit.sim.get(`C:${AID}`) > 0.5) setArm(0); else setLever(Math.min(1, Math.floor(cur * 4 + 1.001) / 4)); }
    },
    describe: () => {
      const v = kit.sim.get(`C:${LID}`);
      const armed = kit.sim.get(`C:${AID}`) > 0.5;
      return {
        name: `${ldef.name} / ${adef.name}`, id: LID,
        fr: 'Aérofreins — glisser ; en RET, tirer vers le haut (glisser vers l’avant / clic) = spoilers sol armés',
        state: `${v <= 0.001 ? 'RET' : v >= 0.999 ? 'FULL' : Math.abs(v - 0.5) < 0.01 ? '1/2' : `${Math.round(v * 100)} %`}${armed ? ' · ARMED' : ''}`,
      };
    },
  };
  kit.interactive(lift, h);
  void M;
  return pl.finish();
}

/* ------------------------------------------------------------------ */

export function buildFlaps(app: App): THREE.Group {
  const kit = app.kit;
  const PM = pedMats();
  const pl = new Plate(app, 'PED_FLAPS', 146, 88.9);
  const sx = -36.5;
  const ys = [26.5, 13, -0.5, -14, -27.5];
  pl.label('FLAPS', 22, 0, 3.2);
  slot(pl, sx, ys[4] - 7, ys[0] + 7, 11);
  const names = ['0', '1', '2', '3', 'FULL'];
  for (const side of [-1, 1]) {
    pl.line([[sx + side * 8, ys[0]], [sx + side * 8, ys[4]]], 0.5);
    names.forEach((t, i) => {
      pl.line([[sx + side * 8, ys[i]], [sx + side * 10.5, ys[i]]], 0.5);
      pl.label(t, sx + side * (t === 'FULL' ? 16 : 13.5), ys[i], 2.2);
    });
  }
  // detent gate plate (notched) beside the slot
  const pivot = new THREE.Group();
  pivot.position.set(m(sx), 0, PIV_Z);
  pl.p.group.add(pivot);
  const lift = new THREE.Group();
  pivot.add(lift);
  const arm = new THREE.Mesh(extrudeX([[-0.0055, 0], [0.0055, 0], [0.0045, ARM - 0.014], [-0.0045, ARM - 0.014]], -0.0035, 0.0035, 0.0006), PM.leverArm);
  lift.add(arm);
  const handle = new THREE.Group();
  handle.name = 'FLAPS_LEVER';
  handle.position.z = ARM;
  lift.add(handle);
  // handle: wide rounded black block (≈ 46 × 34 mm seen from above) on a neck; the pilot lifts it out of each detent
  const hb = new THREE.Mesh(geo.roundedBox(0.046, 0.034, 0.02, 0.0065), PM.gripBlack);
  hb.position.z = 0.001;
  const neck = new THREE.Mesh(geo.roundedBox(0.014, 0.017, 0.016, 0.004), PM.gripBlack);
  neck.position.z = -0.014;
  handle.add(hb, neck);
  hb.castShadow = neck.castShadow = arm.castShadow = true;
  const id = 'FLAPS_LEVER';
  const def = kit.def(id);
  const angOf = (v: number) => {
    const i = Math.max(0, Math.min(4, v));
    const k = Math.floor(Math.min(3.999, i));
    const y = ys[k] + (ys[k + 1] - ys[k]) * (i - k);
    return angleForY(y);
  };
  let shown = kit.sim.get(`C:${id}`);
  let up = 0;
  let held = false;
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const v = sim.get(`C:${id}`);
      const moving = Math.abs(v - shown) > 0.01;
      const ut = moving || held ? 1 : 0;
      up += (ut - up) * Math.min(1, dt * 16);
      if (up > 0.6 || !moving) shown += (v - shown) * Math.min(1, dt * 10);
      pivot.rotation.x = -angOf(shown) * DEG;
      lift.position.z = up * 0.006;
    },
  });
  let start = 0, raw = 0, moved = 0;
  const set = (v: number) => {
    const cur = kit.sim.get(`C:${id}`);
    if (v === cur) return;
    kit.sim.set(`C:${id}`, v);
    kit.sim.emit(`${id}:change`, { value: v, old: cur });
    kit.sfx('detent', id, handle);
  };
  const h: Handle = {
    id, ref: pivot, cursor: 'drag',
    onDown: () => { held = true; start = Math.round(kit.sim.get(`C:${id}`)); raw = start; moved = 0; },
    onDrag: (_dx, dy) => {
      moved += Math.abs(dy);
      raw = Math.max(-0.4, Math.min(4.4, raw + dy / 45));
      set(flapsGate(start, Math.round(raw)));
    },
    onUp: (e) => {
      held = false;
      if (moved >= 3) return;
      const cur = Math.round(kit.sim.get(`C:${id}`));
      set(Math.max(0, Math.min(4, cur + (e.button === 2 ? -1 : 1))));
    },
    onWheel: (s) => { const cur = Math.round(kit.sim.get(`C:${id}`)); set(Math.max(0, Math.min(4, cur + (s > 0 ? -1 : 1)))); },
    describe: () => ({ ...kit.describe(def), fr: 'Levier volets — glisser (crans 1 et 3 : relâcher puis reprendre), clic G = cran suivant, clic D = précédent' }),
  };
  kit.interactive(lift, h);
  return pl.finish();
}

/* ------------------------------------------------------------------ */

/** PARKING BRK handle at plate position (hx, hy): OFF = pointer forward, ON = turned 90° clockwise. */
export function addParkBrakeHandle(app: App, plate: THREE.Group, hx: number, hy: number): void {
  const kit = app.kit;
  const PM = pedMats();
  const M = materials();
  const id = 'PARK_BRK';
  const def = kit.def(id);
  const root = new THREE.Group();
  root.name = id;
  root.position.set(m(hx), m(hy), 0);
  plate.add(root);
  const lift = new THREE.Group();
  root.add(lift);
  const rot = new THREE.Group();
  lift.add(rot);
  const shaft = new THREE.Mesh(geo.cylZ(0.0065, 0.007, 0.012, 24), M.darkMetal);
  // pointer: light metal spear (forward when OFF)
  const spear = new THREE.Mesh(extrudeZSpear(), M.alu);
  spear.position.z = 0.0055;
  // T bar with PARK BRK printed on top
  const tex = canvasTexture(256, 64, (c) => {
    c.fillStyle = '#0d0e0f';
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = '#f2efe8';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '700 44px "Barlow Semi Condensed"';
    c.fillText('PARK BRK', 128, 34);
  });
  const bar = new THREE.Mesh(roundedSlab(0.052, 0.0135, 0.0045, 0.012, 0.024, 0.002), PM.gripBlack);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(0.047, 0.0118), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 }));
  top.position.z = 0.02405;
  rot.add(shaft, spear, bar, top);
  for (const o of [shaft, spear, bar]) o.castShadow = true;
  const angOf = (v: number) => (v > 0.5 ? -90 : 0);
  let ang = angOf(kit.sim.get(`C:${id}`));
  let up = 0, held = false;
  rot.rotation.z = ang * DEG;
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const target = angOf(sim.get(`C:${id}`));
      const moving = Math.abs(target - ang) > 0.5;
      const ut = moving || held ? 1 : 0;
      up += Math.sign(ut - up) * Math.min(Math.abs(ut - up), dt * 8);
      if (up > 0.85 || !moving) ang += Math.sign(target - ang) * Math.min(Math.abs(target - ang), dt * 300);
      rot.rotation.z = ang * DEG;
      lift.position.z = up * 0.009;
    },
  });
  const setV = (v: number) => { if (Math.round(kit.sim.get(`C:${id}`)) !== v) kit.setControl(id, v, root, 'sw'); };
  const h: Handle = {
    id, ref: root, cursor: 'toggle',
    onDown: () => { held = true; },
    onUp: (e) => { held = false; setV(e.button === 2 ? 0 : Math.round(kit.sim.get(`C:${id}`)) ? 0 : 1); },
    onWheel: (s) => setV(s > 0 ? 1 : 0),
    describe: () => ({ ...kit.describe(def), state: `${kit.stateText(def)} · clic = tirer et tourner` }),
  };
  kit.interactive(rot, h);
}

/** Flat spear-shaped pointer (tip toward +y), 2 mm thick. */
function extrudeZSpear(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.0055, -0.004);
  s.lineTo(0.0055, -0.004);
  s.lineTo(0.0035, 0.012);
  s.lineTo(0, 0.022);
  s.lineTo(-0.0035, 0.012);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 1 });
  return g;
}
