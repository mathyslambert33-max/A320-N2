/**
 * CFM56-5B4/P thermodynamic "core" model (per engine): spool dynamics, EGT, fuel flow, N1, oil,
 * vibrations, nacelle temperature, thrust. Sequencing (start valve, igniters, HP fuel valve,
 * protections) is done by the FADEC (fadec.ts) which drives the inputs of this model.
 *
 * Model
 * -----
 * The HP spool (N2, %) is integrated from an acceleration balance (in %N2/s):
 *
 *   dN2/dt = starter(N2, p) + combustion - drag(N2)
 *
 *  - starter: air turbine starter, torque ∝ (duct pressure − 5 psi) and falling linearly with speed
 *    (zero at ~62 % N2). With 30 psi at the start valve the maximum motoring speed is ~26 % N2,
 *    ~30 % with 40 psi (CFM56-5B values: 22 % needed for fuel, "max motoring ≥ 20 %" in the manual
 *    start procedure).
 *  - drag: compressor windage + friction, ≈ 6.7 %/s at ground idle (this is what the idle fuel flow
 *    has to balance) → realistic spool-down (≈ 7 s from idle to 30 %, then a long tail).
 *  - combustion: the FADEC meters fuel to follow an N2 acceleration schedule during the start and an
 *    N2 command (from the N1 command) when running. The "load ratio" (combustion effort compared to a
 *    nominal start with 30 psi) drives the start EGT: weak start air → hotter start → possible hung
 *    start / EGT over-limit, like the real engine.
 *
 * All steady-state relations are expressed in corrected parameters (θ = T/288.15, δ = P/1013.25):
 * N1c = N1/√θ, N2c = N2/√θ, EGT = (EGTc + 273.15)·θ − 273.15, FF = FFc·δ·√θ.
 * Values calibrated to published/observed A320 CFM56-5B figures: ground idle N1 ≈ 19.5 %, N2 ≈ 58.5-59 %,
 * EGT ≈ 400 °C, FF ≈ 280-300 kg/h (ISA SL); TOGA SL ISA ≈ 84.5-85.5 % N1, EGT ≈ 770-800 °C,
 * FF ≈ 3300-3500 kg/h; red lines N1 104 %, N2 105 %, EGT 950 °C (725 °C start).
 */
import { clamp, clamp01, interp, interpInv, lag, smoothstep } from './common';

/** Steady-state corrected N1 → corrected N2 (%), CFM56-5B, ground. */
export const N1C_TO_N2C: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [3, 22], [6, 33], [10, 43], [15, 52], [19.4, 58.6], [25, 65.5], [30, 70.5], [40, 78], [50, 83],
  [60, 86.8], [70, 90], [80, 93], [85, 94.5], [90, 96], [95, 97.6], [100, 99.3], [105, 101],
];
/** Corrected EGT (°C at ISA) vs corrected N1 (bleed off). */
const EGTC: ReadonlyArray<readonly [number, number]> = [
  [19.4, 388], [25, 425], [30, 455], [40, 505], [50, 555], [60, 610], [70, 668], [80, 728], [85, 762],
  [90, 800], [95, 840], [100, 882], [105, 925],
];
/** Corrected fuel flow (kg/h) vs corrected N1 (bleed off, static). */
const FFC: ReadonlyArray<readonly [number, number]> = [
  [19.4, 285], [25, 370], [30, 470], [40, 720], [50, 1080], [60, 1520], [70, 2100], [80, 2860], [85, 3310],
  [90, 3820], [95, 4380], [100, 5000], [105, 5650],
];
/** Start: EGT rise shape (× idle EGT rise) vs N2/idleN2 (lit). Peak ≈ 1.42 at ~70 % of idle N2 (≈ 560 °C at 19 °C OAT). */
const START_EGT: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0.22], [0.35, 0.42], [0.42, 0.64], [0.5, 0.95], [0.6, 1.25], [0.7, 1.42], [0.8, 1.35], [0.88, 1.2],
  [0.95, 1.07], [1.0, 1.0],
];
/** Start: fuel flow (× idle FF) vs N2/idleN2. Light-off flow ≈ 70 % of idle (≈ 190-200 kg/h). */
const START_FF: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0.68], [0.37, 0.7], [0.45, 0.72], [0.55, 0.78], [0.65, 0.86], [0.75, 0.96], [0.85, 1.06], [0.93, 1.1],
  [1.0, 1.0],
];
/** Start: N1 (× idle N1) vs N2/idleN2 (lit). */
const START_N1: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.2, 0.012], [0.3, 0.045], [0.37, 0.1], [0.45, 0.17], [0.55, 0.28], [0.65, 0.41], [0.75, 0.55],
  [0.85, 0.71], [0.93, 0.86], [1.0, 1.0],
];

/** Starter free-run speed (% N2) and scaling. */
const STARTER_K = 3.0;
const STARTER_FREE = 62;
/** Start valve needs this upstream pressure to open (pneumatically actuated, psi). */
export const START_VALVE_MIN_PSI = 6;

export function starterAccel(n2: number, psi: number, valve: number): number {
  const s = clamp((psi - 5) / 25, 0, 1.5);
  return STARTER_K * s * valve * Math.max(0, 1 - n2 / STARTER_FREE);
}
export function dragDecel(n2: number): number {
  if (n2 <= 0) return 0;
  return 0.04 + 0.03 * n2 + 0.00142 * n2 * n2;
}
/** FADEC start acceleration schedule (%N2/s). */
export function startAccelSchedule(n2: number, idleN2: number): number {
  const sched = interp([[18, 0.8], [24, 0.9], [30, 1.25], [36, 1.6], [70, 1.6]], n2);
  return Math.max(0.05, Math.min(sched, 0.28 * (idleN2 + 0.5 - n2)));
}
/** Nominal combustion effort during a start (30 psi start air). */
export function nominalStartCombustion(n2: number, idleN2: number): number {
  const s = n2 < 50 ? starterAccel(n2, 30, 1) : 0;
  return Math.max(0.25, startAccelSchedule(n2, idleN2) - s + dragDecel(n2));
}

export interface EngineConstants {
  /** Engine-to-engine spread (deterministic). */
  n2Offset: number;
  egtOffset: number;
  ffOffset: number;
  oilQtyBase: number;
  oilPressOffset: number;
  vibFactor: number;
}

export interface EngineInputs {
  dt: number;
  oat: number;
  /** Ambient pressure hPa. */
  pAmb: number;
  mach: number;
  onGround: boolean;
  /** Start valve position 0..1 and duct pressure at the starter (psi). */
  startValve: number;
  ductPsi: number;
  /** Fuel metered into the combustor (HP valve open, LP open, fuel pressure). */
  fuelOn: boolean;
  /** Spark present (an igniter energised and powered). */
  spark: boolean;
  /** Both igniters (faster, surer light-off). */
  bothIgniters: boolean;
  /** Running governor N2 command (%), used when running. */
  n2Cmd: number;
  /** Start fuel schedule factor (reduced after a hot start / stall). */
  fuelSchedFactor: number;
  /** Starting sequence in progress (FADEC start schedule instead of governor). */
  starting: boolean;
  /** Bleed extraction (fraction 0..~1.5 of normal pack demand) + anti-ice. */
  bleedLoad: number;
  naiOn: boolean;
  waiOn: boolean;
  /** Stall injection (compressor stall during start). */
  stall: boolean;
  /** Rich start injection (hot start). */
  rich: boolean;
  /** Light-off delay for this attempt (s). */
  lightOffDelay: number;
  /** Reverser deployed fraction 0..1 (for thrust sign). */
  rev: number;
}

/**
 * Per-engine physical state.
 */
export class EngineCore {
  n1 = 0;
  n2 = 0;
  egt: number;
  ff = 0;
  n2Dot = 0;
  lit = false;
  /** Time with fuel + spark but not yet lit (s). */
  lightOffTimer = 0;
  /** Time fuel has been on without light (s) — FADEC no-light detection. */
  fuelNoLightTimer = 0;
  /** Starvation timer (fuel lost while lit). */
  starveTimer = 0;
  loadRatio = 1;
  oilTemp: number;
  oilPress = 0;
  oilQty: number;
  gulp = 0;
  vibN1 = 0;
  vibN2 = 0;
  nacTemp: number;
  thrustKn = 0;
  /** Idle targets computed each tick. */
  idleN2 = 58.6;
  idleN1 = 19.4;
  idleEgt = 400;
  idleFf = 280;
  /** Residual heat of the core (0..1) used for hot restarts / nacelle heat soak. */
  heat = 0;
  private vibPhase = 0;

  constructor(readonly n: 1 | 2, readonly k: EngineConstants, oatC: number) {
    this.egt = oatC;
    this.oilTemp = oatC;
    this.oilQty = k.oilQtyBase;
    this.nacTemp = oatC;
  }

  /** Corrected helpers. */
  static theta(oat: number) { return (oat + 273.15) / 288.15; }

  /** Steady-state N2 (%) for an N1 command (%). */
  n2ForN1(n1: number, oat: number): number {
    const s = Math.sqrt(EngineCore.theta(oat));
    return interp(N1C_TO_N2C, n1 / s) * s;
  }
  /** Steady-state N1 (%) for an N2 (%). */
  n1ForN2(n2: number, oat: number): number {
    const s = Math.sqrt(EngineCore.theta(oat));
    return interpInv(N1C_TO_N2C, n2 / s) * s;
  }

  /** Compute the idle targets for the current conditions. */
  computeIdle(i: Pick<EngineInputs, 'oat' | 'pAmb' | 'onGround' | 'bleedLoad' | 'naiOn' | 'waiOn'>): void {
    const th = EngineCore.theta(i.oat);
    const s = Math.sqrt(th);
    const delta = i.pAmb / 1013.25;
    // Ground idle N2c 58.6 %; flight idle higher (modulated idle); bleed / anti-ice raise idle slightly.
    let n2c = i.onGround ? 58.6 : 66;
    n2c += 0.25 * clamp(i.bleedLoad, 0, 1.5) + (i.naiOn ? 1.2 : 0) + (i.waiOn ? 1.0 : 0);
    this.idleN2 = n2c * s + this.k.n2Offset;
    this.idleN1 = interpInv(N1C_TO_N2C, n2c) * s;
    this.idleEgt = this.steadyEgt(this.idleN1, i.oat, i.bleedLoad, i.naiOn, i.waiOn);
    this.idleFf = this.steadyFf(this.idleN1, i.oat, delta, i.bleedLoad, i.naiOn, i.waiOn);
  }

  steadyEgt(n1: number, oat: number, bleedLoad: number, nai: boolean, wai: boolean): number {
    const th = EngineCore.theta(oat);
    const n1c = n1 / Math.sqrt(th);
    const lowPwr = 1 - smoothstep(30, 80, n1c) * 0.5;
    const bleed = (10 * clamp(bleedLoad, 0, 1.5) + (nai ? 12 : 0) + (wai ? 14 : 0)) * lowPwr;
    return (interp(EGTC, n1c) + 273.15) * th - 273.15 + bleed + this.k.egtOffset;
  }

  steadyFf(n1: number, oat: number, delta: number, bleedLoad: number, nai: boolean, wai: boolean): number {
    const th = EngineCore.theta(oat);
    const n1c = n1 / Math.sqrt(th);
    const bleedFrac = 0.03 * clamp(bleedLoad, 0, 1.5) + (nai ? 0.025 : 0) + (wai ? 0.035 : 0);
    return interp(FFC, n1c) * delta * Math.sqrt(th) * (1 + bleedFrac * (1 - smoothstep(40, 90, n1c) * 0.6)) + this.k.ffOffset;
  }

  update(i: EngineInputs): void {
    const dt = i.dt;
    this.computeIdle(i);
    const idleN2 = this.idleN2;
    const n2 = this.n2;

    /* ---------------- combustion state ---------------- */
    if (i.fuelOn && !this.lit) {
      this.fuelNoLightTimer += dt;
      // Light-off needs fuel, a spark, and enough airflow through the core.
      if (i.spark && n2 >= 11) {
        this.lightOffTimer += dt;
        const delay = i.bothIgniters ? i.lightOffDelay * 0.8 : i.lightOffDelay;
        if (this.lightOffTimer >= delay) {
          this.lit = true;
          this.lightOffTimer = 0;
        }
      }
    } else {
      this.lightOffTimer = 0;
      if (!i.fuelOn) this.fuelNoLightTimer = 0;
    }
    if (this.lit) {
      this.fuelNoLightTimer = 0;
      if (!i.fuelOn) {
        // HP valve closed or fuel starvation: flame-out after the fuel in the lines is burnt.
        this.starveTimer += dt;
        if (this.starveTimer > 0.6) this.lit = false;
      } else this.starveTimer = 0;
      if (n2 < 8) this.lit = false; // rich/lean blow-out at very low airflow
    } else this.starveTimer = 0;

    /* ---------------- HP spool ---------------- */
    const starter = starterAccel(n2, i.ductPsi, i.startValve);
    const drag = dragDecel(n2);
    let comb = 0;
    let load = 1;
    if (this.lit) {
      if (i.starting) {
        const nom = nominalStartCombustion(n2, idleN2);
        const req = startAccelSchedule(n2, idleN2) - starter + drag;
        const max = (1.5 * nom + 0.3) * i.fuelSchedFactor * (i.rich ? 1.25 : 1);
        comb = clamp(req, 0, max);
        if (i.rich && n2 < idleN2 - 1) comb = Math.max(comb, Math.min(max, nom * 1.15));
        if (i.stall && n2 > 28) comb *= 0.35; // stalled compressor: no acceleration, very hot
        load = comb / nom;
        // Over-rich schedule (hot start): excess fuel burns in the turbine without useful work; the
        // FADEC's reduced schedule on the recycle (fuelSchedFactor) cures it.
        if (i.rich) load *= 1.6 * i.fuelSchedFactor * i.fuelSchedFactor;
        if (i.stall && n2 > 28) load = 2.0;
      } else {
        // Governor: N2 follows the command with the FADEC acceleration / deceleration limits.
        const amax = 3.5 + 0.32 * Math.max(0, n2 - 58);
        const dmax = 2 + 0.12 * Math.max(0, n2 - 58);
        const want = clamp(1.4 * (i.n2Cmd - n2), -dmax, amax);
        comb = Math.max(0.2, want + drag - starter);
        load = 1;
      }
    }
    this.loadRatio = lag(this.loadRatio, load, 0.8, dt);
    let dn2 = starter + comb - drag;
    this.n2 = clamp(n2 + dn2 * dt, 0, 120);
    if (this.n2 === 0) dn2 = 0;
    this.n2Dot = lag(this.n2Dot, dn2, 0.3, dt);

    /* ---------------- N1 (fan) ---------------- */
    const x = this.n2 / Math.max(1, idleN2);
    let n1Target: number;
    if (this.lit && !i.starting && this.n2 >= idleN2 - 2) n1Target = this.n1ForN2(this.n2, i.oat);
    else {
      n1Target = interp(START_N1, x) * this.idleN1;
      if (!this.lit) n1Target *= 0.7; // unlit: fan only dragged by the core flow
      if (this.n2 >= idleN2 - 2 && this.lit) n1Target = Math.max(n1Target, this.n1ForN2(this.n2, i.oat) * smoothstep(idleN2 - 2, idleN2, this.n2));
    }
    // Windmilling in flight (ram air) keeps the fan turning.
    if (!i.onGround && i.mach > 0.1) n1Target = Math.max(n1Target, 25 * i.mach);
    const fanTau = n1Target > this.n1 ? (this.lit ? 0.6 : 2.0) : (this.lit ? 0.8 : 4.0);
    this.n1 = Math.max(0, lag(this.n1, n1Target, fanTau, dt));

    /* ---------------- EGT ---------------- */
    const delta = i.pAmb / 1013.25;
    let egtTarget: number;
    if (this.lit) {
      if (i.starting || this.n2 < idleN2 - 1.5) {
        const rise = Math.max(60, this.idleEgt - i.oat);
        egtTarget = i.oat + rise * interp(START_EGT, x) * (0.55 + 0.45 * clamp(this.loadRatio, 0, 3));
        // A still-hot core (quick restart) starts hotter.
        egtTarget += 60 * this.heat;
      } else {
        egtTarget = this.steadyEgt(this.n1, i.oat, i.bleedLoad, i.naiOn, i.waiOn) + 5 * Math.max(0, this.n2Dot);
      }
      const tau = egtTarget > this.egt ? (i.starting ? 1.6 : 2.4) : 3.0;
      this.egt = lag(this.egt, egtTarget, tau, dt);
    } else {
      // Cooling: fast while air is pumped through the core (spool-down / motoring), then slow natural cooling.
      const tau = this.n2 > 30 ? 15 : this.n2 > 10 ? 40 : 300;
      this.egt = lag(this.egt, i.oat, tau, dt);
    }

    /* ---------------- fuel flow ---------------- */
    let ffTarget = 0;
    if (i.fuelOn) {
      if (!this.lit) ffTarget = this.idleFf * 0.7 * i.fuelSchedFactor;
      else if (i.starting || this.n2 < idleN2 - 1.5) {
        ffTarget = this.idleFf * interp(START_FF, x) * Math.pow(clamp(this.loadRatio, 0.3, 3), 0.7);
      } else {
        ffTarget = this.steadyFf(this.n1, i.oat, delta, i.bleedLoad, i.naiOn, i.waiOn) + 55 * this.n2Dot;
        ffTarget = Math.max(ffTarget, this.idleFf * 0.6);
      }
    }
    this.ff = Math.max(0, lag(this.ff, ffTarget, i.fuelOn ? 0.45 : 0.15, dt));

    /* ---------------- core heat (for restarts & nacelle soak) ---------------- */
    if (this.lit) this.heat = lag(this.heat, 1, 30, dt);
    else this.heat = lag(this.heat, 0, this.n2 > 15 ? 40 : 900, dt);

    /* ---------------- oil ---------------- */
    // Pressure: engine-driven pump ∝ N2 (≈ 35 psi at idle, 85-90 psi at take-off), + cold-oil viscosity.
    const visc = 1 + clamp((50 - this.oilTemp) / 150, 0, 0.15);
    const pTarget = this.n2 < 5 ? 0 : Math.max(0, (-0.9 + 0.237 * this.n2 + 0.00682 * this.n2 * this.n2) * visc + this.k.oilPressOffset * clamp01(this.n2 / 50));
    this.oilPress = lag(this.oilPress, pTarget, 0.8, dt);
    // Temperature: warms up over ~10 min at idle (≈ 75-80 °C), higher at power; cools slowly when stopped.
    const pwr = clamp01((this.n2 - 55) / 45);
    const tEq = this.lit ? 72 + 45 * pwr + 0.2 * (i.oat - 15) : i.oat + 25 * this.heat;
    const oilTau = this.lit ? (this.oilTemp < tEq ? 420 : 300) : 1500;
    this.oilTemp = lag(this.oilTemp, tEq, oilTau, dt);
    // Quantity: "gulping" (oil held in the sumps/lines) ≈ 3 qt at idle, ≈ 5 qt at T/O; returns slowly after shutdown.
    const gulpTarget = this.n2 < 8 ? 0 : 3.1 * Math.pow(clamp(this.n2 / 59, 0, 1.8), 1.3);
    this.gulp = lag(this.gulp, gulpTarget, this.n2 > 8 ? 60 : 900, dt);
    this.oilQty = Math.max(0, this.k.oilQtyBase - this.gulp + 0.004 * (this.oilTemp - 20));

    /* ---------------- vibrations (units) ---------------- */
    this.vibPhase += dt;
    const reson = Math.exp(-Math.pow((this.n2 - 36) / 6, 2)) * (this.n2Dot > 0 ? 0.5 : 0.3);
    const vn1 = this.n1 < 2 ? 0 : (0.12 + 0.004 * this.n1 + 0.04 * Math.sin(this.vibPhase * 0.37 + this.n)) * this.k.vibFactor;
    const vn2 = this.n2 < 5 ? 0 : (0.2 + 0.006 * this.n2 + reson + 0.05 * Math.sin(this.vibPhase * 0.29 + 2 * this.n)) * this.k.vibFactor;
    this.vibN1 = lag(this.vibN1, vn1, 1.5, dt);
    this.vibN2 = lag(this.vibN2, vn2, 1.5, dt);

    /* ---------------- nacelle temperature ---------------- */
    const nacTarget = this.lit ? i.oat + 30 + 0.35 * this.n1 : i.oat + 110 * this.heat * (this.n2 < 15 ? 1 : 0.3);
    this.nacTemp = lag(this.nacTemp, nacTarget, this.lit ? 120 : 400, dt);

    /* ---------------- thrust (kN) ---------------- */
    const n1c = this.n1 / Math.sqrt(EngineCore.theta(i.oat));
    const tFrac = this.lit ? Math.pow(clamp((n1c - 12) / (84.6 - 12), 0, 1.4), 1.75) : 0;
    const gross = 120.1 * delta * tFrac * (1 - 0.35 * i.mach);
    this.thrustKn = gross * (1 - i.rev) - gross * 0.35 * i.rev;
  }
}
