/**
 * Ice & rain protection (A320 FCOM DSC-30): wing anti-ice (slats 3-4-5, bleed air), engine nacelle
 * anti-ice (HP bleed of each engine), probe & window heat (3 PHCs).
 *
 * WING ANTI ICE pb ON: in flight the two wing valves open (electrically controlled, pneumatically
 * operated — need duct pressure). On ground the valves open for 30 s only (test sequence), then close.
 * FAULT (amber): valve position disagrees with the commanded position (transiently during valve travel)
 * or low pressure in flight with the valves open.
 * ENG ANTI ICE pb ON: nacelle valve opens (needs engine bleed pressure: engine running). FAULT: valve
 * position disagrees with the pb selection (e.g. pb ON with the engine stopped), transient in travel.
 * PROBE/WINDOW HEAT (pb released = AUTO): probes & windows heated when at least one engine is running
 * or in flight; on ground pitots at low power, windshield at low power, TAT probes not heated.
 * pb ON: heating forced (still no TAT heat on ground).
 */
import type { Sim } from '../../core/sim';
import { acPowered, anyDc, clamp, onGround, pbIn } from './common';
import type { BleedModel } from './bleed';
import { engineBleedSource } from './bleed';
import type { Fadec } from './fadec';

export const WAI_GROUND_TEST_S = 30;

export class AntiIceModel {
  waiPos = [0, 0];
  waiCmd = false;
  waiFault = false;
  private waiTestTimer = 0;
  private waiPbWas = false;
  naiPos = [0, 0];
  naiFault = [false, false];
  private naiDisagree = [0, 0];
  probeHeat = false;
  pitot = 0;
  window = 0;
  tat = false;

  update(sim: Sim, dt: number, bleed: BleedModel, eng: [Fadec, Fadec]): void {
    const gnd = onGround(sim);
    const dc = anyDc(sim);

    /* ---------------- wing ---------------- */
    const waiPb = pbIn(sim, 'AI_WING');
    if (waiPb && !this.waiPbWas) this.waiTestTimer = 0;
    this.waiPbWas = waiPb;
    if (waiPb) this.waiTestTimer += dt;
    this.waiCmd = waiPb && dc && (!gnd || this.waiTestTimer < WAI_GROUND_TEST_S);
    let lowPress = false;
    for (const i of [0, 1] as const) {
      const p = bleed.press[i];
      const target = this.waiCmd && p >= 10 ? 1 : 0;
      this.waiPos[i] = clamp(this.waiPos[i] + (target > this.waiPos[i] ? dt : -dt) / 2, 0, 1);
      bleed.waiDemand[i] = this.waiPos[i] > 0.05 ? 0.28 * this.waiPos[i] : 0;
      if (!gnd && this.waiPos[i] > 0.5 && p < 10) lowPress = true;
    }
    const disagree = this.waiPos.some((v) => (v > 0.5) !== this.waiCmd);
    this.waiFault = dc && (disagree || lowPress);

    /* ---------------- engine nacelles ---------------- */
    for (const i of [0, 1] as const) {
      const n = i + 1;
      const pb = pbIn(sim, `AI_ENG${n}`);
      const src = engineBleedSource(eng[i].core.n2, eng[i].core.lit);
      const target = pb && src >= 8 ? 1 : 0;
      this.naiPos[i] = clamp(this.naiPos[i] + (target > this.naiPos[i] ? dt : -dt) / 1.5, 0, 1);
      const dis = (this.naiPos[i] > 0.5) !== pb;
      this.naiDisagree[i] = dis ? this.naiDisagree[i] + dt : 0;
      this.naiFault[i] = dc && this.naiDisagree[i] > 0.5;
    }

    /* ---------------- probe & window heat ---------------- */
    const forced = pbIn(sim, 'AI_PROBE_WINDOW');
    const engRunning = eng[0].running || eng[1].running || eng[0].runningOrStarted() || eng[1].runningOrStarted();
    const ac = acPowered(sim);
    const on = ac && (forced || engRunning || !gnd);
    this.probeHeat = on;
    this.pitot = on ? (gnd ? 0.5 : 1) : 0;
    this.window = on ? (gnd ? 0.5 : 1) : 0;
    this.tat = on && !gnd;
  }

  publish(sim: Sim): void {
    sim.set('S:AI_WING_VALVE_L', this.waiPos[0] > 0.5 ? 1 : 0);
    sim.set('S:AI_WING_VALVE_R', this.waiPos[1] > 0.5 ? 1 : 0);
    sim.set('S:AI_WING_CMD', this.waiCmd ? 1 : 0);
    sim.set('S:AI_WING_FAULT', this.waiFault ? 1 : 0);
    sim.set('S:AI_ENG1_VALVE', this.naiPos[0] > 0.5 ? 1 : 0);
    sim.set('S:AI_ENG2_VALVE', this.naiPos[1] > 0.5 ? 1 : 0);
    sim.set('S:AI_ENG1_FAULT', this.naiFault[0] ? 1 : 0);
    sim.set('S:AI_ENG2_FAULT', this.naiFault[1] ? 1 : 0);
    sim.set('S:AI_PROBE_HEAT', this.probeHeat ? 1 : 0);
    sim.set('S:AI_PITOT_HEAT', this.pitot);
    sim.set('S:AI_WINDOW_HEAT', this.window);
    sim.set('S:AI_TAT_HEAT', this.tat ? 1 : 0);
  }
}
