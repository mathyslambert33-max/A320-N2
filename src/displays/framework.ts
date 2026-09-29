/**
 * Display framework: every glass display / LCD / 7-segment window is a 2D canvas that a module
 * draws into, uploaded to a THREE.CanvasTexture which the 3D panels map onto screen meshes.
 *
 *  - Logic owners call `registerDisplay(def)` (see catalog DISPLAYS for ids/owners).
 *  - 3D panels call `getDisplayTexture(id)` (available before or after registration).
 *  - The app calls `updateDisplays(sim, t)` every frame; the framework schedules redraws per `hz`.
 *
 * Drawing is in canvas pixels. The canvas is cleared to `background` (default black) before draw().
 * When `powered()` is false the screen is drawn black and draw() is not called.
 */
import * as THREE from 'three';
import type { Sim } from '../core/sim';

export interface DisplayInfo {
  /** Seconds since app start (real time). */
  t: number;
  /** Seconds since this display's previous draw. */
  dt: number;
  /** Seconds since the display was last powered on (use for self-test / boot sequences). */
  sincePowerOn: number;
  width: number;
  height: number;
}

export interface DisplayDef {
  id: string;
  width: number;
  height: number;
  /** Redraw rate in Hz (default 15). */
  hz?: number;
  background?: string;
  /** Power condition (default: always powered). */
  powered?(sim: Sim): boolean;
  /** 0..1 brightness applied to the screen material (default 1). Knob OFF (0) → screen dark. */
  brightness?(sim: Sim): number;
  draw(ctx: CanvasRenderingContext2D, sim: Sim, info: DisplayInfo): void;
}

interface Entry {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  def?: DisplayDef;
  lastDraw: number;
  poweredSince: number;
  wasPowered: boolean;
  brightness: number;
  /** Materials using this display, so brightness can be applied. */
  materials: Set<THREE.MeshBasicMaterial>;
}

const entries = new Map<string, Entry>();

function makeEntry(id: string, w = 256, h = 256): Entry {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const e: Entry = { id, canvas, ctx, texture, lastDraw: -1e9, poweredSince: 0, wasPowered: false, brightness: 1, materials: new Set() };
  entries.set(id, e);
  return e;
}

export function registerDisplay(def: DisplayDef): void {
  let e = entries.get(def.id);
  if (!e) e = makeEntry(def.id, def.width, def.height);
  else if (e.canvas.width !== def.width || e.canvas.height !== def.height) {
    e.canvas.width = def.width;
    e.canvas.height = def.height;
    e.texture.dispose();
    e.texture.needsUpdate = true;
  }
  e.def = def;
  e.lastDraw = -1e9;
}

export function getDisplayTexture(id: string): THREE.CanvasTexture {
  return (entries.get(id) ?? makeEntry(id)).texture;
}

export function getDisplayCanvas(id: string): HTMLCanvasElement {
  return (entries.get(id) ?? makeEntry(id)).canvas;
}

/**
 * Material for a screen mesh: unlit, shows the display, brightness-scaled by the framework.
 * Put a separate glass/reflection layer in front of it (kit.screen does that).
 */
export function createDisplayMaterial(id: string): THREE.MeshBasicMaterial {
  const e = entries.get(id) ?? makeEntry(id);
  const m = new THREE.MeshBasicMaterial({ map: e.texture, toneMapped: false });
  m.color.setScalar(e.brightness);
  e.materials.add(m);
  return m;
}

export function registeredDisplays(): string[] {
  return [...entries.values()].filter((e) => e.def).map((e) => e.id);
}

let fontsReady = false;
if (typeof document !== 'undefined' && (document as any).fonts) {
  (document as any).fonts.ready.then(() => { fontsReady = true; });
} else fontsReady = true;

/** Call every frame. Draws displays whose period elapsed (max `budget` per frame, oldest first). */
export function updateDisplays(sim: Sim, t: number, budget = 4): void {
  if (!fontsReady) return;
  const due: Entry[] = [];
  for (const e of entries.values()) {
    const def = e.def;
    if (!def) continue;
    let powered = true;
    try { powered = def.powered ? def.powered(sim) : true; } catch (err) { console.error(`[display ${e.id}] powered()`, err); }
    if (powered && !e.wasPowered) { e.poweredSince = t; e.lastDraw = -1e9; }
    if (!powered && e.wasPowered) {
      e.ctx.fillStyle = '#000';
      e.ctx.fillRect(0, 0, e.canvas.width, e.canvas.height);
      e.texture.needsUpdate = true;
    }
    e.wasPowered = powered;
    const b = powered ? (def.brightness ? clamp01(def.brightness(sim)) : 1) : 0;
    if (Math.abs(b - e.brightness) > 0.002) {
      e.brightness = b;
      for (const m of e.materials) m.color.setScalar(b);
    }
    if (!powered || b <= 0.001) continue;
    const period = 1 / (def.hz ?? 15);
    if (t - e.lastDraw >= period) due.push(e);
  }
  due.sort((a, b) => a.lastDraw - b.lastDraw);
  for (const e of due.slice(0, budget)) drawEntry(e, sim, t);
}

/** Force-draw one display now (dev harness). */
export function drawDisplayNow(id: string, sim: Sim, t: number): void {
  const e = entries.get(id);
  if (e?.def) drawEntry(e, sim, t);
}

function drawEntry(e: Entry, sim: Sim, t: number): void {
  const def = e.def!;
  const { ctx, canvas } = e;
  const dt = e.lastDraw < 0 ? 0 : t - e.lastDraw;
  e.lastDraw = t;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = def.background ?? '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    def.draw(ctx, sim, { t, dt, sincePowerOn: t - e.poweredSince, width: canvas.width, height: canvas.height });
  } catch (err) {
    console.error(`[display ${e.id}]`, err);
  }
  ctx.restore();
  e.texture.needsUpdate = true;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------------ */
/* Shared drawing helpers                                              */
/* ------------------------------------------------------------------ */

/** Airbus display colours (as rendered on the real DUs). */
export const DU = {
  green: '#00ff00',
  amber: '#ff9a00',
  cyan: '#00e5ff',
  magenta: '#ff34ff',
  white: '#ffffff',
  red: '#ff2020',
  yellow: '#ffff00',
  grey: '#6f6f6f',
  sky: '#1e8cff',
  ground: '#8a4a1c',
  black: '#000000',
};

/** Fonts (loaded in src/fonts.ts). B612 is the font Airbus designed for its cockpit displays. */
export const FONT = {
  du: 'B612',
  mono: '"B612 Mono"',
  panel: '"Barlow Semi Condensed"',
};

export function font(px: number, family: string = FONT.du, weight: number | string = 400): string {
  return `${weight} ${px}px ${family}`;
}

/**
 * Seven-segment digits for LCD/LED windows (FCU, RMP, clock, ADIRS, BAT, XPDR…).
 * Supports 0-9, A-F, H, L, N, P, S, U, -, space, '.', ':' and 'o' (degree-ish).
 * Draws `text` with its left edge at x, top at y, digit height h.
 */
export function drawSevenSeg(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number,
  color: string, opts: { ghost?: string; skew?: number; spacing?: number; thickness?: number } = {},
): number {
  const w = h * 0.52;
  const t = opts.thickness ?? h * 0.11;
  const gap = opts.spacing ?? h * 0.2;
  const skew = opts.skew ?? 0.08;
  const SEG: Record<string, string> = {
    '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc',
    '8': 'abcdefg', '9': 'abcdfg', A: 'abcefg', B: 'fgcde', C: 'afed', D: 'bcdeg', E: 'afged', F: 'afge', H: 'fbgec',
    L: 'fed', N: 'ceg', P: 'abfge', S: 'afgcd', U: 'fedcb', T: 'fged', R: 'eg', O: 'cdeg', '-': 'g', ' ': '', _: 'd', o: 'abfg',
  };
  let cx = x;
  const seg = (s: string, ox: number) => {
    const hh = h / 2;
    const P: Record<string, [number, number, number, number]> = {
      a: [t, 0, w - t, 0], d: [t, h, w - t, h], g: [t, hh, w - t, hh],
      f: [0, t, 0, hh - t], b: [w, t, w, hh - t], e: [0, hh + t, 0, h - t], c: [w, hh + t, w, h - t],
    };
    const [x1, y1, x2, y2] = P[s];
    const k = (yy: number) => (h - yy) * skew;
    ctx.beginPath();
    if (y1 === y2) {
      const yy = y + y1;
      ctx.moveTo(ox + x1 + k(y1), yy);
      ctx.lineTo(ox + x1 + t * 0.5 + k(y1), yy - t / 2);
      ctx.lineTo(ox + x2 - t * 0.5 + k(y1), yy - t / 2);
      ctx.lineTo(ox + x2 + k(y1), yy);
      ctx.lineTo(ox + x2 - t * 0.5 + k(y1), yy + t / 2);
      ctx.lineTo(ox + x1 + t * 0.5 + k(y1), yy + t / 2);
    } else {
      const xx = ox + x1;
      ctx.moveTo(xx + k(y1), y + y1);
      ctx.lineTo(xx + t / 2 + k(y1 + t * 0.5), y + y1 + t * 0.5);
      ctx.lineTo(xx + t / 2 + k(y2 - t * 0.5), y + y2 - t * 0.5);
      ctx.lineTo(xx + k(y2), y + y2);
      ctx.lineTo(xx - t / 2 + k(y2 - t * 0.5), y + y2 - t * 0.5);
      ctx.lineTo(xx - t / 2 + k(y1 + t * 0.5), y + y1 + t * 0.5);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (const chRaw of text) {
    const ch = chRaw === 'o' ? 'o' : chRaw.toUpperCase();
    if (ch === '.') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx - gap * 0.45, y + h - t / 2, t * 0.6, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    if (ch === ':') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx + t, y + h * 0.3, t * 0.55, 0, Math.PI * 2);
      ctx.arc(cx + t, y + h * 0.72, t * 0.55, 0, Math.PI * 2);
      ctx.fill();
      cx += t * 2 + gap * 0.5;
      continue;
    }
    if (opts.ghost) {
      ctx.fillStyle = opts.ghost;
      for (const s of 'abcdefg') seg(s, cx + t / 2);
    }
    ctx.fillStyle = color;
    for (const s of SEG[ch] ?? '') seg(s, cx + t / 2);
    cx += w + t + gap;
  }
  return cx - x;
}

/** Text helper with alignment. */
export function text(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, px: number,
  align: CanvasTextAlign = 'left', family: string = FONT.du, baseline: CanvasTextBaseline = 'alphabetic',
): void {
  ctx.font = font(px, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}
