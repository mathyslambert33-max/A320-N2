/**
 * SD FUEL page, A320ceo (600 design space): fuel used, LP valves, cross-feed, APU feed, wing tank
 * pumps, centre tank pumps, outer→inner transfer valves, tank quantities & temperatures, F.FLOW, FOB.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, circle, line, pageTitle, poly, rect, tx } from '../common';
import { triangle } from './hyd';

const K = 1024 / 600;

export function drawFuelPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const fqi = a.dc1 || a.dc2 || a.dcEss || a.acEss;
  pageTitle(ctx, 'FUEL', 14, 22, 24);
  const r10 = (v: number) => Math.round(v / 10) * 10;
  const r20 = (v: number) => Math.round(v / 20) * 20;

  // ---------------------------------------------------- fuel used
  const fu1 = sim.get('S:FUEL_USED_1');
  const fu2 = sim.get('S:FUEL_USED_2');
  tx(ctx, 'F.USED', 300, 28, C.W, 19, 'center');
  tx(ctx, '1+2', 300, 50, C.W, 19, 'center');
  tx(ctx, String(r10(fu1) + r10(fu2)), 301, 76, C.G, 25, 'center');
  tx(ctx, 'KG', 301, 98, C.C, 16, 'center');
  line(ctx, 200, 31, 250, 21, C.grey, 3);
  line(ctx, 400, 31, 350, 21, C.grey, 3);
  tx(ctx, '1', 160, 41, a.eng[0].n2 > 15 ? C.W : C.A, 30, 'center');
  tx(ctx, String(r10(fu1)), 160, 68, C.G, 25, 'center');
  tx(ctx, '2', 440, 41, a.eng[1].n2 > 15 ? C.W : C.A, 30, 'center');
  tx(ctx, String(r10(fu2)), 440, 68, C.G, 25, 'center');

  // ---------------------------------------------------- wings outline
  ctx.lineCap = 'round';
  poly(ctx, [15, 255, 15, 330, 585, 330, 585, 255], C.grey, 4);
  line(ctx, 585, 255, 460.8, 233.4, C.grey, 4);
  line(ctx, 15, 255, 139.2, 233.4, C.grey, 4);
  line(ctx, 245, 215, 355, 215, C.grey, 4);
  line(ctx, 245, 215, 215.1, 220.2, C.grey, 4);
  line(ctx, 355, 215, 384.9, 220.2, C.grey, 4);
  line(ctx, 85, 243, 85, 330, C.grey, 4);
  line(ctx, 245, 215, 230, 330, C.grey, 4);
  line(ctx, 355, 215, 370, 330, C.grey, 4);
  line(ctx, 515, 243, 515, 330, C.grey, 4);

  // ---------------------------------------------------- APU feed
  const apuFirePb = a.apuFirePbOut;
  const apuRunning = a.apuN > 20;
  const apuCol = apuFirePb ? C.A : apuRunning ? C.G : C.W;
  tx(ctx, 'APU', 122, 150, apuFirePb ? C.A : C.W, 20, 'right', 'middle');
  if (!(apuFirePb && !apuRunning)) triangle(ctx, 129, 150, apuCol, apuFirePb, -90);
  if (apuRunning) line(ctx, 147, 150, 160, 150, apuCol, 2);

  // ---------------------------------------------------- engine feed, LP valves, x-feed
  for (const n of [1, 2] as const) {
    const x = n === 1 ? 160 : 440;
    line(ctx, x, 84, x, 76, C.G, 2);
    const open = sim.has(`S:FUEL_ENG${n}_LP_VALVE`) ? sim.getB(`S:FUEL_ENG${n}_LP_VALVE`) : a.eng[n - 1].master && !a.eng[n - 1].firePbOut;
    const vc = open ? C.G : C.A;
    circle(ctx, x, 100, 15, vc, 2);
    if (open) line(ctx, x, 85, x, 115, vc, 2);
    else line(ctx, x - 15, 100, x + 15, 100, vc, 2);
    line(ctx, x, 215, x, 116, C.G, 2);
    const d = n === 1 ? 1 : -1;
    line(ctx, x, 190, x + 36 * d, 190, C.G, 2);
    line(ctx, x + 35 * d, 190, x + 35 * d, 215, C.G, 2);
  }
  const xOpen = a.xfeedOpen;
  const xTransit = a.xfeedPb !== xOpen;
  const xc = xTransit ? C.A : C.G;
  circle(ctx, 300, 150, 15, xc, 2);
  if (xTransit) line(ctx, 289, 139, 311, 161, xc, 2);
  else if (xOpen) line(ctx, 285, 150, 315, 150, xc, 2);
  else line(ctx, 300, 135, 300, 165, xc, 2);
  if (xOpen) { line(ctx, 317, 150, 440, 150, C.G, 2); line(ctx, 160, 150, 283, 150, C.G, 2); }

  // ---------------------------------------------------- pumps
  const ac = [a.ac1, a.ac2];
  pump(ctx, 145, 215, a.wingPumpPb[0], ac[0] || a.acEss, true);
  pump(ctx, 180, 215, a.wingPumpPb[1], ac[1], true);
  pump(ctx, 390, 215, a.wingPumpPb[2], ac[0] || a.acEss, true);
  pump(ctx, 425, 215, a.wingPumpPb[3], ac[1], true);
  // centre tank pumps (AUTO: run when the centre tank contains fuel, after engine start / slats retracted)
  const ctrAuto = a.fuelModeAuto;
  const ctrRun = sim.has('S:FUEL_CTR_PUMPS_ON') ? sim.getB('S:FUEL_CTR_PUMPS_ON')
    : a.fuelC > 30 && a.anyEngRunning && (!ctrAuto || !a.onGround || a.slats < 1);
  for (const [i, x] of [[0, 262], [1, 308]] as const) {
    const pb = a.ctrPumpPb[i];
    const powered = ac[i];
    const running = pb && powered && ctrRun;
    pump(ctx, x, 223, pb, powered, running, true);
    if (running) {
      const lx = x + 15;
      const tx0 = i === 0 ? 196 : 404;
      poly(ctx, [lx, 223, lx, 205, tx0, 205, tx0, 190], C.G, 2);
    }
  }

  // ---------------------------------------------------- quantities
  const q = (v: number) => (fqi ? String(r20(v)) : 'XX');
  const qc = fqi ? C.G : C.A;
  tx(ctx, q(a.fuelLo), 80, 285, qc, 22, 'right', 'middle');
  tx(ctx, q(a.fuelLi), 190, 285, qc, 22, 'right', 'middle');
  tx(ctx, q(a.fuelC), 330, 315, qc, 22, 'right', 'middle');
  tx(ctx, q(a.fuelRi), 472, 285, qc, 22, 'right', 'middle');
  tx(ctx, q(a.fuelRo), 580, 285, qc, 22, 'right', 'middle');
  if (sim.getB('S:FUEL_OUTER_XFR_L')) triangle(ctx, 77, 319, C.G, false, 90);
  if (sim.getB('S:FUEL_OUTER_XFR_R')) triangle(ctx, 522, 319, C.G, false, -90);
  const tl = sim.has('S:FUEL_TEMP_L') ? sim.get('S:FUEL_TEMP_L') : sim.get('G:ENV_OAT');
  const tr = sim.has('S:FUEL_TEMP_R') ? sim.get('S:FUEL_TEMP_R') : sim.get('G:ENV_OAT');
  tx(ctx, String(Math.round(tl)), 66, 355, C.G, 19, 'right');
  tx(ctx, '°C', 70, 355, C.C, 16);
  tx(ctx, String(Math.round(tr)), 506, 355, C.G, 19, 'right');
  tx(ctx, '°C', 510, 355, C.C, 16);

  // ---------------------------------------------------- F.FLOW / FOB
  const ffMin = (a.eng[0].ff + a.eng[1].ff) / 60;
  tx(ctx, 'F.FLOW', 46, 443, C.W, 20, 'center');
  tx(ctx, '1+2', 46, 461, C.W, 20, 'center');
  tx(ctx, ':', 83, 461, C.W, 18);
  tx(ctx, String(Math.round(ffMin)), 201, 455, C.G, 18, 'right', 'middle');
  tx(ctx, 'KG/MIN', 215, 455, C.C, 16, 'left', 'middle');
  poly(ctx, [5, 499, 5, 469, 255, 469, 255, 499], C.grey, 4, true);
  tx(ctx, 'FOB', 18, 491, C.W, 22);
  tx(ctx, ':', 83, 490, C.W, 22);
  tx(ctx, fqi ? String(r20(a.fob)) : 'XX', 204, 485, qc, 22, 'right', 'middle');
  tx(ctx, 'KG', 215, 487, C.C, 16, 'left', 'middle');
}

/**
 * Pump symbol: green box + vertical line when running; box + horizontal line when stopped
 * (green if normally stopped in AUTO, amber if the pb is OFF); amber "LO" when not powered.
 */
function pump(ctx: CanvasRenderingContext2D, x: number, y: number, pb: boolean, powered: boolean, running: boolean, _ctr = false): void {
  const on = pb && powered && running;
  const col = on || (pb && powered) ? C.G : C.A;
  rect(ctx, x, y, 30, 30, col, 2);
  if (!powered) { tx(ctx, 'LO', x + 15, y + 20, C.A, 16, 'center'); return; }
  if (on) line(ctx, x + 15, y, x + 15, y + 30, col, 2);
  else line(ctx, x + 5, y + 15, x + 25, y + 15, col, 2);
}
