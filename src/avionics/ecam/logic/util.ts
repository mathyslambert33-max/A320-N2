/**
 * Small logic blocks used by the FWC / DMC logic (DOM-free).
 * They mirror the classic Airbus "ESLD" building blocks: confirmation (CONF), monostable
 * trigger (MTRIG), SR memory and edge detection.
 */

/** Confirmation node: output becomes true once the input has been true for `time` s (rising edge only
 *  when `rising` = true), or false once it has been false for `time` s (falling edge only when rising = false). */
export class ConfirmNode {
  private acc = 0;
  private out = false;
  constructor(private readonly time: number, private readonly rising = true) {}

  write(input: boolean, dt: number): boolean {
    if (this.rising) {
      if (!input) { this.acc = 0; this.out = false; }
      else if (!this.out) { this.acc += dt; if (this.acc >= this.time) this.out = true; }
    } else {
      if (input) { this.acc = 0; this.out = true; }
      else if (this.out) { this.acc += dt; if (this.acc >= this.time) this.out = false; }
    }
    return this.out;
  }

  read(): boolean { return this.out; }
  reset(v = false): void { this.acc = 0; this.out = v; }
}

/** Monostable: output true for `time` s after an edge of the input (rising or falling). */
export class Monostable {
  private remaining = 0;
  private prev = false;
  constructor(private readonly time: number, private readonly rising = true, private readonly retrigger = true) {}

  write(input: boolean, dt: number): boolean {
    const edge = this.rising ? input && !this.prev : !input && this.prev;
    this.prev = input;
    if (this.remaining > 0) this.remaining = Math.max(0, this.remaining - dt);
    if (edge && (this.retrigger || this.remaining <= 0)) this.remaining = this.time;
    return this.remaining > 0;
  }

  read(): boolean { return this.remaining > 0; }
  reset(): void { this.remaining = 0; }
}

/** SR memory. `setDominant` decides which input wins when both are true. */
export class Memory {
  private out: boolean;
  constructor(init = false, private readonly setDominant = false) { this.out = init; }

  write(set: boolean, reset: boolean): boolean {
    if (this.setDominant) {
      if (set) this.out = true;
      else if (reset) this.out = false;
    } else {
      if (reset) this.out = false;
      else if (set) this.out = true;
    }
    return this.out;
  }

  read(): boolean { return this.out; }
  set(v: boolean): void { this.out = v; }
}

/** Edge detector. */
export class Edge {
  private prev = false;
  constructor(init = false) { this.prev = init; }
  rising(v: boolean): boolean { const r = v && !this.prev; this.prev = v; return r; }
  falling(v: boolean): boolean { const r = !v && this.prev; this.prev = v; return r; }
  /** Update without reading an edge. */
  set(v: boolean): void { this.prev = v; }
}

/** Accumulates the time a condition has been continuously true. */
export class Stopwatch {
  t = 0;
  write(input: boolean, dt: number): number {
    this.t = input ? this.t + dt : 0;
    return this.t;
  }
}
