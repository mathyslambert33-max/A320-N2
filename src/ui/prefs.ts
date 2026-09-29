/**
 * UI-local preferences (owner: ui) that are not part of the shared `Settings` (src/core/settings.ts).
 * Persisted in localStorage under 'a320.ui' when available; every storage access is guarded because the
 * game may run in a sandboxed page where localStorage throws. DOM-free.
 */

export type GroundPace = 'real' | 'fast';

export interface UiPrefs {
  /** Duration of the long ground operations (boarding, loading, refuelling, walk-around). */
  groundPace: GroundPace;
  /** EFB night theme (null = follow the time of day). */
  efbNight: boolean | null;
  /** Remember the player's preferred look mode: pointer lock ("visée") or free cursor. */
  pointerLock: boolean;
}

const KEY = 'a320.ui';
const DEFAULTS: UiPrefs = { groundPace: 'real', efbNight: null, pointerLock: true };

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

let cache: UiPrefs | null = null;

export function uiPrefs(): Readonly<UiPrefs> {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<UiPrefs>;
      if (j.groundPace === 'real' || j.groundPace === 'fast') cache.groundPace = j.groundPace;
      if (typeof j.efbNight === 'boolean' || j.efbNight === null) cache.efbNight = j.efbNight ?? null;
      if (typeof j.pointerLock === 'boolean') cache.pointerLock = j.pointerLock;
    }
  } catch { /* storage unavailable or corrupt */ }
  return cache;
}

export function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  const p = uiPrefs() as UiPrefs;
  p[key] = value;
  try { storage()?.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** sessionStorage wrapper (one-shot flags across a reload); never throws. */
export const session = {
  get(key: string): string | null {
    try { return (globalThis as { sessionStorage?: Storage }).sessionStorage?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string | null): void {
    try {
      const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
      if (!s) return;
      if (value === null) s.removeItem(key); else s.setItem(key, value);
    } catch { /* ignore */ }
  },
};
