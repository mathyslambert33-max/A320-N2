/**
 * One-shot sample playback: mechanical clicks of the controls ('sfx' events), relays, valve thumps,
 * igniter snaps, light-off whumps. Buffers are synthesised lazily (4 random variants per kind) and
 * played through small pools of panners (HRTF for the flight deck, equal-power for exterior sources).
 */
import { getControl } from '../core/catalog';
import { AudioCore, POS, db, setPannerPos, type Vec3 } from './core';
import { CLICKS, renderClick, renderWhump } from './synth';
import { mulberry32 } from './mappings';

export interface SfxPayload {
  kind?: string;
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  value?: number;
  up?: boolean;
  release?: boolean;
  phase?: string;
}

/** Rough body-frame position of each panel (fallback when an 'sfx' event carries no x/y/z). */
export function panelPosition(panel: string | undefined): Vec3 {
  if (!panel) return [0, 1.0, -0.6];
  if (panel === 'OVHD_MAINT') return [0, 2.2, 0.35];
  if (panel.startsWith('OVHD_')) {
    const side = /_L$|WIPER_L|ADIRS|FLTCTL_L|EVAC|EMER|GPWS|RCDR|OXY|CALLS/.test(panel) ? -0.25 : /_R$|WIPER_R|FLTCTL_R/.test(panel) ? 0.25 : 0;
    return [side, 2.05, -0.5];
  }
  if (panel === 'GLARE_FCU') return [0, 1.42, -0.95];
  if (panel === 'GLARE_EFIS_L') return [-0.5, 1.42, -0.95];
  if (panel === 'GLARE_EFIS_R') return [0.5, 1.42, -0.95];
  if (panel === 'GLARE_WARN_L') return [-0.72, 1.42, -0.92];
  if (panel === 'GLARE_WARN_R') return [0.72, 1.42, -0.92];
  if (panel === 'MAIN_CAPT') return [-0.55, 1.0, -1.0];
  if (panel === 'MAIN_FO') return [0.55, 1.0, -1.0];
  if (panel === 'MAIN_GEAR') return [0.3, 0.92, -1.0];
  if (panel.startsWith('MAIN_')) return [0, 1.0, -1.02];
  if (panel === 'PED_MCDU1') return [-0.18, 0.86, -0.62];
  if (panel === 'PED_MCDU2') return [0.18, 0.86, -0.62];
  if (panel === 'PED_THR' || panel === 'PED_ENG') return [0, 0.82, -0.2];
  if (panel === 'PED_PARKBRK') return [0, 0.78, 0.05];
  if (panel === 'PED_SPDBRK') return [-0.17, 0.82, -0.12];
  if (panel === 'PED_FLAPS') return [0.17, 0.82, -0.12];
  if (panel === 'PED_TRIM') return [-0.2, 0.7, -0.2];
  if (panel.startsWith('PED_')) return [0, 0.82, -0.35];
  if (panel === 'CONSOLE_CAPT') return [-0.85, 0.85, -0.1];
  if (panel === 'CONSOLE_FO') return [0.85, 0.85, -0.1];
  return [0, 1.0, -0.6];
}

/** Map an 'sfx' payload to a sound key of CLICKS (+ dB offset). */
export function sfxSound(p: SfxPayload): { key: string; db: number } {
  const id = p.id ?? '';
  const kind = p.kind ?? 'pb';
  const up = !!(p.up || p.release || p.phase === 'up' || p.phase === 'release');
  if (/^ENG_MASTER/.test(id)) return { key: 'engMaster', db: 0 };
  if (id === 'PARK_BRK') return { key: 'parkBrake', db: 0 };
  if (id === 'GEAR_LEVER') return { key: 'gear', db: 0 };
  if (/^WINDOW_/.test(id)) return { key: 'window', db: 0 };
  if (id === 'PITCH_TRIM') return { key: 'trim', db: 0 };
  if (/^(THR_LEVER|FLAPS_LEVER|SPDBRK_LEVER)/.test(id)) return { key: kind === 'lever' ? 'lever' : 'detent', db: kind === 'lever' ? -4 : 0 };
  if (/^(ADIRS_KEY|XPDR_KEY)/.test(id)) return { key: up ? 'pbmUp' : 'pbm', db: -4 };
  switch (kind) {
    case 'pb': return { key: 'pb', db: p.value === 0 ? -2 : 0 };
    case 'pbm': return { key: up ? 'pbmUp' : 'pbm', db: 0 };
    case 'sw': return { key: 'sw', db: 0 };
    case 'swm': return { key: 'swm', db: up ? -5 : 0 };
    case 'rot': return { key: 'rot', db: 0 };
    case 'rotm': return { key: 'rotm', db: up ? -3 : 0 };
    case 'pot': return { key: 'pot', db: 0 };
    case 'enc': return { key: 'enc', db: 0 };
    case 'key': return { key: 'key', db: up ? -8 : 0 };
    case 'guard': return { key: 'guard', db: 0 };
    case 'lever': return { key: 'lever', db: 0 };
    case 'detent': return { key: 'detent', db: 0 };
    case 'push': return { key: 'push', db: 0 };
    case 'pull': return { key: 'pull', db: 0 };
    default: return { key: CLICKS[kind] ? kind : 'pb', db: 0 };
  }
}

interface Slot { pan: PannerNode; busyUntil: number; leak?: GainNode; dest: AudioNode[]; linked: boolean }

export class OneShots {
  private cache = new Map<string, AudioBuffer[]>();
  private intPool: Slot[] = [];
  private extPool: Slot[] = [];
  private lastById = new Map<string, number>();
  private seed = 1;

  constructor(private core: AudioCore) {
    // Pool panners are connected to the buses only while a sound plays (idle panners cost nothing).
    const rv = core.gain(0.3, core.reverbIn);
    for (let i = 0; i < 6; i++) {
      const pan = core.panner([0, 1, -0.6], 'hrtf', 0.45, 1);
      this.intPool.push({ pan, busyUntil: 0, dest: [core.interior, rv], linked: false });
    }
    const leak = core.gain(db(-6), core.extMono);
    for (let i = 0; i < 6; i++) {
      const pan = core.panner([0, 0, 10], 'eq', 1, 0);
      this.extPool.push({ pan, busyUntil: 0, leak, dest: [core.exteriorBus], linked: false });
    }
  }

  private buffers(key: string): AudioBuffer[] {
    let b = this.cache.get(key);
    if (!b) {
      const sr = this.core.ctx.sampleRate;
      if (key === 'whump') b = [this.core.buffer(renderWhump(sr, 21)), this.core.buffer(renderWhump(sr, 22))];
      else {
        const spec = CLICKS[key] ?? CLICKS.pb;
        b = [];
        for (let i = 0; i < 4; i++) b.push(this.core.buffer(renderClick(sr, spec, mulberry32(this.seed++ * 7919))));
      }
      this.cache.set(key, b);
    }
    return b;
  }

  /** Pre-render the most common click kinds (call after the context is created). */
  warm(): void {
    for (const k of ['pb', 'pbm', 'sw', 'rot', 'key', 'guard', 'enc']) this.buffers(k);
  }

  private pick(pool: Slot[], now: number): Slot {
    let best = pool[0];
    for (const s of pool) {
      if (s.busyUntil <= now) return s;
      if (s.busyUntil < best.busyUntil) best = s;
    }
    return best;
  }

  private play(key: string, pool: Slot[], pos: Vec3, dbOff: number, when: number | undefined): void {
    const c = this.core;
    const now = c.now;
    const t = Math.max(now, when ?? now);
    const bufs = this.buffers(key);
    const buf = bufs[(Math.random() * bufs.length) | 0];
    const slot = this.pick(pool, now);
    setPannerPos(slot.pan, pos, t);
    slot.busyUntil = t + buf.duration + 0.05;
    if (!slot.linked) {
      slot.linked = true;
      for (const d of slot.dest) slot.pan.connect(d);
    }
    const src = c.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.05;
    const base = CLICKS[key]?.db ?? 0;
    const g = c.gain(db(base + dbOff), slot.pan);
    src.connect(g);
    if (slot.leak) g.connect(slot.leak);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      // Unlink the panner once nothing else is scheduled on it (after the HRTF tail).
      setTimeout(() => {
        if (slot.linked && slot.busyUntil <= c.now) {
          slot.linked = false;
          for (const d of slot.dest) try { slot.pan.disconnect(d); } catch { /* */ }
        }
      }, 250);
    };
    src.start(t);
  }

  /** Flight-deck one-shot (HRTF). */
  interior(key: string, pos: Vec3, dbOff = 0, when?: number): void {
    this.play(key, this.intPool, pos, dbOff, when);
  }

  /** One-shot outside the pressure hull (through the hull + openings). */
  exterior(key: string, pos: Vec3, dbOff = 0, when?: number): void {
    this.play(key, this.extPool, pos, dbOff, when);
  }

  /** 'sfx' event from the cockpit kit. */
  sfx(p: SfxPayload): void {
    if (!p) return;
    const now = this.core.now;
    const id = p.id ?? p.kind ?? '?';
    const last = this.lastById.get(id) ?? -1;
    const dtSame = now - last;
    if (dtSame < 0.012) return; // wheel storms: at most ~80 ticks/s per control
    this.lastById.set(id, now);
    const s = sfxSound(p);
    let pos: Vec3;
    if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) pos = [p.x!, p.y!, p.z!];
    else pos = panelPosition(p.id ? getControl(p.id)?.panel : undefined);
    const fast = dtSame < 0.06 ? -4 : 0;
    this.interior(s.key, pos, s.db + fast);
  }

  /** Burst of electrical contactors (bus transfer) under the floor. */
  relays(n: number): void {
    const now = this.core.now;
    for (let i = 0; i < n; i++) {
      const p = POS.elecBay;
      const pos: Vec3 = [p[0] + (Math.random() - 0.5) * 0.8, p[1], p[2] + (Math.random() - 0.5) * 0.8];
      this.interior('relay', pos, -Math.random() * 5, now + 0.01 + i * (0.02 + Math.random() * 0.06));
    }
  }
}
