/**
 * State presets (dev scenarios, EFB "quick states", tests). A preset sets the relevant cockpit controls
 * (C: vars of this module's panels, APU BLEED) and forces the internal model state accordingly.
 */
import type { Sim } from '../../core/sim';
import type { Model } from './model';

export const PRESETS = ['coldDark', 'batOnly', 'extPwr', 'apuStarting', 'apuRunning', 'apuRunningExt', 'lowBattery', 'accuEmpty', 'accuCharged'] as const;
export type PresetName = (typeof PRESETS)[number];

export function applyPreset(sim: Sim, m: Model, name: string): boolean {
  const c = (id: string, v: number) => sim.set(`C:${id}`, v);
  const bats = () => {
    c('ELEC_BAT1', 1);
    c('ELEC_BAT2', 1);
    m.elec.bcl[0].forceClosed();
    m.elec.bcl[1].forceClosed();
  };
  const ext = () => {
    sim.set('G:GND_EXT_PWR', 1);
    c('ELEC_EXT_PWR', 1);
    m.elec.extOn = true;
    // batteries charged by then: BCL open, surface charge present
    for (let i = 0; i < 2; i++) {
      m.elec.bat[i].soc = Math.max(m.elec.bat[i].soc, 0.9);
      m.elec.bat[i].vs = 1.6;
      m.elec.bcl[i].forceOpen();
    }
  };
  switch (name as PresetName) {
    case 'coldDark':
      return true;
    case 'batOnly':
      bats();
      return true;
    case 'extPwr':
      bats();
      ext();
      return true;
    case 'apuStarting':
      bats();
      ext();
      c('APU_MASTER', 1);
      m.apu.masterWasOn = true;
      m.apu.flap = 1;
      m.apu.ecbOn = true;
      m.apu.startOn = true;
      return true;
    case 'apuRunning':
      bats();
      m.apu.setRunning(sim);
      m.fuel.apuLp = 1;
      c('AIR_APU_BLEED', 1);
      return true;
    case 'apuRunningExt':
      bats();
      ext();
      m.apu.setRunning(sim);
      m.fuel.apuLp = 1;
      c('AIR_APU_BLEED', 1);
      return true;
    case 'lowBattery':
      for (const b of m.elec.bat) { b.soc = 0.12; b.vs = 0; }
      return true;
    case 'accuEmpty':
      m.brk.setAccu(0);
      return true;
    case 'accuCharged':
      m.brk.setAccu(3000);
      return true;
  }
  return false;
}
