/**
 * Shared Canvas 2D helpers for the EFIS / ISIS / FCU displays.
 * Geometry is expressed in "display units" and scaled with ctx.scale() by each page.
 */
import { FONT } from '../../../displays/framework';

/** EFIS colours (LCD DU rendering). */
export const C = {
  white: '#ffffff',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff94ff',
  amber: '#e68000',
  yellow: '#ffff00',
  red: '#ff0000',
  sky: '#0698ff',
  earth: '#9c480c',
  tape: '#787878',
  grey: '#787878',
  bg: '#040404',
  black: '#000000',
};

export type Ctx = CanvasRenderingContext2D;

export function setFont(ctx: Ctx, size: number, family: string = FONT.du): void {
  ctx.font = `${size}px ${family}`;
}

export function txt(
  ctx: Ctx, s: string, x: number, y: number, color: string, size: number,
  align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'alphabetic',
): void {
  ctx.font = `${size}px ${FONT.du}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
}

export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, lw: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

export function fillRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Stroke a polyline / polygon given as flat [x0,y0,x1,y1,...]. */
export function poly(ctx: Ctx, pts: number[], color: string, w: number, close = false, fill?: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  if (close) ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (w > 0) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }
}

/** Stroke with a black outline underneath (EFIS symbols over the sky/earth). */
export function outlined(ctx: Ctx, draw: () => void, color: string, w: number, outline = w * 1.8): void {
  ctx.strokeStyle = C.black;
  ctx.lineWidth = outline;
  draw();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  draw();
  ctx.stroke();
}

/**
 * Failure flags flash at 1 Hz for `duration` seconds after they appear, then stay steady
 * (FCOM DSC-31-40). One tracker per display instance.
 */
export class Flasher {
  private since = new Map<string, number>();

  /** Returns true when the flag must be drawn this frame. */
  show(key: string, active: boolean, t: number, duration = 9): boolean {
    if (!active) {
      this.since.delete(key);
      return false;
    }
    let s = this.since.get(key);
    if (s === undefined) { s = t; this.since.set(key, s); }
    const e = t - s;
    if (e >= duration) return true;
    return Math.floor(e * 2) % 2 === 0;
  }
}

export const pad = (n: number, len: number, ch = '0') => String(n).padStart(len, ch);
export const deg2rad = (d: number) => (d * Math.PI) / 180;
