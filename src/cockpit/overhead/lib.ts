/**
 * Overhead helpers: a millimetre wrapper around the kit PanelBuilder (one Airbus overhead plate),
 * green synoptic overlay (HYD/FUEL/ELEC/AIR COND flow lines), custom lamps, round pushbuttons,
 * white pointer knobs, toggle collars and non-rectangular plates.
 *
 * Every coordinate/size given to `Plate` methods is in MILLIMETRES in the plate frame
 * (origin = plate centre, +x right, +y = drawing up = aft, face at z = 0).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Kit, PanelBuilder } from '../kit';
import { geo } from '../kit';
import { materials, paintNormalMap } from '../kit/materials';
import { atlas, cellPlane } from '../kit/atlas';
import type { Legend } from '../../core/catalog';

export const MM = 0.001;
const m = (v: number) => v * MM;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Shared overhead materials                                           */
/* ------------------------------------------------------------------ */

export interface OvhdMats {
  /** Airbus white/light-grey pointer knobs (ADIRS, PACK FLOW, temperature, X BLEED, WIPER…). */
  knobWhite: THREE.MeshStandardMaterial;
  /** Black leather-like trim of the overhead console. */
  leather: THREE.MeshStandardMaterial;
  /** Dark rails / backing visible between the plates. */
  backing: THREE.MeshStandardMaterial;
  /** Circuit-breaker caps. */
  cb: THREE.MeshStandardMaterial;
  /** Circuit-breaker white collar band. */
  cbRing: THREE.MeshStandardMaterial;
  /** Synoptic overlay materials (emissive driven by the OVHD integral lighting). */
  syn: THREE.MeshStandardMaterial[];
}

let _om: OvhdMats | null = null;
export function ovhdMats(): OvhdMats {
  if (_om) return _om;
  const nrm = paintNormalMap().clone();
  nrm.repeat.set(9, 9);
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.needsUpdate = true;
  _om = {
    knobWhite: new THREE.MeshStandardMaterial({ color: 0xd6d9d7, roughness: 0.36, metalness: 0 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.8, metalness: 0, normalMap: nrm, normalScale: new THREE.Vector2(0.7, 0.7) }),
    backing: new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.65, metalness: 0.35 }),
    cb: new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.45, metalness: 0 }),
    cbRing: new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5, metalness: 0 }),
    syn: [],
  };
  return _om;
}

/* ------------------------------------------------------------------ */
/* Green synoptic overlay                                               */
/* ------------------------------------------------------------------ */

const SYN_PPM = 6000;

class Synoptic {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  constructor(private w: number, private h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(m(w) * SYN_PPM);
    this.canvas.height = Math.round(m(h) * SYN_PPM);
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.strokeStyle = '#fff';
    this.ctx.fillStyle = '#fff';
  }
  px(x: number, y: number): [number, number] {
    return [m(x + this.w / 2) * SYN_PPM, m(this.h / 2 - y) * SYN_PPM];
  }
  line(pts: Array<[number, number]>, width = 0.75): void {
    const c = this.ctx;
    c.lineWidth = m(width) * SYN_PPM;
    c.lineCap = 'butt';
    c.lineJoin = 'miter';
    c.beginPath();
    pts.forEach(([x, y], i) => { const [a, b] = this.px(x, y); if (i) c.lineTo(a, b); else c.moveTo(a, b); });
    c.stroke();
  }
  /** Filled arrow head with its tip at (x, y). */
  arrow(x: number, y: number, dir: 'u' | 'd' | 'l' | 'r', size = 2.4): void {
    const c = this.ctx;
    const s = size, hw = size * 0.55;
    const pts: Array<[number, number]> =
      dir === 'u' ? [[x, y], [x - hw, y - s], [x + hw, y - s]]
      : dir === 'd' ? [[x, y], [x - hw, y + s], [x + hw, y + s]]
      : dir === 'l' ? [[x, y], [x + s, y - hw], [x + s, y + hw]]
      : [[x, y], [x - s, y - hw], [x - s, y + hw]];
    c.beginPath();
    pts.forEach(([a, b], i) => { const [p, q] = this.px(a, b); if (i) c.lineTo(p, q); else c.moveTo(p, q); });
    c.closePath();
    c.fill();
  }
  circle(x: number, y: number, r: number, width = 0.75): void {
    const c = this.ctx;
    const [a, b] = this.px(x, y);
    c.lineWidth = m(width) * SYN_PPM;
    c.beginPath();
    c.arc(a, b, m(r) * SYN_PPM, 0, Math.PI * 2);
    c.stroke();
  }
  /** Arc (degrees clockwise from 12 o'clock). */
  arc(x: number, y: number, r: number, a0: number, a1: number, width = 0.75): void {
    const c = this.ctx;
    const [a, b] = this.px(x, y);
    c.lineWidth = m(width) * SYN_PPM;
    c.beginPath();
    c.arc(a, b, m(r) * SYN_PPM, (a0 - 90) * DEG, (a1 - 90) * DEG);
    c.stroke();
  }
  build(outline?: Array<[number, number]>): THREE.Mesh {
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x57d98f,
      roughness: 0.45,
      metalness: 0,
      alphaMap: tex,
      transparent: true,
      depthWrite: false,
      emissive: new THREE.Color(0.18, 1.0, 0.45),
      emissiveIntensity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    ovhdMats().syn.push(mat);
    const g = outline ? faceGeometry(outline, this.w, this.h) : new THREE.PlaneGeometry(m(this.w), m(this.h));
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.z = 0.00012;
    mesh.renderOrder = 1;
    mesh.name = 'synoptic';
    return mesh;
  }
}

/* ------------------------------------------------------------------ */
/* Outline (non-rectangular plates)                                     */
/* ------------------------------------------------------------------ */

function outlineShape(pts: Array<[number, number]>): THREE.Shape {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(m(x), m(y))));
}

/** Flat face geometry of an outline with UVs 0..1 over the w x h (mm) plate rectangle. */
function faceGeometry(pts: Array<[number, number]>, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(outlineShape(pts));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / m(w) + 0.5, pos.getY(i) / m(h) + 0.5);
  return g;
}

function slabGeometry(pts: Array<[number, number]>, depth = 0.004): THREE.BufferGeometry {
  const bevel = 0.0007;
  // shrink the outline by the bevel so the bevelled slab keeps the nominal outline
  const c = pts.reduce((a, [x, y]) => [a[0] + x / pts.length, a[1] + y / pts.length], [0, 0]);
  const shrunk = pts.map(([x, y]) => {
    const dx = x - c[0], dy = y - c[1];
    const l = Math.hypot(dx, dy) || 1;
    return [x - (dx / l) * 0.7, y - (dy / l) * 0.7] as [number, number];
  });
  const g = new THREE.ExtrudeGeometry(outlineShape(shrunk), {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -depth + bevel);
  return g;
}

/* ------------------------------------------------------------------ */
/* Plate                                                                */
/* ------------------------------------------------------------------ */

export interface PPb {
  w?: number; h?: number;
  label?: string | string[];
  labelBelow?: string | string[];
  labelSize?: number;
  capText?: string | string[];
  legends?: Legend[];
  outWhenOn?: boolean;
  guard?: boolean;
  noBezel?: boolean;
}

export interface PSw {
  /** Engraved name above the switch at (x, y + labelDy). */
  label?: string | string[];
  labelDy?: number;
  /** Custom position labels: [text, dx, dy, align] (mm, relative). Replaces the kit's automatic labels. */
  pos?: Array<[string, number, number, CanvasTextAlign?]>;
  /** Use the kit's automatic position labels (default false when `pos` is given). */
  autoPos?: boolean;
  length?: number;
  angles?: number[];
  horizontal?: boolean;
  collar?: boolean;
  labelSize?: number;
}

export interface PKnob {
  size?: number;
  style?: 'pointer' | 'round' | 'roundLarge' | 'small' | 'concentric';
  white?: boolean;
  label?: string | string[];
  labelDy?: number;
  angles?: number[];
  /** Custom position labels [text, dx, dy, align]. */
  pos?: Array<[string, number, number, CanvasTextAlign?]>;
  autoPos?: boolean;
  labelRadius?: number;
  labelSize?: number;
  from?: number;
  to?: number;
  scale?: string[];
  ticks?: boolean;
}

export class Plate {
  readonly p: PanelBuilder;
  readonly kit: Kit;
  private syn: Synoptic | null = null;
  private readonly outline?: Array<[number, number]>;

  constructor(readonly app: App, readonly name: string, readonly w: number, readonly h: number, o: { outline?: Array<[number, number]>; screws?: boolean | Array<[number, number]>; material?: 'paint' | 'paintDark' } = {}) {
    this.kit = app.kit;
    const screws = o.screws === undefined ? true : Array.isArray(o.screws) ? o.screws.map(([x, y]) => [m(x), m(y)] as [number, number]) : o.screws;
    this.p = app.kit.panel({ name, width: m(w), height: m(h), zone: 'ovhd', pxPerM: 7000, screws, material: o.material });
    this.outline = o.outline;
  }

  /* ---------------- engravings (white, back-lit) ---------------- */

  label(text: string | string[], x: number, y: number, size = 2.1, o: { align?: CanvasTextAlign; rotate?: number; weight?: number } = {}): void {
    this.p.label(text, m(x), m(y), { size: m(size), align: o.align, rotate: o.rotate, weight: o.weight });
  }
  line(pts: Array<[number, number]>, width = 0.45): void {
    this.p.line(pts.map(([x, y]) => [m(x), m(y)] as [number, number]), m(width));
  }
  rect(x: number, y: number, w: number, h: number, width = 0.45): void {
    this.p.rect(m(x), m(y), m(w), m(h), { width: m(width) });
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, width = 0.45): void {
    this.p.arc(m(x), m(y), m(r), a0, a1, m(width));
  }
  measure(text: string, size = 2.1): number {
    return this.p.measure(text, m(size)) / MM;
  }
  /** White labelled box of the synoptics (e.g. "GREEN", "DC BUS 1"). */
  box(text: string, x: number, y: number, w?: number, h = 5.6, size = 2.0): void {
    const bw = w ?? this.measure(text, size) + 4;
    this.rect(x, y, bw, h, 0.45);
    this.label(text, x, y, size);
  }
  /** Airbus section separator: a horizontal line interrupted by a centred title. */
  section(title: string, y: number, o: { x0?: number; x1?: number; cx?: number; size?: number } = {}): void {
    const x0 = o.x0 ?? -this.w / 2 + 4, x1 = o.x1 ?? this.w / 2 - 4;
    const size = o.size ?? 2.8;
    const cx = o.cx ?? (x0 + x1) / 2;
    if (!title) { this.line([[x0, y], [x1, y]], 0.6); return; }
    const tw = this.measure(title, size) + size * 1.2;
    this.line([[x0, y], [cx - tw / 2, y]], 0.6);
    this.line([[cx + tw / 2, y], [x1, y]], 0.6);
    this.label(title, cx, y, size, { weight: 600 });
  }
  /** Letters stacked vertically (e.g. AUTO next to a pushbutton, FIRE / HYD on the plate edges). */
  vtext(text: string, x: number, y: number, size = 1.8, pitch?: number): void {
    const letters = text.split('');
    const p = pitch ?? size * 1.32;
    const n = letters.length;
    letters.forEach((ch, i) => { if (ch !== ' ') this.label(ch, x, y + ((n - 1) / 2 - i) * p, size); });
  }
  /** Big stacked system name on a plate edge with the vertical rule outboard of it. */
  edge(text: string, side: -1 | 1, y = 0, span?: number, size = 3.0): void {
    const x = side * (this.w / 2 - 8);
    const lx = side * (this.w / 2 - 4.2);
    const n = text.length;
    this.vtext(text, x, y, size, size * 1.45);
    const half = span ?? ((n - 1) * size * 1.45) / 2 + 6;
    this.line([[lx, y - half], [lx, y + half]], 0.6);
  }

  /* ---------------- green synoptic lines ---------------- */

  private get g(): Synoptic {
    return (this.syn ??= new Synoptic(this.w, this.h));
  }
  gline(pts: Array<[number, number]>, width = 0.75): void { this.g.line(pts, width); }
  garrow(x: number, y: number, dir: 'u' | 'd' | 'l' | 'r', size = 2.4): void { this.g.arrow(x, y, dir, size); }
  gcircle(x: number, y: number, r: number, width = 0.75): void { this.g.circle(x, y, r, width); }
  garc(x: number, y: number, r: number, a0: number, a1: number, width = 0.75): void { this.g.arc(x, y, r, a0, a1, width); }
  /** Green bracket over a pushbutton group (line at y with ends dropping toward the buttons). */
  gbracket(x0: number, x1: number, y: number, drop = 2.2, text?: string, textSize = 1.9): void {
    if (text) {
      const tw = this.measure(text, textSize) + 2.2;
      const cx = (x0 + x1) / 2;
      this.g.line([[x0, y - drop], [x0, y], [cx - tw / 2, y]]);
      this.g.line([[cx + tw / 2, y], [x1, y], [x1, y - drop]]);
      this.label(text, cx, y, textSize);
    } else this.g.line([[x0, y - drop], [x0, y], [x1, y], [x1, y - drop]]);
  }

  /* ---------------- controls ---------------- */

  pb(id: string, x: number, y: number, o: PPb = {}): THREE.Group {
    return this.p.pb(id, m(x), m(y), {
      w: o.w !== undefined ? m(o.w) : undefined,
      h: o.h !== undefined ? m(o.h) : undefined,
      label: o.label,
      labelBelow: o.labelBelow,
      labelSize: m(o.labelSize ?? 2.0),
      capText: o.capText,
      legends: o.legends,
      outWhenOn: o.outWhenOn,
      guard: o.guard,
      noBezel: o.noBezel,
    });
  }

  /** Round momentary pushbutton (CALLS, RAIN RPLNT, CVR ERASE/TEST, FIRE TEST, HORN SHUT OFF…). */
  rpb(id: string, x: number, y: number, d = 15, o: { label?: string | string[]; labelDy?: number; labelSize?: number } = {}): THREE.Group {
    const M = materials();
    const root = this.p.pb(id, m(x), m(y), { w: m(d), h: m(d), noBezel: true, legends: [] });
    const cap = root.children[0] as THREE.Group;
    const capMesh = cap.children[0] as THREE.Mesh;
    capMesh.geometry = geo.cylZ(m(d / 2), m(d / 2), 0.01, 32);
    capMesh.position.z = -0.01;
    // concave dark face
    const face = new THREE.Mesh(geo.cylZ(m(d / 2 - 1.4), m(d / 2 - 1.4), 0.0003, 32), M.bezel);
    face.position.z = 0.00002;
    cap.add(face);
    const ri = d / 2 + 0.4, ro = d / 2 + 2.6;
    this.p.addStatic(geo.latheZ(`rbez${d}`, [[m(ri), 0], [m(ro), 0], [m(ro), 0.0026], [m(ro - 0.5), 0.0033], [m(ri), 0.0033], [m(ri), 0]], 40), M.bezel, m(x), m(y), 0);
    this.p.addStatic(geo.cylZ(m(ri), m(ri), 0.0004, 32), M.black, m(x), m(y), 0.0001);
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? d / 2 + 5.5), o.labelSize ?? 2.0);
    return root;
  }

  /** Toggle switch with (optional) black round boss, custom position labels. */
  sw(id: string, x: number, y: number, o: PSw = {}): THREE.Group {
    const auto = o.autoPos ?? !o.pos;
    const root = this.p.sw(id, m(x), m(y), {
      horizontal: o.horizontal,
      posLabels: auto,
      labelSize: m(o.labelSize ?? 2.0),
      length: o.length !== undefined ? m(o.length) : undefined,
      angles: o.angles,
    });
    if (o.collar !== false) {
      const M = materials();
      this.p.addStatic(geo.latheZ('swBoss', [[0.0039, 0], [0.0098, 0], [0.0098, 0.0022], [0.0092, 0.0034], [0.0039, 0.0034], [0.0039, 0]], 40), M.knob, m(x), m(y), 0);
    }
    for (const [t, dx, dy, al] of o.pos ?? []) this.label(t, x + dx, y + dy, o.labelSize ?? 2.0, { align: al ?? 'center' });
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? 17), o.labelSize ?? 2.1);
    return root;
  }

  /** Detented rotary selector. */
  rot(id: string, x: number, y: number, o: PKnob = {}): THREE.Group {
    const auto = o.autoPos ?? !o.pos;
    const OM = ovhdMats();
    const root = this.p.rot(id, m(x), m(y), {
      style: o.style ?? 'pointer',
      size: o.size !== undefined ? m(o.size) : undefined,
      angles: o.angles,
      posLabels: auto,
      labelRadius: o.labelRadius !== undefined ? m(o.labelRadius) : undefined,
      labelSize: m(o.labelSize ?? 2.0),
      ticks: o.ticks,
      material: o.white ? OM.knobWhite : undefined,
    });
    if (o.white) blackIndex(root);
    for (const [t, dx, dy, al] of o.pos ?? []) this.label(t, x + dx, y + dy, o.labelSize ?? 2.0, { align: al ?? 'center' });
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? 22), 2.1);
    return root;
  }

  /** Continuous knob 0..1. */
  pot(id: string, x: number, y: number, o: PKnob = {}): THREE.Group {
    const OM = ovhdMats();
    const root = this.p.pot(id, m(x), m(y), {
      style: o.style ?? 'pointer',
      size: o.size !== undefined ? m(o.size) : undefined,
      from: o.from,
      to: o.to,
      scale: o.scale,
      posLabels: !!o.scale,
      labelRadius: o.labelRadius !== undefined ? m(o.labelRadius) : undefined,
      labelSize: m(o.labelSize ?? 2.0),
      material: o.white ? OM.knobWhite : undefined,
    });
    if (o.white) blackIndex(root);
    for (const [t, dx, dy, al] of o.pos ?? []) this.label(t, x + dx, y + dy, o.labelSize ?? 2.0, { align: al ?? 'center' });
    if (o.label) this.label(o.label, x, y + (o.labelDy ?? 20), 2.1);
    return root;
  }

  ann(id: string, x: number, y: number, w: number, h: number, bezel = true): THREE.Group {
    return this.p.ann(id, m(x), m(y), m(w), m(h), { bezel });
  }

  /** Korry-style light window (pushbutton-sized) showing arbitrary catalog legends (no interaction). */
  lamp(x: number, y: number, legs: Legend[], o: { w?: number; h?: number; upper?: boolean } = {}): THREE.Group {
    const M = materials();
    const w = m(o.w ?? 19), h = m(o.h ?? 19);
    const root = new THREE.Group();
    root.position.set(m(x), m(y), 0);
    this.p.group.add(root);
    this.p.addStatic(geo.rectRing(w + 0.0046, h + 0.0046, w + 0.0007, h + 0.0007, 0.0034), M.bezel, m(x), m(y), 0);
    this.p.addStatic(geo.box(w + 0.0007, h + 0.0007, 0.0004), M.black, m(x), m(y), 0.0002);
    const lens = new THREE.Mesh(geo.roundedBox(w, h, 0.004, 0.0009), M.cap);
    lens.position.z = 0.0009;
    root.add(lens);
    const n = legs.length;
    legs.forEach((leg, i) => {
      const lines = Array.isArray(leg.text) ? leg.text : [leg.text];
      const lw = w * 0.84;
      let lh: number, ly: number;
      if (n === 1 && o.upper) { lh = h * 0.4; ly = h * 0.24; }
      else if (n === 1) { lh = h * (lines.length > 1 ? 0.8 : 0.5); ly = 0; }
      else { lh = h * 0.4; ly = h * (0.5 - (i + 0.5) / n) * 0.96; }
      const cell = atlas().cell(lines, lw / lh, 'legend');
      const mat = this.kit.legendMaterial(leg.color);
      const q = new THREE.Mesh(cellPlane(lw, lh, cell), mat);
      q.position.set(0, ly, 0.0029 + 0.0001);
      root.add(q);
      this.kit.addLegend(leg.light, mat);
    });
    return root;
  }

  screen(displayId: string, x: number, y: number, w: number, h: number): THREE.Group {
    const M = materials();
    // raised bezel frame around the 7-segment window
    this.p.addStatic(geo.rectRing(m(w + 8), m(h + 6.5), m(w + 2.4), m(h + 2.4), 0.0022, 0.0012), M.bezel, m(x), m(y), 0);
    return this.p.screen(displayId, m(x), m(y), m(w), m(h), { glass: true, margin: 0.0012, recess: 0.002 });
  }

  addStatic(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rotZ = 0, extra?: THREE.Matrix4): void {
    this.p.addStatic(g, mat, m(x), m(y), m(z), rotZ, extra);
  }

  finish(): THREE.Group {
    const g = this.p.finish();
    const slabGeo = geo.panelSlab(m(this.w), m(this.h), 0.004, 0.003);
    for (const c of g.children) {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) continue;
      if (mesh.geometry === slabGeo) {
        mesh.name = `${this.name}:slab`;
        if (this.outline) mesh.geometry = slabGeometry(this.outline);
      } else if (this.outline && mesh.name === `${this.name}:face`) mesh.geometry = faceGeometry(this.outline, this.w, this.h);
    }
    if (this.syn) g.add(this.syn.build(this.outline));
    return g;
  }
}

/** White knobs carry a black index line. */
function blackIndex(root: THREE.Object3D): void {
  const M = materials();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material === M.white) mesh.material = M.black;
  });
}

/** Wide landing-light paddle on a toggle lever (visual only; the kit hit proxy takes the clicks). */
export function addPaddle(swRoot: THREE.Group, length = 17): void {
  const M = materials();
  const pivot = swRoot.children.find((c) => (c as THREE.Group).isGroup) as THREE.Group | undefined;
  if (!pivot) return;
  const pad = new THREE.Mesh(geo.roundedBox(0.0135, 0.0042, 0.0085, 0.0012), M.knob);
  pad.position.z = m(length) - 0.0025;
  pad.castShadow = true;
  pivot.add(pad);
  // three grip ridges
  for (const dx of [-0.0038, 0, 0.0038]) {
    const r = new THREE.Mesh(geo.box(0.0011, 0.0045, 0.0005), M.darkMetal);
    r.position.set(dx, 0, m(length) - 0.0025 + 0.0043);
    pivot.add(r);
  }
}

let _fireGlass: THREE.MeshPhysicalMaterial | null = null;
/** ENG/APU FIRE pb guard: clear window with a red rim (instead of the kit's milky clear guard). */
export function fireGuardLook(pbRoot: THREE.Group): void {
  const M = materials();
  _fireGlass ??= new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.07, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05 });
  let body: THREE.Object3D | null = null;
  pbRoot.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === M.guardClear) body = o.parent; });
  if (!body) return;
  (body as THREE.Object3D).children.forEach((c, i) => {
    const mesh = c as THREE.Mesh;
    mesh.material = i === 0 ? _fireGlass! : M.guardRed;
    mesh.castShadow = i !== 0;
  });
}

/** Decorative red frame + lock-wire ring of the ENG / APU FIRE pushbuttons. */
export function fireFrame(pl: Plate, x: number, y: number, w: number, h: number): void {
  const M = materials();
  pl.addStatic(geo.rectRing(m(w + 11), m(h + 10), m(w + 3), m(h + 2.6), 0.0055, 0.0018), M.guardRed, x, y, 0);
  // ring tab below the frame
  const ring = new THREE.TorusGeometry(m(3.4), m(1.1), 10, 24);
  pl.addStatic(ring, M.guardRed, x, y - h / 2 - 5 - 4.2, 3.2);
  pl.addStatic(geo.box(m(5), m(4), m(2.2)), M.guardRed, x, y - h / 2 - 5 - 0.6, 3.2);
}
