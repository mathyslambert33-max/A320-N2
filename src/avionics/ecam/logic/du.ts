/**
 * Display unit (LCD DU) power-up behaviour, DOM-free.
 *
 *  OFF ──(power & brightness)──► SELF TEST ("SELF TEST IN PROGRESS / (MAX 40 SECONDS)") ──► ON
 *  ON ──(power lost or knob OFF)──► STANDBY ──(back within 10 s)──► ON
 *                                          └─(> 10 s)──► OFF (a new self test is needed)
 *
 * A DU that is powered on the very first simulation step (aircraft spawned powered) starts ON.
 */
export type DuMode = 'OFF' | 'TEST' | 'ON' | 'STBY';

export class DuState {
  mode: DuMode = 'OFF';
  /** Seconds in the current mode. */
  timer = 0;
  private first = true;

  constructor(readonly name: string, private readonly testDuration: number) {}

  update(powered: boolean, brightness: number, dt: number): DuMode {
    const on = powered && brightness > 0.001;
    if (this.first) {
      this.first = false;
      if (on) { this.mode = 'ON'; this.timer = 0; return this.mode; }
    }
    const prev = this.mode;
    switch (this.mode) {
      case 'OFF':
        if (on) this.mode = 'TEST';
        break;
      case 'TEST':
        if (!on) this.mode = 'OFF';
        else if (this.timer >= this.testDuration) this.mode = 'ON';
        break;
      case 'ON':
        if (!on) this.mode = 'STBY';
        break;
      case 'STBY':
        if (on) this.mode = 'ON';
        else if (this.timer >= 10) this.mode = 'OFF';
        break;
    }
    this.timer = prev === this.mode ? this.timer + dt : 0;
    return this.mode;
  }

  /** Scenario / test helper. */
  force(mode: DuMode): void {
    this.mode = mode;
    this.timer = 0;
    this.first = false;
  }

  /** Remaining self-test time (s). */
  testRemaining(): number {
    return this.mode === 'TEST' ? Math.max(0, this.testDuration - this.timer) : 0;
  }
}
