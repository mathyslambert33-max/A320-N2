/**
 * SD WHEEL page (768 design space): spoilers, landing gear & doors, brake temperatures,
 * tyre pressures (TPIS), autobrake, anti-skid / N/W steering / braking mode indications.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, circle, line, pageTitle, poly, rect, relPoly, tx } from '../common';

const K = 1024 / 768;

export function drawWheelPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  drawSpoilers(ctx, sim, 133, 64);
  pageTitle(ctx, 'WHEEL', 15, 149, 36);

  const gPress = a.hydG > 1450;
  const yPress = a.hydY > 1450;
  const askidOn = a.askidNws && (a.dc1 || a.dc2 || a.dcEss);

  // N/W steering (yellow hydraulics, A/SKID & N/W STRG switch)
  const nwsAvail = sim.has('S:NWS_AVAIL') ? sim.getB('S:NWS_AVAIL') || a.towbar : askidOn && yPress;
  if (!nwsAvail || !askidOn) {
    hydBox(ctx, 271, 235, 'Y', yPress);
    tx(ctx, 'N/W STEERING', 309, 256, C.A, 26);
  }
  if (!askidOn) {
    tx(ctx, 'ANTI SKID', 302, 380, C.A, 26);
    poly(ctx, [468, 385, 490, 385, 490, 358], C.grey, 2);
    tx(ctx, '1', 473, 380, C.G, 26);
    poly(ctx, [498, 385, 520, 385, 520, 358], C.grey, 2);
    tx(ctx, '2', 502, 380, C.G, 26);
  }
  if (!gPress) {
    hydBox(ctx, 276, 393, 'G', false);
    tx(ctx, 'NORM BRK', 318, 420, C.A, 26);
    hydBox(ctx, 276, 433, 'Y', yPress);
    tx(ctx, 'ALTN BRK', 318, 461, C.G, 26);
    if (!yPress || !askidOn) {
      // ACCU ONLY
      poly(ctx, [329, 478, 343, 478, 336, 468], C.G, 2, true);
      poly(ctx, [336, 478, 336, 492, 351, 492], C.G, 2);
      tx(ctx, 'ACCU ONLY', 367, 502, C.G, 26);
    }
  }

  // Autobrake
  if (a.autobrake > 0) {
    const avail = a.bothEngRunning && gPress;
    const col = avail ? C.G : C.A;
    tx(ctx, 'AUTO BRK', 318, 570, col, 26);
    tx(ctx, ['', 'LO', 'MED', 'MAX'][a.autobrake] ?? '', 358, 602, col, 26);
  }

  // Landing gear
  const lgciu1 = a.dcEss || a.dcBat;
  const lgciu2 = a.dc2;
  const pos = (id: string) => (sim.has(`S:GEAR_${id}_POS`) ? sim.get(`S:GEAR_${id}_POS`) : 1);
  const doorsClosed = sim.has('S:GEAR_DOORS_CLOSED') ? sim.getB('S:GEAR_DOORS_CLOSED') : true;
  drawGear(ctx, 40, 272, 'left', pos('L'), doorsClosed, lgciu1, lgciu2);
  drawGear(ctx, 294, 137, 'center', pos('N'), doorsClosed, lgciu1, lgciu2);
  drawGear(ctx, 550, 272, 'right', pos('R'), doorsClosed, lgciu1, lgciu2);
  if (lgciu1 || lgciu2) {
    const transit = ['L', 'N', 'R'].some((g) => pos(g) > 0.02 && pos(g) < 0.98);
    if (transit) tx(ctx, 'L/G CTL', 326, 320, C.A, 26);
  }
  // nose wheel arches & tyre pressures
  arch(ctx, 294, 218, 'bottom', C.grey, 4);
  arch(ctx, 416, 218, 'bottom', C.grey, 4);
  const tpis = a.dc1 || a.dc2;
  const tyre = (n: number, fb: number) => (sim.has(`S:TIRE_PRESS_${n}`) ? sim.get(`S:TIRE_PRESS_${n}`) : fb);
  if (tpis) {
    tx(ctx, String(Math.round(tyre(5, 182))), 324, 250, C.G, 24, 'center');
    tx(ctx, String(Math.round(tyre(6, 180))), 446, 250, C.G, 24, 'center');
    tx(ctx, 'PSI', 385, 250, C.C, 22, 'center');
  }

  // Wheels / brakes (brake temperatures from the BSCU / BTMS)
  const bscu = a.dc1 || a.dc2 || a.dcEss;
  const temps = a.brkTemps.map((v) => Math.min(995, Math.max(0, Math.round(v / 5) * 5)));
  const hottest = Math.max(...temps);
  const fb = [198, 203, 201, 197];
  drawWheels(ctx, 36, 431, [1, 2], [temps[0], temps[1]], hottest, bscu, tpis ? [tyre(1, fb[0]), tyre(2, fb[1])] : null);
  drawWheels(ctx, 551, 431, [3, 4], [temps[2], temps[3]], hottest, bscu, tpis ? [tyre(3, fb[2]), tyre(4, fb[3])] : null);
}

function hydBox(ctx: CanvasRenderingContext2D, x: number, y: number, s: string, ok: boolean): void {
  rect(ctx, x, y, 23, 26, C.grey, 0, C.grey);
  tx(ctx, s, x + 12, y + 22, ok ? C.G : C.A, 22, 'center');
}

/** Wheel arch: SVG 'a 62 62' half circle 60 wide. */
function arch(ctx: CanvasRenderingContext2D, x: number, y: number, type: 'top' | 'bottom', color: string, w: number): void {
  // chord of 60 on a circle of radius 62: centre offset
  const r = 62;
  const h = Math.sqrt(r * r - 30 * 30);
  const cx = x + 30;
  const cy = type === 'top' ? y + h : y - h;
  const half = Math.asin(30 / r);
  ctx.beginPath();
  if (type === 'top') ctx.arc(cx, cy, r, -Math.PI / 2 - half, -Math.PI / 2 + half);
  else ctx.arc(cx, cy, r, Math.PI / 2 - half, Math.PI / 2 + half);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawWheels(
  ctx: CanvasRenderingContext2D, x: number, y: number, nums: [number, number], temps: [number, number], hottest: number,
  valid: boolean, press: [number, number] | null,
): void {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 2; i++) {
    const ox = i * 124;
    const tmp = temps[i];
    const isHot = valid && tmp === hottest;
    const topCol = isHot && tmp > 300 ? C.A : isHot && tmp > 100 ? C.G : C.grey;
    arch(ctx, ox, 0, 'top', topCol, topCol === C.grey ? 4 : 3);
    arch(ctx, ox, 103, 'bottom', C.grey, 4);
    const tx0 = i === 0 ? 57 : 181;
    if (valid) tx(ctx, String(tmp), tx0, 33, tmp > 300 ? C.A : C.G, 26, 'right');
    else tx(ctx, 'XX', tx0, 33, C.A, 26, 'right');
    tx(ctx, String(nums[i]), i === 0 ? 22 : 146, 66, C.W, 26);
    if (press) tx(ctx, String(Math.round(press[i])), i === 0 ? 30 : 154, 96, C.G, 24, 'center');
  }
  tx(ctx, '°C', 73, 32, C.C, 22);
  // "-REL-"
  line(ctx, 54, 58, 66, 58, C.W, 2);
  tx(ctx, 'REL', 92, 66, C.W, 22, 'center');
  line(ctx, 118, 58, 130, 58, C.W, 2);
  if (press) tx(ctx, 'PSI', 92, 96, C.C, 22, 'center');
  ctx.restore();
}

function drawGear(
  ctx: CanvasRenderingContext2D, x: number, y: number, loc: 'left' | 'center' | 'right', pos: number, doorsClosed: boolean,
  lgciu1: boolean, lgciu2: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  const anyValid = lgciu1 || lgciu2;
  // gear doors
  if (loc === 'center') {
    line(ctx, 0, 0, 22, 0, C.W, 2);
    line(ctx, 161, 0, 183, 0, C.W, 2);
    if (!anyValid) { tx(ctx, 'XX', 44, 6, C.A, 20); tx(ctx, 'XX', 116, 6, C.A, 20); }
    else if (doorsClosed) { line(ctx, 34, 0, 78, 0, C.G, 2); line(ctx, 106, 0, 150, 0, C.G, 2); }
    else {
      doorLine(ctx, 29, 0, 34, 78, 120);
      doorLine(ctx, 155, 0, 106, 150, -120);
    }
    circle(ctx, 29, 0, 4.5, C.W, 2);
    circle(ctx, 155, 0, 4.5, C.W, 2);
  } else {
    line(ctx, 0, 0, 24, 0, C.W, 2);
    line(ctx, 159, 0, 183, 0, C.W, 2);
    if (!anyValid) tx(ctx, 'XX', 80, 6, C.A, 20);
    else if (doorsClosed) line(ctx, 33, 0, 149, 0, C.G, 2);
    else if (loc === 'left') doorLine(ctx, 154, 0, 72, 149, -110);
    else doorLine(ctx, 29, 0, 33, 105, 110);
    circle(ctx, loc === 'left' ? 154 : 29, 0, 4.5, C.W, 2);
  }
  // position triangles (LGCIU 1 left half, LGCIU 2 right half)
  ctx.translate(60, 9);
  const notUplocked = pos > 0.02;
  const down = pos > 0.98;
  const col = down ? C.G : C.R;
  if (notUplocked) {
    if (lgciu1) {
      relPoly(ctx, 0, 0, [27, 0, 0, 37], col, 2, true);
      line(ctx, 6, 0, 6, 8, col, 2); line(ctx, 13, 0, 13, 17, col, 2); line(ctx, 20, 0, 20, 27, col, 2);
    }
    if (lgciu2) {
      relPoly(ctx, 63, 0, [-27, 0, 0, 37], col, 2, true);
      line(ctx, 43, 0, 43, 27, col, 2); line(ctx, 50, 0, 50, 17, col, 2); line(ctx, 57, 0, 57, 8, col, 2);
    }
  }
  if (!lgciu1) { line(ctx, 0, 0, 27, 0, C.A, 2); tx(ctx, 'XX', 1, 22, C.A, 22); }
  if (!lgciu2) { line(ctx, 63, 0, 36, 0, C.A, 2); tx(ctx, 'XX', 36, 22, C.A, 22); }
  ctx.restore();
}

function doorLine(ctx: CanvasRenderingContext2D, px: number, py: number, x1: number, x2: number, rotDeg: number): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((rotDeg * Math.PI) / 180);
  line(ctx, x1 - px, 0, x2 - px, 0, C.A, 2);
  ctx.restore();
}

/** Spoiler row (shared with the F/CTL page). x,y: group origin; each panel 19 px wide. */
export function drawSpoilers(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number): void {
  const L: Array<[number, number]> = [[0, 26], [50, 19], [99, 12], [147, 6], [197, 0]];
  const R: Array<[number, number]> = [[304, 0], [354, 6], [402, 12], [452, 19], [501, 26]];
  const secOn = (n: number) => (sim.has(`S:FCTL_SEC${n}_ON`) ? sim.getB(`S:FCTL_SEC${n}_ON`) : true);
  // spoiler n → SEC: 1,2 SEC3 ; 3,4 SEC1 ; 5 SEC2 (A320 allocation)
  const secOf = [0, 3, 3, 1, 1, 2];
  const hydOf = ['', 'G', 'Y', 'B', 'Y', 'G']; // hydraulic supply per spoiler pair
  const press = (h: string) => sim.get(`S:HYD_${h}_PRESS`) > 1450;
  const powered = sim.getB('S:ELEC_DC_ESS_BUS') || sim.getB('S:ELEC_DC1_BUS') || sim.getB('S:ELEC_DC2_BUS');
  for (const side of ['L', 'R'] as const) {
    const list = side === 'L' ? L : R;
    for (let i = 0; i < 5; i++) {
      const n = side === 'L' ? 5 - i : i + 1;
      const [ox, oy] = list[i];
      const px = x + ox;
      const py = y + oy;
      const valid = powered;
      const avail = valid && secOn(secOf[n]) && press(hydOf[n]);
      const defl = sim.get(`S:FCTL_SPLR_${side}${n}`);
      const out = defl > 2.5;
      const col = avail ? C.G : C.A;
      const dir = side === 'L' ? 1 : -1;
      if (valid) {
        line(ctx, px, py, px + 19 * dir, py, col, 2);
        if (out) {
          relPoly(ctx, px, py - 31, [19 * dir, 0, -9.5 * dir, -16], col, 2, true);
          if (avail) line(ctx, px + 9.5 * dir, py, px + 9.5 * dir, py - 31, C.G, 2);
        }
        if (!avail) tx(ctx, String(n), px + (side === 'L' ? 12 : -7), py - 4, C.A, 30, 'center');
      } else tx(ctx, 'X', px + (side === 'L' ? 12 : -7), py - 12, C.A, 26, 'center');
    }
  }
}
