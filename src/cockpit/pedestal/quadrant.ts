/**
 * Thrust lever quadrant (PED anchor frame, metres: +x right, +y forward, +z up, flat pedestal top at z = 0):
 * curved cover with the TLA markings, two thrust levers (grip, A/THR instinctive disconnect pb, reverse latch),
 * both pitch trim wheels with the THS position scales (degrees / CG) and pointers, and the ENG panel
 * (ENG 1/2 MASTER lift-and-toggle levers, FIRE / FAULT lights, ENG MODE selector).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Handle, InteractEvent } from '../kit';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, m, pedMats, DEG, canvasTexture, extrudeX } from './lib';
import {
  TLA, TLA_DETENTS, tlaAngle, thrustDrag, thrustStep, clampTrim, thsForCg, TRIM_WHEEL_DEG_PER_THS, PITCH_TRIM_MIN, PITCH_TRIM_MAX,
} from './logic/levers';

/** Quadrant geometry (PED local frame). */
export const Q = {
  /** Lever pivot (y, z). */
  py: 0.325, pz: -0.1,
  /** Cover arc radius about the pivot, half width of the cover. */
  R: 0.145, hw: 0.056,
  /** Cover arc angular range (deg from vertical, + forward). */
  a0: -47, a1: 49,
  /** THS strip: outer edge half-width and radius. */
  sx: 0.0795, sR: 0.127,
  /** Grip axis radius from the pivot. */
  gR: 0.212,
  /** Lever x positions. */
  lx: [-0.0285, 0.0285] as [number, number],
  /** Trim wheels: centre (y, z), rim radius, half thickness, x centres. */
  wy: 0.335, wz: -0.062, wR: 0.136, wT: 0.0125, wx: 0.0935,
};

const arcPt = (R: number, aDeg: number): [number, number] => [Q.py + R * Math.sin(aDeg * DEG), Q.pz + R * Math.cos(aDeg * DEG)];

/** Ruled strip between two arcs (inner: x0 / R0, outer: x1 / R1) over the cover range, UV u across, v along. */
function arcStrip(x0: number, R0: number, x1: number, R1: number, seg = 48): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = Q.a0 + ((Q.a1 - Q.a0) * i) / seg;
    const [y0, z0] = arcPt(R0, a);
    const [y1, z1] = arcPt(R1, a);
    pos.push(x0, y0, z0, x1, y1, z1);
    const v = i / seg;
    uv.push(0, v, 1, v);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** v coordinate (0..1 along the cover) of a lever angle. */
const vOf = (aDeg: number) => (aDeg - Q.a0) / (Q.a1 - Q.a0);

/** TLA markings, slots and centre degree scale painted on the cover top. */
function coverTexture(): THREE.CanvasTexture {
  const W = 512, H = 1024;
  return canvasTexture(W, H, (c) => {
    c.fillStyle = '#2a2e33';
    c.fillRect(0, 0, W, H);
    const X = (x: number) => ((x + Q.hw) / (2 * Q.hw)) * W; // metres → px
    const Y = (tla: number) => (1 - vOf(tlaAngle(tla))) * H;
    // lever slots
    for (const lx of Q.lx) {
      c.fillStyle = '#060707';
      c.fillRect(X(lx - 0.0068), Y(TLA.TOGA) - 60, X(lx + 0.0068) - X(lx - 0.0068), Y(TLA.MAX_REV) - Y(TLA.TOGA) + 120);
      c.fillStyle = '#111213';
      c.fillRect(X(lx - 0.0068), Y(TLA.TOGA) - 60, 6, Y(TLA.MAX_REV) - Y(TLA.TOGA) + 120);
    }
    c.fillStyle = '#e9e6de';
    c.strokeStyle = '#e9e6de';
    c.textBaseline = 'middle';
    // centre TLA degree scale 0..45 (between the slots)
    c.textAlign = 'center';
    for (let t = 0; t <= 45; t += 1) {
      const y = Y(t);
      const major = t % 5 === 0;
      c.lineWidth = major ? 3 : 2;
      c.beginPath();
      c.moveTo(W / 2 - (major ? 22 : 12), y); c.lineTo(W / 2 - 6, y);
      c.moveTo(W / 2 + 6, y); c.lineTo(W / 2 + (major ? 22 : 12), y);
      c.stroke();
      if (major && t > 0) { c.font = '600 22px "Barlow Semi Condensed"'; c.fillText(String(t), W / 2, y - 16); }
    }
    c.font = '600 22px "Barlow Semi Condensed"';
    c.fillText('0', W / 2, Y(0) - 16);
    // detent labels outboard of each slot (mirrored sides)
    for (const side of [-1, 1] as const) {
      const lx = Q.lx[side < 0 ? 0 : 1];
      const edge = X(lx + side * 0.0085);
      const tx = X(lx + side * 0.0215);
      c.textAlign = 'center';
      const det: Array<[number, string[]]> = [[TLA.TOGA, ['TO', 'GA']], [TLA.FLX, ['FLX', 'MCT']], [TLA.CL, ['CL']], [TLA.IDLE, ['0']]];
      for (const [t, lines] of det) {
        const y = Y(t);
        // triangle marker pointing at the slot
        c.beginPath();
        c.moveTo(edge, y);
        c.lineTo(edge + side * 16, y - 9);
        c.lineTo(edge + side * 16, y + 9);
        c.closePath();
        c.fill();
        c.font = `600 ${lines.length > 1 ? 21 : 25}px "Barlow Semi Condensed"`;
        lines.forEach((s, i) => c.fillText(s, tx + side * 6, y + (i - (lines.length - 1) / 2) * 21));
      }
      // A/THR active range bracket (CL → IDLE)
      c.lineWidth = 3;
      const bx = X(lx + side * 0.011);
      c.beginPath();
      c.moveTo(bx + side * 8, Y(TLA.CL) + 16);
      c.lineTo(bx, Y(TLA.CL) + 16);
      c.lineTo(bx, Y(TLA.IDLE) - 14);
      c.lineTo(bx + side * 8, Y(TLA.IDLE) - 14);
      c.stroke();
      c.font = '700 25px "Barlow Semi Condensed"';
      const mid = (Y(TLA.CL) + Y(TLA.IDLE)) / 2;
      ['A', '/', 'T', 'H', 'R'].forEach((ch, i) => c.fillText(ch, tx + side * 6, mid + (i - 2) * 24));
      // reverse zone: amber hatching + REV / FULL
      c.save();
      c.strokeStyle = '#ffa12a';
      c.fillStyle = '#ffa12a';
      c.lineWidth = 5;
      const r0 = Y(TLA.IDLE) + 22, r1 = Y(TLA.MAX_REV) - 6;
      const x0 = X(lx + side * 0.009), x1 = X(lx + side * 0.026);
      for (let y = r0; y < r1 - 14; y += 20) {
        c.beginPath(); c.moveTo(x0, y + 10); c.lineTo(x1, y); c.stroke();
      }
      c.beginPath(); c.moveTo((x0 + x1) / 2, r0); c.lineTo((x0 + x1) / 2, r1); c.stroke();
      c.font = '700 24px "Barlow Semi Condensed"';
      c.fillText('REV', (x0 + x1) / 2 + side * 2, (r0 + r1) / 2);
      c.font = '600 20px "Barlow Semi Condensed"';
      c.fillText('FULL', (x0 + x1) / 2, r1 + 20);
      c.restore();
    }
  });
}

/** THS scale strip: degrees UP / DN with CG marks, green take-off band. `mirror` for the right-hand strip. */
function thsTexture(mirror: boolean): THREE.CanvasTexture {
  const W = 128, H = 1024;
  return canvasTexture(W, H, (c) => {
    c.fillStyle = '#0c0d0e';
    c.fillRect(0, 0, W, H);
    const Y = (ths: number) => (1 - vOf(thsAngle(ths))) * H;
    // u = 0 is the inner edge (quadrant side), u = 1 the outer edge (wheel side)
    const U = (u: number) => (mirror ? u : 1 - u) * W;
    // green band (take-off range)
    c.fillStyle = '#2fd15a';
    const gx0 = U(0.02), gx1 = U(0.13);
    c.fillRect(Math.min(gx0, gx1), Y(3.9), Math.abs(gx1 - gx0), Y(-2.6) - Y(3.9));
    c.fillStyle = '#ffa12a';
    c.strokeStyle = '#ffa12a';
    c.textBaseline = 'middle';
    // main line
    c.lineWidth = 3;
    const lx = U(0.55);
    c.beginPath(); c.moveTo(lx, Y(PITCH_TRIM_MAX)); c.lineTo(lx, Y(PITCH_TRIM_MIN)); c.stroke();
    // degree ticks toward the quadrant side, numbers (UP / DN)
    for (let t = -4; t <= 13.5; t += 0.5) {
      const major = Number.isInteger(t);
      const y = Y(t);
      c.lineWidth = major ? 3 : 2;
      c.beginPath(); c.moveTo(lx, y); c.lineTo(U(major ? 0.34 : 0.43), y); c.stroke();
      const labelled = major && (Math.abs(t) <= 4 || t % 2 === 0);
      if (labelled) {
        c.textAlign = 'center';
        c.font = '600 26px "Barlow Semi Condensed"';
        c.fillText(String(Math.abs(t)), U(0.22), y - 10);
        if (t !== 0) { c.font = '600 15px "Barlow Semi Condensed"'; c.fillText(t > 0 ? 'UP' : 'DN', U(0.22), y + 12); }
      }
    }
    c.textAlign = 'center';
    c.font = '600 22px "Barlow Semi Condensed"';
    c.fillText('13.5', U(0.22), Y(13.5) + 12);
    // CG marks on the wheel side
    for (const cg of [20, 25, 30, 35, 40]) {
      const y = Y(thsForCg(cg));
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(lx, y); c.lineTo(U(0.66), y); c.stroke();
      c.font = '600 15px "Barlow Semi Condensed"';
      c.fillText('CG', U(0.82), y - 9);
      c.font = '600 19px "Barlow Semi Condensed"';
      c.fillText(String(cg), U(0.82), y + 9);
    }
  });
}

/** Cover angle (deg) of a THS value on the THS scale: 4 DN at the aft end, 13.5 UP at the forward end. */
export function thsAngle(ths: number): number {
  const a0 = Q.a0 + 5, a1 = Q.a1 - 4;
  return a0 + ((ths - PITCH_TRIM_MIN) / (PITCH_TRIM_MAX - PITCH_TRIM_MIN)) * (a1 - a0);
}

/* ------------------------------------------------------------------ */

export function buildQuadrant(app: App, root: THREE.Group): void {
  const kit = app.kit;
  const PM = pedMats();
  const M = materials();
  const g = new THREE.Group();
  g.name = 'PED_THR';
  root.add(g);

  // ---- housing: cover top, side walls, THS strips, front / aft closures
  const coverMat = new THREE.MeshStandardMaterial({ map: coverTexture(), roughness: 0.6, metalness: 0.15 });
  const cover = new THREE.Mesh(arcStrip(-Q.hw, Q.R, Q.hw, Q.R, 64), coverMat);
  // arcStrip UV: u across x (0 at −hw), v along the arc
  cover.name = 'PED_THR:cover';
  cover.receiveShadow = true;
  g.add(cover);
  kit.interaction.addBlocker(cover);
  for (const side of [-1, 1] as const) {
    const tex = thsTexture(side > 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
    // left-to-right vertex order so the normals face up (u = 0 on the left edge of each strip)
    const strip = new THREE.Mesh(side < 0 ? arcStrip(-Q.sx, Q.sR, -Q.hw, Q.R, 64) : arcStrip(Q.hw, Q.R, Q.sx, Q.sR, 64), mat);
    strip.name = 'PED_THR:ths';
    strip.receiveShadow = true;
    g.add(strip);
    kit.interaction.addBlocker(strip);
    // vertical wall under the strip outer edge, down to the pedestal top
    const wall = new THREE.Mesh(extrudeX(arcWallProfile(Q.sR), 0, 0.003), PM.quadrant);
    wall.position.x = side > 0 ? Q.sx : -Q.sx - 0.003;
    g.add(wall);
  }
  // front and aft closing faces of the cover box (profile of the housing cross-section)
  const endFace = (a: number) => {
    const shape = new THREE.Shape();
    const [yi, zi] = arcPt(Q.R, a);
    const [, zo] = arcPt(Q.sR, a);
    shape.moveTo(-Q.sx, -0.004);
    shape.lineTo(-Q.sx, zo);
    shape.lineTo(-Q.hw, zi);
    shape.lineTo(Q.hw, zi);
    shape.lineTo(Q.sx, zo);
    shape.lineTo(Q.sx, -0.004);
    shape.closePath();
    const eg = new THREE.ShapeGeometry(shape);
    eg.rotateX(Math.PI / 2);
    eg.translate(0, yi, 0);
    return eg;
  };
  const ends = geo.mergeGeometries([geo.normalise(endFace(Q.a0)), geo.normalise(endFace(Q.a1))])!;
  const endMesh = new THREE.Mesh(ends, new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.62, metalness: 0.2, side: THREE.DoubleSide }));
  g.add(endMesh);

  // ---- thrust levers
  for (const n of [1, 2] as const) buildThrustLever(app, g, n);

  // ---- pitch trim wheels + THS pointers
  buildTrimWheels(app, g);
}

/** Wall profile (y, z) under an arc of radius R about the pivot, down to z = −0.004. */
function arcWallProfile(R: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const n = 40;
  for (let i = 0; i <= n; i++) pts.push(arcPt(R, Q.a0 + ((Q.a1 - Q.a0) * i) / n));
  const [ya] = arcPt(R, Q.a1), [yb] = arcPt(R, Q.a0);
  pts.push([ya, -0.004], [yb, -0.004]);
  return pts;
}

/* ------------------------------------------------------------------ */
/* Thrust levers                                                        */
/* ------------------------------------------------------------------ */

function buildThrustLever(app: App, parent: THREE.Group, n: 1 | 2): void {
  const kit = app.kit;
  const PM = pedMats();
  const M = materials();
  const id = `THR_LEVER${n}`;
  const def = kit.def(id);
  const x = Q.lx[n - 1];
  const out = n === 1 ? -1 : 1; // outboard direction
  const pivot = new THREE.Group();
  pivot.position.set(x, Q.py, Q.pz);
  parent.add(pivot);
  // arm: tapered blade from inside the pedestal up to the grip
  const arm = new THREE.Mesh(extrudeX([
    [-0.013, 0.0], [0.013, 0.0], [0.0105, Q.R + 0.004], [0.0115, Q.gR - 0.028], [0.008, Q.gR - 0.006], [-0.009, Q.gR - 0.006], [-0.0105, Q.gR - 0.03], [-0.0095, Q.R + 0.004],
  ], -0.0055, 0.0055, 0.0008), PM.leverArm);
  arm.castShadow = true;
  pivot.add(arm);
  // grip: horizontal cylinder with end collars
  const grip = new THREE.Group();
  grip.position.set(out * 0.0012, 0, Q.gR);
  pivot.add(grip);
  const glen = 0.051, gr = 0.0162;
  const body = new THREE.Mesh(geo.latheZ('pedGrip', [
    [0, -glen / 2], [gr * 0.93, -glen / 2], [gr, -glen / 2 + 0.003], [gr * 0.94, -glen / 2 + 0.0055], [gr * 0.96, 0], [gr * 0.94, glen / 2 - 0.0055], [gr, glen / 2 - 0.003], [gr * 0.93, glen / 2], [0, glen / 2],
  ], 40), PM.gripBlack);
  body.rotation.y = Math.PI / 2;
  body.castShadow = true;
  grip.add(body);
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(geo.latheZ('pedGripCollar', [[gr * 0.99, -0.0015], [gr * 1.06, -0.001], [gr * 1.06, 0.001], [gr * 0.99, 0.0015]], 40), M.darkMetal);
    col.rotation.y = Math.PI / 2;
    col.position.x = s * (glen / 2 - 0.0072);
    grip.add(col);
  }
  // A/THR instinctive disconnect pb on the outboard end face
  const discId = `THR_ATHR_DISC${n}`;
  const disc = new THREE.Group();
  disc.position.x = out * (glen / 2);
  grip.add(disc);
  const bez = new THREE.Mesh(geo.latheZ('pedAthrBez', [[0.0058, 0], [0.0075, 0], [0.0075, 0.0012], [0.0058, 0.0016]], 28), PM.gripBlack);
  bez.rotation.y = out * Math.PI / 2;
  const btn = new THREE.Mesh(geo.latheZ('pedAthrBtn', [[0, 0], [0.0056, 0], [0.0056, 0.0018], [0.0045, 0.0026], [0, 0.0028]], 28), PM.athrRed);
  btn.rotation.y = out * Math.PI / 2;
  disc.add(bez, btn);
  let pressed = false;
  kit.addInstance({ id: discId, sync: (_s, dt) => { const t = pressed ? -0.0012 : 0; btn.position.x += (out * t - btn.position.x) * Math.min(1, dt * 40); } });
  kit.interactive(btn, {
    id: discId, ref: disc, cursor: 'push',
    onDown: () => { pressed = true; kit.press(discId, disc); },
    onUp: () => { pressed = false; kit.release(discId); },
    describe: () => kit.describe(kit.def(discId)),
  });
  // reverse latch: finger lever on the forward face of the arm, under the grip
  const latchPivot = new THREE.Group();
  latchPivot.position.set(0, 0.0135, Q.gR - 0.024);
  pivot.add(latchPivot);
  const latch = new THREE.Mesh(extrudeX([[0, 0.004], [0.004, 0.006], [0.017, 0.001], [0.019, -0.004], [0.016, -0.007], [0.004, -0.003], [0, -0.004]], -0.0075, 0.0075, 0.0006), PM.gripBlack);
  latch.castShadow = true;
  latchPivot.add(latch);

  // ---- behaviour
  const apply = (tla: number) => { pivot.rotation.x = -tlaAngle(tla) * DEG; };
  let shown = kit.sim.get(`C:${id}`);
  apply(shown);
  let latchA = 0;
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const v = sim.get(`C:${id}`);
      shown += (v - shown) * Math.min(1, dt * 22);
      if (Math.abs(v - shown) < 0.01) shown = v;
      apply(shown);
      // latch lifted while in the reverse range (or being lifted)
      const target = v < -0.05 || latchHeld ? 1 : 0;
      latchA += (target - latchA) * Math.min(1, dt * 18);
      latchPivot.rotation.x = latchA * 24 * DEG;
    },
  });
  let raw = 0, fromRev = false, both = false, moved = 0, latchHeld = false;
  const other = `THR_LEVER${n === 1 ? 2 : 1}`;
  const set = (v: number, sound = true) => {
    const ids = both ? [id, other] : [id];
    for (const k of ids) {
      const cur = kit.sim.get(`C:${k}`);
      if (cur === v) continue;
      const crossed = TLA_DETENTS.some((d) => (cur < d && v >= d) || (cur > d && v <= d));
      kit.sim.set(`C:${k}`, v);
      kit.sim.emit(`${k}:change`, { value: v, old: cur });
      if (sound && crossed && k === id) kit.sfx('detent', id, grip);
    }
  };
  const begin = (e: InteractEvent, withLatch: boolean) => {
    both = e.shift || e.ctrl;
    raw = kit.sim.get(`C:${id}`);
    fromRev = raw < TLA.IDLE - 0.05 && !withLatch;
    moved = 0;
    latchHeld = withLatch;
  };
  const drag = (dy: number) => {
    moved += Math.abs(dy);
    raw += -dy * 0.22;
    raw = Math.max(TLA.MAX_REV - 2, Math.min(TLA.TOGA + 2, raw));
    const v = thrustDrag(raw, latchHeld, fromRev);
    set(v);
  };
  const tip = () => `${kit.stateText(def)} (TLA ${kit.sim.get(`C:${id}`).toFixed(1)}°)`;
  const gripHandle: Handle = {
    id, ref: pivot, cursor: 'drag',
    onDown: (e) => begin(e, false),
    onDrag: (_dx, dy) => drag(dy),
    onUp: (e) => {
      if (moved < 3) {
        const cur = kit.sim.get(`C:${id}`);
        set(thrustStep(cur, e.button === 2 ? -1 : 1, cur < TLA.IDLE - 0.05));
      }
      latchHeld = false;
      both = false;
    },
    onWheel: (s) => { const cur = kit.sim.get(`C:${id}`); set(thrustStep(cur, s > 0 ? 1 : -1, cur < TLA.IDLE - 0.05)); },
    describe: () => ({ name: def.name, fr: `${def.fr} — glisser (Maj = les deux manettes), clic G/D = cran suivant/précédent`, state: tip(), id }),
  };
  kit.interactive(body, gripHandle);
  for (const c of grip.children) if (c !== disc) kit.interactive(c, gripHandle);
  kit.interactive(arm, gripHandle);
  const latchHandle: Handle = {
    id, ref: pivot, cursor: 'drag',
    onDown: (e) => {
      const cur = kit.sim.get(`C:${id}`);
      if (cur > TLA.IDLE + 0.3) { latchHeld = false; return; } // latch only usable at idle / in reverse
      begin(e, true);
    },
    onDrag: (_dx, dy) => { if (latchHeld) drag(dy); },
    onUp: (e) => {
      if (latchHeld && moved < 3) {
        const cur = kit.sim.get(`C:${id}`);
        set(e.button === 2 ? thrustStep(cur, 1, true) : thrustStep(cur, -1, true));
      }
      latchHeld = false;
      both = false;
    },
    onWheel: (s) => {
      const cur = kit.sim.get(`C:${id}`);
      if (cur > TLA.IDLE + 0.3) return;
      set(thrustStep(cur, s > 0 ? 1 : -1, true));
    },
    describe: () => ({
      name: `Reverse latch ${n}`, id,
      fr: 'Loquet d’inverseur de poussée — à IDLE, tirer vers soi (glisser vers le bas) pour sélectionner la reverse',
      state: tip(),
    }),
  };
  kit.interactive(latch, latchHandle);
}

/* ------------------------------------------------------------------ */
/* Pitch trim wheels                                                    */
/* ------------------------------------------------------------------ */

function trimWheelGeometry(): { rim: THREE.BufferGeometry; grips: THREE.BufferGeometry; hub: THREE.BufferGeometry } {
  const R = Q.wR, T = Q.wT;
  // rim cross-section (r, x) revolved around X
  const prof: Array<[number, number]> = [
    [R - 0.019, -T * 0.72], [R - 0.012, -T], [R - 0.003, -T], [R, -T * 0.6], [R + 0.0012, 0], [R, T * 0.6], [R - 0.003, T], [R - 0.012, T], [R - 0.019, T * 0.72],
  ];
  const rim = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x)), 96);
  rim.rotateZ(-Math.PI / 2); // lathe axis Y → X
  // light grey grip inserts every 60°
  const gl: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 + 30) * DEG;
    const blk = geo.roundedBox(T * 2 + 0.0016, 0.024, 0.006, 0.0025).clone();
    const mtx = new THREE.Matrix4().makeRotationX(-a).multiply(new THREE.Matrix4().makeTranslation(0, 0, R - 0.0005));
    gl.push(geo.normalise(blk).applyMatrix4(mtx));
  }
  const grips = geo.mergeGeometries(gl)!;
  // spokes + hub (mostly hidden inside the pedestal)
  const hubParts: THREE.BufferGeometry[] = [geo.normalise(geo.cylZ(0.025, 0.025, 0.02, 24).clone().rotateY(Math.PI / 2).translate(-0.01, 0, 0))];
  for (let k = 0; k < 4; k++) {
    const sp = new THREE.BoxGeometry(0.008, 0.012, R - 0.02);
    sp.translate(0, 0, (R - 0.02) / 2 + 0.01);
    sp.applyMatrix4(new THREE.Matrix4().makeRotationX(k * Math.PI / 2 + Math.PI / 4));
    hubParts.push(geo.normalise(sp));
  }
  const hub = geo.mergeGeometries(hubParts)!;
  return { rim, grips, hub };
}

function buildTrimWheels(app: App, parent: THREE.Group): void {
  const kit = app.kit;
  const PM = pedMats();
  const id = 'PITCH_TRIM';
  const def = kit.def(id);
  const { rim, grips, hub } = trimWheelGeometry();
  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const w = new THREE.Group();
    w.position.set(side * Q.wx, Q.wy, Q.wz);
    parent.add(w);
    const r = new THREE.Mesh(rim, PM.trimWheel);
    const gm = new THREE.Mesh(grips, PM.trimGrip);
    const h = new THREE.Mesh(hub, PM.leverArm);
    r.castShadow = true; gm.castShadow = true;
    w.add(r, gm, h);
    wheels.push(w);
  }
  // THS pointers riding on the inner edge of each THS strip
  const pointers: THREE.Group[] = [];
  const ptrMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.4, metalness: 0 });
  for (const side of [-1, 1] as const) {
    const pg = new THREE.Group();
    pg.position.set(0, Q.py, Q.pz);
    parent.add(pg);
    const tri = new THREE.Shape([new THREE.Vector2(0, -0.0034), new THREE.Vector2(0, 0.0034), new THREE.Vector2(side * 0.0085, 0)]);
    const ptr = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.0012, bevelEnabled: false }), ptrMat);
    // lying on the strip at its inner edge, tip toward the scale, following the strip slope
    ptr.position.set(side * (Q.hw + 0.0008), 0, Q.R + 0.0004);
    ptr.rotation.y = side * 36 * DEG;
    ptr.castShadow = true;
    pg.add(ptr);
    pointers.push(pg);
  }
  let shownTrim = kit.sim.get(`C:${id}`);
  let shownThs = kit.sim.get('S:FCTL_THS');
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const v = sim.get(`C:${id}`);
      shownTrim += (v - shownTrim) * Math.min(1, dt * 25);
      for (const w of wheels) w.rotation.x = shownTrim * TRIM_WHEEL_DEG_PER_THS * DEG;
      const ths = sim.has('S:FCTL_THS') ? sim.get('S:FCTL_THS') : v;
      shownThs += (ths - shownThs) * Math.min(1, dt * 12);
      const a = thsAngle(Math.max(PITCH_TRIM_MIN, Math.min(PITCH_TRIM_MAX, shownThs)));
      for (const p of pointers) p.rotation.x = -a * DEG;
    },
  });
  let acc = 0, moved = 0;
  const set = (v: number) => {
    const cur = kit.sim.get(`C:${id}`);
    const nv = clampTrim(v);
    if (nv === cur) return;
    kit.sim.set(`C:${id}`, nv);
    kit.sim.emit(`${id}:change`, { value: nv, old: cur });
    acc += Math.abs(nv - cur);
    if (acc >= 0.15) { acc = 0; kit.sfx('trim', id, wheels[0]); }
  };
  const handle: Handle = {
    id, ref: wheels[0], cursor: 'drag',
    onDown: () => { moved = 0; },
    // pulling the top of the wheel toward you (mouse down) = nose UP
    onDrag: (_dx, dy) => { moved += Math.abs(dy); set(kit.sim.get(`C:${id}`) + dy * 0.02); },
    onUp: (e) => { if (moved < 3) { set(kit.sim.get(`C:${id}`) + (e.button === 2 ? 0.1 : -0.1)); kit.sfx('trim', id, wheels[0]); } },
    onWheel: (s, e) => { set(kit.sim.get(`C:${id}`) - s * ((e as { fast?: boolean }).fast ? 0.4 : 0.1)); kit.sfx('trim', id, wheels[0]); },
    describe: () => {
      const v = kit.sim.get(`C:${id}`);
      const ths = app.sim.has('S:FCTL_THS') ? app.sim.get('S:FCTL_THS') : v;
      const f = (t: number) => `${Math.abs(t).toFixed(1)} ${t >= 0 ? 'UP' : 'DN'}`;
      return { name: def.name, fr: 'Volant de trim — glisser vers soi = cabrer (UP), molette ; l’index indique le PHR (THS)', state: `THS ${f(ths)}`, id };
    },
  };
  for (const w of wheels) kit.interactive(w, handle);
}

/* ------------------------------------------------------------------ */
/* ENG panel                                                            */
/* ------------------------------------------------------------------ */

export function buildEngPanel(app: App): THREE.Group {
  const M = materials();
  const pl = new Plate(app, 'PED_ENG', 112, 76.2, { screws: [[-50.5, 32.6], [50.5, 32.6], [-50.5, -32.6], [50.5, -32.6], [0, 32.6], [-17, -32.6], [17, -32.6]] });
  pl.label('ENG', 0, 30.5, 3.4);
  for (const n of [1, 2] as const) {
    const s = n === 1 ? -1 : 1;
    const x = s * 26;
    pl.label(`MASTER ${n}`, x, 26, 2.3);
    pl.label('ON', x + s * 15.5, 21, 2.1);
    pl.label('OFF', x + s * 15.5, 4, 2.1);
    masterSwitch(pl, n, x, 13);
    // FIRE / FAULT window
    const wy = -17;
    pl.addStatic(geo.rectRing(m(18.5), m(18.5), m(15.8), m(15.8), 0.0026, 0.0008), M.bezel, s * 29, wy, 0);
    pl.ann(`ENG${n}_FIRE`, s * 29, wy + 3.9, 15, 7.6, false);
    pl.ann(`ENG${n}_FAULT`, s * 29, wy - 3.9, 15, 7.6, false);
    pl.label(String(n), s * 29, -31.2, 2.6);
  }
  // ENG MODE selector
  pl.rot('ENG_MODE', 0, -14.5, { white: true, size: 9.6, angles: [-58, 0, 58], ticks: false, pos: [
    ['MODE', 0, 23.6], ['NORM', 0, 19.3], ['CRANK', -13.8, 10.6, 'right'], ['IGN', 14, 12.2, 'left'], ['START', 14, 8.7, 'left'],
  ] });
  pl.arc(0, -14.5, 15.2, -58, 58, 0.55);
  for (const a of [-58, 0, 58]) {
    const sx = Math.sin(a * DEG), cy = Math.cos(a * DEG);
    pl.line([[sx * 14, -14.5 + cy * 14], [sx * 16.8, -14.5 + cy * 16.8]], 0.6);
  }
  return pl.finish();
}

/** ENG MASTER lever-lock switch: pull the knob up, then toggle ON (forward) / OFF (aft). */
function masterSwitch(pl: Plate, n: 1 | 2, x: number, y: number): void {
  const kit = pl.kit;
  const M = materials();
  const PM = pedMats();
  const id = `ENG_MASTER${n}`;
  const def = kit.def(id);
  // round well + backlit ring
  pl.addStatic(geo.latheZ('pedMasterWell', [[m(10.5), 0], [m(12.2), 0], [m(12.2), 0.0014], [m(10.5), 0.0018]], 40), M.bezel, x, y, 0);
  pl.addStatic(geo.cylZ(m(10.5), m(10.5), 0.0004, 40), M.black, x, y, 0.0001);
  pl.arc(x, y, 13.1, 0, 360, 0.7);
  const root = new THREE.Group();
  root.name = id;
  pl.add(root, x, y, 1);
  const lift = new THREE.Group();
  root.add(lift);
  const pivot = new THREE.Group();
  lift.add(pivot);
  const shaft = new THREE.Mesh(geo.cylZ(0.0027, 0.0034, 0.017, 16), M.chrome);
  pivot.add(shaft);
  const knobTex = canvasTexture(128, 96, (c) => {
    c.fillStyle = '#0d0e0f';
    c.fillRect(0, 0, 128, 96);
    c.fillStyle = '#f3f1ea';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '700 40px "Barlow Semi Condensed"';
    c.fillText('ENG', 64, 30);
    c.fillText(String(n), 64, 70);
  });
  const knob = new THREE.Mesh(geo.roundedBox(0.0165, 0.0125, 0.0105, 0.0018), PM.gripBlack);
  knob.position.z = 0.0215;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.0145, 0.0108), new THREE.MeshStandardMaterial({ map: knobTex, roughness: 0.4 }));
  face.position.z = 0.0215 + 0.00527;
  pivot.add(knob, face);
  shaft.castShadow = knob.castShadow = true;
  const angleOf = (v: number) => (v < 0.5 ? 32 : -32); // pos ['ON','OFF']: 0 ON = forward
  let ang = angleOf(kit.sim.get(`C:${id}`));
  let up = 0;
  let held = false;
  pivot.rotation.x = -ang * DEG;
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const target = angleOf(sim.get(`C:${id}`));
      const moving = Math.abs(target - ang) > 0.5;
      const upT = moving || held ? 1 : 0;
      up += Math.sign(upT - up) * Math.min(Math.abs(upT - up), dt * 9);
      if (up > 0.9 || !moving) ang += Math.sign(target - ang) * Math.min(Math.abs(target - ang), dt * 420);
      pivot.rotation.x = -ang * DEG;
      lift.position.z = up * 0.0045;
    },
  });
  let acc = 0, dragged = false;
  const setV = (v: number) => { if (Math.round(kit.sim.get(`C:${id}`)) !== v) kit.setControl(id, v, root, 'sw'); };
  const h: Handle = {
    id, ref: root, cursor: 'toggle',
    onDown: () => { held = true; acc = 0; dragged = false; },
    onDrag: (_dx, dy) => { acc += dy; if (Math.abs(acc) > 3) dragged = true; if (acc < -22) { setV(0); acc = 0; } else if (acc > 22) { setV(1); acc = 0; } },
    onUp: (e) => {
      held = false;
      if (!dragged) setV(e.button === 2 ? 1 : Math.round(kit.sim.get(`C:${id}`)) ? 0 : 1);
    },
    onWheel: (s) => setV(s > 0 ? 0 : 1),
    describe: () => ({ ...kit.describe(def), state: `${kit.stateText(def)} · tirer + basculer (clic / glisser)` }),
  };
  kit.interactive(pivot, h);
}
