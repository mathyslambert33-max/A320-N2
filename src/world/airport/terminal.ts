/**
 * Detailed terminal facades (world agent): the Hall A pier seen through the windshield, and the other terminal
 * volumes (Hall A main, Hall B, Billi). Two-level buildings like the real halls (arrivals on the ground floor,
 * departures upstairs): metal-clad ground floor, floor-slab band, recessed curtain wall with aluminium mullions,
 * roof fascia. The glass uses interior mapping (rooms with ceiling light rows behind the panes) plus the physical
 * reflection of the sky environment.
 */
import * as THREE from 'three';
import { paintedTexture } from '../mat/textures';
import { patchWorldMaterial } from '../env/worldMaterial';
import { rng } from '../env/sky';

export interface TerminalSpec {
  /** Top of the ground-floor cladding (m). */
  gf: number;
  /** Bottom / top of the glazed upper level. */
  glass0: number;
  glass1: number;
  /** Total height (top of the fascia). */
  height: number;
  /** Mullion spacing (m). */
  bay: number;
}

export const PIER_SPEC: TerminalSpec = { gf: 4.3, glass0: 5.0, glass1: 9.6, height: 10.6, bay: 1.5 };

interface Buf { pos: number[]; nrm: number[]; uv: number[]; ext: number[] }
const buf = (): Buf => ({ pos: [], nrm: [], uv: [], ext: [] });

function pushQuad(b: Buf, a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uv: number[], ext?: number[]) {
  // a,b,c,d counter-clockwise seen from the normal side
  for (const [p, k] of [[a, 0], [bb, 1], [c, 2], [a, 0], [c, 2], [d, 3]] as [THREE.Vector3, number][]) {
    b.pos.push(p.x, p.y, p.z);
    b.nrm.push(n.x, n.y, n.z);
    b.uv.push(uv[2 * k], uv[2 * k + 1]);
    if (ext) b.ext.push(...ext);
  }
}

/** Axis-aligned-in-facade box: along [u0,u1], height [y0,y1], depth [o0,o1] (outward offsets from the wall line). */
function box(b: Buf, p0: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, u0: number, u1: number, y0: number, y1: number, o0: number, o1: number) {
  const P = (u: number, y: number, o: number) => new THREE.Vector3(p0.x + t.x * u + n.x * o, y, p0.z + t.z * u + n.z * o);
  const up = new THREE.Vector3(0, 1, 0);
  const tm = t.clone().negate(), nm = n.clone().negate(), dn = up.clone().negate();
  const uvq = (w: number, h: number) => [0, 0, w, 0, w, h, 0, h];
  // front (outward)
  pushQuad(b, P(u0, y0, o1), P(u1, y0, o1), P(u1, y1, o1), P(u0, y1, o1), n, uvq(u1 - u0, y1 - y0));
  // top / bottom
  pushQuad(b, P(u0, y1, o1), P(u1, y1, o1), P(u1, y1, o0), P(u0, y1, o0), up, uvq(u1 - u0, o1 - o0));
  pushQuad(b, P(u0, y0, o0), P(u1, y0, o0), P(u1, y0, o1), P(u0, y0, o1), dn, uvq(u1 - u0, o1 - o0));
  // sides
  pushQuad(b, P(u1, y0, o1), P(u1, y0, o0), P(u1, y1, o0), P(u1, y1, o1), t, uvq(o1 - o0, y1 - y0));
  pushQuad(b, P(u0, y0, o0), P(u0, y0, o1), P(u0, y1, o1), P(u0, y1, o0), tm, uvq(o1 - o0, y1 - y0));
  void nm;
}

function geometry(b: Buf, extName?: string): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (extName && b.ext.length) g.setAttribute(extName, new THREE.Float32BufferAttribute(b.ext, 2));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------------------
// Materials

let glassMat: THREE.MeshStandardMaterial | null = null;
const glassUniforms = { wgNight: { value: 0 }, wgDay: { value: 1 } };

function claddingTexture() {
  return paintedTexture('terminal-clad', 256, 256, (g, w, h) => {
    // 1.5 m x 1.075 m panels over a 3 m x 4.3 m tile
    g.fillStyle = '#b9bcbd';
    g.fillRect(0, 0, w, h);
    const r = rng(12);
    const pw = w / 2, ph = h / 4;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      const v = 176 + r() * 16;
      g.fillStyle = `rgb(${v},${v + 3},${v + 5})`;
      g.fillRect(i * pw + 2, j * ph + 2, pw - 4, ph - 4);
    }
    g.fillStyle = 'rgba(40,44,48,0.8)';
    for (let i = 0; i <= 2; i++) g.fillRect(i * pw - 1, 0, 2, h);
    for (let j = 0; j <= 4; j++) g.fillRect(0, j * ph - 1, w, 2);
    // dirt at the base
    const grd = g.createLinearGradient(0, h, 0, h - 40);
    grd.addColorStop(0, 'rgba(60,55,45,0.45)');
    grd.addColorStop(1, 'rgba(60,55,45,0)');
    g.fillStyle = grd;
    g.fillRect(0, h - 40, w, 40);
  });
}

function makeGlass(): THREE.MeshStandardMaterial {
  if (glassMat) return glassMat;
  const m = new THREE.MeshStandardMaterial({ color: 0x5d6b78, roughness: 0.06, metalness: 0.32, name: 'terminal-glass' });
  patchWorldMaterial(m, {
    key: 'glass',
    extra: (shader) => {
      Object.assign(shader.uniforms, glassUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aWallT;\nvarying vec2 vGUv;\nvarying vec3 vWallT;\nvarying vec3 vWallN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGUv = uv;\nvWallT = vec3( aWallT.x, 0.0, aWallT.y );\nvWallN = normalize( ( modelMatrix * vec4( objectNormal, 0.0 ) ).xyz );');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vGUv;
          varying vec3 vWallT;
          varying vec3 vWallN;
          uniform float wgNight;
          uniform float wgDay;
          float gh( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
          vec3 interior() {
            vec3 V = normalize( vWlPos - cameraPosition );
            vec3 d = vec3( dot( V, vWallT ), V.y, -dot( V, vWallN ) );
            d.z = max( d.z, 0.02 );
            const float W = 6.0, H = 4.4, D = 9.0;
            float cell = floor( vGUv.x / W );
            vec3 p = vec3( mod( vGUv.x, W ), clamp( vGUv.y, 0.05, H - 0.05 ), 0.0 );
            float tB = ( D - p.z ) / d.z;
            float tX = d.x > 0.0 ? ( W - p.x ) / d.x : ( d.x < 0.0 ? -p.x / d.x : 1e9 );
            float tY = d.y > 0.0 ? ( H - p.y ) / d.y : ( d.y < 0.0 ? -p.y / d.y : 1e9 );
            float t = min( tB, min( tX, tY ) );
            vec3 h = p + d * t;
            float rnd = gh( vec2( cell, 3.0 ) );
            vec3 c;
            float lightLevel = mix( 0.10, 0.34, wgNight ) * ( 0.8 + 0.4 * rnd );
            if ( t == tY && d.y > 0.0 ) {
              // ceiling with rows of recessed LED panels
              float panel = step( fract( h.x / 1.5 ), 0.55 ) * step( fract( h.z / 2.4 + 0.2 ), 0.28 );
              c = vec3( 0.55, 0.56, 0.57 ) * lightLevel + panel * vec3( 1.0, 0.97, 0.9 ) * mix( 0.35, 1.6, wgNight );
            } else if ( t == tY ) {
              // floor: carpet + rows of gate seats near the glazing
              float seats = step( 1.2, h.z ) * step( h.z, 3.6 ) * step( 0.25, fract( h.z / 1.2 ) ) * step( 0.1, fract( h.x / 0.6 ) );
              c = mix( vec3( 0.20, 0.21, 0.24 ), vec3( 0.08, 0.09, 0.1 ), seats ) * lightLevel * 2.2;
            } else if ( t == tX ) {
              c = vec3( 0.62, 0.62, 0.6 ) * lightLevel * 1.6;
            } else {
              // back wall: shops / signage / far glazing
              float band = step( 2.6, h.y ) * step( h.y, 3.2 );
              vec3 sign = mix( vec3( 0.1, 0.25, 0.55 ), vec3( 0.9, 0.75, 0.2 ), step( 0.6, rnd ) );
              c = mix( vec3( 0.55, 0.53, 0.5 ) * lightLevel * 1.8, sign * mix( 0.25, 0.9, wgNight ), band * step( 0.35, rnd ) );
              c += vec3( 0.45, 0.55, 0.65 ) * wgDay * 0.18 * step( h.y, 2.5 ) * step( 0.5, fract( h.x / 3.0 ) );
            }
            c *= exp( -t * 0.035 );
            return c;
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += interior() * 0.62;');
    },
  });
  glassMat = m;
  return m;
}

export function setTerminalNight(k: number) {
  glassUniforms.wgNight.value = k;
  glassUniforms.wgDay.value = 1 - k;
}

// ---------------------------------------------------------------------------------------------------------

export interface TerminalBuild {
  group: THREE.Group;
}

/**
 * Build a two-level terminal volume from a footprint ring (world XZ, flat [x0,z0,...]). `holes` are courtyards.
 */
export function buildTerminal(rings: number[][], spec: TerminalSpec, name: string): TerminalBuild {
  const clad = buf(), fascia = buf(), mull = buf(), glass = buf(), roof = buf();
  const up = new THREE.Vector3(0, 1, 0);
  for (const ring of rings) {
    const n = ring.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
    }
    const sgn = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p0 = new THREE.Vector3(ring[2 * i], 0, ring[2 * i + 1]);
      const p1 = new THREE.Vector3(ring[2 * j], 0, ring[2 * j + 1]);
      const L = p0.distanceTo(p1);
      if (L < 0.3) continue;
      const t = p1.clone().sub(p0).divideScalar(L);
      const nrm = new THREE.Vector3(t.z * sgn, 0, -t.x * sgn);
      const P = (u: number, y: number, o = 0) => new THREE.Vector3(p0.x + t.x * u + nrm.x * o, y, p0.z + t.z * u + nrm.z * o);
      // ground floor cladding (3 m x 4.3 m texture tile)
      pushQuad(clad, P(0, 0), P(L, 0), P(L, spec.gf), P(0, spec.gf), nrm, [0, 0, L / 3, 0, L / 3, 1, 0, 1]);
      // slab band + its soffit, protruding 0.18 m
      box(fascia, p0, t, nrm, 0, L, spec.gf, spec.glass0, -0.05, 0.18);
      // roof fascia protruding 0.35 m
      box(fascia, p0, t, nrm, 0, L, spec.glass1, spec.height, -0.05, 0.35);
      // recessed glass
      if (L > 1.0) {
        pushQuad(glass, P(0, spec.glass0, -0.12), P(L, spec.glass0, -0.12), P(L, spec.glass1, -0.12), P(0, spec.glass1, -0.12), nrm,
          [0, 0, L, 0, L, spec.glass1 - spec.glass0, 0, spec.glass1 - spec.glass0], [t.x, t.z]);
        // mullions every bay, transoms
        const nb = Math.max(1, Math.round(L / spec.bay));
        const bw = L / nb;
        for (let k = 0; k <= nb; k++) box(mull, p0, t, nrm, k * bw - 0.04, k * bw + 0.04, spec.glass0, spec.glass1, -0.12, 0.06);
        for (const y of [spec.glass0 + 0.06, spec.glass0 + 2.35, spec.glass1 - 0.06]) box(mull, p0, t, nrm, 0, L, y - 0.05, y + 0.05, -0.12, 0.05);
      } else {
        box(fascia, p0, t, nrm, 0, L, spec.glass0, spec.glass1, -0.12, 0.0);
      }
    }
  }
  // roof
  const toV = (flat: number[]) => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  const contour = toV(rings[0]);
  const holes = rings.slice(1).map(toV);
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const h of holes) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  const all = contour.concat(...holes);
  for (const tr of tris) {
    for (const k of [tr[0], tr[2], tr[1]]) {
      const v = all[k];
      roof.pos.push(v.x, spec.height - 0.25, v.y);
      roof.nrm.push(0, 1, 0);
      roof.uv.push(v.x / 8, v.y / 8);
    }
  }
  void up;

  const group = new THREE.Group();
  group.name = `terminal-${name}`;
  const cladTex = claddingTexture();
  const mats = {
    clad: patchWorldMaterial(new THREE.MeshStandardMaterial({ map: cladTex, roughness: 0.55, metalness: 0.25, name: 'terminal-clad' })),
    fascia: patchWorldMaterial(new THREE.MeshStandardMaterial({ color: 0xd9dbdc, roughness: 0.45, metalness: 0.15, name: 'terminal-fascia' })),
    mull: patchWorldMaterial(new THREE.MeshStandardMaterial({ color: 0x9da3a8, roughness: 0.35, metalness: 0.75, name: 'terminal-mullion' })),
    roof: patchWorldMaterial(new THREE.MeshStandardMaterial({ color: 0x8e8d88, roughness: 0.95, name: 'terminal-roof' })),
  };
  const add = (b: Buf, m: THREE.Material, nm: string, ext?: string) => {
    if (!b.pos.length) return;
    const mesh = new THREE.Mesh(geometry(b, ext), m);
    mesh.name = `${name}-${nm}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(clad, mats.clad, 'clad');
  add(fascia, mats.fascia, 'fascia');
  add(mull, mats.mull, 'mullions');
  add(glass, makeGlass(), 'glass', 'aWallT');
  add(roof, mats.roof, 'roof');
  return { group };
}
