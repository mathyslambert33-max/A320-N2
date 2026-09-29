/**
 * Synthetic voice callouts: DUAL INPUT and PRIORITY LEFT / RIGHT (sidesticks, events `fcs:dual_input`,
 * `fcs:priority`) and the GPWS aural messages (`gpws:aural`, e.g. during the GPWS test).
 *
 * The aircraft's own voice messages are synthetic, so the browser speech synthesis (en-US) stands in for
 * them. It is the only sound that bypasses the WebAudio graph (no spatialisation, volume = master × alert
 * settings) and is silently absent where the API is unavailable (node, some embedded browsers).
 */
import type { Settings } from '../core/settings';

/** Voice names that sound closest to the Airbus/Honeywell male synthetic voice, best first. */
const PREFERRED = ['Microsoft David', 'Google US English', 'Alex', 'Daniel', 'Fred', 'Male'];

export class Callouts {
  private voice: SpeechSynthesisVoice | null = null;
  private muted = false;

  constructor(private readonly settings: () => Readonly<Settings>) {
    const ss = globalThis.speechSynthesis;
    if (!ss) return;
    const pick = () => {
      const list = ss.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
      this.voice =
        PREFERRED.map((n) => list.find((v) => v.name.includes(n))).find(Boolean) ??
        list.find((v) => v.lang === 'en-US') ??
        list[0] ??
        null;
    };
    pick();
    ss.addEventListener?.('voiceschanged', pick);
  }

  setMuted(b: boolean): void {
    this.muted = b;
    if (b) globalThis.speechSynthesis?.cancel();
  }

  /** Speak a message; `interrupt` cuts the one being spoken (priority messages). */
  say(text: string, interrupt = false): void {
    const ss = globalThis.speechSynthesis;
    if (!ss || this.muted) return;
    const s = this.settings();
    const vol = s.masterVolume * s.alertVolume;
    if (vol <= 0.01) return;
    if (interrupt) ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    if (this.voice) u.voice = this.voice;
    u.rate = 1.05;
    u.pitch = 0.75;
    u.volume = Math.min(1, vol);
    ss.speak(u);
  }

  stop(): void {
    globalThis.speechSynthesis?.cancel();
  }
}
