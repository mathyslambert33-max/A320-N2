/**
 * FCU (AFS control panel) and the two EFIS control panels.
 *
 * Behaviour follows FCOM DSC-22_30-40 (FCU) and DSC-31-40 (EFIS CP):
 *  - SPD/MACH, HDG/TRK, ALT, V/S-FPA knobs: push = managed / level off, pull = selected,
 *    rotation = preset (SPD 10 s, HDG and V/S 45 s — HDG preset kept on ground).
 *  - Dashes + white dot when a target is managed. ALT increments 100 / 1000 ft.
 *  - AP1/AP2/A-THR/LOC/APPR/EXPED pushbuttons with their engagement rules on ground.
 *  - EFIS: BARO (pull QNH / push STD, hPa / inHg ring), FD, LS, exclusive ND options,
 *    ND mode / range selectors, ADF-VOR selectors, CHRONO, TERR ON ND.
 * At FCU power-up: SPD managed, HDG managed, ALT 100 ft, V/S dashes, both FD on, baro STD.
 * DOM-free.
 */
import type { Sim, SimSystem } from '../../../core/sim';
import { clamp } from '../../../core/sim';
import { anyEngineRunning, fmgcAvailable, norm360, onGround, power, sideData, type Side } from './sources';

export const ND_RANGES = [10, 20, 40, 80, 160, 320];
/** ND modes (S:EFISn_ND_MODE), same order as the EFIS mode selector. */
export const ND_MODE = { ROSE_ILS: 0, ROSE_VOR: 1, ROSE_NAV: 2, ARC: 3, PLAN: 4 } as const;
/** ND option pushbuttons (S:EFISn_OPTION). */
export const ND_OPTIONS = ['', 'CSTR', 'WPT', 'VORD', 'NDB', 'ARPT'] as const;

export const HPA_PER_INHG = 33.8639;
export const BARO_HPA_MIN = 745;
export const BARO_HPA_MAX = 1100;
export const BARO_INHG_MIN = 22.0;
export const BARO_INHG_MAX = 32.48;

export const SPD_MIN = 100;
export const SPD_MAX = 399;
export const MACH_MIN = 0.1;
export const MACH_MAX = 0.99;
export const ALT_MIN = 100;
export const ALT_MAX = 49000;
export const VS_MAX = 6000;
export const FPA_MAX = 9.9;

/** Time a SPD/MACH preset stays displayed (s). */
export const SPD_PRESET_TIME = 10;
/** Time a HDG/TRK or V/S-FPA preset stays displayed (s). */
export const PRESET_TIME = 45;
/** Duration of the ND "MODE CHANGE" / "RANGE CHANGE" messages (s). */
export const ND_MSG_TIME = 1;

/** One ALT knob detent from `v` (ft) in direction `dir` with increment `inc` (FCU rounding). */
export function altStep(v: number, dir: 1 | -1, inc: number): number {
  const n = Math.round((v + dir * (inc / 2 + 1)) / inc) * inc;
  return clamp(n, ALT_MIN, ALT_MAX);
}

/** hPa → inHg rounded to 0.01. */
export const toInHg = (hpa: number): number => Math.round((hpa / HPA_PER_INHG) * 100) / 100;

/** CAS (kt) ↔ Mach at pressure altitude `alt` ft (ISA, subsonic compressible flow). */
export function casToMach(cas: number, alt: number): number {
  const p0 = 1013.25;
  const p = 1013.25 * Math.pow(Math.max(0.01, 1 - alt / 145366.45), 1 / 0.190284);
  const qc = p0 * (Math.pow(1 + 0.2 * (cas / 661.4786) ** 2, 3.5) - 1);
  return Math.sqrt(5 * (Math.pow(qc / p + 1, 1 / 3.5) - 1));
}
export function machToCas(mach: number, alt: number): number {
  const p0 = 1013.25;
  const p = 1013.25 * Math.pow(Math.max(0.01, 1 - alt / 145366.45), 1 / 0.190284);
  const qc = p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1);
  return 661.4786 * Math.sqrt(5 * (Math.pow(qc / p0 + 1, 1 / 3.5) - 1));
}

type EncPayload = { steps?: number; fast?: boolean } | undefined;
const stepsOf = (p: EncPayload) => Math.max(1, Math.round(p?.steps ?? 1));

export class FcuLogic implements SimSystem {
  readonly name = 'pfdnd-fcu';
  readonly order = 80;
  private sim: Sim;
  private wasPowered = false;
  private offTime = 0;
  /** Sim time at which each preset expires. */
  private spdPresetUntil = -1;
  private hdgPresetUntil = -1;
  private vsPresetUntil = -1;
  private ndMsgUntil: Record<Side, number> = { 1: -1, 2: -1 };
  private lastNdMode: Record<Side, number> = { 1: -1, 2: -1 };
  private lastNdRange: Record<Side, number> = { 1: -1, 2: -1 };
  private chronoStart: Record<Side, number> = { 1: 0, 2: 0 };
  private toThrust = false;

  constructor(sim: Sim) {
    this.sim = sim;
    this.bindEvents();
  }

  /* ---------------------------------------------------------------- helpers */

  private get powered(): boolean {
    return this.sim.getB('S:FCU_POWERED');
  }

  private anyApFd(): boolean {
    const s = this.sim;
    return s.getB('S:FCU_AP1') || s.getB('S:FCU_AP2') || s.getB('S:FG_FD1_ENGAGED') || s.getB('S:FG_FD2_ENGAGED');
  }

  /** Default values at FCU power-up (also used by init with sim.init semantics). */
  private defaults(write: (n: string, v: number) => void): void {
    write('S:FCU_SPD', SPD_MIN);
    write('S:FCU_SPD_IS_MACH', 0);
    write('S:FCU_SPD_MANAGED', 1);
    write('S:FCU_SPD_PRESET', 0);
    write('S:FCU_HDG', 0);
    write('S:FCU_HDG_MANAGED', 1);
    write('S:FCU_HDG_PRESET', 0);
    write('S:FCU_ALT', ALT_MIN);
    write('S:FCU_VS', 0);
    write('S:FCU_FPA', 0);
    write('S:FCU_VS_ACTIVE', 0);
    write('S:FCU_VS_PRESET', 0);
    write('S:FCU_TRK_FPA', 0);
    write('S:FCU_AP1', 0);
    write('S:FCU_AP2', 0);
    write('S:FCU_ATHR', 0);
    write('S:FCU_LOC', 0);
    write('S:FCU_APPR', 0);
    write('S:FCU_EXPED', 0);
    write('S:FCU_METRIC_ALT', 0);
    for (const n of [1, 2] as Side[]) {
      write(`S:FCU_FD${n}`, 1);
      write(`S:FCU_LS${n}`, 0);
      write(`S:EFIS${n}_BARO_STD`, 1);
      write(`S:EFIS${n}_BARO_HPA`, 1013);
      write(`S:EFIS${n}_BARO_PRESEL`, 0);
      write(`S:EFIS${n}_OPTION`, 0);
      write(`S:EFIS${n}_CHRONO_STATE`, 0);
      write(`S:EFIS${n}_CHRONO_S`, 0);
    }
  }

  init(sim: Sim): void {
    this.wasPowered = sim.getB('S:FCU_POWERED');
    this.defaults((n, v) => sim.init(n, v));
    sim.init('S:FCU_HDG_DASHES', 1);
    sim.init('S:FCU_VS_DASHES', 1);
    sim.init('S:FCU_SPD_DOT', 0);
    sim.init('S:FCU_HDG_DOT', 0);
    sim.init('S:FCU_ALT_DOT', 0);
    for (const n of [1, 2] as Side[]) {
      this.lastNdMode[n] = this.ndModeSel(n);
      this.lastNdRange[n] = this.ndRangeSel(n);
    }
  }

  /* ---------------------------------------------------------------- events */

  private bindEvents(): void {
    const s = this.sim;
    const on = (ev: string, fn: (p?: any) => void) => s.on(ev, (p) => { if (this.powered) fn(p); });

    // SPD / MACH
    on('FCU_SPD:inc', (p) => this.turnSpd(stepsOf(p)));
    on('FCU_SPD:dec', (p) => this.turnSpd(-stepsOf(p)));
    on('FCU_SPD:pull', () => this.pullSpd());
    on('FCU_SPD:push', () => this.pushSpd());
    on('FCU_SPD_MACH:press', () => this.toggleSpdMach());
    // HDG / TRK
    on('FCU_HDG:inc', (p) => this.turnHdg(stepsOf(p)));
    on('FCU_HDG:dec', (p) => this.turnHdg(-stepsOf(p)));
    on('FCU_HDG:pull', () => this.pullHdg());
    on('FCU_HDG:push', () => this.pushHdg());
    on('FCU_HDG_TRK:press', () => s.set('S:FCU_TRK_FPA', s.getB('S:FCU_TRK_FPA') ? 0 : 1));
    // ALT
    on('FCU_ALT:inc', (p) => this.turnAlt(stepsOf(p)));
    on('FCU_ALT:dec', (p) => this.turnAlt(-stepsOf(p)));
    on('FCU_ALT:pull', () => this.pullAlt());
    on('FCU_ALT:push', () => this.pushAlt());
    // V/S - FPA
    on('FCU_VS:inc', (p) => this.turnVs(stepsOf(p)));
    on('FCU_VS:dec', (p) => this.turnVs(-stepsOf(p)));
    on('FCU_VS:pull', () => this.pullVs());
    on('FCU_VS:push', () => this.pushVs());
    // Pushbuttons
    on('FCU_AP1:press', () => this.pressAp(1));
    on('FCU_AP2:press', () => this.pressAp(2));
    on('FCU_ATHR:press', () => this.pressAthr());
    on('FCU_LOC:press', () => this.pressLoc());
    on('FCU_APPR:press', () => this.pressAppr());
    on('FCU_EXPED:press', () => this.pressExped());
    on('FCU_METRIC_ALT:press', () => s.set('S:FCU_METRIC_ALT', s.getB('S:FCU_METRIC_ALT') ? 0 : 1));
    // Disconnects (not FCU-powered dependent for the command itself, but only meaningful when engaged)
    for (const side of ['CAPT', 'FO']) s.on(`SIDESTICK_${side}_TAKEOVER:press`, () => this.disconnectAp(true));
    for (const n of [1, 2]) s.on(`THR_ATHR_DISC${n}:press`, () => this.disconnectAthr(true));

    for (const n of [1, 2] as Side[]) {
      const e = `EFIS${n}`;
      on(`${e}_BARO:inc`, (p) => this.turnBaro(n, stepsOf(p)));
      on(`${e}_BARO:dec`, (p) => this.turnBaro(n, -stepsOf(p)));
      on(`${e}_BARO:pull`, () => this.pullBaro(n));
      on(`${e}_BARO:push`, () => this.pushBaro(n));
      on(`${e}_FD:press`, () => s.set(`S:FCU_FD${n}`, s.getB(`S:FCU_FD${n}`) ? 0 : 1));
      on(`${e}_LS:press`, () => s.set(`S:FCU_LS${n}`, s.getB(`S:FCU_LS${n}`) ? 0 : 1));
      ND_OPTIONS.forEach((opt, i) => {
        if (!opt) return;
        on(`${e}_${opt}:press`, () => s.set(`S:EFIS${n}_OPTION`, s.get(`S:EFIS${n}_OPTION`) === i ? 0 : i));
      });
      // The ND CHRONO is a DMC function (works without the FCU).
      s.on(`CHRONO_${n === 1 ? 'CAPT' : 'FO'}:press`, () => this.pressChrono(n));
    }
  }

  /* ---------------------------------------------------------------- SPD */

  /** Speed target currently used by the FG when managed (V2 on ground), 0 if none. */
  private managedSpeed(): number {
    return this.sim.get('S:FG_MANAGED_SPD');
  }

  private turnSpd(steps: number): void {
    const s = this.sim;
    const isMach = s.getB('S:FCU_SPD_IS_MACH');
    let v = s.get('S:FCU_SPD');
    if (s.getB('S:FCU_SPD_MANAGED') && !s.getB('S:FCU_SPD_PRESET')) {
      // Start a preselection from the current target.
      const m = this.managedSpeed();
      v = isMach ? v : m > 0 ? Math.round(m) : Math.max(SPD_MIN, Math.round(sideData(s, 1).ias) || SPD_MIN);
    }
    if (isMach) v = clamp(Math.round(v + steps), MACH_MIN * 100, MACH_MAX * 100);
    else v = clamp(Math.round(v + steps), SPD_MIN, SPD_MAX);
    s.set('S:FCU_SPD', v);
    if (s.getB('S:FCU_SPD_MANAGED')) {
      s.set('S:FCU_SPD_PRESET', 1);
      this.spdPresetUntil = s.time + SPD_PRESET_TIME;
    }
  }

  private pullSpd(): void {
    const s = this.sim;
    if (s.getB('S:FCU_SPD_MANAGED')) {
      if (!s.getB('S:FCU_SPD_PRESET')) {
        const m = this.managedSpeed();
        const cur = m > 0 ? m : sideData(s, 1).ias;
        if (!s.getB('S:FCU_SPD_IS_MACH')) s.set('S:FCU_SPD', clamp(Math.round(cur) || SPD_MIN, SPD_MIN, SPD_MAX));
      }
      s.set('S:FCU_SPD_MANAGED', 0);
      s.set('S:FCU_SPD_PRESET', 0);
    }
  }

  private pushSpd(): void {
    const s = this.sim;
    // Managed speed requires an FMGC (otherwise the push has no effect).
    if (!fmgcAvailable(s)) return;
    s.set('S:FCU_SPD_MANAGED', 1);
    s.set('S:FCU_SPD_PRESET', 0);
  }

  private toggleSpdMach(): void {
    const s = this.sim;
    if (s.getB('S:FCU_SPD_MANAGED') && !s.getB('S:FCU_SPD_PRESET')) return;
    const alt = sideData(s, 1).altStd;
    if (s.getB('S:FCU_SPD_IS_MACH')) {
      const cas = machToCas(s.get('S:FCU_SPD') / 100, alt);
      s.set('S:FCU_SPD', clamp(Math.round(cas), SPD_MIN, SPD_MAX));
      s.set('S:FCU_SPD_IS_MACH', 0);
    } else {
      const m = casToMach(s.get('S:FCU_SPD'), alt);
      s.set('S:FCU_SPD', clamp(Math.round(m * 100), MACH_MIN * 100, MACH_MAX * 100));
      s.set('S:FCU_SPD_IS_MACH', 1);
    }
  }

  /* ---------------------------------------------------------------- HDG */

  private turnHdg(steps: number): void {
    const s = this.sim;
    let v = s.get('S:FCU_HDG');
    if (s.getB('S:FCU_HDG_DASHES')) {
      // Preset starts from the current heading (or track).
      const d = sideData(s, 1);
      if (d.hdgValid) v = Math.round(s.getB('S:FCU_TRK_FPA') ? d.trkMag : d.hdgMag);
    }
    v = norm360(Math.round(v + steps));
    s.set('S:FCU_HDG', v);
    s.set('S:FCU_HDG_DASHES', 0);
    if (s.getB('S:FCU_HDG_MANAGED')) {
      s.set('S:FCU_HDG_PRESET', 1);
      this.hdgPresetUntil = onGround(s) ? Infinity : s.time + PRESET_TIME;
    }
  }

  private pullHdg(): void {
    const s = this.sim;
    if (s.getB('S:FCU_HDG_DASHES')) {
      const d = sideData(s, 1);
      if (d.hdgValid) s.set('S:FCU_HDG', norm360(Math.round(s.getB('S:FCU_TRK_FPA') ? d.trkMag : d.hdgMag)));
    }
    s.set('S:FCU_HDG_MANAGED', 0);
    s.set('S:FCU_HDG_PRESET', 0);
    s.set('S:FCU_HDG_DASHES', 0);
  }

  private pushHdg(): void {
    const s = this.sim;
    if (!fmgcAvailable(s)) return;
    s.set('S:FCU_HDG_MANAGED', 1);
    s.set('S:FCU_HDG_PRESET', 0);
    if (this.anyApFd()) s.set('S:FCU_HDG_DASHES', 1);
  }

  /* ---------------------------------------------------------------- ALT */

  private turnAlt(steps: number): void {
    const s = this.sim;
    const inc = this.altInc();
    let v = s.get('S:FCU_ALT');
    const dir = steps > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i++) v = altStep(v, dir, inc);
    s.set('S:FCU_ALT', v);
  }

  altInc(): number {
    return Math.round(this.sim.get('C:FCU_ALT_INC')) === 0 ? 100 : 1000;
  }

  /** ALT pull (OP CLB / OP DES) and push (managed CLB / DES) act on the FG in flight only. */
  private pullAlt(): void {
    if (onGround(this.sim)) return;
    this.sim.emit('fg:alt_pull');
  }

  private pushAlt(): void {
    if (onGround(this.sim)) return;
    this.sim.emit('fg:alt_push');
  }

  /* ---------------------------------------------------------------- V/S */

  private turnVs(steps: number): void {
    const s = this.sim;
    const fpa = s.getB('S:FCU_TRK_FPA');
    if (s.getB('S:FCU_VS_DASHES')) {
      // Preset starts from the current vertical speed.
      const vs = sideData(s, 1).vs;
      s.set('S:FCU_VS', clamp(Math.round(vs / 100) * 100, -VS_MAX, VS_MAX));
      s.set('S:FCU_FPA', 0);
    }
    if (fpa) s.set('S:FCU_FPA', clamp(Math.round((s.get('S:FCU_FPA') + steps * 0.1) * 10) / 10, -FPA_MAX, FPA_MAX));
    else s.set('S:FCU_VS', clamp(s.get('S:FCU_VS') + steps * 100, -VS_MAX, VS_MAX));
    s.set('S:FCU_VS_DASHES', 0);
    if (!s.getB('S:FCU_VS_ACTIVE')) {
      s.set('S:FCU_VS_PRESET', 1);
      this.vsPresetUntil = s.time + PRESET_TIME;
    }
  }

  private pullVs(): void {
    const s = this.sim;
    if (onGround(s)) return; // V/S-FPA cannot engage on ground
    if (s.getB('S:FCU_VS_DASHES')) {
      s.set('S:FCU_VS', clamp(Math.round(sideData(s, 1).vs / 100) * 100, -VS_MAX, VS_MAX));
    }
    s.set('S:FCU_VS_ACTIVE', 1);
    s.set('S:FCU_VS_PRESET', 0);
    s.set('S:FCU_VS_DASHES', 0);
  }

  private pushVs(): void {
    const s = this.sim;
    if (onGround(s)) return;
    // Immediate level off: V/S = 0.
    s.set('S:FCU_VS', 0);
    s.set('S:FCU_FPA', 0);
    s.set('S:FCU_VS_ACTIVE', 1);
    s.set('S:FCU_VS_DASHES', 0);
  }

  /* ---------------------------------------------------------------- AP / A-THR / modes */

  /** AP engagement conditions (FCOM DSC-22_30-20): FMGC and attitude available; on ground, engines stopped. */
  apCanEngage(n: 1 | 2): boolean {
    const s = this.sim;
    if (!fmgcAvailable(s, n)) return false;
    if (!sideData(s, 1).attValid && !sideData(s, 2).attValid) return false;
    if (onGround(s) && anyEngineRunning(s)) return false;
    return true;
  }

  private pressAp(n: 1 | 2): void {
    const s = this.sim;
    const me = `S:FCU_AP${n}`;
    const other = `S:FCU_AP${n === 1 ? 2 : 1}`;
    if (s.getB(me)) {
      s.set(me, 0);
      s.emit('fg:ap_disconnect', { voluntary: true, ap: n });
      return;
    }
    if (!this.apCanEngage(n)) return;
    // Both APs only with LOC/APPR armed or engaged; otherwise the last one pressed wins.
    const approach = s.getB('S:FCU_LOC') || s.getB('S:FCU_APPR');
    if (s.getB(other) && !approach) s.set(other, 0);
    s.set(me, 1);
  }

  disconnectAp(voluntary: boolean): void {
    const s = this.sim;
    if (!s.getB('S:FCU_AP1') && !s.getB('S:FCU_AP2')) return;
    s.set('S:FCU_AP1', 0);
    s.set('S:FCU_AP2', 0);
    s.emit('fg:ap_disconnect', { voluntary });
  }

  private pressAthr(): void {
    const s = this.sim;
    const st = s.get('S:FCU_ATHR');
    if (st > 0) {
      this.disconnectAthr(true);
      return;
    }
    if (!fmgcAvailable(s)) return;
    // On ground the A/THR can be armed only with an engine running (FCOM DSC-22_40).
    if (onGround(s) && !anyEngineRunning(s)) return;
    s.set('S:FCU_ATHR', 1);
  }

  disconnectAthr(voluntary: boolean): void {
    const s = this.sim;
    if (s.get('S:FCU_ATHR') === 0) return;
    s.set('S:FCU_ATHR', 0);
    s.emit('fg:athr_disconnect', { voluntary });
  }

  private pressLoc(): void {
    const s = this.sim;
    if (onGround(s) || !fmgcAvailable(s)) return;
    const v = s.getB('S:FCU_LOC') ? 0 : 1;
    s.set('S:FCU_LOC', v);
    if (v) s.set('S:FCU_APPR', 0);
  }

  private pressAppr(): void {
    const s = this.sim;
    if (onGround(s) || !fmgcAvailable(s)) return;
    const v = s.getB('S:FCU_APPR') ? 0 : 1;
    s.set('S:FCU_APPR', v);
    if (v) s.set('S:FCU_LOC', 0);
  }

  private pressExped(): void {
    const s = this.sim;
    if (onGround(s) || !fmgcAvailable(s)) return;
    s.set('S:FCU_EXPED', s.getB('S:FCU_EXPED') ? 0 : 1);
  }

  /* ---------------------------------------------------------------- EFIS */

  private turnBaro(n: Side, steps: number): void {
    const s = this.sim;
    const std = s.getB(`S:EFIS${n}_BARO_STD`);
    const hpa = s.get(`S:EFIS${n}_BARO_HPA`);
    let out: number;
    if (Math.round(s.get(`C:EFIS${n}_BARO_UNIT`)) === 0) {
      const inhg = clamp(Math.round((toInHg(hpa) + steps * 0.01) * 100) / 100, BARO_INHG_MIN, BARO_INHG_MAX);
      out = inhg * HPA_PER_INHG;
    } else {
      out = clamp(Math.round(hpa) + steps, BARO_HPA_MIN, BARO_HPA_MAX);
    }
    s.set(`S:EFIS${n}_BARO_HPA`, Math.round(out * 1000) / 1000);
    // In STD, rotating the knob preselects the QNH (shown on the PFD below STD).
    if (std) s.set(`S:EFIS${n}_BARO_PRESEL`, 1);
  }

  private pullBaro(n: Side): void {
    const s = this.sim;
    s.set(`S:EFIS${n}_BARO_STD`, 0);
    s.set(`S:EFIS${n}_BARO_PRESEL`, 0);
  }

  private pushBaro(n: Side): void {
    const s = this.sim;
    s.set(`S:EFIS${n}_BARO_STD`, 1);
    s.set(`S:EFIS${n}_BARO_PRESEL`, 0);
  }

  private pressChrono(n: Side): void {
    const s = this.sim;
    const st = s.get(`S:EFIS${n}_CHRONO_STATE`);
    if (st === 0) {
      this.chronoStart[n] = s.time;
      s.set(`S:EFIS${n}_CHRONO_S`, 0);
      s.set(`S:EFIS${n}_CHRONO_STATE`, 1);
    } else if (st === 1) {
      s.set(`S:EFIS${n}_CHRONO_STATE`, 2);
    } else {
      s.set(`S:EFIS${n}_CHRONO_STATE`, 0);
      s.set(`S:EFIS${n}_CHRONO_S`, 0);
    }
  }

  private ndModeSel(n: Side): number {
    const c = `C:EFIS${n}_ND_MODE`;
    return this.sim.has(c) ? clamp(Math.round(this.sim.get(c)), 0, 4) : ND_MODE.ARC;
  }

  private ndRangeSel(n: Side): number {
    const c = `C:EFIS${n}_ND_RANGE`;
    return this.sim.has(c) ? clamp(Math.round(this.sim.get(c)), 0, 5) : 0;
  }

  /* ---------------------------------------------------------------- update */

  update(_dt: number, s: Sim): void {
    // FCU: two channels, DC ESS BUS and DC BUS 2.
    const pw = power.dcEss(s) || power.dc2(s);
    s.set('S:FCU_POWERED', pw);
    if (!pw) {
      if (this.wasPowered) this.offTime = s.time;
      this.wasPowered = false;
      this.lights(false);
      if (s.getB('S:FCU_AP1') || s.getB('S:FCU_AP2')) this.disconnectAp(false);
      if (s.get('S:FCU_ATHR') > 0) this.disconnectAthr(false);
    } else {
      if (!this.wasPowered && s.time - this.offTime > 0.2) {
        this.defaults((n, v) => s.set(n, v));
        s.set('S:FCU_HDG_DASHES', 1);
        s.set('S:FCU_VS_DASHES', 1);
        const d = sideData(s, 1);
        if (d.hdgValid) s.set('S:FCU_HDG', norm360(Math.round(d.hdgMag)));
      }
      this.wasPowered = true;
      this.updateFcu(s);
    }

    // EFIS side items (DMC functions — keep working with the FCU off, like the real CP).
    for (const n of [1, 2] as Side[]) {
      s.set(`S:EFIS${n}_BARO_INHG`, Math.round(s.get(`C:EFIS${n}_BARO_UNIT`)) === 0 ? 1 : 0);
      const mode = this.ndModeSel(n);
      const range = this.ndRangeSel(n);
      if (this.lastNdMode[n] !== mode) {
        s.set(`S:EFIS${n}_ND_MSG`, 1);
        this.ndMsgUntil[n] = s.time + ND_MSG_TIME;
      } else if (this.lastNdRange[n] !== range) {
        s.set(`S:EFIS${n}_ND_MSG`, 2);
        this.ndMsgUntil[n] = s.time + ND_MSG_TIME;
      }
      if (s.time > this.ndMsgUntil[n]) s.set(`S:EFIS${n}_ND_MSG`, 0);
      this.lastNdMode[n] = mode;
      this.lastNdRange[n] = range;
      s.set(`S:EFIS${n}_ND_MODE`, mode);
      s.set(`S:EFIS${n}_ND_RANGE`, ND_RANGES[range]);
      // ADF/VOR selectors: switch 0 VOR, 1 OFF, 2 ADF → 1 VOR, 0 OFF, 2 ADF.
      for (const k of [1, 2]) {
        const sw = Math.round(s.has(`C:EFIS${n}_NAV${k}`) ? s.get(`C:EFIS${n}_NAV${k}`) : 1);
        s.set(`S:EFIS${n}_NAV${k}`, sw === 0 ? 1 : sw === 2 ? 2 : 0);
      }
      // CHRONO
      if (s.get(`S:EFIS${n}_CHRONO_STATE`) === 1) s.set(`S:EFIS${n}_CHRONO_S`, Math.floor(s.time - this.chronoStart[n]));
      // TERR ON ND (EGPWS on AC BUS 1)
      const side = n === 1 ? 'CAPT' : 'FO';
      const terrPb = s.getB(`C:MAIN_TERR_ON_ND_${side}`);
      s.set(`S:EFIS${n}_TERR_ON_ND`, terrPb && power.ac1(s));
      s.set(`L:MAIN_TERR_ON_ND_${side}_ON`, terrPb && s.getB('S:ANN_POWER'));
    }
  }

  private updateFcu(s: Sim): void {
    const ground = onGround(s);
    const anyApFd = this.anyApFd();

    // AP disengagement conditions on ground (engine start) / loss of FMGC.
    for (const n of [1, 2] as const) {
      if (s.getB(`S:FCU_AP${n}`) && !this.apCanEngage(n)) {
        s.set(`S:FCU_AP${n}`, 0);
        s.emit('fg:ap_disconnect', { voluntary: false, ap: n });
      }
    }
    if (s.get('S:FCU_ATHR') > 0 && !fmgcAvailable(s)) this.disconnectAthr(false);
    // A/THR arms when the thrust levers are set to FLX/MCT or TOGA for take-off.
    const tla = Math.max(s.get('C:THR_LEVER1'), s.get('C:THR_LEVER2'));
    if (ground && tla >= 34.5 && !this.toThrust && s.get('S:FCU_ATHR') === 0 && fmgcAvailable(s)) s.set('S:FCU_ATHR', 1);
    this.toThrust = tla >= 34.5;

    // Presets timing out.
    if (s.getB('S:FCU_SPD_PRESET') && s.time > this.spdPresetUntil) s.set('S:FCU_SPD_PRESET', 0);
    if (s.getB('S:FCU_HDG_PRESET') && !ground && s.time > this.hdgPresetUntil) {
      if (this.hdgPresetUntil === Infinity) this.hdgPresetUntil = s.time + PRESET_TIME;
      else {
        s.set('S:FCU_HDG_PRESET', 0);
        if (s.getB('S:FCU_HDG_MANAGED') && anyApFd) s.set('S:FCU_HDG_DASHES', 1);
      }
    }
    if (s.getB('S:FCU_VS_PRESET') && s.time > this.vsPresetUntil) {
      s.set('S:FCU_VS_PRESET', 0);
      if (anyApFd && !s.getB('S:FCU_VS_ACTIVE')) s.set('S:FCU_VS_DASHES', 1);
    }
    // Dashes follow AP/FD engagement: with no AP/FD the windows show values.
    if (!anyApFd) {
      s.set('S:FCU_HDG_DASHES', 0);
      s.set('S:FCU_VS_DASHES', 0);
    } else {
      if (s.getB('S:FCU_HDG_MANAGED') && !s.getB('S:FCU_HDG_PRESET')) s.set('S:FCU_HDG_DASHES', 1);
      if (!s.getB('S:FCU_VS_ACTIVE') && !s.getB('S:FCU_VS_PRESET')) s.set('S:FCU_VS_DASHES', 1);
    }
    if (ground) s.set('S:FCU_VS_ACTIVE', 0);

    // Managed dots.
    const fmgc = fmgcAvailable(s);
    s.set('S:FCU_SPD_DOT', fmgc && s.getB('S:FCU_SPD_MANAGED'));
    // Lateral managed (NAV armed or engaged; on ground: flight plan available with HDG managed).
    const latManaged = s.get('S:FG_LAT_ARMED') === 1 || s.get('S:FG_LAT_ACTIVE') === 5 ||
      (ground && s.getB('S:FCU_HDG_MANAGED') && s.getB('S:FMGS_FPLN_ACTIVE'));
    s.set('S:FCU_HDG_DOT', fmgc && latManaged);
    s.set('S:FCU_ALT_DOT', fmgc && (s.get('S:FG_VERT_ARMED') === 1 || s.get('S:FG_VERT_ACTIVE') === 2));
    s.set('S:FCU_ALT_INC', this.altInc());

    this.lights(true);
  }

  private lights(on: boolean): void {
    const s = this.sim;
    const L = (id: string, v: boolean) => s.set(`L:${id}`, on && v ? 1 : 0);
    L('FCU_AP1', s.getB('S:FCU_AP1'));
    L('FCU_AP2', s.getB('S:FCU_AP2'));
    L('FCU_ATHR', s.get('S:FCU_ATHR') > 0);
    L('FCU_LOC', s.getB('S:FCU_LOC'));
    L('FCU_APPR', s.getB('S:FCU_APPR'));
    L('FCU_EXPED', s.getB('S:FCU_EXPED'));
    for (const n of [1, 2]) {
      L(`EFIS${n}_FD`, s.getB(`S:FCU_FD${n}`));
      L(`EFIS${n}_LS`, s.getB(`S:FCU_LS${n}`));
      ND_OPTIONS.forEach((opt, i) => { if (opt) L(`EFIS${n}_${opt}`, s.get(`S:EFIS${n}_OPTION`) === i); });
    }
  }
}
