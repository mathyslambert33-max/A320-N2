/**
 * ISIS (512 x 512): attitude, speed and altitude tapes, baro setting, roll scale, LS scales,
 * 90 s INIT sequence (yellow ATT / SPD / ALT boxes with the countdown), bugs page.
 */
import type { Sim } from '../../../core/sim';
import { ISIS_STATE } from '../logic/isis';
import { baroAlt, psFromAltStd } from '../logic/sources';
import { C, type Ctx, fillRect, line, pad, poly, txt } from './common';

const CX = 256;
const CY = 256;
const PX_PER_DEG = 6.2;

export function drawIsis(ctx: Ctx, sim: Sim): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const st = sim.get('S:ISIS_STATE');
  if (st === ISIS_STATE.INIT) {
    initPage(ctx, sim);
    return;
  }
  if (sim.getB('S:ISIS_BUGS_PAGE')) {
    bugsPage(ctx);
    return;
  }
  const pitch = sim.get('S:ADIRS_PITCH');
  const roll = sim.get('S:ADIRS_ROLL');
  // Horizon
  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate((-roll * Math.PI) / 180);
  ctx.translate(0, pitch * PX_PER_DEG);
  fillRect(ctx, -500, -900, 1000, 900, C.sky);
  fillRect(ctx, -500, 0, 1000, 900, C.earth);
  line(ctx, -500, 0, 500, 0, C.white, 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-80, -pitch * PX_PER_DEG - 110, 160, 220);
  ctx.clip();
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const y = -p * PX_PER_DEG;
    const w = p % 10 === 0 ? 34 : p % 5 === 0 ? 18 : 9;
    line(ctx, -w, y, w, y, C.white, 2);
    if (p % 10 === 0) {
      txt(ctx, String(Math.abs(p)), -w - 6, y + 8, C.white, 22, 'right');
      txt(ctx, String(Math.abs(p)), w + 6, y + 8, C.white, 22, 'left');
    }
  }
  ctx.restore();
  ctx.restore();
  // Roll scale
  ctx.save();
  ctx.translate(CX, CY);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2.5;
  const R = 150;
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const s = Math.sin((a * Math.PI) / 180);
    const c = Math.cos((a * Math.PI) / 180);
    const l = a === 0 ? 0 : Math.abs(a) % 30 === 0 ? 18 : 10;
    if (a) line(ctx, s * R, -c * R, s * (R + l), -c * (R + l), C.white, 2.5);
  }
  poly(ctx, [0, -R, -9, -R - 14, 9, -R - 14], C.white, 0, true, C.white);
  ctx.rotate((-roll * Math.PI) / 180);
  poly(ctx, [0, -R + 2, -10, -R + 16, 10, -R + 16], C.yellow, 2.5, true);
  ctx.restore();

  speedTape(ctx, sim);
  altTape(ctx, sim);

  // Aircraft symbol
  const sym = (pts: number[]) => poly(ctx, pts, C.yellow, 3, true, C.black);
  sym([150, 250, 210, 250, 210, 272, 200, 272, 200, 260, 150, 260]);
  sym([362, 250, 302, 250, 302, 272, 312, 272, 312, 260, 362, 260]);
  sym([250, 250, 262, 250, 262, 262, 250, 262]);

  // Baro setting
  if (sim.getB('S:ISIS_BARO_STD')) txt(ctx, 'STD', 250, 450, C.cyan, 36, 'center');
  else {
    const hpa = sim.get('S:ISIS_BARO_HPA');
    txt(ctx, `${Math.round(hpa)}/${(hpa / 33.8639).toFixed(2)}`, 256, 450, C.cyan, 28, 'center');
  }
  // LS scales
  if (sim.getB('S:ISIS_LS')) {
    ctx.strokeStyle = C.magenta;
    ctx.lineWidth = 2;
    for (const d of [-60, -30, 30, 60]) {
      ctx.beginPath(); ctx.arc(CX + d, 400, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(378, CY + d, 4, 0, Math.PI * 2); ctx.stroke();
    }
    txt(ctx, 'LS', 60, 450, C.magenta, 24, 'left');
  }
}

function speedTape(ctx: Ctx, sim: Sim): void {
  const ias = Math.max(30, sim.get('S:ADIRS_IAS'));
  const x0 = 12, w = 108, y0 = 112, h = 296;
  fillRect(ctx, x0, y0, w, h, 'rgba(20,20,20,0.85)');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  const pxPerKt = 3.2;
  for (let v = Math.max(30, Math.floor((ias - 50) / 10) * 10); v <= ias + 50; v += 10) {
    const y = CY - (v - ias) * pxPerKt;
    line(ctx, x0 + w - 16, y, x0 + w, y, C.white, 2.5);
    if (v % 20 === 0) txt(ctx, String(v), x0 + w - 22, y + 10, C.white, 28, 'right');
  }
  ctx.restore();
  poly(ctx, [x0, CY - 20, x0 + w - 6, CY - 20, x0 + w - 6, CY - 8, x0 + w + 6, CY, x0 + w - 6, CY + 8, x0 + w - 6, CY + 20, x0, CY + 20], C.yellow, 2.5, true, C.black);
  txt(ctx, String(Math.round(ias)).padStart(3, ' '), x0 + w - 12, CY + 11, C.green, 32, 'right');
}

function altTape(ctx: Ctx, sim: Sim): void {
  const std = sim.getB('S:ISIS_BARO_STD');
  const ps = sim.has('S:ADIRS_STATIC_PRESS') && sim.get('S:ADIRS_STATIC_PRESS') > 100 ? sim.get('S:ADIRS_STATIC_PRESS') : psFromAltStd(sim.get('S:ADIRS_BARO_ALT_STD'));
  const alt = baroAlt(ps, std ? 1013.25 : sim.get('S:ISIS_BARO_HPA'));
  const x0 = 395, w = 108, y0 = 112, h = 296;
  fillRect(ctx, x0, y0, w, h, 'rgba(20,20,20,0.85)');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  const pxPerFt = 0.3;
  for (let a = Math.floor((alt - 600) / 100) * 100; a <= alt + 600; a += 100) {
    const y = CY - (a - alt) * pxPerFt;
    line(ctx, x0, y, x0 + (a % 500 === 0 ? 16 : 9), y, C.white, 2.5);
    if (a % 500 === 0) txt(ctx, String(a), x0 + 22, y + 10, C.white, 26, 'left');
  }
  ctx.restore();
  poly(ctx, [x0 - 6, CY, x0 + 6, CY - 20, x0 + w, CY - 20, x0 + w, CY + 20, x0 + 6, CY + 20], C.yellow, 2.5, true, C.black);
  txt(ctx, pad(Math.round(alt / 20) * 20, 1), x0 + w - 6, CY + 11, C.green, 30, 'right');
}

function initPage(ctx: Ctx, sim: Sim): void {
  const box = (x: number, y: number, w: number, h: number, s: string, tx: number, ty: number, align: CanvasTextAlign = 'center') => {
    fillRect(ctx, x, y, w, h, C.yellow);
    txt(ctx, s, tx, ty, C.black, 32, align);
  };
  box(190, 174, 110, 40, 'ATT', 245, 206);
  box(40, 244, 84, 40, 'SPD', 82, 277);
  box(358, 244, 110, 40, 'ALT', 413, 277);
  fillRect(ctx, 150, 332, 180, 40, C.yellow);
  txt(ctx, 'INIT', 160, 365, C.black, 30, 'left');
  txt(ctx, `${Math.max(0, Math.round(sim.get('S:ISIS_INIT_REMAIN')))}s`, 325, 365, C.black, 30, 'right');
}

function bugsPage(ctx: Ctx): void {
  txt(ctx, 'BUGS', 256, 60, C.white, 32, 'center');
  const rows = ['SPD', 'SPD', 'SPD', 'SPD', 'ALT', 'ALT'];
  rows.forEach((r, i) => {
    txt(ctx, r, 120, 130 + i * 50, C.white, 28, 'left');
    txt(ctx, r === 'SPD' ? '---' : '-----', 392, 130 + i * 50, C.cyan, 28, 'right');
  });
}
