/**
 * Lateral consoles (anchors CONSOLE_CAPT / CONSOLE_FO): cabinet, painted top panel (READING LT knob),
 * crew oxygen mask stowage box (PRESS TO TEST AND RESET pbm OXY_MASK_TEST_*, flow blinker from
 * S:OXY_MASK_FLOW_*), hand microphone in its clip, cup holder; on the side wall above: document pocket,
 * audio jack panel, individual air outlet (gasper), ashtray.
 * Engraved panels are built per side (never mirrored, so the text stays readable).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { ANCHORS, placeAt } from '../layout';
import { DEG, W0 } from './geom';
import { MergeBag, loft, superellipse } from './surf';
import { shellMats } from './mats';

type Side = 'CAPT' | 'FO';

export interface ConsoleParts {
  root: THREE.Group;
  update(dt: number): void;
  blockers: THREE.Object3D[];
}

/** Matrix for a flat panel whose face normal is `n` and drawing-up is `up`, centred at `o`. */
function faceMatrix(o: THREE.Vector3, n: THREE.Vector3, up: THREE.Vector3): THREE.Matrix4 {
  const N = n.clone().normalize();
  const U = up.clone().addScaledVector(N, -up.dot(N)).normalize();
  const R = new THREE.Vector3().crossVectors(U, N);
  return new THREE.Matrix4().makeBasis(R, U, N).setPosition(o);
}

export function buildConsoles(app: App): ConsoleParts {
  const root = new THREE.Group();
  root.name = 'shell:consoles';
  const ups: Array<(dt: number) => void> = [];
  const blockers: THREE.Object3D[] = [];
  for (const side of ['CAPT', 'FO'] as const) {
    const c = buildConsole(app, side);
    root.add(c.root);
    ups.push(c.update);
    blockers.push(...c.blockers);
  }
  return { root, update: (dt) => { for (const u of ups) u(dt); }, blockers };
}

function buildConsole(app: App, side: Side): { root: THREE.Group; update(dt: number): void; blockers: THREE.Object3D[] } {
  const M = shellMats();
  const K = app.kit.mats;
  const s = side === 'CAPT' ? -1 : 1; // outboard sign (x)
  const root = new THREE.Group();
  root.name = `shell:console_${side}`;
  const bag = new MergeBag();

  // --- cabinet (inboard face at |x| 0.82, into the wall), top under the painted panel (y 0.648)
  const xIn = 0.82, xOut = 1.09, zF = -0.68, zA = 0.34, yTop = 0.648;
  bag.at(geo.roundedBox(xOut - xIn, yTop, zA - zF, 0.018, 3), M.lining, s * (xIn + xOut) / 2, yTop / 2, (zF + zA) / 2);
  // kick strip and a stowage net pocket on the inboard face (charts / documentation)
  bag.at(geo.box(0.004, 0.085, zA - zF - 0.04), M.liningDark, s * (xIn - 0.001), 0.05, (zF + zA) / 2);
  bag.at(geo.roundedBox(0.03, 0.26, 0.4, 0.01), M.liningDark, s * (xIn - 0.012), 0.34, 0.02);
  bag.at(geo.box(0.004, 0.2, 0.36), M.webbing, s * (xIn - 0.028), 0.33, 0.02);
  bag.at(geo.box(0.006, 0.016, 0.38), M.trim, s * (xIn - 0.029), 0.438, 0.02);
  // foot air outlet grille low on the inboard face, forward
  bag.at(geo.box(0.004, 0.05, 0.16), M.grille, s * (xIn - 0.002), 0.14, -0.5);

  // --- top panel (kit): engraved READING LT, mask box area
  const anchor = side === 'CAPT' ? ANCHORS.CONSOLE_CAPT : ANCHORS.CONSOLE_FO;
  const grp = new THREE.Group();
  grp.name = `CONSOLE_${side}`;
  const PH = 0.97, PC = 0.025; // panel height (along z) and centre offset (forward)
  const p = app.kit.panel({ name: `CONSOLE_${side}`, width: 0.25, height: PH, zone: 'main', thickness: 0.012, pxPerM: 2200, screws: [
    [-0.115, 0.47], [0.115, 0.47], [-0.115, -0.47], [0.115, -0.47], [-0.115, 0.1], [0.115, 0.1],
  ] });
  const lx = (outboard: number) => s * outboard; // local x from an "outboard" offset (anchor x = body x)
  // reading light knob (outboard, mid console)
  p.pot(`READING_LT_${side}`, lx(0.075), 0.03 - PC, { style: 'round', size: 0.0085, label: 'READING LT', scale: ['OFF', 'BRT'], labelRadius: 0.02 });
  // sidestick / tiller seats (engraved outlines only; the hardware is in controls.ts)
  p.rect(lx(-0.055), 0.095 - PC, 0.106, 0.106, { width: 0.0006, alpha: 0.35 });
  p.label(side === 'CAPT' ? 'CAPT' : 'F/O', lx(-0.055), 0.03 - PC, { size: 0.0026, alpha: 0.8 });
  // oxygen mask stowage area marking
  p.label('OXYGEN MASK', lx(0.035), -0.165 - PC, { size: 0.0028 });
  grp.add(p.finish());
  grp.children[0].position.set(0, PC, 0);
  placeAt(grp, anchor);
  root.add(grp);

  // --- oxygen mask stowage box
  const box = buildMaskBox(app, side);
  root.add(box.root);

  // --- hand microphone in its clip (aft inboard corner of the console)
  const mic = new MergeBag();
  const mz = 0.25, mx = s * 0.865;
  mic.at(geo.roundedBox(0.03, 0.006, 0.05, 0.002), K.darkMetal, mx, 0.664, mz);
  const micBody = loft([0, 0.02, 0.055, 0.075].map((t, i) => ({
    c: new THREE.Vector3(mx, 0.69, mz - 0.035 + t),
    x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
    pts: superellipse([0.019, 0.022, 0.022, 0.016][i], [0.014, 0.016, 0.016, 0.012][i], 2.6, 20),
  })));
  mic.add(micBody, M.gripBlack);
  mic.at(geo.roundedBox(0.012, 0.004, 0.02, 0.0015), K.knobGrey, mx + s * -0.02, 0.69, mz);
  mic.at(geo.cylZ(0.016, 0.016, 0.004, 20), M.grille, mx, 0.69, mz - 0.037, Math.PI, 0, 0);
  // coiled cord to the console
  const coil: THREE.Vector3[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const a = t * Math.PI * 2 * 14;
    coil.push(new THREE.Vector3(mx + Math.cos(a) * 0.006, 0.69 - t * 0.03 + Math.sin(a) * 0.006, mz + 0.045 + t * 0.06));
  }
  mic.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 240, 0.0018, 5, false), M.gripBlack);

  // --- cup holder (forward outboard corner)
  const cz = -0.53, cx = s * 1.0;
  mic.add(new THREE.LatheGeometry([
    new THREE.Vector2(0.036, 0.0), new THREE.Vector2(0.041, 0.0), new THREE.Vector2(0.042, 0.006), new THREE.Vector2(0.036, 0.007), new THREE.Vector2(0.034, -0.05),
  ].reverse(), 32).translate(cx, 0.66, cz), K.bezel);
  mic.at(geo.cylZ(0.034, 0.034, 0.002, 32), K.black, cx, 0.615, cz, -Math.PI / 2);

  root.add(mic.build(`shell:console_items_${side}`));

  // --- side wall items above the console
  const wall = new MergeBag();
  const wx = (y: number) => s * (W0(y) - 0.002);
  // document pocket (flat box with a lip) between the console top and the window sill, aft part
  const py = 0.84, pz = 0.13;
  wall.at(geo.roundedBox(0.035, 0.22, 0.34, 0.008), M.liningDark, wx(py) - s * 0.012, py, pz);
  wall.at(geo.roundedBox(0.012, 0.03, 0.34, 0.005), M.trim, wx(py) - s * 0.03, py + 0.1, pz);
  // audio jack panel (headset / boomset / mic) — engraved kit panel on the wall
  const jp = app.kit.panel({ name: `JACKS_${side}`, width: 0.13, height: 0.05, zone: 'main', thickness: 0.004, pxPerM: 6000, screws: [[-0.06, 0.02], [0.06, 0.02], [-0.06, -0.02], [0.06, -0.02]] });
  const jx = [-0.04, 0, 0.04];
  const jl = side === 'CAPT' ? ['BOOM', 'MASK', 'PHONE'] : ['PHONE', 'MASK', 'BOOM'];
  for (let i = 0; i < 3; i++) {
    jp.addStatic(geo.cylZ(0.0065, 0.0065, 0.004, 20), K.darkMetal, jx[i], -0.004, 0);
    jp.addStatic(geo.cylZ(0.003, 0.003, 0.0045, 16), K.black, jx[i], -0.004, 0);
    jp.label(jl[i], jx[i], 0.013, { size: 0.0026 });
  }
  const jg = jp.finish();
  const jy = 0.74, jz = 0.33;
  const jn = new THREE.Vector3(-s, 0, 0);
  jg.applyMatrix4(faceMatrix(new THREE.Vector3(wx(jy) - s * 0.001, jy, jz), jn, new THREE.Vector3(0, 1, 0)));
  root.add(jg);
  // individual air outlet (eyeball gasper) near the front of the side window, with its bezel
  const gy = 0.97, gz = -0.6;
  const gpos = new THREE.Vector3(wx(gy) - s * 0.004, gy, gz);
  const gq = new THREE.Matrix4().makeRotationY(s * -Math.PI / 2).setPosition(gpos);
  wall.add(new THREE.LatheGeometry([new THREE.Vector2(0.04, 0), new THREE.Vector2(0.041, 0.006), new THREE.Vector2(0.03, 0.012), new THREE.Vector2(0.026, 0.008)].reverse(), 32).rotateX(Math.PI / 2), K.bezel, gq);
  wall.add(new THREE.SphereGeometry(0.025, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0, 0.004), K.knobGrey, gq);
  wall.add(geo.cylZ(0.009, 0.009, 0.03, 16).clone().translate(0, 0, 0.0), K.black, gq);
  // ashtray (hinged lid box) on the wall above the console, forward
  const ay = 0.78, az = -0.42;
  wall.at(geo.roundedBox(0.03, 0.05, 0.08, 0.006), K.bezel, wx(ay) - s * 0.012, ay, az);
  wall.at(geo.roundedBox(0.006, 0.012, 0.05, 0.003), K.chrome, wx(ay) - s * 0.029, ay + 0.012, az);
  // headset on its hook on the post between the sliding and the fixed window
  {
    const hz = 0.105, hy = 1.16;
    const hx = s * (W0(hy) - 0.004);
    wall.at(geo.roundedBox(0.02, 0.012, 0.03, 0.004), K.darkMetal, hx - s * 0.01, hy, hz);
    wall.at(geo.roundedBox(0.012, 0.03, 0.012, 0.004), K.darkMetal, hx - s * 0.024, hy + 0.012, hz);
    // headband arc hanging from the hook, two ear cups, boom microphone
    const band: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * (i / 16);
      band.push(new THREE.Vector3(hx - s * (0.03 + 0.012 * Math.sin(a)), hy + 0.01 - 0.085 * (1 - Math.sin(a)) * 0 - 0.075 * (1 - Math.sin(a)), hz - 0.085 * Math.cos(a)));
    }
    wall.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(band), 32, 0.006, 8, false), M.gripBlack);
    for (const e of [-1, 1]) {
      const ec = new THREE.Vector3(hx - s * 0.035, hy - 0.08, hz + e * 0.085);
      wall.add(new THREE.CylinderGeometry(0.036, 0.036, 0.03, 24).rotateX(Math.PI / 2).translate(ec.x, ec.y, ec.z), M.gripBlack);
      wall.add(new THREE.CylinderGeometry(0.033, 0.033, 0.012, 24).rotateX(Math.PI / 2).translate(ec.x, ec.y, ec.z - e * 0.02), M.leather);
    }
    const boom: THREE.Vector3[] = [new THREE.Vector3(hx - s * 0.04, hy - 0.09, hz - 0.1), new THREE.Vector3(hx - s * 0.06, hy - 0.13, hz - 0.13), new THREE.Vector3(hx - s * 0.08, hy - 0.16, hz - 0.12)];
    wall.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(boom), 12, 0.003, 6, false), M.gripBlack);
    wall.add(new THREE.SphereGeometry(0.009, 12, 8).translate(boom[2].x, boom[2].y, boom[2].z), M.rubberBoot);
  }
  root.add(wall.build(`shell:wall_items_${side}`));

  const b = bag.build(`shell:console_cabinet_${side}`);
  root.add(b);
  return { root, update: box.update, blockers: [b, box.body] };
}

/* ------------------------------------------------------------------ */
/* Oxygen mask stowage box                                               */
/* ------------------------------------------------------------------ */

function buildMaskBox(app: App, side: Side): { root: THREE.Group; body: THREE.Object3D; update(dt: number): void } {
  const M = shellMats();
  const K = app.kit.mats;
  const s = side === 'CAPT' ? -1 : 1;
  const root = new THREE.Group();
  root.name = `shell:oxy_box_${side}`;
  const W = 0.16, D = 0.2, H = 0.058;
  const cx = s * 0.975, cz = 0.13, y0 = 0.66;
  const bag = new MergeBag();
  bag.at(geo.roundedBox(W, H, D, 0.008), K.paintDark, cx, y0 + H / 2 - 0.004, cz);
  // two flap doors on top with a centre split and red squeeze-release tabs (inboard edge)
  for (const dz of [-1, 1]) {
    bag.at(geo.roundedBox(W - 0.014, 0.006, D / 2 - 0.01, 0.004), M.liningDark, cx, y0 + H - 0.001, cz + dz * (D / 4 - 0.001));
  }
  bag.at(geo.roundedBox(0.012, 0.012, 0.05, 0.003), M.red, cx - s * (W / 2 - 0.004), y0 + H - 0.004, cz - 0.03);
  bag.at(geo.roundedBox(0.012, 0.012, 0.05, 0.003), M.red, cx - s * (W / 2 - 0.004), y0 + H - 0.004, cz + 0.03);
  // mask regulator visible through the gap (N/100% lever, emergency knob) — small hint
  bag.at(geo.roundedBox(0.03, 0.01, 0.02, 0.003), M.yellow, cx + s * 0.03, y0 + H + 0.002, cz);
  const body = bag.build(`shell:oxy_box_body_${side}`);
  root.add(body);
  // top placard "OXYGEN" and inboard face panel with the test pb and blinker
  const face = app.kit.panel({ name: `OXY_BOX_${side}`, width: 0.17, height: 0.044, zone: 'main', thickness: 0.003, pxPerM: 7000, material: 'paintDark', screws: false });
  face.pb(`OXY_MASK_TEST_${side}`, -0.045, -0.002, { w: 0.022, h: 0.012, noBezel: false, capMaterial: K.knobGrey });
  face.label(['PRESS TO TEST', 'AND RESET'], -0.045, 0.0145, { size: 0.0021 });
  face.label('OXY', 0.04, 0.0145, { size: 0.0024 });
  face.addStatic(geo.cylZ(0.0085, 0.0085, 0.0018, 24), K.bezel, 0.04, -0.003, 0);
  face.addStatic(geo.cylZ(0.0062, 0.0062, 0.0021, 24), K.black, 0.04, -0.003, 0);
  const fg = face.finish();
  // blinker: yellow cross shown while oxygen flows
  const cross = new THREE.Group();
  for (const r of [45, -45]) {
    const bar = new THREE.Mesh(geo.box(0.011, 0.0025, 0.0006), M.yellow);
    bar.rotation.z = r * DEG;
    cross.add(bar);
  }
  cross.position.set(0.04, -0.003, 0.0024);
  cross.visible = false;
  fg.add(cross);
  const n = new THREE.Vector3(-s, 0, 0);
  fg.applyMatrix4(faceMatrix(new THREE.Vector3(cx - s * (W / 2 + 0.0015), y0 + 0.028, cz), n, new THREE.Vector3(0, 1, 0)));
  root.add(fg);
  const sim = app.sim;
  const flowVar = `S:OXY_MASK_FLOW_${side}`;
  let last = -1;
  return {
    root,
    body,
    update() {
      const v = sim.get(flowVar) > 0.5 ? 1 : 0;
      if (v === last) return;
      last = v;
      cross.visible = v === 1;
    },
  };
}
