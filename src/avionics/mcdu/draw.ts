/**
 * MCDU display painting (Canvas 2D): 24 columns x 14 lines, B612 Mono large / small fonts, Airbus colours.
 */
import { DU, FONT, font, registerDisplay } from '../../displays/framework';
import type { Sim } from '../../core/sim';
import type { Mcdu } from './mcdu/mcdu';
import { COLS, ROWS, type Color, type Screen } from './mcdu/screen';

const W = 768;
const H = 640;
const MX = 18;
const MY = 14;
const CW = (W - 2 * MX) / COLS; // 30.5 px
const RH = (H - 2 * MY) / ROWS; // 43.7 px
const LARGE = 41;
const SMALL = 31;

const COLOR: Record<Color, string> = {
  w: DU.white, g: DU.green, c: DU.cyan, a: DU.amber, m: DU.magenta, y: DU.yellow,
};

function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, x: number, yBase: number, small: boolean, color: string) {
  const h = small ? SMALL * 0.72 : LARGE * 0.72; // cap height
  const cx = x + CW / 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  switch (ch) {
    case '□': {
      ctx.lineWidth = 2.2;
      const bw = CW * 0.62, bh = h * 0.95;
      ctx.strokeRect(cx - bw / 2, yBase - bh, bw, bh);
      return;
    }
    case 'Δ': {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx, yBase - h);
      ctx.lineTo(cx + CW * 0.36, yBase);
      ctx.lineTo(cx - CW * 0.36, yBase);
      ctx.closePath();
      ctx.stroke();
      return;
    }
    case '←': case '→': case '↑': case '↓': {
      ctx.lineWidth = 2.6;
      const midY = yBase - h / 2;
      const len = CW * 0.8, head = CW * 0.3;
      ctx.beginPath();
      if (ch === '←' || ch === '→') {
        const d = ch === '→' ? 1 : -1;
        ctx.moveTo(cx - (d * len) / 2, midY);
        ctx.lineTo(cx + (d * len) / 2, midY);
        ctx.moveTo(cx + (d * len) / 2 - d * head, midY - head * 0.8);
        ctx.lineTo(cx + (d * len) / 2, midY);
        ctx.lineTo(cx + (d * len) / 2 - d * head, midY + head * 0.8);
      } else {
        const d = ch === '↓' ? 1 : -1;
        const l = h * 1.05;
        ctx.moveTo(cx, midY - (d * l) / 2);
        ctx.lineTo(cx, midY + (d * l) / 2);
        ctx.moveTo(cx - head * 0.8, midY + (d * l) / 2 - d * head);
        ctx.lineTo(cx, midY + (d * l) / 2);
        ctx.lineTo(cx + head * 0.8, midY + (d * l) / 2 - d * head);
      }
      ctx.stroke();
      return;
    }
  }
  ctx.font = font(small ? SMALL : LARGE, FONT.mono, 400);
  const mw = ctx.measureText(ch).width;
  if (mw > CW * 0.98) {
    ctx.save();
    ctx.translate(cx, yBase);
    ctx.scale((CW * 0.98) / mw, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  } else ctx.fillText(ch, cx, yBase);
}

export function paintScreen(ctx: CanvasRenderingContext2D, s: Screen): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (let r = 0; r < ROWS; r++) {
    const yBase = MY + (r + 1) * RH - RH * 0.2;
    for (let c = 0; c < COLS; c++) {
      const cell = s.cells[r][c];
      if (!cell) continue;
      drawGlyph(ctx, cell.ch, MX + c * CW, yBase, cell.small, COLOR[cell.c]);
    }
  }
}

export function registerMcduDisplays(units: Mcdu[], powered: (n: 1 | 2, sim: Sim) => boolean): void {
  for (const u of units) {
    registerDisplay({
      id: `MCDU${u.n}`,
      width: W,
      height: H,
      hz: 10,
      background: '#000',
      powered: (sim) => powered(u.n, sim),
      brightness: () => u.brightness,
      draw(ctx) {
        paintScreen(ctx, u.render());
      },
    });
  }
}
