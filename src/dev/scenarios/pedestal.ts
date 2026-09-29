/**
 * Dev scenarios for the pedestal (`/dev.html?module=pedestal&mods=mcdu&power=1&scenario=pedestal.<name>`).
 * They only set control positions / events; with `power=1` the pedestal logic lights the panels.
 */
import type { Sim } from '../../core/sim';

const set = (sim: Sim, v: Record<string, number>) => { for (const [k, x] of Object.entries(v)) sim.set(k, x); };

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** RMP 1/2/3 ON, VHF 2 selected on RMP 1 (SEL lights), a MECH call flashing on the ACPs. */
  radios: (sim) => {
    set(sim, { 'C:RMP1_ON': 0, 'C:RMP2_ON': 0, 'C:RMP3_ON': 0 });
    setTimeout(() => { sim.emit('RMP1_VHF2:press'); sim.emit('acp:call', { ch: 'MECH' }); }, 300);
  },
  /** Transponder AUTO, TA/RA, code being typed. */
  xpdr: (sim) => {
    set(sim, { 'C:XPDR_MODE': 1, 'C:TCAS_MODE': 2 });
    setTimeout(() => { for (const k of ['4', '5', '2']) sim.emit('XPDR_KEY', { key: k }); }, 300);
  },
  /** Take-off configuration: flaps 1, speed brake armed, pitch trim 1.2 UP, levers at FLX, park brake OFF. */
  takeoff: (sim) => set(sim, {
    'C:FLAPS_LEVER': 1, 'C:SPDBRK_ARM': 1, 'C:PITCH_TRIM': 1.2, 'S:FCTL_THS': 1.2, 'C:THR_LEVER1': 35, 'C:THR_LEVER2': 35,
    'C:PARK_BRK': 0, 'C:XPDR_MODE': 1, 'C:TCAS_MODE': 2, 'C:ENG_MASTER1': 0, 'C:ENG_MASTER2': 0,
  }),
  /** Engines starting: ENG MODE IGN/START, MASTER 2 ON, ENG 2 FAULT + ENG 1 FIRE lights for the look. */
  engStart: (sim) => set(sim, { 'C:ENG_MODE': 2, 'C:ENG_MASTER2': 0, 'L:ENG2_FAULT': 1, 'L:ENG1_FIRE': 1 }),
  /** Landing roll: full reverse, speed brake full, flaps FULL, rudder trim 3.4 L. */
  landing: (sim) => set(sim, {
    'C:THR_LEVER1': -20, 'C:THR_LEVER2': -20, 'C:SPDBRK_LEVER': 1, 'C:FLAPS_LEVER': 4, 'S:FCTL_RUD_TRIM': -3.4,
    'S:FCTL_FAC1_ON': 1, 'C:PARK_BRK': 0,
  }),
  /** Printer: a strip of paper out of the printer. */
  printer: (sim) => { setTimeout(() => sim.emit('PRINTER_TEST:press'), 300); },
};
