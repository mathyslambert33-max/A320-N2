import { describe, expect, it } from 'vitest';
import { rig, set, pb, irsAligned } from './helpers';
import { LAT_ARMED, LAT_MODE, THR_MODE, VERT_ARMED, VERT_MODE } from '../../src/avionics/pfdnd/logic/fg';

describe('Flight guidance (ground)', () => {
  it('FD engaged needs FD pb, FMGC and attitude', async () => {
    const sim = await rig({ warm: true, fmgs: true });
    expect(sim.getB('S:FG_FD1_ENGAGED')).toBe(false);
    irsAligned(sim);
    sim.run(0.2);
    expect(sim.getB('S:FG_FD1_ENGAGED')).toBe(true);
    expect(sim.getB('S:FG_FD2_ENGAGED')).toBe(true);
    pb(sim, 'EFIS1_FD');
    expect(sim.getB('S:FG_FD1_ENGAGED')).toBe(false);
  });

  it('take-off modes at FLX thrust with V2 entered', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    set(sim, { 'S:FMGS_V2': 148, 'S:FMGS_FLEX': 58, 'S:FMGS_FPLN_ACTIVE': 1, 'S:NAV_ILS_FREQ': 110.3, 'S:ENG1_RUNNING': 1, 'S:ENG2_RUNNING': 1 });
    sim.run(0.2);
    expect(sim.get('S:FG_VERT_ACTIVE')).toBe(VERT_MODE.NONE);
    expect(sim.get('S:FG_SPD_TARGET')).toBe(148);
    expect(sim.getB('S:FG_SPD_TARGET_MANAGED')).toBe(true);
    set(sim, { 'C:THR_LEVER1': 35, 'C:THR_LEVER2': 35 });
    sim.run(0.2);
    expect(sim.get('S:FG_VERT_ACTIVE')).toBe(VERT_MODE.SRS);
    expect(sim.get('S:FG_LAT_ACTIVE')).toBe(LAT_MODE.RWY);
    expect(sim.get('S:FG_VERT_ARMED')).toBe(VERT_ARMED.CLB);
    expect(sim.get('S:FG_LAT_ARMED')).toBe(LAT_ARMED.NAV);
    expect(sim.get('S:FCU_ATHR')).toBe(1);
    expect(sim.get('S:FG_THR_MODE')).toBe(THR_MODE.MAN_FLX);
    expect(sim.getB('S:FCU_ALT_DOT')).toBe(true);
    set(sim, { 'C:THR_LEVER1': 45, 'C:THR_LEVER2': 45 });
    sim.run(0.2);
    expect(sim.get('S:FG_THR_MODE')).toBe(THR_MODE.MAN_TOGA);
    // Rejected take-off: levers to idle clear the modes.
    set(sim, { 'C:THR_LEVER1': 0, 'C:THR_LEVER2': 0 });
    sim.run(0.2);
    expect(sim.get('S:FG_VERT_ACTIVE')).toBe(VERT_MODE.NONE);
    expect(sim.get('S:FG_THR_MODE')).toBe(THR_MODE.NONE);
  });

  it('no SRS without V2', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    set(sim, { 'C:THR_LEVER1': 45, 'C:THR_LEVER2': 45 });
    sim.run(0.2);
    expect(sim.get('S:FG_VERT_ACTIVE')).toBe(VERT_MODE.NONE);
    expect(sim.get('S:FG_THR_MODE')).toBe(THR_MODE.MAN_TOGA);
  });

  it('selected speed target from the FCU', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    sim.emit('FCU_SPD:pull');
    sim.emit('FCU_SPD:inc', { steps: 50 });
    sim.run(0.2);
    expect(sim.get('S:FG_SPD_TARGET')).toBe(150);
    expect(sim.getB('S:FG_SPD_TARGET_MANAGED')).toBe(false);
  });
});
