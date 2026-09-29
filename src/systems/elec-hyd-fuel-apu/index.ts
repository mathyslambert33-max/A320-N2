/**
 * sys-elec module: electrical network, hydraulics (+ brakes, accumulator, NWS availability), fuel, APU.
 * Logic is DOM-free (runs in vitest through HeadlessApp); only displays.ts touches the Canvas.
 *
 * Sim systems (fixed 30 Hz step):
 *   10 'elec'        network, batteries/BCL, sources & contactors, SD ELEC values
 *   20 'apu'         APS 3200 ECB, flap, start/run/stop, bleed valve
 *   50 'hyd'         G/B/Y pumps, PTU, RAT, reservoirs
 *   55 'brakes'      accumulator, alternate/normal/parking brake pressures, temperatures, NWS
 *   60 'fuel'        tanks, pumps, CTR AUTO logic, valves, consumption
 *   99 'elec-lights' annunciator lights of the owned panels
 *
 * Service `sim.services['sys-elec']` (also `app.services['sys-elec']`):
 *   preset(name)  — force a state ('batOnly', 'extPwr', 'apuStarting', 'apuRunning', …, see presets.ts)
 *   model         — internal model (debug)
 */
import type { Sim } from '../../core/sim';
import { makeRng } from './common';
import type { Model } from './model';
import { ElecModel } from './elec';
import { ApuModel } from './apu';
import { HydModel } from './hyd';
import { BrakeModel } from './brakes';
import { FuelModel } from './fuel';
import { updateLights } from './lights';
import { PRESETS, applyPreset } from './presets';

interface AppLike {
  sim: Sim;
  services?: Record<string, any>;
  headless?: boolean;
  isHarness?: boolean;
}

export interface SysElecService {
  model: Model;
  presets: readonly string[];
  preset(name: string): boolean;
}

export default function install(app: AppLike): void {
  const sim = app.sim;
  const seed = app.headless ? 0x5eed1 : (Date.now() ^ 0x9e3779b9) >>> 0;
  const m = { rng: makeRng(seed) } as Model;
  m.elec = new ElecModel(m);
  m.apu = new ApuModel(m);
  m.hyd = new HydModel(m);
  m.brk = new BrakeModel(m);
  m.fuel = new FuelModel(m);

  let started = false;
  const pending: string[] = [];
  const service: SysElecService = {
    model: m,
    presets: PRESETS,
    preset(name: string) {
      if (!started) {
        pending.push(name);
        return (PRESETS as readonly string[]).includes(name);
      }
      return applyPreset(sim, m, name);
    },
  };
  sim.services['sys-elec'] = service;
  if (app.services) app.services['sys-elec'] = service;

  sim.register({
    name: 'elec',
    order: 10,
    init(s) {
      m.elec.init(s);
      m.apu.init(s);
      m.hyd.init(s);
      m.brk.init(s);
      m.fuel.init(s);
      started = true;
      for (const p of pending.splice(0)) applyPreset(s, m, p);
      // publish battery voltages immediately (BAT windows readable from the first frame)
      s.set('S:ELEC_BAT1_V', Math.round(m.elec.bat[0].voltage * 100) / 100);
      s.set('S:ELEC_BAT2_V', Math.round(m.elec.bat[1].voltage * 100) / 100);
      s.set('S:ELEC_HOT_BUS1', 1);
      s.set('S:ELEC_HOT_BUS2', 1);
    },
    update: (dt, s) => m.elec.update(dt, s),
  });
  sim.register({ name: 'apu', order: 20, update: (dt, s) => m.apu.update(dt, s) });
  sim.register({ name: 'hyd', order: 50, update: (dt, s) => m.hyd.update(dt, s) });
  sim.register({ name: 'brakes', order: 55, update: (dt, s) => m.brk.update(dt, s) });
  sim.register({ name: 'fuel', order: 60, update: (dt, s) => m.fuel.update(dt, s) });
  sim.register({ name: 'elec-lights', order: 99, update: (_dt, s) => updateLights(s, m) });

  if (typeof document !== 'undefined') {
    import('./displays').then((d) => d.registerBatDisplays()).catch((e) => console.error('[sys-elec] displays', e));
  }
}
