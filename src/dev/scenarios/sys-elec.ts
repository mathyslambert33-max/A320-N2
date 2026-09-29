/**
 * Dev-harness scenarios for the sys-elec module (ELEC / HYD / FUEL / APU), e.g.
 *   /dev.html?display=ELEC_BAT1_V&mods=sys-elec&scenario=sys-elec.batOnly
 *   /dev.html?module=overhead&mods=sys-elec&scenario=sys-elec.apuRunning
 * Each scenario asks the module to apply a preset (applied when the sim starts if called before).
 */
import type { Sim } from '../../core/sim';

const preset = (name: string) => (sim: Sim) => {
  const svc = sim.services['sys-elec'];
  if (!svc) {
    console.warn('[scenario sys-elec] module not installed (add &mods=sys-elec)');
    return;
  }
  svc.preset(name);
};

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** Cold & dark (default state). */
  coldDark: preset('coldDark'),
  /** BAT 1+2 AUTO, no external power: DC BAT / DC ESS / STAT INV only. */
  batOnly: preset('batOnly'),
  /** Batteries + EXT PWR ON (cockpit preparation). */
  extPwr: preset('extPwr'),
  /** EXT PWR ON, APU MASTER ON, start in progress. */
  apuStarting: preset('apuStarting'),
  /** APU running and supplying (EXT PWR OFF), APU BLEED ON — ready for pushback. */
  apuRunning: preset('apuRunning'),
  /** APU running, EXT PWR still ON (priority), APU BLEED ON. */
  apuRunningExt: preset('apuRunningExt'),
  /** Nearly flat batteries (≈ 24 V). */
  lowBattery: preset('lowBattery'),
  /** Brake accumulator exhausted (parking brake not effective). */
  accuEmpty: preset('accuEmpty'),
  /** Brake accumulator fully charged (3000 psi). */
  accuCharged: preset('accuCharged'),
  /** Batteries only + ANN LT TEST (BAT windows show 88.8). */
  annTest: (sim) => {
    preset('batOnly')(sim);
    sim.set('C:INTLT_ANN_LT', 0);
    sim.set('S:INTLT_ANN_TEST', 1);
  },
};
