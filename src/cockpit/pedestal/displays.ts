/**
 * Pedestal 7-segment windows (Canvas 2D): RMP 1-3 ACTIVE / STBY-CRS, ATC transponder code, RUD TRIM position.
 * Canvas layouts (the 3D windows map UV sub-rectangles of these canvases):
 *  - RMPn: 768 × 112 px, ACTIVE = x 0..384, STBY/CRS = x 384..768.
 *  - XPDR: 256 × 96 px.  - RUD_TRIM: 192 × 80 px.
 * ANN LT TEST shows all segments (8s), like the FCU windows.
 */
import { registerDisplay, drawSevenSeg } from '../../displays/framework';
import type { Sim } from '../../core/sim';
import type { PedestalLogic } from './logic';

/** Amber-orange LED segments of the Airbus radio / ATC / trim windows. */
const SEG_ON = '#ffa333';
const SEG_GHOST = '#1a0e05';
const WIN_BG = '#060302';

export const RMP_CANVAS = { w: 768, h: 112 } as const;
export const XPDR_CANVAS = { w: 256, h: 96 } as const;
export const RUD_CANVAS = { w: 192, h: 80 } as const;

const ADV = 0.52 + 0.11 + 0.2; // digit advance / height used by drawSevenSeg (default spacing & thickness)

/** Width (px) of `cells` digit cells at digit height h. */
const cellsWidth = (cells: number, h: number) => cells * ADV * h - 0.2 * h;

/**
 * Draw `text` right-aligned in a grid of `cells` digit cells ending at x = right (a '.' belongs to the
 * preceding digit and takes no cell). Unlit segments of every cell are drawn faintly first.
 */
function segCells(ctx: CanvasRenderingContext2D, text: string, cells: number, right: number, y: number, h: number): void {
  const left = right - cellsWidth(cells, h);
  drawSevenSeg(ctx, '8'.repeat(cells), left, y, h, SEG_GHOST, { skew: 0.07 });
  const digits = [...text].filter((c) => c !== '.').length;
  const x = left + (cells - digits) * ADV * h;
  drawSevenSeg(ctx, text, x, y, h, SEG_ON, { skew: 0.07 });
}

/** Window brightness: ANN LT DIM dims the LED windows. */
const dimOf = (sim: Sim) => (sim.getB('S:INTLT_ANN_DIM') ? 0.55 : 1);
const testOn = (sim: Sim) => sim.getB('S:INTLT_ANN_TEST');

export function registerPedestalDisplays(logic: PedestalLogic): void {
  for (const u of logic.rmp.units) {
    const n = u.n;
    registerDisplay({
      id: `RMP${n}`,
      width: RMP_CANVAS.w,
      height: RMP_CANVAS.h,
      hz: 12,
      background: WIN_BG,
      powered: (sim) => sim.getB(`S:RMP${n}_ON`) || (testOn(sim) && sim.getB(`S:RMP${n}_POWERED`)),
      brightness: dimOf,
      draw: (ctx, sim) => {
        const t = testOn(sim) ? { act: '888.888', stby: '888.888' } : logic.rmp.texts(u);
        const h = 64;
        const y = (RMP_CANVAS.h - h) / 2;
        segCells(ctx, t.act.trimEnd(), 6, 384 - 26, y, h);
        segCells(ctx, t.stby.trimEnd(), 6, 768 - 26, y, h);
      },
    });
  }
  registerDisplay({
    id: 'XPDR',
    width: XPDR_CANVAS.w,
    height: XPDR_CANVAS.h,
    hz: 12,
    background: WIN_BG,
    powered: (sim) => sim.getB('S:XPDR_PANEL_POWERED'),
    brightness: dimOf,
    draw: (ctx, sim) => {
      const txt = testOn(sim) ? '8888' : logic.xpdr.windowText();
      const h = 62;
      // entry digits fill from the left: pad on the right with blanks so the cells stay aligned
      segCells(ctx, txt.padEnd(4, ' '), 4, XPDR_CANVAS.w - 22, (XPDR_CANVAS.h - h) / 2, h);
    },
  });
  registerDisplay({
    id: 'RUD_TRIM',
    width: RUD_CANVAS.w,
    height: RUD_CANVAS.h,
    hz: 15,
    background: WIN_BG,
    powered: (sim) => sim.getB('S:RUD_TRIM_IND_POWERED'),
    brightness: dimOf,
    draw: (ctx, sim) => {
      const h = 48;
      const y = (RUD_CANVAS.h - h) / 2;
      const r = logic.misc.rudTrim();
      const txt = testOn(sim) ? '888.8' : r.valid ? `${r.text[0]}${r.text.slice(1).replace(/ /g, ' ')}` : '     ';
      // cells: [letter] [tens] [units].[tenths]  → 4 cells; the letter cell is separated by a gap
      segCells(ctx, txt.slice(1), 3, RUD_CANVAS.w - 14, y, h);
      drawSevenSeg(ctx, '8', 12, y, h, SEG_GHOST, { skew: 0.07 });
      if (txt[0] !== ' ') drawSevenSeg(ctx, txt[0], 12, y, h, SEG_ON, { skew: 0.07 });
    },
  });
}
