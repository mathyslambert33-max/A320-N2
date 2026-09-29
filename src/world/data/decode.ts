/** Decoders for the base64 Int16 streams of lfbd.ts (world agent). Pure, unit tested. */

export function decodeI16(b64: string): Int16Array {
  let bytes: Uint8Array;
  if (typeof atob === 'function') {
    const s = atob(b64);
    bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  } else {
    bytes = Uint8Array.from((globalThis as any).Buffer.from(b64, 'base64'));
  }
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) {
    const v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    out[i] = v >= 32768 ? v - 65536 : v;
  }
  return out;
}

export type Ring = Float32Array; // x0, y0, x1, y1, ... (data frame metres)

export interface PolyRecord {
  /** Header values before the rings (e.g. surface type, or height + class). */
  head: number[];
  rings: Ring[];
}

/** Records of `nHead` header ints, then nRings, ring lengths and coordinates. */
export function decodePolys(b64: string, nHead: number, unit: number): PolyRecord[] {
  const a = decodeI16(b64);
  const out: PolyRecord[] = [];
  let i = 0;
  while (i < a.length) {
    const head: number[] = [];
    for (let k = 0; k < nHead; k++) head.push(a[i++]);
    const n = a[i++];
    const lens: number[] = [];
    for (let k = 0; k < n; k++) lens.push(a[i++]);
    const rings: Ring[] = [];
    for (const len of lens) {
      const r = new Float32Array(len * 2);
      for (let k = 0; k < len * 2; k++) r[k] = a[i++] * unit;
      rings.push(r);
    }
    out.push({ head, rings });
  }
  return out;
}

export interface LineRecord {
  type: number;
  pts: Float32Array;
}

/** Records [type, n, (x, y) x n]. */
export function decodeLines(b64: string, unit: number): LineRecord[] {
  const a = decodeI16(b64);
  const out: LineRecord[] = [];
  let i = 0;
  while (i < a.length) {
    const type = a[i++];
    const n = a[i++];
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n * 2; k++) pts[k] = a[i++] * unit;
    out.push({ type, pts });
  }
  return out;
}

/** Flat [x, y] pairs. */
export function decodePoints(b64: string, unit: number): Float32Array {
  const a = decodeI16(b64);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * unit;
  return out;
}
