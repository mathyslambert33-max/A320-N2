/**
 * PFD / ND / ISIS / FCU logic (DOM-free): FCU + EFIS control panels, flight guidance status for
 * the FMA, display units (power, self test, transfers) and ISIS.
 */
import type { Sim } from '../../../core/sim';
import { FcuLogic } from './fcu';
import { FgLogic } from './fg';
import { DuLogic } from './du';
import { IsisLogic } from './isis';

export interface PfdNdLogic {
  fcu: FcuLogic;
  fg: FgLogic;
  du: DuLogic;
  isis: IsisLogic;
}

export function installPfdNdLogic(sim: Sim): PfdNdLogic {
  const fcu = new FcuLogic(sim);
  const fg = new FgLogic();
  const du = new DuLogic(sim);
  const isis = new IsisLogic(sim);
  sim.register(fcu);
  sim.register(fg);
  sim.register(du);
  sim.register(isis);
  const core = { fcu, fg, du, isis };
  sim.services.pfdnd = core;
  return core;
}
