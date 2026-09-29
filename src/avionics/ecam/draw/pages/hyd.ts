/**
 * SD HYD page (768 design space): GREEN / BLUE / YELLOW systems, engine driven pumps, electric
 * pumps, PTU (transfer direction arrows), RAT, fire shut-off valves, reservoirs.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, circle, line, pageTitle, poly, rect, tx } from '../common';

const K = 1024 / 768;

/** FBW-style triangle: apex at (x, y), rotated by `orient` degrees, optional fill. */
export function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, col: string, fill: boolean, orient: number, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((orient * Math.PI) / 180);
  poly(ctx, [9 * scale, 18 * scale, 0, 0, -9 * scale, 18 * scale], col, 2, true, fill ? col : undefined);
  ctx.restore();
}

const LEVELS = {
  G: { max: 14.5, low: 3.5, norm: 2.6 },
  B: { max: 6.5, low: 2.4, norm: 1.6 },
  Y: { max: 12.5, low: 3.5, norm: 2.6 },
};

export function drawHydPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  pageTitle(ctx, 'HYD', 351, 39, 36);
  const e1 = a.eng[0].n2 > 15;
  const e2 = a.eng[1].n2 > 15;
  tx(ctx, '1', 187, 404, e1 ? C.W : C.A, 36);
  tx(ctx, '2', 562, 404, e2 ? C.W : C.A, 36);

  const gFire = !a.eng[0].firePbOut;
  const yFire = !a.eng[1].firePbOut;
  hydSys(ctx, sim, 'G', 'GREEN', a.hydG, 136, 65, gFire, a.eng[0].edpPb, a.eng[0].edpOn, a.hydGQty);
  hydSys(ctx, sim, 'B', 'BLUE', a.hydB, 383, 65, false, a.bElecPb, a.bElecPumpOn, a.hydBQty);
  hydSys(ctx, sim, 'Y', 'YELLOW', a.hydY, 630, 65, yFire, a.eng[1].edpPb, a.eng[1].edpOn, a.hydYQty);

  // PTU
  const dir = sim.get('S:HYD_PTU_DIR');
  const active = a.ptuActive && dir !== 0;
  const col = a.ptuPb ? C.G : C.A;
  ctx.save();
  ctx.translate(383, 216);
  if (active) line(ctx, -132, 0, -246, 0, col, 2);
  line(ctx, -107, 0, -20, 0, col, 2);
  ctx.beginPath();
  ctx.arc(0, 0, 20, Math.PI, 0, true);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();
  line(ctx, 20, 0, 56, 0, col, 2);
  if (active) line(ctx, 177, 0, 246, 0, col, 2);
  tx(ctx, 'PTU', 92, 10, C.W, 26);
  const gToY = active && dir > 0;
  const t1 = gToY ? 90 : -90;
  const t3 = active && dir < 0 ? -90 : 90;
  triangle(ctx, t1 < 0 ? -131 : -107, 0, col, active, t1, 4 / 3);
  triangle(ctx, t1 > 0 ? 80 : 56, 0, col, active, t1, 4 / 3);
  triangle(ctx, t3 > 0 ? 177 : 153, 0, col, active, t3, 4 / 3);
  ctx.restore();

  // RAT
  const rat = a.ratDeployed > 0.1;
  tx(ctx, 'RAT', 372 - 78, 292, C.W, 26);
  if (rat) line(ctx, 372, 282, 382, 282, C.G, 2);
  triangle(ctx, 372, 282, rat ? C.G : C.W, rat, 90, 4 / 3);

  // blue electric pump supply
  tx(ctx, 'ELEC', 420, 384, a.ac1 ? C.W : C.A, 26);
  // yellow electric pump
  tx(ctx, 'ELEC', 676, 292, a.ac2 ? C.W : C.A, 26);
  const yOn = a.yElecPb;
  const yLow = a.hydY <= 1450;
  triangle(ctx, 642, 283, !yOn ? C.W : yLow ? C.A : C.G, yOn, -90, 4 / 3);
  if (yOn) line(ctx, 631, 283, 642, 283, yLow ? C.A : C.G, 2);
  line(ctx, 630, 217, 630, 283, (!a.eng[1].edpOn && !yOn) || yLow ? C.A : C.G, 2);

  tx(ctx, 'PSI', 243, 157, C.C, 22);
  tx(ctx, 'PSI', 481, 157, C.C, 22);
}

function hydSys(
  ctx: CanvasRenderingContext2D, sim: Sim, s: 'G' | 'B' | 'Y', name: string, press: number, x: number, y: number,
  fireValveOpen: boolean, pumpPb: boolean, pumpOn: boolean, qty: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  const p50 = Math.round(press / 50) * 50 >= 100 ? Math.round(press / 50) * 50 : 0;
  const sysOk = press > 1450;
  const blue = s === 'B';
  triangle(ctx, 0, 0, sysOk ? C.G : C.A, false, 0);
  tx(ctx, name, s === 'G' ? -2 : s === 'B' ? 1 : 3, 50, sysOk ? C.W : C.A, 30, 'center');
  tx(ctx, String(p50), 1, 92, p50 <= 1450 ? C.A : C.G, 30, 'center');
  line(ctx, 0, blue ? 217 : 151, 0, 103, p50 <= 1450 ? C.A : C.G, 2);

  // pump (engine driven, or blue electric pump)
  const py = blue ? 370 : 303;
  const upper = s === 'G' ? -151 : s === 'B' ? -153 : -84;
  const lowPr = !pumpOn;
  line(ctx, 0, py - 42, 0, py + upper, lowPr ? C.A : C.G, 2);
  rect(ctx, -21, py - 42, 42, 42, lowPr || !pumpPb ? C.A : C.G, 2);
  if (!lowPr && pumpPb) line(ctx, 0, py - 1, 0, py - 41, C.G, 2);
  if (!pumpPb) line(ctx, -12, py - 21, 12, py - 21, C.A, 2);
  if (lowPr && pumpPb) tx(ctx, 'LO', -13, py - 14, C.A, 22);

  const lv = LEVELS[s];
  const lowLevel = qty < lv.low;
  // fire shut-off valve (green & yellow)
  if (!blue) {
    const vy = 372;
    line(ctx, 0, vy, 0, vy - 68, fireValveOpen && !lowLevel ? C.G : C.A, 2);
    circle(ctx, 0, vy + 21, 21, fireValveOpen ? C.G : C.A, 2);
    if (fireValveOpen) line(ctx, 0, vy + 42, 0, vy, C.G, 2);
    else line(ctx, -21, vy + 21, 21, vy + 21, C.A, 2);
  }
  // reservoir
  const ry = 576;
  const pxPerL = 121 / lv.max;
  const reserveH = pxPerL * lv.low;
  const lowerNorm = -121 + pxPerL * lv.norm;
  const fluidH = -(pxPerL * Math.max(0, qty));
  line(ctx, 0, ry - 121, 0, ry + (blue ? -205 : -161), lowLevel ? C.A : C.G, 2);
  line(ctx, 0, ry - reserveH, 0, ry - 121, lowLevel ? C.A : C.W, 2);
  line(ctx, 0, ry - 121, 6, ry - 121, C.G, 2);
  line(ctx, 6, ry + lowerNorm, 6, ry - 121, C.G, 2);
  line(ctx, 0, ry + lowerNorm, 6, ry + lowerNorm, C.G, 2);
  rect(ctx, 0, ry - reserveH, 6, reserveH, C.A, 2);
  const lc = lowLevel ? C.A : C.G;
  line(ctx, 0, ry, -12, ry, lc, 2);
  line(ctx, -12, ry, -12, ry + fluidH, lc, 2);
  line(ctx, 0, ry + fluidH, -12, ry + fluidH, lc, 2);
  line(ctx, 0, ry + fluidH, -13, ry + fluidH - 11, lc, 2);
  if (sim.getB(`S:HYD_${s}_RSVR_OVHT`)) tx(ctx, 'OVHT', 20, ry - 5, C.A, 26);
  if (sim.getB(`S:HYD_${s}_RSVR_LO_AIR`)) { tx(ctx, 'LO AIR', 12, ry - 72, C.A, 26); tx(ctx, 'PRESS', 12, ry - 45, C.A, 26); }
  ctx.restore();
}
