/**
 * Flight controls: sidesticks (2-axis drag with spring return, takeover pb + radio PTT trigger on the grip),
 * nose-wheel steering tillers (drag, spring return), rudder pedals with toe brakes (visual, driven by
 * C:RUDDER / C:BRAKE_L / C:BRAKE_R; drag a pedal sideways = rudder, press-hold its upper part = toe brake).
 * Visuals always follow the C: variables so other inputs (keyboard/gamepad in ui) can drive them.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Handle } from '../kit';
import { geo } from '../kit';
import { getControl } from '../../core/catalog';
import { DEG, PEDALS } from './geom';
import { MergeBag, loft, superellipse, type LoftSection } from './surf';
import { shellMats } from './mats';
import { springBack, stickAngles, pedalOffsets, clampv } from './logic';

type Side = 'CAPT' | 'FO';

export interface ControlsParts {
  root: THREE.Group;
  update(dt: number): void;
}

/** Positions (captain; F/O mirrored in x). */
export const STICK_POS = new THREE.Vector3(-0.885, 0.672, -0.245);
export const TILLER_POS = new THREE.Vector3(-0.99, 0.672, -0.375);

export function buildControls(app: App): ControlsParts {
  const root = new THREE.Group();
  root.name = 'shell:controls';
  const updaters: Array<(dt: number) => void> = [];
  for (const side of ['CAPT', 'FO'] as const) {
    const s = buildSidestick(app, side);
    root.add(s.obj);
    updaters.push(s.update);
    const t = buildTiller(app, side);
    root.add(t.obj);
    updaters.push(t.update);
  }
  const p = buildPedals(app);
  root.add(p.obj);
  updaters.push(p.update);
  return { root, update: (dt) => { for (const u of updaters) u(dt); } };
}

/* ------------------------------------------------------------------ */
/* Sidestick                                                             */
/* ------------------------------------------------------------------ */

/** Grip loft (local frame: pivot at the origin, +y up the grip, −z forward, +x = inboard for the captain). */
function gripGeometry(): THREE.BufferGeometry {
  // (height, half-width x, half-depth z, forward offset, inboard offset)
  const prof: Array<[number, number, number, number, number]> = [
    [0.0, 0.011, 0.011, 0, 0],
    [0.03, 0.012, 0.012, 0, 0],
    [0.045, 0.0165, 0.018, -0.001, 0],
    [0.06, 0.0195, 0.0225, -0.003, 0.001],
    [0.08, 0.0215, 0.026, -0.005, 0.002],
    [0.1, 0.0215, 0.0265, -0.006, 0.002],
    [0.118, 0.02, 0.0255, -0.007, 0.002],
    [0.132, 0.0185, 0.024, -0.008, 0.0015],
    [0.143, 0.016, 0.021, -0.008, 0.001],
    [0.151, 0.012, 0.016, -0.007, 0.0],
    [0.156, 0.006, 0.009, -0.006, 0],
    [0.158, 0.0015, 0.002, -0.006, 0],
  ];
  const secs: LoftSection[] = prof.map(([h, a, b, fz, ix]) => ({
    c: new THREE.Vector3(ix, h, fz),
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 0, 1),
    pts: superellipse(a, b, h > 0.04 && h < 0.15 ? 2.35 : 2, 28).map(([u, v]): [number, number] => {
      // palm swell toward the back-outboard, finger flats at the front
      const back = v > 0 ? 1 + 0.08 * (v / b) : 1 - 0.05 * (-v / b);
      return [u * (u < 0 ? 1.04 : 1), v * back];
    }),
  }));
  return loft(secs, { capStart: true, capEnd: false });
}

function bootGeometry(): THREE.BufferGeometry {
  // corrugated rubber gaiter from the bezel (r 34 mm) to the shaft (r 12 mm)
  const pts: THREE.Vector2[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const h = t * 0.04;
    const r = 0.034 - t * 0.021 + 0.0018 * Math.sin(t * Math.PI * 7) * (1 - t * 0.5);
    pts.push(new THREE.Vector2(r, h));
  }
  const g = new THREE.LatheGeometry(pts, 32);
  return g;
}

function buildSidestick(app: App, side: Side): { obj: THREE.Object3D; update(dt: number): void } {
  const M = shellMats();
  const K = app.kit.mats;
  const k = side === 'CAPT' ? 1 : -1; // inboard = +x for the captain
  const obj = new THREE.Group();
  obj.name = `SIDESTICK_${side}`;
  obj.position.set(STICK_POS.x * (side === 'CAPT' ? 1 : -1), STICK_POS.y, STICK_POS.z);
  // static: bezel plate, boot
  const st = new MergeBag();
  st.at(geo.roundedBox(0.098, 0.006, 0.098, 0.004), K.bezel, 0, -0.009, 0);
  st.at(geo.roundedBox(0.084, 0.004, 0.084, 0.012), M.rubberBoot, 0, -0.005, 0);
  for (const [sx, sz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) st.at(geo.dzus(), K.darkMetal, sx, -0.006, sz, -Math.PI / 2);
  obj.add(st.build(`SIDESTICK_${side}:base`));
  // moving part: gimbal just below the bezel
  const gimbal = new THREE.Group();
  gimbal.position.y = -0.01;
  obj.add(gimbal);
  const bootMesh = new THREE.Mesh(bootGeometry(), M.rubberBoot);
  bootMesh.castShadow = true;
  bootMesh.position.y = 0.003;
  obj.add(bootMesh);
  const grip = new THREE.Group();
  grip.position.y = 0.02;
  // slight forward tilt and outboard cant of the grip at rest
  grip.rotation.set(-6 * DEG, 0, -k * 4 * DEG);
  gimbal.add(grip);
  const gm = new THREE.Mesh(gripGeometry(), M.gripBlack);
  gm.castShadow = true;
  if (side === 'FO') gm.scale.x = -1;
  grip.add(gm);
  // takeover pb (red, thumb, upper inboard side), PTT trigger (front, index finger)
  const tk = new THREE.Group();
  tk.position.set(k * 0.015, 0.138, -0.012);
  tk.rotation.set(-15 * DEG, 0, -k * 55 * DEG);
  const tkBtn = new THREE.Mesh(geo.latheZ('shell-tkpb', [[0, 0], [0.0072, 0], [0.0072, 0.003], [0.006, 0.0045], [0, 0.005]], 20), M.red);
  tkBtn.rotation.x = -Math.PI / 2;
  tkBtn.castShadow = true;
  const tkRing = new THREE.Mesh(geo.latheZ('shell-tkring', [[0.0068, 0], [0.0088, 0], [0.0088, 0.0015], [0.0068, 0.0015]], 20), M.gripBlack);
  tkRing.rotation.x = -Math.PI / 2;
  tk.add(tkRing, tkBtn);
  grip.add(tk);
  const ptt = new THREE.Group();
  ptt.position.set(0, 0.112, -0.031);
  const pttMesh = new THREE.Mesh(geo.roundedBox(0.014, 0.024, 0.01, 0.003), K.knobGrey);
  pttMesh.castShadow = true;
  ptt.add(pttMesh);
  grip.add(ptt);

  const X = `C:SIDESTICK_${side}_X`, Y = `C:SIDESTICK_${side}_Y`;
  const sim = app.sim;
  let held = false;
  let returning = false;
  const gain = 0.0065;
  const def = getControl(`SIDESTICK_${side}_X`);
  const handle: Handle = {
    id: `SIDESTICK_${side}`,
    ref: obj,
    cursor: 'drag',
    onDown: () => { held = true; returning = false; },
    onDrag: (dx, dy) => {
      if (!held) return;
      sim.set(X, clampv(sim.get(X) + dx * gain, -1, 1));
      sim.set(Y, clampv(sim.get(Y) + dy * gain, -1, 1));
    },
    onUp: () => { held = false; returning = true; },
    describe: () => ({
      name: 'Sidestick', fr: 'Mini-manche — glisser pour braquer (retour ressort)', id: `SIDESTICK_${side}`,
      state: `roll ${(sim.get(X) * 100).toFixed(0)} % · pitch ${(sim.get(Y) * 100).toFixed(0)} %`,
    }),
  };
  void def;
  app.kit.interactive(gm, handle);
  // buttons
  const btn = (id: string, o: THREE.Object3D, move: THREE.Object3D, axis: THREE.Vector3) => {
    const d = getControl(id);
    let down = false;
    const home = move.position.clone();
    app.kit.interactive(o, {
      id, ref: o, cursor: 'push',
      onDown: () => { down = true; app.kit.press(id, o); },
      onUp: () => { if (down) { down = false; app.kit.release(id); } },
      describe: () => (d ? app.kit.describe(d) : { name: id, id }),
    });
    app.kit.bindVisual(id, (v) => { move.position.copy(home).addScaledVector(axis, v > 0.5 ? 0.0022 : 0); });
  };
  btn(`SIDESTICK_${side}_TAKEOVER`, tk, tkBtn, new THREE.Vector3(0, -1, 0));
  btn(`SIDESTICK_${side}_PTT`, ptt, pttMesh, new THREE.Vector3(0, 0, 1));

  let lx = NaN, ly = NaN;
  return {
    obj,
    update(dt) {
      if (returning && !held) {
        const nx = springBack(sim.get(X), dt), ny = springBack(sim.get(Y), dt);
        sim.set(X, nx); sim.set(Y, ny);
        if (nx === 0 && ny === 0) returning = false;
      }
      const x = sim.get(X), y = sim.get(Y);
      if (x === lx && y === ly) return;
      lx = x; ly = y;
      const a = stickAngles(x, y);
      gimbal.rotation.set(a.pitch, 0, -a.roll, 'ZXY');
    },
  };
}

/* ------------------------------------------------------------------ */
/* Tiller                                                                */
/* ------------------------------------------------------------------ */

function buildTiller(app: App, side: Side): { obj: THREE.Object3D; update(dt: number): void } {
  const M = shellMats();
  const K = app.kit.mats;
  const obj = new THREE.Group();
  obj.name = `TILLER_${side}`;
  obj.position.set(TILLER_POS.x * (side === 'CAPT' ? 1 : -1), TILLER_POS.y, TILLER_POS.z);
  // axis tilted 8° toward the pilot (inboard-aft)
  obj.rotation.set(8 * DEG, 0, (side === 'CAPT' ? -1 : 1) * 6 * DEG);
  const st = new MergeBag();
  st.at(geo.cylZ(0.05, 0.052, 0.008, 40), K.bezel, 0, -0.008, 0, -Math.PI / 2);
  st.at(geo.cylZ(0.02, 0.024, 0.02, 24), M.seatMetal, 0, 0, 0, -Math.PI / 2);
  obj.add(st.build(`TILLER_${side}:base`));
  const wheel = new THREE.Group();
  wheel.position.y = 0.026;
  obj.add(wheel);
  const wb = new MergeBag();
  // dished disc + thick rim + hub cap
  wb.add(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.012), new THREE.Vector2(0.018, 0.012), new THREE.Vector2(0.024, 0.006), new THREE.Vector2(0.05, 0.004),
    new THREE.Vector2(0.056, 0.006), new THREE.Vector2(0.062, 0.012), new THREE.Vector2(0.064, 0.018), new THREE.Vector2(0.061, 0.023),
    new THREE.Vector2(0.056, 0.021), new THREE.Vector2(0.054, 0.012), new THREE.Vector2(0.05, 0.0), new THREE.Vector2(0.024, -0.004),
    new THREE.Vector2(0.018, -0.006), new THREE.Vector2(0, -0.006),
  ].reverse(), 48), M.gripBlack);
  // grip knob on the rim (palm)
  wb.at(geo.cylZ(0.011, 0.013, 0.036, 20), M.gripBlack, 0.042, 0.012, 0, -Math.PI / 2);
  wb.at(new THREE.SphereGeometry(0.0115, 16, 10), M.gripBlack, 0.042, 0.048, 0);
  // white index line on the hub
  wb.at(geo.box(0.022, 0.001, 0.003), M.white, 0.012, 0.0125, 0);
  const wm = wb.build(`TILLER_${side}:wheel`, { dynamic: true });
  wheel.add(wm);
  const id = `TILLER_${side}`;
  const V = `C:${id}`;
  const sim = app.sim;
  let held = false, returning = false;
  const def = getControl(id);
  app.kit.interactive(wm, {
    id, ref: obj, cursor: 'drag',
    onDown: () => { held = true; returning = false; },
    onDrag: (dx) => { if (held) sim.set(V, clampv(sim.get(V) + dx * 0.006, -1, 1)); },
    onUp: () => { held = false; returning = true; },
    describe: () => ({ name: 'Nose wheel steering tiller', fr: def?.fr ? `${def.fr} — glisser (retour ressort)` : 'Volant de direction', id, state: `${Math.round(sim.get(V) * 75)}°` }),
  });
  let last = NaN;
  return {
    obj,
    update(dt) {
      if (returning && !held) { const n = springBack(sim.get(V), dt, 0.12); sim.set(V, n); if (n === 0) returning = false; }
      const v = sim.get(V);
      if (v === last) return;
      last = v;
      wheel.rotation.y = -clampv(v, -1, 1) * 75 * DEG;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Rudder pedals                                                         */
/* ------------------------------------------------------------------ */

function buildPedals(app: App): { obj: THREE.Object3D; update(dt: number): void } {
  const M = shellMats();
  const K = app.kit.mats;
  const obj = new THREE.Group();
  obj.name = 'shell:pedals';
  const sim = app.sim;
  // pedal plate 90 x 250 mm; local: x lateral, y along the plate (up), z normal (toward the pilot)
  const plateGeo = geo.roundedBox(0.09, 0.25, 0.012, 0.01).clone().translate(0, 0.125, 0);
  const ribBag = new MergeBag();
  for (let i = 0; i < 7; i++) ribBag.at(geo.box(0.07, 0.006, 0.004), M.rubberBoot, 0, 0.05 + i * 0.028, 0.007);
  const ribGeo = (ribBag.build('ribs').children[0] as THREE.Mesh).geometry;
  const pedals: Array<{ arm: THREE.Group; plate: THREE.Group; left: boolean }> = [];
  const floor = new MergeBag();
  let rudderReturning = false;
  for (const px of [PEDALS.capt.x, -PEDALS.capt.x]) {
    // floor well plate under each pedal pair, with the slots of the pedal arms
    floor.at(geo.roundedBox(0.5, 0.006, 0.36, 0.01), M.floorPlate, px, 0.003, PEDALS.capt.z - 0.02);
    for (const lr of [-1, 1]) {
      const x = px + (lr * PEDALS.spacing) / 2;
      floor.at(geo.box(0.05, 0.004, 0.24), K.black, x, 0.0065, PEDALS.capt.z - 0.02);
      const arm = new THREE.Group();
      arm.position.set(x, 0, PEDALS.capt.z);
      obj.add(arm);
      const post = new THREE.Mesh(geo.roundedBox(0.03, 0.14, 0.03, 0.008), M.seatMetal);
      post.position.set(0, 0.06, 0);
      post.castShadow = true;
      arm.add(post);
      const plate = new THREE.Group();
      plate.position.set(0, 0.095, 0.02);
      arm.add(plate);
      const tilt = new THREE.Group();
      tilt.rotation.x = -28 * DEG; // top of the plate leaning forward (≈ 62° from the floor)
      plate.add(tilt);
      const pm = new THREE.Mesh(plateGeo, M.seatMetal);
      pm.castShadow = true;
      const rm = new THREE.Mesh(ribGeo, M.rubberBoot);
      const heel = new THREE.Mesh(geo.roundedBox(0.09, 0.02, 0.03, 0.006), M.seatMetal);
      heel.position.set(0, 0.0, 0.02);
      tilt.add(pm, rm, heel);
      pedals.push({ arm, plate, left: lr < 0 });
      // interaction: drag sideways = rudder (spring return); press & hold the upper part = toe brake
      const brakeId = lr < 0 ? 'BRAKE_L' : 'BRAKE_R';
      let mode: 'none' | 'rudder' | 'brake' = 'none';
      const handle: Handle = {
        id: `PEDAL_${lr < 0 ? 'L' : 'R'}_${px < 0 ? 'CAPT' : 'FO'}`,
        ref: tilt,
        cursor: 'drag',
        onDown: (e) => {
          rudderReturning = false;
          mode = e.local.y > 0.13 ? 'brake' : 'rudder';
          if (mode === 'brake') sim.set(`C:${brakeId}`, 1);
        },
        onDrag: (dx) => { if (mode === 'rudder') sim.set('C:RUDDER', clampv(sim.get('C:RUDDER') + dx * 0.006, -1, 1)); },
        onUp: () => {
          if (mode === 'brake') sim.set(`C:${brakeId}`, 0);
          if (mode === 'rudder') rudderReturning = true;
          mode = 'none';
        },
        describe: () => ({
          name: `Rudder pedal (${lr < 0 ? 'left' : 'right'})`, fr: 'Palonnier — glisser = gouverne de direction, maintenir le haut = frein', id: brakeId,
          state: `rudder ${Math.round(sim.get('C:RUDDER') * 100)} % · brake ${Math.round(sim.get(`C:${brakeId}`) * 100)} %`,
        }),
      };
      app.kit.interactive(tilt, handle);
    }
  }
  obj.add(floor.build('shell:pedal_wells', { castShadow: false }));
  let lr = NaN, lb = NaN, lbr = NaN;
  return {
    obj,
    update(dt) {
      if (rudderReturning) {
        const n = springBack(sim.get('C:RUDDER'), dt, 0.12);
        sim.set('C:RUDDER', n);
        if (n === 0) rudderReturning = false;
      }
      const r = sim.get('C:RUDDER'), bl = sim.get('C:BRAKE_L'), br = sim.get('C:BRAKE_R');
      if (r === lr && bl === lb && br === lbr) return;
      lr = r; lb = bl; lbr = br;
      const off = pedalOffsets(r, PEDALS.travel);
      for (const p of pedals) {
        p.arm.position.z = PEDALS.capt.z + (p.left ? off.left : off.right);
        p.plate.rotation.x = -clampv(p.left ? bl : br, 0, 1) * 17 * DEG;
      }
    },
  };
}
