/**
 * Player settings (persisted in localStorage when available). DOM-optional.
 */

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type AlignMode = 'real' | 'fast' | 'instant';
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  timeOfDay: TimeOfDay;
  /** IRS alignment duration: real (~7-10 min at LFBD), fast (90 s), instant (5 s). */
  irsAlign: AlignMode;
  quality: Quality;
  mouseSensitivity: number; // 0.2..3
  invertY: boolean;
  fov: number; // degrees (vertical)
  masterVolume: number; // 0..1
  cockpitVolume: number; // 0..1 (ambient/systems)
  alertVolume: number; // 0..1 (ECAM chimes)
  /** Show the name of the control under the crosshair. */
  tooltips: boolean;
  /** Show FPS counter. */
  showFps: boolean;
  /** Units for weights in MCDU/ECAM. */
  weightUnit: 'kg' | 'lbs';
}

export const DEFAULT_SETTINGS: Settings = {
  timeOfDay: 'day',
  irsAlign: 'real',
  quality: 'high',
  mouseSensitivity: 1,
  invertY: false,
  fov: 62,
  masterVolume: 0.8,
  cockpitVolume: 0.8,
  alertVolume: 0.9,
  tooltips: true,
  showFps: false,
  weightUnit: 'kg',
};

type Listener = (s: Settings, key: keyof Settings) => void;

class SettingsStore {
  private data: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    try {
      const raw = globalThis.localStorage?.getItem('a320.settings');
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* storage unavailable */ }
  }

  get(): Readonly<Settings> {
    return this.data;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.data[key] === value) return;
    this.data[key] = value;
    try { globalThis.localStorage?.setItem('a320.settings', JSON.stringify(this.data)); } catch { /* ignore */ }
    for (const l of this.listeners) l(this.data, key);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new SettingsStore();
