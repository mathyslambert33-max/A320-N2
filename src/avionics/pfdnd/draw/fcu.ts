/**
 * FCU LCD windows (SPD/MACH, HDG/TRK + LAT, ALT + LVL/CH + HDG-V/S / TRK-FPA indication, V/S-FPA)
 * and the EFIS baro windows. Orange LCD segments on a black background; ANN LT TEST lights every
 * segment and legend.
 */
import type { Sim } from '../../../core/sim';
import { drawSevenSeg, FONT } from '../../../displays/framework';
import { toInHg } from '../logic/fcu';
import { type Ctx, txt, fillRect } from './common';

export const LCD = { on: '#f39a1c', ghost: 'rgba(243,154,28,0.06)', bg: '#070605' };

const test = (sim: Sim) => sim.getB('S:INTLT_ANN_TEST');

function label(ctx: Ctx, s: string, x: number, y: number, lit: boolean, size = 20, align: CanvasTextAlign = 'left'): void {
  if (!lit) return;
  txt(ctx, s, x, y, LCD.on, size, align);
  ctx.font = `${size}px ${FONT.du}`;
}

function dot(ctx: Ctx, x: number, y: number, lit: boolean): void {
  if (!lit) return;
  ctx.fillStyle = LCD.on;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fill();
}

function digits(ctx: Ctx, s: string, x: number, y: number, h = 62): void {
  drawSevenSeg(ctx, s, x, y, h, LCD.on, { ghost: LCD.ghost, skew: 0.06, thickness: h * 0.12, spacing: h * 0.22 });
}

export function drawFcuSpd(ctx: Ctx, sim: Sim): void {
  fillRect(ctx, 0, 0, 256, 128, LCD.bg);
  const T = test(sim);
  const mach = sim.getB('S:FCU_SPD_IS_MACH');
  label(ctx, 'SPD', 34, 30, T || !mach);
  label(ctx, 'MACH', 100, 30, T || mach);
  let s: string;
  const managed = sim.getB('S:FCU_SPD_MANAGED') && !sim.getB('S:FCU_SPD_PRESET');
  if (T) s = '888';
  else if (managed) s = '---';
  else if (mach) s = `0.${String(Math.round(sim.get('S:FCU_SPD'))).padStart(2, '0')}`;
  else s = String(Math.round(sim.get('S:FCU_SPD'))).padStart(3, '0');
  digits(ctx, s, 34, 48);
  dot(ctx, 218, 80, T || sim.getB('S:FCU_SPD_DOT'));
}

export function drawFcuHdg(ctx: Ctx, sim: Sim): void {
  fillRect(ctx, 0, 0, 384, 128, LCD.bg);
  const T = test(sim);
  const trk = sim.getB('S:FCU_TRK_FPA');
  label(ctx, 'HDG', 60, 30, T || !trk);
  label(ctx, 'TRK', 130, 30, T || trk);
  label(ctx, 'LAT', 270, 30, true);
  const s = T ? '888' : sim.getB('S:FCU_HDG_DASHES') ? '---' : String(Math.round(sim.get('S:FCU_HDG')) % 360).padStart(3, '0');
  digits(ctx, s, 60, 48);
  dot(ctx, 250, 80, T || sim.getB('S:FCU_HDG_DOT'));
}

export function drawFcuAlt(ctx: Ctx, sim: Sim): void {
  fillRect(ctx, 0, 0, 512, 128, LCD.bg);
  const T = test(sim);
  const trk = sim.getB('S:FCU_TRK_FPA');
  // HDG-V/S / TRK-FPA indication (left part of the window).
  label(ctx, 'HDG', 14, 48, T || !trk, 19);
  label(ctx, 'V/S', 14, 78, T || !trk, 19);
  label(ctx, 'TRK', 70, 48, T || trk, 19);
  label(ctx, 'FPA', 70, 78, T || trk, 19);
  label(ctx, 'ALT', 170, 30, true);
  // LVL/CH legend between two horizontal lines.
  ctx.strokeStyle = LCD.on;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(228, 22); ctx.lineTo(300, 22); ctx.moveTo(384, 22); ctx.lineTo(452, 22);
  ctx.moveTo(228, 22); ctx.lineTo(228, 32); ctx.moveTo(452, 22); ctx.lineTo(452, 32);
  ctx.stroke();
  label(ctx, 'LVL/CH', 342, 30, true, 20, 'center');
  const s = T ? '88888' : String(Math.round(sim.get('S:FCU_ALT'))).padStart(5, '0');
  digits(ctx, s, 170, 48);
  dot(ctx, 470, 80, T || sim.getB('S:FCU_ALT_DOT'));
}

export function drawFcuVs(ctx: Ctx, sim: Sim): void {
  fillRect(ctx, 0, 0, 384, 128, LCD.bg);
  const T = test(sim);
  const fpa = sim.getB('S:FCU_TRK_FPA');
  label(ctx, 'V/S', 60, 30, T || !fpa);
  label(ctx, 'FPA', 130, 30, T || fpa);
  const x = 40;
  if (T) {
    digits(ctx, '-8888', x, 48);
    return;
  }
  if (sim.getB('S:FCU_VS_DASHES')) {
    digits(ctx, '-----', x, 48);
    return;
  }
  if (fpa) {
    const v = sim.get('S:FCU_FPA');
    const a = Math.abs(v);
    digits(ctx, `${v < 0 ? '-' : ' '}${Math.floor(a + 1e-6)}.${Math.round((a % 1) * 10) % 10}`, x, 48);
    if (v >= 0) plus(ctx, x);
    return;
  }
  const v = sim.get('S:FCU_VS');
  const h = String(Math.round(Math.abs(v) / 100)).padStart(2, '0');
  const w = digits2(ctx, `${v < 0 ? '-' : ' '}${h}`, x);
  if (v >= 0) plus(ctx, x);
  // Trailing "oo" (hundreds) in small segments.
  drawSevenSeg(ctx, 'oo', x + w + 4, 48, 36, LCD.on, { skew: 0.06, thickness: 4.4, spacing: 7 });
}

function digits2(ctx: Ctx, s: string, x: number): number {
  return drawSevenSeg(ctx, s, x, 48, 62, LCD.on, { ghost: LCD.ghost, skew: 0.06, thickness: 62 * 0.12, spacing: 62 * 0.22 });
}

/** '+' sign drawn in the sign digit position. */
function plus(ctx: Ctx, x: number): void {
  ctx.strokeStyle = LCD.on;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x + 4, 79); ctx.lineTo(x + 32, 79);
  ctx.moveTo(x + 18, 66); ctx.lineTo(x + 18, 92);
  ctx.stroke();
}

export function drawEfisBaro(ctx: Ctx, sim: Sim, n: 1 | 2): void {
  fillRect(ctx, 0, 0, 256, 96, LCD.bg);
  const T = test(sim);
  const std = sim.getB(`S:EFIS${n}_BARO_STD`);
  label(ctx, 'QFE', 20, 24, T, 18);
  label(ctx, 'QNH', 190, 24, T || !std, 18);
  let s: string;
  if (T) s = '88.88';
  else if (std) s = 'Std ';
  else if (sim.getB(`S:EFIS${n}_BARO_INHG`)) s = toInHg(sim.get(`S:EFIS${n}_BARO_HPA`)).toFixed(2);
  else s = String(Math.round(sim.get(`S:EFIS${n}_BARO_HPA`))).padStart(4, ' ');
  drawSevenSeg(ctx, s, 40, 32, 52, LCD.on, { ghost: LCD.ghost, skew: 0.06, thickness: 52 * 0.12, spacing: 52 * 0.24 });
}
