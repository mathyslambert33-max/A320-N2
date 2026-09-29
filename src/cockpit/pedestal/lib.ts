/**
 * Pedestal 3D helpers: a millimetre wrapper around the kit PanelBuilder (one Airbus pedestal plate, integral
 * lighting zone 'ped'), custom controls the kit does not provide in the needed form (toggle switches with any
 * position↔side mapping and per-position spring return, rotary selectors whose clicks follow the knob angles,
 * lamps with explicit legends, push/pull reception knobs), 7-segment windows mapped on UV sub-rectangles of a
 * display canvas, and shared pedestal materials.
 *
 * Every coordinate/size given to `Plate` methods is in MILLIMETRES in the plate frame (origin = plate centre,
 * +x right, +y = drawing up = forward on the pedestal, face at z = 0).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Kit, PanelBuilder, Handle, InteractEvent } from '../kit';
import { geo } from '../kit';
import { materials, paintNormalMap, knurlNormalMap } from '../kit/materials';
import { atlas, cellPlane } from '../kit/atlas';
import type { Legend, LightColor } from '../../core/catalog';
import { createDisplayMaterial } from '../../displays/framework';

export const MM = 0.001;
export const m = (v: number) => v * MM;
export const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Shared pedestal materials                                           */
/* ------------------------------------------------------------------ */

export interface PedMats {
  /** Light grey Airbus pointer knobs (SWITCHING, ENG MODE, RUD TRIM, ATC/TCAS). */
  knobWhite: THREE.MeshStandardMaterial;
  /** Thrust lever quadrant cover (dark grey, satin). */
  quadrant: THREE.MeshStandardMaterial;
  /** Black plastic (thrust lever grips, flap / speed brake handles, park brake handle) — kit knob material (batched). */
  gripBlack: THREE.MeshStandardMaterial;
  /** Dark anodised metal (lever arms). */
  leverArm: THREE.MeshStandardMaterial;
  /** Pitch trim wheel rim (black, slightly rubbery). */
  trimWheel: THREE.MeshStandardMaterial;
  /** Light grey grip inserts of the trim wheels. */
  trimGrip: THREE.MeshStandardMaterial;
  /** Red A/THR instinctive disconnect buttons. */
  athrRed: THREE.MeshPhysicalMaterial;
  /** Red gravity gear extension handle. */
  gearRed: THREE.MeshPhysicalMaterial;
  /** Structure: pedestal side walls. */
  body: THREE.MeshStandardMaterial;
  /** Structure: dark trims / edge lips. */
  trim: THREE.MeshStandardMaterial;
  /** Near-black cavities (slots, wells). */
  cavity: THREE.MeshStandardMaterial;
  /** Brush seals of the lever slots. */
  brush: THREE.MeshStandardMaterial;
  /** Printer paper. */
  paper: THREE.MeshStandardMaterial;
  /** Reception knob light (emissive driven per knob). */
  knobLight: THREE.MeshStandardMaterial;
  /** Light grey knurled knobs (lighting knobs, ECAM brightness). */
  knobGreyKnurl: THREE.MeshStandardMaterial;
}

let _pm: PedMats | null = null;
export function pedMats(): PedMats {
  if (_pm) return _pm;
  const M = materials();
  const nrm = paintNormalMap().clone();
  nrm.repeat.set(6, 6);
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.needsUpdate = true;
  const knurl = knurlNormalMap();
  _pm = {
    knobWhite: new THREE.MeshStandardMaterial({ color: 0xd3d6d4, roughness: 0.38, metalness: 0 }),
    quadrant: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.62, metalness: 0.2, normalMap: nrm, normalScale: new THREE.Vector2(0.12, 0.12) }),
    gripBlack: M.knob,
    leverArm: M.darkMetal,
    trimWheel: M.knobKnurl,
    trimGrip: M.white,
    athrRed: new THREE.MeshPhysicalMaterial({ color: 0xb3110d, roughness: 0.28, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    gearRed: new THREE.MeshPhysicalMaterial({ color: 0xa8120e, roughness: 0.35, metalness: 0, clearcoat: 0.5 }),
    body: M.paint,
    trim: new THREE.MeshStandardMaterial({ color: 0x25292d, roughness: 0.7, metalness: 0.1 }),
    cavity: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.9, metalness: 0 }),
    brush: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 1, metalness: 0 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    knobLight: new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.4, metalness: 0, emissive: 0xfff4e0, emissiveIntensity: 0 }),
    knobGreyKnurl: new THREE.MeshStandardMaterial({ color: 0xb9bdbd, roughness: 0.42, metalness: 0.05, normalMap: knurl, normalScale: new THREE.Vector2(1, 1) }),
  };
  return _pm;
}

/* ------------------------------------------------------------------ */
/* Plate                                                                */
/* ------------------------------------------------------------------ */

export interface PKnob {
  size?: number;
  style?: 'pointer' | 'round' | 'roundLarge' | 'small' | 'concentric';
  white?: boolean;
  label?: string | string[];
  labelDy?: number;
  labelSize?: number;
  angles?: number[];
  /** Custom position labels [text, dx, dy, align?] (mm, relative to the knob). */
  pos?: Array<[string, number, number, CanvasTextAlign?]>;
  ticks?: boolean;
  from?: number;
  to?: number;
  scale?: string[];
  labelRadius?: number;
  material?: THREE.Material;
}

export class Plate {
  readonly p: PanelBuilder;
  readonly kit: Kit;
  readonly group: THREE.Group;

  constructor(readonly app: App, readonly name: string, readonly w: number, readonly h: number,
    o: { screws?: boolean | Array<[number, number]>; material?: 'paint' | 'paintDark' | THREE.MeshStandardMaterial; thickness?: number; pxPerM?: number } = {}) {
    this.kit = app.kit;
    const screws = o.screws === undefined ? defaultScrews(w, h) : Array.isArray(o.screws) ? o.screws.map(([x, y]) => [m(x), m(y)] as [number, number]) : o.screws;
    this.p = app.kit.panel({ name, width: m(w), height: m(h), zone: 'ped', pxPerM: o.pxPerM ?? 7000, screws, material: o.material, thickness: o.thickness });
    this.group = this.p.group;
  }

  /* ---------------- engravings ---------------- */
  label(text: string | string[], x: number, y: number, size = 2.2, o: { align?: CanvasTextAlign; rotate?: number; weight?: number; alpha?: number; inverse?: boolean } = {}): void {
    this.p.label(text, m(x), m(y), { size: m(size), align: o.align, rotate: o.rotate, weight: o.weight, alpha: o.alpha, inverse: o.inverse });
  }
  line(pts: Array<[number, number]>, width = 0.45, alpha = 1): void {
    this.p.line(pts.map(([x, y]) => [m(x), m(y)] as [number, number]), m(width), alpha);
  }
  rect(x: number, y: number, w: number, h: number, width = 0.45, fill = false): void {
    this.p.rect(m(x), m(y), m(w), m(h), { width: m(width), fill });
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, width = 0.45): void {
    this.p.arc(m(x), m(y), m(r), a0, a1, m(width));
  }
  measure(text: string, size = 2.2): number {
    return this.p.measure(text, m(size)) / MM;
  }
  /** Engraved arrow head (filled triangle) with its tip at (x, y), pointing along angle `dir` (deg, 0 = up, clockwise). */
  arrowHead(x: number, y: number, dir: number, size = 2): void {
    const a = dir * DEG;
    const ux = Math.sin(a), uy = Math.cos(a);
    const px = -uy, py = ux;
    const b = [x - ux * size, y - uy * size];
    const pts: Array<[number, number]> = [[x, y], [b[0] + px * size * 0.45, b[1] + py * size * 0.45], [b[0] - px * size * 0.45, b[1] - py * size * 0.45], [x, y]];
    for (let i = 0; i < 3; i++) this.line([pts[i], pts[i + 1]], 0.5);
    // fill with a few strokes
    for (let k = 1; k <= 3; k++) {
      const f = k / 4;
      this.line([[x - ux * size * f + px * size * 0.45 * f, y - uy * size * f + py * size * 0.45 * f], [x - ux * size * f - px * size * 0.45 * f, y - uy * size * f - py * size * 0.45 * f]], 0.5);
    }
  }
  /** Letters stacked vertically (e.g. "ATC" / "TCAS" on the panel edges). */
  vtext(text: string, x: number, y: number, size = 2.4, pitch?: number): void {
    const letters = text.split('');
    const p = pitch ?? size * 1.3;
    const n = letters.length;
    letters.forEach((ch, i) => { if (ch !== ' ') this.label(ch, x, y + ((n - 1) / 2 - i) * p, size); });
  }

  /* ---------------- kit controls (mm) ---------------- */
  pb(id: string, x: number, y: number, o: { w?: number; h?: number; label?: string | string[]; labelBelow?: string | string[]; labelSize?: number; capText?: string | string[]; legends?: Legend[]; guard?: boolean; noBezel?: boolean; outWhenOn?: boolean } = {}): THREE.Group {
    return this.p.pb(id, m(x), m(y), {
      w: o.w !== undefined ? m(o.w) : undefined, h: o.h !== undefined ? m(o.h) : undefined,
      label: o.label, labelBelow: o.labelBelow, labelSize: m(o.labelSize ?? 2.0), capText: o.capText, legends: o.legends,
      guard: o.guard, noBezel: o.noBezel, outWhenOn: o.outWhenOn,
    });
  }

  key(id: string, x: number, y: number, w: number, h: number, o: { text?: string | string[]; small?: boolean; depth?: number; material?: THREE.Material } = {}): THREE.Group {
    // Airbus MCDU / ATC keys are near-black with white legends (the kit bezel material is shared → batched)
    return this.p.key(id, m(x), m(y), m(w), m(h), { text: o.text, small: o.small, depth: o.depth !== undefined ? m(o.depth) : undefined, material: o.material ?? materials().bezel });
  }

  /** Round momentary pushbutton (black concave cap in a bezel ring). */
  rpb(id: string, x: number, y: number, d = 12, o: { label?: string | string[]; labelDy?: number; labelSize?: number } = {}): THREE.Group {
    const M = materials();
    const root = this.p.pb(id, m(x), m(y), { w: m(d), h: m(d), noBezel: true, legends: [] });
    const cap = root.children[0] as THREE.Group;
    const capMesh = cap.children[0] as THREE.Mesh;
    capMesh.geometry = geo.cylZ(m(d / 2), m(d / 2), 0.01, 32);
    capMesh.position.z = -0.01;
    const face = new THREE.Mesh(geo.latheZ(`pedRpbFace${d}`, [[0, -0.0004], [m(d / 2 - 1.0), 0], [m(d / 2 - 0.7), 0.0002], [0, 0.0002]], 32), M.bezel);
    face.position.z = 0.00001;
    cap.add(face);
    const ri = d / 2 + 0.4, ro = d / 2 + 2.4;
    this.p.addStatic(geo.latheZ(`pedRbez${d}`, [[m(ri), 0], [m(ro), 0], [m(ro), 0.0024], [m(ro - 0.5), 0.003], [m(ri), 0.003], [m(ri), 0]], 40), M.bezel, m(x), m(y), 0);
    this.p.addStatic(geo.cylZ(m(ri), m(ri), 0.0004, 32), M.black, m(x), m(y), 0.0001);
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? d / 2 + 5), o.labelSize ?? 2.0);
    return root;
  }

  /** Detented rotary selector (kit visuals) whose clicks / wheel follow the knob angles (see `fixRotary`). */
  rot(id: string, x: number, y: number, o: PKnob = {}): THREE.Group {
    const PM = pedMats();
    const root = this.p.rot(id, m(x), m(y), {
      style: o.style ?? 'pointer', size: o.size !== undefined ? m(o.size) : undefined, angles: o.angles,
      posLabels: !o.pos, labelRadius: o.labelRadius !== undefined ? m(o.labelRadius) : undefined,
      labelSize: m(o.labelSize ?? 2.0), ticks: o.ticks, material: o.material ?? (o.white ? PM.knobWhite : undefined),
    });
    if (o.white) blackIndex(root);
    if (o.angles) fixRotary(this.kit, root, id, o.angles);
    for (const [t, dx, dy, al] of o.pos ?? []) this.label(t, x + dx, y + dy, o.labelSize ?? 2.0, { align: al ?? 'center' });
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? 20), o.labelSize ?? 2.2);
    return root;
  }

  pot(id: string, x: number, y: number, o: PKnob = {}): THREE.Group {
    const PM = pedMats();
    const root = this.p.pot(id, m(x), m(y), {
      style: o.style ?? 'round', size: o.size !== undefined ? m(o.size) : undefined, from: o.from, to: o.to,
      scale: o.scale, posLabels: !!o.scale, labelRadius: o.labelRadius !== undefined ? m(o.labelRadius) : undefined,
      labelSize: m(o.labelSize ?? 2.0), material: o.material ?? (o.white ? PM.knobWhite : undefined),
    });
    if (o.white) blackIndex(root);
    for (const [t, dx, dy, al] of o.pos ?? []) this.label(t, x + dx, y + dy, o.labelSize ?? 2.0, { align: al ?? 'center' });
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? 18), o.labelSize ?? 2.2);
    return root;
  }

  enc(id: string, x: number, y: number, o: { size?: number; style?: 'pointer' | 'round' | 'roundLarge' | 'small' | 'concentric'; material?: THREE.Material } = {}): THREE.Group {
    return this.p.enc(id, m(x), m(y), { size: o.size !== undefined ? m(o.size) : undefined, style: o.style, material: o.material });
  }

  ann(id: string, x: number, y: number, w: number, h: number, bezel = true): THREE.Group {
    return this.p.ann(id, m(x), m(y), m(w), m(h), { bezel });
  }

  /** Annunciator window with explicit legends (colours / layout differing from the catalog), no interaction. */
  lamp(x: number, y: number, legs: Legend[], o: { w?: number; h?: number; bezel?: boolean; round?: boolean; name?: string } = {}): THREE.Group {
    const M = materials();
    const w = m(o.w ?? 12), h = m(o.h ?? 9);
    const root = new THREE.Group();
    root.name = o.name ?? (legs.length === 1 ? legs[0].light : 'lamp');
    root.position.set(m(x), m(y), 0);
    this.p.group.add(root);
    if (o.bezel !== false) this.p.addStatic(geo.rectRing(w + 0.0028, h + 0.0028, w, h, 0.0016, 0.0006), M.bezel, m(x), m(y), 0);
    const lens = new THREE.Mesh(geo.box(w, h, 0.0012), M.cap);
    lens.position.z = 0.0006;
    root.add(lens);
    const n = legs.length;
    legs.forEach((leg, i) => {
      const lines = Array.isArray(leg.text) ? leg.text : [leg.text];
      const lw = w * 0.86;
      let lh: number, ly: number;
      if (n === 1) { lh = h * (lines.length > 1 ? 0.8 : 0.56); ly = 0; } else { lh = h * 0.42; ly = h * (0.5 - (i + 0.5) / n) * 0.96; }
      const cell = atlas().cell(lines, lw / lh, 'legend');
      const mat = this.kit.legendMaterial(leg.color);
      const q = new THREE.Mesh(cellPlane(lw, lh, cell), mat);
      q.position.set(0, ly, 0.0013);
      root.add(q);
      this.kit.addLegend(leg.light, mat);
    });
    return root;
  }

  /** 7-segment window: a recessed dark window showing the UV rectangle [u0,u1]×[v0,v1] of display `id`. */
  window7(id: string, x: number, y: number, w: number, h: number, uv: [number, number, number, number] = [0, 1, 0, 1], bezel: { w?: number; h?: number } = {}): THREE.Mesh {
    return this.windows7(id, [{ x, y, w, h, uv, bw: bezel.w, bh: bezel.h }]);
  }

  /** Several windows of one display canvas in a single mesh (one draw call) + one glass mesh. */
  windows7(id: string, wins: Array<{ x: number; y: number; w: number; h: number; uv?: [number, number, number, number]; bw?: number; bh?: number }>): THREE.Mesh {
    const M = materials();
    const planes: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    for (const wd of wins) {
      const { x, y, w, h } = wd;
      const bw = wd.bw ?? w + 5, bh = wd.bh ?? h + 4.5;
      this.p.addStatic(geo.rectRing(m(bw), m(bh), m(w + 0.6), m(h + 0.6), 0.0016, 0.0009), M.bezel, m(x), m(y), 0);
      this.p.addStatic(geo.box(m(w + 0.8), m(h + 0.8), 0.0004), M.black, m(x), m(y), 0.0002);
      const g = new THREE.PlaneGeometry(m(w), m(h));
      const a = g.attributes.uv as THREE.BufferAttribute;
      const [u0, u1, v0, v1] = wd.uv ?? [0, 1, 0, 1];
      for (let i = 0; i < a.count; i++) a.setXY(i, u0 + (u1 - u0) * a.getX(i), v0 + (v1 - v0) * a.getY(i));
      g.translate(m(x), m(y), 0.0005);
      planes.push(geo.normalise(g));
      glass.push(geo.normalise(new THREE.PlaneGeometry(m(w + 0.8), m(h + 0.8)).translate(m(x), m(y), 0.0012)));
    }
    const disp = new THREE.Mesh(geo.mergeGeometries(planes)!, displayMat(id));
    disp.name = `display:${id}`;
    this.p.group.add(disp);
    const gm = new THREE.Mesh(geo.mergeGeometries(glass)!, M.screenGlass);
    gm.renderOrder = 2;
    this.p.group.add(gm);
    this.kit.interaction.addBlocker(disp);
    return disp;
  }

  screen(displayId: string, x: number, y: number, w: number, h: number, o: { margin?: number; recess?: number } = {}): THREE.Group {
    return this.p.screen(displayId, m(x), m(y), m(w), m(h), { glass: true, margin: m(o.margin ?? 2), recess: m(o.recess ?? 3) });
  }

  addStatic(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rotZ = 0, extra?: THREE.Matrix4): void {
    this.p.addStatic(g, mat, m(x), m(y), m(z), rotZ, extra);
  }

  add(obj: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
    return this.p.add(obj, m(x), m(y), m(z));
  }

  finish(): THREE.Group {
    return this.p.finish();
  }
}

/** Dzus fasteners at the four corners (5.5 mm inset). */
function defaultScrews(w: number, h: number): Array<[number, number]> {
  const i = 5.5;
  return [[-w / 2 + i, h / 2 - i], [w / 2 - i, h / 2 - i], [-w / 2 + i, -h / 2 + i], [w / 2 - i, -h / 2 + i]].map(([x, y]) => [m(x), m(y)] as [number, number]);
}

const dispMats = new Map<string, THREE.MeshBasicMaterial>();
/** One display material per display id (all windows of that canvas share it → one draw call after merging). */
export function displayMat(id: string): THREE.MeshBasicMaterial {
  let d = dispMats.get(id);
  if (!d) { d = createDisplayMaterial(id); dispMats.set(id, d); }
  return d;
}

/** White knobs carry a black index line. */
export function blackIndex(root: THREE.Object3D): void {
  const M = materials();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material === M.white) mesh.material = M.black;
  });
}

/**
 * Replace the kit rotary handle so that a click on the right half turns the knob clockwise (toward the next
 * position with a larger angle), left half counter-clockwise, and the wheel up = clockwise, whatever the order of
 * the catalog positions (e.g. ALT RPTG ['ON','OFF'] with ON on the right).
 */
export function fixRotary(kit: Kit, root: THREE.Group, id: string, angles: number[]): void {
  const def = kit.def(id);
  const spring = def.kind === 'rotm';
  const order = angles.map((a, i) => [a, i] as [number, number]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const step = (cw: number) => {
    const v = Math.round(kit.sim.get(`C:${id}`));
    const k = order.indexOf(v);
    const nk = Math.max(0, Math.min(order.length - 1, k + cw));
    if (order[nk] !== v) kit.setControl(id, order[nk], root, spring ? 'rotm' : 'rot');
  };
  const handle: Handle = {
    id,
    ref: root,
    cursor: 'rotate',
    onDown: (e: InteractEvent) => {
      const cw = e.local.x >= 0 ? 1 : -1;
      step(e.button === 2 ? -cw : cw);
    },
    onUp: () => { if (spring && Math.round(kit.sim.get(`C:${id}`)) !== (def.init ?? 0)) kit.setControl(id, def.init ?? 0, root, 'rotm'); },
    onWheel: (s) => {
      if (!spring) { step(s > 0 ? 1 : -1); return; }
      // spring-loaded selector: each wheel notch holds it off-centre for PULSE s (e.g. RUD TRIM 1°/s → 0.25°)
      const rest = def.init ?? 0;
      const k = order.indexOf(rest);
      const target = order[Math.max(0, Math.min(order.length - 1, k + (s > 0 ? 1 : -1)))];
      if (pulseDir !== 0 && pulseTarget !== target) { pulseT = 0; }
      pulseTarget = target;
      pulseDir = s > 0 ? 1 : -1;
      pulseT = Math.min(3, pulseT + PULSE * Math.abs(s));
      if (Math.round(kit.sim.get(`C:${id}`)) !== target) kit.setControl(id, target, root, 'rotm');
    },
    describe: () => ({ ...kit.describe(def), ...(spring ? { fr: `${def.fr ?? def.name} — maintenir le clic (ressort) ou molette par impulsions` } : {}) }),
  };
  const PULSE = 0.25;
  let pulseT = 0, pulseDir = 0, pulseTarget = -1;
  if (spring) {
    kit.addInstance({
      id: `${id}_PULSE`,
      sync: (_sim, dt) => {
        if (pulseDir === 0) return;
        pulseT -= dt;
        if (pulseT <= 0) {
          pulseDir = 0;
          pulseT = 0;
          if (Math.round(kit.sim.get(`C:${id}`)) !== (def.init ?? 0)) kit.setControl(id, def.init ?? 0, root, 'rotm');
        }
      },
    });
  }
  const knob = root.children[0];
  kit.interaction.register(knob, handle);
}

/* ------------------------------------------------------------------ */
/* Toggle switch with explicit angles & spring positions               */
/* ------------------------------------------------------------------ */

export interface ToggleOptions {
  /** Lever angle (deg) of each catalog position; + = toward +y (up/forward) for vertical, toward +x for horizontal. */
  angles: number[];
  horizontal?: boolean;
  /** Positions that return to `rest` when released (spring-loaded). */
  springFrom?: number[];
  /** Rest position for spring-loaded positions (default catalog init). */
  rest?: number;
  length?: number;
  /** Black boss (collar) around the base. */
  boss?: boolean;
}

/**
 * Airbus toggle switch built from kit parts, with catalog position order independent from the lever side.
 * Click on the side toward which the lever should move (right click = the other way), wheel = step.
 */
export function toggle(pl: Plate, id: string, x: number, y: number, o: ToggleOptions): THREE.Group {
  const kit = pl.kit;
  const def = kit.def(id);
  const M = materials();
  const n = o.angles.length;
  const root = new THREE.Group();
  root.name = id;
  root.position.set(m(x), m(y), 0);
  pl.p.group.add(root);
  pl.p.addStatic(geo.toggleBase(), M.darkMetal, m(x), m(y), 0);
  if (o.boss !== false) {
    pl.p.addStatic(geo.latheZ('pedSwBoss', [[0.0039, 0], [0.0092, 0], [0.0092, 0.002], [0.0086, 0.0031], [0.0039, 0.0031], [0.0039, 0]], 40), M.knob, m(x), m(y), 0);
  }
  const pivot = new THREE.Group();
  pivot.position.z = 0.0055;
  root.add(pivot);
  const lever = new THREE.Mesh(geo.toggleLever(m(o.length ?? 16), 0.0018, 0.0026), M.chrome);
  lever.castShadow = true;
  pivot.add(lever);
  const hit = new THREE.Mesh(geo.box(o.horizontal ? 0.03 : 0.016, o.horizontal ? 0.016 : 0.03, 0.03), M.black);
  hit.visible = false;
  hit.userData.hitProxy = true;
  hit.position.z = 0.012;
  root.add(hit);
  const setAngle = (a: number) => {
    if (o.horizontal) { pivot.rotation.set(0, a * DEG, 0); } else { pivot.rotation.set(-a * DEG, 0, 0); }
  };
  let cur = o.angles[def.init ?? 0] ?? 0;
  setAngle(cur);
  kit.addInstance({
    id,
    sync: (sim, dt) => {
      const v = Math.max(0, Math.min(n - 1, Math.round(sim.get(`C:${id}`))));
      cur += (o.angles[v] - cur) * Math.min(1, dt * 30);
      setAngle(cur);
    },
  });
  // positions ordered by angle (low = down/left)
  const order = o.angles.map((a, i) => [a, i] as [number, number]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const rest = o.rest ?? def.init ?? 0;
  const springs = new Set(o.springFrom ?? []);
  const move = (dir: number) => {
    const v = Math.round(kit.sim.get(`C:${id}`));
    const k = order.indexOf(v);
    const nk = Math.max(0, Math.min(n - 1, k + dir));
    if (order[nk] !== v) kit.setControl(id, order[nk], root, def.kind === 'swm' ? 'swm' : 'sw');
  };
  const handle: Handle = {
    id,
    ref: root,
    cursor: 'toggle',
    onDown: (e: InteractEvent) => {
      const toward = o.horizontal ? (e.local.x >= 0 ? 1 : -1) : (e.local.y >= 0 ? 1 : -1);
      let dir = e.button === 2 ? -toward : toward;
      const v = Math.round(kit.sim.get(`C:${id}`));
      const k = order.indexOf(v);
      if ((dir < 0 && k === 0) || (dir > 0 && k === n - 1)) dir = -dir;
      move(dir);
    },
    onUp: () => {
      const v = Math.round(kit.sim.get(`C:${id}`));
      if (springs.has(v) && v !== rest) kit.setControl(id, rest, root, 'swm');
    },
    onWheel: (s: number) => {
      const v = Math.round(kit.sim.get(`C:${id}`));
      const k = order.indexOf(v);
      const nk = Math.max(0, Math.min(n - 1, k + (s > 0 ? 1 : -1)));
      if (springs.has(order[nk])) return; // spring-loaded positions need a held click
      move(s > 0 ? 1 : -1);
    },
    describe: () => kit.describe(def),
  };
  kit.interaction.register(hit, handle);
  kit.interaction.register(lever, handle);
  return root;
}

/* ------------------------------------------------------------------ */
/* Misc geometry                                                        */
/* ------------------------------------------------------------------ */

/** Profile in the (y, z) plane extruded along X from x0 to x1. Points [y, z] (metres), closed polygon. */
export function extrudeX(pts: Array<[number, number]>, x0: number, x1: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach(([y, z], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const d = x1 - x0;
  const g = new THREE.ExtrudeGeometry(s, bevel > 0
    ? { depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 }
    : { depth: d, bevelEnabled: false, curveSegments: 8 });
  g.rotateY(Math.PI / 2);
  g.translate(x0 + (bevel > 0 ? bevel : 0), 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Profile in the (x, y) plane extruded along Z from z0 to z1 (with optional bevel). */
export function extrudeZ(pts: Array<[number, number]>, z0: number, z1: number, bevel = 0): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const d = z1 - z0;
  const g = new THREE.ExtrudeGeometry(s, bevel > 0
    ? { depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 12 }
    : { depth: d, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, z0 + (bevel > 0 ? bevel : 0));
  return g;
}

/** Rounded-rectangle extrusion along Z (x/y centred), bottom at z0. */
export function roundedSlab(w: number, h: number, r: number, z0: number, z1: number, bevel = 0.0006): THREE.BufferGeometry {
  const b = Math.min(bevel, (z1 - z0) / 3);
  const s = geo.roundedRectShape(w - 2 * b, h - 2 * b, Math.max(0.0002, r - b));
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z0 + b);
  return g;
}

/** Canvas texture helper for custom printed surfaces (scales, handles). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Legend helper with an explicit light id and colour. */
export const leg = (text: string | string[], color: LightColor, light: string): Legend => ({ text, color, light });
