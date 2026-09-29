/**
 * FWC flight phases (FCOM DSC-31 "Flight phases"):
 *
 *   1  ELEC PWR            aircraft on ground, engines stopped
 *   2  1ST ENG STARTED     on ground, at least one engine running, not at T.O power, < 80 kt
 *   3  1ST ENG T.O PWR     T.O power set, < 80 kt
 *   4  80 KT               T.O power, > 80 kt, on ground
 *   5  LIFT OFF            airborne, T.O power, RA < 1500 ft (max 2 min)
 *   6  1500 FT             in flight (neither 5 nor 7)
 *   7  800 FT              RA < 800 ft, not T.O power (max 3 min)
 *   8  TOUCHDOWN           on ground, > 80 kt, not T.O power
 *   9  80 KT               on ground, < 80 kt, after T.O power or landing, one engine running
 *  10  2ND ENG SHUTDOWN    engines stopped after phase 9, 5 minutes (then phase 1)
 *
 * Logic derived from the ESLD sheets (confirmation / memory nodes), simplified where the
 * inputs are not simulated. Pressing the ENG 1 FIRE pb on ground resets phase 10 to phase 1.
 */
import { Acq } from './acq';
import { ConfirmNode, Memory, Monostable } from './util';

export class FlightPhases {
  phase = 1;
  /** Seconds spent in the current phase. */
  inPhase = 0;

  /** "Engine 1 or 2 running" is confirmed 30 s by the FWC before phase 2 is entered. */
  private readonly engRunningConf = new ConfirmNode(30, true);
  private readonly gndConf = new ConfirmNode(1, true);
  private readonly spd80 = new Memory(false);
  private readonly mctConf = new ConfirmNode(60, true);
  private readonly phase9Nvm = new Memory(false);
  private readonly phase5Timer = new Monostable(120, true, false);
  private readonly phase7Timer = new Monostable(180, true, false);
  private readonly gnd2s = new Monostable(2, false, true);
  private phase10Remaining = 0;
  private initialised = false;

  update(a: Acq, dt: number): number {
    const gndImmediate = a.onGround;
    // spawned on ground: the ground confirmation is already established
    if (!this.initialised && gndImmediate) this.gndConf.reset(true);
    const gnd = this.gndConf.write(gndImmediate, dt);
    const oneEngRunning = a.eng[0].running || a.eng[1].running;
    let engRunning = this.engRunningConf.write(oneEngRunning, dt);
    if (!this.initialised && oneEngRunning) { this.engRunningConf.reset(true); engRunning = true; }
    const spd80 = this.spd80.write(a.ias > 83, a.ias < 77);
    const toPwrSignal = a.toPower();
    const bothAboveClb = a.eng[0].tla > 22.9 && a.eng[1].tla > 22.9;
    const hAbv1500 = a.radioAlt > 1500;
    const hAbv800 = a.radioAlt > 800;
    const toPower = toPwrSignal || (this.mctConf.write(toPwrSignal, dt) && !hAbv1500 && bothAboveClb);
    const gnd2s = this.gnd2s.write(gndImmediate, dt) || gndImmediate;
    const firePb1 = a.eng[0].firePbOut;

    const phase8 = gnd2s && !toPower && spd80;
    const phase34 = gnd && toPower;
    const phase3 = !spd80 && oneEngRunning && phase34;
    const phase4 = spd80 && phase34;

    // Phase 9 memory: set by T.O power (phase 3, e.g. rejected T.O) or by the landing roll (phase 8),
    // reset once both engines are stopped on ground.
    const nvm = this.phase9Nvm.write(phase3 || phase8, gnd && !oneEngRunning);
    const phase29 = gnd && !toPower && !spd80;
    const phase9 = oneEngRunning && nvm && phase29;
    const phase2 = phase29 && !nvm && engRunning;

    // Phase 10: 5 minutes after the last engine shutdown that followed phase 9.
    if (this.initialised && this.phase === 9 && !oneEngRunning && gndImmediate) this.phase10Remaining = 300;
    if (this.phase10Remaining > 0) {
      this.phase10Remaining -= dt;
      if ((firePb1 && gnd) || oneEngRunning || !gndImmediate) this.phase10Remaining = 0;
    }
    const phase10 = this.phase10Remaining > 0 && gndImmediate && !oneEngRunning;

    // Airborne phases
    const phase5Cond = !gnd2s && toPower && !hAbv1500;
    const phase5 = this.phase5Timer.write(phase5Cond, dt) && phase5Cond;
    const phase7Cond = !gnd2s && !toPower && !hAbv800;
    const phase7 = this.phase7Timer.write(phase7Cond, dt) && phase7Cond && !phase8;
    const phase6 = !gnd2s && !phase5 && !phase7;

    const phase1 = gndImmediate && !phase2 && !phase3 && !phase4 && !phase8 && !phase9 && !phase10;

    const list = [phase1, phase2, phase3, phase4, phase5, phase6, phase7, phase8, phase9, phase10];
    const active = list.map((v, i) => (v ? i + 1 : 0)).filter((v) => v > 0);
    let next = this.phase;
    if (!this.initialised) next = active[0] ?? 1;
    else if (active.length === 1) next = active[0];
    else if (active.length > 1 && !active.includes(this.phase)) next = active[0];
    this.initialised = true;
    if (next !== this.phase) {
      this.phase = next;
      this.inPhase = 0;
    } else this.inPhase += dt;
    return this.phase;
  }

  /** Test / scenario helper: force a phase. */
  force(p: number): void {
    this.phase = p;
    this.inPhase = 0;
    this.initialised = true;
    if (p === 2 || p === 9) this.engRunningConf.reset(true);
    if (p === 9) this.phase9Nvm.set(true);
  }
}
