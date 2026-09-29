import { headlessApp, installLogic, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import install from '../../src/systems/elec-hyd-fuel-apu/index';

export async function setup(opts: { gpu?: boolean } = {}): Promise<Sim> {
  const app = headlessApp();
  await installLogic(app, [install]);
  if (opts.gpu === false) app.sim.set('G:GND_EXT_PWR', 0);
  app.sim.run(0.5);
  return app.sim;
}

export function batsOn(sim: Sim): void {
  setControl(sim, 'ELEC_BAT1', 1);
  setControl(sim, 'ELEC_BAT2', 1);
  sim.run(2);
}

export function extOn(sim: Sim): void {
  setControl(sim, 'ELEC_EXT_PWR', sim.get('C:ELEC_EXT_PWR') ? 0 : 1); // any push toggles (momentary pb)
  sim.run(1);
}

/** ENG MASTER switch: catalog position 0 = ON. */
export function master(sim: Sim, n: 1 | 2, on: boolean): void {
  setControl(sim, `ENG_MASTER${n}`, on ? 0 : 1);
}

/** Fake a running engine (sys-air is not installed in these tests). */
export function engine(sim: Sim, n: 1 | 2, n2: number): void {
  sim.set(`S:ENG${n}_N2`, n2);
  sim.set(`S:ENG${n}_RUNNING`, n2 >= 55 ? 1 : 0);
  sim.set(`S:ENG${n}_OIL_PRESS`, n2 > 20 ? 40 : n2);
}

/** Run until predicate true (returns elapsed s) or throws after max s. */
export function runUntil(sim: Sim, pred: () => boolean, max: number, step = 1 / 30): number {
  let t = 0;
  while (!pred()) {
    sim.run(step);
    t += step;
    if (t > max) throw new Error(`condition not met within ${max} s`);
  }
  return t;
}

export function litLights(sim: Sim): string[] {
  return Object.entries(sim.snapshot('L:')).filter(([, v]) => v).map(([k]) => k.slice(2)).sort();
}
