/**
 * ADIRS — 3 ADIRUs (ADR + IR), overhead ADIRS panel (IR/ADR pbs, IR mode selectors, ON BAT light).
 * FCOM DSC-34-10 (ADIRS), FlyByWire A32NX `adirs.rs` used as a behavioural cross-check only.
 *
 * This aircraft has the ADIRS panel WITHOUT the CDU (see docs/ref): the present position is sent by the
 * MCDU INIT A "ALIGN IRS→" prompt (event `adirs:position {lat, lon}`) to every IR in alignment.
 *
 * Behaviour
 *  - Power: ADIRU 1 AC ESS BUS, ADIRU 2 AC BUS 2, ADIRU 3 AC BUS 1 (AC ESS SHED when ATT HDG = CAPT 3).
 *    DC back-up from the hot battery buses (1: HOT 1, 2: HOT 2, 3: HOT 1). On battery only, ADIRU 2 and
 *    ADIRU 3 (unless ATT HDG CAPT 3) shut down after 5 min; ADIRU 1 stays on battery.
 *  - Full power-up (selector OFF → NAV/ATT after > 5 s OFF): power-up BITE; the IR FAULT light blinks
 *    for 0.1 s, the ON BAT light comes on for 5 s from t = 10.5 s (battery path test — "ON BAT comes on
 *    for 5 s during the power-up test"), ADR data valid after 18 s, attitude after 28 s.
 *  - NAV alignment: T = 300 s / cos(lat) up to 60° (≈ 7 min 03 s at LFBD 44.8°N), 600 s up to 73°,
 *    1020 s up to 82°, impossible above (align fault). settings.irsAlign: 'fast' = 90 s, 'instant' = 5 s.
 *    Heading is output during the last 2 min. ALIGN light steady.
 *  - Present position: needed to complete the alignment. Without it the countdown stops at 1 min (TTN 1)
 *    and the ALIGN light flashes (FCOM: "no present position entry ... ALIGN light flashes"); the IRS
 *    completes 60 s after the entry. An entry differing by more than 1° from the position memorised at
 *    the last shutdown is rejected (ALIGN flashes, re-entry needed).
 *  - Excess motion (aircraft moving during alignment, G:AC_GS_KT > 0.5 kt): ALIGN flashes; the alignment
 *    restarts from the beginning 2 s after the aircraft has stopped.
 *  - Fast realignment: selector OFF then back to NAV within 5 s while aligned → 30 s alignment, no ON BAT
 *    test, stored position kept. OFF → NAV within 5 s during an alignment restarts the alignment.
 *    OFF for more than 5 s: the ADIRU is de-energised, alignment lost, position memorised.
 *  - ATT mode: attitude only (after 28 s); heading only once entered (event `adirs:heading {hdg, ir?}`,
 *    magnetic, e.g. from the MCDU); the entered heading then drifts (15°/h) and must be reset regularly.
 *  - IR pb OFF: IR outputs disconnected (IR keeps aligning). ADR pb OFF: ADR outputs disconnected.
 */
import type { Sim } from '../../core/sim';
import type { AlignMode } from '../../core/settings';
import { type Ctx, b2n, flash1Hz, norm360, angDiff } from './common';

export type IrPhase = 'off' | 'align' | 'nav' | 'att';

/** Alignment duration (s) for a latitude and the player's setting. Returns Infinity if impossible. */
export function alignDuration(mode: AlignMode, latDeg: number): number {
  const a = Math.abs(latDeg);
  if (a > 82) return Infinity;
  if (mode === 'instant') return 5;
  if (mode === 'fast') return 90;
  if (a > 73) return 1020;
  if (a > 60) return 600;
  return 300 / Math.cos((a * Math.PI) / 180);
}

const ON_BAT_TEST_START = 10.5;
const ON_BAT_TEST_LEN = 5;
const QUICK_WINDOW = 5;
const FAST_REALIGN = 30;
const ATT_INIT = 28;
const ADR_INIT = 18;
const BAT_LIMIT = 300;
const MOTION_KT = 0.5;
/** Nominal ground attitude of the A320 at the stand (deg). */
const GROUND_PITCH = 0.4;
const GROUND_ROLL = 0.1;

/** Per-IR constant drift after alignment (NM/h, true direction). */
const DRIFT = [
  { rate: 0.6, dir: 40 },
  { rate: 0.9, dir: 205 },
  { rate: 0.75, dir: 310 },
];

class Adiru {
  energized = false;
  onBat = false;
  batTime = 0;
  batCutoff = false;
  phase: IrPhase = 'off';
  offTimer = 1e9;
  lastAligned = false;
  powerUpT = 1e9;
  fullPowerUp = false;
  faultBlink = 0;
  attInit = 0;
  adrInit = 0;
  alignTotal = 0;
  alignRemain = 0;
  posOk = false;
  posRejected = false;
  excessMotion = false;
  stillT = 0;
  cannotAlign = false;
  /** Position memorised at the last shutdown (deg). */
  memLat = 0;
  memLon = 0;
  /** Position entered for this alignment. */
  entLat = 0;
  entLon = 0;
  /** IR computed position (pure inertial, NAV). */
  irLat = 0;
  irLon = 0;
  refLat = 0;
  refLon = 0;
  alignedAt = 0;
  hdgEntered: number | null = null;
  hdgRefTrue = 0;
  hdgEntryT = 0;
  irFault = false;
  adrFault = false;
  constructor(readonly n: 1 | 2 | 3) {}

  get waitingPos(): boolean {
    return this.phase === 'align' && !this.posOk && this.alignRemain <= this.freeze() + 1e-6 && !this.excessMotion;
  }
  freeze(): number { return Math.min(60, 0.2 * this.alignTotal); }
  get alignFault(): boolean {
    return this.phase === 'align' && (this.excessMotion || this.cannotAlign || this.posRejected || this.waitingPos);
  }
}

export class AdirsModel {
  readonly u: [Adiru, Adiru, Adiru] = [new Adiru(1), new Adiru(2), new Adiru(3)];
  private initDone = false;

  constructor(private alignMode: () => AlignMode) {}

  init(sim: Sim): void {
    const lat = sim.get('G:AC_LAT');
    const lon = sim.get('G:AC_LON');
    for (const a of this.u) { a.memLat = lat; a.memLon = lon; a.irLat = lat; a.irLon = lon; }
    this.initDone = true;
  }

  /** MCDU INIT A "ALIGN IRS" (or any position source). Returns true if at least one IR accepted it. */
  enterPosition(sim: Sim, lat: number, lon: number): boolean {
    let accepted = false;
    for (const a of this.u) {
      if (!a.energized || a.phase !== 'align' || Math.round(sim.get(`C:ADIRS_IR${a.n}_MODE`)) !== 1) continue;
      const dLat = Math.abs(lat - a.memLat);
      const dLon = Math.abs(angDiff(lon, a.memLon));
      if (dLat <= 1 && dLon <= 1) {
        a.posOk = true;
        a.posRejected = false;
        a.entLat = lat;
        a.entLon = lon;
        accepted = true;
      } else {
        a.posOk = false;
        a.posRejected = true;
      }
    }
    return accepted;
  }

  /** ATT mode heading entry (magnetic, deg). `ir` 1..3 or undefined for every IR in ATT. */
  enterHeading(sim: Sim, hdgMag: number, ir?: number): void {
    for (const a of this.u) {
      if (ir && a.n !== ir) continue;
      if (a.phase !== 'att' || !a.energized) continue;
      a.hdgEntered = norm360(hdgMag);
      a.hdgRefTrue = sim.get('G:AC_HDG_TRUE');
      a.hdgEntryT = sim.time;
    }
  }

  setFault(which: 'IR' | 'ADR', n: number, on: boolean): void {
    const a = this.u[n - 1];
    if (!a) return;
    if (which === 'IR') a.irFault = on; else a.adrFault = on;
  }

  /** Debug / scenarios: complete every energised NAV alignment now. */
  forceAligned(sim: Sim): void {
    for (const a of this.u) {
      if (!a.energized) continue;
      a.attInit = 0; a.adrInit = 0; a.powerUpT = 1e9;
      if (a.phase === 'align') {
        a.posOk = true; a.entLat = sim.get('G:AC_LAT'); a.entLon = sim.get('G:AC_LON');
        this.completeAlignment(sim, a);
      }
    }
  }

  private completeAlignment(sim: Sim, a: Adiru): void {
    a.phase = 'nav';
    a.alignRemain = 0;
    a.excessMotion = false;
    a.posRejected = false;
    a.irLat = a.entLat;
    a.irLon = a.entLon;
    a.refLat = sim.get('G:AC_LAT');
    a.refLon = sim.get('G:AC_LON');
    a.alignedAt = sim.time;
  }

  private startAlignment(a: Adiru, total: number, keepPos: boolean): void {
    a.phase = 'align';
    a.alignTotal = total;
    a.alignRemain = total;
    a.cannotAlign = !Number.isFinite(total);
    if (a.cannotAlign) { a.alignTotal = 600; a.alignRemain = 600; }
    a.excessMotion = false;
    a.stillT = 0;
    a.posRejected = false;
    if (!keepPos) a.posOk = false;
    else { a.entLat = a.memLat; a.entLon = a.memLon; }
    a.hdgEntered = null;
  }

  private shutdown(a: Adiru): void {
    if (a.phase === 'nav') { a.memLat = a.irLat; a.memLon = a.irLon; }
    a.lastAligned = a.phase === 'nav';
    a.phase = 'off';
    a.offTimer = 0;
    a.posOk = a.lastAligned; // kept for a fast realignment only
    a.excessMotion = false;
    a.hdgEntered = null;
  }

  update(c: Ctx): void {
    const { sim, dt, p } = c;
    if (!this.initDone) this.init(sim);
    const mode = this.alignMode();
    const attHdg = Math.round(sim.get('C:SW_ATT_HDG')); // 0 CAPT 3, 1 NORM, 2 F/O 3
    const lat = sim.get('G:AC_LAT');
    const lon = sim.get('G:AC_LON');
    const moving = c.gs > MOTION_KT;
    const acAvail = [p.acEss, p.ac2, p.ac1 || (attHdg === 0 && p.acEssShed)];
    const batAvail = [p.hot1, p.hot2, p.hot1];
    const unlimitedBat = [true, false, attHdg === 0];

    for (const a of this.u) {
      const i = a.n - 1;
      const sel = Math.round(sim.get(`C:ADIRS_IR${a.n}_MODE`)); // 0 OFF, 1 NAV, 2 ATT
      // ---------------- power
      let energized = false;
      let onBat = false;
      if (sel !== 0) {
        if (acAvail[i]) {
          energized = true;
          a.batTime = 0;
          a.batCutoff = false;
        } else if (batAvail[i] && !a.batCutoff) {
          a.batTime += dt;
          if (!unlimitedBat[i] && a.batTime > BAT_LIMIT) a.batCutoff = true;
          else { energized = true; onBat = true; }
        }
      }
      a.onBat = onBat;

      if (!energized) {
        if (a.phase !== 'off' || a.energized) this.shutdown(a);
        a.energized = false;
        a.offTimer += dt;
        a.powerUpT = 1e9;
        a.faultBlink = 0;
        continue;
      }

      // ---------------- power-up
      if (!a.energized) {
        const quick = a.offTimer <= QUICK_WINDOW;
        a.energized = true;
        a.powerUpT = 0;
        a.fullPowerUp = !quick;
        if (!quick) {
          a.faultBlink = 0.1;
          a.attInit = ATT_INIT;
          a.adrInit = ADR_INIT;
          a.lastAligned = false;
        } else {
          a.attInit = Math.min(a.attInit, 2);
          a.adrInit = Math.min(a.adrInit, 2);
        }
        if (sel === 1) {
          if (quick && a.lastAligned) this.startAlignment(a, Math.min(FAST_REALIGN, alignDuration(mode, lat)), true);
          else this.startAlignment(a, alignDuration(mode, lat), false);
        } else {
          a.phase = 'att';
          a.hdgEntered = null;
        }
      } else {
        a.powerUpT += dt;
      }
      a.faultBlink = Math.max(0, a.faultBlink - dt);
      a.attInit = Math.max(0, a.attInit - dt);
      a.adrInit = Math.max(0, a.adrInit - dt);

      // ---------------- selector changes while energised
      if (sel === 1 && a.phase === 'att') this.startAlignment(a, alignDuration(mode, lat), false);
      if (sel === 2 && (a.phase === 'align' || a.phase === 'nav')) {
        if (a.phase === 'nav') { a.memLat = a.irLat; a.memLon = a.irLon; }
        a.phase = 'att';
        a.hdgEntered = null;
      }

      // ---------------- alignment
      if (a.phase === 'align') {
        const total = alignDuration(mode, lat);
        if (Number.isFinite(total) && !a.cannotAlign && a.alignTotal > total) {
          a.alignTotal = total;
          a.alignRemain = Math.min(a.alignRemain, total);
        }
        if (Math.abs(lat) > 82) a.cannotAlign = true;
        if (moving) {
          a.excessMotion = true;
          a.stillT = 0;
          a.alignRemain = a.alignTotal;
        } else if (a.excessMotion) {
          a.stillT += dt;
          if (a.stillT >= 2) { a.excessMotion = false; a.alignRemain = a.alignTotal; }
        }
        if (!a.excessMotion && !a.cannotAlign) {
          const fz = a.freeze();
          if (!a.posOk) a.alignRemain = Math.max(fz, a.alignRemain - dt);
          else a.alignRemain = Math.max(0, a.alignRemain - dt);
          if (a.alignRemain <= 0 && a.posOk) this.completeAlignment(sim, a);
        }
      }

      // ---------------- NAV: inertial position = entered position + displacement + drift
      if (a.phase === 'nav') {
        const h = (sim.time - a.alignedAt) / 3600;
        const d = DRIFT[i];
        const dN = d.rate * Math.cos((d.dir * Math.PI) / 180) * h;
        const dE = d.rate * Math.sin((d.dir * Math.PI) / 180) * h;
        a.irLat = a.entLat + (lat - a.refLat) + dN / 60;
        a.irLon = a.entLon + angDiff(lon, a.refLon) + dE / (60 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      }
    }

    this.publish(c);
  }

  private publish(c: Ctx): void {
    const { sim, p, t } = c;
    const trueHdg = norm360(sim.get('G:AC_HDG_TRUE'));
    const magVar = sim.get('G:AC_MAGVAR'); // + East
    const magHdg = norm360(trueHdg - magVar);
    const gs = c.gs;
    const pushing = sim.get('G:GND_PUSHBACK') === 1;
    const trkTrue = norm360(pushing && gs > 0.5 ? trueHdg + 180 : trueHdg);
    const lat = sim.get('G:AC_LAT');
    const lon = sim.get('G:AC_LON');

    let anyOnBatLight = false;
    let anyOnBat = false;
    let posEntered = false;
    let anyNavOrAlign = false;
    let allAligningHavePos = true;
    let alignRemainMax = 0;
    let anyAlignFault = false;
    const attValid = [false, false, false];
    const hdgValid = [false, false, false];
    const navValid = [false, false, false];
    const adrValid = [false, false, false];

    for (const a of this.u) {
      const i = a.n - 1;
      const n = a.n;
      const irPb = sim.get(`C:ADIRS_IR${n}`) > 0.5;
      const adrPb = sim.get(`C:ADIRS_ADR${n}`) > 0.5;
      const e = a.energized;
      const hdgThresh = Math.min(120, 0.25 * a.alignTotal);
      const att = e && a.phase !== 'off' && a.attInit <= 0 && !a.irFault;
      const hdg = e && !a.irFault && (a.phase === 'nav' ||
        (a.phase === 'align' && !a.excessMotion && !a.cannotAlign && a.alignRemain <= hdgThresh) ||
        (a.phase === 'att' && a.hdgEntered !== null && a.attInit <= 0));
      const nav = e && !a.irFault && a.phase === 'nav';
      attValid[i] = att && irPb;
      hdgValid[i] = hdg && irPb;
      navValid[i] = nav && irPb;
      adrValid[i] = e && adrPb && a.adrInit <= 0 && !a.adrFault;

      const batTest = e && a.fullPowerUp && a.powerUpT >= ON_BAT_TEST_START && a.powerUpT < ON_BAT_TEST_START + ON_BAT_TEST_LEN;
      const batPath = n === 2 ? p.hot2 : p.hot1;
      if (a.onBat) anyOnBat = true;
      if (a.onBat || (batTest && batPath)) anyOnBatLight = true;

      let state = 0;
      if (e && a.phase !== 'off') {
        if (a.irFault || a.cannotAlign) state = 4;
        else state = a.phase === 'align' ? 1 : a.phase === 'nav' ? 2 : 3;
      }
      sim.set(`S:ADIRS_IR${n}_STATE`, state);
      sim.set(`S:ADIRS_IR${n}_ALIGN_REMAIN`, e && a.phase === 'align' ? Math.round(a.alignRemain * 10) / 10 : 0);
      sim.set(`S:ADIRS_IR${n}_ALIGNED`, nav);
      sim.set(`S:ADIRS_IR${n}_ALIGN_FAULT`, e && a.alignFault);
      sim.set(`S:ADIRS_IR${n}_POS_OK`, e && (a.phase === 'nav' || (a.phase === 'align' && a.posOk)));
      sim.set(`S:ADIRS_IR${n}_ATT_VALID`, attValid[i]);
      sim.set(`S:ADIRS_IR${n}_HDG_VALID`, hdgValid[i]);
      sim.set(`S:ADIRS_IR${n}_NAV_VALID`, navValid[i]);
      sim.set(`S:ADIRS_IR${n}_ON_BAT`, a.onBat);
      sim.set(`S:ADIRS_IR${n}_LAT`, a.phase === 'nav' ? a.irLat : a.memLat);
      sim.set(`S:ADIRS_IR${n}_LON`, a.phase === 'nav' ? a.irLon : a.memLon);
      sim.set(`S:ADIRS_ADR${n}_ON`, adrValid[i]);

      if (e && (a.phase === 'align' || a.phase === 'nav')) anyNavOrAlign = true;
      if (e && a.phase === 'align') {
        alignRemainMax = Math.max(alignRemainMax, a.alignRemain);
        if (!a.posOk) allAligningHavePos = false;
      }
      if (e && a.alignFault) anyAlignFault = true;

      // ---------------- lights (annunciators need DC BAT / DC ESS)
      const ann = p.ann;
      const alignLt = e && ann && ((a.phase === 'align' && (a.alignFault ? flash1Hz(t) : true)) || (a.phase === 'att' && a.attInit > 0));
      const faultLt = ann && e && (a.irFault || a.faultBlink > 0);
      const adrFaultLt = ann && e && a.adrFault;
      const adrOffLt = ann && !adrPb;
      // explicit ids so tools/check-vars.mjs can see every light
      if (n === 1) {
        sim.set('L:ADIRS_IR1_ALIGN', b2n(alignLt)); sim.set('L:ADIRS_IR1_FAULT', b2n(faultLt));
        sim.set('L:ADIRS_ADR1_FAULT', b2n(adrFaultLt)); sim.set('L:ADIRS_ADR1_OFF', b2n(adrOffLt));
      } else if (n === 2) {
        sim.set('L:ADIRS_IR2_ALIGN', b2n(alignLt)); sim.set('L:ADIRS_IR2_FAULT', b2n(faultLt));
        sim.set('L:ADIRS_ADR2_FAULT', b2n(adrFaultLt)); sim.set('L:ADIRS_ADR2_OFF', b2n(adrOffLt));
      } else {
        sim.set('L:ADIRS_IR3_ALIGN', b2n(alignLt)); sim.set('L:ADIRS_IR3_FAULT', b2n(faultLt));
        sim.set('L:ADIRS_ADR3_FAULT', b2n(adrFaultLt)); sim.set('L:ADIRS_ADR3_OFF', b2n(adrOffLt));
      }
    }
    posEntered = anyNavOrAlign && allAligningHavePos && this.u.some((a) => a.energized && (a.phase === 'nav' || (a.phase === 'align' && a.posOk)));

    // ON BAT light: hot-bus powered annunciator.
    sim.set('L:ADIRS_ON_BAT', b2n(anyOnBatLight && (p.hot1 || p.hot2 || p.ann)));
    sim.set('S:ADIRS_ON_BAT', anyOnBat || anyOnBatLight);
    sim.set('S:ADIRS_ON_BAT_SUPPLY', anyOnBat);
    sim.set('S:ADIRS_POS_ENTERED', posEntered);
    sim.set('S:ADIRS_ALIGN_REMAIN', Math.round(alignRemainMax * 10) / 10);
    sim.set('S:ADIRS_ALIGN_FAULT', anyAlignFault);
    sim.set('S:ADIRS_ANY_ALIGNED', navValid.some(Boolean));

    // ---------------- side selection (pedestal SWITCHING panel)
    const attHdg = Math.round(sim.get('C:SW_ATT_HDG'));
    const airData = Math.round(sim.get('C:SW_AIR_DATA'));
    const captIr = attHdg === 0 ? 3 : 1;
    const foIr = attHdg === 2 ? 3 : 2;
    const captAdr = airData === 0 ? 3 : 1;
    const foAdr = airData === 2 ? 3 : 2;
    sim.set('S:ADIRS_CAPT_IR', captIr);
    sim.set('S:ADIRS_FO_IR', foIr);
    sim.set('S:ADIRS_CAPT_ADR', captAdr);
    sim.set('S:ADIRS_FO_ADR', foAdr);
    sim.set('S:ADIRS_CAPT_ATT_VALID', attValid[captIr - 1]);
    sim.set('S:ADIRS_CAPT_HDG_VALID', hdgValid[captIr - 1]);
    sim.set('S:ADIRS_CAPT_NAV_VALID', navValid[captIr - 1]);
    sim.set('S:ADIRS_CAPT_ADR_VALID', adrValid[captAdr - 1]);
    sim.set('S:ADIRS_FO_ATT_VALID', attValid[foIr - 1]);
    sim.set('S:ADIRS_FO_HDG_VALID', hdgValid[foIr - 1]);
    sim.set('S:ADIRS_FO_NAV_VALID', navValid[foIr - 1]);
    sim.set('S:ADIRS_FO_ADR_VALID', adrValid[foAdr - 1]);

    // ---------------- IR data (physical values; validity in the *_VALID flags)
    const onGround = c.onGround;
    sim.set('S:ADIRS_PITCH', onGround ? GROUND_PITCH : sim.has('G:AC_PITCH') ? sim.get('G:AC_PITCH') : 2.5);
    sim.set('S:ADIRS_ROLL', onGround ? GROUND_ROLL : sim.has('G:AC_ROLL') ? sim.get('G:AC_ROLL') : 0);
    // Heading output: in ATT mode (entered heading) use the first IR in ATT with a heading.
    let hdgMagOut = magHdg;
    let hdgTrueOut = trueHdg;
    const attIr = this.u.find((a) => a.phase === 'att' && a.hdgEntered !== null && a.energized);
    if (attIr && !navValid.some(Boolean) && attIr.hdgEntered !== null) {
      const drift = ((sim.time - attIr.hdgEntryT) / 3600) * 15;
      hdgMagOut = norm360(attIr.hdgEntered + angDiff(trueHdg, attIr.hdgRefTrue) + drift);
      hdgTrueOut = norm360(hdgMagOut + magVar);
    }
    sim.set('S:ADIRS_HDG_TRUE', Math.round(hdgTrueOut * 100) / 100);
    sim.set('S:ADIRS_HDG_MAG', Math.round(hdgMagOut * 100) / 100);
    sim.set('S:ADIRS_TRK_TRUE', Math.round(trkTrue * 100) / 100);
    sim.set('S:ADIRS_TRK_MAG', Math.round(norm360(trkTrue - magVar) * 100) / 100);
    sim.set('S:ADIRS_GS', Math.round(gs * 10) / 10);
    sim.set('S:ADIRS_VS', onGround ? 0 : sim.has('G:AC_VS_FPM') ? sim.get('G:AC_VS_FPM') : 0);
    // FM/GPIRS position: GPS-hybrid position (true position) once an IR is in NAV; before, the stored one.
    if (navValid.some(Boolean)) {
      sim.set('S:ADIRS_LAT', lat);
      sim.set('S:ADIRS_LON', lon);
    } else {
      sim.set('S:ADIRS_LAT', this.u[0].memLat);
      sim.set('S:ADIRS_LON', this.u[0].memLon);
    }

    // ---------------- ADR data
    const oat = sim.get('G:ENV_OAT');
    const qnh = sim.has('G:ENV_QNH') ? sim.get('G:ENV_QNH') : 1013.25;
    const elev = sim.get('G:ENV_ELEV_FT') + (onGround ? 0 : sim.has('G:AC_ALT_AGL_FT') ? sim.get('G:AC_ALT_AGL_FT') : 0);
    // Static pressure at the aircraft from QNH (ISA reduction), then pressure altitude (1013.25 hPa).
    const ps = qnh * Math.pow(1 - 6.8755856e-6 * elev, 5.2558797);
    const pAlt = 145366.45 * (1 - Math.pow(ps / 1013.25, 0.190284));
    sim.set('S:ADIRS_BARO_ALT_STD', Math.round(pAlt));
    sim.set('S:ADIRS_STATIC_PRESS', Math.round(ps * 100) / 100);
    // Air speed: ground speed + head-wind component (wind is from G:ENV_WIND_DIR, true).
    const wDir = sim.get('G:ENV_WIND_DIR');
    const wKt = sim.get('G:ENV_WIND_KT');
    const head = wKt * Math.cos(((wDir - trueHdg) * Math.PI) / 180);
    const tas = Math.max(0, (pushing ? -gs : gs) + head);
    const tK = oat + 273.15;
    const rhoRatio = (ps / 1013.25) * (288.15 / tK);
    const cas = tas * Math.sqrt(rhoRatio);
    const mach = tas / (38.967854 * Math.sqrt(tK));
    // CAS below 30 kt is not computed (NCD) — the PFD shows the bottom of the tape.
    sim.set('S:ADIRS_IAS', cas >= 30 ? Math.round(cas * 10) / 10 : 0);
    sim.set('S:ADIRS_TAS', tas >= 60 ? Math.round(tas * 10) / 10 : 0);
    sim.set('S:ADIRS_MACH', mach >= 0.1 ? Math.round(mach * 1000) / 1000 : 0);
    sim.set('S:ADIRS_SAT', Math.round(oat * 10) / 10);
    // TAT: ram rise (recovery ≈ 1); on ground the heated, unaspirated probe reads a little above SAT.
    const tat = tK * (1 + 0.2 * mach * mach) - 273.15 + (onGround && sim.getB('S:AI_PROBE_HEAT') ? 1.5 : 0);
    sim.set('S:ADIRS_TAT', Math.round(tat * 10) / 10);
    // IR wind: computed only with TAS > 100 kt (NCD on ground).
    const windValid = tas > 100 && navValid.some(Boolean);
    sim.set('S:ADIRS_WIND_VALID', windValid);
    sim.set('S:ADIRS_WIND_DIR', windValid ? Math.round(norm360(wDir)) : 0);
    sim.set('S:ADIRS_WIND_SPD', windValid ? Math.round(wKt) : 0);
  }
}
