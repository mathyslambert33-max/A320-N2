/**
 * Overhead BAT 1 / BAT 2 voltmeters (ELEC panel): small LED windows, amber seven-segment digits
 * "25.8" + "V", supplied by the battery hot bus — readable even with the BAT pb OFF (SOP: check
 * BAT voltage > 25.5 V before selecting the batteries AUTO). "88.8" during ANN LT TEST.
 */
import { registerDisplay, drawSevenSeg } from '../../displays/framework';
import type { Sim } from '../../core/sim';

const LED = '#ffa21c';
const GHOST = 'rgba(255,140,20,0.07)';

function drawBat(ctx: CanvasRenderingContext2D, sim: Sim, n: 1 | 2): void {
  const W = 160;
  const H = 64;
  // dark smoked-glass LED window
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0806');
  g.addColorStop(1, '#040303');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const test = sim.getB('S:INTLT_ANN_TEST');
  const v = sim.get(n === 1 ? 'S:ELEC_BAT1_V' : 'S:ELEC_BAT2_V');
  const txt = test ? '88.8' : (Math.round(Math.max(0, Math.min(99.9, v)) * 10) / 10).toFixed(1).padStart(4, ' ');
  const h = 38;
  const y = (H - h) / 2;
  // measure: 3 digits + point
  ctx.save();
  ctx.shadowColor = 'rgba(255,150,30,0.55)';
  ctx.shadowBlur = 6;
  const x0 = 14;
  drawSevenSeg(ctx, txt, x0, y, h, LED, { ghost: GHOST, skew: 0.07, thickness: h * 0.12, spacing: h * 0.2 });
  // "V" legend
  ctx.strokeStyle = LED;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const vx = 124;
  const vy = y + h * 0.42;
  ctx.moveTo(vx, vy);
  ctx.lineTo(vx + 8, y + h);
  ctx.lineTo(vx + 16, vy);
  ctx.stroke();
  ctx.restore();
}

export function registerBatDisplays(): void {
  for (const n of [1, 2] as const) {
    registerDisplay({
      id: n === 1 ? 'ELEC_BAT1_V' : 'ELEC_BAT2_V',
      width: 160,
      height: 64,
      hz: 4,
      background: '#050404',
      powered: (sim) => sim.getB(n === 1 ? 'S:ELEC_HOT_BUS1' : 'S:ELEC_HOT_BUS2') && sim.get(n === 1 ? 'S:ELEC_BAT1_V' : 'S:ELEC_BAT2_V') > 8,
      brightness: (sim) => (sim.getB('S:INTLT_ANN_DIM') ? 0.6 : 1),
      draw: (ctx, sim) => drawBat(ctx, sim, n),
    });
  }
}
