/**
 * PFD/ND/FCU test helpers: headless app with only the pfdnd logic; the other systems' outputs
 * (electrical buses, ADIRS, FMGS) are written directly by the tests.
 */
import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import install from '../../src/avionics/pfdnd/index';

export function set(sim: Sim, vars: Record<string, number>): void {
  for (const [k, v] of Object.entries(vars)) sim.set(k, v);
}

/** All electrical buses powered (batteries + external power). */
export function power(sim: Sim, on = true): void {
  const v = on ? 1 : 0;
  set(sim, {
    'S:ELEC_HOT_BUS1': v, 'S:ELEC_HOT_BUS2': v, 'S:ELEC_DC_BAT_BUS': v, 'S:ELEC_DC_ESS_BUS': v, 'S:ELEC_DC_ESS_SHED': v,
    'S:ELEC_DC1_BUS': v, 'S:ELEC_DC2_BUS': v, 'S:ELEC_AC1_BUS': v, 'S:ELEC_AC2_BUS': v, 'S:ELEC_AC_ESS_BUS': v,
    'S:ELEC_AC_ESS_SHED': v, 'S:ANN_POWER': v,
  });
}

/** FMGCs powered (MCDU module output). */
export function fmgs(sim: Sim, on = true): void {
  set(sim, { 'S:FMGS_POWERED': on ? 1 : 0, 'S:FMGS_FMGC1_POWERED': on ? 1 : 0, 'S:FMGS_FMGC2_POWERED': on ? 1 : 0 });
}

/** IRs aligned and ADRs valid on both sides (sys-misc outputs). */
export function irsAligned(sim: Sim, on = true): void {
  const v = on ? 1 : 0;
  for (const s of ['CAPT', 'FO']) {
    set(sim, { [`S:ADIRS_${s}_ATT_VALID`]: v, [`S:ADIRS_${s}_HDG_VALID`]: v, [`S:ADIRS_${s}_NAV_VALID`]: v, [`S:ADIRS_${s}_ADR_VALID`]: v });
  }
  set(sim, { 'S:ADIRS_HDG_MAG': 297, 'S:ADIRS_HDG_TRUE': 298, 'S:ADIRS_BARO_ALT_STD': 60 });
}

export function turn(sim: Sim, id: string, steps: number): void {
  sim.emit(`${id}:${steps > 0 ? 'inc' : 'dec'}`, { steps: Math.abs(steps), fast: false });
  sim.run(0.1);
}

export function knob(sim: Sim, id: string, action: 'push' | 'pull'): void {
  sim.emit(`${id}:${action}`);
  sim.run(0.1);
}

export function pb(sim: Sim, id: string): void {
  sim.emit(`${id}:press`);
  sim.run(0.1);
  sim.emit(`${id}:release`);
  sim.run(0.1);
}

/**
 * Headless rig. `warm` = aircraft already powered when the simulation starts (no self tests);
 * otherwise cold & dark (power applied by the test).
 */
export async function rig(opts: { warm?: boolean; fmgs?: boolean; irs?: boolean } = {}): Promise<Sim> {
  const app = headlessApp();
  const sim = app.sim;
  if (opts.warm) power(sim);
  if (opts.fmgs) fmgs(sim);
  if (opts.irs) irsAligned(sim);
  await installLogic(app, [install]);
  sim.run(0.5);
  return sim;
}
