/**
 * Audio self-test: plays every sound of the engine in sequence WITHOUT touching the sim — it drives the
 * engine through its override layer (engine.overrides), then restores the live sim values.
 *
 * Browser console (click once in the page first so the browser allows audio):
 *   window.__app.services.audio.selfTest()            // everything (~4 min)
 *   window.__app.services.audio.selfTest('alerts')    // only steps whose name contains 'alerts'
 *   window.__app.services.audio.stopSelfTest()
 * Step names: clicks, relays, alerts, cabin, battery, fans, packs, hyd-yellow, hyd-blue, ptu, fuel, apu,
 * engine, wipers, window, gpu, tug, jetbridge, ambience, horns.
 */
import type { App } from '../app';
import type { AudioEngine } from './engine';
import type { Vec3 } from './core';
import { clamp, lerp, smoothstep } from './mappings';

type Vars = Record<string, number>;

interface Step {
  name: string;
  dur: number;
  vars?: (t: number) => Vars;
  at?: Array<[number, (e: AudioEngine) => void]>;
}

const OAT = 19;

/** Neutral state: everything off, doors/windows closed (each sound is heard in isolation). */
function baseline(): Vars {
  const v: Vars = {
    'S:ELEC_AC_POWERED': 0, 'S:ELEC_AC1_BUS': 0, 'S:ELEC_AC2_BUS': 0, 'S:ELEC_AC_ESS_BUS': 0,
    'S:ELEC_DC_BAT_BUS': 0, 'S:ELEC_DC_ESS_BUS': 0, 'S:ELEC_DC1_BUS': 0, 'S:ELEC_DC2_BUS': 0,
    'S:ELEC_EXT_PWR_ON': 0, 'S:ELEC_APU_GEN_ON': 0, 'S:ELEC_GEN1_ON': 0, 'S:ELEC_GEN2_ON': 0, 'S:ELEC_STAT_INV': 0,
    'S:ELEC_HOT_BUS1': 1, 'S:ELEC_HOT_BUS2': 1,
    'S:VENT_BLOWER_ON': 0, 'S:VENT_EXTRACT_ON': 0, 'S:PACK1_FLOW': 0, 'S:PACK2_FLOW': 0, 'C:VENT_CAB_FANS': 0,
    'S:APU_N': 0, 'S:APU_EGT': OAT, 'S:APU_FLAP_POS': 0, 'S:APU_STARTING': 0, 'S:APU_BLEED_VALVE': 0, 'S:APU_SHUTTING_DOWN': 0,
    'S:HYD_Y_ELEC_PUMP_ON': 0, 'S:HYD_B_ELEC_PUMP_ON': 0, 'S:HYD_PTU_ACTIVE': 0, 'S:HYD_Y_PRESS': 0, 'S:HYD_B_PRESS': 0,
    'C:FUEL_L_PUMP1': 0, 'C:FUEL_L_PUMP2': 0, 'C:FUEL_R_PUMP1': 0, 'C:FUEL_R_PUMP2': 0, 'C:FUEL_XFEED': 0, 'S:FUEL_C_KG': 0,
    'G:GND_EXT_PWR': 0, 'G:GND_TOWBAR': 0, 'G:GND_PUSHBACK': 0, 'G:AC_GS_KT': 0,
    'G:DOOR_PAX_L1': 0, 'G:DOOR_CKPT': 0, 'G:AC_ON_GROUND': 1,
    'C:WINDOW_CAPT': 0, 'C:WINDOW_FO': 0, 'S:WIPER_CAPT_POS': 0, 'S:WIPER_FO_POS': 0,
    'S:ADIRS_ON_BAT': 0, 'S:FIRE_APU_DET': 0, 'C:EVAC_COMMAND': 0,
  };
  for (const n of [1, 2]) {
    for (const k of ['N1', 'N2', 'FF', 'START_VALVE', 'IGN_A', 'IGN_B', 'STATE']) v[`S:ENG${n}_${k}`] = 0;
    v[`S:ENG${n}_EGT`] = OAT;
  }
  return v;
}

const AC_ON: Vars = {
  'S:ELEC_AC_POWERED': 1, 'S:ELEC_AC1_BUS': 1, 'S:ELEC_AC2_BUS': 1, 'S:ELEC_AC_ESS_BUS': 1,
  'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1, 'S:ELEC_DC1_BUS': 1, 'S:ELEC_DC2_BUS': 1, 'S:ELEC_EXT_PWR_ON': 1,
  'S:VENT_BLOWER_ON': 1, 'S:VENT_EXTRACT_ON': 1,
};

/** Simplified CFM56-5B auto start profile (compressed to ~45 s) for engine n. */
function engineStart(n: number, t: number): Vars {
  const p = `S:ENG${n}_`;
  const n2 = t < 1 ? 0 : t < 30 ? lerp(0, 50, smoothstep(1, 30, t) * 0.4 + ((t - 1) / 29) * 0.6) : t < 40 ? lerp(50, 58.5, (t - 30) / 10) : 58.5;
  const fuel = n2 >= 22;
  const lightT = fuel ? clamp((n2 - 22) / 5, 0, 1) : 0;
  const n1 = n2 < 18 ? n2 * 0.1 : lerp(1.8, 19.5, clamp((n2 - 18) / 40.5, 0, 1));
  const egt = fuel ? OAT + lerp(0, 620, lightT) - 200 * clamp((n2 - 45) / 13.5, 0, 1) : OAT;
  return {
    [`${p}N2`]: n2, [`${p}N1`]: n1, [`${p}EGT`]: egt, [`${p}FF`]: fuel ? lerp(160, 290, clamp((n2 - 22) / 36, 0, 1)) : 0,
    [`${p}START_VALVE`]: t > 0.3 && n2 < 50 ? 1 : 0, [`${p}IGN_A`]: n2 >= 16 && n2 < 50 ? 1 : 0,
    [`${p}STATE`]: n2 >= 58 ? 3 : 2,
  };
}

function engineIdle(n: number): Vars {
  const p = `S:ENG${n}_`;
  return { [`${p}N2`]: 58.5, [`${p}N1`]: 19.5, [`${p}EGT`]: OAT + 420, [`${p}FF`]: 290, [`${p}STATE`]: 3 };
}

const clickPos = (x: number, y: number, z: number): Vec3 => [x, y, z];

const STEPS: Step[] = [
  {
    name: 'clicks', dur: 9,
    at: [
      ['pb', clickPos(-0.2, 2.05, -0.5)], ['pbm', clickPos(0.1, 2.05, -0.5)], ['pbmUp', clickPos(0.1, 2.05, -0.5)],
      ['sw', clickPos(-0.3, 2.05, -0.55)], ['swm', clickPos(0.3, 2.0, -0.45)], ['rot', clickPos(0.35, 2.05, -0.6)],
      ['pot', clickPos(0, 2.05, -0.3)], ['enc', clickPos(0, 1.42, -0.95)], ['enc', clickPos(0, 1.42, -0.95)],
      ['enc', clickPos(0, 1.42, -0.95)], ['key', clickPos(-0.18, 0.86, -0.62)], ['key', clickPos(-0.16, 0.86, -0.6)],
      ['guard', clickPos(-0.1, 2.05, -0.45)], ['lever', clickPos(0, 0.82, -0.2)], ['detent', clickPos(0, 0.82, -0.2)],
      ['engMaster', clickPos(0, 0.82, -0.15)], ['parkBrake', clickPos(0, 0.78, 0.05)], ['gear', clickPos(0.3, 0.92, -1.0)],
      ['window', clickPos(-0.95, 1.2, -0.1)], ['trim', clickPos(-0.2, 0.7, -0.2)],
    ].map(([k, p], i) => [0.3 + i * 0.42, (e: AudioEngine) => e.shots.interior(k as string, p as Vec3)] as [number, (e: AudioEngine) => void]),
  },
  { name: 'relays', dur: 2.5, at: [[0.2, (e) => e.shots.relays(3)], [1.3, (e) => e.shots.relays(2)]] },
  {
    name: 'alerts', dur: 19,
    at: [
      [0.2, (e) => e.fwc('SC')],
      [1.8, (e) => e.fwc('CRC')], [5.0, (e) => e.fwc('STOP_CRC')],
      [6.0, (e) => e.fwc('CAVALRY')],
      [8.2, (e) => e.fwc('CCHORD')],
      [10.4, (e) => e.fwc('CLICK')],
      [11.4, (e) => e.fwc('TRIPLECLICK')],
      [12.8, (e) => e.fwc({ sound: 'BUZZER', duration: 1.2 })],
      [14.8, (e) => e.fwc('CRICKET')], [16.8, (e) => e.fwc('STOP_CRICKET')],
    ],
  },
  {
    name: 'cabin', dur: 8, vars: (t) => ({ 'G:DOOR_CKPT': t < 5 ? 1 : 0 }),
    at: [[0.3, (e) => e.cabinChime({ type: 'lo' })], [2.6, (e) => e.cabinChime({ type: 'hilo' })], [5.5, (e) => e.cabinChime({ type: 'lo' })]],
  },
  { name: 'battery', dur: 5, vars: () => ({ 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1 }) },
  {
    name: 'fans', dur: 22,
    vars: (t) => (t < 12 || t > 18 ? { ...AC_ON } : { 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1 }),
  },
  {
    name: 'packs', dur: 9,
    vars: (t) => ({ ...AC_ON, 'S:PACK1_FLOW': clamp((t - 0.5) / 2, 0, 1), 'S:PACK2_FLOW': clamp((t - 2) / 2, 0, 1) * (t < 7.5 ? 1 : 0) }),
  },
  {
    name: 'hyd-yellow', dur: 7,
    vars: (t) => ({ ...AC_ON, 'S:HYD_Y_ELEC_PUMP_ON': t > 0.3 && t < 5.5 ? 1 : 0, 'S:HYD_Y_PRESS': t > 0.3 && t < 5.5 ? clamp((t - 0.5) * 1500, 0, 3000) : 0 }),
  },
  {
    name: 'hyd-blue', dur: 5,
    vars: (t) => ({ ...AC_ON, 'S:HYD_B_ELEC_PUMP_ON': t > 0.3 && t < 3.8 ? 1 : 0, 'S:HYD_B_PRESS': t > 0.3 && t < 3.8 ? clamp((t - 0.5) * 1500, 0, 3000) : 0 }),
  },
  {
    // Barks (PTU transient) then a steady run after ~7 s.
    name: 'ptu', dur: 20,
    vars: (t) => ({ ...AC_ON, 'S:HYD_PTU_ACTIVE': (t > 0.3 && t < 5.5) || (t > 7.5 && t < 18) ? 1 : 0 }),
  },
  {
    name: 'fuel', dur: 7,
    vars: (t) => ({
      ...AC_ON, 'C:FUEL_L_PUMP1': 1, 'C:FUEL_L_PUMP2': 1, 'C:FUEL_R_PUMP1': 1, 'C:FUEL_R_PUMP2': 1,
      'C:FUEL_XFEED': t > 2 && t < 5 ? 1 : 0, 'C:WINDOW_CAPT': 1,
    }),
  },
  {
    name: 'apu', dur: 62,
    vars: (t) => {
      const flap = t < 4 ? clamp((t - 0.5) / 3, 0, 1) : t < 52 ? 1 : clamp(1 - (t - 52) / 3, 0, 1);
      const n = t < 4 ? 0 : t < 34 ? 100 * Math.pow(smoothstep(4, 34, t), 0.8) : t < 44 ? 100 : clamp(100 - (t - 44) * 6, 0, 100);
      const egt = t < 9 ? OAT : t < 34 ? OAT + 680 * smoothstep(9, 18, t) - 250 * smoothstep(22, 34, t) : t < 44 ? OAT + 400 : OAT + 400 * clamp(1 - (t - 44) / 12, 0, 1);
      return {
        ...AC_ON, 'S:APU_FLAP_POS': flap, 'S:APU_N': n, 'S:APU_EGT': egt, 'S:APU_STARTING': t > 4 && n < 55 && t < 34 ? 1 : 0,
        'S:APU_BLEED_VALVE': t > 36 && t < 44 ? 1 : 0, 'S:PACK1_FLOW': t > 37 && t < 44 ? 1 : 0, 'S:PACK2_FLOW': t > 37 && t < 44 ? 1 : 0,
        'S:APU_SHUTTING_DOWN': t > 44 ? 1 : 0,
      };
    },
  },
  {
    name: 'engine', dur: 75,
    vars: (t) => {
      const base = { ...AC_ON, 'S:ELEC_EXT_PWR_ON': 0, 'S:ELEC_APU_GEN_ON': 1, 'S:APU_N': 100, 'S:APU_EGT': OAT + 380, 'S:APU_FLAP_POS': 1,
        'S:APU_BLEED_VALVE': 1, 'S:PACK1_FLOW': 0, 'S:PACK2_FLOW': 0 };
      if (t < 50) return { ...base, ...engineStart(2, t) };
      // Shutdown: fuel off at 55 s, spool down.
      const d = Math.max(0, t - 55);
      const n2 = t < 55 ? 58.5 : 58.5 * Math.exp(-d / 7);
      return { ...base, 'S:ENG2_N2': n2, 'S:ENG2_N1': t < 55 ? 19.5 : 19.5 * Math.exp(-d / 9), 'S:ENG2_EGT': t < 55 ? OAT + 420 : OAT + 420 * Math.exp(-d / 6),
        'S:ENG2_FF': t < 55 ? 290 : 0, 'S:ENG2_STATE': t < 55 ? 3 : 4 };
    },
  },
  {
    name: 'wipers', dur: 12,
    vars: (t) => {
      const slow = t < 6;
      const per = slow ? 1.7 : 1.05;
      const pos = t > 10.5 ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / per);
      return { ...AC_ON, 'S:WIPER_CAPT_POS': pos, 'S:WIPER_FO_POS': pos };
    },
  },
  {
    // Slide the captain window open with both engines idling and the APU running, then close it.
    name: 'window', dur: 14,
    vars: (t) => ({
      ...AC_ON, ...engineIdle(1), ...engineIdle(2), 'S:APU_N': 100, 'S:APU_EGT': OAT + 380,
      'C:WINDOW_CAPT': t < 3 ? 0 : t < 4.5 ? (t - 3) / 1.5 : t < 10 ? 1 : t < 11.5 ? 1 - (t - 10) / 1.5 : 0,
    }),
  },
  { name: 'gpu', dur: 9, vars: (t) => ({ 'G:GND_EXT_PWR': 1, ...(t > 4 ? AC_ON : {}), 'C:WINDOW_CAPT': t > 6 ? 1 : 0 }) },
  {
    name: 'tug', dur: 16,
    vars: (t) => ({ ...AC_ON, 'G:GND_TOWBAR': t < 14 ? 1 : 0, 'G:GND_PUSHBACK': t > 4 && t < 12 ? 1 : t >= 12 ? 2 : 0, 'G:AC_GS_KT': t > 5 && t < 12 ? 2.5 : 0 }),
  },
  {
    // Docked hum, then the bridge drives away (motors + beeper) and comes back.
    name: 'jetbridge', dur: 30,
    vars: (t) => ({ ...AC_ON, 'G:JETBRIDGE': t < 4 || t > 17 ? 1 : 0, 'G:DOOR_PAX_L1': 1, 'G:DOOR_CKPT': 1 }),
  },
  {
    name: 'ambience', dur: 20,
    vars: () => ({ 'G:DOOR_PAX_L1': 1, 'G:DOOR_CKPT': 1, 'C:WINDOW_FO': 1 }),
    at: [[0.5, (e) => e.ambience.trigger('taxi')], [4, (e) => e.ambience.trigger('beeper')], [9, (e) => e.ambience.trigger('takeoff')]],
  },
  {
    name: 'horns', dur: 9,
    vars: (t) => ({
      'S:ELEC_DC_BAT_BUS': 1, 'S:ADIRS_ON_BAT': t < 4 ? 1 : 0, 'C:EVAC_COMMAND': t > 5 && t < 8.5 ? 1 : 0,
    }),
  },
];

let running: { cancelled: boolean } | null = null;

export function stopAudioSelfTest(engine: AudioEngine | null | undefined): void {
  if (running) running.cancelled = true;
  if (engine) {
    engine.overrides.clear();
    engine.alerts.stopAll();
  }
}

/**
 * Play the self-test (optionally only the steps whose name contains `filter`).
 * `engine` defaults to app.services.audio.engine (the context is resumed first).
 */
export async function audioSelfTest(app: App, engineOrFilter?: AudioEngine | null | string, filterArg?: string): Promise<void> {
  const filter = typeof engineOrFilter === 'string' ? engineOrFilter : filterArg;
  let engine = typeof engineOrFilter === 'object' && engineOrFilter ? engineOrFilter : null;
  if (!engine) {
    await app.services.audio?.resume?.();
    engine = app.services.audio?.engine ?? null;
  }
  if (!engine) {
    console.warn('[audio] self-test: no audio engine (click in the page first)');
    return;
  }
  const e = engine;
  if (running) running.cancelled = true;
  const me = { cancelled: false };
  running = me;
  const steps = STEPS.filter((s) => !filter || s.name.includes(filter));
  const base = baseline();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  console.info(`[audio] self-test: ${steps.map((s) => s.name).join(', ')} (${Math.round(steps.reduce((a, s) => a + s.dur, 0))} s)`);
  try {
    for (const step of steps) {
      if (me.cancelled) break;
      console.info(`[audio] self-test ▶ ${step.name} (${step.dur} s)`);
      const t0 = performance.now();
      const pending = [...(step.at ?? [])].sort((a, b) => a[0] - b[0]);
      for (;;) {
        if (me.cancelled) break;
        const t = (performance.now() - t0) / 1000;
        if (t > step.dur) break;
        const vars = { ...base, ...(step.vars ? step.vars(t) : {}) };
        for (const k in vars) e.overrides.set(k, vars[k]);
        while (pending.length && pending[0][0] <= t) {
          const [, fn] = pending.shift()!;
          try { fn(e); } catch (err) { console.error('[audio] self-test action', err); }
        }
        await sleep(33);
      }
      e.alerts.stopAll();
    }
  } finally {
    if (running === me) running = null;
    e.overrides.clear();
    console.info('[audio] self-test done');
  }
}

/** Exposed for docs/tests: the list of step names. */
export const SELFTEST_STEPS = STEPS.map((s) => s.name);
