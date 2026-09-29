import { describe, expect, it } from 'vitest';
import { power, rig, set, pb } from './helpers';
import { DU_CONTENT, DU_STATE } from '../../src/avionics/pfdnd/logic/du';

const st = (sim: any, id: string) => sim.get(`S:PFDND_DU_${id}_STATE`);
const content = (sim: any, id: string) => sim.get(`S:PFDND_DU_${id}_CONTENT`);

describe('Display units', () => {
  it('self test at power-up, then image', async () => {
    const sim = await rig();
    expect(st(sim, 'PFD1')).toBe(DU_STATE.OFF);
    power(sim);
    sim.run(1);
    for (const id of ['PFD1', 'ND1', 'PFD2', 'ND2']) expect(st(sim, id)).toBe(DU_STATE.SELF_TEST);
    expect(sim.get('S:PFDND_DU_PFD1_TEST_REMAIN')).toBeGreaterThan(15);
    sim.run(30);
    for (const id of ['PFD1', 'ND1', 'PFD2', 'ND2']) expect(st(sim, id)).toBe(DU_STATE.ON);
  });

  it('follows its own bus', async () => {
    const sim = await rig({ warm: true });
    set(sim, { 'S:ELEC_AC2_BUS': 0 });
    sim.run(0.5);
    expect(st(sim, 'PFD1')).toBe(DU_STATE.ON);
    expect(st(sim, 'PFD2')).toBe(DU_STATE.STANDBY);
    expect(st(sim, 'ND2')).toBe(DU_STATE.STANDBY);
    set(sim, { 'S:ELEC_AC_ESS_SHED': 0 });
    sim.run(0.5);
    expect(st(sim, 'ND1')).toBe(DU_STATE.STANDBY);
    expect(st(sim, 'PFD1')).toBe(DU_STATE.ON);
  });

  it('no new self test after a short interruption, self test after a long one', async () => {
    const sim = await rig({ warm: true });
    power(sim, false);
    sim.run(5);
    power(sim);
    sim.run(0.2);
    expect(st(sim, 'PFD1')).toBe(DU_STATE.ON);
    power(sim, false);
    sim.run(12);
    expect(st(sim, 'PFD1')).toBe(DU_STATE.OFF);
    power(sim);
    sim.run(0.2);
    expect(st(sim, 'PFD1')).toBe(DU_STATE.SELF_TEST);
  });

  it('PFD brightness OFF transfers the PFD image to the ND DU', async () => {
    const sim = await rig({ warm: true });
    expect(content(sim, 'ND1')).toBe(DU_CONTENT.ND);
    sim.set('C:MAIN_PFD1_BRT', 0);
    sim.run(0.2);
    expect(st(sim, 'PFD1')).not.toBe(DU_STATE.ON);
    expect(content(sim, 'ND1')).toBe(DU_CONTENT.PFD);
    expect(content(sim, 'ND2')).toBe(DU_CONTENT.ND);
  });

  it('PFD/ND XFR swaps the images', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'MAIN_PFD_ND_XFR_FO');
    expect(content(sim, 'PFD2')).toBe(DU_CONTENT.ND);
    expect(content(sim, 'ND2')).toBe(DU_CONTENT.PFD);
    expect(content(sim, 'PFD1')).toBe(DU_CONTENT.PFD);
    pb(sim, 'MAIN_PFD_ND_XFR_FO');
    expect(content(sim, 'PFD2')).toBe(DU_CONTENT.PFD);
  });

  it('INVALID DATA without DMC, recovered with EIS DMC switching', async () => {
    const sim = await rig({ warm: true });
    set(sim, { 'S:DMC_POWERED_1': 0, 'S:DMC_POWERED_2': 1, 'S:DMC_POWERED_3': 1 });
    sim.run(0.2);
    expect(content(sim, 'PFD1')).toBe(DU_CONTENT.INVALID);
    expect(content(sim, 'PFD2')).toBe(DU_CONTENT.PFD);
    sim.set('C:SW_EIS_DMC', 0); // CAPT 3
    sim.run(0.2);
    expect(content(sim, 'PFD1')).toBe(DU_CONTENT.PFD);
  });
});
