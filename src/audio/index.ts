/**
 * Audio module entry point — procedural Web Audio engine driven by the sim (see docs/vars/audio.md).
 *
 *  - The AudioContext is created lazily on the first user gesture (pointerdown / keydown / touchstart)
 *    to satisfy browser autoplay policies, or when `app.services.audio.resume()` is called.
 *  - `app.services.audio = { resume(), context, setMuted(b), muted, selfTest(filter?), stopSelfTest(),
 *    engine, debug() }`.
 *  - Voice callouts (DUAL INPUT, PRIORITY LEFT/RIGHT, GPWS messages) use the browser speech synthesis.
 *  - No-op in a HeadlessApp / node (no window or no AudioContext).
 */
import type { App } from '../app';
import type { Settings } from '../core/settings';
import { AudioEngine } from './engine';
import { Callouts } from './callouts';
import type { FwcPayload } from './alerts';
import type { SfxPayload } from './oneshots';
import { audioSelfTest, stopAudioSelfTest } from './selftest';

export interface AudioService {
  /** Create (if needed) and resume the AudioContext. Call from a user gesture if possible. */
  resume(): Promise<void>;
  readonly context: AudioContext | null;
  setMuted(b: boolean): void;
  readonly muted: boolean;
  /** Play every sound in sequence (optionally only the steps whose name contains `filter`). */
  selfTest(filter?: string): Promise<void>;
  stopSelfTest(): void;
  readonly engine: AudioEngine | null;
  /** Voices running + context state (debug). */
  debug(): Record<string, unknown>;
}

/** Ids of momentary pushbuttons that silence aural alerts. */
const PRESS_IDS = [
  'WARN_MASTER_WARN_CAPT', 'WARN_MASTER_WARN_FO', 'ECP_EMER_CANC', 'SIDESTICK_CAPT_TAKEOVER', 'SIDESTICK_FO_TAKEOVER',
  'EVAC_HORN_SHUTOFF',
];

function stubService(): AudioService {
  return {
    resume: async () => undefined,
    context: null,
    setMuted: () => undefined,
    muted: false,
    selfTest: async () => undefined,
    stopSelfTest: () => undefined,
    engine: null,
    debug: () => ({ state: 'unavailable' }),
  };
}

export default function install(app: App): void {
  const w = typeof window !== 'undefined' ? (window as any) : undefined;
  const Ctor: typeof AudioContext | undefined = w ? w.AudioContext ?? w.webkitAudioContext : undefined;
  if (!app.services) (app as any).services = {};
  if (!w || !Ctor || typeof document === 'undefined') {
    app.services.audio = stubService();
    return;
  }

  let ctx: AudioContext | null = null;
  let engine: AudioEngine | null = null;
  let muted = false;
  let userStarted = false;
  let acc = 0;
  const sim = app.sim;

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
      engine = new AudioEngine(ctx, { sim, camera: app.camera, aircraft: app.aircraft }, app.settings.get() as Settings);
      engine.setMuted(muted);
      if (!app.camera) engine.placeListenerAtCaptain();
      // Pre-render the most common one-shots shortly after start (keeps the gesture handler light).
      setTimeout(() => {
        try {
          engine?.shots.warm();
          engine?.alerts.warm();
        } catch (e) {
          console.error('[audio] warm-up', e);
        }
      }, 50);
    } catch (e) {
      console.error('[audio] cannot create AudioContext', e);
      ctx = null;
      engine = null;
    }
    return ctx;
  };

  const resume = async (): Promise<void> => {
    const c = ensure();
    if (!c) return;
    userStarted = true;
    if (c.state !== 'running') {
      try {
        await c.resume();
      } catch { /* not allowed yet */ }
    }
  };

  // First user gesture → create + resume (listeners stay until the context actually runs).
  const onGesture = () => {
    void resume().then(() => {
      if (ctx?.state === 'running') {
        for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) document.removeEventListener(ev, onGesture, true);
      }
    });
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) document.addEventListener(ev, onGesture, true);

  // Save CPU when the tab is hidden (the render loop stops anyway).
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else if (userStarted) void ctx.resume().catch(() => undefined);
  });

  // Synthetic voice callouts (browser speech synthesis; only after the first user gesture).
  const callouts = new Callouts(() => app.settings.get());
  const speak = (text: string, interrupt = false) => { if (userStarted) callouts.say(text, interrupt); };
  sim.on('fcs:dual_input', () => speak('DUAL INPUT'));
  sim.on('fcs:priority', (p?: { side?: string }) => speak(`PRIORITY ${p?.side === 'RIGHT' ? 'RIGHT' : 'LEFT'}`, true));
  sim.on('gpws:aural', (p?: { msg?: string }) => { if (p?.msg) speak(p.msg); });

  // Sim events.
  sim.on('sfx', (p: SfxPayload) => { if (engine && ctx?.state === 'running') engine.sfx(p); });
  sim.on('fwc:sound', (p: FwcPayload | string) => { if (engine) engine.fwc(p); });
  sim.on('cabin:chime', (p?: { type?: 'lo' | 'hi' | 'hilo' }) => { if (engine && ctx?.state === 'running') engine.cabinChime(p); });
  for (const id of PRESS_IDS) sim.on(`${id}:press`, () => engine?.onPress(id));

  // Settings.
  app.settings.onChange((s) => engine?.applySettings(s));

  // Update at ≤ 30 Hz, after the camera has been moved by the ui module.
  app.onFrame((dt) => {
    if (!engine || !ctx || ctx.state !== 'running') return;
    acc += dt;
    if (acc < 1 / 30 - 1e-4) return;
    const step = Math.min(acc, 0.25);
    acc = 0;
    try {
      engine.update(step);
    } catch (e) {
      console.error('[audio] update', e);
    }
  }, 500);

  const service: AudioService = {
    resume,
    get context() {
      return ctx;
    },
    setMuted(b: boolean) {
      muted = b;
      engine?.setMuted(b);
      callouts.setMuted(b);
    },
    get muted() {
      return muted;
    },
    selfTest: async (filter?: string) => {
      await resume();
      if (engine) await audioSelfTest(app, engine, filter);
    },
    stopSelfTest: () => stopAudioSelfTest(engine),
    get engine() {
      return engine;
    },
    debug: () => ({ state: ctx?.state ?? 'not created', sampleRate: ctx?.sampleRate, voices: engine?.debug() ?? {} }),
  };
  app.services.audio = service;
}
