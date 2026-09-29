/**
 * Display units of the EFIS (CAPT PFD / ND, F/O ND / PFD).
 *
 *  - Supplies: CAPT PFD = AC ESS BUS, CAPT ND = AC ESS SHED BUS, F/O PFD and ND = AC BUS 2.
 *  - A DU switched on after a long interruption (or with its brightness knob back from OFF) runs a
 *    self test (SELF TEST IN PROGRESS / MAX 40 SECONDS) before showing its image. A DU that lost
 *    its supply for less than 10 s restarts at once (STANDBY state).
 *  - Images: PFD on the PFD DU and ND on the ND DU; PFD/ND XFR pb swaps them; when the PFD DU is
 *    off (brightness knob OFF) or failed, the PFD image is transferred automatically to the ND DU.
 *  - No DMC available for the side (EIS DMC switching) → INVALID DATA.
 * DOM-free.
 */
import type { Sim, SimSystem } from '../../../core/sim';
import { dmcAvailable, dmcForSide, power, type Side } from './sources';

export const DU_IDS = ['PFD1', 'ND1', 'PFD2', 'ND2'] as const;
export type DuId = (typeof DU_IDS)[number];
export const DU_STATE = { OFF: 0, SELF_TEST: 1, ON: 2, STANDBY: 3 } as const;
export const DU_CONTENT = { PFD: 0, ND: 1, INVALID: 2 } as const;

/** Self-test duration of each DU (s) — they never finish together on the aircraft. */
export const SELF_TEST_TIME: Record<DuId, number> = { PFD1: 24, ND1: 27, PFD2: 25, ND2: 28 };
/** Supply interruption tolerated without a new self test (s). */
export const STANDBY_TIME = 10;

export function duSupply(sim: Sim, id: DuId): boolean {
  switch (id) {
    case 'PFD1': return power.acEss(sim);
    case 'ND1': return power.acEssShed(sim);
    default: return power.ac2(sim);
  }
}

/** Brightness knob of a DU (C:MAIN_PFDn_BRT / C:MAIN_NDn_BRT), 0 = OFF. */
export function duKnob(sim: Sim, id: DuId): number {
  const c = `C:MAIN_${id.startsWith('PFD') ? 'PFD' : 'ND'}${id.slice(-1)}_BRT`;
  return sim.has(c) ? sim.get(c) : 0.8;
}

/** Screen brightness 0..1 from the knob (0 when OFF). */
export function duBrightness(sim: Sim, id: DuId): number {
  const k = duKnob(sim, id);
  return k <= 0.02 ? 0 : 0.3 + 0.7 * Math.min(1, k);
}

export class DuLogic implements SimSystem {
  readonly name = 'pfdnd-du';
  readonly order = 85;
  private timer: Record<DuId, number> = { PFD1: 0, ND1: 0, PFD2: 0, ND2: 0 };

  constructor(sim: Sim) {
    sim.on('MAIN_PFD_ND_XFR_CAPT:press', () => sim.set('S:PFDND_XFR_1', sim.getB('S:PFDND_XFR_1') ? 0 : 1));
    sim.on('MAIN_PFD_ND_XFR_FO:press', () => sim.set('S:PFDND_XFR_2', sim.getB('S:PFDND_XFR_2') ? 0 : 1));
  }

  init(sim: Sim): void {
    for (const id of DU_IDS) {
      // A DU already supplied when the simulation starts (scenario / dev harness) starts warm.
      const on = duSupply(sim, id) && duKnob(sim, id) > 0.02;
      sim.init(`S:PFDND_DU_${id}_STATE`, on ? DU_STATE.ON : DU_STATE.OFF);
      sim.init(`S:PFDND_DU_${id}_TEST_REMAIN`, 0);
      if (sim.get(`S:PFDND_DU_${id}_STATE`) === DU_STATE.SELF_TEST) {
        this.timer[id] = sim.get(`S:PFDND_DU_${id}_TEST_REMAIN`) || SELF_TEST_TIME[id];
      }
    }
    sim.init('S:PFDND_XFR_1', 0);
    sim.init('S:PFDND_XFR_2', 0);
  }

  update(dt: number, sim: Sim): void {
    for (const id of DU_IDS) {
      const v = `S:PFDND_DU_${id}_STATE`;
      const on = duSupply(sim, id) && duKnob(sim, id) > 0.02;
      let st = sim.get(v);
      switch (st) {
        case DU_STATE.OFF:
          if (on) { st = DU_STATE.SELF_TEST; this.timer[id] = SELF_TEST_TIME[id]; }
          break;
        case DU_STATE.SELF_TEST:
          if (!on) st = DU_STATE.OFF;
          else {
            this.timer[id] -= dt;
            if (this.timer[id] <= 0) st = DU_STATE.ON;
          }
          break;
        case DU_STATE.ON:
          if (!on) { st = DU_STATE.STANDBY; this.timer[id] = STANDBY_TIME; }
          break;
        case DU_STATE.STANDBY:
          if (on) st = DU_STATE.ON;
          else {
            this.timer[id] -= dt;
            if (this.timer[id] <= 0) st = DU_STATE.OFF;
          }
          break;
        default:
          st = DU_STATE.OFF;
      }
      sim.set(v, st);
      sim.set(`S:PFDND_DU_${id}_TEST_REMAIN`, st === DU_STATE.SELF_TEST ? Math.max(0, Math.ceil(this.timer[id])) : 0);
    }

    for (const n of [1, 2] as Side[]) {
      const pfd = `PFD${n}` as DuId;
      const nd = `ND${n}` as DuId;
      const xfr = sim.getB(`S:PFDND_XFR_${n}`);
      const pfdOn = sim.get(`S:PFDND_DU_${pfd}_STATE`) === DU_STATE.ON;
      const ndOn = sim.get(`S:PFDND_DU_${nd}_STATE`) === DU_STATE.ON;
      let pfdContent: number = xfr ? DU_CONTENT.ND : DU_CONTENT.PFD;
      let ndContent: number = xfr ? DU_CONTENT.PFD : DU_CONTENT.ND;
      // Automatic transfer: the PFD image has priority.
      if (!xfr && !pfdOn && ndOn) ndContent = DU_CONTENT.PFD;
      if (xfr && !ndOn && pfdOn) pfdContent = DU_CONTENT.PFD;
      if (!dmcAvailable(sim, dmcForSide(sim, n))) {
        pfdContent = DU_CONTENT.INVALID;
        ndContent = DU_CONTENT.INVALID;
      }
      sim.set(`S:PFDND_DU_${pfd}_CONTENT`, pfdContent);
      sim.set(`S:PFDND_DU_${nd}_CONTENT`, ndContent);
    }
  }
}
