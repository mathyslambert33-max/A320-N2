/**
 * 23 Ah Ni-Cd aircraft battery (20 cells, 24 V nominal) — phenomenological model.
 *
 * Terminal voltage  V = OCV(soc) + vs + vp + I·R
 *   OCV(soc)  open-circuit voltage: ≈ 25.7-25.9 V for a battery left overnight at ~70-80 % charge,
 *             26.2 V full; collapses below ~10 % charge.
 *   vs ≥ 0    "surface charge" built while charging (up to ~2.3 V): makes the charging current decay
 *             from ~40 A to < 4 A in ~10-20 min and gives the typical 27-28 V reading right after a
 *             charge, decaying slowly at rest (τ ≈ 1 h).
 *   vp ≤ 0    fast discharge polarisation (τ ≈ 40 s): voltage keeps sagging a little under a steady load.
 *   R         internal + cabling resistance: 0.018 Ω on discharge (APU start ≈ 300 A per battery →
 *             ≈ 20 V), 0.06 Ω on charge (limits the initial charging current to ~40 A).
 * Current sign: + charge, − discharge.
 */
export class Battery {
  static readonly CAPACITY_AH = 23;
  static readonly R_DIS = 0.018;
  static readonly R_CHG = 0.06;
  /** State of charge 0..1. */
  soc: number;
  vs = 0;
  vp = 0;
  current = 0;
  voltage = 0;
  /** Integrates |charge current| rate-of-change for the BAT FAULT (thermal runaway) monitor. */
  fault = false;

  constructor(soc: number) {
    this.soc = soc;
    this.voltage = this.emf();
  }

  ocv(): number {
    const s = this.soc;
    if (s <= 0) return 0;
    if (s < 0.1) return 24.76 * Math.pow(s / 0.1, 0.3);
    return 24.6 + 1.6 * s;
  }

  /** Internal EMF seen from the terminals (V). */
  emf(): number {
    const o = this.ocv();
    return o <= 0 ? 0 : Math.max(0, o + this.vs + this.vp);
  }

  /** Current (A, + charge) the battery would take at terminal voltage v. */
  currentAt(v: number): number {
    const e = this.emf();
    if (e <= 0 && v <= 0) return 0;
    return v > e ? (v - e) / Battery.R_CHG : (v - e) / Battery.R_DIS;
  }

  /** Terminal voltage for a given current (A, + charge). */
  voltageAt(i: number): number {
    const e = this.emf();
    if (e <= 0) return i > 0 ? i * Battery.R_CHG : 0;
    return e + i * (i > 0 ? Battery.R_CHG : Battery.R_DIS);
  }

  /** Integrate the internal states with the current actually flowing this step. */
  step(i: number, dt: number): void {
    this.current = i;
    // Coulomb counting (charge efficiency ~ 85 % for Ni-Cd, falls near full charge).
    const eff = i > 0 ? 0.85 * (1 - Math.max(0, this.soc - 0.9) * 6) : 1;
    this.soc = Math.min(1, Math.max(0, this.soc + (i * Math.max(0.05, eff) * dt) / 3600 / Battery.CAPACITY_AH));
    // Surface charge: builds with charge current, consumed quickly by discharge, leaks at rest.
    if (i > 0) this.vs += i * 0.00025 * dt;
    else this.vs += i * 0.0006 * dt;
    this.vs -= (this.vs / 3600) * dt;
    this.vs = Math.min(2.6, Math.max(0, this.vs));
    // Fast polarisation under discharge.
    const vpTarget = i < 0 ? Math.max(-1.5, i * 0.004) : 0;
    this.vp += (vpTarget - this.vp) * (1 - Math.exp(-dt / 40));
    this.voltage = this.voltageAt(i);
  }
}
