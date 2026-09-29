/**
 * Shared helpers of the sys-air module (pneumatics, air conditioning, pressurisation, ventilation,
 * anti-ice, CFM56-5B engines & FADECs). DOM-free: only imports src/core/*.
 *
 * Control conventions (src/core/catalog.ts):
 *  - latching pb: C = 1 pressed IN (normal "lights out" / AUTO position), 0 released OUT.
 *  - ENG_MASTERn: sw ['ON','OFF'] → C = 0 means ON.
 *  - ENG_MODE: rot ['CRANK','NORM','IGN/START'] → 0 / 1 / 2.
 *  - FIRE_ENGn_PB: C = 1 means RELEASED (pulled out).
 *  - AIR_XBLEED: rot ['SHUT','AUTO','OPEN'] → 0 / 1 / 2.
 *  - PRESS_MAN_VS: swm ['UP','NEUTRAL','DN'] → 0 / 1 / 2 (spring-loaded to 1).
 *  - THR_LEVERn: TLA in degrees (-20 MAX REV, -6 REV IDLE, 0 IDLE, 25 CL, 35 FLX/MCT, 45 TOGA).
 *
 * Variables owned by other modules are read with fall-backs so the module also works alone in tests
 * (missing = 0, except where a sensible fall-back is documented).
 */
import type { Sim } from '../../core/sim';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smooth 0..1 step between e0 and e1. */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** First-order lag toward target with time constant tau (s). */
export const lag = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
/** Move cur toward target by at most rate*dt. */
export const approach = (cur: number, target: number, rate: number, dt: number) => {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
};

/** Piece-wise linear interpolation in a sorted [x, y] table (clamped at both ends). */
export function interp(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/** Inverse of `interp` for a monotonically increasing table. */
export function interpInv(table: ReadonlyArray<readonly [number, number]>, y: number): number {
  if (y <= table[0][1]) return table[0][0];
  const last = table[table.length - 1];
  if (y >= last[1]) return last[0];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (y <= y1) {
      const [x0, y0] = table[i - 1];
      return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
    }
  }
  return last[0];
}

/** Small deterministic PRNG (mulberry32) so tests are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slow random walk in [-1, 1] used for small realistic fluctuations of displayed values. */
export class Wander {
  v = 0;
  private target = 0;
  private t = 0;
  constructor(private rng: () => number, private period = 3) {}
  step(dt: number): number {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = this.period * (0.5 + this.rng());
      this.target = this.rng() * 2 - 1;
    }
    this.v += (this.target - this.v) * (1 - Math.exp(-dt / (this.period * 0.6)));
    return this.v;
  }
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
  reset(): void { this.acc = 1e9; this.out = false; }
}

/** Rising-edge detector. */
export class Edge {
  private last: boolean;
  constructor(initial = false) { this.last = initial; }
  rise(v: boolean): boolean { const r = v && !this.last; this.last = v; return r; }
  fall(v: boolean): boolean { const r = !v && this.last; this.last = v; return r; }
}

/* ------------------------------------------------------------------ */
/* Cockpit controls                                                    */
/* ------------------------------------------------------------------ */

export const pbIn = (sim: Sim, id: string) => sim.get(`C:${id}`) > 0.5;
/** ENG MASTER lever n at ON (catalog: C = 0 → ON). */
export const masterOn = (sim: Sim, n: number) => sim.get(`C:ENG_MASTER${n}`) < 0.5;
/** ENG MODE selector: 0 CRANK, 1 NORM, 2 IGN/START. */
export const engMode = (sim: Sim) => Math.round(sim.has('C:ENG_MODE') ? sim.get('C:ENG_MODE') : 1);
export const manStart = (sim: Sim, n: number) => pbIn(sim, `ENG_MAN_START${n}`);
export const fireReleased = (sim: Sim, n: number) => sim.get(`C:FIRE_ENG${n}_PB`) > 0.5;
export const tla = (sim: Sim, n: number) => sim.get(`C:THR_LEVER${n}`);

/* ------------------------------------------------------------------ */
/* Environment                                                          */
/* ------------------------------------------------------------------ */

export function oat(sim: Sim): number {
  return sim.has('G:ENV_OAT') ? sim.get('G:ENV_OAT') : 15;
}
export function onGround(sim: Sim): boolean {
  return !sim.has('G:AC_ON_GROUND') || sim.getB('G:AC_ON_GROUND');
}
export const HPA_TO_PSI = 0.0145038;
/** Static pressure (hPa) at a pressure altitude (ft, ISA). */
export function pressureAtAlt(altFt: number): number {
  return 1013.25 * Math.pow(Math.max(0.05, 1 - 6.8755856e-6 * altFt), 5.2558797);
}
/** Pressure altitude (ft) of a static pressure (hPa). */
export function altAtPressure(hpa: number): number {
  return (1 - Math.pow(Math.max(1, hpa) / 1013.25, 0.190284)) * 145366.45;
}
/** Ambient static pressure (hPa). On ground: from QNH and field elevation; in flight: ADR pressure altitude. */
export function ambientPressure(sim: Sim): number {
  const elev = sim.has('G:ENV_ELEV_FT') ? sim.get('G:ENV_ELEV_FT') : 0;
  if (!onGround(sim) && sim.has('S:ADIRS_BARO_ALT_STD')) return pressureAtAlt(sim.get('S:ADIRS_BARO_ALT_STD'));
  const qnh = sim.has('G:ENV_QNH') ? sim.get('G:ENV_QNH') : 1013.25;
  return qnh * Math.pow(1 - 6.8755856e-6 * elev, 5.2558797);
}
/** Aircraft pressure altitude (ft). */
export function pressureAltitude(sim: Sim): number {
  return altAtPressure(ambientPressure(sim));
}
/** Mach number (0 on ground if no ADR data). */
export function mach(sim: Sim): number {
  return sim.has('S:ADIRS_MACH') ? Math.max(0, sim.get('S:ADIRS_MACH')) : 0;
}

/* ------------------------------------------------------------------ */
/* Electrical power (owner sys-elec) with fall-backs                   */
/* ------------------------------------------------------------------ */

const bus = (sim: Sim, name: string) => sim.getB(name);
export const dcBat = (sim: Sim) => bus(sim, 'S:ELEC_DC_BAT_BUS');
export const dcEss = (sim: Sim) => bus(sim, 'S:ELEC_DC_ESS_BUS');
export const dc1 = (sim: Sim) => bus(sim, 'S:ELEC_DC1_BUS');
export const dc2 = (sim: Sim) => bus(sim, 'S:ELEC_DC2_BUS');
export const acPowered = (sim: Sim) =>
  bus(sim, 'S:ELEC_AC_POWERED') || bus(sim, 'S:ELEC_AC1_BUS') || bus(sim, 'S:ELEC_AC2_BUS');
export const ac1 = (sim: Sim) => (sim.has('S:ELEC_AC1_BUS') ? bus(sim, 'S:ELEC_AC1_BUS') : acPowered(sim));
export const ac2 = (sim: Sim) => (sim.has('S:ELEC_AC2_BUS') ? bus(sim, 'S:ELEC_AC2_BUS') : acPowered(sim));
export const acEss = (sim: Sim) => (sim.has('S:ELEC_AC_ESS_BUS') ? bus(sim, 'S:ELEC_AC_ESS_BUS') : acPowered(sim));
export const acEssShed = (sim: Sim) => (sim.has('S:ELEC_AC_ESS_SHED') ? bus(sim, 'S:ELEC_AC_ESS_SHED') : acEss(sim));
/** Any DC supply of the aircraft network. */
export const anyDc = (sim: Sim) => dcBat(sim) || dcEss(sim) || dc1(sim) || dc2(sim);
/** Annunciator lights powered (S:ANN_POWER from sys-misc, else DC BAT / DC ESS). */
export function annPower(sim: Sim): boolean {
  if (sim.has('S:ANN_POWER')) return sim.getB('S:ANN_POWER');
  return dcBat(sim) || dcEss(sim);
}

