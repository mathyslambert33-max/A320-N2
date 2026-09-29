/**
 * SD F/CTL page (768 design space): spoilers / speed brakes, ailerons, elevators, pitch trim,
 * rudder with trim and travel limiter, ELAC / SEC status, hydraulic supply of every actuator.
 *
 * Surface deflection sign convention (docs/SIMVARS.md does not specify it): ailerons and elevators
 * + = trailing edge DOWN, rudder + = trailing edge RIGHT (S:FCTL_RUD_TRIM + = right).
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, line, pageTitle, poly, rect, tx } from '../common';
import { drawSpoilers } from './wheel';

const K = 1024 / 768;

type Hyd = 'G' | 'B' | 'Y';

export function drawFctlPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const press: Record<Hyd, boolean> = { G: a.hydG > 1450, B: a.hydB > 1450, Y: a.hydY > 1450 };
  const on = (id: string) => (sim.has(id) ? sim.getB(id) : a.dcEss || a.dc1 || a.dc2);
  const elac = [on('S:FCTL_ELAC1_ON'), on('S:FCTL_ELAC2_ON')];
  const sec = [on('S:FCTL_SEC1_ON'), on('S:FCTL_SEC2_ON'), on('S:FCTL_SEC3_ON')];
  // FCDC (flight control data concentrators) supplied by DC ESS / DC 2: without them no position data
  const fcdc = a.dcEss || a.dc2 || a.dc1;

  pageTitle(ctx, 'F/CTL', 8, 33, 36);

  // ---- wings / speed brakes
  ctx.save();
  ctx.translate(124, 11);
  tx(ctx, 'SPD BRK', 262, 124, C.W, 25, 'center');
  hydBox(ctx, 225, 0, 'G', press.G);
  hydBox(ctx, 250, 0, 'B', press.B);
  hydBox(ctx, 275, 0, 'Y', press.Y);
  poly(ctx, [0, 60, 0, 54, 182, 24, 182, 30], C.grey, 2);
  poly(ctx, [49, 119, 49, 125, 184, 111, 184, 105], C.grey, 2);
  poly(ctx, [519, 60, 519, 54, 337, 24, 337, 30], C.grey, 2);
  poly(ctx, [470, 119, 470, 125, 335, 111, 335, 105], C.grey, 2);
  ctx.restore();
  if (fcdc) drawSpoilers(ctx, sim, 133, 100);

  // ---- computers
  tx(ctx, 'ELAC', 221, 226, C.W, 22);
  computer(ctx, 215, 234, 1, elac[0]);
  computer(ctx, 245, 252, 2, elac[1]);
  tx(ctx, 'SEC', 408, 226, C.W, 22);
  computer(ctx, 395, 234, 1, sec[0]);
  computer(ctx, 425, 252, 2, sec[1]);
  computer(ctx, 455, 270, 3, sec[2]);

  // ---- ailerons (L: B + G, R: G + B)
  const ailAvail = (elac[0] || elac[1]) && (press.G || press.B);
  aileron(ctx, 88, 197, 'left', sim.get('S:FCTL_AIL_L'), fcdc, ailAvail, ['B', 'G'], press);
  aileron(ctx, 678, 197, 'right', sim.get('S:FCTL_AIL_R'), fcdc, ailAvail, ['G', 'B'], press);

  // ---- elevators (L: B + G, R: Y + B)
  const elevCtl = elac[0] || elac[1] || sec[0] || sec[1];
  elevator(ctx, 212, 424, 'left', sim.get('S:FCTL_ELEV_L'), fcdc, elevCtl && (press.B || press.G), ['B', 'G'], press);
  elevator(ctx, 555, 424, 'right', sim.get('S:FCTL_ELEV_R'), fcdc, elevCtl && (press.Y || press.B), ['Y', 'B'], press);

  // ---- pitch trim (THS, G + Y)
  pitchTrim(ctx, 356, 350, a.ths, fcdc, press.G || press.Y, press);

  // ---- rudder (G, B, Y)
  rudder(ctx, sim, 384, 454, fcdc, press, a.rudTrim, a.ias);
}

function hydBox(ctx: CanvasRenderingContext2D, x: number, y: number, s: Hyd, ok: boolean): void {
  rect(ctx, x, y, 23, 27, C.grey, 0, C.grey);
  tx(ctx, s, x + 11.5, y + 23, ok ? C.G : C.A, 25, 'center');
}

function computer(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, ok: boolean): void {
  const col = ok ? C.G : C.A;
  poly(ctx, [x, y, x + 97, y, x + 97, y - 33, x + 87, y - 33], col, 2);
  tx(ctx, String(n), x + 76, y - 7, col, 25);
}

function cursorPath(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 1 | -1, col: string): void {
  poly(ctx, [x, y, x + 15 * dir, y - 9, x + 15 * dir, y + 9], col, 3, true);
}

/** Vertical axis: SVG "M0 top l∓6 0 l0 -h ..." shape used by aileron and elevator scales. */
function axis(ctx: CanvasRenderingContext2D, side: 'left' | 'right', y0: number, y1: number, marks: Array<[number, number]>): void {
  const s = side === 'left' ? -1 : 1;
  poly(ctx, [6 * s, y0 + 12, 0, y0 + 12, 0, y0, 6 * s, y0], C.W, 3);
  poly(ctx, [0, y0, 0, y1], C.W, 3);
  poly(ctx, [0, y1, 6 * s, y1, 6 * s, y1 - 11, 0, y1 - 11], C.W, 3);
  for (const [ya, yb] of marks) {
    if (ya === yb) line(ctx, 0, ya, 6 * s, ya, C.W, 3, 'round');
    else poly(ctx, [0, ya, 6 * s, ya, 6 * s, yb, 0, yb], C.W, 3);
  }
}

function aileron(
  ctx: CanvasRenderingContext2D, x: number, y: number, side: 'left' | 'right', deg: number, valid: boolean, avail: boolean,
  hyd: [Hyd, Hyd], press: Record<Hyd, boolean>,
): void {
  ctx.save();
  ctx.translate(x, y);
  const tpx = side === 'left' ? -53 : 54;
  tx(ctx, side === 'left' ? 'L' : 'R', tpx, 0, C.W, 28, 'center');
  tx(ctx, 'AIL', tpx, 26, C.W, 25, 'center');
  // axis (FBW-derived: top -17, bottom 130, neutral marks)
  axis(ctx, side, -17, 130, [[54, 54], [60, 60], [67, 73]]);
  const dir = side === 'left' ? 1 : -1;
  if (valid) {
    const off = Math.max(-25, Math.min(25, deg)) * (68.5 / 25);
    cursorPath(ctx, 0, 57 + off, dir, avail ? C.G : C.A);
  } else tx(ctx, 'XX', side === 'left' ? 26 : -26, 74, C.A, 22, 'center');
  hydBox(ctx, side === 'left' ? 27 : -75, 96, hyd[0], press[hyd[0]]);
  hydBox(ctx, side === 'left' ? 52 : -50, 96, hyd[1], press[hyd[1]]);
  ctx.restore();
}

function elevator(
  ctx: CanvasRenderingContext2D, x: number, y: number, side: 'left' | 'right', deg: number, valid: boolean, avail: boolean,
  hyd: [Hyd, Hyd], press: Record<Hyd, boolean>,
): void {
  ctx.save();
  ctx.translate(x, y);
  const tpx = side === 'left' ? -59 : 62;
  tx(ctx, side === 'left' ? 'L' : 'R', tpx, 0, C.W, 28, 'center');
  tx(ctx, 'ELEV', tpx, 27, C.W, 25, 'center');
  axis(ctx, side, -20, 128, [[74, 80]]);
  const dir = side === 'left' ? 1 : -1;
  if (valid) {
    const off = Math.max(-30, Math.min(17, deg)) * (90 / 30);
    cursorPath(ctx, 0, 77 + off, dir, avail ? C.G : C.A);
  } else tx(ctx, 'XX', side === 'left' ? 26 : -26, 76, C.A, 22, 'center');
  hydBox(ctx, side === 'left' ? -78 : 28, 91, hyd[0], press[hyd[0]]);
  hydBox(ctx, side === 'left' ? -53 : 53, 91, hyd[1], press[hyd[1]]);
  ctx.restore();
}

function pitchTrim(ctx: CanvasRenderingContext2D, x: number, y: number, ths: number, valid: boolean, avail: boolean, press: Record<Hyd, boolean>): void {
  ctx.save();
  ctx.translate(x, y);
  tx(ctx, 'PITCH TRIM', 0, 22, C.W, 25, 'center');
  poly(ctx, [-15, 96, -87, 105, -87, 77, -49, 58], C.grey, 2);
  poly(ctx, [70, 96, 142, 105, 142, 77, 104, 58], C.grey, 2);
  if (valid) {
    const col = avail ? C.G : C.A;
    const v = Math.abs(ths);
    const [i, f] = v.toFixed(1).split('.');
    tx(ctx, i, -1, 53, col, 29, 'right');
    tx(ctx, '.', 4, 53, col, 26, 'center');
    tx(ctx, f, 21, 53, col, 22, 'center');
    tx(ctx, '°', 41, 60, C.C, 36, 'center');
    if (v > 0.05) tx(ctx, ths > 0 ? 'UP' : 'DN', 74, 52, col, 22, 'center');
  } else tx(ctx, 'XX', 28, 50, C.A, 29, 'center');
  hydBox(ctx, 102, 0, 'G', press.G);
  hydBox(ctx, 128, 0, 'Y', press.Y);
  ctx.restore();
}

function rudder(
  ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, valid: boolean, press: Record<Hyd, boolean>, trim: number, ias: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  tx(ctx, 'RUD', -1, 0, C.W, 25, 'center');
  hydBox(ctx, -38, 14, 'G', press.G);
  hydBox(ctx, -13, 14, 'B', press.B);
  hydBox(ctx, 12, 14, 'Y', press.Y);
  // scale arc: centre (0, 26) radius 122 → endpoints (±66, 131)
  const cy = 26;
  const r = 122;
  const half = Math.asin(66 / r);
  ctx.beginPath();
  ctx.arc(0, cy + (131 - cy - r * Math.cos(half)), r, Math.PI / 2 - half, Math.PI / 2 + half);
  ctx.strokeStyle = C.W;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
  poly(ctx, [-3, 151, -3, 157, 2, 157, 2, 151], C.W, 3);
  const rot = (deg: number, draw: () => void) => {
    ctx.save();
    ctx.translate(0, cy);
    ctx.rotate((-deg * Math.PI) / 180);
    ctx.translate(0, -cy);
    draw();
    ctx.restore();
  };
  // mechanical stops (±25°)
  rot(25, () => poly(ctx, [-4.5, 151, -4.5, 157, 4.5, 157, 4.5, 151], C.W, 3));
  rot(-25, () => poly(ctx, [-4.5, 151, -4.5, 157, 4.5, 157, 4.5, 151], C.W, 3));
  // travel limiter (FAC): 25° up to 160 kt, reducing to 3.4° at 380 kt
  const facOk = (sim.has('S:FCTL_FAC1_ON') ? sim.getB('S:FCTL_FAC1_ON') : true) || (sim.has('S:FCTL_FAC2_ON') ? sim.getB('S:FCTL_FAC2_ON') : true);
  const lim = travelLimit(ias);
  if (valid) {
    rot(lim, () => poly(ctx, [0, 151, 0, 172, -7, 172], facOk ? C.G : C.A, 3));
    rot(-lim, () => poly(ctx, [0, 151, 0, 172, 7, 172], facOk ? C.G : C.A, 3));
  } else {
    tx(ctx, 'TLU', -82, 180, C.A, 24, 'center');
    tx(ctx, 'TLU', 84, 180, C.A, 24, 'center');
  }
  // rudder position cursor
  const avail = press.G || press.B || press.Y;
  if (valid) {
    const d = Math.max(-25, Math.min(25, sim.get('S:FCTL_RUDDER')));
    const col = avail ? C.G : C.A;
    rot(d, () => {
      ctx.beginPath();
      ctx.arc(0, 93, 9, Math.PI, 0);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      poly(ctx, [-9, 93, 0, 150, 9, 93], col, 3);
    });
    // rudder trim index (cyan)
    rot(Math.max(-20, Math.min(20, trim)), () => line(ctx, 0, 159, 0, 170, C.C, 4, 'round'));
  } else tx(ctx, 'XX', 0, 110, C.A, 29, 'center');
  ctx.restore();
}

function travelLimit(ias: number): number {
  if (ias <= 160) return 25;
  if (ias >= 380) return 3.4;
  // approximate FAC law between 160 and 380 kt
  const k = (ias - 160) / 220;
  return 25 - (25 - 3.4) * Math.sqrt(k);
}
