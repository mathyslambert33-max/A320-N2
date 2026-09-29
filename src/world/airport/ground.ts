/**
 * Airport ground (world agent): grass, pavements (X-Plane Gateway outlines), runways and their markings, painted
 * taxiway lines. Every ground layer lies exactly in the plane y = 0 and is layered with polygon offsets (grass <
 * pavement < paint), which stays stable at any distance (the camera near plane is 2 cm).
 */
import * as THREE from 'three';
import { decodeLines, decodePolys } from '../data/decode';
import * as LFBD from '../data/lfbd';
import { dataToWorldXZ, type StandDef } from '../geo';
import { asphaltTexture, concreteTexture, grassTexture, macroNoiseTexture, textTexture } from '../mat/textures';
import { patchWorldMaterial } from '../env/worldMaterial';
import { DecalBuilder, polygonsGeometry } from './ribbons';

export const PAINT = {
  yellow: new THREE.Color().setRGB(0.80, 0.52, 0.02),
  white: new THREE.Color().setRGB(0.80, 0.80, 0.78),
  black: new THREE.Color().setRGB(0.025, 0.025, 0.025),
  red: new THREE.Color().setRGB(0.55, 0.035, 0.03),
  blue: new THREE.Color().setRGB(0.03, 0.12, 0.45),
  green: new THREE.Color().setRGB(0.05, 0.3, 0.1),
  orange: new THREE.Color().setRGB(0.85, 0.3, 0.02),
};

/** Material for ground layers: polygon offset rank (0 grass, 1 pavement, 2 paint, 3 paint over paint). */
export function groundMaterial(params: THREE.MeshStandardMaterialParameters, rank: number, macro = true): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  if (rank > 0) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1.5 * rank;
    m.polygonOffsetUnits = -4 * rank;
  }
  const macroTex = macroNoiseTexture();
  patchWorldMaterial(m, {
    key: macro ? 'gm' : 'g',
    extra: macro
      ? (shader) => {
          shader.uniforms.wlMacro = { value: macroTex };
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform sampler2D wlMacro;')
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
              {
                float m1 = texture2D( wlMacro, vWlPos.xz / 173.0 ).r;
                float m2 = texture2D( wlMacro, vWlPos.xz / 41.0 + 0.37 ).r;
                diffuseColor.rgb *= 0.78 + 0.28 * m1 + 0.12 * ( m2 - 0.5 );
              }`,
            );
        }
      : undefined,
  });
  return m;
}

export interface GroundBuild {
  group: THREE.Group;
  /** world XZ polylines of the taxiway light lines, by X-Plane type (for the lights module) */
  lightLines: { type: number; pts: number[] }[];
}

export function buildGround(stand: StandDef, anisotropy: number): GroundBuild {
  const group = new THREE.Group();
  group.name = 'world-ground';
  const w = (x: number, y: number) => dataToWorldXZ(x, y, stand);

  // --- grass (to the horizon) ---
  const grassTex = grassTexture();
  grassTex.repeat.set(1, 1);
  const grassGeo = new THREE.CircleGeometry(14000, 96).rotateX(-Math.PI / 2);
  const uv = grassGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = grassGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, gp.getX(i) / 6, gp.getZ(i) / 6);
  const grass = new THREE.Mesh(grassGeo, groundMaterial({ map: grassTex, roughness: 0.95, metalness: 0 }, 0));
  grass.name = 'grass';
  grass.receiveShadow = true;
  grass.renderOrder = -10;
  group.add(grass);

  // --- pavements ---
  const asph: { outer: number[]; holes: number[][] }[] = [];
  const conc: { outer: number[]; holes: number[][] }[] = [];
  for (const p of decodePolys(LFBD.PAVEMENTS, 1, 0.1)) {
    const rings = p.rings.map((r) => {
      const out: number[] = [];
      for (let i = 0; i < r.length; i += 2) out.push(...w(r[i], r[i + 1]));
      return out;
    });
    (p.head[0] === 2 ? conc : asph).push({ outer: rings[0], holes: rings.slice(1) });
  }
  // runways (asphalt rectangles incl. shoulders and blast pads)
  const rwDecals = new DecalBuilder();
  for (const r of LFBD.RUNWAYS) {
    const [a, b] = r.ends;
    const [ax, az] = w(a.x, a.y);
    const [bx, bz] = w(b.x, b.y);
    const L = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nx = -dz, nz = dx;
    const hw = r.w / 2 + 7.5;
    const ext0 = a.blast, ext1 = b.blast;
    const p0x = ax - dx * ext0, p0z = az - dz * ext0, p1x = bx + dx * ext1, p1z = bz + dz * ext1;
    asph.push({ outer: [p0x + nx * hw, p0z + nz * hw, p1x + nx * hw, p1z + nz * hw, p1x - nx * hw, p1z - nz * hw, p0x - nx * hw, p0z - nz * hw], holes: [] });
    runwayMarkings(rwDecals, r.w, [ax, az], [bx, bz], a.id, b.id, a.blast, b.blast);
  }
  const asphTex = asphaltTexture();
  asphTex.anisotropy = anisotropy;
  const asphalt = new THREE.Mesh(polygonsGeometry(asph, 8), groundMaterial({ map: asphTex, roughness: 0.92, metalness: 0 }, 1));
  asphalt.name = 'asphalt';
  asphalt.receiveShadow = true;
  group.add(asphalt);
  const concTex = concreteTexture();
  concTex.anisotropy = anisotropy;
  if (conc.length) {
    const concrete = new THREE.Mesh(polygonsGeometry(conc, 10), groundMaterial({ map: concTex, roughness: 0.88, metalness: 0 }, 2));
    concrete.name = 'concrete';
    concrete.receiveShadow = true;
    group.add(concrete);
  }

  // --- painted lines (X-Plane line types) ---
  const paint = new DecalBuilder();
  const lightLines: { type: number; pts: number[] }[] = [];
  for (const m of decodeLines(LFBD.MARKINGS, 0.1)) {
    const pts: number[] = [];
    for (let i = 0; i < m.pts.length; i += 2) pts.push(...w(m.pts[i], m.pts[i + 1]));
    xplaneLine(paint, m.type, pts);
  }
  for (const l of decodeLines(LFBD.LIGHT_LINES, 0.1)) {
    const pts: number[] = [];
    for (let i = 0; i < l.pts.length; i += 2) pts.push(...w(l.pts[i], l.pts[i + 1]));
    lightLines.push({ type: l.type, pts });
  }
  const paintMat = groundMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }, 3, false);
  const paintMesh = new THREE.Mesh(paint.build(), paintMat);
  paintMesh.name = 'taxiway-markings';
  paintMesh.receiveShadow = true;
  group.add(paintMesh);
  const rwMesh = new THREE.Mesh(rwDecals.build(), paintMat);
  rwMesh.name = 'runway-markings';
  rwMesh.receiveShadow = true;
  group.add(rwMesh);

  // runway designators (text decals)
  for (const r of LFBD.RUNWAYS) {
    for (let k = 0; k < 2; k++) {
      const e = r.ends[k], o = r.ends[1 - k];
      const [ex, ez] = w(e.x, e.y);
      const [ox, oz] = w(o.x, o.y);
      const L = Math.hypot(ox - ex, oz - ez);
      const dx = (ox - ex) / L, dz = (oz - ez) / L;
      const cx = ex + dx * 42, cz = ez + dz * 42;
      const tex = textTexture(e.id, { w: 256, h: 256, color: '#ffffff', font: 'bold 250px Arial, sans-serif' });
      const mat = groundMaterial({ map: tex, transparent: true, alphaTest: 0.3, roughness: 0.6, depthWrite: false }, 3, false);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(12, 9).rotateX(-Math.PI / 2), mat);
      q.position.set(cx, 0, cz);
      q.rotation.y = Math.atan2(-dx, -dz);
      q.scale.set(1, 1, 1);
      q.name = `rwy-${e.id}`;
      group.add(q);
    }
  }
  return { group, lightLines };
}

/** X-Plane painted line types → ICAO paint. */
function xplaneLine(d: DecalBuilder, type: number, pts: number[]) {
  const Y = PAINT.yellow, K = PAINT.black, W = PAINT.white;
  const bordered = type >= 51 && type <= 58;
  const t = bordered ? type - 50 : type;
  const border = (width: number) => {
    if (!bordered) return;
    d.ribbon(pts, 0.08, K, width / 2 + 0.04);
    d.ribbon(pts, 0.08, K, -width / 2 - 0.04);
  };
  switch (t) {
    case 1: // taxiway centreline
      d.ribbon(pts, 0.15, Y);
      border(0.15);
      break;
    case 2: // broken yellow (misc boundary)
      d.ribbon(pts, 0.15, Y, 0, [1.0, 1.0]);
      break;
    case 3: // taxiway edge: double solid
      d.ribbon(pts, 0.15, Y, 0.15);
      d.ribbon(pts, 0.15, Y, -0.15);
      if (bordered) { d.ribbon(pts, 0.08, K, 0.265); d.ribbon(pts, 0.08, K, -0.265); d.ribbon(pts, 0.15, K, 0); }
      break;
    case 4: // runway holding position, pattern A: 2 solid + 2 dashed
      d.ribbon(pts, 0.15, Y, 0.525);
      d.ribbon(pts, 0.15, Y, 0.225);
      d.ribbon(pts, 0.15, Y, -0.225, [0.9, 0.6]);
      d.ribbon(pts, 0.15, Y, -0.525, [0.9, 0.6]);
      break;
    case 5: // other hold: dashed + solid
      d.ribbon(pts, 0.15, Y, 0.15);
      d.ribbon(pts, 0.15, Y, -0.15, [0.9, 0.6]);
      break;
    case 6: { // ILS hold (pattern B ladder)
      d.ribbon(pts, 0.15, Y, 0.6);
      d.ribbon(pts, 0.15, Y, -0.6);
      d.ribbon(pts, 1.2, Y, 0, [0.3, 1.2]);
      break;
    }
    case 7: // centreline in runway safety area
      d.ribbon(pts, 0.15, Y);
      d.ribbon(pts, 0.15, Y, 0.35, [1, 1]);
      d.ribbon(pts, 0.15, Y, -0.35, [1, 1]);
      break;
    case 8:
      d.ribbon(pts, 0.15, Y, 0, [3, 6]);
      break;
    case 9:
      d.ribbon(pts, 0.15, Y, 0.15, [3, 6]);
      d.ribbon(pts, 0.15, Y, -0.15, [3, 6]);
      break;
    case 20: // solid white (roads)
      d.ribbon(pts, 0.15, W);
      break;
    case 21:
      d.ribbon(pts, 0.3, W, 0, [0.3, 0.3]);
      break;
    case 22: // broken white
      d.ribbon(pts, 0.15, W, 0, [3, 3]);
      break;
    default:
      d.ribbon(pts, 0.15, Y);
  }
}

/** ICAO runway markings (precision approach runway, 45 m). */
function runwayMarkings(d: DecalBuilder, width: number, a: [number, number], b: [number, number], _idA: string, _idB: string, _blastA: number, _blastB: number) {
  const W = PAINT.white;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  const nx = -dz, nz = dx;
  const at = (s: number, o: number): [number, number] => [a[0] + dx * s + nx * o, a[1] + dz * s + nz * o];
  // edges (0.9 m) and centreline (30 m dashes, 20 m gaps, 0.9 m wide)
  const hw = width / 2 - 0.45;
  d.ribbon([...at(0, hw), ...at(L, hw)], 0.9, W);
  d.ribbon([...at(0, -hw), ...at(L, -hw)], 0.9, W);
  d.ribbon([...at(60, 0), ...at(L - 60, 0)], 0.9, W, 0, [30, 20]);
  for (const [s0, dir] of [[0, 1], [L, -1]] as [number, number][]) {
    // threshold: 12 stripes (45 m runway), 30 m long, 1.8 m wide
    const n = 12, sw = 1.8, gap = (width - 3 - n * sw) / (n - 1 + 1);
    for (let i = 0; i < n; i++) {
      const side = i < n / 2 ? -1 : 1;
      const k = i < n / 2 ? i : i - n / 2;
      const o = side * (gap + sw / 2 + k * (sw + gap) + 0.8);
      const [cx, cz] = at(s0 + dir * 21, o);
      d.rect(cx, cz, dx, dz, 30, sw, W);
    }
    // aiming point: 2 stripes 45 m long, 6 m wide, 400 m from threshold, 18 m inner spacing
    for (const side of [-1, 1]) {
      const [cx, cz] = at(s0 + dir * (400 + 22.5), side * (9 + 3));
      d.rect(cx, cz, dx, dz, 45, 6, W);
    }
    // touchdown zone: pairs at 150, 300 (triple / double bars), 600, 750, 900 (single)
    const tdz: [number, number][] = [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]];
    for (const [s, bars] of tdz) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < bars; k++) {
          const [cx, cz] = at(s0 + dir * (s + 11.25), side * (9 + 0.9 + k * 3.6));
          d.rect(cx, cz, dx, dz, 22.5, 1.8, W);
        }
      }
    }
  }
}
