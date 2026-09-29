/** End-of-game detection and SOP debrief (src/ui/game.ts). */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import installUi from '../../src/ui/index';
import { evaluate, formatDuration, type GameResult, type GameService, type SessionRecord } from '../../src/ui/game';
import type { GroundService } from '../../src/ui/ground';

async function setup() {
  const app = headlessApp();
  await installLogic(app, [installUi]);
  return { sim: app.sim, game: app.sim.services.game as GameService, ground: app.sim.services.ground as GroundService };
}

/** Cockpit in the state expected before the engine start (as the systems would publish it). */
function preparedCockpit(sim: Sim): void {
  for (const n of [1, 2, 3]) sim.set(`S:ADIRS_IR${n}_STATE`, 2);
  for (const v of ['S:FMGS_INIT_A_DONE', 'S:FMGS_FPLN_DONE', 'S:FMGS_INIT_B_DONE', 'S:FMGS_PERF_TO_DONE']) sim.set(v, 1);
  sim.set('S:EFIS1_BARO_HPA', 1017);
  sim.set('S:EFIS1_BARO_STD', 0);
  sim.set('C:EXTLT_BEACON', 0); // ON
  sim.set('C:SIGNS_SEAT_BELTS', 0); // ON
  sim.set('C:PARK_BRK', 1);
  sim.set('C:ENG_MODE', 2);
  sim.set('C:AIR_APU_BLEED', 1);
  sim.set('S:APU_AVAIL', 1);
  sim.set('S:APU_BLEED_VALVE', 1);
  sim.set('S:BLEED_PRESS_1', 38);
}

function startEngine(sim: Sim, n: number): void {
  sim.set(`S:ENG${n}_STATE`, 2);
  sim.set(`S:ENG${n}_START_ATTEMPT`, 1);
  sim.run(1);
  sim.set(`S:ENG${n}_STATE`, 3);
  sim.set(`S:ENG${n}_RUNNING`, 1);
  sim.run(1);
}

describe('end of game', () => {
  it('completes a few seconds after both engines run and scores a clean SOP', async () => {
    const { sim, game, ground } = await setup();
    let result: GameResult | null = null;
    game.onComplete((r) => { result = r; });
    sim.run(1);
    game.begin();
    ground.debug.gateReady();
    ground.walkaround();
    sim.run(200);
    game.markChecklist('cockpit_prep', true);
    game.markChecklist('before_start', true);
    preparedCockpit(sim);
    sim.run(1);
    startEngine(sim, 2);
    expect(game.state()).toBe('running');
    startEngine(sim, 1);
    sim.run(3);
    expect(game.state()).toBe('running');
    sim.run(5);
    expect(game.state()).toBe('complete');
    const r = result as unknown as GameResult;
    expect(r).not.toBeNull();
    const failed = r.items.filter((i) => !i.ok).map((i) => `${i.id}: ${i.detail ?? ''}`);
    expect(failed).toEqual([]);
    expect(r.score).toBe(r.total);
    expect(r.elapsedS).toBeGreaterThan(200);
  });

  it('flags the SOP deviations', async () => {
    const { sim, game } = await setup();
    sim.run(1);
    game.begin();
    // cold & dark cockpit, jet bridge docked, GPU connected, ENG 1 first without APU bleed
    sim.set('C:ENG_MODE', 1);
    startEngine(sim, 1);
    sim.set('S:ENG2_START_FAULT', 1);
    sim.set('S:ENG2_START_ATTEMPT', 2);
    startEngine(sim, 2);
    sim.run(8);
    const r = game.result()!;
    expect(r).not.toBeNull();
    const ko = new Set(r.items.filter((i) => !i.ok).map((i) => i.id));
    for (const id of ['doors', 'gpu', 'beacon', 'irs', 'fmgs', 'order', 'bleed', 'engmode', 'nofault', 'clearance', 'walkaround', 'checklists']) expect(ko.has(id)).toBe(true);
    expect(r.items.find((i) => i.id === 'nofault')!.detail).toMatch(/IGN FAULT/);
    expect(r.score).toBeLessThan(r.total / 2);
  });

  it('evaluate() is pure and handles a missing snapshot', () => {
    const rec: SessionRecord = {
      snap: null, starts: [], faults: [], maxAttempt: 0, aborted: false, checklists: {},
      walkaround: { done: false, beforePower: null, t: null }, firstStartT: null, ecam: [{ text: 'ENG 1 FAIL', level: 3 }],
    };
    const items = evaluate(rec);
    expect(items.length).toBeGreaterThan(15);
    expect(items.find((i) => i.id === 'beacon')!.ok).toBe(false);
    expect(items.find((i) => i.id === 'ecam')!.detail).toMatch(/ENG 1 FAIL/);
  });

  it('formats durations in French', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(725)).toBe('12 min 05 s');
    expect(formatDuration(3725)).toBe('1 h 02 min 05 s');
  });
});
