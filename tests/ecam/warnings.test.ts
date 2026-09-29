import { describe, expect, it } from 'vitest';
import { press } from '../../src/core/headless';
import { SdPage } from '../../src/avionics/ecam/logic/types';
import { avionicsNormal, closeDoors, engineRunning, rig, set } from './helpers';

describe('ENG FIRE test', () => {
  it('triggers MASTER WARN, CRC and the ENG 1 FIRE procedure; MW pb silences the CRC', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    const { sim } = r;
    sim.run(1);
    expect(sim.get('S:FWC_MASTER_WARN')).toBe(0);

    // ENG 1 FIRE TEST pb held (no fire detection system installed → control fallback)
    sim.set('C:FIRE_ENG1_TEST', 1);
    sim.run(0.5);
    expect(sim.get('S:FWC_MASTER_WARN')).toBe(1);
    expect(r.sounds).toContain('CRC');
    expect(sim.get('S:FWC_CRC')).toBe(1);
    const w = r.warnings().find((x) => x.text.startsWith('ENG 1 FIRE'));
    expect(w?.level).toBe(3);
    expect(w?.displayed).toBe(true);
    const left = r.left();
    expect(left[0]).toBe('ENG 1 FIRE');
    expect(left.some((l) => l.startsWith('-ENG 1 FIRE P/B') && l.endsWith('PUSH'))).toBe(true);
    expect(left.some((l) => l.startsWith('-AGENT 1') && l.endsWith('DISCH'))).toBe(true);
    // ENG page called on the SD
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.ENG);
    // MASTER WARN light flashes
    let lit = 0;
    for (let i = 0; i < 30; i++) { sim.run(1 / 15); lit += sim.get('L:MASTER_WARN'); }
    expect(lit).toBeGreaterThan(5);
    expect(lit).toBeLessThan(25);

    // MASTER WARN pb: light off, CRC stopped, warning still displayed
    press(sim, 'WARN_MASTER_WARN_CAPT');
    expect(r.sounds).toContain('STOP_CRC');
    expect(sim.get('S:FWC_MASTER_WARN')).toBe(0);
    expect(sim.get('L:MASTER_WARN')).toBe(0);
    expect(r.left()[0]).toBe('ENG 1 FIRE');

    // action lines disappear when done: ENG 1 FIRE pb released
    sim.set('C:FIRE_ENG1_PB', 1);
    sim.run(0.5);
    expect(r.left().some((l) => l.startsWith('-ENG 1 FIRE P/B'))).toBe(false);

    // test released: warning gone
    sim.set('C:FIRE_ENG1_TEST', 0);
    sim.set('C:FIRE_ENG1_PB', 0);
    sim.run(1);
    expect(r.warnings().some((x) => x.text.startsWith('ENG 1 FIRE'))).toBe(false);
  });
});

describe('T.O CONFIG pb', () => {
  const ready = async () => {
    const r = await rig((sim) => {
      closeDoors(sim);
      avionicsNormal(sim);
      engineRunning(sim, 1);
      engineRunning(sim, 2);
      set(sim, { 'S:FMGS_V1': 142, 'S:FMGS_VR': 144, 'S:FMGS_V2': 148, 'S:FMGS_TO_CONF': 1, 'C:PARK_BRK': 1 });
    });
    r.sim.run(1);
    expect(r.ecam.flightPhase()).toBe(2);
    return r;
  };

  it('triggers CONFIG SLATS / FLAPS NOT IN T.O CONFIG with slats/flaps retracted', async () => {
    const r = await ready();
    const { sim } = r;
    press(sim, 'ECP_TO_CONFIG', 0.3);
    sim.run(0.2);
    const cfg = r.warnings().filter((w) => w.text.startsWith('CONFIG'));
    expect(cfg.map((w) => w.text)).toEqual(expect.arrayContaining(['CONFIG SLATS NOT IN T.O CONFIG', 'CONFIG FLAPS NOT IN T.O CONFIG']));
    expect(cfg.every((w) => w.level === 3)).toBe(true);
    expect(sim.get('S:FWC_MASTER_WARN')).toBe(1);
    expect(r.sounds).toContain('CRC');
    expect(r.left()).toContain('CONFIG');
    expect(r.left()).toContain('SLATS NOT IN T.O CONFIG');
    expect(sim.get('S:FWC_TO_CONFIG_OK')).toBe(0);
  });

  it('shows T.O CONFIG NORMAL with a correct configuration', async () => {
    const r = await ready();
    const { sim } = r;
    set(sim, { 'C:FLAPS_LEVER': 1, 'S:FCTL_SLATS': 18, 'S:FCTL_FLAPS': 10, 'S:FCTL_FLAPS_CONF': 1.5 });
    sim.run(1);
    press(sim, 'ECP_TO_CONFIG', 0.2);
    sim.run(1);
    expect(r.warnings().filter((w) => w.level === 3)).toEqual([]);
    expect(sim.get('S:FWC_TO_MEMO')).toBe(1);
    expect(sim.get('S:FWC_TO_CONFIG_OK')).toBe(1);
    expect(r.left()).toContain('T.O CONFIG NORMAL');
    expect(r.left()[0]).toMatch(/^T\.O AUTO BRK/);
  });

  it('flags a pitch trim outside the T.O range', async () => {
    const r = await ready();
    const { sim } = r;
    set(sim, { 'C:FLAPS_LEVER': 1, 'S:FCTL_SLATS': 18, 'S:FCTL_FLAPS': 10, 'S:FCTL_FLAPS_CONF': 1.5, 'S:FCTL_THS': 5 });
    sim.run(1);
    press(sim, 'ECP_TO_CONFIG', 0.2);
    expect(r.warnings().some((w) => w.text.startsWith('CONFIG PITCH TRIM'))).toBe(true);
    expect(sim.get('S:FWC_TO_CONFIG_OK')).toBe(0);
  });
});

describe('cautions', () => {
  it('single chime + MASTER CAUT, CLR removes it and calls the STATUS page', async () => {
    const r = await rig((sim) => {
      closeDoors(sim); avionicsNormal(sim); engineRunning(sim, 1); engineRunning(sim, 2);
      set(sim, { 'C:ASKID_NWSTRG': 1 });
    });
    const { sim } = r;
    sim.run(2);
    const w = r.warnings().find((x) => x.text.startsWith('BRAKES A/SKID'));
    expect(w?.level).toBe(2);
    expect(r.sounds).toContain('SC');
    expect(sim.get('S:FWC_MASTER_CAUT')).toBe(1);
    expect(sim.get('L:MASTER_CAUT')).toBe(1);
    expect(sim.get('L:ECP_CLR')).toBe(1);
    press(sim, 'WARN_MASTER_CAUT_FO');
    expect(sim.get('L:MASTER_CAUT')).toBe(0);
    press(sim, 'ECP_CLR_L');
    sim.run(0.5);
    expect(r.left().some((l) => l.startsWith('BRAKES'))).toBe(false);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.STS);
    expect(r.ecam.core.fwc.status.inop).toEqual(expect.arrayContaining(['ANTI SKID', 'N/W STRG']));
    // STS reminder in the memo area, CLR again → back to the automatic page
    press(sim, 'ECP_CLR_L');
    sim.run(0.5);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.WHEEL);
    // RCL brings the cleared caution back
    press(sim, 'ECP_RCL');
    sim.run(0.2);
    expect(r.left().some((l) => l.startsWith('BRAKES'))).toBe(true);
  });

  it('RCL with nothing to recall displays NORMAL', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    r.sim.run(1);
    press(r.sim, 'ECP_RCL');
    expect(r.left()).toContain('NORMAL');
  });

  it('STS with no status message shows NORMAL for 3 s', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    const { sim } = r;
    sim.run(1);
    press(sim, 'ECP_STS');
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.STS);
    expect(sim.get('L:ECP_STS')).toBe(1);
    sim.run(3.5);
    expect(sim.get('S:ECAM_SD_PAGE')).toBe(SdPage.DOOR);
  });
});
