/**
 * Shared PBR materials and procedural textures for the cockpit hardware.
 */
import * as THREE from 'three';

export type LightZone = 'ovhd' | 'main' | 'glare' | 'ped' | 'none';

/** Shared uniforms: panel back-lighting level per zone (0..1), set every frame by the kit. */
export const ZONE_UNIFORMS: Record<LightZone, { value: number }> = {
  ovhd: { value: 0 },
  main: { value: 0 },
  glare: { value: 0 },
  ped: { value: 0 },
  none: { value: 0 },
};

/** Colour of the Airbus integral (back) lighting of engravings. */
export const BACKLIGHT_COLOR = new THREE.Color(1.0, 0.9, 0.72);

/** Airbus annunciator colours (linear, for emissive). */
export const LIGHT_COLORS: Record<string, THREE.Color> = {
  W: new THREE.Color(1.0, 0.97, 0.9),
  A: new THREE.Color(1.0, 0.45, 0.0),
  G: new THREE.Color(0.1, 1.0, 0.25),
  B: new THREE.Color(0.0, 0.62, 1.0),
  R: new THREE.Color(1.0, 0.05, 0.03),
};

let _noiseTex: THREE.DataTexture | null = null;
/** Tileable fine "orange peel" normal map for painted metal panels. */
export function paintNormalMap(): THREE.DataTexture {
  if (_noiseTex) return _noiseTex;
  const N = 256;
  const h = new Float32Array(N * N);
  // value noise, few octaves, tileable
  const rnd = (x: number, y: number) => {
    const s = Math.sin((x % N) * 127.1 + (y % N) * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let oct = 0, amp = 1, f = 8; oct < 4; oct++, amp *= 0.5, f *= 2) {
    const cell = N / f;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = rnd(gx % f, gy % f), b = rnd((gx + 1) % f, gy % f), c = rnd(gx % f, (gy + 1) % f), d = rnd((gx + 1) % f, (gy + 1) % f);
      h[y * N + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x - 1 + N) % N)];
    const dy = h[((y + 1) % N) * N + x] - h[((y - 1 + N) % N) * N + x];
    const nx = -dx * 2, ny = -dy * 2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const i = (y * N + x) * 4;
    data[i] = ((nx / l) * 0.5 + 0.5) * 255;
    data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  _noiseTex = t;
  return t;
}

let _knurl: THREE.DataTexture | null = null;
/** Vertical knurling normal map for knob sides (u around, v height). */
export function knurlNormalMap(): THREE.DataTexture {
  if (_knurl) return _knurl;
  const W = 256, H = 8;
  const data = new Uint8Array(W * H * 4);
  for (let x = 0; x < W; x++) {
    const p = (x / W) * 64 * Math.PI * 2; // 64 ridges around
    const nx = Math.cos(p) * 0.6;
    const l = Math.hypot(nx, 1);
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = 128;
      data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  _knurl = t;
  return t;
}

export interface Materials {
  /** Airbus panel paint (blue-grey). */
  paint: THREE.MeshStandardMaterial;
  /** Darker structural grey (glareshield, pedestal sides). */
  paintDark: THREE.MeshStandardMaterial;
  /** Near-black anti-glare (glareshield top). */
  antiGlare: THREE.MeshStandardMaterial;
  /** Black plastic knobs. */
  knob: THREE.MeshStandardMaterial;
  /** Knurled knob sides. */
  knobKnurl: THREE.MeshStandardMaterial;
  /** Medium-grey knob (some Airbus knobs are grey). */
  knobGrey: THREE.MeshStandardMaterial;
  /** White index lines/pointers. */
  white: THREE.MeshStandardMaterial;
  /** Pushbutton bezel (dark grey metal). */
  bezel: THREE.MeshStandardMaterial;
  /** Pushbutton cap body. */
  cap: THREE.MeshPhysicalMaterial;
  /** Chrome/aluminium (toggle levers). */
  chrome: THREE.MeshStandardMaterial;
  /** Brushed aluminium. */
  alu: THREE.MeshStandardMaterial;
  /** Dark metal (screws, nuts). */
  darkMetal: THREE.MeshStandardMaterial;
  /** Rubber / soft plastic (keys). */
  rubber: THREE.MeshStandardMaterial;
  keyCap: THREE.MeshStandardMaterial;
  /** Guards. */
  guardRed: THREE.MeshPhysicalMaterial;
  guardBlack: THREE.MeshStandardMaterial;
  guardClear: THREE.MeshPhysicalMaterial;
  /** Screen glass (in front of displays). */
  screenGlass: THREE.MeshPhysicalMaterial;
  /** Matte black (screen surround, recesses). */
  black: THREE.MeshStandardMaterial;
  /** Dark window for 7-segment LCDs when off. */
  lcdBlack: THREE.MeshStandardMaterial;
}

let _mats: Materials | null = null;

export function materials(): Materials {
  if (_mats) return _mats;
  const nrm = paintNormalMap();
  const knurl = knurlNormalMap();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  _mats = {
    paint: std({ color: 0x4d5a66, roughness: 0.62, metalness: 0.05, normalMap: nrm, normalScale: new THREE.Vector2(0.18, 0.18) }),
    paintDark: std({ color: 0x33393f, roughness: 0.7, metalness: 0.05, normalMap: nrm, normalScale: new THREE.Vector2(0.15, 0.15) }),
    antiGlare: std({ color: 0x1b1d1f, roughness: 0.92, metalness: 0 }),
    knob: std({ color: 0x17191b, roughness: 0.42, metalness: 0.0 }),
    knobKnurl: std({ color: 0x17191b, roughness: 0.5, metalness: 0.0, normalMap: knurl, normalScale: new THREE.Vector2(1, 1) }),
    knobGrey: std({ color: 0x53585d, roughness: 0.45, metalness: 0.1 }),
    white: std({ color: 0xf2f2ee, roughness: 0.5, metalness: 0 }),
    bezel: std({ color: 0x1e2124, roughness: 0.62, metalness: 0.15 }),
    cap: new THREE.MeshPhysicalMaterial({ color: 0x0b0c0d, roughness: 0.48, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.4 }),
    chrome: std({ color: 0xa9abad, roughness: 0.32, metalness: 1.0 }),
    alu: std({ color: 0xb8bbbe, roughness: 0.38, metalness: 0.9 }),
    darkMetal: std({ color: 0x2e3134, roughness: 0.5, metalness: 0.6 }),
    rubber: std({ color: 0x2a2c2e, roughness: 0.85, metalness: 0 }),
    keyCap: std({ color: 0x3a3e42, roughness: 0.6, metalness: 0 }),
    guardRed: new THREE.MeshPhysicalMaterial({ color: 0xb01010, roughness: 0.35, metalness: 0, clearcoat: 0.4 }),
    guardBlack: std({ color: 0x141516, roughness: 0.4, metalness: 0 }),
    guardClear: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, depthWrite: false }),
    screenGlass: new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.08, clearcoat: 1, clearcoatRoughness: 0.15, depthWrite: false }),
    black: std({ color: 0x050505, roughness: 0.8, metalness: 0 }),
    lcdBlack: std({ color: 0x0a0c0b, roughness: 0.3, metalness: 0 }),
  };
  return _mats;
}

/**
 * Patch a MeshStandardMaterial so it shows engraved/back-lit labels from a single-channel mask texture:
 * diffuse → label colour where mask = 1, and emissive glow = mask × zone backlight.
 */
export function makeLabelMaterial(base: THREE.MeshStandardMaterial, mask: THREE.Texture, zone: LightZone, labelColor = new THREE.Color(0.92, 0.92, 0.9)): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.defines = { ...(m.defines ?? {}), USE_UV: '' };
  const uniforms = {
    labelMap: { value: mask },
    labelColor: { value: labelColor },
    backlight: ZONE_UNIFORMS[zone],
    backlightColor: { value: BACKLIGHT_COLOR },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D labelMap; uniform vec3 labelColor; uniform float backlight; uniform vec3 backlightColor;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float lblMask = texture2D(labelMap, vUv).r;
diffuseColor.rgb = mix(diffuseColor.rgb, labelColor, lblMask);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += backlightColor * (backlight * 2.2) * lblMask;`)
      // engravings are slightly glossier than the paint
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.45, lblMask);`);
  };
  m.customProgramCacheKey = () => 'label-mat-v1';
  (m as any).userData.labelUniforms = uniforms;
  return m;
}
