import { headlessApp, installLogic, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import { settings } from '../../src/core/settings';
import install, { type SysMiscService } from '../../src/systems/misc/index';
import elecInstall from '../../src/systems/elec-hyd-fuel-apu/index';

export type PowerMode = 'none' | 'hot' | 'bat' | 'full';

const BUSES = [
  'S:ELEC_HOT_BUS1', 'S:ELEC_HOT_BUS2', 'S:ELEC_DC_BAT_BUS', 'S:ELEC_DC_ESS_BUS', 'S:ELEC_DC_ESS_SHED',
  'S:ELEC_DC1_BUS', 'S:ELEC_DC2_BUS', 'S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC1_BUS', 'S:ELEC_AC2_BUS',
] as const;

/**
 * Force the electrical network (sys-elec not installed):
 *  none = everything off; hot = hot battery buses only (BAT pbs OFF); bat = hot + DC BAT + DC ESS (BAT only);
 *  full = every bus (EXT PWR / APU GEN).
 */
export function power(sim: Sim, mode: PowerMode): void {
  const on = new Set<string>();
  if (mode !== 'none') { on.add('S:ELEC_HOT_BUS1'); on.add('S:ELEC_HOT_BUS2'); }
  if (mode === 'bat' || mode === 'full') { on.add('S:ELEC_DC_BAT_BUS'); on.add('S:ELEC_DC_ESS_BUS'); }
  if (mode === 'full') for (const b of BUSES) on.add(b);
  for (const b of BUSES) sim.set(b, on.has(b) ? 1 : 0);
  const ann = on.has('S:ELEC_DC_BAT_BUS') || on.has('S:ELEC_DC_ESS_BUS');
  sim.set('S:ELEC_ANN_POWER', ann ? 1 : 0);
  sim.set('S:ANN_POWER', ann ? 1 : 0);
}

/** Hydraulic pressures (psi) G / B / Y. */
export function hyd(sim: Sim, g: number, b: number, y: number): void {
  sim.set('S:HYD_G_PRESS', g);
  sim.set('S:HYD_B_PRESS', b);
  sim.set('S:HYD_Y_PRESS', y);
}

export interface Rig {
  sim: Sim;
  svc: SysMiscService;
}

/** sys-misc alone with a forced electrical network (default: full power). */
export async function setup(mode: PowerMode = 'full', opts: { align?: 'real' | 'fast' | 'instant' } = {}): Promise<Rig> {
  settings.set('irsAlign', opts.align ?? 'real');
  const app = headlessApp();
  power(app.sim, mode);
  await installLogic(app, [install]);
  app.sim.run(0.1);
  return { sim: app.sim, svc: app.sim.services['sys-misc'] as SysMiscService };
}

/** sys-elec + sys-misc (integration). */
export async function setupWithElec(): Promise<Rig> {
  settings.set('irsAlign', 'real');
  const app = headlessApp();
  await installLogic(app, [elecInstall, install]);
  app.sim.run(0.5);
  return { sim: app.sim, svc: app.sim.services['sys-misc'] as SysMiscService };
}

/** IR mode selectors: 0 OFF, 1 NAV, 2 ATT. */
export function irs(sim: Sim, mode: 0 | 1 | 2, which: Array<1 | 2 | 3> = [1, 2, 3]): void {
  for (const n of which) setControl(sim, `ADIRS_IR${n}_MODE`, mode);
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

/** Sample a variable over `dur` seconds; returns the set of values seen. */
export function sample(sim: Sim, name: string, dur: number): Set<number> {
  const seen = new Set<number>();
  const n = Math.round(dur * 30);
  for (let i = 0; i < n; i++) {
    sim.run(1 / 30);
    seen.add(sim.get(name));
  }
  return seen;
}
