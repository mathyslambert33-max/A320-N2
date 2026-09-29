/**
 * SD STATUS page (768 design space).
 * Left: limitations / procedures (cyan), information (green / white), CANCELLED CAUTION (white).
 * Right: INOP SYS (amber).
 * With no status message the page shows "NORMAL" (green) for 3 s after STS is pressed.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import type { Line } from '../../logic/types';
import { C, drawEcamLine, line, pageTitle, tx } from '../common';

const K = 1024 / 768;
const PITCH = 16;
const PX = 24;
const STEP = 30;
const MAX_LINES = 16;

export function drawStatusPage(ctx: CanvasRenderingContext2D, _sim: Sim, core: EcamCore, t: number): void {
  ctx.scale(K, K);
  pageTitle(ctx, 'STATUS', 384, 38, 36, 'center');
  const st = core.fwc.status;
  const empty = st.left.length + st.inop.length + st.cancelled.length === 0;
  if (empty) {
    tx(ctx, 'NORMAL', 384, 150, C.G, 29, 'center');
    return;
  }
  const flashOn = Math.floor(t * 2) % 2 === 0;
  line(ctx, 483, 96, 483, 593, C.grey, 4, 'round');

  const left: Line[] = st.left.map((l) => [{ t: l.text, c: l.c }]);
  if (st.cancelled.length) {
    if (left.length) left.push([]);
    left.push([{ t: 'CANCELLED CAUTION', c: 'W', u: true }]);
    for (const c of st.cancelled) left.push([{ t: c, c: 'W' }]);
  }
  let y = 118;
  for (const l of left.slice(0, MAX_LINES)) {
    drawEcamLine(ctx, l, 8, y, PITCH, PX, flashOn);
    y += STEP;
  }

  if (st.inop.length) {
    y = 118;
    drawEcamLine(ctx, [{ t: 'INOP SYS', c: 'W', u: true }], 512, y, PITCH, PX, flashOn);
    y += STEP;
    for (const s of st.inop.slice(0, MAX_LINES - 1)) {
      drawEcamLine(ctx, [{ t: s, c: 'A' }], 512, y, PITCH, PX, flashOn);
      y += STEP;
    }
  }
}
