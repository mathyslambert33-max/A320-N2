/**
 * sys-air module: pneumatics (bleed), air conditioning, pressurisation, avionics / cargo ventilation,
 * ice & rain protection, CFM56-5B4/P engines with their FADECs (start, ignition, thrust, limits).
 * Logic is DOM-free (only src/core/* imports) so it runs headless in vitest.
 *
 * Sim systems: 30 'air-eng.pneu', 40 'air-eng.eng', 45 'air-eng.air', 100 'air-eng.lights'.
 * Service `sim.services['sys-air']` (also `app.services['sys-air']`):
 *   model                 — internal model (debug)
 *   preset(name)          — 'enginesRunning' | 'engine1Running' | 'engine2Running' (applied on the next tick)
 *   fail(kind, n, on)     — failure injection: 'stall' | 'ign' | 'startValve' | 'hotStart' (engine n),
 *                           'bleedLeak' (engine n side), 'apuLeak', 'packOverheat' (pack n), 'ductOverheat'
 * Event `sys-air:preset` {name} — same as preset() (used by the dev scenarios).
 */
import type { Sim } from '../../core/sim';
import type { TimeOfDay } from '../../core/settings';
import { AirEngModel } from './model';
import { updateLights } from './lights';

interface AppLike {
  sim: Sim;
  settings?: { get(): { timeOfDay: TimeOfDay } };
  services?: Record<string, any>;
  headless?: boolean;
}

export type FailureKind = 'stall' | 'ign' | 'startValve' | 'hotStart' | 'bleedLeak' | 'apuLeak' | 'packOverheat' | 'ductOverheat';

export interface SysAirService {
  model: AirEngModel;
  preset(name: string): void;
  fail(kind: FailureKind, n: 1 | 2, on: boolean): void;
}

export default function install(app: AppLike): void {
  const sim = app.sim;
  const tod = (): TimeOfDay => {
    try { return app.settings?.get().timeOfDay ?? 'day'; } catch { return 'day'; }
  };
  const seed = app.headless ? 0xa1e5 : (Date.now() ^ 0x5bd1e995) >>> 0;
  const m = new AirEngModel(sim, seed, tod);

  sim.register({ name: 'air-eng.pneu', order: 30, init: (s) => m.init(s), update: (dt, s) => m.updatePneu(s, dt) });
  sim.register({
    name: 'air-eng.eng', order: 40,
    update: (dt, s) => { m.updateEngines(s, dt); m.publishEngines(s); },
  });
  sim.register({
    name: 'air-eng.air', order: 45,
    update: (dt, s) => { m.updateAir(s, dt); m.publish(s); },
  });
  sim.register({ name: 'air-eng.lights', order: 100, update: (_dt, s) => updateLights(s, m) });

  const service: SysAirService = {
    model: m,
    preset: (name) => m.requestPreset(name),
    fail(kind, n, on) {
      const f = m.eng[n - 1];
      switch (kind) {
        case 'stall': f.failStall = on; break;
        case 'ign': f.failIgn = on; break;
        case 'startValve': f.failStartValve = on; break;
        case 'hotStart': f.failRich = on; break;
        case 'bleedLeak': m.bleed.failLeak[n - 1] = on; break;
        case 'apuLeak': m.bleed.failApuLeak = on; break;
        case 'packOverheat': m.packs.failPackOverheat[n - 1] = on; break;
        case 'ductOverheat': m.packs.failDuctOverheat = on; break;
      }
    },
  };
  sim.services['sys-air'] = service;
  if (app.services) app.services['sys-air'] = service;
  sim.on('sys-air:preset', (p?: { name?: string } | string) => {
    const name = typeof p === 'string' ? p : p?.name;
    if (name) m.requestPreset(name);
  });
}
