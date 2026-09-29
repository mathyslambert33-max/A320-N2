/**
 * Shared helpers for the ELEC / HYD / FUEL / APU module (DOM-free).
 *
 * Control conventions (see src/core/catalog.ts):
 *  - latching pb: C = 1 pressed IN (normal "lights out" position for most), 0 released OUT.
 *  - ENG_MASTERn: sw ['ON','OFF'] → C = 0 means ON.
 *  - ASKID_NWSTRG: sw ['ON','OFF'] → C = 0 means ON.
 *  - PARK_BRK: sw ['OFF','ON'] → C = 1 means ON.
 *  - FIRE_xxx_PB: C = 1 means RELEASED (pulled out).
 */
import type { Sim } from '../../core/sim';

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

/** Slow random walk in [-1, 1] used for realistic small fluctuations of displayed values. */
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
    if (input) this.acc += dt;
    else this.acc = 0;
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
    if (input) this.acc = 0;
    else this.acc += dt;
    this.out = input || this.acc < this.delay;
    return this.out;
  }
}

/**
 * Momentary pushbutton watcher: catches presses even if the C var goes 1→0 between two sim ticks
 * (kit `:press` event), plus rising edges of the C var (tests / harness `set=`).
 */
export class PressWatcher {
  private pending = false;
  private last = 0;
  constructor(private sim: Sim, readonly id: string) {
    sim.on(`${id}:press`, () => { this.pending = true; });
    this.last = sim.get(`C:${id}`);
  }
  /** True once per press. */
  consume(): boolean {
    const v = this.sim.get(`C:${this.id}`);
    const rising = v > 0.5 && this.last <= 0.5;
    this.last = v;
    const p = this.pending || rising;
    this.pending = false;
    return p;
  }
  /** Currently held (C var = 1). */
  held(): boolean {
    return this.sim.get(`C:${this.id}`) > 0.5;
  }
}

/**
 * Detects any change of a control value (used for pushbuttons that are momentary on the real aircraft
 * but modelled as latching in the catalog, e.g. EXT PWR): every change = one push.
 */
export class ChangeWatcher {
  private last: number;
  constructor(private sim: Sim, private name: string) {
    this.last = sim.get(name);
  }
  sync(): void { this.last = this.sim.get(this.name); }
  changed(): boolean {
    const v = this.sim.get(this.name);
    const c = v !== this.last;
    this.last = v;
    return c;
  }
}

export const pbIn = (sim: Sim, id: string) => sim.get(`C:${id}`) > 0.5;
export const engMasterOn = (sim: Sim, n: number) => sim.has(`C:ENG_MASTER${n}`) && sim.get(`C:ENG_MASTER${n}`) < 0.5;
export const fireReleased = (sim: Sim, id: 'FIRE_ENG1_PB' | 'FIRE_ENG2_PB' | 'FIRE_APU_PB') => sim.get(`C:${id}`) > 0.5;
export const parkBrakeOn = (sim: Sim) => sim.get('C:PARK_BRK') > 0.5;
export const askidOn = (sim: Sim) => sim.get('C:ASKID_NWSTRG') < 0.5;

/** Engine data from sys-air (missing = 0). */
export function engN2(sim: Sim, n: number): number {
  return sim.get(`S:ENG${n}_N2`);
}
export function engRunning(sim: Sim, n: number): boolean {
  return sim.getB(`S:ENG${n}_RUNNING`) || engN2(sim, n) > 50;
}
/** Engine oil pressure low (used by the HYD FAULT inhibition logic). */
export function engOilLow(sim: Sim, n: number): boolean {
  if (sim.has(`S:ENG${n}_OIL_PRESS`)) return sim.get(`S:ENG${n}_OIL_PRESS`) < 13;
  return engN2(sim, n) < 45;
}
export function onGround(sim: Sim): boolean {
  return !sim.has('G:AC_ON_GROUND') || sim.getB('G:AC_ON_GROUND');
}
/** Best available speed (kt) for the 50/100 kt electrical logic. */
export function airspeed(sim: Sim): number {
  return Math.max(sim.get('S:ADIRS_IAS'), sim.get('G:AC_GS_KT'));
}
export function oat(sim: Sim): number {
  return sim.has('G:ENV_OAT') ? sim.get('G:ENV_OAT') : 15;
}
