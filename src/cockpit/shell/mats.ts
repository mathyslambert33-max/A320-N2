/**
 * Shell materials (shared, created once) and small tileable procedural textures (no binary assets).
 * Colours after A320 flight-deck references: light-grey textured linings, blue-grey panels (kit paint),
 * dark anti-glare/overhead surround, dark blue-grey carpet, sheepskin seat covers over dark fabric.
 */
import * as THREE from 'three';

function valueNoise(N: number, octaves: number, base: number, seed: number): Float32Array {
  const h = new Float32Array(N * N);
  const rnd = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let oct = 0, amp = 1, f = base; oct < octaves; oct++, amp *= 0.5, f *= 2) {
    const cell = N / f;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = rnd(gx % f, gy % f), b = rnd((gx + 1) % f, gy % f), c = rnd(gx % f, (gy + 1) % f), d = rnd((gx + 1) % f, (gy + 1) % f);
      h[y * N + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
  }
  return h;
}

function heightToNormal(h: Float32Array, N: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    const nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    data[i] = ((nx / l) * 0.5 + 0.5) * 255;
    data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Colour texture from a height field (value → lerp(c0, c1)). */
function heightToColor(h: Float32Array, N: number, c0: THREE.Color, c1: THREE.Color, lo: number, hi: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const c = new THREE.Color();
  for (let i = 0; i < N * N; i++) {
    const t = Math.min(1, Math.max(0, (h[i] - lo) / (hi - lo)));
    c.copy(c0).lerp(c1, t);
    // store in sRGB
    const s = c.clone().convertLinearToSRGB();
    data[i * 4] = s.r * 255; data[i * 4 + 1] = s.g * 255; data[i * 4 + 2] = s.b * 255; data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export interface ShellMats {
  lining: THREE.MeshStandardMaterial;
  liningDark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  carpet: THREE.MeshStandardMaterial;
  floorPlate: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  glassSide: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  seatFabric: THREE.MeshStandardMaterial;
  sheepskin: THREE.MeshPhysicalMaterial;
  leather: THREE.MeshStandardMaterial;
  webbing: THREE.MeshStandardMaterial;
  seatMetal: THREE.MeshStandardMaterial;
  rubberBoot: THREE.MeshStandardMaterial;
  gripBlack: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  yellow: THREE.MeshStandardMaterial;
  orange: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  placard: THREE.MeshStandardMaterial;
  lampLens: THREE.MeshStandardMaterial;
  wiper: THREE.MeshStandardMaterial;
  doorLining: THREE.MeshStandardMaterial;
  galley: THREE.MeshStandardMaterial;
  cabinWall: THREE.MeshStandardMaterial;
  grille: THREE.MeshStandardMaterial;
  fireRed: THREE.MeshStandardMaterial;
  bottleGreen: THREE.MeshStandardMaterial;
}

let _m: ShellMats | null = null;

/**
 * Glass: black base (no diffuse), physically based Fresnel reflections of the environment/sun, and a
 * small opacity that darkens what is seen through it. Premultiplied blending without the premultiply
 * step, so reflections are added at full strength (src + dst·(1 − a)) instead of being scaled by opacity.
 */
function glassMaterial(opacity: number, tint: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.04, metalness: 0, transparent: true, opacity, premultipliedAlpha: true,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.0,
  });
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'shell-glass-v1';
  return m;
}

export function shellMats(): ShellMats {
  if (_m) return _m;
  const N = 256;
  // Linings: fine pebbled plastic.
  const pebble = heightToNormal(valueNoise(N, 3, 32, 1), N, 3.0);
  pebble.repeat.set(9, 9);
  // Carpet: dense fibre noise + a faint loop pattern.
  const carpetH = valueNoise(N, 3, 64, 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) carpetH[y * N + x] += 0.25 * Math.sin((x / N) * Math.PI * 2 * 48) * Math.sin((y / N) * Math.PI * 2 * 48);
  const carpetN = heightToNormal(carpetH, N, 4.0);
  const carpetC = heightToColor(carpetH, N, new THREE.Color(0x1f2327), new THREE.Color(0x3a4047), 0.4, 1.9);
  carpetN.repeat.set(3, 3); carpetC.repeat.set(3, 3);
  // Fabric: weave.
  const weave = new Float32Array(N * N);
  const fabN0 = valueNoise(N, 2, 64, 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const a = Math.sin((x / N) * Math.PI * 2 * 64), b = Math.sin((y / N) * Math.PI * 2 * 64);
    weave[y * N + x] = 0.5 * (a > 0 ? a * (b > 0 ? 1 : 0.4) : b * 0.6) + 0.35 * fabN0[y * N + x];
  }
  const fabricN = heightToNormal(weave, N, 2.0);
  fabricN.repeat.set(5, 5);
  // Sheepskin: tufts (random soft clumps with a curl) over a low-frequency base.
  const woolH = valueNoise(N, 2, 8, 4);
  for (let i = 0; i < woolH.length; i++) woolH[i] *= 0.35;
  {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let t = 0; t < 2600; t++) {
      const cx = rnd() * N, cy = rnd() * N, r = 2.5 + rnd() * 5.5, hgt = 0.5 + rnd() * 0.6, ang = rnd() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const R = Math.ceil(r * 1.6);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        // elongated clump (fibre direction ang)
        const u = (dx * ca + dy * sa) / (r * 1.5), v = (-dx * sa + dy * ca) / r;
        const d2 = u * u + v * v;
        if (d2 > 1) continue;
        const x = (Math.floor(cx) + dx + N) % N, y = (Math.floor(cy) + dy + N) % N;
        const k = y * N + x;
        woolH[k] = Math.max(woolH[k], woolH[k] * 0.3 + hgt * (1 - d2) * (1 - d2));
      }
    }
  }
  const woolN = heightToNormal(woolH, N, 5.0);
  const woolC = heightToColor(woolH, N, new THREE.Color(0x9a8f7c), new THREE.Color(0xe9e1d0), 0.15, 1.05);
  woolN.repeat.set(5, 5); woolC.repeat.set(5, 5);
  // Grille: perforations.
  const perfH = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = ((x / N) * 16) % 1 - 0.5, fy = ((y / N) * 16) % 1 - 0.5;
    perfH[y * N + x] = Math.hypot(fx, fy) < 0.28 ? 0 : 1;
  }
  const perfC = heightToColor(perfH, N, new THREE.Color(0x050505), new THREE.Color(0x3a3f45), 0, 1);

  const std = (p: THREE.MeshStandardMaterialParameters, name: string) => {
    const m = new THREE.MeshStandardMaterial(p);
    m.name = name;
    return m;
  };
  _m = {
    lining: std({ color: 0x9199a0, roughness: 0.72, metalness: 0, normalMap: pebble, normalScale: new THREE.Vector2(0.12, 0.12) }, 'lining'),
    liningDark: std({ color: 0x4d5359, roughness: 0.75, metalness: 0, normalMap: pebble, normalScale: new THREE.Vector2(0.12, 0.12) }, 'liningDark'),
    trim: std({ color: 0x2b2f33, roughness: 0.55, metalness: 0.2 }, 'trim'),
    carpet: std({ color: 0xffffff, map: carpetC, roughness: 0.97, metalness: 0, normalMap: carpetN, normalScale: new THREE.Vector2(0.8, 0.8) }, 'carpet'),
    floorPlate: std({ color: 0x3b3f44, roughness: 0.5, metalness: 0.6 }, 'floorPlate'),
    rail: std({ color: 0xa4a8ac, roughness: 0.35, metalness: 0.9 }, 'rail'),
    glass: glassMaterial(0.07, 0x000000),
    glassSide: glassMaterial(0.09, 0x000000),
    visor: std({ color: 0x0c1410, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }, 'visor'),
    seatFabric: std({ color: 0x323946, roughness: 0.92, metalness: 0, normalMap: fabricN, normalScale: new THREE.Vector2(0.6, 0.6) }, 'seatFabric'),
    sheepskin: (() => {
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: woolC, roughness: 1.0, metalness: 0, normalMap: woolN, normalScale: new THREE.Vector2(1.0, 1.0),
        sheen: 1.0, sheenColor: new THREE.Color(0xf4ecdc), sheenRoughness: 0.75,
      });
      m.name = 'sheepskin';
      return m;
    })(),
    leather: std({ color: 0x1d2024, roughness: 0.55, metalness: 0, normalMap: pebble, normalScale: new THREE.Vector2(0.25, 0.25) }, 'leather'),
    webbing: std({ color: 0x2e3440, roughness: 0.85, metalness: 0, normalMap: fabricN, normalScale: new THREE.Vector2(0.8, 0.8) }, 'webbing'),
    seatMetal: std({ color: 0x2c3035, roughness: 0.45, metalness: 0.55 }, 'seatMetal'),
    rubberBoot: std({ color: 0x151618, roughness: 0.75, metalness: 0 }, 'rubberBoot'),
    gripBlack: std({ color: 0x151618, roughness: 0.5, metalness: 0, normalMap: pebble, normalScale: new THREE.Vector2(0.06, 0.06) }, 'gripBlack'),
    red: std({ color: 0xb3130f, roughness: 0.35, metalness: 0 }, 'red'),
    yellow: std({ color: 0xf0c020, roughness: 0.5, metalness: 0 }, 'yellow'),
    orange: std({ color: 0xd9601a, roughness: 0.7, metalness: 0 }, 'orange'),
    white: std({ color: 0xe8e8e4, roughness: 0.5, metalness: 0 }, 'white'),
    placard: std({ color: 0xd8d8d0, roughness: 0.6, metalness: 0 }, 'placard'),
    lampLens: std({ color: 0xfff4e0, roughness: 0.3, metalness: 0, emissive: new THREE.Color(1.0, 0.86, 0.66), emissiveIntensity: 0 }, 'lampLens'),
    wiper: std({ color: 0x1a1c1e, roughness: 0.45, metalness: 0.4 }, 'wiper'),
    doorLining: std({ color: 0x8e949a, roughness: 0.7, metalness: 0.05, normalMap: pebble, normalScale: new THREE.Vector2(0.3, 0.3) }, 'doorLining'),
    galley: std({ color: 0xb9bcbf, roughness: 0.32, metalness: 0.8 }, 'galley'),
    cabinWall: std({ color: 0xd7d8d4, roughness: 0.7, metalness: 0, normalMap: pebble, normalScale: new THREE.Vector2(0.25, 0.25) }, 'cabinWall'),
    grille: std({ color: 0xffffff, map: perfC, roughness: 0.6, metalness: 0.3 }, 'grille'),
    fireRed: std({ color: 0xc0150e, roughness: 0.3, metalness: 0.1 }, 'fireRed'),
    bottleGreen: std({ color: 0x2f6b3a, roughness: 0.35, metalness: 0.2 }, 'bottleGreen'),
  };
  _m.glass.name = 'glass';
  _m.glassSide.name = 'glassSide';
  return _m;
}
