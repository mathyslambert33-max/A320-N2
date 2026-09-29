/**
 * SD APU page (600 design space): AVAIL, APU GEN (load / V / Hz), APU BLEED valve & pressure,
 * N and EGT gauges, FLAP OPEN, FUEL LO PR, LOW OIL LEVEL.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, arcC, circle, dirOf, gaugeAngle, line, pageTitle, poly, rect, tx } from '../common';

const K = 1024 / 600;

export function drawApuPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  pageTitle(ctx, 'APU', 300, 33, 24, 'center');
  const n = a.apuN;
  const ecb = a.apuMaster || n > 1 || sim.getB('S:APU_SHUTTING_DOWN');
  if (a.apuAvail) tx(ctx, 'AVAIL', 305, 85, C.G, 24, 'center');

  // ------------------------------------------------ APU GEN
  {
    const x = 105;
    const y = 100;
    const genPb = sim.getB('C:ELEC_APU_GEN');
    const standby = !a.apuMaster && !a.apuAvail;
    const off = !standby && !genPb;
    const v = sim.get('S:ELEC_APU_GEN_V');
    const hz = sim.get('S:ELEC_APU_GEN_HZ');
    const load = sim.get('S:ELEC_APU_GEN_LOAD');
    const vOk = v >= 110 && v <= 120;
    const hzOk = hz >= 390 && hz <= 410;
    const loadOk = load <= 100;
    if (sim.getB('S:ELEC_APU_GEN_ON')) poly(ctx, [x + 42, y - 8, x + 50, y - 23, x + 58, y - 8], C.G, 2, true);
    if (!standby) rect(ctx, x, y, 100, 111, C.grey, 2.5);
    const amber = (!standby && !(vOk && hzOk && loadOk)) || off;
    tx(ctx, 'APU GEN', x + 50, y + 20, amber ? C.A : C.W, 19, 'center');
    if (off) tx(ctx, 'OFF', x + 50, y + 70, C.W, 19, 'center');
    else if (!standby) {
      tx(ctx, String(Math.round(load)), x + 60, y + 55, loadOk ? C.G : C.A, 22, 'right');
      tx(ctx, String(Math.round(v)), x + 60, y + 80, vOk ? C.G : C.A, 22, 'right');
      tx(ctx, String(Math.round(hz)), x + 60, y + 105, hzOk ? C.G : C.A, 22, 'right');
      tx(ctx, '%', x + 70, y + 55, C.C, 19);
      tx(ctx, 'V', x + 70, y + 80, C.C, 19);
      tx(ctx, 'HZ', x + 70, y + 105, C.C, 19);
    }
  }

  // ------------------------------------------------ APU BLEED
  {
    const x = 420;
    const y = 153;
    const open = a.apuBleedValve;
    const disagree = a.apuBleedPb && !open && a.apuAvail && a.apuBleedPbFor > 10;
    rect(ctx, x, y, 100, 57, C.grey, 2.5);
    tx(ctx, 'BLEED', x + 50, y + 22, C.W, 19, 'center');
    const valid = ecb && n > 0;
    const p = Math.round(sim.get('S:APU_BLEED_PRESS') / 2) * 2;
    tx(ctx, valid ? String(open ? p : 0) : 'XX', x + 44, y + 48, valid ? C.G : C.A, 22, 'right');
    tx(ctx, 'PSI', x + 90, y + 48, C.C, 19, 'right');
    line(ctx, x + 50, y - 1, x + 50, y - 22, C.G, 2);
    const vc = disagree ? C.A : C.G;
    circle(ctx, x + 50, y - 40, 18, vc, 2);
    if (open) line(ctx, x + 50, y - 58, x + 50, y - 22, vc, 2);
    else line(ctx, x + 32, y - 40, x + 68, y - 40, vc, 2);
    if (open) {
      line(ctx, x + 50, y - 57, x + 50, y - 72, C.G, 2);
      poly(ctx, [x + 40, y - 72, x + 50, y - 92, x + 60, y - 72], C.G, 2, true);
    }
  }

  // separation bar
  poly(ctx, [83, 278, 83, 252, 538, 252, 538, 278], C.grey, 2);

  // ------------------------------------------------ N gauge
  {
    const x = 155;
    const y = 295;
    const cy = y + 50;
    const ang = (v: number) => gaugeAngle(v, 0, 120, 240, 60);
    const col = n < 102 ? C.G : n < 107 ? C.A : C.R;
    arcC(ctx, x, cy, 50, 240, ang(106.7), C.W, 2);
    arcC(ctx, x, cy, 50, ang(106.7), 60, C.R, 2);
    mark(ctx, x, cy, 50, ang(0), C.W, 2.5);
    mark(ctx, x, cy, 50, ang(50), C.W, 2.5);
    mark(ctx, x, cy, 50, ang(100), C.W, 2.5);
    labelAt(ctx, x, cy, 50, ang(0), '0', 3, -8);
    labelAt(ctx, x, cy, 50, ang(100), '10', 0, 10);
    outerMark(ctx, x, cy, 50, ang(102), C.A);
    tx(ctx, 'N', x + 80, y + 13, C.W, 19, 'center');
    tx(ctx, '%', x + 80, y + 43, C.C, 19, 'center');
    if (ecb) {
      const [dx, dy] = dirOf(ang(Math.round(n)));
      line(ctx, x, cy, x + dx * 57, cy + dy * 57, col, 2);
      tx(ctx, String(Math.round(n)), x + 10, y + 80, col, 22);
    } else tx(ctx, 'XX', x + 10, y + 80, C.A, 22);
  }

  // ------------------------------------------------ EGT gauge
  {
    const x = 155;
    const y = 410;
    const cy = y + 50;
    const egt = sim.get('S:APU_EGT');
    const shown = Math.round(egt / 5) * 5;
    const warning = apuEgtWarning(n);
    const ang = (v: number) => gaugeAngle(v, 300, 1100, 240, 90);
    arcC(ctx, x, cy, 50, 240, ang(warning), C.W, 2);
    arcC(ctx, x, cy, 50, ang(warning), 90, C.R, 2);
    mark(ctx, x, cy, 50, ang(300), C.W, 2.5);
    mark(ctx, x, cy, 50, ang(700), C.W, 2.5);
    mark(ctx, x, cy, 50, ang(1000), C.W, 2.5);
    labelAt(ctx, x, cy, 50, ang(300), '3', 3, -8);
    labelAt(ctx, x, cy, 50, ang(700), '7', 1, 10);
    labelAt(ctx, x, cy, 50, ang(1000), '10', -12, 3);
    outerMark(ctx, x, cy, 50, ang(warning - 33), C.A);
    tx(ctx, 'EGT', x + 80, y + 13, C.W, 19, 'center');
    tx(ctx, '°C', x + 80, y + 43, C.C, 19, 'center');
    if (ecb) {
      const col = egt > warning ? C.R : egt > warning - 33 ? C.A : C.G;
      const [dx, dy] = dirOf(ang(Math.max(300, shown)));
      line(ctx, x, cy, x + dx * 57, cy + dy * 57, col, 2);
      tx(ctx, String(shown), x + 10, y + 80, col, 22);
    } else tx(ctx, 'XX', x + 10, y + 80, C.A, 22);
  }

  // ------------------------------------------------ memos
  if (a.apuMaster && n > 5 && sim.has('S:FUEL_APU_FEED') && !sim.getB('S:FUEL_APU_FEED')) tx(ctx, 'FUEL LO PR', 370, 335, C.A, 19);
  const flap = sim.get('S:APU_FLAP_POS');
  if (flap >= 0.99) tx(ctx, 'FLAP OPEN', 370, 395, C.G, 19);
  if (sim.getB('S:APU_OIL_LOW')) tx(ctx, 'LOW OIL LEVEL', 370, 365, C.W, 19);
}

function mark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, col: string, w: number): void {
  const [dx, dy] = dirOf(ang);
  line(ctx, x + dx * r * 0.85, y + dy * r * 0.85, x + dx * r, y + dy * r, col, w);
}

function outerMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, col: string): void {
  const [dx, dy] = dirOf(ang);
  line(ctx, x + dx * r, y + dy * r, x + dx * r * 1.2, y + dy * r * 1.2, col, 4);
}

function labelAt(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, s: string, nx: number, ny: number): void {
  const [dx, dy] = dirOf(ang);
  tx(ctx, s, x + dx * r * 0.85 + nx, y + dy * r * 0.85 + ny, C.W, 17, 'center');
}

/** APU EGT red line as a function of N (APS 3200 limit law, as used by the SD APU page). */
function apuEgtWarning(n: number): number {
  if (n < 11) return 1200;
  if (n <= 15) return -((50 * n) / 3) + 1383.33;
  if (n <= 65) return -3 * n + 1165;
  if (n <= 100) return -((30 / 7) * n) + 1248.57;
  return 800;
}
