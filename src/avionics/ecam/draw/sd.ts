/**
 * System Display (lower ECAM): page dispatcher + permanent data (TAT / SAT / UTC / GW / GWCG).
 */
import type { Sim } from '../../../core/sim';
import type { EcamCore } from '../logic/ecam';
import { SdPage } from '../logic/types';
import { C, line, tx } from './common';
import { drawDoorPage } from './pages/door';
import { drawWheelPage } from './pages/wheel';
import { drawEngPage } from './pages/eng';
import { drawApuPage } from './pages/apu';
import { drawBleedPage } from './pages/bleed';
import { drawElecPage } from './pages/elec';
import { drawHydPage } from './pages/hyd';
import { drawFuelPage } from './pages/fuel';
import { drawCondPage } from './pages/cond';
import { drawPressPage } from './pages/press';
import { drawFctlPage } from './pages/fctl';
import { drawStatusPage } from './pages/status';
import { drawCruisePage } from './pages/cruise';

export type PageDraw = (ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number) => void;

const PAGES: Record<number, PageDraw> = {
  [SdPage.ENG]: drawEngPage,
  [SdPage.BLEED]: drawBleedPage,
  [SdPage.PRESS]: drawPressPage,
  [SdPage.ELEC]: drawElecPage,
  [SdPage.HYD]: drawHydPage,
  [SdPage.FUEL]: drawFuelPage,
  [SdPage.APU]: drawApuPage,
  [SdPage.COND]: drawCondPage,
  [SdPage.DOOR]: drawDoorPage,
  [SdPage.WHEEL]: drawWheelPage,
  [SdPage.FCTL]: drawFctlPage,
  [SdPage.STS]: drawStatusPage,
  [SdPage.CRUISE]: drawCruisePage,
};

export function drawSd(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, t: number): void {
  const page = core.sd.page;
  const fn = PAGES[page];
  if (fn) {
    ctx.save();
    try { fn(ctx, sim, core, t); } finally { ctx.restore(); }
  }
  ctx.save();
  drawPermanentData(ctx, sim, core, t);
  ctx.restore();
}

const sign = (v: number) => (v >= 0 ? '+' : '') + Math.round(v).toString();

/** Bottom part of every SD page (768 design space). */
function drawPermanentData(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore, _t: number): void {
  ctx.scale(1024 / 768, 1024 / 768);
  line(ctx, 3, 667, 764, 667, C.grey, 4, 'round');
  line(ctx, 257, 667, 257, 763, C.grey, 4, 'round');
  line(ctx, 509, 667, 509, 763, C.grey, 4, 'round');

  const a = core.fwc.a;
  // TAT / SAT (ADR), ISA shown when the baro reference is STD
  tx(ctx, 'TAT', 37, 698, C.W, 25);
  tx(ctx, 'SAT', 37, 728, C.W, 25);
  if (a.tatValid) tx(ctx, sign(a.tat), 158, 698, C.G, 25, 'right');
  else tx(ctx, 'XX', 158, 698, C.A, 25, 'right');
  if (a.satValid) tx(ctx, sign(a.sat), 158, 728, C.G, 25, 'right');
  else tx(ctx, 'XX', 158, 728, C.A, 25, 'right');
  tx(ctx, '°C', 188, 698, C.C, 23);
  tx(ctx, '°C', 188, 728, C.C, 23);
  const std = sim.getB('S:EFIS1_BARO_STD') || sim.getB('S:EFIS2_BARO_STD');
  if (std && a.satValid) {
    const isa = a.sat - (15 - Math.min(36089, a.baroAlt) * 0.0019812);
    tx(ctx, 'ISA', 37, 758, C.W, 25);
    tx(ctx, sign(isa), 158, 758, C.G, 25, 'right');
    tx(ctx, '°C', 188, 758, C.C, 23);
  }

  // UTC clock
  const utc = Math.floor(sim.get('G:TIME_UTC'));
  const hh = String(Math.floor(utc / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor((utc % 3600) / 60)).padStart(2, '0');
  tx(ctx, hh, 327, 729, C.G, 29);
  tx(ctx, 'H', 378, 728, C.C, 22);
  tx(ctx, mm, 409, 729, C.G, 26);

  // GW / GWCG: computed by the FMGC once the ZFW / ZFWCG are entered and an engine is running.
  const fmgsOk = sim.getB('S:FMGS_POWERED') || !sim.has('S:FMGS_POWERED');
  const gwAvail = fmgsOk && sim.get('S:FMGS_GW') > 0 && sim.get('S:FMGS_ZFW') > 0 && a.anyEngRunning;
  tx(ctx, 'GW', 533, 697, C.W, 25);
  if (gwAvail) tx(ctx, String(Math.round(sim.get('S:FMGS_GW') / 100) * 100), 698, 696, C.G, 27, 'right');
  else tx(ctx, '--', 698, 696, C.C, 27, 'right');
  tx(ctx, 'KG', 706, 697, C.C, 22);
  tx(ctx, 'GWCG', 533, 728, C.W, 25);
  const cgAvail = gwAvail && sim.get('S:FMGS_CG') > 0;
  if (cgAvail) tx(ctx, sim.get('S:FMGS_CG').toFixed(1), 698, 728, C.G, 27, 'right');
  else tx(ctx, '--', 698, 728, C.C, 27, 'right');
  tx(ctx, '%', 706, 728, C.C, 22);
}
