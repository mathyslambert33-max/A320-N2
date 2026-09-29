/**
 * ECAM memos (E/WD lower part).
 *
 * Left column (only when no warning/caution is displayed): T.O memo / LDG memo, REFUELG,
 * IRS IN ALIGN, GND SPLRS ARMED, SEAT BELTS, NO SMOKING, STROBE LT OFF, OUTR TK FUEL XFRD,
 * GPWS FLAP MODE OFF.
 * Right column: T.O INHIBIT, LDG INHIBIT, SPEED BRK, PARK BRK, HYD PTU, RAT OUT, EMER GEN,
 * NW STRG DISC, IGNITION, PRED W/S OFF, TERR OFF, ENG A.ICE, WING A.ICE, APU AVAIL, APU BLEED,
 * LDG LT, BRK FAN, AUDIO 3 XFRD, SWITCHG PNL, GPWS FLAP 3, MAN LDG ELEV, FUEL X FEED, CTR TK FEEDG.
 */
import type { Acq } from './acq';
import type { Line, Seg } from './types';

export interface MemoEnv {
  a: Acq;
  phase: number;
  toMemo: boolean;
  ldgMemo: boolean;
  toConfigNormal: boolean;
  /** T.O CONFIG pressed in phase 2 (some memos turn amber). */
  toCfgTestedPhase2: boolean;
  /** Seconds an engine has been running (NW STRG DISC turns amber after 30 s). */
  engRunningFor: number;
  showToInhibit: boolean;
  showLdgInhibit: boolean;
  speedBrakeExtended: boolean;
}

const G = (t: string, extra: Partial<Seg> = {}): Seg => ({ t, c: 'G', ...extra });
const C = (t: string): Seg => ({ t, c: 'C' });
const A = (t: string, extra: Partial<Seg> = {}): Seg => ({ t, c: 'A', ...extra });

export function computeMemos(m: MemoEnv): { left: Line[]; right: Line[] } {
  const a = m.a;
  const left: Line[] = [];
  const right: Line[] = [];
  const configMemo = m.toMemo || m.ldgMemo;

  // ----------------------------------------------------------- LEFT
  if (m.toMemo) {
    // "T.O" underlined; each line cyan with dots until the item is done, then green.
    left.push(a.autobrake === 3
      ? [G('T.O', { u: true }), G(' AUTO BRK MAX')]
      : [G('T.O', { u: true }), G(' AUTO BRK'), C('.....MAX')]);
    const signs = a.seatBelts && a.noSmoking;
    left.push(signs ? [G('    SIGNS ON')] : [G('    SIGNS'), C('.........ON')]);
    left.push(a.cabinReady ? [G('    CABIN READY')] : [G('    CABIN'), C('......CHECK')]);
    left.push(a.gndSplrArmed ? [G('    SPLRS ARM')] : [G('    SPLRS'), C('........ARM')]);
    const flapsTo = a.flapsLever >= 1 && a.flapsLever <= 3;
    left.push(flapsTo ? [G('    FLAPS T.O')] : [G('    FLAPS'), C('........T.O')]);
    left.push(m.toConfigNormal ? [G('    T.O CONFIG NORMAL')] : [G('    T.O CONFIG'), C('..TEST')]);
  }
  if (!configMemo) {
    if (a.refuel) left.push([G('REFUELG')]);
    const irs = irsMemo(m);
    if (irs) left.push(irs);
    if (a.gndSplrArmed) left.push([G('GND SPLRS ARMED')]);
    if (a.seatBelts) left.push([G('SEAT BELTS')]);
    if (a.noSmoking) left.push([G('NO SMOKING')]);
    if (!a.onGround && a.strobeSw === 2) left.push([G('STROBE LT OFF')]);
    if (a.gpwsFlapModeOff) left.push([G('GPWS FLAP MODE OFF')]);
  }

  // ----------------------------------------------------------- RIGHT
  const ph = m.phase;
  if (m.showToInhibit) right.push([{ t: 'T.O INHIBIT', c: 'M' }]);
  if (m.showLdgInhibit) right.push([{ t: 'LDG INHIBIT', c: 'M' }]);
  if (m.speedBrakeExtended && ![1, 8, 9, 10].includes(ph)) {
    const amber = ph === 2 || ph === 3 || ph === 4 || (ph >= 5 && a.eng.some((e) => e.tla > 25));
    right.push([amber ? A('SPEED BRK') : G('SPEED BRK')]);
  }
  if (a.parkBrake && [1, 2, 9, 10].includes(ph)) right.push([G('PARK BRK')]);
  if (a.ptuActive) right.push([G('HYD PTU')]);
  if (a.ratDeployed > 0.1) right.push([G('RAT OUT')]);
  if (a.sim.getB('S:ELEC_EMER_GEN_ON')) right.push([G('EMER GEN')]);
  if (a.towbar) right.push([m.engRunningFor > 30 ? A('NW STRG DISC') : G('NW STRG DISC')]);
  if (a.engModeSel === 2 || a.eng.some((e) => e.manStart && e.master)) right.push([G('IGNITION')]);
  if (a.pwsOff && ph !== 1 && ph !== 10) {
    const amber = [3, 4, 5, 7, 8, 9].includes(ph) || m.toCfgTestedPhase2;
    right.push([amber ? A('PRED W/S OFF') : G('PRED W/S OFF')]);
  }
  if (a.gpwsTerrOff && ph !== 1 && ph !== 10) {
    const amber = [3, 4, 5, 7, 8, 9].includes(ph) || m.toCfgTestedPhase2;
    right.push([amber ? A('TERR OFF') : G('TERR OFF')]);
  }
  if ((a.eng1AiOn || a.eng2AiOn) && ![3, 4, 5, 7, 8].includes(ph)) right.push([G('ENG A.ICE')]);
  if (a.wingAiOn || a.wingAiPb) right.push([G('WING A.ICE')]);
  if (a.apuAvail && !a.apuBleedValve) right.push([G('APU AVAIL')]);
  if (a.apuAvail && a.apuBleedValve) right.push([G('APU BLEED')]);
  if (a.landLtExt) right.push([G('LDG LT')]);
  if (a.brkFanPb) right.push([G('BRK FAN')]);
  if (a.audioSw !== 1) right.push([G('AUDIO 3 XFRD')]);
  if (a.swAttHdg !== 1 || a.swAirData !== 1 || a.swEisDmc !== 1 || a.swEcamNdXfr !== 1) right.push([G('SWITCHG PNL')]);
  if (a.gpwsFlap3) right.push([G('GPWS FLAP 3')]);
  if (a.ldgElevMan) right.push([G('MAN LDG ELEV')]);
  if (a.xfeedPb) right.push([[3, 4, 5].includes(ph) ? A('FUEL X FEED') : G('FUEL X FEED')]);
  if (a.fuelC > 30 && a.fuelModeAuto && (a.ctrPumpPb[0] || a.ctrPumpPb[1]) && a.sim.getB('S:FUEL_CTR_PUMPS_ON')) {
    right.push([G('CTR TK FEEDG')]);
  }
  return { left, right };
}

/**
 * IRS IN ALIGN X MN: displayed in phases 1 and 2 while at least one IRS aligns.
 *  - green steady; green FLASHING when an alignment problem exists (present position not entered at
 *    the end of the alignment, or alignment fault);
 *  - AMBER when one engine is running (IRS should be aligned before engine start).
 * X = time to NAV in minutes (> 7 MN above 7 minutes, no figure when waiting for the position).
 */
function irsMemo(m: MemoEnv): Line | null {
  const a = m.a;
  if (m.phase !== 1 && m.phase !== 2) return null;
  let remain = -1;
  let problem = false;
  for (let i = 0; i < 3; i++) {
    if (a.irState[i] === 1) remain = Math.max(remain, a.irRemain[i]);
    if (a.irState[i] === 4 && a.irMode[i] === 1) problem = true;
  }
  if (remain < 0) return null;
  if (!a.posEntered && remain <= 60) problem = true;
  const mins = Math.ceil(remain / 60);
  let txt = 'IRS IN ALIGN';
  if (remain > 0 && (a.posEntered || remain > 60)) txt = mins > 7 ? 'IRS IN ALIGN > 7 MN' : `IRS IN ALIGN ${Math.max(1, mins)} MN`;
  if (a.anyEngRunning) return [A(txt)];
  return [G(txt, { flash: problem })];
}
