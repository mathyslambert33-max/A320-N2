/**
 * Flight Warning Computer (FWC 1+2 & SDAC 1+2 functions, merged).
 *
 *  - computes the flight phase,
 *  - monitors the alert catalogue (alerts.ts) with confirmation times and flight-phase inhibition
 *    of new occurrences (an inhibited alert is displayed when the inhibition ends if still present),
 *  - generates the E/WD warning / memo lines (7 lines left + 7 lines right),
 *  - drives MASTER WARN / MASTER CAUT and the aural alerts (CRC continuous, SC single chime),
 *  - handles CLR / RCL / EMER CANC / T.O CONFIG, the T.O memo, the STATUS page content.
 */
import type { Sim } from '../../../core/sim';
import { Acq } from './acq';
import { AlertEnv, buildAlerts } from './alerts';
import { computeMemos } from './memos';
import { FlightPhases } from './phases';
import { AlertDef, Col, FwcSound, Line, ProcLine, SdPage, Seg } from './types';
import { ConfirmNode, Memory, Monostable } from './util';

export const EWD_LINES = 7;

interface AlertState {
  def: AlertDef;
  index: number;
  rawFor: number;
  active: boolean;
  /** Displayed on the E/WD (accepted occurrence, not inhibited). */
  displayed: boolean;
  /** Seconds since displayed (CLR needs a minimum display time). */
  shownFor: number;
  cleared: boolean;
  cancelled: boolean;
  /** Order of appearance (for stable ordering inside a level). */
  seq: number;
}

export interface StatusContent {
  left: Array<{ text: string; c: Col }>;
  inop: string[];
  cancelled: string[];
}

export class Fwc {
  readonly a = new Acq();
  readonly phases = new FlightPhases();
  sim!: Sim;
  powered = false;
  phase = 1;

  alerts: AlertState[] = [];
  private seq = 0;

  // ---- outputs
  leftLines: Line[] = [];
  rightLines: Line[] = [];
  leftOverflow = false;
  rightOverflow = false;
  /** Left side shows failures (not memos). */
  leftFailures = false;
  masterWarn = false;
  masterCaut = false;
  crcActive = false;
  /** SD page requested by the highest priority displayed alert. */
  sdRequest: SdPage = SdPage.NONE;
  status: StatusContent = { left: [], inop: [], cancelled: [] };
  toMemo = false;
  toConfigNormal = false;
  /** "NORMAL" displayed on the E/WD after RCL with nothing to recall (s remaining). */
  normalRecall = 0;
  /** Set when a CLR emptied the warning list (the DMC then calls the STATUS page). */
  private clearedAll = false;

  // ---- T.O CONFIG / memo logic
  toCfgPressed = false;
  private toCfgPulse = new Monostable(1.5, true, true);
  private toCfgHalf = new Monostable(0.5, true, true);
  private toCfgRiseTimer = 0;
  private toCfgChecked = false;
  private toCfgTestedP2 = false;
  private toMemoFF = new Memory(false);
  private bothRunningConf = new ConfirmNode(120, true);
  private toConfigMemoFF = new Memory(false);
  private toConfigNormalConf = new ConfirmNode(0.3, true);
  private toInhibitConf = new ConfirmNode(3, true);
  private ldgInhibitConf = new ConfirmNode(3, true);
  private cfgLatch = {
    slats: new Memory(false), flaps: new Memory(false), spdBrk: new Memory(false),
    pitch: new Memory(false), rud: new Memory(false), park: new Memory(false),
  };
  private cfg = { slats: false, flaps: false, spdBrk: false, pitch: false, rud: false, park: false };
  private engFail: [boolean, boolean] = [false, false];
  private engRunFor: [number, number] = [0, 0];
  private firePbFor: [number, number] = [0, 0];
  private cargoSmoke = { fwd: false, aft: false };
  private cargoTestFor = 0;
  private lastScAt = -10;
  private engRunningFor = 0;
  private lightConf = new Map<string, number>();

  private readonly env: AlertEnv;

  constructor() {
    this.env = {
      a: this.a,
      phase: () => this.phase,
      toCfgTest: () => this.toCfgTestActive(),
      toCfgChecked: () => this.toCfgChecked,
      cfg: this.cfg,
      engFail: this.engFail,
      engRunFor: this.engRunFor,
      firePbFor: this.firePbFor,
      cargoSmoke: this.cargoSmoke,
      light: (id) => (this.sim ? this.sim.get(`L:${id}`) > 0.5 && !this.sim.getB('S:INTLT_ANN_TEST') : false),
    };
    this.alerts = buildAlerts(this.env).map((def, index) => ({
      def, index, rawFor: 0, active: false, displayed: false, shownFor: 0, cleared: false, cancelled: false, seq: 0,
    }));
  }

  private toCfgTestActive(): boolean {
    return this.toCfgPressed || this.toCfgPulse.read();
  }

  /* ------------------------------------------------------------------ update */

  update(sim: Sim, dt: number): void {
    this.sim = sim;
    const a = this.a;
    a.update(sim, sim.time);
    this.powered = a.fwc1 || a.fwc2;
    const prevPhase = this.phase;
    this.phase = this.phases.update(a, dt);
    // a new flight begins: cautions cancelled by EMER CANC are restored
    if (prevPhase === 10 && this.phase === 1) for (const s of this.alerts) s.cancelled = false;

    // engine timers
    for (const i of [0, 1]) {
      const e = a.eng[i];
      this.engRunFor[i] = e.running ? this.engRunFor[i] + dt : 0;
      // ENG FAIL memory: set when the engine decays below idle after running, master ON, no fire pb
      if (e.running) this.engFail[i] = false;
      else if (this.engRunFor[i] === 0 && e.master && !e.firePbOut && e.n2 < 50 && this.wasRunning[i] && e.state !== 2 && e.state !== 1)
        this.engFail[i] = true;
      if (!e.master || e.firePbOut) this.engFail[i] = false;
      this.wasRunning[i] = e.running || (this.wasRunning[i] && e.master && !e.firePbOut);
      this.firePbFor[i] = e.firePbOut ? this.firePbFor[i] + dt : 0;
      // AVAIL
      if (e.state === 1 || e.state === 2) this.startSeen[i] = true;
      if (e.running && !this.prevRunning[i] && this.startSeen[i]) { this.engAvail[i] = 10; this.startSeen[i] = false; }
      if (!e.master) this.startSeen[i] = false;
      this.prevRunning[i] = e.running;
      if (this.engAvail[i] > 0) this.engAvail[i] = e.running ? Math.max(0, this.engAvail[i] - dt) : 0;
    }
    this.engRunningFor = Math.max(this.engRunFor[0], this.engRunFor[1]);

    // cargo smoke (detectors from sys-misc if published, or CARGO SMOKE TEST pb held)
    const testHeld = sim.getB('C:CARGO_SMOKE_TEST') && (a.dcEss || a.dc2);
    this.cargoTestFor = testHeld ? this.cargoTestFor + dt : 0;
    this.cargoSmoke.fwd = sim.getB('S:SMOKE_CARGO_FWD_DET') || this.cargoTestFor > 1;
    this.cargoSmoke.aft = sim.getB('S:SMOKE_CARGO_AFT_DET') || this.cargoTestFor > 1;

    this.updateToConfig(dt);
    this.updateAlerts(dt);
    this.updateMemosAndLines(dt);
  }

  private wasRunning: [boolean, boolean] = [false, false];
  private prevRunning: [boolean, boolean] = [false, false];
  private startSeen: [boolean, boolean] = [false, false];
  /** E/WD "AVAIL" indication: seconds remaining (10 s after the engine reached idle following a start). */
  engAvail: [number, number] = [0, 0];

  /* ------------------------------------------------------------------ T.O CONFIG */

  private updateToConfig(dt: number): void {
    const a = this.a;
    const ph = this.phase;
    const pressed = this.toCfgPressed && this.powered;
    this.toCfgPulse.write(pressed, dt);
    this.toCfgRiseTimer = pressed ? this.toCfgRiseTimer + dt : 0;
    // 0.5 s after the press: the T.O CONFIG NORMAL check is made
    const halfSecondCheck = this.toCfgHalf.write(pressed, dt);
    const test = this.toCfgTestActive() && this.powered;
    const phase129 = ph === 1 || ph === 2 || ph === 9;
    const phase34 = ph === 3 || ph === 4;

    if (ph === 2 || ph === 3) { if (pressed) this.toCfgChecked = true; } else this.toCfgChecked = false;
    if (ph === 3) this.toCfgChecked = true;
    if (ph === 2 && pressed) this.toCfgTestedP2 = true;
    if (ph !== 2) this.toCfgTestedP2 = false;

    // configuration signals (A320 CFM): slats 18..22 deg & flaps 10..20 deg = CONF 1+F, 2, 3
    const slatsNotTo = a.slats < 16 || a.slats > 25;
    const flapsNotTo = a.flaps < 8 || a.flaps > 22;
    const spdBrkNotTo = a.spdBrkLever > 0.05;
    // THS take-off range: 2.6 deg nose down .. 3.9 deg nose up (+ = nose up)
    const pitchNotTo = a.ths > 3.9 || a.ths < -2.6;
    const rudNotTo = Math.abs(a.rudTrim) > 3.6;
    const L = this.cfgLatch;
    const reset5 = ph === 5;
    const sig = (latch: Memory, notTo: boolean) => {
      latch.write(phase34 && notTo, !notTo || reset5);
      return (test && phase129 && notTo) || latch.read();
    };
    this.cfg.slats = sig(L.slats, slatsNotTo);
    this.cfg.flaps = sig(L.flaps, flapsNotTo);
    this.cfg.spdBrk = sig(L.spdBrk, spdBrkNotTo);
    this.cfg.pitch = sig(L.pitch, pitchNotTo);
    this.cfg.rud = sig(L.rud, rudNotTo);
    L.park.write(ph === 3 && a.parkBrake, !a.parkBrake || reset5);
    this.cfg.park = L.park.read();

    // T.O memo: T.O CONFIG pb in phase 2 (or 9), or 2 min after the 2nd engine start (phase 2).
    this.toMemoFF.write((ph === 2 || ph === 9) && pressed, ph === 1 || ph === 3 || ph === 6 || ph === 10);
    const bothRunning = this.bothRunningConf.write(a.bothEngRunning, dt);
    this.toMemo = this.powered && (this.toMemoFF.read() || (bothRunning && ph === 2));

    // T.O CONFIG NORMAL: the test found no config warning / T.O-blocking caution
    const doorsClosed = Object.values(a.doors).every((d) => d <= 0.02);
    const speedsOk = !a.sim.has('S:FMGS_V1') || (a.v1 > 0 && a.vr > 0 && a.v2 > 0 && a.v1 <= a.vr && a.vr <= a.v2);
    const flapMcdu = !(a.toConf >= 1 && a.toConf <= 3 && a.flapsLever !== Math.round(a.toConf));
    const brakesHot = Math.max(...a.brkTemps) > 300;
    const normal = !slatsNotTo && !flapsNotTo && !spdBrkNotTo && !pitchNotTo && !rudNotTo && doorsClosed && speedsOk &&
      flapMcdu && !brakesHot;
    const normalConf = this.toConfigNormalConf.write(normal, dt);
    this.toConfigMemoFF.write(halfSecondCheck && (ph === 2 || ph === 9) && normalConf, ph === 6 || !normalConf);
    this.toConfigNormal = this.toConfigMemoFF.read() && normalConf;

    this.showToInhibit = this.toInhibitConf.write(ph === 3 || ph === 4 || ph === 5, dt);
    this.showLdgInhibit = this.ldgInhibitConf.write(ph === 7 || ph === 8, dt);
  }

  showToInhibit = false;
  showLdgInhibit = false;

  /* ------------------------------------------------------------------ alerts */

  private updateAlerts(dt: number): void {
    const ph = this.phase;
    let newWarning = false;
    let newCaution = false;
    let crcWanted = false;
    let anyWarn = false;
    let anyCaut = false;
    for (const s of this.alerts) {
      const d = s.def;
      let raw = false;
      if (this.powered) {
        try { raw = d.cond(); } catch (e) { raw = false; }
      }
      s.rawFor = raw ? s.rawFor + dt : 0;
      const active = raw && s.rawFor >= (d.confirm ?? 0.3);
      if (!active) {
        s.active = false;
        s.displayed = false;
        s.cleared = false;
        s.shownFor = 0;
        continue;
      }
      s.active = true;
      if (!s.displayed && !s.cleared && !s.cancelled) {
        if (!d.inhibit.includes(ph)) {
          s.displayed = true;
          s.shownFor = 0;
          s.seq = ++this.seq;
          const aural = d.aural ?? (d.level === 3 ? 'CRC' : d.level === 2 ? 'SC' : 'NONE');
          if (d.level === 3) { newWarning = true; if (aural === 'CRC') crcWanted = true; }
          if (d.level === 2) newCaution = true;
          if (aural !== 'NONE' && aural !== 'CRC' && aural !== 'SC') this.emit(aural);
        }
      }
      if (s.displayed) s.shownFor += dt;
      if (s.displayed && !s.cancelled) {
        if (d.level === 3) anyWarn = true;
        if (d.level === 2) anyCaut = true;
      }
    }

    // MASTER WARN: set by a new level 3 alert, reset by the pb or when no level 3 alert remains.
    if (newWarning) this.masterWarn = true;
    if (!anyWarn) this.masterWarn = false;
    if (newCaution) this.masterCaut = true;
    if (!anyCaut) this.masterCaut = false;

    // CRC: continuous while a level 3 alert with CRC remains, until MASTER WARN pb / EMER CANC.
    const crcAlertsActive = this.alerts.some((s) => s.active && s.displayed && s.def.level === 3 && (s.def.aural ?? 'CRC') === 'CRC');
    if (crcWanted && !this.crcActive) { this.crcActive = true; this.emit('CRC'); }
    if (this.crcActive && !crcAlertsActive) this.stopCrc();
    // single chime (max one per 2 s, not while the CRC sounds)
    if (newCaution && !this.crcActive && this.sim.time - this.lastScAt >= 2) {
      this.lastScAt = this.sim.time;
      this.emit('SC');
    }
    if (!this.powered) {
      this.masterWarn = false;
      this.masterCaut = false;
      if (this.crcActive) this.stopCrc();
    }
  }

  private stopCrc(): void {
    if (!this.crcActive) return;
    this.crcActive = false;
    this.emit('STOP_CRC');
  }

  private emit(sound: FwcSound): void {
    this.sim?.emit('fwc:sound', { sound });
  }

  /** Alerts currently on the E/WD, in display order. */
  displayedAlerts(): AlertState[] {
    return this.alerts
      .filter((s) => s.active && s.displayed && !s.cleared && !s.cancelled)
      .sort((x, y) => y.def.level - x.def.level || x.index - y.index);
  }

  /** Active alerts whatever their display state (for the EFB / debug service). */
  activeAlerts(): AlertState[] {
    return this.alerts.filter((s) => s.active).sort((x, y) => y.def.level - x.def.level || x.index - y.index);
  }

  /* ------------------------------------------------------------------ crew actions */

  pressMasterWarn(): void {
    this.masterWarn = false;
    this.stopCrc();
  }

  pressMasterCaut(): void {
    this.masterCaut = false;
  }

  /** CLR: clears the first displayed alert (and the following ones of the same system group). Returns true if something was cleared. */
  clear(): boolean {
    const list = this.displayedAlerts();
    if (!list.length) return false;
    const first = list[0];
    if (first.def.noClear || first.shownFor < 0.5) return false;
    const group = first.def.sys;
    for (const s of list) {
      if (s.def.sys !== group || s.def.noClear) break;
      s.cleared = true;
    }
    if (!this.displayedAlerts().length) this.clearedAll = true;
    return true;
  }

  /** True once after the last displayed alert was cleared (the DMC then calls the STATUS page). */
  consumeClearedAll(): boolean {
    const v = this.clearedAll;
    this.clearedAll = false;
    return v;
  }

  /** RCL: recalls cleared alerts still active; long press also restores cancelled cautions. */
  recall(long = false): void {
    let any = false;
    for (const s of this.alerts) {
      if (s.active && s.cleared) { s.cleared = false; any = true; }
      if (long && s.cancelled) { s.cancelled = false; if (s.active) { s.displayed = true; any = true; } }
    }
    if (!any) this.normalRecall = 3;
  }

  /** EMER CANC: warnings → aural & MASTER WARN cancelled; cautions → cancelled for the rest of the flight. */
  emerCanc(): void {
    if (this.crcActive || this.masterWarn) {
      this.stopCrc();
      this.masterWarn = false;
      return;
    }
    const first = this.displayedAlerts()[0];
    if (first && first.def.level < 3) {
      first.cancelled = true;
      this.masterCaut = false;
    }
  }

  /* ------------------------------------------------------------------ E/WD lines */

  private updateMemosAndLines(dt: number): void {
    const a = this.a;
    if (this.normalRecall > 0) this.normalRecall = Math.max(0, this.normalRecall - dt);
    if (!this.powered) {
      this.leftLines = [];
      this.rightLines = [];
      this.leftFailures = false;
      this.sdRequest = SdPage.NONE;
      return;
    }
    const shown = this.displayedAlerts();
    // failure lines
    const fail: Line[] = [];
    let prevSys = '';
    for (const s of shown) {
      const d = s.def;
      const col: Col = d.level === 3 ? 'R' : 'A';
      const titleSegs: Seg[] = [];
      if (d.sys === prevSys) titleSegs.push({ t: ' '.repeat(d.sys.length), c: col });
      else titleSegs.push({ t: d.sys, c: col, u: true });
      if (d.title) titleSegs.push({ t: ` ${d.title}`, c: col });
      fail.push(titleSegs);
      prevSys = d.sys;
      const sub = typeof d.sub === 'function' ? d.sub() : d.sub ?? [];
      for (const l of sub) fail.push([{ t: l, c: col }]);
      const proc: ProcLine[] = d.procedure ? d.procedure() : [];
      for (const p of proc) {
        if (p.show && !p.show()) continue;
        if (p.done && p.done()) continue;
        fail.push([{ t: p.text, c: p.c }]);
      }
    }
    this.leftFailures = fail.length > 0;
    this.sdRequest = shown.find((s) => s.def.page !== undefined)?.def.page ?? SdPage.NONE;

    const memos = computeMemos({
      a, phase: this.phase, toMemo: this.toMemo, ldgMemo: false, toConfigNormal: this.toConfigNormal,
      toCfgTestedPhase2: this.toCfgTestedP2, engRunningFor: this.engRunningFor, showToInhibit: this.showToInhibit,
      showLdgInhibit: this.showLdgInhibit, speedBrakeExtended: a.spdBrkLever > 0.05,
    });
    let left: Line[] = fail.length ? fail : memos.left;
    if (!fail.length && this.normalRecall > 0) left = [[{ t: '              NORMAL', c: 'G' }]];
    this.leftOverflow = left.length > EWD_LINES;
    this.leftLines = left.slice(0, EWD_LINES);

    const right = memos.right.slice();
    this.status = this.computeStatus();
    const hasStatus = this.status.left.length + this.status.inop.length + this.status.cancelled.length > 0;
    this.stsReminder = hasStatus && !this.leftFailures;
    this.rightOverflow = right.length > EWD_LINES - (this.stsReminder ? 1 : 0);
    this.rightLines = right.slice(0, EWD_LINES - (this.stsReminder ? 1 : 0));
  }

  stsReminder = false;

  private computeStatus(): StatusContent {
    const left: Array<{ text: string; c: Col }> = [];
    const inop: string[] = [];
    const cancelled: string[] = [];
    for (const s of this.alerts) {
      if (!s.active) continue;
      if (s.cancelled) cancelled.push(`${s.def.sys} ${s.def.title}`.trim());
      if (!s.displayed && !s.cleared && !s.cancelled) continue;
      const st = s.def.status?.();
      if (!st) continue;
      for (const l of st.left ?? []) if (!left.some((x) => x.text === l.text)) left.push(l);
      for (const i of st.inop ?? []) if (!inop.includes(i)) inop.push(i);
    }
    return { left, inop, cancelled };
  }

  /** Scenario / test helper: force the flight phase. */
  forcePhase(p: number): void {
    this.phases.force(p);
    this.phase = p;
  }

  /** Scenario helper: T.O memo shown immediately (as if 2 min elapsed after 2nd engine start). */
  forceToMemo(): void {
    this.bothRunningConf.reset(true);
  }
}
