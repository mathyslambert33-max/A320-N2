/**
 * PanelBuilder: builds one Airbus panel (a painted slab with engraved, back-lit labels) and the
 * controls mounted on it. Local frame: origin at the panel centre, +X right, +Y up (drawing), +Z out
 * of the face (toward the pilot). Face at z = 0. All dimensions in metres.
 */
import * as THREE from 'three';
import type { Kit } from './index';
import { materials, makeLabelMaterial, type LightZone } from './materials';
import { atlas, cellPlane } from './atlas';
import * as geo from './geo';
import type { ControlDef, Legend } from '../../core/catalog';
import { createDisplayMaterial } from '../../displays/framework';
import type { Handle, InteractEvent } from './interaction';

export interface PanelOptions {
  /** Panel id for debugging (e.g. 'OVHD_ELEC'). */
  name: string;
  width: number;
  height: number;
  /** Integral-lighting zone driving the engraving back-light. */
  zone: LightZone;
  /** Slab thickness (default 4 mm). */
  thickness?: number;
  /** Corner radius (default 3 mm). */
  radius?: number;
  /** Paint (default Airbus blue-grey). */
  material?: 'paint' | 'paintDark' | 'antiGlare' | THREE.MeshStandardMaterial;
  /** Dzus fasteners: true = 4 corners (default), false = none, or explicit list of [x, y]. */
  screws?: boolean | Array<[number, number]>;
  /** Engraving texture resolution in px per metre (default 3600). */
  pxPerM?: number;
  /** Colour of engravings (default white). */
  labelColor?: THREE.Color;
}

export interface LabelOptions {
  /** Cap height in metres (default 2.6 mm). */
  size?: number;
  align?: CanvasTextAlign;
  /** Font weight (default 600). */
  weight?: number;
  /** Rotation in degrees (counter-clockwise). */
  rotate?: number;
  /** Intensity 0..1 (1 = white). */
  alpha?: number;
  /** Draw a filled box behind (inverse text: black text on white box) */
  inverse?: boolean;
  /** Font family override. */
  font?: string;
}

export interface PbOptions {
  w?: number;
  h?: number;
  /** Engraved label above the button. */
  label?: string | string[];
  /** Engraved label below the button. */
  labelBelow?: string | string[];
  /** Text printed on the cap face (FCU/EFIS/ECP/RMP style buttons). */
  capText?: string | string[];
  /** Override legends from the catalog. */
  legends?: Legend[];
  /** Cap protrudes when value = 1 instead of 0 (e.g. ENG FIRE pb: released = 1 = out). */
  outWhenOn?: boolean;
  /** Draw the guard if the catalog defines one (default true). */
  guard?: boolean;
  /** Cap material override. */
  capMaterial?: THREE.Material;
  /** Omit the bezel ring. */
  noBezel?: boolean;
  /** Label size. */
  labelSize?: number;
}

export interface SwitchOptions {
  horizontal?: boolean;
  label?: string | string[];
  /** Draw position names (default true). */
  posLabels?: boolean;
  labelSize?: number;
  /** Lever length (default 17 mm). */
  length?: number;
  /** Override angles in degrees for each position (+ = toward top/right). */
  angles?: number[];
  /** Custom position label placement offsets [dx, dy] per position. */
  posOffsets?: Array<[number, number]>;
}

export interface KnobOptions {
  style?: 'pointer' | 'round' | 'roundLarge' | 'small' | 'concentric';
  /** Knob radius (default 9 mm pointer / 7 mm round). */
  size?: number;
  label?: string | string[];
  labelSize?: number;
  /** For rot: angle (deg, clockwise from 12 o'clock) of each position. */
  angles?: number[];
  /** Draw position labels / scale (default true). */
  posLabels?: boolean;
  /** Radius where position labels are drawn (default size*2.1). */
  labelRadius?: number;
  /** For pot: angle range in degrees (default −135..135). */
  from?: number;
  to?: number;
  /** For pot: scale labels at the ends/marks, e.g. ['OFF','BRT'] or ['COLD','HOT']. */
  scale?: string[];
  /** Draw tick marks at each position (default true for rot). */
  ticks?: boolean;
  /** Material override for the knob. */
  material?: THREE.Material;
}

export interface KeyOptions {
  /** Printed text (lines). Default derived from the catalog key name. */
  text?: string | string[];
  small?: boolean;
  /** Key cap depth (default 5 mm). */
  depth?: number;
  material?: THREE.Material;
}

export interface ScreenOptions {
  /** Glass layer in front (default true). */
  glass?: boolean;
  /** Recess depth (default 3 mm). */
  recess?: number;
  /** Black surround margin (default 3 mm). */
  margin?: number;
}

const DEG = Math.PI / 180;

const KEY_TEXT: Record<string, string | string[]> = {
  FPLN: 'F-PLN', RADNAV: ['RAD', 'NAV'], FUEL: ['FUEL', 'PRED'], SECFPLN: ['SEC', 'F-PLN'], ATC: ['ATC', 'COMM'],
  MENU: ['MCDU', 'MENU'], AIRPORT: ['AIR', 'PORT'], PREV: '←', NEXT: '→', UP: '↑', DOWN: '↓', DOT: '.', PLUSMINUS: '+/-',
  SLASH: '/', SP: 'SP', OVFY: 'OVFY', CLR: 'CLR', BRT: 'BRT', DIM: 'DIM', DIR: 'DIR', PROG: 'PROG', PERF: 'PERF', INIT: 'INIT', DATA: 'DATA',
  L1: '', L2: '', L3: '', L4: '', L5: '', L6: '', R1: '', R2: '', R3: '', R4: '', R5: '', R6: '', ENT: 'ENT',
};

export class PanelBuilder {
  readonly group = new THREE.Group();
  readonly w: number;
  readonly h: number;
  readonly zone: LightZone;
  private readonly opts: PanelOptions;
  private readonly statics = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private readonly ppm: number;
  private finished = false;

  constructor(readonly kit: Kit, opts: PanelOptions) {
    this.opts = opts;
    this.w = opts.width;
    this.h = opts.height;
    this.zone = opts.zone;
    this.group.name = opts.name;
    this.ppm = Math.min(opts.pxPerM ?? 3600, 4096 / Math.max(this.w, this.h));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(4, Math.round(this.w * this.ppm));
    this.canvas.height = Math.max(4, Math.round(this.h * this.ppm));
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ------------------------------------------------------------------ */
  /* Engravings                                                           */
  /* ------------------------------------------------------------------ */

  private px(x: number, y: number): [number, number] {
    return [(x + this.w / 2) * this.ppm, (this.h / 2 - y) * this.ppm];
  }

  /** Engraved (back-lit) text centred at (x, y). */
  label(text: string | string[], x: number, y: number, o: LabelOptions = {}): void {
    const lines = Array.isArray(text) ? text : [text];
    const size = o.size ?? 0.0026;
    const fontPx = (size / 0.7) * this.ppm;
    const ctx = this.ctx;
    ctx.save();
    const [cx, cy] = this.px(x, y);
    ctx.translate(cx, cy);
    if (o.rotate) ctx.rotate(-o.rotate * DEG);
    ctx.font = `${o.weight ?? 600} ${fontPx}px ${o.font ?? '"Barlow Semi Condensed"'}`;
    ctx.textAlign = o.align ?? 'center';
    ctx.textBaseline = 'middle';
    const lh = fontPx * 1.08;
    const a = Math.round(255 * (o.alpha ?? 1));
    lines.forEach((s, i) => {
      const ly = (i - (lines.length - 1) / 2) * lh;
      if (o.inverse) {
        const mw = ctx.measureText(s).width;
        const x0 = ctx.textAlign === 'center' ? -mw / 2 : ctx.textAlign === 'right' ? -mw : 0;
        ctx.fillStyle = `rgb(${a},${a},${a})`;
        ctx.fillRect(x0 - fontPx * 0.2, ly - fontPx * 0.5, mw + fontPx * 0.4, fontPx);
        ctx.fillStyle = '#000';
      } else ctx.fillStyle = `rgb(${a},${a},${a})`;
      ctx.fillText(s, 0, ly + fontPx * 0.04);
    });
    ctx.restore();
  }

  /** Engraved polyline. */
  line(pts: Array<[number, number]>, width = 0.0005, alpha = 1): void {
    const ctx = this.ctx;
    ctx.save();
    const a = Math.round(255 * alpha);
    ctx.strokeStyle = `rgb(${a},${a},${a})`;
    ctx.lineWidth = width * this.ppm;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    pts.forEach(([x, y], i) => { const [px, py] = this.px(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke();
    ctx.restore();
  }

  /** Engraved rectangle outline (or filled). */
  rect(x: number, y: number, w: number, h: number, o: { width?: number; fill?: boolean; alpha?: number } = {}): void {
    const ctx = this.ctx;
    const [px, py] = this.px(x - w / 2, y + h / 2);
    const a = Math.round(255 * (o.alpha ?? 1));
    ctx.save();
    if (o.fill) { ctx.fillStyle = `rgb(${a},${a},${a})`; ctx.fillRect(px, py, w * this.ppm, h * this.ppm); }
    else {
      ctx.strokeStyle = `rgb(${a},${a},${a})`;
      ctx.lineWidth = (o.width ?? 0.0005) * this.ppm;
      ctx.strokeRect(px, py, w * this.ppm, h * this.ppm);
    }
    ctx.restore();
  }

  /** Engraved arc (angles in degrees, clockwise from 12 o'clock). */
  arc(x: number, y: number, r: number, a0: number, a1: number, width = 0.0005): void {
    const ctx = this.ctx;
    const [px, py] = this.px(x, y);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = width * this.ppm;
    ctx.beginPath();
    ctx.arc(px, py, r * this.ppm, (a0 - 90) * DEG, (a1 - 90) * DEG);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Airbus system title with bracket lines, e.g. panel names ("ELEC") or group brackets
   * ("L TK PUMPS" with a line spanning x0..x1 at height y).
   */
  bracket(text: string, x0: number, x1: number, y: number, o: { size?: number; drop?: number } = {}): void {
    const size = o.size ?? 0.0024;
    const drop = o.drop ?? 0.003;
    const cx = (x0 + x1) / 2;
    const tw = this.measure(text, size) + size * 1.2;
    this.label(text, cx, y, { size });
    this.line([[x0, y - drop], [x0, y], [cx - tw / 2, y]]);
    this.line([[cx + tw / 2, y], [x1, y], [x1, y - drop]]);
  }

  /** Width (m) of a text at a given cap height. */
  measure(text: string, size = 0.0026, weight = 600): number {
    const fontPx = (size / 0.7) * this.ppm;
    this.ctx.font = `${weight} ${fontPx}px "Barlow Semi Condensed"`;
    return this.ctx.measureText(text).width / this.ppm;
  }

  /* ------------------------------------------------------------------ */
  /* Static geometry                                                      */
  /* ------------------------------------------------------------------ */

  /** Add static geometry (merged at finish) at local position with optional Z rotation (deg). */
  addStatic(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rotZ = 0, extra?: THREE.Matrix4): void {
    const m = new THREE.Matrix4().makeRotationZ(rotZ * DEG).setPosition(x, y, z);
    if (extra) m.multiply(extra);
    const gg = geo.normalise(g).applyMatrix4(m);
    let list = this.statics.get(mat);
    if (!list) this.statics.set(mat, (list = []));
    list.push(gg);
  }

  /** Add a dynamic object in panel coordinates. */
  add(obj: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
    obj.position.set(x, y, z);
    this.group.add(obj);
    return obj;
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                             */
  /* ------------------------------------------------------------------ */

  /** Airbus pushbutton (latching 'pb' or momentary 'pbm') with lit legends, optional guard. */
  pb(id: string, x: number, y: number, o: PbOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const M = materials();
    const w = o.w ?? 0.019, h = o.h ?? 0.019;
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    if (!o.noBezel) {
      this.addStatic(geo.rectRing(w + 0.0046, h + 0.0046, w + 0.0007, h + 0.0007, 0.0034), M.bezel, x, y, 0);
      this.addStatic(geo.box(w + 0.0007, h + 0.0007, 0.0004), M.black, x, y, 0.0002);
    }
    const cap = new THREE.Group();
    root.add(cap);
    const capMesh = new THREE.Mesh(geo.roundedBox(w, h, 0.01, 0.0011), o.capMaterial ?? M.cap);
    capMesh.position.z = -0.005;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    cap.add(capMesh);

    const legs = o.legends ?? def.leg ?? [];
    const capLines = o.capText ? (Array.isArray(o.capText) ? o.capText : [o.capText]) : null;
    this.addLegends(cap, legs, w, h, capLines);
    if (capLines) {
      const th = legs.length ? h * 0.52 : h * 0.8;
      const ty = legs.length ? -h * 0.16 : 0;
      const cell = atlas().cell(capLines, (w * 0.86) / th, capLines.length > 1 || capLines[0].length > 5 ? 'keySmall' : 'key');
      const m = new THREE.Mesh(cellPlane(w * 0.86, th, cell), this.kit.keyLabelMaterial(this.zone));
      m.position.set(0, ty, 0.00012);
      cap.add(m);
    }

    const momentary = def.kind === 'pbm';
    const zIn = 0.0031, zOut = 0.0061;
    const outWhenOn = !!o.outWhenOn;
    let held = false;
    this.kit.addInstance({
      id,
      sync: (sim, dt) => {
        const v = sim.get(`C:${id}`);
        let target: number;
        if (momentary) target = held || v > 0.5 ? zIn : zOut - 0.0008;
        else target = (v > 0.5) !== outWhenOn ? zIn : zOut;
        cap.position.z += (target - cap.position.z) * Math.min(1, dt * 40);
      },
    });
    cap.position.z = momentary ? zOut - 0.0008 : ((def.init ?? 0) > 0.5) !== outWhenOn ? zIn : zOut;

    const guardOpen = () => !def.guard || o.guard === false || this.kit.sim.get(`C:${id}_GUARD`) > 0.5;
    const handle: Handle = {
      id,
      ref: root,
      cursor: 'push',
      enabled: guardOpen,
      onDown: () => {
        if (momentary) { held = true; this.kit.press(id, root); }
        else this.kit.setControl(id, this.kit.sim.get(`C:${id}`) > 0.5 ? 0 : 1, root, 'pb');
      },
      onUp: () => { if (momentary) { held = false; this.kit.release(id); } },
      describe: () => this.kit.describe(def),
    };
    this.kit.interaction.register(cap, handle);

    if (def.guard && o.guard !== false) this.guard(root, def, w, h);
    if (o.label) this.label(o.label, x, y + h / 2 + 0.0045 + (Array.isArray(o.label) ? (o.label.length - 1) * 0.0015 : 0), { size: o.labelSize });
    if (o.labelBelow) this.label(o.labelBelow, x, y - h / 2 - 0.0045, { size: o.labelSize });
    return root;
  }

  /** Lit legend quads on a pushbutton cap or annunciator. */
  private addLegends(parent: THREE.Object3D, legs: Legend[], w: number, h: number, capText: string[] | null): void {
    const n = legs.length;
    legs.forEach((leg, i) => {
      const lines = Array.isArray(leg.text) ? leg.text : [leg.text];
      const isBar = lines.length === 1 && lines[0] === '▬';
      let lw = w * 0.84, lh: number, ly: number;
      if (isBar) { lw = w * 0.62; lh = h * 0.2; ly = capText ? h * 0.3 : 0; }
      else if (n === 1) { lh = h * (lines.length > 1 ? 0.8 : 0.5); ly = 0; }
      else { lh = h * 0.4; ly = h * (0.5 - (i + 0.5) / n) * 0.96; }
      const cell = atlas().cell(lines, lw / lh, isBar ? 'bar' : 'legend');
      const mat = this.kit.legendMaterial(leg.color);
      const m = new THREE.Mesh(cellPlane(lw, lh, cell), mat);
      m.position.set(0, ly, 0.0001);
      parent.add(m);
      this.kit.addLegend(leg.light, mat);
    });
  }

  /** Flip guard over a control (catalog `guard`). */
  private guard(root: THREE.Group, def: ControlDef, w: number, h: number): void {
    const M = materials();
    const mat = def.guard === 'red' ? M.guardRed : def.guard === 'clear' ? M.guardClear : M.guardBlack;
    const gw = w + 0.0075, gh = h + 0.009, t = 0.0012, depth = 0.0125;
    const hinge = new THREE.Group();
    hinge.position.set(0, gh / 2 - 0.001, 0.0036);
    root.add(hinge);
    const body = new THREE.Group();
    hinge.add(body);
    const top = new THREE.Mesh(geo.roundedBox(gw, gh, t, 0.0005), mat);
    top.position.set(0, -gh / 2, depth - t / 2);
    const sideL = new THREE.Mesh(geo.box(t, gh, depth), mat);
    sideL.position.set(-gw / 2 + t / 2, -gh / 2, depth / 2);
    const sideR = sideL.clone();
    sideR.position.x = gw / 2 - t / 2;
    const lip = new THREE.Mesh(geo.box(gw, t, depth), mat);
    lip.position.set(0, -gh + t / 2, depth / 2);
    body.add(top, sideL, sideR, lip);
    for (const m of [top, sideL, sideR, lip]) { m.castShadow = def.guard !== 'clear'; m.receiveShadow = true; }
    // hinge pins
    this.addStatic(geo.box(gw + 0.002, 0.0025, 0.0025), M.darkMetal, root.position.x, root.position.y + gh / 2 - 0.001, 0.0045);
    const gid = `${def.id}_GUARD`;
    let ang = 0;
    this.kit.addInstance({
      id: gid,
      sync: (sim, dt) => {
        const target = sim.get(`C:${gid}`) > 0.5 ? -1.85 : 0;
        ang += (target - ang) * Math.min(1, dt * 14);
        hinge.rotation.x = ang;
      },
    });
    const handle: Handle = {
      id: gid,
      ref: root,
      cursor: 'toggle',
      onDown: () => this.kit.setControl(gid, this.kit.sim.get(`C:${gid}`) > 0.5 ? 0 : 1, root, 'guard'),
      describe: () => ({ name: `${def.name} guard`, fr: `Cache de protection — ${def.fr ?? def.name}`, state: this.kit.sim.get(`C:${gid}`) > 0.5 ? 'OPEN' : 'CLOSED', id: gid }),
    };
    this.kit.interaction.register(body, handle);
  }

  /** Toggle switch ('sw' or spring-loaded 'swm'). Positions from the catalog; index 0 = top (or left). */
  sw(id: string, x: number, y: number, o: SwitchOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const M = materials();
    const pos = def.pos ?? ['ON', 'OFF'];
    const n = pos.length;
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    this.addStatic(geo.toggleBase(), M.darkMetal, x, y, 0);
    const len = o.length ?? 0.017;
    const angles = o.angles ?? (n === 2 ? [24, -24] : n === 3 ? [26, 0, -26] : pos.map((_, i) => 30 - (60 * i) / (n - 1)));
    const pivot = new THREE.Group();
    pivot.position.z = 0.0055;
    root.add(pivot);
    const lever = new THREE.Mesh(geo.toggleLever(len, 0.0018, 0.0026), M.chrome);
    lever.castShadow = true;
    pivot.add(lever);
    const hit = new THREE.Mesh(geo.box(o.horizontal ? 0.03 : 0.014, o.horizontal ? 0.014 : 0.03, 0.03), M.black);
    hit.visible = false;
    hit.userData.hitProxy = true;
    hit.position.z = 0.012;
    root.add(hit);
    const setAngle = (a: number) => {
      if (o.horizontal) { pivot.rotation.y = a * DEG; pivot.rotation.x = 0; }
      else { pivot.rotation.x = -a * DEG; pivot.rotation.y = 0; }
    };
    let cur = angles[def.init ?? 0] ?? 0;
    setAngle(cur);
    this.kit.addInstance({
      id,
      sync: (sim, dt) => {
        const v = Math.round(sim.get(`C:${id}`));
        const target = angles[Math.max(0, Math.min(n - 1, v))];
        cur += (target - cur) * Math.min(1, dt * 30);
        setAngle(cur);
      },
    });
    const spring = def.kind === 'swm';
    const move = (dir: number) => {
      const v = Math.round(this.kit.sim.get(`C:${id}`));
      const nv = Math.max(0, Math.min(n - 1, v + dir));
      if (nv !== v) this.kit.setControl(id, nv, root, 'sw');
    };
    const handle: Handle = {
      id,
      ref: root,
      cursor: 'toggle',
      onDown: (e: InteractEvent) => {
        // Click on the half toward which the lever should move; right click = opposite.
        const toward = o.horizontal ? (e.local.x < 0 ? -1 : 1) : (e.local.y > 0 ? -1 : 1);
        const v = Math.round(this.kit.sim.get(`C:${id}`));
        let dir = e.button === 2 ? -toward : toward;
        if ((dir < 0 && v === 0) || (dir > 0 && v === n - 1)) dir = -dir;
        move(dir);
      },
      onUp: () => { if (spring && Math.round(this.kit.sim.get(`C:${id}`)) !== (def.init ?? 0)) this.kit.setControl(id, def.init ?? 0, root, 'sw'); },
      onWheel: (steps: number) => { if (!spring) move(steps > 0 ? (o.horizontal ? 1 : -1) : (o.horizontal ? -1 : 1)); },
      describe: () => this.kit.describe(def),
    };
    this.kit.interaction.register(hit, handle);
    this.kit.interaction.register(lever, handle);

    const size = o.labelSize ?? 0.0022;
    if (o.posLabels !== false) {
      pos.forEach((p, i) => {
        const off = o.posOffsets?.[i];
        let lx: number, ly: number, align: CanvasTextAlign = 'center';
        if (off) { lx = x + off[0]; ly = y + off[1]; }
        else if (o.horizontal) { lx = x + (i === 0 ? -0.013 : i === n - 1 ? 0.013 : 0); ly = y + (i === 0 || i === n - 1 ? 0 : -0.012); align = i === 0 ? 'right' : i === n - 1 ? 'left' : 'center'; }
        else { lx = x + (i === 0 || i === n - 1 ? 0 : 0.0085); ly = y + (i === 0 ? 0.0125 : i === n - 1 ? -0.0125 : 0); align = i === 0 || i === n - 1 ? 'center' : 'left'; }
        this.label(p, lx, ly, { size, align });
      });
    }
    if (o.label) this.label(o.label, x, y + (o.horizontal ? 0.012 : 0.0215) + (Array.isArray(o.label) ? (o.label.length - 1) * 0.0014 : 0), { size: o.labelSize ?? 0.0024 });
    return root;
  }

  private knobMesh(style: NonNullable<KnobOptions['style']>, size: number, mat?: THREE.Material): THREE.Group {
    const M = materials();
    const g = new THREE.Group();
    if (style === 'pointer') {
      const skirt = new THREE.Mesh(geo.latheZ(`skirt${size}`, [[0, 0], [size, 0], [size, 0.0012], [size * 0.93, 0.0028], [0, 0.003]]), mat ?? M.knob);
      const grip = new THREE.Mesh(geo.pointerGrip(size * 2.9, size * 0.8, 0.0105), mat ?? M.knob);
      grip.position.z = 0.0015;
      const idx = new THREE.Mesh(geo.box(size * 0.16, size * 1.35, 0.0004), M.white);
      idx.position.set(0, size * 0.72, 0.0123);
      g.add(skirt, grip, idx);
    } else if (style === 'concentric') {
      const outer = new THREE.Mesh(geo.cylZ(size, size * 1.02, 0.008, 48), mat ?? M.knobKnurl);
      g.add(outer);
    } else {
      const hgt = style === 'roundLarge' ? 0.014 : style === 'small' ? 0.008 : 0.011;
      const body = new THREE.Mesh(geo.cylZ(size * 0.97, size, hgt, 48), mat ?? M.knobKnurl);
      const top = new THREE.Mesh(geo.latheZ(`ktop${size}`, [[0, 0], [size * 0.97, 0], [size * 0.9, 0.0009], [0, 0.0011]]), mat ?? M.knob);
      top.position.z = hgt;
      const idx = new THREE.Mesh(geo.box(size * 0.14, size * 0.75, 0.0003), M.white);
      idx.position.set(0, size * 0.52, hgt + 0.0011);
      g.add(body, top, idx);
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /** Rotary selector with detents ('rot' or spring-loaded 'rotm'). */
  rot(id: string, x: number, y: number, o: KnobOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const pos = def.pos ?? ['0', '1'];
    const n = pos.length;
    const style = o.style ?? 'pointer';
    const size = o.size ?? (style === 'pointer' ? 0.0085 : 0.0075);
    const spread = n <= 1 ? 0 : Math.min(300, (n - 1) * (n <= 3 ? 45 : n <= 6 ? 36 : 18));
    const angles = o.angles ?? pos.map((_, i) => (n <= 1 ? 0 : -spread / 2 + (spread * i) / (n - 1)));
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    const knob = this.knobMesh(style, size, o.material);
    root.add(knob);
    let cur = angles[def.init ?? 0] ?? 0;
    knob.rotation.z = -cur * DEG;
    this.kit.addInstance({
      id,
      sync: (sim, dt) => {
        const v = Math.max(0, Math.min(n - 1, Math.round(sim.get(`C:${id}`))));
        cur += (angles[v] - cur) * Math.min(1, dt * 25);
        knob.rotation.z = -cur * DEG;
      },
    });
    const spring = def.kind === 'rotm';
    const step = (dir: number) => {
      const v = Math.round(this.kit.sim.get(`C:${id}`));
      const nv = Math.max(0, Math.min(n - 1, v + dir));
      if (nv !== v) this.kit.setControl(id, nv, root, 'rot');
    };
    const handle: Handle = {
      id,
      ref: root,
      cursor: 'rotate',
      onDown: (e) => {
        const dir = e.local.x >= 0 ? 1 : -1;
        step(e.button === 2 ? -dir : dir);
      },
      onUp: () => { if (spring && Math.round(this.kit.sim.get(`C:${id}`)) !== (def.init ?? 0)) this.kit.setControl(id, def.init ?? 0, root, 'rot'); },
      onWheel: (steps) => { if (!spring) step(steps > 0 ? 1 : -1); },
      describe: () => this.kit.describe(def),
    };
    this.kit.interaction.register(knob, handle);
    const lr = o.labelRadius ?? size * 2.15;
    const lsize = o.labelSize ?? 0.0021;
    if (o.posLabels !== false) {
      pos.forEach((p, i) => {
        const a = angles[i] * DEG;
        this.label(p, x + Math.sin(a) * lr, y + Math.cos(a) * lr, { size: lsize });
        if (o.ticks !== false) {
          const r0 = size * 1.2, r1 = size * 1.45;
          this.line([[x + Math.sin(a) * r0, y + Math.cos(a) * r0], [x + Math.sin(a) * r1, y + Math.cos(a) * r1]], 0.0005);
        }
      });
    }
    if (o.label) this.label(o.label, x, y + lr + 0.0055 + (Array.isArray(o.label) ? (o.label.length - 1) * 0.0014 : 0), { size: o.labelSize ?? 0.0024 });
    return root;
  }

  /** Continuous knob 0..1 ('pot'). */
  pot(id: string, x: number, y: number, o: KnobOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const style = o.style ?? 'round';
    const size = o.size ?? (style === 'pointer' ? 0.0085 : 0.0065);
    const from = o.from ?? -135, to = o.to ?? 135;
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    const knob = this.knobMesh(style, size, o.material);
    root.add(knob);
    const ang = (v: number) => from + (to - from) * v;
    knob.rotation.z = -ang(def.init ?? 0) * DEG;
    this.kit.addInstance({
      id,
      sync: (sim) => { knob.rotation.z = -ang(Math.max(0, Math.min(1, sim.get(`C:${id}`)))) * DEG; },
    });
    let lastSfx = 0;
    const setV = (v: number) => {
      v = Math.max(0, Math.min(1, v));
      const now = performance.now();
      this.kit.setControl(id, v, root, now - lastSfx > 60 ? 'pot' : null);
      lastSfx = now;
    };
    const handle: Handle = {
      id,
      ref: root,
      cursor: 'rotate',
      onDown: (e) => {
        const dir = e.local.x >= 0 ? 1 : -1;
        setV(this.kit.sim.get(`C:${id}`) + (e.button === 2 ? -dir : dir) * 0.1);
      },
      onWheel: (steps, e) => setV(this.kit.sim.get(`C:${id}`) + steps * ((e as any).fast ? 0.06 : 0.03)),
      describe: () => this.kit.describe(def),
    };
    this.kit.interaction.register(knob, handle);
    if (o.posLabels !== false && o.scale?.length) {
      const lr = o.labelRadius ?? size * 2.3;
      const k = o.scale.length;
      o.scale.forEach((s, i) => {
        const a = ang(k === 1 ? 0 : i / (k - 1)) * DEG;
        this.label(s, x + Math.sin(a) * lr, y + Math.cos(a) * lr, { size: o.labelSize ?? 0.002 });
      });
      this.arc(x, y, size * 1.45, from, to, 0.0004);
    }
    if (o.label) this.label(o.label, x, y + (o.labelRadius ?? size * 2.3) + 0.005, { size: o.labelSize ?? 0.0024 });
    return root;
  }

  /** Endless encoder knob ('enc'): wheel = inc/dec, left click = push, right click = pull (if pushPull). */
  enc(id: string, x: number, y: number, o: KnobOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const style = o.style ?? 'roundLarge';
    const size = o.size ?? 0.011;
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    const knob = this.knobMesh(style, size, o.material);
    root.add(knob);
    let rot = 0, pushZ = 0, pushT = 0;
    this.kit.addInstance({
      id,
      sync: (_sim, dt) => {
        knob.rotation.z = rot;
        if (pushT > 0) { pushT -= dt; if (pushT <= 0) pushZ = 0; }
        knob.position.z += (pushZ - knob.position.z) * Math.min(1, dt * 30);
      },
    });
    const turn = (steps: number, fast: boolean) => {
      const n = Math.abs(steps) * (fast ? 5 : 1);
      rot -= Math.sign(steps) * n * 0.26;
      this.kit.sim.emit(`${id}:${steps > 0 ? 'inc' : 'dec'}`, { steps: n, fast });
      this.kit.sfx('enc', id, root);
    };
    const handle: Handle = {
      id,
      ref: root,
      cursor: def.pushPull ? 'push' : 'rotate',
      onDown: (e) => {
        if (def.pushPull) {
          const pull = e.button === 2;
          pushZ = pull ? 0.0025 : -0.0022;
          pushT = 0.18;
          this.kit.sim.emit(`${id}:${pull ? 'pull' : 'push'}`);
          this.kit.sfx(pull ? 'pull' : 'push', id, root);
        } else {
          const dir = e.local.x >= 0 ? 1 : -1;
          turn(e.button === 2 ? -dir : dir, false);
        }
      },
      onWheel: (steps, e) => turn(steps, !!(e as any).fast),
      describe: () => ({ ...this.kit.describe(def), state: def.pushPull ? 'molette = tourner · clic G = pousser · clic D = tirer' : 'molette = tourner' }),
    };
    this.kit.interaction.register(knob, handle);
    if (o.label) this.label(o.label, x, y + size + 0.006, { size: o.labelSize ?? 0.0024 });
    return root;
  }

  /** Keypad key ('key' kind): emits the catalog event with {key}. */
  key(id: string, x: number, y: number, w: number, h: number, o: KeyOptions = {}): THREE.Group {
    const def = this.kit.def(id);
    const M = materials();
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    const depth = o.depth ?? 0.005;
    const capG = new THREE.Group();
    root.add(capG);
    const body = new THREE.Mesh(geo.roundedBox(w, h, depth, Math.min(w, h) * 0.12), o.material ?? M.keyCap);
    body.position.z = depth / 2;
    body.castShadow = true;
    capG.add(body);
    const txt = o.text ?? KEY_TEXT[def.key ?? ''] ?? def.key ?? '';
    const lines = Array.isArray(txt) ? txt : [txt];
    if (lines.join('')) {
      const th = h * (lines.length > 1 ? 0.78 : 0.62);
      const cell = atlas().cell(lines, (w * 0.9) / th, o.small || lines.length > 1 || lines[0].length > 4 ? 'keySmall' : 'key');
      const t = new THREE.Mesh(cellPlane(w * 0.9, th, cell), this.kit.keyLabelMaterial(this.zone));
      t.position.z = depth + 0.0001;
      capG.add(t);
    }
    let pressed = false;
    this.kit.addInstance({
      id,
      sync: (_s, dt) => { capG.position.z += ((pressed ? -0.0015 : 0) - capG.position.z) * Math.min(1, dt * 40); },
    });
    const handle: Handle = {
      id,
      ref: root,
      cursor: 'key',
      onDown: () => {
        pressed = true;
        this.kit.sim.set(`C:${id}`, 1);
        this.kit.sim.emit(`${id}:press`);
        if (def.event) this.kit.sim.emit(def.event, { key: def.key });
        this.kit.sfx('key', id, root);
      },
      onUp: () => { pressed = false; this.kit.sim.set(`C:${id}`, 0); this.kit.sim.emit(`${id}:release`); },
      describe: () => ({ name: def.name, fr: def.fr, id }),
    };
    this.kit.interaction.register(capG, handle);
    return root;
  }

  /** Stand-alone annunciator light ('ann' kind) of w x h metres. */
  ann(id: string, x: number, y: number, w = 0.016, h = 0.009, o: { bezel?: boolean } = {}): THREE.Group {
    const def = this.kit.def(id);
    const M = materials();
    const root = new THREE.Group();
    root.name = id;
    root.position.set(x, y, 0);
    this.group.add(root);
    if (o.bezel !== false) this.addStatic(geo.rectRing(w + 0.003, h + 0.003, w, h, 0.0015, 0.0006), M.bezel, x, y, 0);
    const lens = new THREE.Mesh(geo.box(w, h, 0.0012), M.cap);
    lens.position.z = 0.0006;
    root.add(lens);
    const holder = new THREE.Group();
    holder.position.z = 0.0013;
    root.add(holder);
    this.addLegends(holder, def.leg ?? [], w, h, null);
    return root;
  }

  /** Glass display area bound to a display id (see src/displays/framework.ts). */
  screen(displayId: string, x: number, y: number, w: number, h: number, o: ScreenOptions = {}): THREE.Group {
    const M = materials();
    const root = new THREE.Group();
    root.name = `screen:${displayId}`;
    root.position.set(x, y, 0);
    this.group.add(root);
    const recess = o.recess ?? 0.003;
    const margin = o.margin ?? 0.003;
    this.addStatic(geo.box(w + 2 * margin, h + 2 * margin, 0.0006), M.black, x, y, 0.0003);
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(w, h), createDisplayMaterial(displayId));
    disp.position.z = 0.0007;
    disp.name = `display:${displayId}`;
    root.add(disp);
    if (o.glass !== false) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(w + margin, h + margin), M.screenGlass);
      glass.position.z = 0.0007 + Math.max(0.0008, recess * 0.4);
      glass.renderOrder = 2;
      root.add(glass);
    }
    this.kit.interaction.addBlocker(disp);
    return root;
  }

  /* ------------------------------------------------------------------ */
  /* Finish                                                               */
  /* ------------------------------------------------------------------ */

  /** Bake engravings, merge static geometry, add slab/face. Returns the panel group. */
  finish(): THREE.Group {
    if (this.finished) return this.group;
    this.finished = true;
    const M = materials();
    const base = typeof this.opts.material === 'object' ? this.opts.material : M[this.opts.material ?? 'paint'];
    const t = this.opts.thickness ?? 0.004;
    const r = this.opts.radius ?? 0.003;
    // screws
    const screws = this.opts.screws ?? true;
    if (screws) {
      const inset = 0.0055;
      const pts: Array<[number, number]> = screws === true
        ? [[-this.w / 2 + inset, this.h / 2 - inset], [this.w / 2 - inset, this.h / 2 - inset], [-this.w / 2 + inset, -this.h / 2 + inset], [this.w / 2 - inset, -this.h / 2 + inset]]
        : screws;
      for (const [sx, sy] of pts) this.addStatic(geo.dzus(), M.darkMetal, sx, sy, 0, 20);
    }
    // engraving mask → single channel texture
    const { width, height } = this.canvas;
    const img = this.ctx.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4];
    // flip Y for GL
    const flipped = new Uint8Array(width * height);
    for (let yy = 0; yy < height; yy++) flipped.set(mask.subarray(yy * width, (yy + 1) * width), (height - 1 - yy) * width);
    const tex = new THREE.DataTexture(flipped, width, height, THREE.RedFormat, THREE.UnsignedByteType);
    tex.unpackAlignment = 1;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const faceMat = makeLabelMaterial(base, tex, this.zone, this.opts.labelColor);
    const face = new THREE.Mesh(geo.panelFace(this.w, this.h, r), faceMat);
    face.position.z = 0.00004;
    face.receiveShadow = true;
    face.name = `${this.opts.name}:face`;
    const slab = new THREE.Mesh(geo.panelSlab(this.w, this.h, t, r), base);
    slab.name = `${this.opts.name}:slab`;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.group.add(slab, face);
    this.kit.interaction.addBlocker(face);
    for (const [mat, list] of this.statics) {
      const merged = geo.mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${this.opts.name}:static`;
      this.group.add(mesh);
    }
    this.statics.clear();
    atlas().flush();
    return this.group;
  }
}
