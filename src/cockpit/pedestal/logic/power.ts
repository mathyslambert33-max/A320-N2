/**
 * Power helpers for the pedestal radio / audio / surveillance logic (DOM-free).
 * Bus variables are written by sys-elec; when a bus variable does not exist (sys-elec not installed,
 * unit tests) we fall back to the generic `S:ELEC_AC_POWERED` like the other avionics modules.
 */
import type { Sim } from '../../../core/sim';

export function bus(sim: Sim, name: string): boolean {
  return sim.has(name) ? sim.getB(name) : sim.getB('S:ELEC_AC_POWERED');
}

/** Annunciator lights powered (DC BAT / DC ESS, published by sys-elec as S:ANN_POWER). */
export function annPower(sim: Sim): boolean {
  if (sim.has('S:ANN_POWER')) return sim.getB('S:ANN_POWER');
  return bus(sim, 'S:ELEC_DC_BAT_BUS') || bus(sim, 'S:ELEC_DC_ESS_BUS');
}

/** RMP 1 DC ESS BUS, RMP 2 DC BUS 2, RMP 3 DC BUS 1 (FCOM DSC-23-10). */
export function rmpPowered(sim: Sim, n: number): boolean {
  return bus(sim, n === 1 ? 'S:ELEC_DC_ESS_BUS' : n === 2 ? 'S:ELEC_DC2_BUS' : 'S:ELEC_DC1_BUS');
}

/** Audio management unit channels: ACP 1 DC ESS, ACP 2 DC 2, ACP 3 DC 1. */
export function acpPowered(sim: Sim, n: number): boolean {
  return bus(sim, n === 1 ? 'S:ELEC_DC_ESS_BUS' : n === 2 ? 'S:ELEC_DC2_BUS' : 'S:ELEC_DC1_BUS');
}

/** ATC transponder 1 AC ESS SHED (fallback AC ESS), transponder 2 AC BUS 2. */
export function xpdrPowered(sim: Sim, sys: 1 | 2): boolean {
  if (sys === 1) return bus(sim, 'S:ELEC_AC_ESS_SHED') || bus(sim, 'S:ELEC_AC_ESS_BUS');
  return bus(sim, 'S:ELEC_AC2_BUS');
}

/** ATC/TCAS control panel (keyboard + code window): powered by either transponder supply. */
export function atcPanelPowered(sim: Sim): boolean {
  return xpdrPowered(sim, 1) || xpdrPowered(sim, 2);
}

/** TCAS computer: AC BUS 1. */
export function tcasPowered(sim: Sim): boolean {
  return bus(sim, 'S:ELEC_AC1_BUS');
}

/** Weather radar transceiver 1 AC BUS 1, 2 AC BUS 2. PWS computer follows the radar supplies. */
export function wxrPowered(sim: Sim, sys: 0 | 1 | 2): boolean {
  if (sys === 1) return bus(sim, 'S:ELEC_AC1_BUS');
  if (sys === 2) return bus(sim, 'S:ELEC_AC2_BUS');
  return bus(sim, 'S:ELEC_AC1_BUS') || bus(sim, 'S:ELEC_AC2_BUS');
}

/**
 * RUD TRIM position indicator: fed by the FACs (FAC 1 AC ESS + DC ESS SHED, FAC 2 AC 2 + DC 2).
 * Lit when at least one FAC supply is available.
 */
export function rudTrimIndPowered(sim: Sim): boolean {
  const fac1 = (bus(sim, 'S:ELEC_AC_ESS_BUS') || bus(sim, 'S:ELEC_AC_ESS_SHED')) && (bus(sim, 'S:ELEC_DC_ESS_SHED') || bus(sim, 'S:ELEC_DC_ESS_BUS'));
  const fac2 = bus(sim, 'S:ELEC_AC2_BUS') && bus(sim, 'S:ELEC_DC2_BUS');
  return fac1 || fac2;
}

/** Cockpit printer: AC BUS 1. */
export function printerPowered(sim: Sim): boolean {
  return bus(sim, 'S:ELEC_AC1_BUS');
}

/** 1 Hz flashing phase (on for the first half second) from sim time. */
export function flash(sim: Sim, hz = 1): boolean {
  return (sim.time * hz) % 1 < 0.5;
}
