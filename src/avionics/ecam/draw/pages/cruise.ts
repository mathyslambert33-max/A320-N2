/**
 * SD CRUISE page (600 design space): ENG (fuel used, oil quantity, vibrations) and
 * AIR (landing elevation, delta P, cabin V/S, cabin altitude, cabin zone temperatures).
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, line, poly, tx } from '../common';

const K = 1024 / 600;

export function drawCruisePage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const pulse = Math.floor(t * 2) % 2 === 0;
  sub(ctx, 'CRUISE', 300, 20, 24);
  sub(ctx, 'ENG', 50, 60, 22);

  // ---- fuel used
  tx(ctx, 'F.USED', 300, 70, C.W, 17, 'center');
  tx(ctx, '1+2', 300, 90, C.W, 17, 'center');
  const fu = [0, 1].map((i) => Math.round(sim.get(`S:FUEL_USED_${i + 1}`) / 10) * 10);
  for (const i of [0, 1]) {
    const x = i === 0 ? 210 : 455;
    if (a.eng[i].fadec) tx(ctx, String(fu[i]), x, 95, C.G, 20, 'right');
    else tx(ctx, 'XX', x, 95, C.A, 20, 'right');
  }
  const bothFadec = a.eng[0].fadec && a.eng[1].fadec;
  tx(ctx, bothFadec ? String(fu[0] + fu[1]) : 'XX', 300, 112, bothFadec ? C.G : C.A, 20, 'center');
  tx(ctx, 'KG', 300, 132, C.C, 17, 'center');
  wing(ctx, 80);

  // ---- oil quantity, vibrations
  tx(ctx, 'OIL', 300, 160, C.W, 17, 'center');
  tx(ctx, 'QT', 300, 180, C.C, 16, 'center');
  wing(ctx, 170);
  tx(ctx, 'VIB N1', 300, 220, C.W, 17, 'center');
  tx(ctx, 'N2', 312, 250, C.W, 17);
  wing(ctx, 220);
  wing(ctx, 250);
  for (const i of [0, 1]) {
    const e = a.eng[i];
    const x = i === 0 ? 195 : 440;
    if (!e.fadec) {
      tx(ctx, 'XX', x, 185, C.A, 20, 'right');
      tx(ctx, 'XX', x, 235, C.A, 20, 'right');
      tx(ctx, 'XX', x, 265, C.A, 20, 'right');
      continue;
    }
    const q = Math.round(e.oilQty * 2) / 2;
    split(ctx, q, x, 185, q <= 5 && pulse ? C.dimG : C.G);
    const v1 = Math.max(0, sim.get(`S:ENG${i + 1}_VIB_N1`));
    const v2 = Math.max(0, sim.get(`S:ENG${i + 1}_VIB_N2`));
    split(ctx, v1, x, 235, v1 > 6 && pulse ? C.dimG : C.G);
    split(ctx, v2, x, 265, v2 > 4.3 && pulse ? C.dimG : C.G);
  }

  // ---- AIR
  sub(ctx, 'AIR', 50, 330, 22);
  const valid = a.sdac1 || a.sdac2;
  if (!a.pressModeMan) {
    const le = sim.has('S:PRESS_LDG_ELEV') ? sim.get('S:PRESS_LDG_ELEV') : sim.has('S:FMGS_DEST_ELEV') ? sim.get('S:FMGS_DEST_ELEV') : -6000;
    tx(ctx, 'LDG ELEV', 330, 335, C.W, 17, 'center');
    tx(ctx, a.ldgElevMan ? 'MAN' : 'AUTO', 385, 335, C.G, 17);
    tx(ctx, le > -5000 ? String(Math.round(le / 50) * 50) : 'XX', 525, 335, le > -5000 ? C.G : C.A, 20, 'right');
    tx(ctx, 'FT', 530, 335, C.C, 17);
  }
  // delta P
  const dp = sim.get('S:PRESS_DELTA_P');
  const dpAmber = dp >= 8.5 || dp <= -0.4;
  tx(ctx, 'ΔP', 218, 370, C.W, 17);
  if (valid) {
    const [di, df] = Math.abs(dp).toFixed(1).split('.');
    const col = dpAmber ? C.A : C.G;
    tx(ctx, (dp < 0 ? '-' : '') + di + '.', 290, 370, col, 20, 'right');
    tx(ctx, df, 290, 370, col, 17);
  } else tx(ctx, 'XX', 290, 370, C.A, 20, 'right');
  tx(ctx, 'PSI', 320, 370, C.C, 17);
  // cabin V/S
  const vs = sim.get('S:PRESS_CAB_VS');
  const vs50 = Math.round(vs / 50) * 50;
  tx(ctx, 'CAB V/S', 480, 380, C.W, 17);
  if (valid) {
    const col = Math.abs(vs) > 1750 && pulse ? C.dimG : C.G;
    tx(ctx, String(a.pressModeMan ? vs50 : Math.abs(vs50)), 515, 405, col, 20, 'right');
    if (!a.pressModeMan && Math.abs(vs50) >= 50) {
      // climb / descent arrow
      ctx.save();
      if (vs50 < 0) { ctx.translate(0, 795); ctx.scale(1, -1); }
      poly(ctx, [433, 405, 440, 405, 446, 395], C.G, 1.5);
      ctx.translate(452, 388);
      ctx.rotate((38 * Math.PI) / 180);
      poly(ctx, [0, 0, -5, 8, 5, 8], C.G, 1.5, true, C.G);
      ctx.restore();
    }
  } else tx(ctx, 'XX', 515, 405, C.A, 20, 'right');
  tx(ctx, 'FT/MIN', 525, 405, C.C, 16);
  // cabin altitude
  const ca = sim.get('S:PRESS_CAB_ALT');
  tx(ctx, 'CAB ALT', 480, 450, C.W, 17);
  if (valid) {
    const v = Math.max(0, Math.round(ca / 50) * 50);
    const col = ca >= 9550 ? (pulse ? C.R : '#801010') : ca > 8800 && pulse ? C.dimG : C.G;
    tx(ctx, String(v), 515, 475, col, 20, 'right');
  } else tx(ctx, 'XX', 515, 475, C.A, 20, 'right');
  tx(ctx, 'FT', 525, 475, C.C, 16);

  // ---- cabin temperatures
  ctx.strokeStyle = C.W;
  ctx.lineWidth = 2;
  ctx.beginPath();
  // FBW-derived cabin outline: "M300 410 a70 70 0 0 0 -30 -5 l-180 0 m30 0 l0 50 l85 0 l0 -10 m0 10 l85 0 l0 -48 m-170 48 l-30 0 c-60 0 -60 -20 -45 -25"
  ctx.moveTo(300, 410);
  ctx.quadraticCurveTo(285, 405, 270, 405);
  ctx.lineTo(90, 405);
  ctx.moveTo(120, 405);
  ctx.lineTo(120, 455);
  ctx.lineTo(205, 455);
  ctx.lineTo(205, 445);
  ctx.moveTo(205, 455);
  ctx.lineTo(290, 455);
  ctx.lineTo(290, 407);
  ctx.moveTo(120, 455);
  ctx.lineTo(90, 455);
  ctx.bezierCurveTo(30, 455, 30, 435, 45, 430);
  ctx.stroke();
  const temp = (z: string) => {
    const v = sim.get(`S:COND_${z}_TEMP`);
    return valid ? String(Math.round(v)) : 'XX';
  };
  tx(ctx, 'CKPT', 55, 425, C.W, 17);
  tx(ctx, temp('CKPT'), 75, 448, valid ? C.G : C.A, 17);
  tx(ctx, 'FWD', 145, 425, C.W, 17);
  tx(ctx, temp('FWD'), 150, 448, valid ? C.G : C.A, 17);
  tx(ctx, 'AFT', 245, 425, C.W, 17);
  tx(ctx, temp('AFT'), 235, 448, valid ? C.G : C.A, 17);
  tx(ctx, '°C', 310, 455, C.C, 16);
}

function sub(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, px: number): void {
  tx(ctx, s, x, y, C.W, px, 'center');
  ctx.font = `${px}px B612`;
  const w = ctx.measureText(s).width;
  line(ctx, x - w / 2, y + 3, x + w / 2, y + 3, C.W, 1.5);
}

function wing(ctx: CanvasRenderingContext2D, y: number): void {
  line(ctx, 230, y, 250, y - 2, C.W, 1.5);
  line(ctx, 370, y, 350, y - 2, C.W, 1.5);
}

/** "12.5" with a smaller decimal part; integer part right aligned at x+2. */
function split(ctx: CanvasRenderingContext2D, v: number, x: number, y: number, col: string): void {
  const [i, f] = v.toFixed(1).split('.');
  tx(ctx, i + '.', x + 2, y, col, 20, 'right');
  tx(ctx, f, x + 2, y, col, 17);
}
