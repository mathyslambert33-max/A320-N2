/**
 * Shared helpers for the sys-misc module (ADIRS, fire, F/CTL, gear, lights, misc overhead panels).
 * DOM-free: only imports src/core/*.
 *
 * Control conventions (src/core/catalog.ts):
 *  - latching pb: C = 1 pressed IN (normal, lights out), 0 released OUT.
 *  - FIRE_xxx_PB: C = 1 means RELEASED (pulled out).
 *  - toggle 'sw': index 0 = TOP position (e.g. EXTLT_BEACON ['ON','OFF'] → 0 = ON).
 *  - rotary 'rot': index 0 = most counter-clockwise (ADIRS_IRn_MODE ['OFF','NAV','ATT']).
 *  - ASKID_NWSTRG ['ON','OFF'] → C = 0 means ON; PARK_BRK ['OFF','ON'] → C = 1 means ON.
 */
import type { Sim } from '../../core/sim';

/** Electrical network as seen by sys-misc (read from sys-elec's S:ELEC_* variables, missing = 0). */
export interface Power {
  hot1: boolean;
  hot2: boolean;
  dcBat: boolean;
  dcEss: boolean;
  dcEssShed: boolean;
  dc1: boolean;
  dc2: boolean;
  acEss: boolean;
  acEssShed: boolean;
  ac1: boolean;
  ac2: boolean;
  /** Any main AC bus (AC 1 / AC 2 / AC ESS). */
  acAny: boolean;
  /** Any DC bus able to feed cockpit equipment (DC BAT / DC ESS / DC 1 / DC 2). */
  dcAny: boolean;
  /** Annunciator lights powered (DC BAT or DC ESS — as sys-elec's S:ELEC_ANN_POWER). */
  ann: boolean;
}

export function readPower(sim: Sim): Power {
  const hot1 = sim.getB('S:ELEC_HOT_BUS1');
  const hot2 = sim.getB('S:ELEC_HOT_BUS2');
  const dcBat = sim.getB('S:ELEC_DC_BAT_BUS');
  const dcEss = sim.getB('S:ELEC_DC_ESS_BUS');
  const dcEssShed = sim.getB('S:ELEC_DC_ESS_SHED');
  const dc1 = sim.getB('S:ELEC_DC1_BUS');
  const dc2 = sim.getB('S:ELEC_DC2_BUS');
  const acEss = sim.getB('S:ELEC_AC_ESS_BUS');
  const acEssShed = sim.getB('S:ELEC_AC_ESS_SHED');
  const ac1 = sim.getB('S:ELEC_AC1_BUS');
  const ac2 = sim.getB('S:ELEC_AC2_BUS');
  const ann = sim.has('S:ELEC_ANN_POWER') ? sim.getB('S:ELEC_ANN_POWER') || dcBat || dcEss : dcBat || dcEss;
  return {
    hot1, hot2, dcBat, dcEss, dcEssShed, dc1, dc2, acEss, acEssShed, ac1, ac2,
    acAny: ac1 || ac2 || acEss,
    dcAny: dcBat || dcEss || dc1 || dc2,
    ann,
  };
}

/** Per-frame context shared by the sub-systems. */
export interface Ctx {
  sim: Sim;
  dt: number;
  /** Sim time (s). */
  t: number;
  p: Power;
  onGround: boolean;
  /** Ground speed (kt). */
  gs: number;
}

/** 1 Hz annunciator flash (0.5 s on / 0.5 s off), phase-locked on sim time. */
export const flash1Hz = (t: number) => (t % 1) < 0.5;
/** 2 Hz fast flash. */
export const flash2Hz = (t: number) => (t % 0.5) < 0.25;

export const b2n = (v: boolean) => (v ? 1 : 0);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Normalise an angle to [0, 360). */
export const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** Signed angle difference a-b in (-180, 180]. */
export const angDiff = (a: number, b: number) => {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
};

/** Linear interpolation in a breakpoint table (clamped). */
export function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + (ys[i] - ys[i - 1]) * f;
    }
  }
  return ys[ys.length - 1];
}

/** Output true only after the input has been true continuously for `delay` s. */
export class DelayOn {
  private acc = 0;
  out = false;
  constructor(public delay: number) {}
  update(input: boolean, dt: number): boolean {
    this.acc = input ? this.acc + dt : 0;
    this.out = input && this.acc >= this.delay;
    return this.out;
  }
  reset(): void { this.acc = 0; this.out = false; }
}

/** Output stays true for `delay` s after the input goes false. */
export class DelayOff {
  private acc = 1e9;
  out = false;
  constructor(public delay: number) {}
  update(input: boolean, dt: number): boolean {
    this.acc = input ? 0 : this.acc + dt;
    this.out = input || this.acc < this.delay;
    return this.out;
  }
}

/** Rising-edge detector. */
export class Edge {
  private last: boolean;
  constructor(init = false) { this.last = init; }
  rise(v: boolean): boolean { const r = v && !this.last; this.last = v; return r; }
  fall(v: boolean): boolean { const r = !v && this.last; this.last = v; return r; }
}

/** Ground flag from the scenario (missing = on ground). */
export const onGroundOf = (sim: Sim) => (sim.has('G:AC_ON_GROUND') ? sim.getB('G:AC_ON_GROUND') : true);

/** Hydraulic system pressurised enough to move surfaces (same 1450 psi threshold as the ECAM). */
export const HYD_OK = 1450;
