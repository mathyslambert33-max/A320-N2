/**
 * SD COND page (768 design space): zone temperatures, duct temperatures, trim air valve positions,
 * hot air pressure regulating valve, cabin fans.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, circle, line, pageTitle, poly, tx } from '../common';

const K = 1024 / 768;

export function drawCondPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  pageTitle(ctx, 'COND', 7, 33, 36);
  tx(ctx, 'TEMP', 630, 32, C.W, 30);
  tx(ctx, ':', 715, 32, C.W, 30);
  tx(ctx, '°C', 726, 31, C.C, 22);
  const fansOff = !sim.getB('C:VENT_CAB_FANS') && (a.ac1 || a.ac2);
  if (fansOff) { tx(ctx, 'FAN', 180, 75, C.A, 26); tx(ctx, 'FAN', 510, 75, C.A, 26); }

  // aircraft outline
  ctx.strokeStyle = C.grey;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(95, 128); ctx.lineTo(122, 119); ctx.lineTo(133, 107);
  ctx.quadraticCurveTo(150, 94, 173, 94);
  ctx.lineTo(603, 94); ctx.lineTo(615, 104);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(94, 172); ctx.quadraticCurveTo(122, 188, 154, 190); ctx.lineTo(174, 190);
  ctx.moveTo(223, 190); ctx.lineTo(345, 190);
  ctx.moveTo(394, 190); ctx.lineTo(514, 190);
  ctx.moveTo(564, 190); ctx.lineTo(602, 190); ctx.lineTo(614, 180);
  ctx.stroke();
  line(ctx, 278, 94, 278, 190, C.grey, 2);
  line(ctx, 457, 190, 457, 136, C.grey, 2);

  const hotPb = sim.getB('C:AIR_HOT_AIR');
  const hotOpen = sim.has('S:COND_HOT_AIR_VALVE') ? sim.getB('S:COND_HOT_AIR_VALVE') : hotPb && (sim.getB('S:PACK1_VALVE') || sim.getB('S:PACK2_VALVE'));
  const hotAmber = !hotPb || (hotPb !== hotOpen && (sim.getB('S:PACK1_VALVE') || sim.getB('S:PACK2_VALVE')));
  const zones: Array<[string, string, string, number]> = [['CKPT', 'CKPT', 'CKPT', 153], ['FWD', 'FWD', 'FWD', 324], ['AFT', 'AFT', 'AFT', 494]];
  for (const [title, z, ctl, x] of zones) {
    const cab = sim.get(`S:COND_${z}_TEMP`);
    const duct = sim.get(`S:COND_${z}_DUCT`);
    const trim = sim.has(`S:COND_${z}_TRIM`) ? sim.get(`S:COND_${z}_TRIM`) * 100 : sim.get(`C:AIR_TEMP_${ctl}`) * 100;
    condUnit(ctx, title, x, 105, cab, duct, trim, hotAmber, a.sdac1 || a.sdac2);
  }

  // hot air valve & manifold
  const hc = hotAmber ? C.A : C.G;
  tx(ctx, 'HOT', 706, 306, C.W, 24);
  tx(ctx, 'AIR', 706, 336, C.W, 24);
  circle(ctx, 650, 312, 21, hc, 2);
  if (hotOpen) line(ctx, 629, 312, 671, 312, hc, 2);
  else line(ctx, 650, 291, 650, 333, hc, 2);
  line(ctx, 195, 312, 627, 312, hc, 2);
  line(ctx, 672, 312, 696, 312, hc, 2);
}

function condUnit(ctx: CanvasRenderingContext2D, title: string, x: number, y: number, cab: number, duct: number, trimPct: number, hotAmber: boolean, valid: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  tx(ctx, title, 47, 23, C.W, 26, 'center');
  tx(ctx, valid ? cab.toFixed(0) : 'XX', 26, 56, valid ? C.G : C.A, 26);
  tx(ctx, valid ? duct.toFixed(0) : 'XX', 29, 106, !valid || duct > 80 ? C.A : C.G, 22);
  tx(ctx, 'C', -2, 147, C.W, 22);
  tx(ctx, 'H', 74, 146, C.W, 22);
  // trim valve gauge (-43..+43 deg)
  const rot = -43 + (Math.max(0, Math.min(100, trimPct)) * 86) / 100;
  ctx.save();
  ctx.translate(42, 158);
  ctx.rotate((rot * Math.PI) / 180);
  poly(ctx, [-5, -21, 5, -21, 0, -30], C.G, 2, true);
  line(ctx, 0, 0, 0, -20, C.G, 2);
  ctx.restore();
  line(ctx, 42, 207, 42, 158, hotAmber ? C.A : C.G, 2);
  ctx.beginPath();
  ctx.arc(42, 157, 30, (-135 * Math.PI) / 180, (-45 * Math.PI) / 180);
  ctx.strokeStyle = C.W;
  ctx.lineWidth = 2;
  ctx.stroke();
  line(ctx, 42, 118, 42, 127, C.W, 2);
  ctx.restore();
}
