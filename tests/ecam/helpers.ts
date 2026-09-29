/**
 * ECAM test helpers: headless app with only the ECAM logic, and small setters that play the role of
 * the aircraft systems (which are not installed in these tests).
 */
import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import install from '../../src/avionics/ecam/index';
import type { EcamService } from '../../src/avionics/ecam/logic';

export interface Rig {
  sim: Sim;
  ecam: EcamService;
  sounds: string[];
  /** E/WD lines as whitespace-normalised text. */
  left(): string[];
  right(): string[];
  warnings(): Array<{ text: string; level: number; displayed: boolean }>;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function set(sim: Sim, vars: Record<string, number>): void {
  for (const [k, v] of Object.entries(vars)) sim.set(k, v);
}

/** Batteries + external power: all buses powered. */
export function power(sim: Sim): void {
  set(sim, {
    'S:ELEC_HOT_BUS1': 1, 'S:ELEC_HOT_BUS2': 1, 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1, 'S:ELEC_DC_ESS_SHED': 1,
    'S:ELEC_DC1_BUS': 1, 'S:ELEC_DC2_BUS': 1, 'S:ELEC_AC1_BUS': 1, 'S:ELEC_AC2_BUS': 1, 'S:ELEC_AC_ESS_BUS': 1,
    'S:ELEC_AC_ESS_SHED': 1, 'S:ANN_POWER': 1, 'C:ELEC_BAT1': 1, 'C:ELEC_BAT2': 1,
  });
}

/** Doors closed (the scenario opens L1 + cargo doors at the stand). */
export function closeDoors(sim: Sim): void {
  for (const d of ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2', 'CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK']) sim.set(`G:DOOR_${d}`, 0);
}

/** Engine n stabilised at idle, with its generator, pump and bleed. */
export function engineRunning(sim: Sim, n: 1 | 2, on = true): void {
  set(sim, {
    [`C:ENG_MASTER${n}`]: on ? 0 : 1, [`S:ENG${n}_FADEC_ON`]: 1, [`S:ENG${n}_RUNNING`]: on ? 1 : 0, [`S:ENG${n}_STATE`]: on ? 3 : 0,
    [`S:ENG${n}_N1`]: on ? 19.5 : 0, [`S:ENG${n}_N2`]: on ? 58.5 : 0, [`S:ENG${n}_EGT`]: on ? 420 : 30, [`S:ENG${n}_FF`]: on ? 290 : 0,
    [`S:ENG${n}_OIL_PRESS`]: on ? 28 : 0, [`S:ELEC_GEN${n}_ON`]: on ? 1 : 0, [`S:HYD_ENG${n}_PUMP_ON`]: on ? 1 : 0,
    [`S:BLEED_ENG${n}_VALVE`]: on ? 1 : 0, [`S:PACK${n}_VALVE`]: on ? 1 : 0,
  });
  sim.set(n === 1 ? 'S:HYD_G_PRESS' : 'S:HYD_Y_PRESS', on ? 3000 : 0);
  if (on) set(sim, { 'S:HYD_B_PRESS': 3000, 'S:HYD_B_ELEC_PUMP_ON': 1 });
}

/** Flight controls computers / ADIRS normal (avoids unrelated cautions once engines run). */
export function avionicsNormal(sim: Sim): void {
  set(sim, {
    'S:FCTL_ELAC1_ON': 1, 'S:FCTL_ELAC2_ON': 1, 'S:FCTL_SEC1_ON': 1, 'S:FCTL_SEC2_ON': 1, 'S:FCTL_SEC3_ON': 1,
    'S:FCTL_FAC1_ON': 1, 'S:FCTL_FAC2_ON': 1, 'S:BRK_ACCU_PRESS': 3000, 'S:ADIRS_POS_ENTERED': 1,
  });
  for (const n of [1, 2, 3]) set(sim, { [`C:ADIRS_IR${n}_MODE`]: 1, [`S:ADIRS_IR${n}_STATE`]: 2, [`S:ADIRS_ADR${n}_ON`]: 1 });
  set(sim, { 'S:ADIRS_IAS': 0 });
}

export async function rig(setup?: (sim: Sim) => void): Promise<Rig> {
  const app = headlessApp();
  const sim = app.sim;
  power(sim);
  setup?.(sim);
  await installLogic(app, [install]);
  const ecam = sim.services.ecam as EcamService;
  const sounds: string[] = [];
  sim.on('fwc:sound', (p: { sound: string }) => sounds.push(p.sound));
  return {
    sim,
    ecam,
    sounds,
    left: () => ecam.ewdText().left.map(norm),
    right: () => ecam.ewdText().right.map(norm),
    warnings: () => ecam.activeWarnings(),
  };
}
