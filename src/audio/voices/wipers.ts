/**
 * Windshield wipers on a DRY windshield (rubber stick-slip judder + squeal, motor, end-of-stroke thumps)
 * and the sliding side windows (rumble while sliding).
 */
import { AudioCore, POS, Voice, db, type VarReader } from '../core';
import { clamp, lag2, trackWiper, type WiperTrack } from '../mappings';
import type { OneShots } from '../oneshots';

export class WiperVoice extends Voice {
  private tr: WiperTrack = { pos: 0, vel: 0, dir: 0 };
  private init = false;
  private gScrape: GainNode; private gChat: GainNode; private gMotor: GainNode; private gSqueal: GainNode;
  private oChat?: OscillatorNode; private oSqueal?: OscillatorNode;
  private motor = 0;
  private judder = 1;

  constructor(core: AudioCore, private side: 'CAPT' | 'FO', private shots: OneShots) {
    super(core, `wiper-${side}`);
    const pos = side === 'CAPT' ? POS.wiperCapt : POS.wiperFo;
    const pan = this.bus(core.panner(pos, 'hrtf', 0.8, 1), core.interior);
    this.gScrape = core.gain(0, core.filter('bandpass', 2300, 0.8, pan));
    this.gChat = core.gain(0, core.filter('lowpass', 1400, 0.7, pan));
    this.gMotor = core.gain(0, core.filter('lowpass', 900, 0.7, pan));
    this.gSqueal = core.gain(0, pan);
  }

  update(dt: number, v: VarReader): void {
    const pos = v.get(this.side === 'CAPT' ? 'S:WIPER_CAPT_POS' : 'S:WIPER_FO_POS');
    if (!this.init) {
      this.tr.pos = pos;
      this.init = true;
    }
    const ev = trackWiper(this.tr, pos, dt);
    const speed = clamp(Math.abs(this.tr.vel) / 1.8, 0, 1.3);
    const p = this.side === 'CAPT' ? POS.wiperCapt : POS.wiperFo;
    if (ev === 'reverse') this.shots.interior('window', [p[0] + (this.tr.dir > 0 ? 0.25 : -0.1), p[1] + 0.1, p[2]], -9);
    this.motor = lag2(this.motor, speed > 0.02 ? 1 : 0, dt, 0.1, 0.3);
    if (!this.run(speed + this.motor, dt)) return;
    // Dry glass: irregular stick-slip judder.
    if (Math.random() < dt * 6) this.judder = 0.5 + Math.random();
    this.set(this.gScrape.gain, db(-24) * speed, 0.03);
    this.set(this.gChat.gain, db(-22) * speed * this.judder, 0.02);
    this.set(this.gSqueal.gain, db(-38) * speed * (this.judder > 1.2 ? 1 : 0.2), 0.03);
    this.set(this.gMotor.gain, db(-34) * this.motor, 0.05);
    if (this.oChat) this.set(this.oChat.frequency, 70 + 45 * speed * this.judder, 0.03);
    if (this.oSqueal) this.set(this.oSqueal.frequency, 1700 + 500 * this.judder, 0.05);
  }

  protected build(): void {
    const c = this.core;
    this.srcs.push(c.noise('pink', this.gScrape));
    this.oChat = c.osc('sawtooth', 90, this.gChat);
    this.oSqueal = c.osc([1, 0.3, 0.1], 1900, this.gSqueal);
    this.srcs.push(this.oChat, this.oSqueal, c.osc([1, 0.5, 0.3, 0.2], 240, this.gMotor));
  }

  protected override onStop(): void {
    this.oChat = this.oSqueal = undefined;
  }
}

/** Sliding window rumble (C:WINDOW_CAPT / C:WINDOW_FO 0..1). */
export class WindowSlideVoice extends Voice {
  private prev = NaN;
  private vel = 0;
  private g: GainNode;

  constructor(core: AudioCore, private side: 'CAPT' | 'FO') {
    super(core, `window-${side}`);
    const pan = this.bus(core.panner(side === 'CAPT' ? POS.windowCapt : POS.windowFo, 'hrtf', 0.6, 1), core.interior);
    this.g = core.gain(0, core.filter('bandpass', 320, 0.8, pan));
  }

  update(dt: number, v: VarReader): void {
    const pos = v.get(this.side === 'CAPT' ? 'C:WINDOW_CAPT' : 'C:WINDOW_FO');
    const raw = Number.isNaN(this.prev) || dt <= 0 ? 0 : Math.abs(pos - this.prev) / dt;
    this.prev = pos;
    this.vel = lag2(this.vel, clamp(raw / 0.5, 0, 1.5), dt, 0.04, 0.12);
    if (!this.run(this.vel, dt)) return;
    this.set(this.g.gain, db(-22) * this.vel, 0.03);
  }

  protected build(): void {
    this.srcs.push(this.core.noise('brown', this.g));
  }
}
