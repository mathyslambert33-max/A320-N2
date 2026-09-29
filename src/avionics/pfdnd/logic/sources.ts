/**
 * Data sources for the EFIS (PFD/ND), FCU and ISIS: electrical power, DMC availability and the
 * air data / inertial data selected for each side (CAPT = 1, F/O = 2).
 *
 * Every read degrades gracefully: when the owning module has not written a variable yet, the data
 * is reported invalid (the displays then show the red flags, as on the aircraft while the IRs align).
 * DOM-free.
 */
import type { Sim } from '../../../core/sim';

export type Side = 1 | 2;

export const norm360 = (a: number): number => ((a % 360) + 360) % 360;
/** Signed smallest difference a - b in degrees (-180..180). */
export const angDiff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;

/** Read a bus variable, falling back to `S:ELEC_AC_POWERED` for AC buses when the bus var is absent. */
function bus(sim: Sim, name: string, fallback?: string): boolean {
  if (sim.has(name)) return sim.getB(name);
  return fallback ? sim.getB(fallback) : false;
}

export const power = {
  acEss: (sim: Sim) => bus(sim, 'S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_POWERED'),
  acEssShed: (sim: Sim) => bus(sim, 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC_POWERED'),
  ac1: (sim: Sim) => bus(sim, 'S:ELEC_AC1_BUS', 'S:ELEC_AC_POWERED'),
  ac2: (sim: Sim) => bus(sim, 'S:ELEC_AC2_BUS', 'S:ELEC_AC_POWERED'),
  dcEss: (sim: Sim) => bus(sim, 'S:ELEC_DC_ESS_BUS'),
  dc2: (sim: Sim) => bus(sim, 'S:ELEC_DC2_BUS'),
  dcHot1: (sim: Sim) => bus(sim, 'S:ELEC_HOT_BUS1'),
};

/** DMC n available (ECAM module publishes S:DMC_POWERED_n; fallback to its supply bus). */
export function dmcAvailable(sim: Sim, n: 1 | 2 | 3): boolean {
  const v = `S:DMC_POWERED_${n}`;
  if (sim.has(v)) return sim.getB(v);
  return n === 1 ? power.acEss(sim) : n === 2 ? power.ac2(sim) : power.ac1(sim);
}

/** DMC feeding the CAPT (1) or F/O (2) EFIS, from the EIS DMC selector (0 CAPT 3, 1 NORM, 2 F/O 3). */
export function dmcForSide(sim: Sim, side: Side): 1 | 2 | 3 {
  const sel = Math.round(sim.has('C:SW_EIS_DMC') ? sim.get('C:SW_EIS_DMC') : 1);
  if (side === 1) return sel === 0 ? 3 : 1;
  return sel === 2 ? 3 : 2;
}

/** FMGC of a side (FMGC1 for CAPT, FMGC2 for F/O, with cross-side fallback). */
export function fmgcAvailable(sim: Sim, side?: Side): boolean {
  if (!sim.getB('S:FMGS_POWERED')) return false;
  if (side === undefined) return true;
  const own = `S:FMGS_FMGC${side}_POWERED`;
  const other = `S:FMGS_FMGC${side === 1 ? 2 : 1}_POWERED`;
  if (!sim.has(own)) return true;
  return sim.getB(own) || sim.getB(other);
}

export interface SideData {
  attValid: boolean;
  hdgValid: boolean;
  navValid: boolean;
  adrValid: boolean;
  pitch: number;
  roll: number;
  hdgMag: number;
  hdgTrue: number;
  trkMag: number;
  trkTrue: number;
  gs: number;
  /** CAS kt (0 = not computed, below 30 kt). */
  ias: number;
  tas: number;
  mach: number;
  /** Pressure altitude ft (1013.25 hPa). */
  altStd: number;
  /** Static pressure hPa. */
  ps: number;
  /** Inertial vertical speed ft/min. */
  vs: number;
  windValid: boolean;
  windDir: number;
  windSpd: number;
  lat: number;
  lon: number;
  sat: number;
  raValid: boolean;
  ra: number;
  onGround: boolean;
}

const SIDE = ['', 'CAPT', 'FO'] as const;

function sideFlag(sim: Sim, side: Side, what: 'ATT' | 'HDG' | 'NAV' | 'ADR'): boolean {
  const v = `S:ADIRS_${SIDE[side]}_${what}_VALID`;
  if (sim.has(v)) return sim.getB(v);
  // Fallback: IR n / ADR n of the side (normal switching), then nothing (invalid).
  if (what === 'ADR') {
    const a = `S:ADIRS_ADR${side}_ON`;
    return sim.has(a) ? sim.getB(a) : false;
  }
  const u = `S:ADIRS_IR${side}_${what}_VALID`;
  if (sim.has(u)) return sim.getB(u);
  const st = `S:ADIRS_IR${side}_STATE`;
  if (sim.has(st)) {
    const s = sim.get(st);
    if (what === 'ATT') return s === 2 || s === 3;
    if (what === 'HDG') return s === 2;
    return s === 2;
  }
  return false;
}

/** Static pressure (hPa) from pressure altitude (ISA). */
export const psFromAltStd = (alt: number) => 1013.25 * Math.pow(Math.max(0.01, 1 - alt / 145366.45), 1 / 0.190284);
/** Baro-corrected altitude (ft) from static pressure and altimeter setting (hPa). */
export const baroAlt = (ps: number, setting: number) => 145366.45 * (1 - Math.pow(ps / setting, 0.190284));

export function sideData(sim: Sim, side: Side): SideData {
  const onGround = sim.has('G:AC_ON_GROUND') ? sim.getB('G:AC_ON_GROUND') : true;
  const altStd = sim.get('S:ADIRS_BARO_ALT_STD');
  const ps = sim.has('S:ADIRS_STATIC_PRESS') && sim.get('S:ADIRS_STATIC_PRESS') > 100 ? sim.get('S:ADIRS_STATIC_PRESS') : psFromAltStd(altStd);
  // Radio altimeter: RA1 on AC BUS 1, RA2 on AC BUS 2 (sys-misc publishes S:RA_ALT when available).
  const raPowered = side === 1 ? power.ac1(sim) : power.ac2(sim);
  let ra = 0;
  if (sim.has('S:RA_ALT')) ra = sim.get('S:RA_ALT');
  else if (!onGround && sim.has('G:AC_ALT_AGL_FT')) ra = sim.get('G:AC_ALT_AGL_FT');
  return {
    attValid: sideFlag(sim, side, 'ATT'),
    hdgValid: sideFlag(sim, side, 'HDG'),
    navValid: sideFlag(sim, side, 'NAV'),
    adrValid: sideFlag(sim, side, 'ADR'),
    pitch: sim.get('S:ADIRS_PITCH'),
    roll: sim.get('S:ADIRS_ROLL'),
    hdgMag: sim.get('S:ADIRS_HDG_MAG'),
    hdgTrue: sim.get('S:ADIRS_HDG_TRUE'),
    trkMag: sim.has('S:ADIRS_TRK_MAG') ? sim.get('S:ADIRS_TRK_MAG') : sim.get('S:ADIRS_HDG_MAG'),
    trkTrue: sim.has('S:ADIRS_TRK_TRUE') ? sim.get('S:ADIRS_TRK_TRUE') : sim.get('S:ADIRS_HDG_TRUE'),
    gs: sim.get('S:ADIRS_GS'),
    ias: sim.get('S:ADIRS_IAS'),
    tas: sim.get('S:ADIRS_TAS'),
    mach: sim.get('S:ADIRS_MACH'),
    altStd,
    ps,
    vs: sim.get('S:ADIRS_VS'),
    windValid: sim.getB('S:ADIRS_WIND_VALID'),
    windDir: sim.get('S:ADIRS_WIND_DIR'),
    windSpd: sim.get('S:ADIRS_WIND_SPD'),
    lat: sim.has('S:ADIRS_LAT') ? sim.get('S:ADIRS_LAT') : sim.get('G:AC_LAT'),
    lon: sim.has('S:ADIRS_LON') ? sim.get('S:ADIRS_LON') : sim.get('G:AC_LON'),
    sat: sim.get('S:ADIRS_SAT'),
    raValid: raPowered,
    ra,
    onGround,
  };
}

/** Engines running (either). */
export function anyEngineRunning(sim: Sim): boolean {
  return sim.getB('S:ENG1_RUNNING') || sim.getB('S:ENG2_RUNNING');
}

export const onGround = (sim: Sim): boolean => (sim.has('G:AC_ON_GROUND') ? sim.getB('G:AC_ON_GROUND') : true);
