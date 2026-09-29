import { describe, expect, it } from 'vitest';
import { press } from '../../src/core/headless';
import { SdPage } from '../../src/avionics/ecam/logic/types';
import { avionicsNormal, closeDoors, engineRunning, rig, set } from './helpers';

describe('SD automatic page selection', () => {
  it('APU page during APU start, back to DOOR 10 s after APU AVAIL', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    const { sim } = r;
    const page = () => sim.get('S:ECAM_SD_PAGE');
    sim.run(1);
    expect(page()).toBe(SdPage.DOOR);
    set(sim, { 'C:APU_MASTER': 1, 'S:APU_STARTING': 1, 'S:APU_N': 20 });
    sim.run(0.5);
    expect(page()).toBe(SdPage.APU);
    set(sim, { 'S:APU_AVAIL': 1, 'S:APU_N': 100, 'S:APU_STARTING': 0 });
    sim.run(9);
    expect(page()).toBe(SdPage.APU);
    sim.run(2);
    expect(page()).toBe(SdPage.DOOR);
  });

  it('ENG page during engine start, WHEEL page in phase 2 once the start is over', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); set(sim, { 'C:APU_MASTER': 1, 'S:APU_AVAIL': 1 }); });
    const { sim } = r;
    const page = () => sim.get('S:ECAM_SD_PAGE');
    sim.run(12);
    expect(page()).toBe(SdPage.DOOR);
    sim.set('C:ENG_MODE', 2); // IGN/START
    sim.run(0.5);
    expect(page()).toBe(SdPage.ENG);
    engineRunning(sim, 2);
    sim.run(40);
    expect(page()).toBe(SdPage.ENG); // engine 1 not started yet
    engineRunning(sim, 1);
    sim.run(5);
    expect(page()).toBe(SdPage.ENG); // stays 10 s after the start sequence
    sim.set('C:ENG_MODE', 1);
    sim.run(6);
    expect(page()).toBe(SdPage.WHEEL);
    expect(r.ecam.flightPhase()).toBe(2);
    // flight controls check: F/CTL page for 20 s after the sidestick is moved
    sim.set('C:SIDESTICK_CAPT_Y', 1);
    sim.run(0.5);
    expect(page()).toBe(SdPage.FCTL);
    sim.set('C:SIDESTICK_CAPT_Y', 0);
    sim.run(21);
    expect(page()).toBe(SdPage.WHEEL);
  });

  it('page keys select pages manually and light up; pressing again returns to AUTO', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    const { sim } = r;
    sim.run(1);
    press(sim, 'ECP_HYD');
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.HYD);
    expect(sim.get('L:ECP_HYD')).toBe(1);
    press(sim, 'ECP_HYD');
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.DOOR);
    expect(sim.get('L:ECP_HYD')).toBe(0);
    // ALL held: pages scroll every second
    sim.set('C:ECP_ALL', 1);
    sim.emit('ECP_ALL:press');
    sim.run(0.1);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.ENG);
    sim.run(1);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.BLEED);
    sim.set('C:ECP_ALL', 0);
    sim.emit('ECP_ALL:release');
    sim.run(3);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.BLEED);
  });

  it('display units go through the self test after a power-up and blank with the knob OFF', async () => {
    const r = await rig((sim) => {
      closeDoors(sim);
      for (const b of ['AC1', 'AC2', 'AC_ESS']) sim.set(`S:ELEC_${b}_BUS`, 0);
    });
    const { sim } = r;
    const core = r.ecam.core;
    sim.run(1);
    expect(core.duUpper.mode).toBe('OFF');
    for (const b of ['AC1', 'AC2', 'AC_ESS']) sim.set(`S:ELEC_${b}_BUS`, 1);
    sim.run(1);
    expect(core.duUpper.mode).toBe('TEST');
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.NONE);
    sim.run(40);
    expect(core.duUpper.mode).toBe('ON');
    expect(core.duLower.mode).toBe('ON');
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.DOOR);
    sim.set('C:ECP_UPPER_BRT', 0);
    sim.run(1);
    expect(core.duUpper.mode).toBe('STBY');
    expect(core.ewdOnLower).toBe(true);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.NONE);
  });
});
