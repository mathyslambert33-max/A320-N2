/**
 * CFM56-5B FADEC (ECU) per engine: power supply logic, automatic / manual start sequencing,
 * ignition, start valve, HP fuel shut-off valve, ground start protections (auto abort & recycle),
 * continuous ignition, reverser and thrust command.
 *
 * Sources: A320 FCOM DSC-70 (Power plant, FADEC, ignition & starting), PRO-NOR-SOP engine start,
 * PRO-NOR-SUP manual start, "ENG 1(2) START FAULT" ECAM procedure (CFM); airline training notes.
 *
 * FADEC power (CFM56-5B, FCOM):
 *  - self-powered by its dedicated alternator when N2 > 12 %;
 *  - otherwise supplied by the aircraft 28 VDC network (via the EIU) only:
 *      · for 5 min after aircraft electrical power-up,
 *      · when ENG MODE selector is at IGN/START or CRANK,
 *      · when the ENG MASTER lever is ON (or MAN START pb ON),
 *      · when the ENG FADEC GND PWR pb (maintenance panel) is ON,
 *      · for 5 min after the engine is shut down (N2 < 12 %).
 *    Otherwise the E/WD engine indications become amber XX.
 *
 * Automatic start (MODE IGN/START, MASTER ON):
 *  start valve opens (needs duct pressure) → N2 ↑ → 16 % N2: one igniter (A or B, alternating on ground)
 *  → 22 % N2: HP fuel valve opens (FF ≈ 170-200 kg/h) → light-off (EGT ↑) within ~15 s
 *  → 50 % N2: start valve closes, ignition off → stabilised at idle (≈ 45-50 s after MASTER ON).
 *  Ground protections: no light-up (15 s) → IGN FAULT; EGT > 725 °C → EGT OVERLIMIT; hung start;
 *  stall. The FADEC shuts the fuel, cuts the ignition, keeps the start valve open for a 30 s dry crank,
 *  then re-attempts with both igniters (and a reduced fuel schedule after hot/hung/stall). When the
 *  attempts are exhausted the ECAM asks for ENG MASTER OFF (fault light off at MASTER OFF).
 *
 * Manual start (MODE IGN/START, MAN START ON → start valve opens; MASTER ON at ≥ 20-22 % N2 → HP fuel
 * valve + both igniters): the FADEC only closes the start valve / cuts ignition at 50 % N2 and
 * monitors (EGT over-limit displayed, no automatic abort).
 * Dry crank: MODE CRANK + MAN START ON (MASTER OFF).
 */
import type { Sim } from '../../core/sim';
import {
  acEssShed, ac1, ac2, clamp, dc2, dcBat, dcEss, DelayOn, Edge, engMode, lag, manStart, masterOn, pbIn,
} from './common';
import { EngineCore, START_VALVE_MIN_PSI } from './engine';

export const enum EngState { OFF = 0, DRY_CRANK = 1, STARTING = 2, RUNNING = 3, SHUTDOWN = 4, ABORTED = 5 }

/** Start fault codes published in S:ENGn_START_FAULT (ECAM "ENG n START FAULT" sub-title). */
export const START_FAULT = {
  NONE: 0,
  IGN_FAULT: 1, // no light-up
  EGT_OVERLIMIT: 2,
  STALL: 3,
  HUNG_START: 4,
  START_VALVE_FAULT: 5, // start valve does not open (no air to actuate it) or stuck
  NO_LIGHT_UP: 6, // IAE wording — not produced by the CFM FADEC
  LOW_START_AIR: 7, // N2 never reaches the fuel-on speed (weak air source)
} as const;

export const START_EGT_LIMIT = 725;
const DRY_CRANK_S = 30;
const NO_LIGHT_S = 15;

type Seq = 'none' | 'auto' | 'manual' | 'crank';
type Phase = 'motor' | 'accel' | 'abortCrank' | 'aborted';

export interface FadecContext {
  dt: number;
  oat: number;
  pAmb: number;
  mach: number;
  onGround: boolean;
  /** Duct pressure available at this engine's start valve (psi). */
  ductPsi: number;
  /** Fuel pressure at the engine (LP valve open & feed). */
  fuelAvail: boolean;
  bleedLoad: number;
  naiOn: boolean;
  waiOn: boolean;
  /** N1 commanded by the thrust lever (limits applied), %. */
  n1Cmd: number;
  /** Reverser hydraulic power available. */
  revHyd: boolean;
}

export class Fadec {
  readonly core: EngineCore;
  powered = false;
  private supplyEdge = new Edge(false);
  powerUpTimer = 0;
  shutdownTimer = 0;
  private wasSelfPowered = false;

  seq: Seq = 'none';
  phase: Phase = 'motor';
  state: EngState = EngState.OFF;
  startValveCmd = false;
  startValvePos = 0;
  hpValve = false;
  ignA = false;
  ignB = false;
  /** Igniter to use for the next ground auto start (alternates at each start). */
  nextIgniter: 'A' | 'B';
  /** Igniter used by the current start attempt. */
  private igniterUsed: 'A' | 'B' = 'A';
  contIgn = false;
  attempt = 0;
  maxAttempts = 3;
  fuelSchedFactor = 1;
  startFault = 0;
  faultLight = false;
  private phaseTimer = 0;
  private seqTimer = 0;
  private hungTimer = new DelayOn(10);
  private lowAirTimer = new DelayOn(12);
  private valveFaultTimer = new DelayOn(6);
  private stallTimer = new DelayOn(2);
  private startReqEdge = new Edge(false);
  private manReqEdge = new Edge(false);
  private modeIgnEdge = new Edge(false);
  private masterEdge = new Edge(false);
  lightOffDelay: number;
  /** Continuous starter engagement (s) and number of consecutive cycles. */
  starterTime = 0;
  starterCycles = 0;
  private starterRest = 1e9;
  starterLimit = false;
  rev = 0;
  n1Cmd = 0;
  n2Cmd = 0;
  /** Failure injection (tests / instructor). */
  failStall = false;
  failIgn = false;
  failStartValve = false;
  failRich = false;

  constructor(readonly n: 1 | 2, core: EngineCore, private rng: () => number) {
    this.core = core;
    this.nextIgniter = n === 1 ? 'A' : 'B';
    this.lightOffDelay = this.newLightOffDelay();
  }

  private newLightOffDelay(): number {
    return 2.4 + 1.8 * this.rng();
  }

  /** Engine start sequence in progress (for the pack valve logic): start valve open or N2 < 50 % while starting. */
  startInProgress(): boolean {
    if (this.startValvePos > 0.05 || this.startValveCmd) return true;
    return (this.seq === 'auto' || this.seq === 'manual') && this.core.n2 < 50;
  }

  /** Engine lit and above 50 % N2 (start sequence finished, or running). */
  runningOrStarted(): boolean {
    return this.core.lit && this.core.n2 >= 50;
  }

  get running(): boolean { return this.state === EngState.RUNNING; }

  /** Force the engine to a stabilised idle (dev scenarios / presets). */
  presetRunning(oat: number, pAmb: number): void {
    const c = this.core;
    c.computeIdle({ oat, pAmb, onGround: true, bleedLoad: 1, naiOn: false, waiOn: false });
    c.n2 = c.idleN2;
    c.n1 = c.idleN1;
    c.egt = c.idleEgt;
    c.ff = c.idleFf;
    c.lit = true;
    c.oilTemp = 74;
    c.oilPress = 36;
    c.gulp = 3.1;
    c.heat = 1;
    c.loadRatio = 1;
    this.seq = 'none';
    this.state = EngState.RUNNING;
    this.hpValve = true;
    this.startValveCmd = false;
    this.startValvePos = 0;
    this.startFault = 0;
    this.powered = true;
    this.shutdownTimer = 300;
    this.wasSelfPowered = true;
  }

  /** Align the control edge detectors with the current cockpit state (presets: no spurious edges). */
  primeEdges(sim: Sim): void {
    this.modeIgnEdge.rise(engMode(sim) === 2);
    this.masterEdge.rise(masterOn(sim, this.n));
  }

  update(sim: Sim, x: FadecContext): void {
    const dt = x.dt;
    const n = this.n;
    const c = this.core;
    const master = masterOn(sim, n);
    const mode = engMode(sim);
    const man = manStart(sim, n);
    const gndPwr = pbIn(sim, `MAINT_FADEC_GND_PWR${n}`);
    const masterRise = this.masterEdge.rise(master);

    /* ---------------- power ---------------- */
    const supply = n === 1 ? dcEss(sim) || dcBat(sim) : dc2(sim) || dcEss(sim);
    if (this.supplyEdge.rise(supply)) this.powerUpTimer = 300;
    if (!supply) this.powerUpTimer = 0;
    else this.powerUpTimer = Math.max(0, this.powerUpTimer - dt);
    const self = c.n2 >= 12;
    if (self || this.wasSelfPowered) this.shutdownTimer = 300;
    else this.shutdownTimer = Math.max(0, this.shutdownTimer - dt);
    this.wasSelfPowered = self;
    const request = this.powerUpTimer > 0 || mode !== 1 || master || man || gndPwr || this.shutdownTimer > 0;
    this.powered = self || (supply && request);

    /* ---------------- start requests ---------------- */
    const autoReq = this.powered && master && mode === 2 && !man;
    const autoRise = this.startReqEdge.rise(autoReq);
    const manReq = this.powered && man && mode !== 1;
    const manRise = this.manReqEdge.rise(manReq);
    const modeIgnRise = this.modeIgnEdge.rise(mode === 2);

    if (this.seq === 'none' && !c.lit) {
      if (autoRise && c.n2 < 50) this.beginAuto(x.onGround);
      else if (manRise && c.n2 < 20) {
        this.seq = mode === 0 ? 'crank' : 'manual';
        this.seqTimer = 0;
        this.attempt = 1;
        this.fuelSchedFactor = 1;
        this.startFault = 0;
        this.lightOffDelay = this.newLightOffDelay();
      }
    }
    // Quick relight of a spooling-down engine (MASTER OFF → ON above 50 % N2).
    if (this.seq === 'none' && masterRise && c.n2 >= 50 && !c.lit && mode !== 0) this.beginAuto(x.onGround);

    /* ---------------- sequences ---------------- */
    let ignSel = false;
    let bothIgn = false;
    let starting = false;
    this.seqTimer += dt;

    // MASTER OFF cancels an automatic start (and confirms an automatic abort).
    if (!master && this.seq === 'auto') this.endSeq();

    if (this.seq === 'auto') {
      starting = true;
      this.phaseTimer += dt;
      bothIgn = !(this.attempt === 1 && x.onGround);
      const protect = x.onGround;
      switch (this.phase) {
        case 'motor': {
          // No running engagement of the starter above 20 % N2.
          if (!this.startValveCmd && c.n2 < 20) this.startValveCmd = true;
          if (mode !== 2) this.startValveCmd = false;
          ignSel = c.n2 >= 16 && mode === 2;
          if (c.n2 >= 22 && mode === 2) this.hpValve = true;
          if (c.lit) { this.phase = 'accel'; this.phaseTimer = 0; break; }
          if (!protect) break;
          if (this.valveFaultTimer.update(this.startValveCmd && this.startValvePos < 0.1 && c.n2 < 10, dt)) {
            this.fault(START_FAULT.START_VALVE_FAULT, true);
            break;
          }
          const lowAir = this.lowAirTimer.update(this.startValvePos > 0.9 && !this.hpValve && c.n2 < 22 && c.n2Dot < 0.08, dt);
          if (lowAir || (this.seqTimer > 75 && !this.hpValve)) {
            this.fault(START_FAULT.LOW_START_AIR, true);
            break;
          }
          if (this.hpValve && c.fuelNoLightTimer >= NO_LIGHT_S) this.fault(START_FAULT.IGN_FAULT, false);
          break;
        }
        case 'accel': {
          ignSel = c.n2 < 50 && mode === 2;
          this.hpValve = true;
          if (c.n2 >= 50 || mode !== 2) this.startValveCmd = false;
          if (c.lit && c.n2 >= c.idleN2 - 0.6 && Math.abs(c.n2Dot) < 0.35) {
            // Start complete: stabilised at idle.
            this.seq = 'none';
            this.startFault = 0;
            this.attempt = 0;
            break;
          }
          if (!c.lit) {
            // Flame-out during the start (e.g. fuel starvation): handled as a no light-up.
            if (protect) this.fault(START_FAULT.IGN_FAULT, false);
            else this.phase = 'motor';
            break;
          }
          if (c.egt >= START_EGT_LIMIT) {
            if (protect) this.fault(START_FAULT.EGT_OVERLIMIT, false);
            else this.startFault = START_FAULT.EGT_OVERLIMIT;
            break;
          }
          if (this.stallTimer.update(this.failStall && c.n2 > 28 && c.n2Dot < 0.15, dt) && protect) {
            this.fault(START_FAULT.STALL, false);
            break;
          }
          if (this.hungTimer.update(c.n2 >= 24 && c.n2 < c.idleN2 - 2 && c.n2Dot < 0.25, dt) && protect) {
            this.fault(START_FAULT.HUNG_START, false);
            break;
          }
          break;
        }
        case 'abortCrank': {
          // Fuel off, ignition off, start valve kept open: 30 s dry crank to clear the fuel vapours.
          this.hpValve = false;
          this.startValveCmd = c.n2 < 50;
          if (this.phaseTimer >= DRY_CRANK_S) {
            if (this.attempt < this.maxAttempts && mode === 2) {
              this.attempt++;
              this.phase = 'motor';
              this.phaseTimer = 0;
              this.seqTimer = 0;
              this.lightOffDelay = this.newLightOffDelay();
              this.hungTimer.reset();
              this.stallTimer.reset();
              c.fuelNoLightTimer = 0;
            } else {
              this.phase = 'aborted';
              this.phaseTimer = 0;
            }
          }
          break;
        }
        case 'aborted': {
          this.hpValve = false;
          this.startValveCmd = false;
          break;
        }
      }
    } else if (this.seq === 'manual' || this.seq === 'crank') {
      starting = this.seq === 'manual';
      // Start valve follows the MAN START pb (MODE selector away from NORM); closed by the FADEC at 50 % N2.
      if (!man || mode === 1 || c.n2 >= 50) this.startValveCmd = false;
      else if (c.n2 < 20 || this.startValveCmd) this.startValveCmd = true;
      if (this.seq === 'manual') {
        if (master && mode === 2) {
          this.hpValve = true;
          ignSel = c.n2 < 50;
          bothIgn = true;
        } else if (!master) this.hpValve = false;
        // Passive monitoring only (no automatic abort in manual start).
        if (c.lit && c.egt >= START_EGT_LIMIT) this.startFault = START_FAULT.EGT_OVERLIMIT;
        if (c.lit && c.n2 >= c.idleN2 - 0.6 && Math.abs(c.n2Dot) < 0.35 && !this.startValveCmd) this.seq = 'none';
      } else {
        // CRANK: no ignition, no fuel (dry motoring).
        this.hpValve = false;
      }
      if (this.seq !== 'none' && !this.startValveCmd && this.startValvePos < 0.05 && !c.lit && !master) this.seq = 'none';
    }

    if (this.seq === 'none') {
      this.startValveCmd = false;
      this.hpValve = master && (c.lit || c.n2 >= 50) && mode !== 0;
      if (!master) this.startFault = 0;
      // Continuous ignition: IGN/START selected with the engine running (on ground: armed by selecting
      // IGN after the start), or in flight with IGN/START.
      if (modeIgnRise && this.running) this.contIgn = true;
      if (mode !== 2 || !c.lit) this.contIgn = false;
      if (!x.onGround && mode === 2 && c.lit) this.contIgn = true;
      if (this.contIgn) { ignSel = true; bothIgn = true; }
    }
    if (!master) this.hpValve = false;
    if (!this.powered) { this.startValveCmd = false; ignSel = false; }

    /* ---------------- igniters ---------------- */
    if (ignSel) {
      if (bothIgn) { this.ignA = true; this.ignB = true; }
      else { this.ignA = this.igniterUsed === 'A'; this.ignB = this.igniterUsed === 'B'; }
    } else { this.ignA = false; this.ignB = false; }
    // Igniter A: AC ESS SHED bus, igniter B: AC BUS 1 (eng 1) / AC BUS 2 (eng 2).
    const powA = acEssShed(sim) && !this.failIgn;
    const powB = (n === 1 ? ac1(sim) : ac2(sim)) && !this.failIgn;
    const spark = (this.ignA && powA) || (this.ignB && powB);

    /* ---------------- start valve (electrically controlled, pneumatically operated) ---------------- */
    const canOpen = x.ductPsi >= START_VALVE_MIN_PSI && !this.failStartValve;
    const target = this.startValveCmd && canOpen ? 1 : 0;
    this.startValvePos = lag(this.startValvePos, target, target > this.startValvePos ? 0.5 : 0.35, dt);
    if (Math.abs(this.startValvePos - target) < 0.005) this.startValvePos = target;

    // Starter duty cycle (limitation: 3 consecutive cycles of 2 min with 20 s pause, then 15 min cooling).
    if (this.startValvePos > 0.5) {
      if (this.starterTime === 0) this.starterCycles = this.starterRest > 900 ? 1 : this.starterCycles + 1;
      this.starterTime += dt;
      this.starterRest = 0;
    } else {
      this.starterTime = 0;
      this.starterRest += dt;
    }
    this.starterLimit = this.starterTime > 120 || this.starterCycles > 3;

    /* ---------------- thrust command & reverser ---------------- */
    const tla = sim.get(`C:THR_LEVER${n}`);
    const rev = x.onGround && tla < -3 && c.lit && c.n2 > 50 && this.powered && x.revHyd;
    this.rev = clamp(this.rev + (rev ? dt / 1.6 : -dt / 2.4), 0, 1);
    this.n1Cmd = x.n1Cmd;
    let n1Cmd = x.n1Cmd;
    if (tla < 0 && this.rev < 0.9) n1Cmd = c.idleN1; // reverse thrust only once the reverser is deployed
    n1Cmd = Math.max(n1Cmd, c.idleN1);
    this.n2Cmd = Math.max(c.n2ForN1(n1Cmd, x.oat), c.idleN2);

    /* ---------------- engine core ---------------- */
    const fuelOn = this.hpValve && x.fuelAvail;
    c.update({
      dt, oat: x.oat, pAmb: x.pAmb, mach: x.mach, onGround: x.onGround,
      startValve: this.startValvePos, ductPsi: x.ductPsi, fuelOn, spark, bothIgniters: this.ignA && this.ignB,
      n2Cmd: this.n2Cmd, fuelSchedFactor: this.fuelSchedFactor,
      starting: starting && c.lit,
      bleedLoad: x.bleedLoad, naiOn: x.naiOn, waiOn: x.waiOn, stall: this.failStall, rich: this.failRich,
      lightOffDelay: this.lightOffDelay, rev: this.rev,
    });

    /* ---------------- published state ---------------- */
    if (this.seq === 'auto') {
      this.state = this.phase === 'abortCrank' || this.phase === 'aborted' ? EngState.ABORTED : EngState.STARTING;
    } else if (this.seq === 'manual') {
      this.state = c.lit || master ? EngState.STARTING : EngState.DRY_CRANK;
    } else if (this.seq === 'crank') {
      this.state = EngState.DRY_CRANK;
    } else if (c.lit && c.n2 >= c.idleN2 - 2.5) {
      this.state = EngState.RUNNING;
    } else if (c.lit) {
      this.state = EngState.STARTING;
    } else if (c.n2 > 0.5 || this.startValvePos > 0.05) {
      this.state = EngState.SHUTDOWN;
    } else {
      this.state = EngState.OFF;
    }
    this.faultLight = this.startFault > 0;
  }

  private beginAuto(onGround: boolean): void {
    this.seq = 'auto';
    this.phase = 'motor';
    this.phaseTimer = 0;
    this.seqTimer = 0;
    this.attempt = 1;
    this.maxAttempts = 3;
    this.fuelSchedFactor = 1;
    this.startFault = 0;
    this.hungTimer.reset();
    this.lowAirTimer.reset();
    this.valveFaultTimer.reset();
    this.stallTimer.reset();
    this.core.fuelNoLightTimer = 0;
    this.lightOffDelay = this.newLightOffDelay();
    if (onGround) {
      this.igniterUsed = this.nextIgniter;
      this.nextIgniter = this.nextIgniter === 'A' ? 'B' : 'A';
    }
  }

  private endSeq(): void {
    this.seq = 'none';
    this.startValveCmd = false;
    this.hpValve = false;
    this.attempt = 0;
  }

  /**
   * Start fault detected by the FADEC (ground): shut the fuel, cut ignition, dry crank, recycle.
   * `final`: no recycle (start valve fault / low start air).
   */
  private fault(code: number, final: boolean): void {
    this.startFault = code;
    this.hpValve = false;
    if (final) {
      this.phase = 'aborted';
      this.startValveCmd = false;
    } else {
      this.phase = 'abortCrank';
      if (code === START_FAULT.EGT_OVERLIMIT || code === START_FAULT.STALL || code === START_FAULT.HUNG_START) {
        this.fuelSchedFactor *= 0.85;
      }
      this.maxAttempts = code === START_FAULT.IGN_FAULT ? 2 : 3;
    }
    this.phaseTimer = 0;
  }
}
