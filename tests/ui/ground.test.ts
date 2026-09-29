/** Ground services (src/ui/ground.ts): realistic delays, refusals, cabin ready, external writes. */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import installUi from '../../src/ui/index';
import type { GroundService } from '../../src/ui/ground';

async function setup(pace: 'real' | 'fast' = 'real') {
  const app = headlessApp();
  await installLogic(app, [installUi]);
  const g = app.sim.services.ground as GroundService;
  g.setPace(pace);
  return { app, sim: app.sim, g };
}

function runUntil(sim: Sim, cond: () => boolean, maxS: number): number {
  const t0 = sim.time;
  while (!cond()) {
    if (sim.time - t0 > maxS) throw new Error(`timeout after ${maxS}s`);
    sim.run(0.5);
  }
  return sim.time - t0;
}

describe('ground services', () => {
  it('keeps the scenario initial state and publishes the service', async () => {
    const { sim, g, app } = await setup();
    sim.run(1);
    expect(app.services.ground).toBe(g);
    expect(sim.get('G:GND_EXT_PWR')).toBe(1);
    expect(sim.get('G:GND_GPU_CABLE')).toBe(1);
    expect(sim.get('G:GND_CHOCKS')).toBe(1);
    expect(sim.get('G:JETBRIDGE')).toBe(1);
    expect(sim.get('G:DOOR_PAX_L1')).toBe(1);
    expect(sim.get('G:DOOR_CARGO_FWD')).toBe(1);
    expect(sim.get('G:DOOR_CARGO_AFT')).toBe(1);
    expect(sim.get('G:DOOR_PAX_R1')).toBe(0);
    expect(sim.get('G:CABIN_READY')).toBe(0);
    expect(sim.get('G:SLIDES_ARMED')).toBe(0);
    expect(sim.get('G:REFUELING')).toBe(0);
    const st = g.status();
    expect(st.gpu.state).toBe('connected');
    expect(st.boarding.state).toBe('waiting');
  });

  it('refuses to retract the jet bridge while L1 is open, then retracts over tens of seconds', async () => {
    const { sim, g } = await setup();
    sim.run(1);
    const r = g.jetbridge(false);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/L1/);
    expect(sim.get('G:JETBRIDGE')).toBe(1);
    // boarding not started: L1 can be closed
    expect(g.door('PAX_L1', false).ok).toBe(true);
    const tClose = runUntil(sim, () => sim.get('G:DOOR_PAX_L1') === 0, 30);
    expect(tClose).toBeGreaterThan(5);
    expect(g.jetbridge(false).ok).toBe(true);
    sim.run(10);
    const mid = sim.get('G:JETBRIDGE');
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const t = runUntil(sim, () => sim.get('G:JETBRIDGE') === 0, 120);
    expect(t + 10).toBeGreaterThan(30);
    // no door opening at L1 without the bridge
    expect(g.door('PAX_L1', true).ok).toBe(false);
  });

  it('GPU cannot be removed while supplying the aircraft; disconnect takes time', async () => {
    const { sim, g } = await setup();
    sim.run(1);
    sim.set('S:ELEC_EXT_PWR_ON', 1);
    const r = g.gpu(false);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/EXT PWR/);
    sim.set('S:ELEC_EXT_PWR_ON', 0);
    expect(g.gpu(false).ok).toBe(true);
    sim.run(2);
    expect(sim.get('G:GND_EXT_PWR')).toBe(1);
    sim.run(4);
    expect(sim.get('G:GND_EXT_PWR')).toBe(0); // GPU stopped
    expect(sim.get('G:GND_GPU_CABLE')).toBe(1);
    runUntil(sim, () => sim.get('G:GND_GPU_CABLE') === 0, 60);
    expect(g.status().gpu.state).toBe('disconnected');
    // reconnect
    expect(g.gpu(true).ok).toBe(true);
    const t = runUntil(sim, () => sim.get('G:GND_EXT_PWR') === 1, 120);
    expect(t).toBeGreaterThan(30);
  });

  it('boarding → loadsheet → doors closed → cabin ready, slides armed on request', async () => {
    const { sim, g } = await setup('fast');
    sim.run(1);
    // cannot close L1 during boarding
    expect(g.boarding().ok).toBe(true);
    sim.run(30);
    const pax = sim.get('G:BOARDING_PAX');
    expect(pax).toBeGreaterThan(5);
    expect(pax).toBeLessThan(156);
    expect(g.door('PAX_L1', false).ok).toBe(false);
    // cargo doors cannot close while loading
    expect(g.door('CARGO_FWD', false).ok).toBe(false);
    runUntil(sim, () => g.status().boarding.state === 'complete', 400);
    expect(sim.get('G:BOARDING_PAX')).toBe(156);
    runUntil(sim, () => g.status().loading.state === 'complete', 400);
    // the ramp agents close the cargo doors themselves
    runUntil(sim, () => sim.get('G:DOOR_CARGO_FWD') === 0 && sim.get('G:DOOR_CARGO_AFT') === 0, 200);
    expect(g.status().loadsheetFinal).toBe(true);
    expect(g.messages().some((m) => m.from === 'agent' && /LOADSHEET/.test(m.text))).toBe(true);
    // slides need closed doors
    expect(g.slides(true).ok).toBe(false);
    expect(sim.get('G:CABIN_READY')).toBe(0);
    g.door('PAX_L1', false);
    runUntil(sim, () => sim.get('G:DOOR_PAX_L1') === 0, 30);
    const tReady = runUntil(sim, () => sim.get('G:CABIN_READY') === 1, 200);
    expect(tReady).toBeGreaterThan(10);
    expect(g.messages().some((m) => m.from === 'purser' && /cabine prête/i.test(m.text))).toBe(true);
    expect(g.slides(true).ok).toBe(true);
    runUntil(sim, () => sim.get('G:SLIDES_ARMED') === 1, 60);
    // a door cannot be opened with the slides armed
    expect(g.door('PAX_L1', true).ok).toBe(false);
  });

  it('chocks removal needs the parking brake; start clearance checks the ground situation', async () => {
    const { sim, g } = await setup('fast');
    sim.run(1);
    sim.set('C:PARK_BRK', 0);
    expect(g.chocks(false).ok).toBe(false);
    sim.set('C:PARK_BRK', 1);
    // clearance refused: GPU connected, bridge docked, doors open
    g.startClearance();
    sim.run(6);
    expect(g.status().clearance).toBe('denied');
    expect(sim.get('G:GND_START_CLEARANCE')).toBe(0);
    g.debug.gateReady();
    sim.set('G:GND_START_CLEARANCE', 0);
    sim.set('G:GND_CHOCKS', 1);
    sim.run(1);
    g.startClearance();
    runUntil(sim, () => g.status().clearance === 'granted', 60);
    expect(sim.get('G:GND_CHOCKS')).toBe(0);
    expect(sim.get('G:GND_START_CLEARANCE')).toBe(1);
    const last = g.messages()[g.messages().length - 1];
    expect(last.text).toMatch(/parc freiné, cales retirées/i);
  });

  it('adopts values written by somebody else (tests, dev scenarios)', async () => {
    const { sim, g } = await setup();
    sim.run(1);
    sim.set('G:DOOR_PAX_L1', 0);
    sim.set('G:GND_EXT_PWR', 0);
    sim.set('G:JETBRIDGE', 0);
    sim.run(2);
    expect(sim.get('G:DOOR_PAX_L1')).toBe(0);
    expect(sim.get('G:JETBRIDGE')).toBe(0);
    expect(g.status().gpu.state).toBe('disconnected');
    expect(sim.get('G:GND_GPU_CABLE')).toBe(0);
    expect(g.status().doors.PAX_L1.pos).toBe(0);
  });

  it('refuelling session drives G:REFUELING and refuses with engines running', async () => {
    const { sim, g } = await setup('fast');
    sim.run(1);
    expect(g.refuel(true).ok).toBe(true);
    runUntil(sim, () => sim.get('G:REFUELING') === 1, 60);
    expect(sim.get('G:GND_FUEL_TRUCK')).toBe(1);
    runUntil(sim, () => sim.get('G:REFUELING') === 0, 120);
    runUntil(sim, () => sim.get('G:GND_FUEL_TRUCK') === 0, 60);
    sim.set('S:ENG2_RUNNING', 1);
    sim.set('S:ENG2_STATE', 3);
    expect(g.refuel(true).ok).toBe(false);
    expect(g.jetbridge(true).ok).toBe(false);
  });

  it('warns when an engine is started with the jet bridge docked', async () => {
    const { sim, g } = await setup();
    sim.run(1);
    sim.set('S:ENG2_STATE', 2);
    sim.run(0.5);
    expect(g.messages().some((m) => m.level === 'warn' && /passerelle/.test(m.text))).toBe(true);
  });
});
