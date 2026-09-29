/**
 * Flight guidance status seen by the PFD (FMA, FD bars, speed target) — the ground part of the
 * FMGC FG function, enough for a free-mode session from cold & dark to take-off.
 *
 *  - FD n engaged = FD pb on + FMGC available + attitude valid on that side.
 *  - Take-off: thrust levers at FLX/MCT (35°) or TOGA (45°) on ground with V2 entered →
 *    SRS (+ RWY with a localizer tuned), CLB armed, NAV armed (flight plan + HDG managed).
 *    Modes clear when the thrust levers come back below CL on ground (rejected take-off).
 *  - A/THR mode (column 1): MAN TOGA / MAN FLX xx / MAN MCT while armed on ground.
 *  - Speed target: managed = V2 during preflight/take-off, selected = FCU value.
 * Mode changes are time-stamped (S:FG_T_*) so the PFD can draw the 10 s white boxes.
 * DOM-free.
 */
import type { Sim, SimSystem } from '../../../core/sim';
import { fmgcAvailable, onGround, sideData, type Side } from './sources';
import { machToCas } from './fcu';

export const THR_MODE = { NONE: 0, MAN_TOGA: 1, MAN_FLX: 2, MAN_MCT: 3, MAN_THR: 4 } as const;
export const VERT_MODE = { NONE: 0, SRS: 1, CLB: 2, OP_CLB: 3, ALT: 4, VS: 5 } as const;
export const VERT_ARMED = { NONE: 0, CLB: 1, ALT: 2 } as const;
export const LAT_MODE = { NONE: 0, RWY: 1, RWY_TRK: 2, HDG: 3, TRK: 4, NAV: 5 } as const;
export const LAT_ARMED = { NONE: 0, NAV: 1 } as const;

/** TLA (deg) of the detents. */
export const TLA_CL = 25;
export const TLA_FLX = 35;
export const TLA_TOGA = 45;

export class FgLogic implements SimSystem {
  readonly name = 'pfdnd-fg';
  readonly order = 82;
  private toEngaged = false;

  init(sim: Sim): void {
    for (const v of ['S:FG_THR_MODE', 'S:FG_VERT_ACTIVE', 'S:FG_VERT_ARMED', 'S:FG_LAT_ACTIVE', 'S:FG_LAT_ARMED']) sim.init(v, 0);
    this.toEngaged = sim.get('S:FG_VERT_ACTIVE') === VERT_MODE.SRS;
  }

  private setMode(sim: Sim, v: string, t: string, value: number): void {
    if (sim.get(v) !== value) {
      sim.set(v, value);
      sim.set(t, value ? sim.time : -100);
    }
  }

  update(_dt: number, sim: Sim): void {
    const ground = onGround(sim);
    const fmgc = fmgcAvailable(sim);

    // Flight directors.
    for (const n of [1, 2] as Side[]) {
      const eng = sim.getB('S:FCU_POWERED') && sim.getB(`S:FCU_FD${n}`) && fmgcAvailable(sim, n) && sideData(sim, n).attValid;
      sim.set(`S:FG_FD${n}_ENGAGED`, eng);
    }

    const tla = Math.max(sim.get('C:THR_LEVER1'), sim.get('C:THR_LEVER2'));
    const v2 = sim.get('S:FMGS_V2');
    const flex = sim.get('S:FMGS_FLEX');
    const fpln = sim.getB('S:FMGS_FPLN_ACTIVE');
    const hdgManaged = sim.getB('S:FCU_HDG_MANAGED');
    const locTuned = sim.get('S:NAV_ILS_FREQ') > 0;

    if (ground) {
      if (!this.toEngaged && fmgc && v2 > 0 && tla >= TLA_FLX - 0.5) this.toEngaged = true;
      if (this.toEngaged && (tla < TLA_CL - 0.5 || !fmgc)) this.toEngaged = false;
    }

    let vert: number = VERT_MODE.NONE;
    let vertArmed: number = VERT_ARMED.NONE;
    let lat: number = LAT_MODE.NONE;
    let latArmed: number = LAT_ARMED.NONE;
    if (this.toEngaged) {
      vert = VERT_MODE.SRS;
      vertArmed = VERT_ARMED.CLB;
      lat = locTuned ? LAT_MODE.RWY : LAT_MODE.NONE;
      latArmed = fpln && hdgManaged ? LAT_ARMED.NAV : LAT_ARMED.NONE;
    }
    this.setMode(sim, 'S:FG_VERT_ACTIVE', 'S:FG_T_VERT', vert);
    this.setMode(sim, 'S:FG_VERT_ARMED', 'S:FG_T_VERT_ARMED', vertArmed);
    this.setMode(sim, 'S:FG_LAT_ACTIVE', 'S:FG_T_LAT', lat);
    this.setMode(sim, 'S:FG_LAT_ARMED', 'S:FG_T_LAT_ARMED', latArmed);

    // A/THR mode (column 1): on ground the A/THR is armed with the levers in a detent.
    let thr: number = THR_MODE.NONE;
    if (sim.get('S:FCU_ATHR') === 1 && ground) {
      if (tla >= TLA_TOGA - 0.5) thr = THR_MODE.MAN_TOGA;
      else if (tla >= TLA_FLX - 0.5) thr = flex > 0 ? THR_MODE.MAN_FLX : THR_MODE.MAN_MCT;
    }
    this.setMode(sim, 'S:FG_THR_MODE', 'S:FG_T_THR', thr);
    sim.set('S:FG_FLX_TEMP', flex);
    const ap = (sim.getB('S:FCU_AP1') ? 1 : 0) + (sim.getB('S:FCU_AP2') ? 2 : 0);
    this.setMode(sim, 'S:FG_AP_STATE', 'S:FG_T_AP', ap);
    this.setMode(sim, 'S:FG_ATHR_STATE', 'S:FG_T_ATHR', sim.get('S:FCU_ATHR'));

    // Speed target.
    const phase = sim.get('S:FMGS_PHASE');
    const managed = fmgc && phase <= 1 && v2 > 0 ? v2 : 0;
    sim.set('S:FG_MANAGED_SPD', managed);
    const fcuManaged = sim.getB('S:FCU_SPD_MANAGED');
    if (!sim.getB('S:FCU_POWERED') && !fmgc) {
      sim.set('S:FG_SPD_TARGET', 0);
      sim.set('S:FG_SPD_TARGET_MANAGED', 0);
    } else if (fcuManaged) {
      sim.set('S:FG_SPD_TARGET', managed);
      sim.set('S:FG_SPD_TARGET_MANAGED', managed > 0);
    } else {
      const v = sim.get('S:FCU_SPD');
      const cas = sim.getB('S:FCU_SPD_IS_MACH') ? machToCas(v / 100, sideData(sim, 1).altStd) : v;
      sim.set('S:FG_SPD_TARGET', cas);
      sim.set('S:FG_SPD_TARGET_MANAGED', 0);
    }

    // FD commands: on ground in SRS/RWY the bars are centred (pitch target = ground attitude).
    sim.set('S:FG_FD_PITCH', 0);
    sim.set('S:FG_FD_ROLL', 0);
    sim.set('S:FG_FD_YAW', 0);
  }
}
