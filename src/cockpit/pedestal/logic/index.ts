/**
 * Pedestal logic (DOM-free): radio management panels, audio control panels, ATC transponder / TCAS,
 * rudder trim indicator, WX radar panel state, printer. Registered as one sim system.
 */
import type { Sim } from '../../../core/sim';
import { RmpModel } from './rmp';
import { AcpModel } from './acp';
import { XpdrModel } from './xpdr';
import { PedMisc } from './misc';

export interface PedestalLogic {
  rmp: RmpModel;
  acp: AcpModel;
  xpdr: XpdrModel;
  misc: PedMisc;
}

export function installPedestalLogic(app: { sim: Sim; services?: Record<string, any> }): PedestalLogic {
  const sim = app.sim;
  const logic: PedestalLogic = { rmp: new RmpModel(sim), acp: new AcpModel(sim), xpdr: new XpdrModel(sim), misc: new PedMisc(sim) };
  sim.register({
    name: 'pedestal',
    order: 75,
    init: () => {
      logic.acp.init();
      logic.xpdr.init();
    },
    update: (dt) => {
      logic.rmp.update();
      logic.acp.update(dt);
      logic.xpdr.update(dt);
      logic.misc.update(dt);
    },
  });
  sim.services.pedestal = logic;
  if (app.services) app.services.pedestal = logic;
  return logic;
}
