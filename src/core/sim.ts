/**
 * Core simulation bus.
 *
 * Everything in the aircraft communicates through a flat store of numeric variables
 * (like MSFS L-vars) plus a small event bus. It is DOM-free so it runs in unit tests.
 *
 * Variable name prefixes (see docs/ARCHITECTURE.md):
 *   C:<CONTROL_ID>   cockpit control positions, written by the interaction kit (and state loads)
 *   L:<LIGHT_ID>     annunciator lights 0/1 (or 0..1), written by systems, read by the 3D kit
 *   S:<NAME>         system state, written by the owning system module only
 *   G:<NAME>         ground services / scenario / environment (EFB, world)
 *
 * Booleans are stored as 0/1.
 */

export type EventHandler = (payload?: any) => void;

export interface SimSystem {
  /** Unique name, e.g. 'elec'. */
  name: string;
  /** Lower runs first. Suggested bands: 0 env, 10 elec, 20 apu, 30 pneu, 40 eng, 50 hyd, 60 fuel, 70 misc, 80 fmgs/fcu, 90 fwc/ecam, 100 lights. */
  order: number;
  init?(sim: Sim): void;
  /** Fixed-step update, dt in seconds (sim time, already scaled by sim rate). */
  update(dt: number, sim: Sim): void;
}

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private anyHandlers = new Set<(name: string, payload?: any) => void>();

  on(name: string, fn: EventHandler): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Listen to every event (debug, recorder, audio). */
  onAny(fn: (name: string, payload?: any) => void): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  emit(name: string, payload?: any): void {
    const set = this.handlers.get(name);
    if (set) for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[event ${name}]`, e); }
    }
    for (const fn of this.anyHandlers) {
      try { fn(name, payload); } catch (e) { console.error('[event any]', e); }
    }
  }
}

export class Sim {
  private readonly vars = new Map<string, number>();
  private readonly watchers = new Map<string, Set<(v: number, old: number) => void>>();
  readonly events = new EventBus();
  readonly systems: SimSystem[] = [];
  /** Sim time in seconds since start. */
  time = 0;
  /** Fixed step in seconds. */
  readonly step = 1 / 30;
  /** Sim rate multiplier (1 = real time). */
  rate = 1;
  paused = false;
  private acc = 0;
  private initialized = false;
  /** Shared rich objects that do not fit in numeric vars (e.g. the FMGS flight plan API). */
  readonly services: Record<string, any> = {};

  get(name: string): number {
    return this.vars.get(name) ?? 0;
  }

  getB(name: string): boolean {
    return (this.vars.get(name) ?? 0) !== 0;
  }

  has(name: string): boolean {
    return this.vars.has(name);
  }

  set(name: string, value: number | boolean): void {
    const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    const old = this.vars.get(name);
    if (old === v) return;
    this.vars.set(name, v);
    const w = this.watchers.get(name);
    if (w) for (const fn of [...w]) fn(v, old ?? 0);
  }

  /** Set only if the variable does not exist yet (initial values). */
  init(name: string, value: number | boolean): void {
    if (!this.vars.has(name)) this.set(name, value);
  }

  /** Called whenever the variable changes value. */
  watch(name: string, fn: (v: number, old: number) => void): () => void {
    let set = this.watchers.get(name);
    if (!set) this.watchers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  on(name: string, fn: EventHandler): () => void {
    return this.events.on(name, fn);
  }

  emit(name: string, payload?: any): void {
    this.events.emit(name, payload);
  }

  register(system: SimSystem): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.order - b.order);
    if (this.initialized) system.init?.(this);
  }

  /** Initialise all registered systems (called once by the app after every module is installed). */
  start(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const s of this.systems) s.init?.(this);
  }

  /** Advance by real elapsed seconds; runs as many fixed steps as needed. */
  advance(realDt: number): void {
    if (!this.initialized) this.start();
    if (this.paused) return;
    this.acc += Math.min(realDt, 0.25) * this.rate;
    let n = 0;
    while (this.acc >= this.step && n < 40) {
      this.tick(this.step);
      this.acc -= this.step;
      n++;
    }
  }

  /** Run exactly one step of dt seconds (tests use this). */
  tick(dt: number): void {
    this.time += dt;
    for (const s of this.systems) {
      try { s.update(dt, this); } catch (e) { console.error(`[system ${s.name}]`, e); }
    }
  }

  /** Run the simulation for `seconds` (tests). */
  run(seconds: number): void {
    if (!this.initialized) this.start();
    const n = Math.round(seconds / this.step);
    for (let i = 0; i < n; i++) this.tick(this.step);
  }

  /** Snapshot of all vars (save states / debugging). */
  snapshot(prefix?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.vars) if (!prefix || k.startsWith(prefix)) out[k] = v;
    return out;
  }

  restore(values: Record<string, number>): void {
    for (const k in values) this.set(k, values[k]);
  }

  /** All variable names (debug). */
  names(): string[] {
    return [...this.vars.keys()].sort();
  }
}

/** Small helpers shared by systems. */
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Move `cur` toward `target` by at most `rate*dt`. */
export const approach = (cur: number, target: number, rate: number, dt: number) => {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
};
/** First-order lag toward target with time constant tau (s). */
export const lag = (cur: number, target: number, tau: number, dt: number) =>
  tau <= 0 ? target : cur + (target - cur) * (1 - Math.exp(-dt / tau));
