import { describe, expect, it } from 'vitest';
import { avionicsNormal, closeDoors, engineRunning, rig, set } from './helpers';

describe('FWC flight phases', () => {
  it('runs through phases 1 → 10 → 1 on a complete flight', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); });
    const { sim } = r;
    const phase = () => sim.get('S:FWC_FLIGHT_PHASE');
    sim.run(1);
    expect(phase()).toBe(1);

    // 1st engine started: phase 2 after the 30 s confirmation
    engineRunning(sim, 1);
    sim.run(25);
    expect(phase()).toBe(1);
    sim.run(6);
    expect(phase()).toBe(2);
    engineRunning(sim, 2);

    // T.O power → phase 3, 80 kt → phase 4
    set(sim, { 'C:THR_LEVER1': 45, 'C:THR_LEVER2': 45 });
    sim.run(0.5);
    expect(phase()).toBe(3);
    set(sim, { 'S:ADIRS_IAS': 90 });
    sim.run(0.5);
    expect(phase()).toBe(4);

    // lift off → phase 5 (2 s after), 1500 ft → phase 6
    set(sim, { 'G:AC_ON_GROUND': 0, 'S:RA_ALT': 50, 'S:ADIRS_IAS': 160 });
    sim.run(3);
    expect(phase()).toBe(5);
    set(sim, { 'S:RA_ALT': 2000 });
    sim.run(0.5);
    expect(phase()).toBe(6);

    // approach: below 800 ft, not T.O power → phase 7
    set(sim, { 'C:THR_LEVER1': 25, 'C:THR_LEVER2': 25, 'S:RA_ALT': 700 });
    sim.run(0.5);
    expect(phase()).toBe(7);

    // touchdown → phase 8, below 80 kt → phase 9
    set(sim, { 'G:AC_ON_GROUND': 1, 'S:RA_ALT': 0, 'S:ADIRS_IAS': 130, 'C:THR_LEVER1': 0, 'C:THR_LEVER2': 0 });
    sim.run(0.5);
    expect(phase()).toBe(8);
    set(sim, { 'S:ADIRS_IAS': 20 });
    sim.run(2);
    expect(phase()).toBe(9);

    // engines shut down → phase 10 for 5 minutes, then phase 1
    engineRunning(sim, 1, false);
    engineRunning(sim, 2, false);
    sim.run(1);
    expect(phase()).toBe(10);
    sim.run(290);
    expect(phase()).toBe(10);
    sim.run(15);
    expect(phase()).toBe(1);
  });

  it('starts directly in phase 2 when spawned with an engine running', async () => {
    const r = await rig((sim) => { closeDoors(sim); avionicsNormal(sim); engineRunning(sim, 1); engineRunning(sim, 2); });
    r.sim.run(0.5);
    expect(r.ecam.flightPhase()).toBe(2);
  });

  it('publishes phase 0 when the FWCs are not powered', async () => {
    const r = await rig((sim) => {
      for (const b of ['AC1', 'AC2', 'AC_ESS']) sim.set(`S:ELEC_${b}_BUS`, 0);
    });
    r.sim.run(1);
    expect(r.sim.get('S:FWC_FLIGHT_PHASE')).toBe(0);
    expect(r.sim.get('S:FWC_POWERED')).toBe(0);
  });
});
