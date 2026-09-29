/**
 * Helpers to drive the MCDU with key presses (vitest + dev scenarios). DOM-free.
 */
import type { Sim } from '../../core/sim';
import type { McduModule } from './index';
import { keyOf, type Mcdu } from './mcdu/mcdu';

export function mcduModule(sim: Sim): McduModule {
  const m = sim.services.mcdu as McduModule | undefined;
  if (!m) throw new Error('mcdu module not installed');
  return m;
}

/** Press keys through the sim event bus (exactly like the 3D keyboard). */
export function press(sim: Sim, n: 1 | 2, ...keys: string[]): void {
  for (const k of keys) sim.emit(`MCDU${n}_KEY`, { key: k });
}

/** Type a text in the scratchpad ("+" = two presses of +/-). */
export function type(sim: Sim, n: 1 | 2, text: string): void {
  for (const c of text) {
    if (c === '+') { press(sim, n, 'PLUSMINUS', 'PLUSMINUS'); continue; }
    press(sim, n, keyOf(c));
  }
}

/** Type a text then press a line select key. */
export function enter(sim: Sim, n: 1 | 2, text: string, lsk: string): void {
  type(sim, n, text);
  press(sim, n, lsk);
}

/** Power the FMGCs / MCDUs (without the electrical system) and complete their power-up tests. */
export function powerUp(sim: Sim): void {
  for (const v of ['S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC1_BUS', 'S:ELEC_AC2_BUS', 'S:ELEC_AC_POWERED', 'S:ANN_POWER']) sim.set(v, 1);
  const mod = mcduModule(sim);
  mod.fmgs.skipInit();
  sim.run(3);
}

/** IRs in ALIGN mode (as after setting the ADIRS selectors to NAV). */
export function irsAligning(sim: Sim): void {
  for (const n of [1, 2, 3]) {
    sim.set(`S:ADIRS_IR${n}_STATE`, 1);
    sim.set(`S:ADIRS_IR${n}_ALIGN_REMAIN`, 420);
    sim.set(`S:ADIRS_IR${n}_ALIGNED`, 0);
  }
}

export function irsAligned(sim: Sim): void {
  for (const n of [1, 2, 3]) {
    sim.set(`S:ADIRS_IR${n}_STATE`, 2);
    sim.set(`S:ADIRS_IR${n}_ALIGN_REMAIN`, 0);
    sim.set(`S:ADIRS_IR${n}_ALIGNED`, 1);
  }
  sim.set('S:ADIRS_LAT', sim.get('G:AC_LAT'));
  sim.set('S:ADIRS_LON', sim.get('G:AC_LON'));
  sim.set('S:ADIRS_POS_ENTERED', 1);
}

/** INIT A with the company route (SOP: CO RTE, FLT NBR, ALIGN IRS). */
export function doInitA(sim: Sim, n: 1 | 2 = 1): void {
  press(sim, n, 'INIT');
  enter(sim, n, 'LFBDLFPO1', 'L1');
  enter(sim, n, 'SIM6205', 'L3');
  sim.run(0.2);
}

/** INIT B: ZFW/ZFWCG and BLOCK from the load sheet / OFP. */
export function doInitB(sim: Sim, n: 1 | 2 = 1): void {
  press(sim, n, 'INIT', 'NEXT');
  enter(sim, n, '57.6/27.4', 'R1');
  enter(sim, n, '6.2', 'R2');
  sim.run(0.5);
}

/** PERF TAKE OFF from the EFB take-off performance. */
export function doPerfTo(sim: Sim, n: 1 | 2 = 1): void {
  press(sim, n, 'PERF');
  enter(sim, n, '142', 'L1');
  enter(sim, n, '144', 'L2');
  enter(sim, n, '148', 'L3');
  enter(sim, n, '1/UP1.0', 'R3');
  enter(sim, n, '58', 'R4');
  sim.run(0.2);
}

/** Screen text lines of an MCDU (tests). */
export function lines(m: Mcdu): string[] {
  return m.render().lines();
}
