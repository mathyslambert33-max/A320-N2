/**
 * UI dev scenarios: /dev.html?module=ui&mods=overhead,mainpanel&power=1&scenario=ui.<name>
 * (or the full game with ?ui.menu=0 and the window.__ui debug handle).
 *
 * The ground scenarios drive `sim.services.ground` (installed by the ui module); the end-of-game ones write the
 * system outputs directly, like the other modules' scenarios, so they work without the system modules.
 */
import type { Sim } from '../../core/sim';
import type { GroundService } from '../../ui/ground';
import type { GameService } from '../../ui/game';

type Scenario = (sim: Sim) => void;

const ground = (sim: Sim) => sim.services.ground as GroundService | undefined;
const game = (sim: Sim) => sim.services.game as GameService | undefined;

function set(sim: Sim, vars: Record<string, number>): void {
  for (const [k, v] of Object.entries(vars)) sim.set(k, v);
}

/** Cockpit prepared as the SOP expects just before the engine start. */
function preparedCockpit(sim: Sim): void {
  set(sim, {
    'S:ADIRS_IR1_STATE': 2, 'S:ADIRS_IR2_STATE': 2, 'S:ADIRS_IR3_STATE': 2,
    'S:FMGS_INIT_A_DONE': 1, 'S:FMGS_FPLN_DONE': 1, 'S:FMGS_INIT_B_DONE': 1, 'S:FMGS_PERF_TO_DONE': 1,
    'S:EFIS1_BARO_HPA': sim.get('G:ENV_QNH') || 1017, 'S:EFIS1_BARO_STD': 0,
    'C:EXTLT_BEACON': 0, 'C:SIGNS_SEAT_BELTS': 0, 'C:PARK_BRK': 1, 'C:ENG_MODE': 2,
    'C:AIR_APU_BLEED': 1, 'S:APU_AVAIL': 1, 'S:APU_BLEED_VALVE': 1, 'S:BLEED_PRESS_1': 38, 'S:BLEED_PRESS_2': 38,
  });
}

export const scenarios: Record<string, Scenario> = {
  /** Boarding and cargo loading finished (final loadsheet), doors still open, bridge docked. */
  boarded(sim) {
    const g = ground(sim);
    g?.boarding();
    g?.debug.finishBoarding();
    g?.debug.finishLoading();
  },

  /** Everything ready for the engine start: doors closed, bridge and GPU away, chocks out, slides armed, cabin ready. */
  gateReady(sim) {
    ground(sim)?.debug.gateReady();
  },

  /** Engine 2 start in progress with the jet bridge still docked (ground crew warnings). */
  startWithBridge(sim) {
    set(sim, { 'S:ENG2_STATE': 2, 'S:ENG2_N2': 18 });
  },

  /** Clean SOP: gate ready, cockpit prepared, both engines stabilised → end-of-game screen after ~6 s. */
  enginesRunning(sim) {
    ground(sim)?.debug.gateReady();
    game(sim)?.markChecklist('cockpit_prep', true);
    game(sim)?.markChecklist('before_start', true);
    preparedCockpit(sim);
    let t = 0;
    sim.register({
      name: 'ui-scenario-start', order: 97,
      update(dt) {
        t += dt;
        if (t > 0.5 && sim.get('S:ENG2_STATE') === 0) set(sim, { 'S:ENG2_STATE': 2, 'S:ENG2_START_ATTEMPT': 1 });
        if (t > 1.5 && !sim.getB('S:ENG2_RUNNING')) set(sim, { 'S:ENG2_STATE': 3, 'S:ENG2_RUNNING': 1, 'S:ENG2_N2': 59, 'S:ENG2_N1': 19.6 });
        if (t > 2.5 && sim.get('S:ENG1_STATE') === 0) set(sim, { 'S:ENG1_STATE': 2, 'S:ENG1_START_ATTEMPT': 1 });
        if (t > 3.5 && !sim.getB('S:ENG1_RUNNING')) set(sim, { 'S:ENG1_STATE': 3, 'S:ENG1_RUNNING': 1, 'S:ENG1_N2': 59, 'S:ENG1_N1': 19.5 });
      },
    });
  },

  /** Immediate end-of-game screen with the current (cold & dark) state — debrief layout check. */
  endNow(sim) {
    game(sim)?.forceComplete();
  },
};
