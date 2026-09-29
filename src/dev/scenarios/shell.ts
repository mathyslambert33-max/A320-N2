/** Dev scenarios for the shell module: /dev.html?module=shell&mods=overhead,mainpanel&scenario=shell.<name> */
import type { Sim } from '../../core/sim';

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** Cockpit door closed. */
  doorClosed: (sim) => sim.set('G:DOOR_CKPT', 0),
  /** Both sliding windows open. */
  windowsOpen: (sim) => { sim.set('C:WINDOW_CAPT', 1); sim.set('C:WINDOW_FO', 1); },
  /** Sticks, tillers, pedals deflected (visual check). */
  controlsDeflected: (sim) => {
    sim.set('C:SIDESTICK_CAPT_X', 0.8); sim.set('C:SIDESTICK_CAPT_Y', 0.6);
    sim.set('C:SIDESTICK_FO_X', -0.5); sim.set('C:SIDESTICK_FO_Y', -0.7);
    sim.set('C:TILLER_CAPT', 0.7); sim.set('C:TILLER_FO', -0.4);
    sim.set('C:RUDDER', 0.8); sim.set('C:BRAKE_L', 1);
  },
  /** Wipers mid-sweep. */
  wipers: (sim) => { sim.set('S:WIPER_CAPT_POS', 0.6); sim.set('S:WIPER_FO_POS', 0.3); },
  /** Night cockpit lighting: dome DIM, floods, console/floor, reading lights. */
  nightLights: (sim) => {
    sim.set('S:INTLT_DOME', 0.35); sim.set('S:INTLT_FLOOD_MAIN', 0.6); sim.set('S:INTLT_FLOOD_PED', 0.6);
    sim.set('S:INTLT_CONSOLE_CAPT', 0.4); sim.set('S:INTLT_CONSOLE_FO', 0.4);
    sim.set('S:INTLT_READING_CAPT', 0.8); sim.set('S:INTLT_READING_FO', 0.8);
  },
  /** Crew oxygen mask test: blinker yellow on both boxes. */
  oxyFlow: (sim) => { sim.set('S:OXY_MASK_FLOW_CAPT', 1); sim.set('S:OXY_MASK_FLOW_FO', 1); },
};
