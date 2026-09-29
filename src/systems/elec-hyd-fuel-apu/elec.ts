/**
 * A320ceo electrical network (FCOM DSC-24). DOM-free.
 *
 * Sources: 2 IDG-driven generators (90 kVA, 115 V / 400 Hz), APU generator (90 kVA), external power
 * (GPU), emergency generator (5 kVA, blue-hydraulic driven), static inverter (from BAT 1),
 * 2 × 23 Ah Ni-Cd batteries, TR 1 / TR 2 / ESS TR (28 V, 200 A).
 *
 * Contactor logic follows the A320 distribution tables (same structure as the FlyByWire A32NX
 * reference implementation): GEN > EXT PWR > APU GEN > opposite GEN, bus ties AUTO,
 * AC ESS FEED NORM (AC 1) with automatic transfer to AC 2 after 3 s, DC BAT fed by DC 1 (tie 1),
 * DC ESS from DC BAT when TR 1 and TR 2 are both available, from the ESS TR otherwise, and from
 * HOT BUS 2 when no AC is available (batteries only: 2XB contactors). On the ground below 50 kt with
 * batteries only, the static inverter supplies only the AC STAT INV bus (AC ESS unpowered).
 *
 * Battery charge limiter (BCL) logic: closes the battery contactor for APU start (MASTER SW ON and
 * APU not available), on ground with no AC below 100 kt, and for charging (battery < 26.5 V and
 * DC BAT > 27 V); opens at the end of charge (< 4 A for 10 s on ground, 30 min after an APU start),
 * discharge protection on ground (< 23 V for 15 s).
 */
import type { Sim } from '../../core/sim';
import { clamp, lag } from '../../core/sim';
import { Battery } from './battery';
import type { Model } from './model';
import {
  ChangeWatcher, DelayOn, PressWatcher, Wander, airspeed, engN2, fireReleased, onGround, oat, pbIn,
} from './common';

type AcSrc = 'GEN1' | 'GEN2' | 'APU' | 'EXT' | 'EMER' | 'INV' | '';

interface Tr { v0: number; r: number; imax: number }
const TR: Tr = { v0: 28.7, r: 0.007, imax: 320 };

/** Solve the voltage of a DC node fed by TRs and batteries (A load, constant current). */
function solveNode(trs: Tr[], bats: Battery[], load: number): number {
  if (!trs.length && !bats.some((b) => b.emf() > 0)) return 0;
  let lo = 0;
  let hi = 34;
  for (let k = 0; k < 36; k++) {
    const v = (lo + hi) / 2;
    let f = -load;
    for (const t of trs) f += clamp((t.v0 - v) / t.r, 0, t.imax);
    for (const b of bats) f -= b.currentAt(v);
    if (f > 0) lo = v;
    else hi = v;
  }
  return (lo + hi) / 2;
}
const trCurrent = (t: Tr, v: number) => clamp((t.v0 - v) / t.r, 0, t.imax);

type BclState = 'off' | 'open' | 'closed';

/** Battery charge limiter (one per battery). */
class Bcl {
  state: BclState = 'open';
  private offT = 0;
  private charge = new DelayOn(0.225);
  private below4 = 0;
  private below23 = 0;
  private hadApuStart = false;
  private dischargeLatch = false;

  get closed(): boolean { return this.state === 'closed'; }

  forceClosed(hadApuStart = false): void {
    this.state = 'closed';
    this.below4 = 0;
    this.below23 = 0;
    this.hadApuStart = hadApuStart;
  }

  forceOpen(): void {
    this.state = 'open';
  }

  update(dt: number, p: {
    auto: boolean; apuMaster: boolean; apuAvail: boolean; apuStartOn: boolean; gndNoAc: boolean;
    above100: boolean; onGround: boolean; batV: number; batI: number; busV: number;
  }): void {
    if (!p.auto) {
      this.state = 'off';
      this.offT = 0;
      this.dischargeLatch = false;
      return;
    }
    const awaitingApu = p.apuMaster && !p.apuAvail;
    switch (this.state) {
      case 'off':
        this.offT += dt;
        if (this.offT >= 1) this.forceClosed(false);
        break;
      case 'open': {
        this.charge.update(p.batV < 26.5 && p.busV > 27, dt);
        if (!p.apuMaster) this.dischargeLatch = this.dischargeLatch && p.batV < 23;
        if (!this.dischargeLatch && (awaitingApu || p.gndNoAc || this.charge.out)) this.forceClosed(false);
        break;
      }
      case 'closed': {
        if (p.apuStartOn) this.hadApuStart = true;
        this.below4 = p.batI < 4 ? this.below4 + dt : 0;
        // Discharge protection is not active while the batteries are connected for an APU start.
        this.below23 = p.batV < 23 && !awaitingApu ? this.below23 + dt : 0;
        if (p.onGround && this.below23 >= 15) {
          this.state = 'open';
          this.dischargeLatch = true;
          break;
        }
        const endOfCharge =
          (!this.hadApuStart && p.onGround && this.below4 >= 10) ||
          ((p.above100 || this.hadApuStart) && this.below4 >= 1800);
        if (!awaitingApu && !p.gndNoAc && endOfCharge) {
          this.state = 'open';
          this.charge.reset();
        }
        break;
      }
    }
  }
}

export class ElecModel {
  bat: [Battery, Battery];
  bcl: [Bcl, Bcl] = [new Bcl(), new Bcl()];
  /** EXT PWR pb latched ON (the real pb is momentary: every push toggles). */
  extOn = false;
  idgConnected: [boolean, boolean] = [true, true];
  idgTemp: [number, number] = [15, 15];
  private genReady = [new DelayOn(1.2), new DelayOn(1.2)];
  private essAltnDelay = new DelayOn(3);
  private extWatch!: ChangeWatcher;
  private idgPress!: [PressWatcher, PressWatcher];
  private emerTest!: PressWatcher;
  private w: Wander[];
  private galleyW: Wander;

  // ---- state computed each tick (read by other sub-systems & lights) ----
  ac1 = false; ac2 = false; acEss = false; acEssShed = false; acStatInv = false; acGndFlt = false;
  dc1 = false; dc2 = false; dcBat = false; dcEss = false; dcEssShed = false; dcGndFlt = false;
  hot1 = true; hot2 = true;
  ac1Src: AcSrc = ''; ac2Src: AcSrc = ''; acEssSrc: AcSrc = '';
  gen1C = false; gen2C = false; apuC = false; extC = false; busTie1 = false; busTie2 = false;
  emerGenOn = false; statInvOn = false; essTrOn = false; tr1On = false; tr2On = false;
  /** GEN 1 energised (even with GEN 1 LINE off: feeds one fuel pump per wing). */
  gen1Energised = false;
  genLoad: Record<'GEN1' | 'GEN2' | 'APU' | 'EXT' | 'EMER', number> = { GEN1: 0, GEN2: 0, APU: 0, EXT: 0, EMER: 0 };
  vDcBat = 0; vDcEss = 0; vDc1 = 0; vDc2 = 0;
  trA = { TR1: 0, TR2: 0, ESS: 0 };
  trV = { TR1: 0, TR2: 0, ESS: 0 };
  galleyShed = true;
  /** AC ESS supplied from AC BUS 2 (ALTN selected or automatic transfer). */
  essFromAc2 = false;
  /** Annunciator lights power (DC BAT / DC ESS). */
  annPower = false;
  /** APU starter actually powered this tick. */
  starterPowered = false;
  starterA = 0;
  /** Extra AC loads (kVA) requested by other sub-systems for this tick. */
  extraAc = { AC1: 0, AC2: 0, ESS_SHED: 0, STAT_INV: 0 };
  /** Extra DC loads (A). */
  extraDc = { DC_BAT: 0, HOT1: 0, HOT2: 0, DC_ESS: 0 };

  constructor(private m: Model) {
    const r = m.rng;
    // Batteries left overnight: ~70-82 % charge → 25.7-25.9 V at rest (SOP check: > 25.5 V).
    this.bat = [new Battery(0.7 + 0.12 * r()), new Battery(0.7 + 0.12 * r())];
    this.w = Array.from({ length: 12 }, (_, i) => new Wander(r, 2 + (i % 4)));
    this.galleyW = new Wander(r, 40);
  }

  init(sim: Sim): void {
    this.extWatch = new ChangeWatcher(sim, 'C:ELEC_EXT_PWR');
    this.idgPress = [new PressWatcher(sim, 'ELEC_IDG1'), new PressWatcher(sim, 'ELEC_IDG2')];
    this.emerTest = new PressWatcher(sim, 'EMER_ELEC_GEN_TEST');
    this.idgTemp = [oat(sim), oat(sim)];
    // A state loaded with EXT PWR pb already IN (scenario / harness) starts ON.
    if (pbIn(sim, 'ELEC_EXT_PWR') && sim.getB('G:GND_EXT_PWR')) this.extOn = true;
  }

  update(dt: number, sim: Sim): void {
    const m = this.m;
    // Loads requested by the other sub-systems during the previous tick
    const xa = { ...this.extraAc };
    const xd = { ...this.extraDc };
    this.extraAc = { AC1: 0, AC2: 0, ESS_SHED: 0, STAT_INV: 0 };
    this.extraDc = { DC_BAT: 0, HOT1: 0, HOT2: 0, DC_ESS: 0 };
    const gnd = onGround(sim);
    const spd = airspeed(sim);
    const spd50 = spd > 50;
    const above100 = spd > 100;

    // ---------------- controls ----------------
    const extAvail = sim.getB('G:GND_EXT_PWR');
    if (this.extWatch.changed()) {
      if (this.extOn) this.extOn = false;
      else if (extAvail) this.extOn = true;
    }
    if (!extAvail) this.extOn = false;

    const genPb = [pbIn(sim, 'ELEC_GEN1'), pbIn(sim, 'ELEC_GEN2')];
    const apuGenPb = pbIn(sim, 'ELEC_APU_GEN');
    const busTieAuto = pbIn(sim, 'ELEC_BUS_TIE');
    const essNorm = pbIn(sim, 'ELEC_AC_ESS_FEED');
    const galyAuto = pbIn(sim, 'ELEC_GALY_CAB');
    const commercialOn = pbIn(sim, 'ELEC_COMMERCIAL');
    const gen1Line = pbIn(sim, 'EMER_ELEC_GEN1_LINE');
    const firePb = [fireReleased(sim, 'FIRE_ENG1_PB'), fireReleased(sim, 'FIRE_ENG2_PB')];

    // IDG disconnect (irreversible — maintenance action on ground to reconnect).
    const dcForSolenoid = this.dcEss || this.dcBat;
    for (let i = 0; i < 2; i++) {
      const pressed = this.idgPress[i].consume() || this.idgPress[i].held();
      if (pressed && dcForSolenoid && this.idgConnected[i]) {
        this.idgConnected[i] = false;
        sim.emit('elec:idg-disc', { n: i + 1 });
      }
    }

    // ---------------- generators ----------------
    const n2 = [engN2(sim, 1), engN2(sim, 2)];
    const genAvail = [0, 1].map((i) => this.genReady[i].update(this.idgConnected[i] && n2[i] >= 55 && !firePb[i], dt));
    this.gen1Energised = genAvail[0] && genPb[0];
    const gen1Provides = genAvail[0] && genPb[0] && gen1Line;
    const gen2Provides = genAvail[1] && genPb[1];
    const bothGens = gen1Provides && gen2Provides;
    const oneGen = gen1Provides !== gen2Provides;
    const apuAvail = m.apu.genAvailable;
    const extProvides = this.extOn && extAvail && !bothGens;
    const apuProvides = apuGenPb && apuAvail && !extProvides && !bothGens;
    this.gen1C = gen1Provides;
    this.gen2C = gen2Provides;
    this.extC = extProvides;
    this.apuC = apuProvides;
    const apuOrExt = extProvides || apuProvides;
    this.busTie1 = busTieAuto && ((oneGen && !apuOrExt) || (apuOrExt && !gen1Provides));
    this.busTie2 = busTieAuto && ((oneGen && !apuOrExt) || (apuOrExt && !gen2Provides));
    // Tie node (between the two bus tie contactors) source.
    let tie: AcSrc = '';
    if (extProvides) tie = 'EXT';
    else if (apuProvides) tie = 'APU';
    else if (gen1Provides && this.busTie1) tie = 'GEN1';
    else if (gen2Provides && this.busTie2) tie = 'GEN2';
    this.ac1Src = gen1Provides ? 'GEN1' : this.busTie1 && tie ? tie : '';
    this.ac2Src = gen2Provides ? 'GEN2' : this.busTie2 && tie ? tie : '';
    this.ac1 = !!this.ac1Src;
    this.ac2 = !!this.ac2Src;

    // ---------------- emergency generator (blue hydraulic driven CSM/G) ----------------
    const blueP = m.hyd.press.B;
    const testing = this.emerTest.consume() || this.emerTest.held();
    const emerGenRunning = blueP > 2000 && ((m.hyd.ratPos > 0.99 && spd > 100) || (testing && gnd && sim.getB('C:EMER_ELEC_GEN_TEST')));
    this.emerGenOn = emerGenRunning && (!(this.ac1 || this.ac2) || testing);

    // ---------------- AC ESS ----------------
    this.essAltnDelay.update(!this.ac1, dt);
    const feed1 = this.ac1 && !this.essAltnDelay.out && essNorm && !this.emerGenOn;
    const feed2 = this.ac2 && (this.essAltnDelay.out || !essNorm) && !feed1 && !this.emerGenOn;
    this.acEssSrc = feed1 ? this.ac1Src : feed2 ? this.ac2Src : this.emerGenOn ? 'EMER' : '';
    this.essFromAc2 = feed2;
    const anyAc = this.ac1 || this.ac2;

    // ---------------- batteries & BCL (uses last tick bus voltage) ----------------
    const apuMaster = pbIn(sim, 'APU_MASTER');
    const gndNoAc = !anyAc && gnd && !above100;
    for (let i = 0; i < 2; i++) {
      this.bcl[i].update(dt, {
        auto: pbIn(sim, i === 0 ? 'ELEC_BAT1' : 'ELEC_BAT2'),
        apuMaster, apuAvail: m.apu.available, apuStartOn: m.apu.startOn, gndNoAc, above100, onGround: gnd,
        batV: this.bat[i].voltage, batI: this.bat[i].current, busV: this.vDcBat,
      });
    }
    const bc = [this.bcl[0].closed, this.bcl[1].closed];

    // Static inverter / 2XB contactors (BAT 1 → STAT INV, BAT 2 → DC ESS).
    const xb2 = !anyAc && !this.emerGenOn && (spd50 || (bc[0] && bc[1]));
    const invToAcEss = !anyAc && !this.emerGenOn && spd50;
    if (!this.acEssSrc && invToAcEss) this.acEssSrc = 'INV';

    // ---------------- TRs ----------------
    this.tr1On = this.ac1;
    const tr2FromExt = !this.ac2 && extAvail;
    this.tr2On = this.ac2 || tr2FromExt;
    const tr12Avail = this.tr1On && this.ac2; // TR 2 connected to DC 2 only through AC BUS 2
    const essTrPowered = (!tr12Avail && (feed1 || feed2)) || this.emerGenOn;
    this.essTrOn = essTrPowered;
    const dc1Src = this.tr1On;
    const dc2Src = this.tr2On && this.ac2;
    const tie1 = dc1Src || dc2Src;
    const tie2 = dc1Src !== dc2Src;
    const dcEssFromBat = tr12Avail; // 4PC
    const dcEssFromEssTr = !tr12Avail && essTrPowered; // 3PE

    // ---------------- DC loads (A) ----------------
    const w = this.w.map((x) => x.step(dt));
    const adirsOnBat = sim.getB('S:ADIRS_ON_BAT') ? 4 : 0;
    const L = {
      HOT1: 1.2 + adirsOnBat + xd.HOT1,
      HOT2: 0.8 + xd.HOT2,
      DC_BAT: 4 + xd.DC_BAT + 0.3 * w[0],
      DC_ESS: 16 + xd.DC_ESS + 1.2 * w[1],
      DC_ESS_SHED: 5 + 0.5 * w[2],
      DC1: 32 + 2 * w[3],
      DC2: 36 + 2 * w[4],
      GND_FLT: 4,
    };
    this.starterA = m.apu.starterDemandA;
    const starterReq = this.starterA > 0 && bc[0] && bc[1];

    // Static inverter DC input (from HOT BUS 1) — 0.15 kVA idle / AC STAT INV, ~1 kVA with AC ESS.
    const invKva = xb2 ? 0.15 + xa.STAT_INV + (invToAcEss ? 1.2 : 0) : 0;
    const invA = invKva > 0 ? (invKva * 1000) / (25 * 0.82) : 0;

    // ---------------- DC network solve ----------------
    // Main node: DC BAT bus (+ DC 1 via tie 1, DC 2 via tie 2, DC ESS via 4PC, hot buses via BAT contactors).
    const trs: Tr[] = [];
    let mainLoad = L.DC_BAT;
    const mainHasDc1 = tie1;
    const mainHasDc2 = tie2;
    if (mainHasDc1) mainLoad += L.DC1;
    if (dc1Src && mainHasDc1) trs.push(TR);
    if (mainHasDc2) {
      mainLoad += L.DC2;
      if (dc2Src) trs.push(TR);
    }
    if (dcEssFromBat) mainLoad += L.DC_ESS + L.DC_ESS_SHED;
    const bats: Battery[] = [];
    for (let i = 0; i < 2; i++) {
      if (bc[i]) {
        bats.push(this.bat[i]);
        mainLoad += i === 0 ? L.HOT1 : L.HOT2;
        if (xb2 && i === 0) mainLoad += invA;
        if (xb2 && i === 1) mainLoad += L.DC_ESS;
      }
    }
    if (starterReq) mainLoad += this.starterA;
    let vMain = solveNode(trs, bats, mainLoad);
    this.starterPowered = starterReq && vMain > 12;
    if (starterReq && !this.starterPowered) vMain = solveNode(trs, bats, mainLoad - this.starterA);
    // DC 2 isolated (tie 2 open while both TRs feed their bus)
    let vDc2Iso = 0;
    let tr2IsoA = 0;
    if (dc2Src && !mainHasDc2) {
      vDc2Iso = solveNode([TR], [], L.DC2);
      tr2IsoA = trCurrent(TR, vDc2Iso);
    }
    // DC GND/FLT bus fed directly by TR 2 from the GPU (AC BUS 2 unpowered)
    let vGndFlt = 0;
    let trGndA = 0;
    if (tr2FromExt) {
      vGndFlt = solveNode([TR], [], L.GND_FLT);
      trGndA = trCurrent(TR, vGndFlt);
    }
    // ESS TR node
    let vEssTr = 0;
    let essA = 0;
    if (dcEssFromEssTr) {
      vEssTr = solveNode([TR], [], L.DC_ESS + L.DC_ESS_SHED);
      essA = trCurrent(TR, vEssTr);
    }
    // Isolated batteries (contactor open) feed their hot bus (and 2XB loads).
    const isoV = [0, 0];
    for (let i = 0; i < 2; i++) {
      if (bc[i]) continue;
      let load = i === 0 ? L.HOT1 : L.HOT2;
      if (xb2 && i === 0) load += invA;
      if (xb2 && i === 1) load += L.DC_ESS;
      const b = this.bat[i];
      const v = b.emf() > 0 ? Math.max(0, b.voltageAt(-load)) : 0;
      isoV[i] = v;
      b.step(v > 0 ? -load : 0, dt);
    }
    // Batteries on the main node
    for (let i = 0; i < 2; i++) if (bc[i]) this.bat[i].step(this.bat[i].currentAt(vMain), dt);

    // ---------------- bus states ----------------
    const PWR = 18;
    const mainPowered = vMain > PWR;
    this.vDcBat = mainPowered ? vMain : 0;
    this.dcBat = mainPowered;
    this.dc1 = mainHasDc1 && mainPowered;
    this.vDc1 = this.dc1 ? vMain : 0;
    this.dc2 = mainHasDc2 ? mainPowered : vDc2Iso > PWR;
    this.vDc2 = mainHasDc2 ? (this.dc2 ? vMain : 0) : vDc2Iso;
    this.hot1 = bc[0] ? vMain > 5 || this.bat[0].emf() > 0 : this.bat[0].emf() > 0;
    this.hot2 = bc[1] ? vMain > 5 || this.bat[1].emf() > 0 : this.bat[1].emf() > 0;
    const vHot1 = bc[0] ? vMain : isoV[0];
    const vHot2 = bc[1] ? vMain : isoV[1];
    if (dcEssFromBat) this.vDcEss = this.vDcBat;
    else if (dcEssFromEssTr) this.vDcEss = vEssTr;
    else if (xb2) this.vDcEss = vHot2;
    else this.vDcEss = 0;
    this.dcEss = this.vDcEss > PWR;
    this.dcEssShed = this.dcEss && !xb2;
    this.dcGndFlt = this.dc2 || vGndFlt > PWR;
    this.statInvOn = xb2 && vHot1 > 16;
    this.acStatInv = this.statInvOn;
    if (this.acEssSrc === 'INV' && !this.statInvOn) this.acEssSrc = '';
    this.acEss = !!this.acEssSrc;
    this.acEssShed = this.acEss && (anyAc || this.emerGenOn);
    this.acGndFlt = this.ac2 || extAvail;
    this.annPower = this.dcBat || this.dcEss;

    // TR currents
    const trNow = trs.length ? trCurrent(TR, vMain) : 0;
    this.trA.TR1 = dc1Src && mainHasDc1 ? trNow : 0;
    this.trA.TR2 = dc2Src ? (mainHasDc2 ? trNow : tr2IsoA) : tr2FromExt ? trGndA : 0;
    this.trA.ESS = dcEssFromEssTr ? essA : 0;
    this.trV.TR1 = dc1Src ? vMain : 0;
    this.trV.TR2 = dc2Src ? (mainHasDc2 ? vMain : vDc2Iso) : tr2FromExt ? vGndFlt : 0;
    this.trV.ESS = dcEssFromEssTr ? vEssTr : 0;

    // ---------------- AC loads (kVA) & generator loads ----------------
    this.galleyShed = !anyAc || (oneGen && !apuOrExt) || (apuProvides && !gnd && !extProvides && !gen1Provides && !gen2Provides) || !commercialOn || !galyAuto;
    const secondaryGalleyShed = !anyAc || !commercialOn || !galyAuto;
    const galley = this.galleyShed ? 0 : 6 + 3 * this.galleyW.step(dt);
    const galley2 = secondaryGalleyShed ? 0 : 2.5;
    const commercial = commercialOn && anyAc ? 3.2 + 0.3 * w[5] : 0;
    const cabFans = pbIn(sim, 'VENT_CAB_FANS') ? 0.6 : 0;
    const probe = sim.getB('S:AI_PROBE_HEAT') ? 2.4 : 0;
    const trKva = (a: number, v: number) => (a * v) / 0.88 / 1000;
    const essKva = this.acEss ? 1.6 + (this.acEssShed ? 0.4 + xa.ESS_SHED : 0) + (this.essTrOn && !this.emerGenOn ? trKva(this.trA.ESS, this.trV.ESS) : 0) : 0;
    const ac1Kva = this.ac1 ? 5.5 + cabFans + 0.35 + probe + xa.AC1 + trKva(this.trA.TR1, this.trV.TR1) + galley2 + 0.3 * w[6] : 0;
    const ac2Kva = this.ac2
      ? 5.5 + cabFans + 0.35 + probe + xa.AC2 + (this.ac2 ? trKva(this.trA.TR2, this.trV.TR2) : 0) + galley + commercial + 1.0 + 0.3 * w[7]
      : 0;
    const load: Record<string, number> = { GEN1: 0, GEN2: 0, APU: 0, EXT: 0, EMER: 0, INV: 0 };
    if (this.ac1Src) load[this.ac1Src] += ac1Kva;
    if (this.ac2Src) load[this.ac2Src] += ac2Kva;
    if (this.acEssSrc) load[this.acEssSrc] += essKva;
    this.genLoad.GEN1 = this.gen1Energised ? (load.GEN1 / 90) * 100 + (!gen1Line ? 2.5 : 0) : 0;
    this.genLoad.GEN2 = (load.GEN2 / 90) * 100;
    this.genLoad.APU = (load.APU / 90) * 100;
    this.genLoad.EXT = (load.EXT / 90) * 100;
    this.genLoad.EMER = (load.EMER / 5) * 100;

    // IDG oil outlet temperature
    for (let i = 0; i < 2; i++) {
      const target = this.idgConnected[i] && n2[i] > 5 ? oat(sim) + 15 + n2[i] * 0.95 + (i === 0 ? this.genLoad.GEN1 : this.genLoad.GEN2) * 0.25 : oat(sim);
      this.idgTemp[i] = lag(this.idgTemp[i], target, target > this.idgTemp[i] ? 150 : 600, dt);
    }

    this.publish(sim, w, extAvail);
  }

  private publish(sim: Sim, w: number[], extAvail: boolean): void {
    const set = (k: string, v: number | boolean) => sim.set(k, v);
    set('S:ELEC_BAT1_V', round2(this.bat[0].voltage));
    set('S:ELEC_BAT2_V', round2(this.bat[1].voltage));
    set('S:ELEC_BAT1_A', round1(this.bcl[0].closed ? this.bat[0].current + (Math.abs(this.bat[0].current) > 1 ? 0.3 * w[8] : 0) : 0));
    set('S:ELEC_BAT2_A', round1(this.bcl[1].closed ? this.bat[1].current + (Math.abs(this.bat[1].current) > 1 ? 0.3 * w[9] : 0) : 0));
    set('S:ELEC_BAT1_CONTACTOR', this.bcl[0].closed);
    set('S:ELEC_BAT2_CONTACTOR', this.bcl[1].closed);
    set('S:ELEC_BAT1_SOC', round3(this.bat[0].soc));
    set('S:ELEC_BAT2_SOC', round3(this.bat[1].soc));
    set('S:ELEC_HOT_BUS1', this.hot1);
    set('S:ELEC_HOT_BUS2', this.hot2);
    set('S:ELEC_DC_BAT_BUS', this.dcBat);
    set('S:ELEC_DC_ESS_BUS', this.dcEss);
    set('S:ELEC_DC_ESS_SHED', this.dcEssShed);
    set('S:ELEC_DC1_BUS', this.dc1);
    set('S:ELEC_DC2_BUS', this.dc2);
    set('S:ELEC_DC_GND_FLT_BUS', this.dcGndFlt);
    set('S:ELEC_AC1_BUS', this.ac1);
    set('S:ELEC_AC2_BUS', this.ac2);
    set('S:ELEC_AC_ESS_BUS', this.acEss);
    set('S:ELEC_AC_ESS_SHED', this.acEssShed);
    set('S:ELEC_AC_STAT_INV_BUS', this.acStatInv);
    set('S:ELEC_AC_GND_FLT_BUS', this.acGndFlt);
    set('S:ELEC_STAT_INV', this.statInvOn);
    set('S:ELEC_EXT_PWR_ON', this.extC);
    set('S:ELEC_EXT_PWR_AVAIL', extAvail);
    set('S:ELEC_EXT_PWR_PB_ON', this.extOn);
    set('S:ELEC_APU_GEN_ON', this.apuC);
    set('S:ELEC_GEN1_ON', this.gen1C);
    set('S:ELEC_GEN2_ON', this.gen2C);
    set('S:ELEC_EMER_GEN_ON', this.emerGenOn);
    set('S:ELEC_BUS_TIE1', this.busTie1);
    set('S:ELEC_BUS_TIE2', this.busTie2);
    set('S:ELEC_AC1_SRC', srcCode(this.ac1Src));
    set('S:ELEC_AC2_SRC', srcCode(this.ac2Src));
    set('S:ELEC_AC_ESS_SRC', srcCode(this.acEssSrc));
    set('S:ELEC_AC_ESS_FROM_AC2', this.acEss && this.essFromAc2);
    set('S:ELEC_GALLEY_SHED', this.galleyShed);
    set('S:ELEC_AC_POWERED', this.ac1 || this.ac2);
    set('S:ELEC_ANN_POWER', this.annPower);
    set('S:ANN_POWER', this.annPower);
    set('S:ELEC_DC_BAT_V', round2(this.vDcBat));
    set('S:ELEC_DC_ESS_V', round2(this.vDcEss));
    set('S:ELEC_DC1_V', round2(this.vDc1));
    set('S:ELEC_DC2_V', round2(this.vDc2));
    set('S:ELEC_IDG1_TEMP', Math.round(this.idgTemp[0]));
    set('S:ELEC_IDG2_TEMP', Math.round(this.idgTemp[1]));
    set('S:ELEC_IDG1_DISC', !this.idgConnected[0]);
    set('S:ELEC_IDG2_DISC', !this.idgConnected[1]);

    // SD ELEC page values
    const m = this.m;
    const acV = (on: boolean, k: number) => (on ? 115 + 0.6 * w[k] : 0);
    const acHz = (on: boolean, k: number) => (on ? 400 + 0.45 * w[(k + 3) % 12] : 0);
    const extV = extAvail;
    set('S:ELEC_EXT_V', round1(acV(extV, 10)));
    set('S:ELEC_EXT_HZ', round1(acHz(extV, 10)));
    set('S:ELEC_EXT_LOAD', Math.round(this.genLoad.EXT));
    const apuN = m.apu.n;
    const apuGenOut = apuN > 90 && pbIn(sim, 'ELEC_APU_GEN') && !fireReleased(sim, 'FIRE_APU_PB');
    set('S:ELEC_APU_GEN_V', round1(apuGenOut ? (apuN > 95 ? acV(true, 11) : 115 * (apuN - 90) / 5) : 0));
    set('S:ELEC_APU_GEN_HZ', round1(apuGenOut ? (apuN > 95 ? acHz(true, 11) + (apuN - 100) * 4 : 4 * apuN) : 0));
    set('S:ELEC_APU_GEN_LOAD', Math.round(this.genLoad.APU));
    for (let i = 0; i < 2; i++) {
      const n = i + 1;
      const n2 = engN2(sim, n);
      const genPb = pbIn(sim, `ELEC_GEN${n}`);
      const turning = this.idgConnected[i] && genPb && !fireReleased(sim, n === 1 ? 'FIRE_ENG1_PB' : 'FIRE_ENG2_PB');
      const on = turning && n2 >= 55;
      const hz = on ? acHz(true, i * 2) : turning && n2 > 20 ? (400 * n2) / 55 * 0.6 : 0;
      set(`S:ELEC_GEN${n}_V`, round1(on ? acV(true, i * 2) : 0));
      set(`S:ELEC_GEN${n}_HZ`, round1(hz));
      set(`S:ELEC_GEN${n}_LOAD`, Math.round(i === 0 ? this.genLoad.GEN1 : this.genLoad.GEN2));
    }
    set('S:ELEC_EMER_GEN_V', round1(acV(this.emerGenOn, 4)));
    set('S:ELEC_EMER_GEN_HZ', round1(acHz(this.emerGenOn, 4)));
    set('S:ELEC_EMER_GEN_LOAD', Math.round(this.genLoad.EMER));
    set('S:ELEC_STAT_INV_V', round1(acV(this.statInvOn, 5)));
    set('S:ELEC_STAT_INV_HZ', round1(acHz(this.statInvOn, 5)));
    set('S:ELEC_TR1_V', round1(this.trV.TR1));
    set('S:ELEC_TR1_A', round1(this.trA.TR1));
    set('S:ELEC_TR2_V', round1(this.trV.TR2));
    set('S:ELEC_TR2_A', round1(this.trA.TR2));
    set('S:ELEC_ESS_TR_V', round1(this.trV.ESS));
    set('S:ELEC_ESS_TR_A', round1(this.trA.ESS));
    set('S:ELEC_TR1_ON', this.tr1On && this.dc1);
    set('S:ELEC_TR2_ON', this.trA.TR2 > 0);
    set('S:ELEC_ESS_TR_ON', this.trA.ESS > 0);
    set('S:ELEC_APU_STARTER', this.starterPowered);
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
/** Numeric source code for S:ELEC_*_SRC: 0 none, 1 GEN1, 2 GEN2, 3 APU GEN, 4 EXT PWR, 5 EMER GEN, 6 STAT INV. */
function srcCode(s: AcSrc): number {
  return s === 'GEN1' ? 1 : s === 'GEN2' ? 2 : s === 'APU' ? 3 : s === 'EXT' ? 4 : s === 'EMER' ? 5 : s === 'INV' ? 6 : 0;
}
