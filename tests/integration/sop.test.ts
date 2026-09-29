/**
 * Whole-game integration: the real SOP from COLD & DARK to BOTH ENGINES STARTED, with every logic module
 * installed together (sys-elec, sys-misc, sys-air, ecam, mcdu), driven only by cockpit controls, MCDU keys
 * and the ground state that the EFB ground services would change.
 */
import { describe, expect, it } from 'vitest';
import { headlessApp, installLogic, press, setControl } from '../../src/core/headless';
import type { Sim } from '../../src/core/sim';
import installElec from '../../src/systems/elec-hyd-fuel-apu/index';
import installMisc from '../../src/systems/misc/index';
import installAir from '../../src/systems/air-eng/index';
import installEcam from '../../src/avionics/ecam/index';
import installMcdu from '../../src/avionics/mcdu/index';
import { doInitA, doInitB, doPerfTo, press as mcduPress } from '../../src/avionics/mcdu/testing';

/** Run the sim until `cond` is true; returns the elapsed time (s), or fails after `maxS`. */
function runUntil(sim: Sim, cond: () => boolean, maxS: number, what: string): number {
  const t0 = sim.time;
  while (!cond()) {
    if (sim.time - t0 > maxS) throw new Error(`timeout after ${maxS}s waiting for: ${what}`);
    sim.run(0.5);
  }
  return sim.time - t0;
}

const warnings = (sim: Sim) =>
  (sim.services.ecam as { activeWarnings(): Array<{ text: string; level: number }> }).activeWarnings();

describe('SOP: cold & dark → both engines started (all logic modules together)', () => {
  it('follows the real sequence with realistic timings', { timeout: 120_000 }, async () => {
    const app = headlessApp({ timeOfDay: 'day' });
    app.settings.set('irsAlign', 'real');
    await installLogic(app, [installElec, installMisc, installAir, installEcam, installMcdu]);
    const sim = app.sim;
    sim.run(1);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(0);

    // ---- PRELIMINARY COCKPIT PREPARATION
    setControl(sim, 'ELEC_BAT1', 1);
    setControl(sim, 'ELEC_BAT2', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_DC_BAT_BUS')).toBe(1);
    setControl(sim, 'ELEC_EXT_PWR', 1);
    sim.run(2);
    expect(sim.get('S:ELEC_EXT_PWR_ON')).toBe(1);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1);

    // ADIRS: the three IR mode selectors to NAV
    for (const n of [1, 3, 2]) setControl(sim, `ADIRS_IR${n}_MODE`, 1);
    const tNav = sim.time;
    sim.run(30);
    expect(sim.get('S:ADIRS_IR1_STATE')).toBe(1); // aligning
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(1);

    // APU start, then APU BLEED
    setControl(sim, 'APU_MASTER', 1);
    sim.run(3);
    press(sim, 'APU_START');
    const tApu = runUntil(sim, () => sim.getB('L:APU_START_AVAIL'), 90, 'APU AVAIL');
    expect(tApu).toBeGreaterThan(35);
    sim.run(5);
    setControl(sim, 'AIR_APU_BLEED', 1);
    sim.run(5);
    expect(sim.get('S:APU_BLEED_PRESS')).toBeGreaterThan(25);

    // ---- COCKPIT PREPARATION: FMGS (FMGC power-up takes ~20 s; long done by now)
    expect(sim.get('S:FMGS_POWERED')).toBe(1);
    doInitA(sim, 1);
    mcduPress(sim, 1, 'R3'); // ALIGN IRS →
    sim.run(1);
    expect(sim.get('S:ADIRS_POS_ENTERED')).toBe(1);
    doInitB(sim, 1);
    doPerfTo(sim, 1);
    expect(sim.get('S:FMGS_INIT_A_DONE')).toBe(1);
    expect(sim.get('S:FMGS_INIT_B_DONE')).toBe(1);
    expect(sim.get('S:FMGS_PERF_TO_DONE')).toBe(1);
    expect(sim.get('S:FMGS_V1')).toBe(142);
    setControl(sim, 'SIGNS_SEAT_BELTS', 0);

    // IRS alignment completes (≈ 300 s / cos(lat) at LFBD, ≈ 7 min)
    runUntil(sim, () => [1, 2, 3].every((n) => sim.getB(`S:ADIRS_IR${n}_ALIGNED`)), 600, 'IRS aligned');
    const tAlign = sim.time - tNav;
    expect(tAlign).toBeGreaterThan(380);
    expect(tAlign).toBeLessThan(480);
    expect(sim.get('L:ADIRS_IR1_ALIGN')).toBe(0);

    // ---- BEFORE START: doors closed, GPU disconnected, beacon ON, park brake set, thrust levers idle
    for (const d of ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2', 'CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK']) sim.set(`G:DOOR_${d}`, 0);
    setControl(sim, 'ELEC_EXT_PWR', 0);
    sim.run(1);
    sim.set('G:GND_EXT_PWR', 0);
    setControl(sim, 'EXTLT_BEACON', 0);
    expect(sim.get('C:PARK_BRK')).toBe(1);
    sim.run(5);
    expect(sim.get('S:ELEC_AC_POWERED')).toBe(1); // APU GEN

    // ---- ENGINE START: ENG 2 then ENG 1
    setControl(sim, 'ENG_MODE', 2);
    sim.run(5);
    setControl(sim, 'ENG_MASTER2', 0);
    const t2 = runUntil(sim, () => sim.getB('S:ENG2_RUNNING'), 90, 'ENG 2 running');
    expect(t2).toBeGreaterThan(30);
    expect(sim.get('S:ENG2_START_FAULT')).toBe(0);
    sim.run(5);
    setControl(sim, 'ENG_MASTER1', 0);
    const t1 = runUntil(sim, () => sim.getB('S:ENG1_RUNNING'), 90, 'ENG 1 running');
    expect(t1).toBeGreaterThan(30);
    expect(sim.get('S:ENG1_START_FAULT')).toBe(0);
    sim.run(10);

    // ---- AFTER START
    setControl(sim, 'ENG_MODE', 1);
    setControl(sim, 'AIR_APU_BLEED', 0);
    sim.run(40);
    expect(sim.get('S:ENG1_N1')).toBeGreaterThan(18);
    expect(sim.get('S:ENG2_N1')).toBeGreaterThan(18);
    expect(sim.get('S:ELEC_GEN1_ON')).toBe(1);
    expect(sim.get('S:ELEC_GEN2_ON')).toBe(1);
    expect(sim.get('S:HYD_G_PRESS')).toBeGreaterThan(2500);
    expect(sim.get('S:HYD_Y_PRESS')).toBeGreaterThan(2500);
    expect(sim.get('S:HYD_B_PRESS')).toBeGreaterThan(2500);
    expect(sim.get('S:PACK1_VALVE')).toBe(1);
    expect(sim.get('S:PACK2_VALVE')).toBe(1);
    expect(sim.get('L:ENG1_FAULT')).toBe(0);
    expect(sim.get('L:ENG2_FAULT')).toBe(0);

    const w = warnings(sim);
    // No red warning at the end of a clean start; print the rest for review.
    expect(w.filter((x) => x.level >= 3)).toEqual([]);
    const ewd = (sim.services.ecam as { ewdText(): { left: string[]; right: string[] } }).ewdText();
    console.log('[SOP] timings: APU', tApu.toFixed(0), 's, IRS', tAlign.toFixed(0), 's, ENG2', t2.toFixed(0), 's, ENG1', t1.toFixed(0), 's');
    console.log('[SOP] active warnings:', JSON.stringify(w));
    console.log('[SOP] E/WD left:', JSON.stringify(ewd.left.filter((l) => l.trim())), 'right:', JSON.stringify(ewd.right.filter((l) => l.trim())));
    console.log('[SOP] MASTER CAUT', sim.get('L:MASTER_CAUT'), 'MASTER WARN', sim.get('L:MASTER_WARN'), 'phase', sim.get('S:FWC_FLIGHT_PHASE'));
  });
});
