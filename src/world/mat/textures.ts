/**
 * Procedural textures (world agent): generated once with Canvas 2D / ImageData, cached.
 */
import * as THREE from 'three';
import { rng } from '../env/sky';

const cache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export function setMaxAnisotropy(n: number) {
  maxAniso = n;
}

function canvas(w: number, h: number): [HTMLCanvasElement | OffscreenCanvas, CanvasRenderingContext2D] {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h);
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function toTexture(c: HTMLCanvasElement | OffscreenCanvas, srgb = true, repeat = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise grid (period `p` cells) sampled at [0,1)². */
function tileNoise(seed: number, p: number) {
  const r = rng(seed);
  const g = new Float32Array(p * p);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (u: number, v: number) => {
    const x = u * p, y = v * p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % p) + p) % p, j0 = ((yi % p) + p) % p;
    const i1 = (i0 + 1) % p, j1 = (j0 + 1) % p;
    const a = g[j0 * p + i0], b = g[j0 * p + i1], c = g[j1 * p + i0], d = g[j1 * p + i1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbmTile(seed: number, base: number, oct: number) {
  const ns = Array.from({ length: oct }, (_, i) => tileNoise(seed + i * 101, base << i));
  return (u: number, v: number) => {
    let s = 0, a = 0.5, n = 0;
    for (const f of ns) { s += a * f(u, v); n += a; a *= 0.5; }
    return s / n;
  };
}

/** Asphalt: 1024² texture covering 8 m. */
export function asphaltTexture(): THREE.Texture {
  const key = 'asphalt';
  if (cache.has(key)) return cache.get(key)!;
  const N = 1024;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const big = fbmTile(11, 4, 4);
  const mid = fbmTile(23, 32, 3);
  const r = rng(7);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      let l = 0.24 + (big(u, v) - 0.5) * 0.07 + (mid(u, v) - 0.5) * 0.06;
      const k = r();
      if (k < 0.08) l += 0.10 * r(); // light aggregate
      else if (k < 0.16) l -= 0.06 * r();
      const i = (y * N + x) * 4;
      const val = Math.max(0, Math.min(1, l));
      img.data[i] = val * 255 * 0.98;
      img.data[i + 1] = val * 255 * 0.98;
      img.data[i + 2] = val * 255 * 1.0;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // crack sealant ("tar snakes"): thin dark wavy lines
  g.strokeStyle = 'rgba(12,12,12,0.55)';
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    g.lineWidth = 1.5 + r() * 2.5;
    g.beginPath();
    let x = r() * N, y = r() * N, a = r() * Math.PI * 2;
    g.moveTo(x, y);
    for (let s = 0; s < 40; s++) {
      a += (r() - 0.5) * 0.6;
      x += Math.cos(a) * 12; y += Math.sin(a) * 12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // oil / rubber stains
  for (let i = 0; i < 10; i++) {
    const x = r() * N, y = r() * N, rad = 10 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(8,8,8,${0.15 + r() * 0.25})`);
    grd.addColorStop(1, 'rgba(8,8,8,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}

/** Concrete apron slabs: 1024² texture covering 2 × 2 slabs of 5 m (10 m). */
export function concreteTexture(): THREE.Texture {
  const key = 'concrete';
  if (cache.has(key)) return cache.get(key)!;
  const N = 1024;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const big = fbmTile(31, 4, 4);
  const mid = fbmTile(37, 24, 3);
  const r = rng(9);
  const slabTone = [0.0, 0.035, -0.03, 0.02];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const s = (x < N / 2 ? 0 : 1) + (y < N / 2 ? 0 : 2);
      let l = 0.60 + slabTone[s] + (big(u, v) - 0.5) * 0.10 + (mid(u, v) - 0.5) * 0.07;
      const k = r();
      if (k < 0.06) l += 0.05 * r();
      else if (k < 0.14) l -= 0.06 * r();
      const i = (y * N + x) * 4;
      const val = Math.max(0, Math.min(1, l));
      img.data[i] = val * 255 * 1.0;
      img.data[i + 1] = val * 255 * 0.985;
      img.data[i + 2] = val * 255 * 0.95;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // stains (fuel, hydraulic, rubber)
  for (let i = 0; i < 16; i++) {
    const x = r() * N, y = r() * N, rad = 8 + r() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(40,38,34,${0.12 + r() * 0.2})`);
    grd.addColorStop(1, 'rgba(40,38,34,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // joints with black sealant (on slab edges: 0, N/2)
  g.fillStyle = 'rgba(25,24,22,0.95)';
  const jw = 3;
  for (const p of [0, N / 2]) {
    g.fillRect(p - jw / 2, 0, jw, N);
    g.fillRect(0, p - jw / 2, N, jw);
  }
  g.fillRect(N - jw / 2, 0, jw, N);
  g.fillRect(0, N - jw / 2, N, jw);
  // hairline cracks
  g.strokeStyle = 'rgba(40,38,35,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = r() * N, y = r() * N;
    g.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}

/** Grass: 512² covering 6 m (late-September Bordeaux: green with dry yellow patches). */
export function grassTexture(): THREE.Texture {
  const key = 'grass';
  if (cache.has(key)) return cache.get(key)!;
  const N = 512;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const big = fbmTile(51, 4, 4);
  const fine = fbmTile(53, 64, 2);
  const r = rng(5);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const dry = Math.max(0, Math.min(1, (big(u, v) - 0.45) * 2.5));
      const f = fine(u, v) - 0.5;
      const k = r() - 0.5;
      const gr = [0.20 + f * 0.08 + k * 0.08, 0.30 + f * 0.1 + k * 0.1, 0.10 + k * 0.04];
      const dr = [0.42 + f * 0.08 + k * 0.1, 0.38 + f * 0.08 + k * 0.08, 0.20 + k * 0.05];
      const i = (y * N + x) * 4;
      for (let ch = 0; ch < 3; ch++) img.data[i + ch] = Math.max(0, Math.min(1, gr[ch] + (dr[ch] - gr[ch]) * dry * 0.55)) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c);
  cache.set(key, t);
  return t;
}

/** Large-scale grey noise (tileable, linear) used to break texture repetition. */
export function macroNoiseTexture(): THREE.Texture {
  const key = 'macro';
  if (cache.has(key)) return cache.get(key)!;
  const N = 256;
  const [c, g] = canvas(N, N);
  const img = g.createImageData(N, N);
  const f = fbmTile(71, 4, 5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const v = f(x / N, y / N) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = toTexture(c, false);
  cache.set(key, t);
  return t;
}

/** Text / sign texture (canvas), e.g. stand numbers painted on the ground. */
export function textTexture(text: string, opts: { w?: number; h?: number; color?: string; bg?: string; font?: string; border?: string } = {}): THREE.Texture {
  const key = `text:${text}:${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key)!;
  const w = opts.w ?? 512, h = opts.h ?? 256;
  const [c, g] = canvas(w, h);
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  g.fillStyle = opts.color ?? '#ffffff';
  g.font = opts.font ?? `bold ${Math.round(h * 0.8)}px "Barlow Semi Condensed", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (opts.border) { g.lineWidth = h * 0.08; g.strokeStyle = opts.border; g.strokeText(text, w / 2, h / 2 + h * 0.04); }
  g.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = toTexture(c, true, false);
  cache.set(key, t);
  return t;
}

/** Draw into a new canvas texture with a custom painter. */
export function paintedTexture(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true, repeat = true): THREE.Texture {
  if (cache.has(key)) return cache.get(key)!;
  const [c, g] = canvas(w, h);
  paint(g, w, h);
  const t = toTexture(c, srgb, repeat);
  cache.set(key, t);
  return t;
}
