/**
 * SD DOOR/OXY page (600 design space).
 * Doors: green outline when closed & locked, amber filled + amber label & dashed line when open.
 * SLIDE (white): escape slide armed. CKPT OXY: crew oxygen bottle pressure.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, line, pageTitle, poly, relPoly, tx } from '../common';

const K = 1024 / 600;

export function drawDoorPage(ctx: CanvasRenderingContext2D, sim: Sim, _core: EcamCore): void {
  ctx.scale(K, K);
  pageTitle(ctx, 'DOOR/OXY', 300, 23, 24, 'center');

  // fuselage (grey)
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.grey;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(267, 473); ctx.lineTo(262, 460); ctx.lineTo(262, 120); ctx.bezierCurveTo(260, 102, 276, 52, 300, 40);
  ctx.moveTo(333, 473); ctx.lineTo(338, 460); ctx.lineTo(338, 120); ctx.bezierCurveTo(340, 102, 324, 52, 300, 40);
  ctx.stroke();
  line(ctx, 262, 275, 160, 308, C.grey, 2);
  line(ctx, 338, 275, 440, 308, C.grey, 2);

  const open = (v: string) => sim.get(`G:DOOR_${v}`) > 0.02;
  const slides = sim.getB('G:SLIDES_ARMED');
  const door = (x: number, y: number, steps: number[], isOpen: boolean) =>
    relPoly(ctx, x, y, steps, isOpen ? C.A : C.G, 2, true, isOpen ? C.A : undefined);
  const dashed = (x1: number, y1: number, x2: number) => {
    ctx.save();
    ctx.setLineDash([7, 4]);
    line(ctx, x1, y1, x2, y1, C.A, 2);
    ctx.restore();
  };

  // avionics compartment hatches (always shown closed)
  door(292, 73, [0, -9, 16, 0, 0, 9], false);
  door(283, 102, [0, -15, 9, 0, 0, 15], false);
  door(317, 102, [0, -15, -9, 0, 0, 15], false);
  door(300, 181, [0, 10, 16, 0, 0, -10], false);

  // cargo doors
  const fwdCargo = open('CARGO_FWD');
  const aftCargo = open('CARGO_AFT');
  const bulk = open('CARGO_BULK');
  door(336, 221, [0, -20, -18, 0, 0, 20], fwdCargo);
  door(336, 384, [0, -20, -18, 0, 0, 20], aftCargo);
  door(328, 414, [0, -22, -8, 0, 0, 22], bulk);
  if (fwdCargo) { dashed(346, 210, 423); tx(ctx, 'CARGO', 455, 217, C.A, 18, 'center'); }
  if (aftCargo) { dashed(346, 374, 423); tx(ctx, 'CARGO', 455, 381, C.A, 18, 'center'); }
  if (bulk) { dashed(338, 404, 423); tx(ctx, 'BULK', 455, 411, C.A, 18, 'center'); }

  // passenger doors
  const l1 = open('PAX_L1');
  const r1 = open('PAX_R1');
  const l2 = open('PAX_L2');
  const r2 = open('PAX_R2');
  door(264, 145, [0, -20, 12, 0, 0, 20], l1);
  door(336, 145, [0, -20, -12, 0, 0, 20], r1);
  door(264, 445, [0, -20, 12, 0, 0, 20], l2);
  door(336, 445, [0, -20, -12, 0, 0, 20], r2);
  // over-wing emergency exits
  door(264, 310, [0, -20, 12, 0, 0, 20], false);
  door(336, 310, [0, -20, -12, 0, 0, 20], false);
  door(264, 344, [0, -20, 12, 0, 0, 20], false);
  door(336, 344, [0, -20, -12, 0, 0, 20], false);

  if (l1) { dashed(138, 136, 259); tx(ctx, 'CABIN', 103, 142, C.A, 18, 'center'); }
  if (r1) { dashed(346, 136, 423); tx(ctx, 'CABIN', 455, 142, C.A, 18, 'center'); }
  if (l2) { dashed(138, 438, 259); tx(ctx, 'CABIN', 103, 444, C.A, 18, 'center'); }
  if (r2) { dashed(346, 438, 423); tx(ctx, 'CABIN', 455, 444, C.A, 18, 'center'); }

  // SLIDE: armed escape slides (pax doors when armed, over-wing exits always armed)
  const slide = (x: number, y: number) => tx(ctx, 'SLIDE', x, y, C.W, 16, 'center');
  if (slides) {
    if (!l1) slide(232, 142);
    if (!r1) slide(368, 142);
    if (!l2) slide(232, 444);
    if (!r2) slide(368, 444);
  }
  slide(232, 326);
  slide(368, 326);

  // crew oxygen
  const powered = sim.getB('S:ELEC_DC1_BUS') || sim.getB('S:ELEC_DC_ESS_BUS') || sim.getB('S:ELEC_DC_BAT_BUS');
  const supplyOff = !sim.getB('C:OXY_CREW_SUPPLY');
  tx(ctx, 'CKPT OXY', 500, 24, supplyOff ? C.A : C.W, 20, 'center');
  const p = sim.has('S:OXY_CREW_PRESS') ? sim.get('S:OXY_CREW_PRESS') : 1850;
  if (!powered) tx(ctx, 'XX', 478, 48, C.A, 20, 'right');
  else {
    const v = Math.round(p / 10) * 10;
    const col = v < 300 ? C.A : C.G;
    tx(ctx, String(v), 478, 48, col, 20, 'right');
    if (v < 1500) poly(ctx, [424, 32, 424, 53, 482, 53], C.A, 1.5);
  }
  tx(ctx, 'PSI', 486, 48, C.C, 18, 'left');
  if (supplyOff && powered) tx(ctx, 'REGUL LO PR', 500, 72, C.A, 18, 'center');
}
