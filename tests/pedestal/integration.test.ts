/**
 * Pedestal logic with the real electrical / misc systems: power-up sequence from cold & dark.
 */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic, setControl } from '../../src/core/headless';
import installElec from '../../src/systems/elec-hyd-fuel-apu/index';
import installMisc from '../../src/systems/misc/index';
import installPedestal from '../../src/cockpit/pedestal/index';

describe('pedestal + sys-elec + sys-misc', () => {
  it('follows the real bus supplies from cold & dark to external power', async () => {
    const app = headlessApp();
    await installLogic(app, [installElec, installMisc, installPedestal]);
    const sim = app.sim;
    sim.run(1);
    // cold & dark: everything dark
    const lit = () => sim.names().filter((n) => /^L:(RMP|ACP|XPDR)/.test(n) && sim.get(n) > 0);
    expect(lit()).toEqual([]);
    expect(sim.get('S:XPDR_PANEL_POWERED')).toBe(0);

    // batteries: DC BAT / DC ESS → ACP 1 (and RMP 1 once switched ON), not ACP 2 (DC 2)
    setControl(sim, 'ELEC_BAT1', 1);
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_DC_ESS_BUS')).toBe(1);
    expect(sim.get('L:ACP1_TX_VHF1')).toBe(1);
    expect(sim.get('L:ACP2_TX_VHF1')).toBe(0);
    setControl(sim, 'RMP1_ON', 0);
    sim.run(0.5);
    expect(sim.get('L:RMP1_VHF1')).toBe(1);
    expect(sim.get('S:RUD_TRIM_IND_POWERED')).toBe(0);

    // external power: everything supplied
    setControl(sim, 'ELEC_EXT_PWR', 1);
    sim.run(3);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);
    expect(sim.get('L:ACP2_TX_VHF1')).toBe(1);
    expect(sim.get('S:XPDR_PANEL_POWERED')).toBe(1);
    expect(sim.get('S:RUD_TRIM_IND_POWERED')).toBe(1);
    // FAC self-test (8 s) then the RUD TRIM window shows the trim
    sim.run(10);
    expect(sim.get('S:RUD_TRIM_IND_VALID')).toBe(1);
    // ANN LT TEST does not create pedestal logic lights (the kit shows the test), and STBY XPDR → no ATC FAIL
    expect(sim.get('L:XPDR_FAIL')).toBe(0);
  });
});
