/**
 * FWC aural alerts (event 'fwc:sound') played through the flight-deck loudspeakers, and the cabin
 * chime (event 'cabin:chime') heard through the cockpit door.
 *
 * Supported sounds: SC, CRC (until STOP_CRC / MASTER WARN / EMER CANC), CAVALRY (1.5 s, or
 * continuous with {loop:true} until STOP_CAVALRY / MASTER WARN / 2nd takeover pb), CCHORD (1.5 s, or
 * continuous with {loop:true} until STOP_CCHORD), CLICK, TRIPLECLICK, BUZZER ({duration} s, default
 * 1.2 s, or {loop:true} until STOP_BUZZER), CRICKET (until STOP_CRICKET), STOP_ALL.
 */
import { AudioCore, db, hold } from './core';
import {
  CAVALRY_PERIOD, CRC_PERIOD, renderBuzzer, renderCabinChime, renderCavalry, renderCChord, renderCricket,
  renderCrcChime, renderFwcClick, renderSingleChime, renderTripleClick,
} from './synth';

export interface FwcPayload {
  sound?: string;
  loop?: boolean;
  duration?: number;
}

type LoopName = 'CCHORD' | 'BUZZER' | 'CRICKET';
interface Scheduled { src: AudioBufferSourceNode; t: number }

/** Levels (dB) of each alert before the alert volume setting. */
export const ALERT_DB: Record<string, number> = {
  SC: -6, CRC: -6, CAVALRY: -9, CCHORD: -11, CLICK: -9, TRIPLECLICK: -9, BUZZER: -14, CRICKET: -12, CABIN: -17,
};

export class Alerts {
  private bufs = new Map<string, AudioBuffer>();
  private crc = { on: false, next: 0, srcs: [] as Scheduled[] };
  private cav = { on: false, next: 0, srcs: [] as Scheduled[] };
  private loops = new Map<LoopName, { src: AudioBufferSourceNode; g: GainNode }>();
  private buzzUntil = 0;

  constructor(private core: AudioCore) {}

  private buf(name: string): AudioBuffer {
    let b = this.bufs.get(name);
    if (!b) {
      const sr = this.core.ctx.sampleRate;
      const data =
        name === 'SC' ? renderSingleChime(sr)
        : name === 'CRC' ? renderCrcChime(sr)
        : name === 'CAVALRY' ? renderCavalry(sr)
        : name === 'CCHORD' ? renderCChord(sr, 1.5)
        : name === 'CCHORD_LOOP' ? renderCChord(sr, 2, true)
        : name === 'CLICK' ? renderFwcClick(sr)
        : name === 'TRIPLECLICK' ? renderTripleClick(sr)
        : name === 'BUZZER_LOOP' ? renderBuzzer(sr, 1, true)
        : name === 'CRICKET' ? renderCricket(sr)
        : name === 'CABIN_hi' ? renderCabinChime(sr, 'hi')
        : name === 'CABIN_hilo' ? renderCabinChime(sr, 'hilo')
        : name === 'CABIN_lo' ? renderCabinChime(sr, 'lo')
        : renderSingleChime(sr);
      b = this.core.buffer(data);
      this.bufs.set(name, b);
    }
    return b;
  }

  /** Pre-render the alert buffers (call after the context is created, off the critical path). */
  warm(): void {
    for (const n of ['SC', 'CRC', 'CAVALRY', 'CCHORD', 'CLICK', 'TRIPLECLICK']) this.buf(n);
  }

  private play(name: string, level: number, when?: number, dest: AudioNode = this.core.alertBus): AudioBufferSourceNode {
    const c = this.core;
    const src = c.ctx.createBufferSource();
    src.buffer = this.buf(name);
    const g = c.gain(db(level), dest);
    src.connect(g);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    src.start(Math.max(c.now, when ?? c.now));
    return src;
  }

  private startLoop(name: LoopName): void {
    if (this.loops.has(name)) return;
    const c = this.core;
    const src = c.ctx.createBufferSource();
    src.buffer = this.buf(name === 'CCHORD' ? 'CCHORD_LOOP' : name === 'BUZZER' ? 'BUZZER_LOOP' : 'CRICKET');
    src.loop = true;
    const g = c.gain(0, c.alertBus);
    src.connect(g);
    const t = c.now;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(db(ALERT_DB[name]), t + 0.02);
    src.start(t);
    this.loops.set(name, { src, g });
  }

  private stopLoop(name: LoopName): void {
    const l = this.loops.get(name);
    if (!l) return;
    const t = this.core.now;
    hold(l.g.gain, t);
    l.g.gain.setTargetAtTime(0, t, 0.015);
    l.src.stop(t + 0.12);
    l.src.onended = () => { l.src.disconnect(); l.g.disconnect(); };
    this.loops.delete(name);
  }

  private stopScheduled(list: Scheduled[]): void {
    const now = this.core.now;
    for (const s of list) {
      // Sources already sounding decay naturally; future ones are cancelled.
      try { if (s.t > now + 0.005) s.src.stop(); } catch { /* not started */ }
    }
    list.length = 0;
  }

  handle(p: FwcPayload | string | undefined): void {
    const sound = typeof p === 'string' ? p : p?.sound;
    const loop = typeof p === 'object' && !!p?.loop;
    const now = this.core.now;
    switch (sound) {
      case 'SC':
        this.play('SC', ALERT_DB.SC);
        break;
      case 'CRC':
        if (!this.crc.on) {
          this.crc.on = true;
          this.crc.next = now + 0.005;
          this.update();
        }
        break;
      case 'STOP_CRC':
        this.crc.on = false;
        this.stopScheduled(this.crc.srcs);
        break;
      case 'CAVALRY':
        if (loop) {
          if (!this.cav.on) {
            this.cav.on = true;
            this.cav.next = now + 0.005;
            this.update();
          }
        } else if (!this.cav.on) this.play('CAVALRY', ALERT_DB.CAVALRY);
        break;
      case 'STOP_CAVALRY':
        this.cav.on = false;
        this.stopScheduled(this.cav.srcs);
        break;
      case 'CCHORD':
        if (loop) this.startLoop('CCHORD');
        else this.play('CCHORD', ALERT_DB.CCHORD);
        break;
      case 'STOP_CCHORD':
        this.stopLoop('CCHORD');
        break;
      case 'CLICK':
        this.play('CLICK', ALERT_DB.CLICK);
        break;
      case 'TRIPLECLICK':
        this.play('TRIPLECLICK', ALERT_DB.TRIPLECLICK);
        break;
      case 'BUZZER': {
        this.startLoop('BUZZER');
        const d = typeof p === 'object' && p?.duration ? p.duration : 1.2;
        this.buzzUntil = loop ? Infinity : now + d;
        break;
      }
      case 'STOP_BUZZER':
        this.stopLoop('BUZZER');
        break;
      case 'CRICKET':
        this.startLoop('CRICKET');
        break;
      case 'STOP_CRICKET':
        this.stopLoop('CRICKET');
        break;
      case 'STOP_ALL':
        this.stopAll();
        break;
      default:
        break;
    }
  }

  /** MASTER WARN pressed: silences CRC and continuous cavalry / C chord. */
  masterWarn(): void {
    this.handle('STOP_CRC');
    this.handle('STOP_CAVALRY');
    this.handle('STOP_CCHORD');
  }

  stopAll(): void {
    this.handle('STOP_CRC');
    this.handle('STOP_CAVALRY');
    for (const n of [...this.loops.keys()]) this.stopLoop(n);
  }

  /** Called at ~30 Hz: schedules repeating chimes ahead of the audio clock. */
  update(): void {
    const now = this.core.now;
    const ahead = now + 0.2;
    if (this.crc.on) {
      if (this.crc.next < now) this.crc.next = now;
      while (this.crc.next < ahead) {
        this.crc.srcs.push({ src: this.play('CRC', ALERT_DB.CRC, this.crc.next), t: this.crc.next });
        this.crc.next += CRC_PERIOD;
      }
      if (this.crc.srcs.length > 8) this.crc.srcs.splice(0, this.crc.srcs.length - 8);
    }
    if (this.cav.on) {
      if (this.cav.next < now) this.cav.next = now;
      while (this.cav.next < ahead) {
        this.cav.srcs.push({ src: this.play('CAVALRY', ALERT_DB.CAVALRY, this.cav.next), t: this.cav.next });
        this.cav.next += CAVALRY_PERIOD;
      }
      if (this.cav.srcs.length > 4) this.cav.srcs.splice(0, this.cav.srcs.length - 4);
    }
    if (this.loops.has('BUZZER') && now >= this.buzzUntil) this.stopLoop('BUZZER');
  }

  /** Cabin chime (CIDS) heard through the cockpit door. */
  cabinChime(type: 'lo' | 'hi' | 'hilo' = 'lo'): void {
    this.play(`CABIN_${type}`, ALERT_DB.CABIN, undefined, this.core.cabinIn);
  }
}
