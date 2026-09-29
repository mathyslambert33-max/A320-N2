/**
 * ISIS (Integrated Standby Instrument System): own inertial and air data sensors.
 *
 *  - Supply: DC ESS BUS, or DC HOT BUS 1 when IAS > 50 kt.
 *  - After a supply interruption longer than 2 s: INIT for 90 s (attitude, speed and altitude
 *    boxed "INIT" with the remaining time), then normal display.
 *  - BARO knob: ±1 hPa; push toggles STD. LS pb: ILS deviation scales. BUGS pb: bugs page.
 *    + / − pbs: brightness. RST: attitude reset (no effect on ground once aligned).
 * DOM-free.
 */
import type { Sim, SimSystem } from '../../../core/sim';
import { clamp } from '../../../core/sim';
import { power } from './sources';

export const ISIS_STATE = { OFF: 0, INIT: 1, ON: 2 } as const;
export const ISIS_INIT_TIME = 90;
const INTERRUPT_TOLERANCE = 2;

type EncPayload = { steps?: number } | undefined;

export function isisSupply(sim: Sim): boolean {
  return power.dcEss(sim) || (power.dcHot1(sim) && sim.get('S:ADIRS_IAS') > 50);
}

export class IsisLogic implements SimSystem {
  readonly name = 'pfdnd-isis';
  readonly order = 85;
  private offFor = 1e9;
  private initRemain = 0;

  constructor(sim: Sim) {
    const on = (ev: string, fn: (p?: any) => void) => sim.on(ev, (p) => { if (sim.get('S:ISIS_STATE') !== ISIS_STATE.OFF) fn(p); });
    const turn = (p: EncPayload, dir: number) => {
      if (sim.getB('S:ISIS_BUGS_PAGE')) return;
      const n = Math.max(1, Math.round(p?.steps ?? 1)) * dir;
      sim.set('S:ISIS_BARO_HPA', clamp(Math.round(sim.get('S:ISIS_BARO_HPA')) + n, 745, 1100));
    };
    on('ISIS_BARO:inc', (p) => turn(p, 1));
    on('ISIS_BARO:dec', (p) => turn(p, -1));
    on('ISIS_BARO:push', () => sim.set('S:ISIS_BARO_STD', sim.getB('S:ISIS_BARO_STD') ? 0 : 1));
    on('ISIS_LS:press', () => sim.set('S:ISIS_LS', sim.getB('S:ISIS_LS') ? 0 : 1));
    on('ISIS_BUGS:press', () => sim.set('S:ISIS_BUGS_PAGE', sim.getB('S:ISIS_BUGS_PAGE') ? 0 : 1));
    on('ISIS_PLUS:press', () => sim.set('S:ISIS_BRT', clamp(Math.round((sim.get('S:ISIS_BRT') + 0.1) * 10) / 10, 0.1, 1)));
    on('ISIS_MINUS:press', () => sim.set('S:ISIS_BRT', clamp(Math.round((sim.get('S:ISIS_BRT') - 0.1) * 10) / 10, 0.1, 1)));
  }

  init(sim: Sim): void {
    const warm = isisSupply(sim);
    sim.init('S:ISIS_STATE', warm ? ISIS_STATE.ON : ISIS_STATE.OFF);
    sim.init('S:ISIS_INIT_REMAIN', 0);
    sim.init('S:ISIS_BARO_HPA', 1013);
    sim.init('S:ISIS_BARO_STD', 0);
    sim.init('S:ISIS_LS', 0);
    sim.init('S:ISIS_BUGS_PAGE', 0);
    sim.init('S:ISIS_BRT', 0.8);
    if (sim.get('S:ISIS_STATE') === ISIS_STATE.INIT) this.initRemain = sim.get('S:ISIS_INIT_REMAIN') || ISIS_INIT_TIME;
    if (sim.get('S:ISIS_STATE') !== ISIS_STATE.OFF) this.offFor = 0;
  }

  update(dt: number, sim: Sim): void {
    const pw = isisSupply(sim);
    sim.set('S:ISIS_POWERED', pw);
    let st = sim.get('S:ISIS_STATE');
    if (!pw) {
      this.offFor += dt;
      if (this.offFor > INTERRUPT_TOLERANCE) st = ISIS_STATE.OFF;
    } else {
      if (st === ISIS_STATE.OFF || this.offFor > INTERRUPT_TOLERANCE) {
        st = ISIS_STATE.INIT;
        this.initRemain = ISIS_INIT_TIME;
      }
      this.offFor = 0;
      if (st === ISIS_STATE.INIT) {
        this.initRemain -= dt;
        if (this.initRemain <= 0) st = ISIS_STATE.ON;
      }
    }
    sim.set('S:ISIS_STATE', st);
    sim.set('S:ISIS_INIT_REMAIN', st === ISIS_STATE.INIT ? Math.max(0, Math.ceil(this.initRemain)) : 0);
  }
}
