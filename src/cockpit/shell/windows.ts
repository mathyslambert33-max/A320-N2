/**
 * Glass panes (windshields, fixed rear windows, sliding windows), sliding-window sash + handle (catalog levers
 * WINDOW_CAPT / WINDOW_FO: 0 closed..1 open; the sash first moves inward to unlatch, then slides aft),
 * exterior windshield wipers (S:WIPER_CAPT_POS / S:WIPER_FO_POS), eye-position indicator on the centre post,
 * sun visors stowed above the side windows.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { WINDOWS, WS, WS_NORMAL, WS_UP, SLIDE_TRAVEL, SLIDE_UNLATCH, zWs, DEG, clamp, planAt, Y_WALL_TOP } from './geom';
import { windowPatch, windowRing, wallMap, LIP, ceilMap } from './structure';
import { paramSurface, roundedOutline, ringStrip, surfNormal, mirrorX, MergeBag, loft, superellipse } from './surf';
import { toParam } from './structure';
import { shellMats } from './mats';
import { geo } from '../kit';

export interface WindowParts {
  root: THREE.Group;
  /** Per-frame update (wipers). */
  update(): void;
}

export function buildWindows(app: App): WindowParts {
  const M = shellMats();
  const root = new THREE.Group();
  root.name = 'shell:windows';

  // --- fixed glass (windshields + rear side windows), both sides
  const glass = new MergeBag();
  const ws = windowPatch(WINDOWS.ws, 0.01, WINDOWS.ws.glass, 0.2);
  glass.both(ws, M.glass);
  const fx = windowPatch(WINDOWS.fixed, 0.01, WINDOWS.fixed.glass, 0.1);
  glass.both(fx, M.glassSide);
  const gg = glass.build('shell:glass', { castShadow: false, receiveShadow: false, dynamic: true });
  gg.traverse((o) => { o.renderOrder = 5; });
  root.add(gg);

  // --- window frame seals (dark rubber ring where the glass meets the reveal)
  const seals = new MergeBag();
  for (const k of ['ws', 'fixed'] as const) {
    const w = WINDOWS[k];
    const rings = [windowRing(w, 0, w.reveal), windowRing(w, -0.006, w.reveal + 0.002), windowRing(w, -0.006, Math.max(w.reveal + 0.004, w.glass - 0.001))];
    const c = rings[0].reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / rings[0].length);
    seals.both(ringStrip(rings, { closed: true, faceToward: c }), M.trim);
  }
  root.add(seals.build('shell:seals', { castShadow: false }));

  // --- sliding windows
  const slides = [buildSlidingWindow(app, 'FO'), buildSlidingWindow(app, 'CAPT')];
  for (const s of slides) root.add(s);

  // --- wipers
  const wipers = [buildWiper('CAPT'), buildWiper('FO')];
  for (const w of wipers) root.add(w.group);

  // --- eye position indicator, sun visors, external visual ice indicator
  root.add(buildEyeIndicator());
  root.add(buildVisors());
  const ice = buildIceIndicator(app);
  root.add(ice.root);

  const sim = app.sim;
  let lastIce = -1;
  return {
    root,
    update() {
      wipers[0].set(sim.get('S:WIPER_CAPT_POS'));
      wipers[1].set(sim.get('S:WIPER_FO_POS'));
      const v = sim.get('S:INTLT_ICE_IND') > 0.5 ? 1 : 0;
      if (v !== lastIce) { lastIce = v; ice.lamp.emissiveIntensity = v * 3; }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Sliding window                                                        */
/* ------------------------------------------------------------------ */

function buildSlidingWindow(app: App, side: 'CAPT' | 'FO'): THREE.Group {
  const M = shellMats();
  const K = app.kit.mats;
  const w = WINDOWS.slide;
  const bag = new MergeBag();
  // sash: flat frame ring behind the reveal (outer edge hidden behind the reveal end), with an inner step
  const outer = roundedOutline(w.pts, w.radii, 0.012, 8, 8).map((p) => toParam(w, p));
  const inner = roundedOutline(w.pts, w.radii, -0.024, 8, 8).map((p) => toParam(w, p));
  bag.add(paramSurface(outer, [inner], wallMap, { maxLen: 0.1, maxSag: 0.0006, offset: -(w.glass - 0.006) }), M.liningDark);
  {
    const rings = [windowRing(w, -0.024, w.glass - 0.006), windowRing(w, -0.024, w.glass + 0.004)];
    const c = rings[0].reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / rings[0].length);
    bag.add(ringStrip(rings, { closed: true, faceToward: c }), M.trim);
  }
  // handle: vertical grip near the front edge of the sash, with the release button (red ring = unlocked)
  const yH = 1.29;
  const front = w.pts[0][0] + ((w.pts[3][0] - w.pts[0][0]) * (yH - w.pts[0][1])) / (w.pts[3][1] - w.pts[0][1]);
  const hz = front + 0.05;
  const [u0, y0] = toParam(w, [hz, yH]);
  const P = wallMap(u0, y0, new THREE.Vector3());
  const n = surfNormal(wallMap, u0, y0, new THREE.Vector3()); // inward (right side)
  const base = P.clone().addScaledVector(n, -(w.glass - 0.006));
  if (side === 'CAPT') { base.x = -base.x; n.x = -n.x; }
  const handle = new THREE.Group();
  handle.position.copy(base);
  // local frame: x = inward (n), y = up (orthogonalised), z = x × y. The handle is symmetric in local z.
  const xAxis = n.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0).addScaledVector(xAxis, -xAxis.y).normalize();
  handle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, new THREE.Vector3().crossVectors(xAxis, yAxis)));
  const hb = new MergeBag();
  const L = 0.15, standoff = 0.055;
  // mounting plate on the sash
  hb.at(geo.roundedBox(0.012, L + 0.05, 0.045, 0.004), M.gripBlack, 0.006, 0, 0);
  // two standoff posts
  for (const s of [-1, 1]) hb.at(geo.cylZ(0.008, 0.009, standoff, 16), M.gripBlack, 0, s * (L / 2 - 0.012), 0, 0, Math.PI / 2, 0);
  // grip bar (rounded, slightly curved)
  const grip = loft(Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const y = (t - 0.5) * L;
    const bow = 0.008 * Math.sin(t * Math.PI);
    return { c: new THREE.Vector3(standoff + bow, y, 0), x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, 1), pts: superellipse(0.011, 0.014, 2.6, 16) };
  }));
  hb.add(grip, M.gripBlack);
  // release button on top of the grip + red indicator ring (visible only when unlocked)
  hb.at(geo.cylZ(0.0075, 0.0075, 0.008, 20), K.chrome, standoff, L / 2 + 0.004, 0, -Math.PI / 2, 0, 0);
  const hg = hb.build(`shell:window_handle_${side}`, { dynamic: true });
  handle.add(hg);
  const ring = new THREE.Mesh(geo.cylZ(0.0086, 0.0086, 0.004, 20), M.red);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(standoff, L / 2 + 0.001, 0);
  handle.add(ring);

  const sash = bag.build(`shell:sash_${side}`, { dynamic: true });
  const glassPane = new THREE.Mesh(windowPatch(w, -0.012, w.glass, 0.1), M.glassSide);
  glassPane.renderOrder = 5;
  glassPane.castShadow = false;
  const g = new THREE.Group();
  g.name = `shell:sliding_window_${side}`;
  g.add(sash, glassPane, handle);
  // mirror the sash and glass for the captain (left); the handle was placed directly
  if (side === 'CAPT') for (const c of [sash, glassPane]) c.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry = mirrorX(m.geometry); });
  const k = side === 'CAPT' ? -1 : 1; // outboard sign
  app.kit.lever(`WINDOW_${side}`, g, {
    apply: (v) => {
      const unl = clamp(v / 0.08, 0, 1);
      const sl = clamp((v - 0.08) / 0.92, 0, 1);
      g.position.set(-k * SLIDE_UNLATCH * unl, 0, SLIDE_TRAVEL * sl);
      ring.visible = v > 0.001;
    },
    dragAxis: 'x',
    invert: side === 'CAPT',
    detents: [0, 1],
    snap: 0.03,
    hit: handle,
    sfx: 'lever',
  });
  return g;
}

/* ------------------------------------------------------------------ */
/* Wipers (outside)                                                      */
/* ------------------------------------------------------------------ */

function buildWiper(side: 'CAPT' | 'FO'): { group: THREE.Group; set(pos: number): void } {
  const M = shellMats();
  const k = side === 'CAPT' ? -1 : 1;
  const group = new THREE.Group();
  group.name = `shell:wiper_${side}`;
  const yP = 1.074, xP = k * 0.8;
  const out = WS_NORMAL.clone().negate();
  const pivot = new THREE.Vector3(xP, yP, zWs(yP)).addScaledVector(out, WS.GLASS_DEPTH + WS.GLASS_T);
  group.position.copy(pivot);
  // local frame: x = arm direction when parked (inboard), y = up the windshield, z = x × y. The geometry is
  // built with "outward" = +z; for the captain x × y points inward, so the group is mirrored in z.
  const ex = new THREE.Vector3(-k, 0, 0);
  const ez = new THREE.Vector3().crossVectors(ex, WS_UP);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, WS_UP, ez));
  if (ez.dot(out) < 0) group.scale.set(1, 1, -1);
  const arm = new THREE.Group();
  group.add(arm);
  const bag = new MergeBag();
  bag.at(geo.cylZ(0.024, 0.028, 0.03, 24), M.wiper, 0, 0, 0);
  bag.at(geo.cylZ(0.012, 0.012, 0.012, 16), M.wiper, 0, 0, 0.03);
  // arm: tapered bar from the pivot to the tip, standing off the glass
  const armG = loft([0, 0.25, 0.5, 0.62].map((x, i) => ({
    c: new THREE.Vector3(x, 0, 0.036 - x * 0.02),
    x: new THREE.Vector3(0, 1, 0), y: new THREE.Vector3(0, 0, 1),
    pts: superellipse([0.012, 0.009, 0.007, 0.006][i], [0.009, 0.007, 0.006, 0.005][i], 3, 12),
  })));
  bag.add(armG, M.wiper);
  // blade holder + rubber blade along the arm, touching the glass (z = 0)
  bag.at(geo.box(0.5, 0.007, 0.012), M.wiper, 0.36, -0.012, 0.012);
  bag.at(geo.box(0.5, 0.003, 0.008), M.rubberBoot, 0.36, -0.012, 0.004);
  bag.at(geo.box(0.02, 0.02, 0.02), M.wiper, 0.36, -0.006, 0.022);
  const mesh = bag.build(`shell:wiper_${side}`, { castShadow: true, dynamic: true });
  arm.add(mesh);
  let last = -1;
  return {
    group,
    set(pos: number) {
      if (pos === last) return;
      last = pos;
      arm.rotation.z = clamp(pos, 0, 1) * 68 * DEG;
    },
  };
}

/* ------------------------------------------------------------------ */
/* External visual ice indicator                                         */
/* ------------------------------------------------------------------ */

/**
 * Visual ice indicator outside the centre windshield post (a short probe the crew watch for ice accretion),
 * with its lamp lit at night by the ICE IND & STBY COMPASS switch (S:INTLT_ICE_IND).
 */
function buildIceIndicator(app: App): { root: THREE.Group; lamp: THREE.MeshStandardMaterial } {
  const M = shellMats();
  const K = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'shell:ice_indicator';
  const y = 1.47;
  const base = new THREE.Vector3(0, y, zWs(y)).addScaledVector(WS_NORMAL, -(WS.GLASS_DEPTH + WS.GLASS_T + 0.004));
  const out = WS_NORMAL.clone().negate();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), WS_NORMAL, new THREE.Vector3(0, 1, 0)).setPosition(base);
  const bag = new MergeBag();
  // mounting foot on the post, stem pointing forward, rounded probe tip, a darker leading strip
  bag.add(geo.roundedBox(0.04, 0.03, 0.01, 0.004), M.wiper, m);
  bag.add(geo.cylZ(0.006, 0.008, 0.06, 16), K.alu, m);
  bag.add(new THREE.SphereGeometry(0.009, 16, 10).translate(0, 0, 0.062), K.alu, m);
  bag.add(geo.box(0.004, 0.012, 0.05).clone().translate(0, 0.004, 0.03), K.darkMetal, m);
  const lamp = M.lampLens.clone();
  lamp.name = 'lens:ice_ind';
  // lamp housing above the probe, shining down onto it
  bag.add(geo.roundedBox(0.03, 0.016, 0.02, 0.005).clone().translate(0, 0.04, 0.012), M.wiper, m);
  bag.add(geo.box(0.02, 0.003, 0.012).clone().translate(0, 0.0315, 0.012), lamp, m);
  root.add(bag.build('shell:ice_ind', { dynamic: true }));
  void out;
  return { root, lamp };
}

/* ------------------------------------------------------------------ */
/* Eye position indicator                                                */
/* ------------------------------------------------------------------ */

/**
 * Three balls on the centre windshield post: a white ball in front and two red balls 35 mm closer to the crew,
 * each on the line from a pilot's design eye (±0.53, 1.28, 0) to the white ball. The eye is at the reference
 * position when that pilot's red ball exactly hides the white ball.
 */
function buildEyeIndicator(): THREE.Group {
  const M = shellMats();
  const g = new THREE.Group();
  g.name = 'shell:eye_position_indicator';
  const bag = new MergeBag();
  const yW = 1.385;
  const post = new THREE.Vector3(0, yW, zWs(yW)).addScaledVector(WS_NORMAL, 0.03);
  const white = post.clone().addScaledVector(WS_NORMAL, 0.045);
  const eye = new THREE.Vector3(-0.53, 1.28, 0);
  const dir = white.clone().sub(eye).normalize();
  const redL = white.clone().addScaledVector(dir, -0.035);
  const redR = redL.clone(); redR.x = -redL.x;
  const ball = new THREE.SphereGeometry(0.0065, 20, 14);
  bag.at(ball, M.white, white.x, white.y, white.z);
  bag.at(ball, M.red, redL.x, redL.y, redL.z);
  bag.at(ball, M.red, redR.x, redR.y, redR.z);
  // bracket: small bar from the post to the balls, and thin stems
  const stem = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a);
    const c = geo.cylZ(0.0018, 0.0018, d.length(), 8).clone();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, new THREE.Vector3(0, 1, 0));
    // lookAt makes −z point along d; cylZ runs along +z → flip
    m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    m.setPosition(a);
    bag.add(c, M.seatMetal, m);
  };
  const hub = post.clone().addScaledVector(WS_NORMAL, 0.02).add(new THREE.Vector3(0, -0.016, 0));
  bag.at(geo.roundedBox(0.03, 0.012, 0.03, 0.003), M.seatMetal, hub.x, hub.y, hub.z);
  for (const b of [white, redL, redR]) stem(hub, b.clone().add(new THREE.Vector3(0, -0.006, 0)));
  g.add(bag.build('shell:epi'));
  return g;
}

/* ------------------------------------------------------------------ */
/* Sun visors (stowed above the sliding windows)                         */
/* ------------------------------------------------------------------ */

function buildVisors(): THREE.Group {
  const M = shellMats();
  const bag = new MergeBag();
  const tint = new MergeBag();
  const p = planAt(Y_WALL_TOP);
  for (const zc of [-0.49]) {
    const u = zc - p.zt;
    const c = ceilMap(u, 0.13, new THREE.Vector3());
    const du = ceilMap(u + 0.01, 0.13, new THREE.Vector3()).sub(c).normalize();
    const dw = ceilMap(u, 0.14, new THREE.Vector3()).sub(c).normalize();
    const nrm = new THREE.Vector3().crossVectors(du, dw).normalize();
    // nrm points into the cockpit (down/inboard) for the right side
    const centre = c.clone().addScaledVector(nrm, 0.012);
    const m = new THREE.Matrix4().makeBasis(du, dw, nrm).setPosition(centre);
    const panel = new THREE.ShapeGeometry(roundedShape(0.34, 0.2, 0.03), 4);
    tint.add(panel, M.visor, m);
    // frame edge + pivot arm to the rail
    const edge = new THREE.Matrix4().makeBasis(du, dw, nrm).setPosition(centre.clone().addScaledVector(dw, -0.1));
    bag.add(geo.roundedBox(0.34, 0.012, 0.01, 0.004), M.trim, edge);
    bag.add(geo.roundedBox(0.03, 0.05, 0.012, 0.004), M.trim, new THREE.Matrix4().makeBasis(du, dw, nrm).setPosition(centre.clone().addScaledVector(dw, -0.12).addScaledVector(du, -0.12)));
  }
  const g = new THREE.Group();
  g.name = 'shell:visors';
  const a = bag.build('shell:visor_frames');
  const t = tint.build('shell:visor_tint', { castShadow: false, dynamic: true });
  g.add(a, t);
  // mirror copies for the left side
  const left = g.clone();
  left.traverse((o) => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.geometry = mirrorX(mm.geometry); });
  const both = new THREE.Group();
  both.add(g, left);
  return both;
}

function roundedShape(w: number, h: number, r: number): THREE.Shape {
  return geo.roundedRectShape(w, h, r);
}

void LIP;
