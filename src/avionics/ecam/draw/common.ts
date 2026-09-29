/**
 * Canvas 2D helpers shared by the E/WD and SD formats.
 */
import { DU, FONT } from '../../../displays/framework';
import type { Col, Line } from '../logic/types';

export const C = {
  W: DU.white,
  G: DU.green,
  A: DU.amber,
  R: DU.red,
  C: DU.cyan,
  M: DU.magenta,
  grey: DU.grey,
  /** Dim colours used for the "off" phase of flashing items. */
  dimG: '#007a00',
  dimA: '#7a4a00',
} as const;

export const colOf = (c: Col): string => C[c];

/** Draw text. `px` is the font size in the current transform space. */
export function tx(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, px: number,
  align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'alphabetic', family: string = FONT.du,
): void {
  ctx.font = `${px}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}

/** Width of a text in the current transform space. */
export function tw(ctx: CanvasRenderingContext2D, s: string, px: number, family: string = FONT.du): number {
  ctx.font = `${px}px ${family}`;
  return ctx.measureText(s).width;
}

/** Number in "big integer + small decimal" style (e.g. N1 19.5): returns nothing, right aligned at x. */
export function splitNumber(
  ctx: CanvasRenderingContext2D, v: number, x: number, y: number, color: string, bigPx: number, smallPx: number, decimals = 1,
): void {
  const s = v.toFixed(decimals);
  const [i, f] = s.split('.');
  const fw = tw(ctx, f, smallPx);
  const dw = tw(ctx, '.', smallPx);
  tx(ctx, f, x, y, color, smallPx, 'right');
  tx(ctx, '.', x - fw, y, color, smallPx, 'right');
  tx(ctx, i, x - fw - dw, y, color, bigPx, 'right');
}

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w: number, cap: CanvasLineCap = 'butt'): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = cap;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Polyline from a flat list of points [x0,y0,x1,y1,...]. */
export function poly(ctx: CanvasRenderingContext2D, pts: number[], color: string, w: number, close = false, fill?: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (w > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Relative path helper using SVG-like 'l dx,dy' steps from a start point. */
export function relPoly(ctx: CanvasRenderingContext2D, x: number, y: number, steps: number[], color: string, w: number, close = true, fill?: string): void {
  const pts = [x, y];
  let cx = x;
  let cy = y;
  for (let i = 0; i < steps.length; i += 2) {
    cx += steps[i];
    cy += steps[i + 1];
    pts.push(cx, cy);
  }
  poly(ctx, pts, color, w, close, fill);
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, lw: number, fill?: string): void {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (lw > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lw: number, fill?: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (lw > 0) { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); }
}

/**
 * Compass-convention angles (0 = up, clockwise, degrees) as used by gauge definitions.
 * Returns the unit vector for a compass angle.
 */
export function dirOf(compassDeg: number): [number, number] {
  const r = ((compassDeg - 90) * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** Arc between two compass angles, drawn clockwise from `from` to `to`. */
export function arcC(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, from: number, to: number, color: string, w: number): void {
  const a0 = ((from - 90) * Math.PI) / 180;
  let sweep = to - from;
  while (sweep < 0) sweep += 360;
  const a1 = a0 + (sweep * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  ctx.stroke();
}

/** Gauge: value → compass angle for a gauge spanning clockwise from `start` to `end`. */
export function gaugeAngle(v: number, min: number, max: number, start: number, end: number): number {
  let sweep = end - start;
  while (sweep <= 0) sweep += 360;
  const p = Math.max(0, Math.min(1, (v - min) / (max - min)));
  return start + p * sweep;
}

/** Fixed-pitch ECAM text line (warning / memo area). */
export function drawEcamLine(
  ctx: CanvasRenderingContext2D, l: Line, x: number, y: number, pitch: number, px: number, flashOn: boolean,
): void {
  let col = 0;
  ctx.font = `${px}px ${FONT.du}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  for (const seg of l) {
    let color = colOf(seg.c);
    if (seg.flash && !flashOn) color = seg.c === 'A' ? C.dimA : C.dimG;
    ctx.fillStyle = color;
    const start = col;
    for (const ch of seg.t) {
      if (ch !== ' ') ctx.fillText(ch, x + (col + 0.5) * pitch, y);
      col++;
    }
    if (seg.u) {
      // underline under the non-blank characters of the segment
      const trimmedStart = start + (seg.t.length - seg.t.trimStart().length);
      const trimmedEnd = start + seg.t.trimEnd().length;
      line(ctx, x + trimmedStart * pitch + 1, y + px * 0.2, x + trimmedEnd * pitch - 1, y + px * 0.2, color, px * 0.07);
    }
    if (seg.box) {
      const ts = start + (seg.t.length - seg.t.trimStart().length);
      const te = start + seg.t.trimEnd().length;
      rect(ctx, x + ts * pitch - 3, y - px * 0.85, (te - ts) * pitch + 6, px * 1.1, color, px * 0.07);
    }
  }
}

/** Standard SD page title (white, underlined). */
export function pageTitle(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, px: number, align: CanvasTextAlign = 'left'): void {
  tx(ctx, s, x, y, C.W, px, align);
  const w = tw(ctx, s, px);
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  line(ctx, x0, y + px * 0.14, x0 + w, y + px * 0.14, C.W, px * 0.08);
}

/** Amber XX (invalid data). */
export function xx(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, align: CanvasTextAlign = 'center'): void {
  tx(ctx, 'XX', x, y, C.A, px, align);
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
