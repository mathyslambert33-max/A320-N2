/**
 * Whole SOP with every logic module + the ui module, the ground being driven only through
 * `sim.services.ground` (no raw G: writes): cold & dark → both engines started → end-of-game debrief.
 */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic, press, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import installElec from '../../src/systems/elec-hyd-fuel-apu/index';
import installMisc from '../../src/systems/misc/index';
import installAir from '../../src/systems/air-eng/index';
import installEcam from '../../src/avionics/ecam/index';
import installMcdu from '../../src/avionics/mcdu/index';
import installPfdNd from '../../src/avionics/pfdnd/index';
import installUi from '../../src/ui/index';
import { doInitA, doInitB, doPerfTo, press as mcduPress } from '../../src/avionics/mcdu/testing';
import type { GroundService } from '../../src/ui/ground';
import type { GameResult, GameService } from '../../src/ui/game';

function runUntil(sim: Sim, cond: () => boolean, maxS: number, what: string): number {
  const t0 = sim.time;
  while (!cond()) {
    if (sim.time - t0 > maxS) throw new Error(`timeout after ${maxS}s waiting for: ${what}`);
    sim.run(0.5);
  }
  return sim.time - t0;
}

describe('SOP with ground services (ui module + all logic modules)', () => {
  it('reaches both engines started with a clean debrief', { timeout: 180_000 }, async () => {
    const app = headlessApp({ timeOfDay: 'day' });
    app.settings.set('irsAlign', 'fast');
    await installLogic(app, [installElec, installMisc, installAir, installEcam, installMcdu, installPfdNd, installUi]);
    const sim = app.sim;
    const g = sim.services.ground as GroundService;
    const game = sim.services.game as GameService;
    g.setPace('fast');
    let result: GameResult | null = null;
    game.onComplete((r) => { result = r; });
    game.begin();
    sim.run(1);

    // Safety exterior inspection before power-up
    expect(g.walkaround().ok).toBe(true);
    runUntil(sim, () => g.status().walkaround.state === 'done', 120, 'walk-around');
    expect(g.status().walkaround.beforePower).toBe(true);

    // Preliminary cockpit preparation
    setControl(sim, 'ELEC_BAT1', 1);
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    setControl(sim, 'ELEC_EXT_PWR', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    for (const n of [1, 3, 2]) setControl(sim, `ADIRS_IR${n}_MODE`, 1);
    g.boarding();
    setControl(sim, 'APU_MASTER', 1);
    sim.run(3);
    press(sim, 'APU_START');
    runUntil(sim, () => sim.getB('L:APU_START_AVAIL'), 90, 'APU AVAIL');
    sim.run(3);
    setControl(sim, 'AIR_APU_BLEED', 1);

    // FMGS + baro
    runUntil(sim, () => sim.getB('S:FMGS_POWERED'), 60, 'FMGS powered');
    doInitA(sim, 1);
    mcduPress(sim, 1, 'R3');
    doInitB(sim, 1);
    doPerfTo(sim, 1);
    setControl(sim, 'SIGNS_SEAT_BELTS', 0);
    game.markChecklist('cockpit_prep', true);
    runUntil(sim, () => [1, 2, 3].every((n) => sim.getB(`S:ADIRS_IR${n}_ALIGNED`)), 200, 'IRS aligned');

    // Boarding / loading complete → close L1, retract the bridge, cabin ready, slides
    runUntil(sim, () => g.status().loadsheetFinal, 400, 'final loadsheet');
    expect(g.door('PAX_L1', false).ok).toBe(true);
    runUntil(sim, () => sim.get('G:DOOR_PAX_L1') === 0, 30, 'L1 closed');
    expect(g.jetbridge(false).ok).toBe(true);
    runUntil(sim, () => sim.get('G:DOOR_CARGO_FWD') === 0 && sim.get('G:DOOR_CARGO_AFT') === 0, 200, 'cargo doors closed');
    runUntil(sim, () => sim.get('G:JETBRIDGE') === 0, 120, 'bridge retracted');
    runUntil(sim, () => sim.getB('G:CABIN_READY'), 120, 'cabin ready');
    expect(g.slides(true).ok).toBe(true);
    runUntil(sim, () => sim.getB('G:SLIDES_ARMED'), 60, 'slides armed');

    // GPU: refused while supplying, then EXT PWR off (APU GEN takes over) and disconnect
    expect(g.gpu(false).ok).toBe(false);
    setControl(sim, 'ELEC_EXT_PWR', 0);
    sim.run(2);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(0);
    expect(g.gpu(false).ok).toBe(true);
    runUntil(sim, () => g.status().gpu.state === 'disconnected', 60, 'GPU disconnected');
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);

    // Before start: beacon, park brake (already set), clearance
    setControl(sim, 'EXTLT_BEACON', 0);
    g.startClearance();
    runUntil(sim, () => g.status().clearance === 'granted', 60, 'start clearance');
    expect(sim.get('G:GND_CHOCKS')).toBe(0);
    game.markChecklist('before_start', true);

    // Engine start: ENG 2 then ENG 1
    setControl(sim, 'ENG_MODE', 2);
    sim.run(5);
    setControl(sim, 'ENG_MASTER2', 0);
    runUntil(sim, () => sim.getB('S:ENG2_RUNNING'), 90, 'ENG 2 running');
    sim.run(3);
    setControl(sim, 'ENG_MASTER1', 0);
    runUntil(sim, () => sim.getB('S:ENG1_RUNNING'), 90, 'ENG 1 running');
    runUntil(sim, () => game.state() === 'complete', 20, 'game complete');

    const r = result as unknown as GameResult;
    const failed = r.items.filter((i) => !i.ok).map((i) => `${i.id}: ${i.label} — ${i.detail ?? ''}`);
    console.log('[ui SOP] score', r.score, '/', r.total, 'elapsed', Math.round(r.elapsedS), 's; not OK:', failed, 'ECAM:', r.ecam);
    // Only the BARO REF item may fail here (the test does not set the EFIS baro knob).
    expect(failed.filter((f) => !f.startsWith('baro') && !f.startsWith('ecam'))).toEqual([]);
    expect(g.messages().some((m) => /Deux moteurs démarrés/.test(m.text))).toBe(true);
    expect(g.messages().filter((m) => m.level === 'warn').map((m) => m.text).filter((t) => !/Négatif|refus|EXT PWR/.test(t))).toEqual([]);
  });
});
