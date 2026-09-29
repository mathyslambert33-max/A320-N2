import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import install from '../../src/cockpit/pedestal/index';
import type { PedestalLogic } from '../../src/cockpit/pedestal/logic';

export type Power = 'none' | 'bat' | 'full';

const BUSES = [
  'S:ELEC_HOT_BUS1', 'S:ELEC_HOT_BUS2', 'S:ELEC_DC_BAT_BUS', 'S:ELEC_DC_ESS_BUS', 'S:ELEC_DC_ESS_SHED',
  'S:ELEC_DC1_BUS', 'S:ELEC_DC2_BUS', 'S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC1_BUS', 'S:ELEC_AC2_BUS',
];

/** Force the electrical network: none, batteries only (hot + DC BAT + DC ESS), or everything. */
export function power(sim: Sim, mode: Power): void {
  const on = new Set<string>();
  if (mode !== 'none') for (const b of ['S:ELEC_HOT_BUS1', 'S:ELEC_HOT_BUS2', 'S:ELEC_DC_BAT_BUS', 'S:ELEC_DC_ESS_BUS']) on.add(b);
  if (mode === 'full') for (const b of BUSES) on.add(b);
  for (const b of BUSES) sim.set(b, on.has(b) ? 1 : 0);
  sim.set('S:ELEC_AC_POWERED', mode === 'full' ? 1 : 0);
  sim.set('S:ANN_POWER', mode === 'none' ? 0 : 1);
}

export interface Rig { sim: Sim; ped: PedestalLogic }

export async function setup(mode: Power = 'full'): Promise<Rig> {
  const app = headlessApp();
  power(app.sim, mode);
  await installLogic(app, [install]);
  app.sim.run(0.1);
  return { sim: app.sim, ped: app.sim.services.pedestal as PedestalLogic };
}

/** Press a momentary control like the kit does (press event, hold, release). */
export function press(sim: Sim, id: string, hold = 0.1): void {
  sim.set(`C:${id}`, 1);
  sim.emit(`${id}:press`);
  sim.run(hold);
  sim.set(`C:${id}`, 0);
  sim.emit(`${id}:release`);
}

/** Type keys on the ATC keyboard. */
export function xpdrKeys(sim: Sim, keys: string[]): void {
  for (const k of keys) { sim.emit('XPDR_KEY', { key: k }); sim.run(0.1); }
}
