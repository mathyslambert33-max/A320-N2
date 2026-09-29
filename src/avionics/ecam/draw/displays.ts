/**
 * Registers the two ECAM display units with the display framework.
 */
import { registerDisplay } from '../../../displays/framework';
import type { Sim } from '../../../core/sim';
import type { EcamCore } from '../logic/ecam';
import type { DuState } from '../logic/du';
import { C, tx } from './common';
import { drawEwd } from './ewd';
import { drawSd } from './sd';

/** DU brightness from the ECP knob (knob at minimum = OFF). */
const brt = (k: number) => (k <= 0.001 ? 0 : 0.18 + 0.82 * Math.min(1, k));

export function registerEcamDisplays(core: EcamCore): void {
  registerDisplay({
    id: 'EWD', width: 1024, height: 1024, hz: 15, background: '#000',
    powered: () => core.duUpper.mode === 'ON' || core.duUpper.mode === 'TEST',
    brightness: (sim) => brt(sim.get('C:ECP_UPPER_BRT')),
    draw: (ctx, sim, info) => {
      if (drawDuState(ctx, core.duUpper, core.upperDataValid)) return;
      drawEwd(ctx, sim, core, info.t);
    },
  });
  registerDisplay({
    id: 'SD', width: 1024, height: 1024, hz: 15, background: '#000',
    powered: () => core.duLower.mode === 'ON' || core.duLower.mode === 'TEST',
    brightness: (sim) => brt(sim.get('C:ECP_LOWER_BRT')),
    draw: (ctx, sim: Sim, info) => {
      if (drawDuState(ctx, core.duLower, core.lowerDataValid)) return;
      if (core.ewdOnLower) drawEwd(ctx, sim, core, info.t);
      else drawSd(ctx, sim, core, info.t);
    },
  });
}

/** Self test / invalid data screens. Returns true when the normal format must not be drawn. */
function drawDuState(ctx: CanvasRenderingContext2D, du: DuState, dataValid: boolean): boolean {
  if (du.mode === 'TEST') {
    tx(ctx, 'SELF TEST IN PROGRESS', 512, 512, C.G, 41, 'center');
    tx(ctx, '(MAX 40 SECONDS)', 512, 573, C.G, 41, 'center');
    return true;
  }
  if (!dataValid) {
    tx(ctx, 'INVALID DATA', 512, 520, C.A, 41, 'center');
    return true;
  }
  return false;
}
