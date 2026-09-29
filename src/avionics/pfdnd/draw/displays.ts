/**
 * Registers the pfdnd displays with the display framework:
 * PFD1, ND1, PFD2, ND2 (DU state machine: self test, INVALID DATA, PFD/ND images with transfers),
 * ISIS, FCU_SPD, FCU_HDG, FCU_ALT, FCU_VS, EFIS1_BARO, EFIS2_BARO.
 */
import { registerDisplay } from '../../../displays/framework';
import type { Sim } from '../../../core/sim';
import { DU_CONTENT, DU_IDS, DU_STATE, duBrightness, type DuId } from '../logic/du';
import { ISIS_STATE } from '../logic/isis';
import { C, Flasher, txt } from './common';
import { drawPfd } from './pfd';
import { drawNd } from './nd';
import { drawIsis } from './isis';
import { drawEfisBaro, drawFcuAlt, drawFcuHdg, drawFcuSpd, drawFcuVs } from './fcu';

function selfTest(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  txt(ctx, 'SELF TEST IN PROGRESS', w / 2, h * 0.5, C.green, 44, 'center');
  txt(ctx, '(MAX 40 SECONDS)', w / 2, h * 0.56, C.green, 44, 'center');
}

export function registerPfdNdDisplays(): void {
  for (const id of DU_IDS) {
    const side = Number(id.slice(-1)) as 1 | 2;
    const flasher = new Flasher();
    registerDisplay({
      id,
      width: 1024,
      height: 1024,
      hz: 20,
      background: C.bg,
      powered: (sim: Sim) => {
        const st = sim.get(`S:PFDND_DU_${id}_STATE`);
        return st === DU_STATE.SELF_TEST || st === DU_STATE.ON;
      },
      brightness: (sim: Sim) => duBrightness(sim, id as DuId),
      draw(ctx, sim, info) {
        const st = sim.get(`S:PFDND_DU_${id}_STATE`);
        if (st === DU_STATE.SELF_TEST) {
          selfTest(ctx, info.width, info.height);
          return;
        }
        const content = sim.get(`S:PFDND_DU_${id}_CONTENT`);
        if (content === DU_CONTENT.INVALID) {
          txt(ctx, 'INVALID DATA', info.width / 2, info.height / 2, C.magenta, 48, 'center');
          return;
        }
        if (content === DU_CONTENT.PFD) drawPfd(ctx, sim, side, info.t, flasher, info.width);
        else drawNd(ctx, sim, side, info.t, info.width);
      },
    });
  }

  registerDisplay({
    id: 'ISIS',
    width: 512,
    height: 512,
    hz: 20,
    powered: (sim) => sim.getB('S:ISIS_POWERED') && sim.get('S:ISIS_STATE') !== ISIS_STATE.OFF,
    brightness: (sim) => (sim.has('S:ISIS_BRT') ? sim.get('S:ISIS_BRT') : 0.8),
    draw: (ctx, sim) => drawIsis(ctx, sim),
  });

  const fcuPowered = (sim: Sim) => sim.getB('S:FCU_POWERED');
  const fcuBrt = () => 1;
  registerDisplay({ id: 'FCU_SPD', width: 256, height: 128, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawFcuSpd(ctx, sim) });
  registerDisplay({ id: 'FCU_HDG', width: 384, height: 128, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawFcuHdg(ctx, sim) });
  registerDisplay({ id: 'FCU_ALT', width: 512, height: 128, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawFcuAlt(ctx, sim) });
  registerDisplay({ id: 'FCU_VS', width: 384, height: 128, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawFcuVs(ctx, sim) });
  registerDisplay({ id: 'EFIS1_BARO', width: 256, height: 96, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawEfisBaro(ctx, sim, 1) });
  registerDisplay({ id: 'EFIS2_BARO', width: 256, height: 96, hz: 10, powered: fcuPowered, brightness: fcuBrt, draw: (ctx, sim) => drawEfisBaro(ctx, sim, 2) });
}
