/**
 * SD BLEED page (600 design space): engine bleed (HP / IP ports, PR valve, precooler outlet
 * pressure / temperature), cross bleed, APU bleed, GND HP connection, packs (outlet temp, bypass,
 * compressor outlet temp, flow, flow control valve), ram air, wing anti-ice, bleed users.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, arcC, circle, dirOf, gaugeAngle, line, pageTitle, poly, tx } from '../common';

const K = 1024 / 600;

/** Valve symbol: circle with a line along the flow ('V' vertical flow, 'H' horizontal flow) or across it. */
export function valve(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, pos: 'V' | 'H' | 'D', col: string, valid = true, fillBg = false): void {
  circle(ctx, x, y, r, col, 2, fillBg ? '#000' : undefined);
  if (!valid) { tx(ctx, 'XX', x + 1, y + 5, C.A, 14, 'center'); return; }
  if (pos === 'V') line(ctx, x, y - r, x, y + r, col, 2);
  else if (pos === 'H') line(ctx, x - r, y, x + r, y, col, 2);
  else line(ctx, x - 0.707 * r, y - 0.707 * r, x + 0.707 * r, y + 0.707 * r, col, 2);
}

/** Small open triangle (arrow) pointing up at (x, y) = apex. */
function tri(ctx: CanvasRenderingContext2D, x: number, y: number, col: string, rotDeg = 0, scale = 0.75): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotDeg * Math.PI) / 180);
  const s = 9 * scale;
  poly(ctx, [s, 2 * s, 0, 0, -s, 2 * s], col, 2, true);
  ctx.restore();
}

export function drawBleedPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const sdac = a.sdac1 || a.sdac2;
  pageTitle(ctx, 'BLEED', 6, 24, 28);

  const pack1 = sim.getB('S:PACK1_VALVE');
  const pack2 = sim.getB('S:PACK2_VALVE');
  const ram = sim.has('S:COND_RAM_AIR_VALVE') ? sim.getB('S:COND_RAM_AIR_VALVE') : sim.getB('C:AIR_RAM_AIR');
  const usersCol = !pack1 && !pack2 && !ram ? C.A : C.G;
  tri(ctx, 185, 24, usersCol);
  tri(ctx, 300, 24, usersCol);
  tri(ctx, 429, 24, usersCol);
  poly(ctx, [135, 62, 135, 43, 464, 43, 464, 62], usersCol, 2);

  // RAM AIR
  if (ram || !sdac) line(ctx, 300, 78, 300, 43, C.G, 2);
  valve(ctx, 300, 93, 15, ram ? 'V' : 'H', a.onGround && ram ? C.A : C.G, sdac);
  line(ctx, 300, 108, 300, 127, C.G, 2);
  tx(ctx, 'RAM', 300, 145, C.W, 20, 'center');
  tx(ctx, 'AIR', 300, 166, C.W, 20, 'center');

  // cross bleed
  const xbleed = sim.getB('S:BLEED_XBLEED_VALVE');
  const apuOpen = a.apuBleedValve;
  const apuShown = a.apuMaster || a.apuAvail;
  line(ctx, 135, 227, 135, 309, C.G, 2);
  if (xbleed || (apuOpen && apuShown)) line(ctx, 135, 267, 300, 267, C.G, 2);
  if (xbleed) { line(ctx, 300, 267, 340, 267, C.G, 2); line(ctx, 370, 267, 464, 267, C.G, 2); }
  valve(ctx, 355, 267, 15, xbleed ? 'H' : 'V', C.G, sdac);
  line(ctx, 464, 227, 464, 309, C.G, 2);

  // APU bleed valve
  if (apuShown) {
    if (apuOpen || !sdac) line(ctx, 300, 323, 300, 266, C.G, 2);
    valve(ctx, 300, 338, 15, apuOpen ? 'V' : 'H', a.apuBleedPb && !apuOpen && a.apuAvail ? C.A : C.G, sdac);
    line(ctx, 300, 353, 300, 372, C.G, 2);
    tx(ctx, 'APU', 300, 390, C.W, 20, 'center');
  }

  // ground HP air connection
  if (a.onGround) {
    tri(ctx, 248, 274, C.W);
    tx(ctx, 'GND', 250, 306, C.W, 18, 'center');
  }

  for (const n of [1, 2] as const) drawEngineBleed(ctx, sim, core, n, n === 1 ? 135 : 464, 62, sdac);
}

function drawEngineBleed(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, n: 1 | 2, x: number, y: number, sdac: boolean): void {
  const a = core.fwc.a;
  const e = a.eng[n - 1];
  const s = n === 1 ? 1 : -1;
  // pack outline & labels
  poly(ctx, [x, y, x - 47, y + 10, x - 47, y + 133, x - 33, y + 133], C.grey, 2);
  line(ctx, x - 47, y + 64, x - 33, y + 64, C.grey, 2);
  poly(ctx, [x, y, x + 47, y + 10, x + 47, y + 133, x + 33, y + 133], C.grey, 2);
  line(ctx, x + 47, y + 64, x + 33, y + 64, C.grey, 2);
  tx(ctx, 'C', x - 56, y + 70, C.W, 17, 'right');
  tx(ctx, 'H', x + 58, y + 70, C.W, 17);
  tx(ctx, 'LO', x - 55, y + 138, C.W, 17, 'right');
  tx(ctx, 'HI', x + 61, y + 138, C.W, 17);

  // pack: outlet temp, bypass valve, compressor outlet temp, flow, flow control valve
  const gy = y + 150;
  const packOpen = sim.getB(`S:PACK${n}_VALVE`);
  const outT = Math.round(sim.get(`S:PACK${n}_OUT_TEMP`) / 5) * 5;
  const compT = Math.round(sim.get(`S:PACK${n}_COMP_TEMP`) / 5) * 5;
  const bypass = sim.has(`S:PACK${n}_BYPASS`) ? sim.get(`S:PACK${n}_BYPASS`) * 100 : 50;
  const flow = sim.get(`S:PACK${n}_FLOW`) * 100;
  tx(ctx, sdac ? String(outT) : 'XX', sdac ? x + 15 : x + 12, gy - 117, sdac ? C.G : C.A, 20, 'right');
  tx(ctx, '°C', x + 20, gy - 117, C.C, 17);
  packGauge(ctx, x, gy - 69, sdac ? bypass : null, 0, 100, C.G, 50);
  tx(ctx, sdac ? String(compT) : 'XX', sdac ? x + 15 : x + 12, gy - 47, !sdac || compT > 230 ? C.A : C.G, 20, 'right');
  tx(ctx, '°C', x + 20, gy - 47, C.C, 17);
  packGauge(ctx, x, gy, sdac ? Math.max(80, flow) : null, 80, 120, packOpen ? C.G : C.A, 100);
  valve(ctx, x, gy, 15, packOpen ? 'V' : 'H', packOpen || !e.running ? C.G : C.G, sdac, true);

  // wing anti-ice
  const aiValve = sim.getB(n === 1 ? 'S:AI_WING_VALVE_L' : 'S:AI_WING_VALVE_R');
  const aiPb = a.wingAiPb;
  if (aiPb || aiValve) {
    const amber = aiValve !== aiPb || (a.onGround && aiValve);
    tri(ctx, n === 1 ? x - 41 : x + 41, y + 206, amber ? C.A : C.G, n === 1 ? -90 : 90);
  }
  if (aiPb) {
    tx(ctx, 'ANTI', n === 1 ? x - 80 : x + 42, y + 195, C.W, 18);
    tx(ctx, 'ICE', n === 1 ? x - 80 : x + 52, y + 215, C.W, 18);
  }

  // precooler outlet pressure / temperature
  poly(ctx, [x, y + 247, x - 27, y + 247, x - 27, y + 301, x + 27, y + 301, x + 27, y + 247, x, y + 247], C.grey, 2);
  tx(ctx, 'PSI', n === 1 ? x + 40 : x - 70, y + 270, C.C, 17);
  tx(ctx, '°C', n === 1 ? x + 40 : x - 70, y + 298, C.C, 17);
  const p = Math.round(sim.get(`S:BLEED_PRESS_${n}`) / 2) * 2;
  const tC = Math.round(sim.get(`S:BLEED_TEMP_${n}`) / 5) * 5;
  const running = e.running;
  tx(ctx, sdac ? String(p) : 'XX', x, y + 270, !sdac || (running && p <= 4) || p > 57 ? C.A : C.G, 20, 'center');
  const tAmber = !sdac || (running && e.bleedValve && (tC < 150 || tC > 257));
  tx(ctx, sdac ? String(tC) : 'XX', sdac ? x + 20 : x + 14, y + 295, tAmber ? C.A : C.G, 20, 'right');

  // PR valve, IP & HP ports
  const prOpen = e.bleedValve;
  const hpOpen = e.hpValve;
  const belowIdle = e.fadec && !e.running;
  if (!belowIdle && prOpen) line(ctx, x, y + 340, x, y + 303, C.G, 2);
  valve(ctx, x, y + 355, 15, prOpen ? 'V' : 'H', C.G, sdac);
  line(ctx, x, y + 415, x, y + 370, belowIdle ? C.A : C.G, 2);
  tx(ctx, 'IP', x + 2, y + 439, C.W, 17, 'center');
  valve(ctx, x + 47 * s, y + 398, 15, hpOpen ? 'H' : 'V', C.G, sdac);
  poly(ctx, [x + 92 * s, y + 415, x + 92 * s, y + 398, x + 63 * s, y + 398], belowIdle ? C.A : C.G, 2);
  tx(ctx, 'HP', x + 95 * s, y + 439, C.W, 17, 'center');
  if (hpOpen || !sdac) line(ctx, x + 33 * s, y + 398, x, y + 398, C.G, 2);
  tx(ctx, String(n), n === 1 ? x - 61 : x + 58, 432, belowIdle ? C.A : C.W, 26, n === 1 ? 'left' : 'left');
}

/** Pack gauge: 126 deg arc (radius 38) with a centre mark and a green needle. */
function packGauge(ctx: CanvasRenderingContext2D, x: number, y: number, v: number | null, min: number, max: number, col: string, markAt: number): void {
  arcC(ctx, x, y, 38, -63, 63, C.W, 2);
  const [mx, my] = dirOf(gaugeAngle(markAt, min, max, -63, 63));
  line(ctx, x + mx * 38, y + my * 38, x + mx * 38 * 1.1, y + my * 38 * 1.1, C.W, 2);
  if (v === null) { tx(ctx, 'XX', x + 12, y - 16, C.A, 17, 'right'); return; }
  const [dx, dy] = dirOf(gaugeAngle(v, min, max, -63, 63));
  line(ctx, x + dx * 15, y + dy * 15, x + dx * 38 * 1.1, y + dy * 38 * 1.1, col, 3, 'round');
}
