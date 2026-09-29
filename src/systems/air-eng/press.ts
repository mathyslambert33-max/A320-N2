/**
 * Cabin pressurisation (A320 FCOM DSC-21-30): two Cabin Pressure Controllers (CPC 1 active / CPC 2
 * standby, alternating at each landing or on failure of the active one), one outflow valve (3 motors:
 * 2 auto, 1 manual), two safety valves, MODE SEL AUTO/MAN, MAN V/S CTL, LDG ELEV AUTO/manual, DITCHING.
 *
 * Physics: cabin air mass balance (pressurised volume ≈ 330 m³), inflow = packs (+ ram air), outflow =
 * outflow valve (area ∝ opening^1.3) + structural leakage + safety valves (relief at Δp 8.6 psi,
 * negative relief at −0.5 psi). Cabin V/S follows from dP/dt.
 * AUTO: on ground the outflow valve is fully open; at take-off power on ground the CPC pre-pressurises
 * (−400 ft/min cabin rate to Δp 0.1 psi); in flight it follows a simple schedule (max Δp 8.06 psi,
 * cabin rate ≤ +1000 / −750 ft/min, landing elevation from the FMGS in LDG ELEV AUTO).
 * MAN (MODE SEL pb released): CPCs out of the loop, MAN V/S CTL toggles drive the outflow valve with
 * the manual motor (full travel ≈ 25 s).
 * DITCHING ON (AUTO): outflow valve closes (plus avionics vent valves, pack valves, ram air — other files).
 * MODE SEL FAULT light: both CPCs failed/unpowered (with the annunciators powered).
 */
import type { Sim } from '../../core/sim';
import {
  altAtPressure, ambientPressure, clamp, clamp01, dc2, dcBat, dcEss, HPA_TO_PSI, lag, onGround, pbIn,
} from './common';

const VOL = 330; // m³
const R_AIR = 287;
const T_CAB = 295;
const OV_AREA = 0.11; // m² fully open
const LEAK_AREA = 0.0035;
const SAFETY_AREA = 0.05;
const CD = 0.7;

/** Mass flow (kg/s) through an orifice for a pressure difference dp (Pa, + = outwards). */
function orifice(area: number, dp: number, rho: number): number {
  const lin = 60; // linearise below 60 Pa (numerical stability near Δp = 0)
  const a = Math.abs(dp);
  const q = a < lin ? CD * area * Math.sqrt(2 * rho * lin) * (a / lin) : CD * area * Math.sqrt(2 * rho * a);
  return Math.sign(dp) * q;
}

export class PressModel {
  /** Cabin pressure (hPa). */
  pCab: number;
  ov = 1;
  vs = 0;
  private vsRaw = 0;
  activeSys: 1 | 2 = 1;
  cpcOk: [boolean, boolean] = [false, false];
  safetyOpen = false;
  man = false;
  ldgElev = 291;
  ldgElevAuto = true;
  /** Cabin altitude target (flight). */
  private tgtAlt = 0;
  private integ = 0;
  private wasGround = true;
  private landedFor = 0;

  constructor(sim: Sim) {
    this.pCab = ambientPressure(sim);
  }

  get deltaPsi(): number { return this.lastDp; }
  private lastDp = 0;

  update(sim: Sim, dt: number, inflowKg: number, ditching: boolean, toPower: boolean): void {
    const gnd = onGround(sim);
    const pAmb = ambientPressure(sim);

    /* ---------------- controllers ---------------- */
    this.cpcOk = [dcEss(sim) || dcBat(sim), dc2(sim)];
    // Transfer at each landing (70 s after touchdown) and on failure of the active CPC.
    if (gnd && !this.wasGround) this.landedFor = 0;
    if (gnd) {
      this.landedFor += dt;
      if (this.landedFor >= 70 && this.landedFor - dt < 70) this.activeSys = this.activeSys === 1 ? 2 : 1;
    }
    this.wasGround = gnd;
    if (!this.cpcOk[this.activeSys - 1] && this.cpcOk[2 - this.activeSys]) this.activeSys = this.activeSys === 1 ? 2 : 1;
    const auto = pbIn(sim, 'PRESS_MODE_SEL');
    this.man = !auto;
    const cpc = this.cpcOk[0] || this.cpcOk[1];

    // Landing elevation: AUTO → FMGS destination (LFPO 291 ft if the FMGS has none), else the knob.
    const knob = Math.round(sim.get('C:PRESS_LDG_ELEV'));
    this.ldgElevAuto = knob === 0;
    if (this.ldgElevAuto) this.ldgElev = sim.has('S:FMGS_DEST_ELEV') && sim.get('S:FMGS_DEST_ELEV') !== 0 ? sim.get('S:FMGS_DEST_ELEV') : 291;
    else this.ldgElev = (knob - 3) * 1000;

    const cabAlt = altAtPressure(this.pCab);
    const dpPsi = (this.pCab - pAmb) * HPA_TO_PSI;
    if (auto) {
      if (cpc) {
        let ovCmd = this.ov;
        if (ditching) ovCmd = 0;
        else if (gnd && !toPower) { ovCmd = 1; this.integ = 0; }
        else {
          // Target cabin V/S (ft/min).
          let vsCmd: number;
          if (gnd) {
            // Take-off pre-pressurisation: Δp 0.1 psi at −400 ft/min.
            vsCmd = dpPsi < 0.1 ? -400 : 0;
          } else {
            const maxDpAlt = altAtPressure(pAmb + 8.06 / HPA_TO_PSI);
            const vsAc = sim.get('S:ADIRS_VS');
            const ref = vsAc < -300 ? this.ldgElev : Math.max(this.ldgElev, maxDpAlt);
            this.tgtAlt = Math.max(ref, maxDpAlt, -1000);
            vsCmd = clamp((this.tgtAlt - cabAlt) * 0.25, -750, 1000);
          }
          // Outflow valve PI on the cabin V/S error: more cabin climb → open.
          const err = (vsCmd - this.vsRaw) / 1000;
          this.integ = clamp(this.integ + err * 0.08 * dt, -1, 1);
          ovCmd = clamp01(this.ov + (err * 0.15 + this.integ * 0.05) * dt * 3);
          ovCmd = clamp01(ovCmd);
        }
        // Auto motors: full travel ≈ 6 s.
        this.ov = this.ov + clamp(ovCmd - this.ov, -dt / 6, dt / 6);
      }
    } else {
      // Manual motor driven by MAN V/S CTL (UP = open / cabin climbs, DN = close).
      const sw = Math.round(sim.has('C:PRESS_MAN_VS') ? sim.get('C:PRESS_MAN_VS') : 1);
      if (dcEss(sim) || dcBat(sim) || dc2(sim)) {
        if (sw === 0) this.ov = clamp01(this.ov + dt / 25);
        else if (sw === 2) this.ov = clamp01(this.ov - dt / 25);
      }
    }

    /* ---------------- physics (sub-stepped) ---------------- */
    const steps = 4;
    const h = dt / steps;
    let pPa = this.pCab * 100;
    const pAmbPa = pAmb * 100;
    const p0 = pPa;
    for (let k = 0; k < steps; k++) {
      const dp = pPa - pAmbPa;
      const rho = pPa / (R_AIR * T_CAB);
      const ovArea = OV_AREA * Math.pow(this.ov, 1.3);
      let out = orifice(ovArea + LEAK_AREA, dp, rho);
      const dpPsiNow = dp / 100 * HPA_TO_PSI;
      this.safetyOpen = dpPsiNow > 8.6 || dpPsiNow < -0.5;
      if (this.safetyOpen) out += orifice(SAFETY_AREA, dp, rho);
      const dm = inflowKg - out;
      pPa += (dm * R_AIR * T_CAB / VOL) * h;
    }
    this.pCab = pPa / 100;
    const dPdt = (pPa - p0) / dt; // Pa/s
    const rhoCab = pPa / (R_AIR * T_CAB);
    this.vsRaw = (-dPdt / (rhoCab * 9.80665)) * 3.28084 * 60;
    this.vs = lag(this.vs, this.vsRaw, 1.5, dt);
    this.lastDp = (this.pCab - pAmb) * HPA_TO_PSI;
  }

  publish(sim: Sim): void {
    const cabAlt = altAtPressure(this.pCab);
    sim.set('S:PRESS_CAB_ALT', Math.round(cabAlt));
    sim.set('S:PRESS_CAB_VS', Math.round(this.vs));
    sim.set('S:PRESS_DELTA_P', Math.round(this.lastDp * 100) / 100);
    sim.set('S:PRESS_OUTFLOW', Math.round(this.ov * 1000) / 1000);
    sim.set('S:PRESS_SAFETY_VALVE', this.safetyOpen ? 1 : 0);
    sim.set('S:PRESS_ACTIVE_SYS', this.activeSys);
    sim.set('S:PRESS_LDG_ELEV', Math.round(this.ldgElev));
    sim.set('S:PRESS_LDG_ELEV_AUTO', this.ldgElevAuto ? 1 : 0);
    sim.set('S:PRESS_MAN', this.man ? 1 : 0);
    sim.set('S:PRESS_CPC1_FAULT', this.cpcOk[0] ? 0 : 1);
    sim.set('S:PRESS_CPC2_FAULT', this.cpcOk[1] ? 0 : 1);
    sim.set('S:PRESS_CAB_PRESS_HPA', Math.round(this.pCab * 10) / 10);
  }
}
