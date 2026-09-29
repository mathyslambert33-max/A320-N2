/**
 * SD ENGINE page, CFM56-5B (600 design space): fuel used, oil quantity / pressure / temperature,
 * vibrations, and during engine start (ENG MODE IGN/START or CRANK): igniters A/B, start valve,
 * engine bleed pressure.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, circle, line, pageTitle, tx } from '../common';

const K = 1024 / 600;

const OIL_QTY_MAX = 25;
const OIL_QTY_LOW = 5;
const OIL_PSI_MAX = 100;
const OIL_PSI_RED = 13;

export function drawEngPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  ctx.scale(K, K);
  pageTitle(ctx, 'ENGINE', 6, 24, 24);
  const a = core.fwc.a;
  const startMode = a.engModeSel === 2 || a.engModeSel === 0 || a.eng.some((e) => e.manStart);
  const mid = 'middle';

  // centre legends
  line(ctx, 250, 75, 225, 77, C.W, 1);
  tx(ctx, 'F.USED', 300, 75, C.W, 18, 'center', mid);
  tx(ctx, 'KG', 300, 97, C.C, 16, 'center', mid);
  line(ctx, 350, 75, 375, 77, C.W, 1);
  tx(ctx, 'OIL', 300, 135, C.W, 18, 'center', mid);
  tx(ctx, 'QT', 300, 160, C.C, 16, 'center', mid);
  tx(ctx, 'PSI', 300, 235, C.C, 16, 'center', mid);
  line(ctx, 250, 292, 225, 294, C.W, 1);
  tx(ctx, '°C', 300, 290, C.C, 16, 'center', mid);
  line(ctx, 350, 292, 375, 294, C.W, 1);
  line(ctx, 250, 340, 225, 342, C.W, 1);
  tx(ctx, 'VIB N1', 300, 340, C.W, 16, 'center', mid);
  line(ctx, 350, 340, 375, 342, C.W, 1);
  line(ctx, 250, 370, 225, 372, C.W, 1);
  tx(ctx, 'N2', 316, 370, C.W, 16, 'center', mid);
  line(ctx, 350, 370, 375, 372, C.W, 1);
  if (startMode) {
    tx(ctx, 'IGN', 300, 425, C.W, 16, 'center', mid);
    line(ctx, 250, 488, 225, 490, C.W, 1);
    tx(ctx, 'PSI', 300, 490, C.C, 16, 'center', mid);
    line(ctx, 350, 488, 375, 490, C.W, 1);
  }

  for (const n of [1, 2] as const) {
    const x = n === 1 ? 180 : 420;
    const e = a.eng[n - 1];
    const fadec = e.fadec;
    // fuel used (10 kg steps); reset at engine start by the FADEC
    const fu = sim.get(`S:FUEL_USED_${n}`);
    if (fadec) tx(ctx, String(Math.round(fu / 10) * 10), x, 80, C.G, 20, 'center', mid);
    else tx(ctx, 'XX', x, 80, C.A, 20, 'center', mid);

    // ---- oil quantity (half-circle gauge, top)
    const qy = 165;
    halfArc(ctx, x, qy, 50);
    line(ctx, x - 51, qy, x - 45, qy, C.W, 2);
    line(ctx, x, qy - 50, x, qy - 45, C.W, 2);
    line(ctx, x + 45, qy, x + 51, qy, C.W, 2);
    if (fadec) {
      const q = Math.round(e.oilQty * 2) / 2;
      // amber low quantity mark
      needle(ctx, x, qy, 50, 60, (OIL_QTY_LOW / OIL_QTY_MAX) * 100 - 3, C.A, 6);
      const low = q <= OIL_QTY_LOW;
      const pulse = low && Math.floor(t * 2) % 2 === 0;
      if (q > 0) needle(ctx, x, qy, 40, 60, Math.min(100, (q / OIL_QTY_MAX) * 100), pulse ? C.dimG : C.G, 2);
      const [i, f] = q.toFixed(1).split('.');
      const col = pulse ? C.dimG : C.G;
      tx(ctx, i, x + 3, qy, col, 20, 'right', mid);
      tx(ctx, '.' + f, x + 3, qy + 1, col, 16, 'left', mid);
    } else tx(ctx, 'XX', x, qy, C.A, 20, 'center', mid);

    // ---- oil pressure (half-circle gauge)
    const py = 240;
    halfArc(ctx, x, py, 50);
    line(ctx, x, py - 50, x, py - 45, C.W, 2);
    line(ctx, x + 45, py, x + 51, py, C.W, 2);
    if (fadec) {
      const p = Math.round(e.oilPress / 2) * 2;
      const running = e.running;
      if (running) arcValue(ctx, x, py, 50, 0, (OIL_PSI_RED / OIL_PSI_MAX) * 100, C.R, 2.5);
      const red = running && p <= OIL_PSI_RED;
      const col = red ? C.R : C.G;
      needle(ctx, x, py, 40, 60, Math.min(100, (p / OIL_PSI_MAX) * 100), col, 2);
      tx(ctx, String(p), x, py - 5, col, 20, 'center', mid);
    } else tx(ctx, 'XX', x, py - 5, C.A, 20, 'center', mid);

    // ---- oil temperature, vibrations
    if (fadec) {
      const ot = Math.round(e.oilTemp / 5) * 5;
      const hot = ot >= 155;
      const pulse = !hot && ot >= 140 && Math.floor(t * 2) % 2 === 0;
      tx(ctx, String(ot), x, 300, hot ? C.A : pulse ? C.dimG : C.G, 20, 'center', mid);
      const v1 = sim.get(`S:ENG${n}_VIB_N1`);
      const v2 = sim.get(`S:ENG${n}_VIB_N2`);
      vib(ctx, x, 350, v1, v1 > 6 && Math.floor(t * 2) % 2 === 0);
      vib(ctx, x, 380, v2, v2 > 4.3 && Math.floor(t * 2) % 2 === 0);
    } else {
      tx(ctx, 'XX', x, 300, C.A, 20, 'center', mid);
      tx(ctx, 'XX', x, 350, C.A, 20, 'center', mid);
      tx(ctx, 'XX', x, 380, C.A, 20, 'center', mid);
    }

    // ---- start: igniters, start valve, bleed pressure
    if (startMode) {
      const vy = 425;
      if (e.ignA) tx(ctx, 'A', x - 7, vy, C.G, 18, 'center', mid);
      if (e.ignB) tx(ctx, 'B', x + 7, vy, C.G, 18, 'center', mid);
      circle(ctx, x, vy + 30, 14, C.G, 2);
      if (fadec) {
        if (e.startValve) line(ctx, x, vy + 10, x, vy + 43, C.G, 2);
        else line(ctx, x - 14, vy + 30, x + 14, vy + 30, C.G, 2);
      } else tx(ctx, 'XX', x + 1, vy + 31, C.A, 16, 'center', mid);
      line(ctx, x, vy + 44, x, vy + 50, C.G, 2);
      const psi = Math.max(0, Math.min(512, 2 * Math.round(e.bleedPress / 2)));
      const valid = a.sdac1 || a.sdac2;
      const amber = !valid || (psi < 21 && e.n2 >= 10 && e.startValve);
      tx(ctx, valid ? String(psi) : 'XX', x, vy + 65, amber ? C.A : C.G, 20, 'center', mid);
    }
  }
}

function vib(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, dim: boolean): void {
  const [i, f] = Math.max(0, v).toFixed(1).split('.');
  const col = dim ? C.dimG : C.G;
  tx(ctx, i, x + 2, y, col, 20, 'right', 'middle');
  tx(ctx, '.' + f, x + 2, y + 1, col, 16, 'left', 'middle');
}

/** White half circle (left → top → right) of radius r centred on (x, y). */
function halfArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = C.W;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/** Partial arc of a half-circle gauge between two percentages of the scale. */
function arcValue(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fromPct: number, toPct: number, color: string, w: number): void {
  const a0 = Math.PI + (fromPct / 100) * Math.PI;
  const a1 = Math.PI + (toPct / 100) * Math.PI;
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

/** Needle of a half-circle gauge drawn between radius r0 and r1, pct in 0..100 of the scale. */
function needle(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, pct: number, color: string, w: number): void {
  const ang = Math.PI + (Math.max(0, Math.min(100, pct)) / 100) * Math.PI;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  line(ctx, x + dx * r0, y + dy * r0, x + dx * r1, y + dy * r1, color, w);
}
