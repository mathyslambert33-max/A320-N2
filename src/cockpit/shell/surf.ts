/**
 * Geometry utilities for curved linings:
 *  - `paramSurface`: a region of a parametric surface (outer boundary + holes in (u, v) parameter space) →
 *    earcut triangulation → conforming adaptive refinement (edge length / chord sag in 3D) → mapped mesh with
 *    analytic (finite-difference) normals. Used for walls with window openings, ceilings, glass.
 *  - `roundedOutline`: convex polygon with per-corner radii, offset by m (exact offset of a rounded polygon).
 *  - `ringStrip`: strip between several closed rings with identical sample counts (reveals, trims).
 *  - `loft`: tube-like surface through a list of cross-sections (seats, grips, posts).
 *  - `mirrorX`: mirror a geometry to the other side of the aircraft (fixes winding and normals).
 */
import * as THREE from 'three';
import type { P2 } from './geom';

export type SurfMap = (u: number, v: number, out: THREE.Vector3) => THREE.Vector3;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/** Normal of a parametric surface by central differences: normalize(∂P/∂u × ∂P/∂v) (× sign). */
export function surfNormal(map: SurfMap, u: number, v: number, out: THREE.Vector3, sign = 1, h = 1e-4): THREE.Vector3 {
  map(u + h, v, _a); map(u - h, v, _b); _a.sub(_b);
  map(u, v + h, _c); map(u, v - h, _d); _c.sub(_d);
  return out.crossVectors(_a, _c).normalize().multiplyScalar(sign);
}

export interface ParamSurfaceOptions {
  /** Max 3D edge length (m). */
  maxLen?: number;
  /** Max chord sag (m): distance between the mapped midpoint and the chord midpoint. */
  maxSag?: number;
  /** Normal sign: +1 → ∂P/∂u × ∂P/∂v, −1 → reversed. The mesh faces the normal direction. */
  sign?: number;
  /** UV scale (uv = (u, v) × scale). */
  uvScale?: number;
  /** Displacement along the normal (negative = behind the surface). */
  offset?: number;
}

/** Triangulated, refined, mapped region of a parametric surface. */
export function paramSurface(outer: P2[], holes: P2[][], map: SurfMap, o: ParamSurfaceOptions = {}): THREE.BufferGeometry {
  const maxLen = o.maxLen ?? 0.12;
  const maxSag = o.maxSag ?? 0.0012;
  const sign = o.sign ?? 1;
  const uvs = o.uvScale ?? 1;
  const off = o.offset ?? 0;
  const V: P2[] = [];
  const clean = (ring: P2[]) => {
    const r = ring.slice();
    if (r.length > 1) {
      const a = r[0], b = r[r.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) r.pop();
    }
    return r;
  };
  const outerC = clean(outer);
  const holesC = holes.map(clean);
  V.push(...outerC);
  for (const h of holesC) V.push(...h);
  const faces = THREE.ShapeUtils.triangulateShape(outerC.map((p) => new THREE.Vector2(p[0], p[1])), holesC.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  let tris: number[][] = faces.map((f) => [f[0], f[1], f[2]]);

  // 3D positions cache
  const P: THREE.Vector3[] = V.map((p) => map(p[0], p[1], new THREE.Vector3()));
  const addV = (p: P2) => { V.push(p); P.push(map(p[0], p[1], new THREE.Vector3())); return V.length - 1; };
  const tmp = new THREE.Vector3(), mid = new THREE.Vector3();
  const needsSplit = (i: number, j: number) => {
    const a = P[i], b = P[j];
    const len = a.distanceTo(b);
    if (len > maxLen) return true;
    if (len < 0.004) return false;
    map((V[i][0] + V[j][0]) / 2, (V[i][1] + V[j][1]) / 2, tmp);
    mid.addVectors(a, b).multiplyScalar(0.5);
    return tmp.distanceTo(mid) > maxSag;
  };
  for (let iter = 0; iter < 10; iter++) {
    const split = new Map<string, number>();
    const key = (i: number, j: number) => (i < j ? `${i}_${j}` : `${j}_${i}`);
    let any = false;
    for (const t of tris) {
      for (let e = 0; e < 3; e++) {
        const i = t[e], j = t[(e + 1) % 3];
        const k = key(i, j);
        if (split.has(k)) continue;
        if (needsSplit(i, j)) { split.set(k, -1); any = true; }
      }
    }
    if (!any) break;
    for (const [k, _] of split) {
      const [i, j] = k.split('_').map(Number);
      split.set(k, addV([(V[i][0] + V[j][0]) / 2, (V[i][1] + V[j][1]) / 2]));
    }
    const out: number[][] = [];
    for (const t of tris) {
      const m = [0, 1, 2].map((e) => split.get(key(t[e], t[(e + 1) % 3])) ?? -1);
      const n = m.filter((x) => x >= 0).length;
      if (n === 0) { out.push(t); continue; }
      if (n === 3) {
        const [p, q, r] = t; const [mpq, mqr, mrp] = m;
        out.push([p, mpq, mrp], [mpq, q, mqr], [mrp, mqr, r], [mpq, mqr, mrp]);
        continue;
      }
      // rotate so that the pattern is canonical
      let rot = 0;
      if (n === 1) { while (m[rot] < 0) rot++; } // split edge = (p, q)
      else { while (m[(rot + 2) % 3] >= 0) rot++; } // unsplit edge = (r, p)
      const p = t[rot], q = t[(rot + 1) % 3], r = t[(rot + 2) % 3];
      const m0 = m[rot], m1 = m[(rot + 1) % 3];
      if (n === 1) out.push([p, m0, r], [m0, q, r]);
      else out.push([m0, q, m1], [p, m0, m1], [p, m1, r]);
    }
    tris = out;
  }

  const pos = new Float32Array(V.length * 3);
  const nor = new Float32Array(V.length * 3);
  const uv = new Float32Array(V.length * 2);
  const n = new THREE.Vector3();
  for (let i = 0; i < V.length; i++) {
    surfNormal(map, V[i][0], V[i][1], n, sign);
    const p = P[i];
    pos[i * 3] = p.x + n.x * off; pos[i * 3 + 1] = p.y + n.y * off; pos[i * 3 + 2] = p.z + n.z * off;
    nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
    uv[i * 2] = V[i][0] * uvs; uv[i * 2 + 1] = V[i][1] * uvs;
  }
  // winding: the face normal must agree with the surface normal
  const idx: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    ab.set(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
    ac.set(pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]);
    fn.crossVectors(ab, ac);
    const dot = fn.x * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + fn.y * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + fn.z * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]);
    if (dot >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ------------------------------------------------------------------ */
/* Rounded convex outlines                                              */
/* ------------------------------------------------------------------ */

/**
 * Outline of a convex CCW polygon with rounded corners (radius radii[i] + m), i.e. the exact offset by `m`
 * of the rounded polygon. `arcN` samples per corner, straight edges subdivided into `edgeN` segments
 * (same counts for any m, so rings correspond sample by sample).
 */
export function roundedOutline(pts: P2[], radii: number[], m = 0, arcN = 8, edgeN = 6): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  const centres: P2[] = [];
  const angles: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p = pts[i], p1 = pts[(i + 1) % n];
    let dix = p[0] - p0[0], diy = p[1] - p0[1];
    let l = Math.hypot(dix, diy); dix /= l; diy /= l;
    let dox = p1[0] - p[0], doy = p1[1] - p[1];
    l = Math.hypot(dox, doy); dox /= l; doy /= l;
    const nin: P2 = [diy, -dix], nout: P2 = [doy, -dox];
    const r = radii[i];
    const den = 1 + nin[0] * nout[0] + nin[1] * nout[1];
    centres.push([p[0] - (r * (nin[0] + nout[0])) / den, p[1] - (r * (nin[1] + nout[1])) / den]);
    let a0 = Math.atan2(nin[1], nin[0]), a1 = Math.atan2(nout[1], nout[0]);
    while (a1 < a0) a1 += Math.PI * 2;
    angles.push([a0, a1]);
  }
  for (let i = 0; i < n; i++) {
    const [cx, cy] = centres[i];
    const R = radii[i] + m;
    const [a0, a1] = angles[i];
    for (let k = 0; k <= arcN; k++) {
      const a = a0 + ((a1 - a0) * k) / arcN;
      out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    // straight edge to the next corner's first arc point
    const j = (i + 1) % n;
    const [cx2, cy2] = centres[j];
    const R2 = radii[j] + m;
    const b0 = angles[j][0];
    const ex = cx + R * Math.cos(a1), ey = cy + R * Math.sin(a1);
    const fx = cx2 + R2 * Math.cos(b0), fy = cy2 + R2 * Math.sin(b0);
    for (let k = 1; k < edgeN; k++) out.push([ex + ((fx - ex) * k) / edgeN, ey + ((fy - ey) * k) / edgeN]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ring strips and lofts                                                */
/* ------------------------------------------------------------------ */

/**
 * Surface through closed (or open) rings of 3D points with identical counts. `faceHint(i, k)` optional:
 * a point the surface should face (used to fix the winding once, from the first quad).
 */
export function ringStrip(rings: THREE.Vector3[][], o: { closed?: boolean; faceToward?: THREE.Vector3; smooth?: boolean } = {}): THREE.BufferGeometry {
  const closed = o.closed ?? true;
  const nr = rings.length, ns = rings[0].length;
  const pos = new Float32Array(nr * ns * 3);
  const uv = new Float32Array(nr * ns * 2);
  let acc = 0;
  for (let k = 0; k < nr; k++) {
    let s = 0;
    for (let i = 0; i < ns; i++) {
      const p = rings[k][i];
      pos.set([p.x, p.y, p.z], (k * ns + i) * 3);
      if (i > 0) s += p.distanceTo(rings[k][i - 1]);
      uv.set([s, acc], (k * ns + i) * 2);
    }
    if (k < nr - 1) acc += rings[k][0].distanceTo(rings[k + 1][0]);
  }
  const idx: number[] = [];
  const segs = closed ? ns : ns - 1;
  for (let k = 0; k < nr - 1; k++) {
    for (let i = 0; i < segs; i++) {
      const a = k * ns + i, b = k * ns + ((i + 1) % ns), c = (k + 1) * ns + i, d = (k + 1) * ns + ((i + 1) % ns);
      idx.push(a, b, d, a, d, c);
    }
  }
  if (o.faceToward) {
    // test the first quad's normal
    const a = rings[0][0], b = rings[0][1 % ns], d = rings[1][1 % ns];
    const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(d, a));
    const to = new THREE.Vector3().subVectors(o.faceToward, a);
    if (fn.dot(to) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Superellipse cross-section samples (half-axes a, b, exponent e: 2 = ellipse, 4+ = boxy). Starts at +x, CCW. */
export function superellipse(a: number, b: number, e: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / e)]);
  }
  return out;
}

export interface LoftSection {
  /** Centre of the section. */
  c: THREE.Vector3;
  /** Section-local axes (x: first 2D axis, y: second). */
  x: THREE.Vector3;
  y: THREE.Vector3;
  /** 2D points (same count for every section). */
  pts: P2[];
}

/** Loft through sections; caps the ends with a fan (to the section centre) unless open. */
export function loft(sections: LoftSection[], o: { capStart?: boolean; capEnd?: boolean } = {}): THREE.BufferGeometry {
  const rings = sections.map((s) => s.pts.map(([a, b]) => s.c.clone().addScaledVector(s.x, a).addScaledVector(s.y, b)));
  const body = ringStrip(rings, { closed: true });
  // orientation: faces should point away from the section centres
  const p0 = rings[0][0], c0 = sections[0].c;
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  const nor = body.getAttribute('normal') as THREE.BufferAttribute;
  const n0 = new THREE.Vector3(nor.getX(0), nor.getY(0), nor.getZ(0));
  if (n0.dot(new THREE.Vector3().subVectors(p0, c0)) < 0) {
    const idx = body.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  void pos;
  const parts: THREE.BufferGeometry[] = [toSimple(body)];
  const cap = (s: LoftSection, ring: THREE.Vector3[], outward: THREE.Vector3) => {
    const verts: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const fn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(a, s.c), new THREE.Vector3().subVectors(b, s.c));
      if (fn.dot(outward) >= 0) verts.push(s.c.x, s.c.y, s.c.z, a.x, a.y, a.z, b.x, b.y, b.z);
      else verts.push(s.c.x, s.c.y, s.c.z, b.x, b.y, b.z, a.x, a.y, a.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
    g.computeVertexNormals();
    parts.push(g);
  };
  const n = sections.length;
  if (o.capStart !== false) cap(sections[0], rings[0], new THREE.Vector3().subVectors(sections[0].c, sections[1].c).normalize());
  if (o.capEnd !== false) cap(sections[n - 1], rings[n - 1], new THREE.Vector3().subVectors(sections[n - 1].c, sections[n - 2].c).normalize());
  return mergeSimple(parts);
}

/** Non-indexed geometry with position/normal/uv only. */
export function toSimple(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  if (!n.attributes.normal) n.computeVertexNormals();
  n.groups = [];
  return n;
}

export function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  const simple = list.map((g) => { const s = toSimple(g); count += s.attributes.position.count; return s; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const s of simple) {
    pos.set(s.attributes.position.array as Float32Array, o * 3);
    nor.set(s.attributes.normal.array as Float32Array, o * 3);
    uv.set(s.attributes.uv.array as Float32Array, o * 2);
    o += s.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Mirror across x = 0 (the other side of the aircraft), keeping front faces and normals correct. */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  const pos = m.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setX(i, -pos.getX(i));
  const nor = m.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (nor) for (let i = 0; i < nor.count; i++) nor.setX(i, -nor.getX(i));
  const idx = m.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
  } else {
    const swap = (attr: THREE.BufferAttribute) => {
      const s = attr.itemSize;
      for (let i = 0; i < attr.count; i += 3) for (let c = 0; c < s; c++) {
        const t = attr.array[(i + 1) * s + c]; (attr.array as Float32Array)[(i + 1) * s + c] = attr.array[(i + 2) * s + c]; (attr.array as Float32Array)[(i + 2) * s + c] = t;
      }
    };
    for (const k of Object.keys(m.attributes)) swap(m.getAttribute(k) as THREE.BufferAttribute);
  }
  return m;
}

/** Collects geometry per material, merges into one mesh per material. */
export class MergeBag {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(g: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4): void {
    const s = toSimple(g);
    if (m) s.applyMatrix4(m);
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(s);
  }
  /** Add with position + Euler rotation (radians, XYZ). */
  at(g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.add(g, mat, m);
  }
  /** Add mirrored copy too (x → −x). */
  both(g: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4): void {
    const s = toSimple(g);
    if (m) s.applyMatrix4(m);
    this.add(s, mat);
    this.add(mirrorX(s), mat);
  }
  build(name: string, o: { castShadow?: boolean | ((m: THREE.Material) => boolean); receiveShadow?: boolean } = {}): THREE.Group {
    const grp = new THREE.Group();
    grp.name = name;
    for (const [mat, list] of this.lists) {
      const g = mergeSimple(list);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}:${(mat as any).name || 'mat'}`;
      mesh.castShadow = typeof o.castShadow === 'function' ? o.castShadow(mat) : o.castShadow ?? true;
      mesh.receiveShadow = o.receiveShadow ?? true;
      grp.add(mesh);
    }
    this.lists.clear();
    return grp;
  }
}
