/**
 * sys-air test helpers: headless app with the sys-air logic only. The electrical network, the APU bleed
 * and the fuel feed (owned by sys-elec) are faked with a tiny system at order 20 so the tests do not depend
 * on another module's internals.
 */
import { headlessApp, installLogic, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import install, { type SysAirService } from '../../src/systems/air-eng/index';

export interface Rig {
  sim: Sim;
  air: SysAirService;
  /** Fake sys-elec state. */
  fake: { power: boolean; apuBleed: boolean; fuel: boolean };
}

const BUSES = [
  'S:ELEC_HOT_BUS1', 'S:ELEC_HOT_BUS2', 'S:ELEC_DC_BAT_BUS', 'S:ELEC_DC_ESS_BUS', 'S:ELEC_DC_ESS_SHED', 'S:ELEC_DC1_BUS',
  'S:ELEC_DC2_BUS', 'S:ELEC_AC1_BUS', 'S:ELEC_AC2_BUS', 'S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC_POWERED',
  'S:ANN_POWER',
];

export async function rig(opts: { power?: boolean; timeOfDay?: 'day' | 'dusk' | 'night' } = {}): Promise<Rig> {
  const app = headlessApp({ timeOfDay: opts.timeOfDay });
  const fake = { power: opts.power ?? true, apuBleed: false, fuel: true };
  await installLogic(app, [install]);
  const sim = app.sim;
  // Fake sys-elec: buses, APU bleed (same droop law as sys-elec: 39 psi − 5.5 psi per kg/s of demand),
  // LP fuel valves (open with MASTER ON unless ENG FIRE pb released) and fuel feed.
  sim.register({
    name: 'fake-elec', order: 20,
    update: (_dt, s) => {
      for (const b of BUSES) s.set(b, fake.power ? 1 : 0);
      const demand = (s.get('S:PACK1_FLOW') + s.get('S:PACK2_FLOW')) * 0.45
        + (s.getB('S:ENG1_START_VALVE') || s.getB('S:ENG2_START_VALVE') ? 0.9 : 0)
        + (s.getB('S:AI_WING_VALVE_L') ? 0.2 : 0);
      const on = fake.apuBleed && fake.power && s.get('C:AIR_APU_BLEED') > 0.5;
      s.set('S:APU_AVAIL', fake.apuBleed ? 1 : 0);
      s.set('S:APU_BLEED_VALVE', on ? 1 : 0);
      s.set('S:APU_BLEED_PRESS', on ? 39 - 5.5 * Math.min(1.3, demand) : 0);
      for (const n of [1, 2]) {
        const master = s.get(`C:ENG_MASTER${n}`) < 0.5;
        s.set(`S:FUEL_ENG${n}_LP_VALVE`, master && s.get(`C:FIRE_ENG${n}_PB`) < 0.5 ? 1 : 0);
        s.set(`S:FUEL_ENG${n}_FEED`, fake.fuel ? 1 : 0);
      }
    },
  });
  sim.run(0.5);
  return { sim, air: sim.services['sys-air'] as SysAirService, fake };
}

export function pb(sim: Sim, id: string, value: number): void {
  setControl(sim, id, value);
}

/** ENG MASTER switch: catalog position 0 = ON. */
export function master(sim: Sim, n: 1 | 2, on: boolean): void {
  setControl(sim, `ENG_MASTER${n}`, on ? 0 : 1);
}

/** ENG MODE selector: 0 CRANK, 1 NORM, 2 IGN/START. */
export function mode(sim: Sim, m: 0 | 1 | 2): void {
  setControl(sim, 'ENG_MODE', m);
}

/** APU running with its bleed pb ON. */
export function apuBleedOn(r: Rig): void {
  r.fake.apuBleed = true;
  pb(r.sim, 'AIR_APU_BLEED', 1);
  r.sim.run(5);
}

export interface Sample { t: number; [k: string]: number }

/** Run `seconds`, sampling the given vars every `every` s. */
export function record(sim: Sim, seconds: number, vars: string[], every = 0.1): Sample[] {
  const out: Sample[] = [];
  const t0 = sim.time;
  let next = 0;
  const n = Math.round(seconds / sim.step);
  for (let i = 0; i < n; i++) {
    sim.tick(sim.step);
    const t = sim.time - t0;
    if (t >= next - 1e-9) {
      const s: Sample = { t: Math.round(t * 100) / 100 };
      for (const v of vars) s[v] = sim.get(v);
      out.push(s);
      next += every;
    }
  }
  return out;
}

/** First sample where pred is true (or undefined). */
export function first(samples: Sample[], pred: (s: Sample) => boolean): Sample | undefined {
  return samples.find(pred);
}
