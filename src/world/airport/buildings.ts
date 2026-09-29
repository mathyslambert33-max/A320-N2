/**
 * Buildings (world agent): extruded OpenStreetMap footprints (Overture 2026-09) with procedural facades, merged per
 * facade type (one draw call per material). Night: lit windows through an emissive map scaled by `setNight`.
 */
import * as THREE from 'three';
import { decodePolys } from '../data/decode';
import * as LFBD from '../data/lfbd';
import { dataToWorldXZ, type StandDef } from '../geo';
import { paintedTexture } from '../mat/textures';
import { patchWorldMaterial } from '../env/worldMaterial';
import { rng } from '../env/sky';

export const enum BCls { Generic, House, Apart, Indus, Hangar, Office, Terminal, Pier, Tower, Parking, Canopy, Service }

type FacadeKind = 'glass' | 'office' | 'indus' | 'house' | 'apart' | 'hangar' | 'parking';

/** Facade texture: width (m) x height (m) of one tile. */
const FACADE_TILE: Record<FacadeKind, [number, number]> = {
  glass: [6, 7], office: [6, 7], indus: [8, 8], house: [6, 6], apart: [6, 6], hangar: [12, 12], parking: [8, 6],
};

function facadeTextures(kind: FacadeKind): { map: THREE.Texture; emissive: THREE.Texture } {
  const W = 256, H = 256;
  const [tw, th] = FACADE_TILE[kind];
  const pxm = W / tw, pym = H / th;
  const r = rng(kind.length * 977 + 13);
  const lit: [number, number, number, number][] = [];
  const map = paintedTexture(`facade-${kind}`, W, H, (g) => {
    const rect = (x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(x * pxm, H - (y + h) * pym, w * pxm, h * pym); };
    switch (kind) {
      case 'glass': {
        rect(0, 0, tw, th, '#2d3a44');
        // 1.5 m x 1.75 m panes with reflections variation, light grey mullions
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          const v = 38 + Math.floor(r() * 18);
          rect(i * 1.5 + 0.05, j * 1.75 + 0.05, 1.4, 1.65, `rgb(${v - 6},${v + 6},${v + 14})`);
          lit.push([i * 1.5 + 0.05, j * 1.75 + 0.05, 1.4, 1.65]);
        }
        for (let i = 0; i <= 4; i++) rect(i * 1.5 - 0.05, 0, 0.1, th, '#b8bcc0');
        for (let j = 0; j <= 4; j++) rect(0, j * 1.75 - 0.04, tw, 0.08, '#b8bcc0');
        rect(0, 3.45, tw, 0.2, '#9ca3a8');
        break;
      }
      case 'office': {
        rect(0, 0, tw, th, '#c9c4ba');
        for (const y of [0.9, 4.4]) {
          rect(0, y, tw, 1.7, '#35424c');
          for (let i = 0; i < 4; i++) { rect(i * 1.5 + 0.03, y + 0.05, 1.44, 1.6, r() < 0.5 ? '#3f4c57' : '#46535e'); lit.push([i * 1.5 + 0.03, y + 0.05, 1.44, 1.6]); }
          for (let i = 0; i <= 4; i++) rect(i * 1.5 - 0.03, y, 0.06, 1.7, '#8e969b');
        }
        break;
      }
      case 'indus': {
        rect(0, 0, tw, th, '#b9bcbc');
        for (let x = 0; x < tw; x += 0.25) rect(x, 0, 0.06, th, 'rgba(90,95,98,0.35)');
        rect(0, 6.2, tw, 0.9, '#6f7a82');
        rect(1, 0, 3, 4.2, '#8a9296');
        break;
      }
      case 'hangar': {
        rect(0, 0, tw, th, '#c4c8ca');
        for (let x = 0; x < tw; x += 0.3) rect(x, 0, 0.08, th, 'rgba(80,86,90,0.3)');
        rect(0, 9.5, tw, 1.2, '#7c8a94');
        for (let i = 0; i < 6; i++) { rect(i * 2 + 0.2, 9.6, 1.6, 1.0, '#415058'); lit.push([i * 2 + 0.2, 9.6, 1.6, 1.0]); }
        break;
      }
      case 'house': {
        rect(0, 0, tw, th, '#e2d8c6');
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const x = 0.9 + i * 3, y = 0.8 + j * 2.8;
          rect(x - 0.35, y, 0.35, 1.4, '#7f8f86');
          rect(x + 1.0, y, 0.35, 1.4, '#7f8f86');
          rect(x, y, 1.0, 1.4, '#2f3538');
          lit.push([x, y, 1.0, 1.4]);
        }
        break;
      }
      case 'apart': {
        rect(0, 0, tw, th, '#d9d3c8');
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          const x = 0.5 + i * 2, y = 0.9 + j * 3;
          rect(x, y, 1.2, 1.5, '#343d44');
          lit.push([x, y, 1.2, 1.5]);
          rect(x - 0.1, y - 0.15, 1.4, 0.12, '#bdb6aa');
        }
        break;
      }
      case 'parking': {
        rect(0, 0, tw, th, '#aeaba5');
        for (const y of [1.1, 4.1]) rect(0, y, tw, 1.6, '#3a3d40');
        break;
      }
    }
  });
  const emissive = paintedTexture(`facade-${kind}-lit`, W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const rr = rng(kind.length * 31 + 7);
    for (const [x, y, w, h] of lit) {
      const on = kind === 'glass' || kind === 'hangar' ? 0.95 : 0.4;
      if (rr() > on) continue;
      const warm = kind === 'house' || kind === 'apart' ? rr() < 0.8 : rr() < 0.2;
      const k = 0.55 + rr() * 0.45;
      g.fillStyle = warm ? `rgb(${255 * k},${190 * k},${120 * k})` : `rgb(${235 * k},${240 * k},${255 * k})`;
      g.fillRect(x * pxm, H - (y + h) * pym, w * pxm, h * pym);
    }
  });
  return { map, emissive };
}

export interface BuildingsBuild {
  group: THREE.Group;
  setNight(k: number): void;
  /** Footprints of named buildings in world XZ (e.g. the pier), for the detailed models. */
  named: Map<string, { rings: number[][]; height: number }>;
}

interface Bucket { pos: number[]; uv: number[]; col: number[]; nrm: number[] }
const bucket = (): Bucket => ({ pos: [], uv: [], col: [], nrm: [] });

export function buildBuildings(stand: StandDef, skipNames: Set<string>): BuildingsBuild {
  const group = new THREE.Group();
  group.name = 'world-buildings';
  // near buildings (< NEAR_R m from the stand) also cast into the cockpit key-light shadow map
  const NEAR_R = 400;
  const walls = new Map<string, Bucket>();
  const roofs = new Map<string, Bucket>();
  const named = new Map<string, { rings: number[][]; height: number }>();
  const r = rng(4242);
  const recs = decodePolys(LFBD.BUILDINGS, 2, 0.1);
  recs.forEach((b, idx) => {
    const h = b.head[0] / 10;
    const cls = b.head[1] as BCls;
    const name = LFBD.BUILDING_NAMES[idx];
    const rings = b.rings.map((ring) => {
      const out: number[] = [];
      for (let i = 0; i < ring.length; i += 2) out.push(...dataToWorldXZ(ring[i], ring[i + 1], stand));
      return out;
    });
    if (name) named.set(name, { rings, height: h });
    if (name && skipNames.has(name)) return;
    const kind: FacadeKind = cls === BCls.Terminal || cls === BCls.Pier || cls === BCls.Tower ? 'glass'
      : cls === BCls.House ? 'house' : cls === BCls.Apart ? 'apart' : cls === BCls.Hangar ? 'hangar'
        : cls === BCls.Indus || cls === BCls.Service ? 'indus' : cls === BCls.Office ? 'office'
          : cls === BCls.Parking ? 'parking' : h > 7 ? 'office' : 'house';
    const tint = 0.86 + r() * 0.2;
    const col = new THREE.Color(tint, tint * (0.98 + r() * 0.04), tint * (0.95 + r() * 0.07));
    const near = Math.hypot(rings[0][0], rings[0][1]) < NEAR_R ? 'n' : 'f';
    const wk = kind + ':' + near;
    let bw = walls.get(wk);
    if (!bw) walls.set(wk, (bw = bucket()));
    const [tw, th] = FACADE_TILE[kind];
    const u0 = Math.floor(r() * 7) * tw; // random offset: not all facades start with the same bay
    for (const ring of rings) extrudeWalls(bw, ring, h, tw, th, col, u0);
    const rk = (kind === 'house' ? 'tile' : 'flat') + ':' + near;
    let roof = roofs.get(rk);
    if (!roof) roofs.set(rk, (roof = bucket()));
    const rc = kind === 'house' ? new THREE.Color().setHSL(0.03 + r() * 0.02, 0.45, 0.30 + r() * 0.1) : new THREE.Color(0.5 + r() * 0.1, 0.5 + r() * 0.1, 0.5 + r() * 0.1);
    roofTop(roof, rings, h, rc);
  });

  const emissiveMats: THREE.MeshStandardMaterial[] = [];
  const wallMats = new Map<FacadeKind, THREE.MeshStandardMaterial>();
  for (const [wk, b] of walls) {
    const [kind, near] = wk.split(':') as [FacadeKind, string];
    let m = wallMats.get(kind);
    if (!m) {
      const { map, emissive } = facadeTextures(kind);
      const glass = kind === 'glass';
      m = patchWorldMaterial(new THREE.MeshStandardMaterial({
        map, vertexColors: true, roughness: glass ? 0.18 : 0.85, metalness: glass ? 0.35 : 0.0,
        emissive: new THREE.Color(1, 1, 1), emissiveMap: emissive, emissiveIntensity: 0,
      }));
      wallMats.set(kind, m);
      emissiveMats.push(m);
    }
    const mesh = new THREE.Mesh(toGeometry(b), m);
    mesh.name = `buildings-${kind}-${near}`;
    mesh.castShadow = near === 'n';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const roofTex = paintedTexture('roof-membrane', 128, 128, (g, w, h) => {
    const rr = rng(3);
    g.fillStyle = '#8d8c88'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = 110 + rr() * 60; g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(rr() * w, rr() * h, 1.5, 1.5); }
  });
  const tileTex = paintedTexture('roof-tiles', 128, 128, (g, w, h) => {
    g.fillStyle = '#b0674a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(60,25,15,0.35)'; g.fillRect(0, y, w, 2); }
    for (let x = 0; x < w; x += 6) { g.fillStyle = 'rgba(255,220,200,0.08)'; g.fillRect(x, 0, 2, h); }
  });
  const roofMats = {
    flat: patchWorldMaterial(new THREE.MeshStandardMaterial({ map: roofTex, vertexColors: true, roughness: 0.9 })),
    tile: patchWorldMaterial(new THREE.MeshStandardMaterial({ map: tileTex, vertexColors: true, roughness: 0.9 })),
  };
  for (const [rk, b] of roofs) {
    const [key, near] = rk.split(':') as ['flat' | 'tile', string];
    const mesh = new THREE.Mesh(toGeometry(b), roofMats[key]);
    mesh.name = `roofs-${key}-${near}`;
    mesh.castShadow = near === 'n';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    named,
    setNight(k: number) {
      for (const m of emissiveMats) m.emissiveIntensity = k;
    },
  };
}

function extrudeWalls(b: Bucket, ring: number[], h: number, tw: number, th: number, c: THREE.Color, u0: number) {
  const n = ring.length / 2;
  // outward normals need a consistent orientation: compute the signed area (x, z plane)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
  }
  const sgn = area > 0 ? 1 : -1;
  let u = u0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[2 * i], z0 = ring[2 * i + 1], x1 = ring[2 * j], z1 = ring[2 * j + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.05) continue;
    // outward normal (x, z): for positive area (counter-clockwise in x/z), outward = (dz, -dx) * sgn
    const nx = ((z1 - z0) / L) * sgn, nz = (-(x1 - x0) / L) * sgn;
    const ua = u / tw, ub = (u + L) / tw, vt = h / th;
    // two triangles, outward facing
    const quad = [
      [x0, 0, z0, ua, 0], [x1, 0, z1, ub, 0], [x1, h, z1, ub, vt],
      [x0, 0, z0, ua, 0], [x1, h, z1, ub, vt], [x0, h, z0, ua, vt],
    ];
    const order = sgn > 0 ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
    for (const k of order) {
      const q = quad[k];
      b.pos.push(q[0], q[1], q[2]);
      b.uv.push(q[3], q[4]);
      b.col.push(c.r, c.g, c.b);
      b.nrm.push(nx, 0, nz);
    }
    u += L;
  }
}

function roofTop(b: Bucket, rings: number[][], h: number, c: THREE.Color) {
  const toV = (flat: number[]) => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
    return out;
  };
  const contour = toV(rings[0]);
  const holes = rings.slice(1).map(toV);
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const hh of holes) if (!THREE.ShapeUtils.isClockWise(hh)) hh.reverse();
  let tris: number[][];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
  const all = contour.concat(...holes);
  for (const t of tris) {
    for (const k of [t[0], t[2], t[1]]) {
      const v = all[k];
      b.pos.push(v.x, h, v.y);
      b.uv.push(v.x / 8, v.y / 8);
      b.col.push(c.r, c.g, c.b);
      b.nrm.push(0, 1, 0);
    }
  }
}

function toGeometry(b: Bucket): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.computeBoundingSphere();
  return g;
}
