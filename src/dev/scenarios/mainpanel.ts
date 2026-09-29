/** Dev scenarios for the main panel (`&scenario=mainpanel.<name>`). */
import type { Sim } from '../../core/sim';

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** Chrono running, ET running, date shown. */
  clock: (sim) => {
    sim.set('C:CLOCK_ET', 0);
    sim.emit('CLOCK_CHR:press');
  },
  /** Parking brake set with a charged accumulator (needles on the triple indicator). */
  brakes: (sim) => {
    sim.set('S:BRK_ACCU_PRESS', 3000);
    sim.set('S:BRK_PRESS_L', 2000);
    sim.set('S:BRK_PRESS_R', 2000);
  },
  /** Gear lever UP (on ground the gear stays down-locked: sys-misc inhibits retraction). */
  gearUp: (sim) => sim.set('C:GEAR_LEVER', 0),
};
