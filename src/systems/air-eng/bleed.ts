/**
 * Pneumatic system (A320 FCOM DSC-36): engine bleed (IP/HP stages, HP valve, pressure regulating
 * valve "PRV" = ENG BLEED valve, precooler), APU bleed (sys-elec valve & pressure), HP ground air,
 * cross bleed valve, two-sided bleed manifold with a pressure/flow solver, BMC monitoring
 * (over-pressure, over-temperature, leak → ENG BLEED FAULT), wing anti-ice supply.
 *
 * - ENG BLEED valve (PRV): pneumatically operated (opens only with upstream pressure > 8 psi),
 *   electrically controlled; regulates 44 ± 4 psi downstream. Closes automatically when the ENG BLEED
 *   pb is OFF, the ENG FIRE pb is released, the engine start valve is open, the APU bleed valve is
 *   open (ENG 1 always, ENG 2 only when the X BLEED valve is open), or on over-pressure / over-heat / leak.
 * - HP valve: opens at low engine speed when the IP stage is insufficient (always at ground idle),
 *   closes when the PRV is closed.
 * - X BLEED (motor-driven, ~3 s): SHUT / OPEN, or AUTO: open while the APU bleed valve is open.
 * - The APU bleed and the HP ground connection join the manifold on the engine 1 (left) side of the
 *   X BLEED valve (so an engine 2 start on external air needs X BLEED OPEN, like the FCOM procedure).
 *
 * Solver: each side of the manifold (joined when the X BLEED valve is open) is a node. Sources have a
 * no-load pressure P0 and a quadratic droop P = P0 − R·Q² (Q in kg/s); a PRV-regulated source stops
 * delivering above its set point. Consumers: packs (flow-regulated), engine starters (∝ pressure),
 * wing anti-ice. The node pressure solves Σ Qsources(p) = Σ Qconsumers(p) (bisection), then a duct
 * volume lag gives the realistic dips (e.g. APU air ≈ 36-40 psi with packs, ≈ 44 psi packs closed,
 * ≈ 28-32 psi while a starter is running; engine idle with its pack ≈ 40-44 psi).
 */
import type { Sim } from '../../core/sim';
import { anyDc, clamp, clamp01, dc2, dcEss, dcBat, DelayOn, fireReleased, lag, oat, pbIn } from './common';
import type { Fadec } from './fadec';

export const PRV_SETPOINT = 44;
/** Duct loss between the APU bleed valve (where sys-elec's S:APU_BLEED_PRESS already includes the APU
 *  load-compressor droop with the demand) and the manifold. */
const APU_R = 1.5;
/** Source response lag: a demand step (start valve / pack valve opening) makes the duct pressure dip
 *  (psi per kg/s of sudden extra demand) until the sources' regulators catch up (τ ≈ 6 s). */
const TRANSIENT_K = 8;
const ENG_R = 20;
const CART_R = 12;
/** Starter air consumption (kg/s per psi, valve fully open). */
export const STARTER_G = 0.035;

interface Source { p0: number; r: number; reg: number; }

/** Engine bleed no-load pressure (psi) available through the IP/HP ports vs N2 (%). */
export function engineBleedSource(n2: number, lit: boolean): number {
  if (n2 < 20) return 0;
  const base = 46 * Math.pow(clamp((n2 - 20) / 39, 0, 3), 1.25);
  return lit ? base : base * 0.35; // motoring: poor compression
}

/** Engine bleed temperature downstream of the precooler (°C) vs N2 — FAV regulates ≈ 200 °C. */
function engineBleedTemp(n2: number, oatC: number): number {
  if (n2 < 20) return oatC;
  return Math.min(200, oatC + 148 * clamp((n2 - 20) / 39, 0, 2));
}

function sourceFlow(s: Source, p: number): number {
  const lim = Math.min(s.p0, s.reg);
  if (p >= lim) return 0;
  return Math.sqrt((s.p0 - p) / s.r);
}

export interface Consumer {
  /** Regulated flow (kg/s) at nominal pressure. */
  q: number;
  /** Pressure below which the flow falls proportionally (psi). */
  pMin: number;
  /** Flow proportional to pressure (kg/s per psi) instead of regulated. */
  g?: number;
}

function consumerFlow(c: Consumer, p: number): number {
  if (c.g !== undefined) return c.g * p;
  return c.q * clamp01(p / c.pMin);
}

/** Solve the node pressure: Σ sources = Σ consumers. */
export function solveNode(sources: Source[], consumers: Consumer[]): { p: number; q: number } {
  if (!sources.length) return { p: 0, q: 0 };
  let lo = 0;
  let hi = Math.max(...sources.map((s) => Math.min(s.p0, s.reg)));
  if (hi <= 0) return { p: 0, q: 0 };
  const f = (p: number) => sources.reduce((a, s) => a + sourceFlow(s, p), 0) - consumers.reduce((a, c) => a + consumerFlow(c, p), 0);
  if (f(hi - 1e-6) >= 0) {
    // No demand at max pressure: the regulated / no-load pressure is reached.
    return { p: hi, q: consumers.reduce((a, c) => a + consumerFlow(c, hi), 0) };
  }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  const p = (lo + hi) / 2;
  return { p, q: consumers.reduce((a, c) => a + consumerFlow(c, p), 0) };
}

export class BleedModel {
  /** Displayed duct pressure per side (psi), [0] = left/eng 1, [1] = right/eng 2. */
  press = [0, 0];
  temp: [number, number];
  prvPos = [0, 0];
  hpOpen = [false, false];
  xbleedPos = 0;
  apuValve = false;
  apuPress = 0;
  cart = false;
  engFault = [false, false];
  apuLeak = false;
  /** Flow delivered by each source (kg/s), for temperatures / debug. */
  flowEng = [0, 0];
  flowApu = 0;
  /** Consumers registered by the other sub-systems for this tick (kg/s at nominal). */
  packDemand = [0, 0];
  waiDemand = [0, 0];
  private overPress = [new DelayOn(5), new DelayOn(5)];
  private demandLag = [0, 0];
  private overTemp = [new DelayOn(55), new DelayOn(55)];
  /** Failure injection. */
  failLeak = [false, false];
  failApuLeak = false;

  constructor(oatC: number) {
    this.temp = [oatC, oatC];
  }

  /** Is the PRV of engine n commanded closed by the BMC logic? */
  update(sim: Sim, dt: number, eng: [Fadec, Fadec]): void {
    const t = oat(sim);
    const dcOk = anyDc(sim);
    // BMC 1 (DC ESS / DC BAT) & BMC 2 (DC 2): the two BMCs monitor both engines (cross-talk).
    const bmcOk = dcEss(sim) || dcBat(sim) || dc2(sim);

    /* ---------------- APU bleed (valve owned by sys-elec) ---------------- */
    const apuPb = pbIn(sim, 'AIR_APU_BLEED');
    this.apuValve = sim.has('S:APU_BLEED_VALVE') ? sim.getB('S:APU_BLEED_VALVE') : sim.getB('S:APU_AVAIL') && apuPb;
    this.apuPress = this.apuValve ? (sim.has('S:APU_BLEED_PRESS') ? sim.get('S:APU_BLEED_PRESS') : 42) : 0;
    this.apuLeak = this.failApuLeak;
    this.cart = sim.getB('G:GND_AIR_START_UNIT');

    /* ---------------- X BLEED valve ---------------- */
    const xsel = Math.round(sim.has('C:AIR_XBLEED') ? sim.get('C:AIR_XBLEED') : 1);
    const leak = this.failLeak[0] || this.failLeak[1] || this.apuLeak;
    const xCmd = xsel === 2 || (xsel === 1 && this.apuValve && !leak);
    if (dcOk) this.xbleedPos = clamp(this.xbleedPos + (xCmd ? dt : -dt) / 3, 0, 1);
    const xOpen = this.xbleedPos > 0.5;

    /* ---------------- engine bleed valves ---------------- */
    const src: Source[][] = [[], []];
    for (const i of [0, 1] as const) {
      const n = (i + 1) as 1 | 2;
      const f = eng[i];
      const p0 = engineBleedSource(f.core.n2, f.core.lit);
      const pb = pbIn(sim, `AIR_ENG${n}_BLEED`);
      const apuClose = this.apuValve && (n === 1 || xOpen);
      const startClose = f.startValvePos > 0.05;
      // BMC protections: over-pressure (> 57 psi for 5 s) / over-temperature (> 257 °C for 55 s) / leak.
      const op = this.overPress[i].update(this.prvPos[i] > 0.5 && this.press[i] > 57, dt);
      const ot = this.overTemp[i].update(this.prvPos[i] > 0.5 && this.temp[i] > 257, dt);
      if (bmcOk && (op || ot || this.failLeak[i])) this.engFault[i] = true;
      // Fault reset: pb cycled OFF then ON (and the condition gone).
      if (!pb && !this.failLeak[i]) this.engFault[i] = false;
      const cmdOpen = pb && dcOk && !fireReleased(sim, n) && !apuClose && !startClose && !this.engFault[i];
      const pneu = p0 > 8;
      const target = cmdOpen && pneu ? 1 : 0;
      this.prvPos[i] = lag(this.prvPos[i], target, 0.6, dt);
      if (Math.abs(this.prvPos[i] - target) < 0.01) this.prvPos[i] = target;
      this.hpOpen[i] = this.prvPos[i] > 0.5 && f.core.n2 >= 20 && f.core.n2 < 78;
      if (this.prvPos[i] > 0.05) src[i].push({ p0: p0 * this.prvPos[i], r: ENG_R, reg: PRV_SETPOINT + 0.3 * (n - 1.5) });
    }
    if (this.apuValve && this.apuPress > 0) src[0].push({ p0: this.apuPress, r: APU_R, reg: 1e9 });
    if (this.cart) src[0].push({ p0: 48, r: CART_R, reg: 1e9 });

    /* ---------------- consumers ---------------- */
    const cons: Consumer[][] = [[], []];
    for (const i of [0, 1] as const) {
      if (this.packDemand[i] > 0) cons[i].push({ q: this.packDemand[i], pMin: 12 });
      if (eng[i].startValvePos > 0.02) cons[i].push({ q: 0, pMin: 1, g: STARTER_G * eng[i].startValvePos });
      if (this.waiDemand[i] > 0) cons[i].push({ q: this.waiDemand[i], pMin: 15 });
      if (this.failLeak[i]) cons[i].push({ q: 0.3, pMin: 10 });
    }

    /* ---------------- solve ---------------- */
    let pTarget: [number, number];
    let qd: [number, number];
    if (xOpen) {
      const r = solveNode([...src[0], ...src[1]], [...cons[0], ...cons[1]]);
      pTarget = [r.p, r.p];
      qd = [r.q, r.q];
    } else {
      const a = solveNode(src[0], cons[0]);
      const b = solveNode(src[1], cons[1]);
      pTarget = [a.p, b.p];
      qd = [a.q, b.q];
    }
    for (const i of [0, 1] as const) {
      // Transient dip when the demand jumps (sources' regulation response).
      this.demandLag[i] = lag(this.demandLag[i], qd[i], 6, dt);
      if (pTarget[i] > 0) pTarget[i] = Math.max(0, pTarget[i] - TRANSIENT_K * Math.max(0, qd[i] - this.demandLag[i]));
    }
    for (const i of [0, 1] as const) {
      const demand = cons[i].length > 0 || (xOpen && cons[1 - i].length > 0);
      const tau = pTarget[i] > this.press[i] ? 0.6 : demand ? 1.2 : 12;
      this.press[i] = Math.max(0, lag(this.press[i], pTarget[i], tau, dt));
      if (this.press[i] < 0.05 && pTarget[i] === 0) this.press[i] = 0;
    }

    /* ---------------- temperatures (sensor downstream of the precooler) ---------------- */
    for (const i of [0, 1] as const) {
      const f = eng[i];
      let wSum = 0;
      let tSum = 0;
      if (this.prvPos[i] > 0.05) { const w = this.prvPos[i]; wSum += w; tSum += w * engineBleedTemp(f.core.n2, t); }
      const apuSide = i === 0 || xOpen;
      if (this.apuValve && apuSide) { wSum += 1; tSum += 150 + 0.6 * t; }
      if (this.cart && apuSide) { wSum += 1; tSum += 175; }
      if (xOpen && this.prvPos[1 - i] > 0.05) { const w = this.prvPos[1 - i] * 0.8; wSum += w; tSum += w * engineBleedTemp(eng[1 - i].core.n2, t); }
      const target = wSum > 0 ? tSum / wSum : t;
      const flowing = wSum > 0 && this.press[i] > 5;
      this.temp[i] = lag(this.temp[i], target, flowing ? 18 : 420, dt);
    }
  }

  /** Normal bleed extraction of engine n as a fraction of the normal demand (for the engine model). */
  bleedLoad(i: 0 | 1): number {
    return this.prvPos[i] > 0.5 ? clamp((this.packDemand[i] + (this.xbleedPos > 0.5 ? this.packDemand[1 - i] * 0.5 : 0)) / 0.45, 0, 1.5) : 0;
  }

  publish(sim: Sim): void {
    sim.set('S:BLEED_ENG1_VALVE', this.prvPos[0] > 0.5 ? 1 : 0);
    sim.set('S:BLEED_ENG2_VALVE', this.prvPos[1] > 0.5 ? 1 : 0);
    sim.set('S:BLEED_ENG1_HP_VALVE', this.hpOpen[0] ? 1 : 0);
    sim.set('S:BLEED_ENG2_HP_VALVE', this.hpOpen[1] ? 1 : 0);
    sim.set('S:BLEED_ENG1_PRV_POS', Math.round(this.prvPos[0] * 100) / 100);
    sim.set('S:BLEED_ENG2_PRV_POS', Math.round(this.prvPos[1] * 100) / 100);
    sim.set('S:BLEED_XBLEED_VALVE', this.xbleedPos > 0.5 ? 1 : 0);
    sim.set('S:BLEED_XBLEED_POS', Math.round(this.xbleedPos * 100) / 100);
    sim.set('S:BLEED_PRESS_1', Math.round(this.press[0] * 10) / 10);
    sim.set('S:BLEED_PRESS_2', Math.round(this.press[1] * 10) / 10);
    sim.set('S:BLEED_TEMP_1', Math.round(this.temp[0] * 10) / 10);
    sim.set('S:BLEED_TEMP_2', Math.round(this.temp[1] * 10) / 10);
    sim.set('S:BLEED_ENG1_FAULT', this.engFault[0] ? 1 : 0);
    sim.set('S:BLEED_ENG2_FAULT', this.engFault[1] ? 1 : 0);
    sim.set('S:BLEED_APU_LEAK', this.apuLeak ? 1 : 0);
    sim.set('S:BLEED_GND_HP_AIR', this.cart ? 1 : 0);
  }
}
