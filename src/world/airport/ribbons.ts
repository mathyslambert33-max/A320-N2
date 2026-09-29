/**
 * Ground decal geometry helpers (world agent): ribbons, dashes and quads in the three.js world frame, collected
 * into one vertex-coloured BufferGeometry per material.
 */
import * as THREE from 'three';

export class DecalBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  private v(x: number, z: number, c: THREE.Color, u = 0, w = 0, y = 0) {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }

  /** Quad from 4 corners (x, z) in order. */
  quad(p: [number, number][], c: THREE.Color, uv?: [number, number][]) {
    const i = p.map((q, k) => this.v(q[0], q[1], c, uv?.[k][0] ?? 0, uv?.[k][1] ?? 0));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  /** Rectangle centred at (x, z), along unit direction (dx, dz), length l, width w. */
  rect(x: number, z: number, dx: number, dz: number, l: number, w: number, c: THREE.Color) {
    const nx = -dz, nz = dx;
    const hl = l / 2, hw = w / 2;
    this.quad([
      [x - dx * hl - nx * hw, z - dz * hl - nz * hw],
      [x + dx * hl - nx * hw, z + dz * hl - nz * hw],
      [x + dx * hl + nx * hw, z + dz * hl + nz * hw],
      [x - dx * hl + nx * hw, z - dz * hl + nz * hw],
    ], c);
  }

  /**
   * Ribbon along a polyline (flat array x0,z0,x1,z1… in world XZ), offset laterally by `off` (left positive),
   * width `w`. Optional dash pattern [on, off] in metres.
   */
  ribbon(pts: ArrayLike<number>, w: number, c: THREE.Color, off = 0, dash?: [number, number]) {
    const n = pts.length / 2;
    if (n < 2) return;
    // per-vertex miter normals
    const nrm: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      let tx = pts[2 * i1] - pts[2 * i0], tz = pts[2 * i1 + 1] - pts[2 * i0 + 1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      let nx = -tz, nz = tx;
      // miter length compensation
      if (i > 0 && i < n - 1) {
        const ax = pts[2 * i] - pts[2 * i - 2], az = pts[2 * i + 1] - pts[2 * i - 1];
        const al = Math.hypot(ax, az) || 1;
        const cosH = Math.abs(((-az / al) * nx + (ax / al) * nz));
        const s = 1 / Math.max(0.35, cosH);
        nx *= s; nz *= s;
      }
      nrm.push(nx, nz);
    }
    const hw = w / 2;
    if (!dash) {
      let prevL = -1, prevR = -1;
      for (let i = 0; i < n; i++) {
        const x = pts[2 * i], z = pts[2 * i + 1];
        const nx = nrm[2 * i], nz = nrm[2 * i + 1];
        const l = this.v(x + nx * (off + hw), z + nz * (off + hw), c);
        const r = this.v(x + nx * (off - hw), z + nz * (off - hw), c);
        if (i > 0) this.idx.push(prevL, prevR, r, prevL, r, l);
        prevL = l; prevR = r;
      }
      return;
    }
    // dashed: walk along the polyline
    const [on, gap] = dash;
    const period = on + gap;
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[2 * i], z0 = pts[2 * i + 1], x1 = pts[2 * i + 2], z1 = pts[2 * i + 3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 1e-4) continue;
      const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
      const nx = -dz, nz = dx;
      let s = 0;
      while (s < L) {
        const ph = (acc + s) % period;
        if (ph < on) {
          const e = Math.min(L, s + (on - ph));
          const ax = x0 + dx * s + nx * off, az = z0 + dz * s + nz * off;
          const bx = x0 + dx * e + nx * off, bz = z0 + dz * e + nz * off;
          this.quad([[ax - nx * hw, az - nz * hw], [bx - nx * hw, bz - nz * hw], [bx + nx * hw, bz + nz * hw], [ax + nx * hw, az + nz * hw]], c);
          s = e;
        } else {
          s = Math.min(L, s + (period - ph));
        }
      }
      acc += L;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const nrm = new Float32Array(this.pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Triangulate flat polygons (rings in world XZ) into one geometry with planar UVs (metres / `tile`). */
export function polygonsGeometry(polys: { outer: number[]; holes: number[][] }[], tile: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const p of polys) {
    const contour = toVec2(p.outer);
    const holes = p.holes.map(toVec2);
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    for (const h of holes) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      continue;
    }
    const base = pos.length / 3;
    const all = contour.concat(...holes);
    for (const v of all) {
      pos.push(v.x, 0, v.y);
      uv.push(v.x / tile, -v.y / tile);
    }
    for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

function toVec2(flat: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]));
  // drop duplicate closing point
  if (out.length > 2 && out[0].distanceTo(out[out.length - 1]) < 1e-3) out.pop();
  return out;
}
