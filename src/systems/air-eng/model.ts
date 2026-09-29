/**
 * sys-air model: owns every sub-system and the ordering between them.
 *   30 'air-eng.pneu'   bleed valves, X BLEED, duct pressures/temperatures (uses last tick's engine & pack state)
 *   40 'air-eng.eng'    FADECs + CFM56-5B engines, thrust limits
 *   45 'air-eng.air'    packs / zone temperatures, pressurisation, ventilation, anti-ice
 *  100 'air-eng.lights' annunciators of the owned panels
 */
import type { Sim } from '../../core/sim';
import type { TimeOfDay } from '../../core/settings';
import {
  ambientPressure, clamp, engMode, fireReleased, mach, makeRng, masterOn, oat, onGround, pbIn, pressureAltitude,
} from './common';
import { EngineCore } from './engine';
import { Fadec } from './fadec';
import { BleedModel } from './bleed';
import { PacksModel } from './packs';
import { PressModel } from './press';
import { VentModel } from './vent';
import { AntiIceModel } from './antiice';
import { flexN1, limitN1, mrevN1, type LimitInputs } from './thrust';

export const enum LimitType { TOGA = 0, FLX = 1, MCT = 2, CLB = 3, MREV = 4 }

export class AirEngModel {
  readonly rng: () => number;
  readonly eng: [Fadec, Fadec];
  readonly bleed: BleedModel;
  readonly packs: PacksModel;
  press!: PressModel;
  vent!: VentModel;
  readonly ai = new AntiIceModel();
  /** Thrust limits (N1 %). */
  toga = 85;
  mct = 83;
  clb = 82;
  flx = 80;
  mrev = 71;
  flexTemp = 0;
  flexActive = false;
  limitType: LimitType = LimitType.TOGA;
  limitN1 = 85;
  private initialised = false;
  private pendingPreset: string | null = null;
  /** Seconds during which fuel is assumed available after a preset (other modules converging). */
  private presetGrace = 0;

  constructor(sim: Sim, seed: number, private tod: () => TimeOfDay) {
    this.rng = makeRng(seed);
    const t = oat(sim);
    const e1 = new EngineCore(1, { n2Offset: 0, egtOffset: 6, ffOffset: 4, oilQtyBase: 17.4, oilPressOffset: 1.2, vibFactor: 1 }, t);
    const e2 = new EngineCore(2, { n2Offset: 0.2, egtOffset: -5, ffOffset: -3, oilQtyBase: 18.1, oilPressOffset: -0.8, vibFactor: 1.15 }, t);
    this.eng = [new Fadec(1, e1, this.rng), new Fadec(2, e2, this.rng)];
    this.bleed = new BleedModel(t);
    this.packs = new PacksModel(t, tod);
  }

  /** Late init (scenario G: vars are in place once the sim starts). */
  init(sim: Sim): void {
    if (this.initialised) return;
    this.initialised = true;
    const t = oat(sim);
    for (const f of this.eng) {
      f.core.egt = t;
      f.core.oilTemp = t;
      f.core.nacTemp = t;
    }
    this.bleed.temp = [t, t];
    const fresh = new PacksModel(t, this.tod);
    this.packs.zoneTemp = fresh.zoneTemp;
    this.packs.ductTemp = fresh.ductTemp;
    this.packs.outTemp = [t, t];
    this.packs.compTemp = [t, t];
    this.press = new PressModel(sim);
    this.vent = new VentModel(sim);
  }

  requestPreset(name: string): void { this.pendingPreset = name; }

  private applyPreset(sim: Sim, name: string): void {
    const t = oat(sim);
    const p = ambientPressure(sim);
    if (name === 'enginesRunning' || name === 'engine2Running' || name === 'engine1Running') {
      const which = name === 'enginesRunning' ? [0, 1] : name === 'engine2Running' ? [1] : [0];
      for (const i of which) {
        // Cockpit controls consistent with running engines: MASTER ON (catalog 0 = ON), ENG MODE NORM.
        sim.set(`C:ENG_MASTER${i + 1}`, 0);
        this.eng[i].presetRunning(t, p);
        this.packs.valvePos[i] = 1;
        this.bleed.press[i] = 42;
      }
      if (name === 'enginesRunning') {
        // After-start state: ENG MODE NORM, APU BLEED OFF (engine bleeds supply the packs).
        sim.set('C:ENG_MODE', 1);
        sim.set('C:AIR_APU_BLEED', 0);
      } else {
        // One engine started, the other one to be started next: ENG MODE stays at IGN/START.
        sim.set('C:ENG_MODE', 2);
      }
      for (const f of this.eng) f.primeEdges(sim);
      // Give the fuel system (sys-elec LP valves / feed) a few seconds to follow the MASTER levers.
      this.presetGrace = 5;
    }
  }

  /* ------------------------------------------------------------------ */

  updatePneu(sim: Sim, dt: number): void {
    this.init(sim);
    if (this.pendingPreset) { this.applyPreset(sim, this.pendingPreset); this.pendingPreset = null; }
    this.bleed.update(sim, dt, this.eng);
  }

  updateEngines(sim: Sim, dt: number): void {
    this.presetGrace = Math.max(0, this.presetGrace - dt);
    const t = oat(sim);
    const pAmb = ambientPressure(sim);
    const m = mach(sim);
    const gnd = onGround(sim);
    const li: LimitInputs = {
      pressAlt: pressureAltitude(sim), oat: t, mach: m,
      packs: this.packs.valvePos[0] > 0.5 || this.packs.valvePos[1] > 0.5,
      nai: this.ai.naiPos[0] > 0.5 || this.ai.naiPos[1] > 0.5,
      wai: this.ai.waiPos[0] > 0.5 || this.ai.waiPos[1] > 0.5,
    };
    this.computeLimits(sim, li, gnd);

    for (const i of [0, 1] as const) {
      const n = (i + 1) as 1 | 2;
      const f = this.eng[i];
      const feed = sim.has(`S:FUEL_ENG${n}_FEED`) ? sim.getB(`S:FUEL_ENG${n}_FEED`) : true;
      const lp = sim.has(`S:FUEL_ENG${n}_LP_VALVE`) ? sim.getB(`S:FUEL_ENG${n}_LP_VALVE`) : masterOn(sim, n) && !fireReleased(sim, n);
      const hydVar = n === 1 ? 'S:HYD_G_PRESS' : 'S:HYD_Y_PRESS';
      const revHyd = sim.has(hydVar) ? sim.get(hydVar) > 1500 : true;
      f.update(sim, {
        dt, oat: t, pAmb, mach: m, onGround: gnd,
        ductPsi: this.bleed.press[i],
        fuelAvail: (feed && lp) || this.presetGrace > 0,
        bleedLoad: this.bleed.bleedLoad(i),
        naiOn: this.ai.naiPos[i] > 0.5,
        waiOn: li.wai,
        n1Cmd: this.n1ForTla(sim.get(`C:THR_LEVER${n}`), f.core.idleN1),
        revHyd,
      });
    }
  }

  updateAir(sim: Sim, dt: number): void {
    const ditching = pbIn(sim, 'PRESS_DITCHING');
    const maxTla = Math.max(sim.get('C:THR_LEVER1'), sim.get('C:THR_LEVER2'));
    const toPower = onGround(sim) && (maxTla > 35.5 || (maxTla >= 33 && this.flexActive));
    this.packs.update(sim, dt, this.bleed, this.eng, ditching, this.press.deltaPsi);
    this.press.update(sim, dt, this.packs.freshFlow + this.packs.ramFlow, ditching, toPower);
    this.vent.update(sim, dt, ditching, toPower);
    this.ai.update(sim, dt, this.bleed, this.eng);
  }

  /* ------------------------------------------------------------------ */

  private computeLimits(sim: Sim, li: LimitInputs, gnd: boolean): void {
    this.toga = limitN1('TO', li);
    this.mct = limitN1('MCT', li);
    this.clb = limitN1('CLB', li);
    this.mrev = mrevN1(li);
    this.flexTemp = sim.get('S:FMGS_FLEX');
    this.flx = this.flexTemp > 0 ? flexN1(this.flexTemp, li) : this.toga;
    const tla1 = sim.get('C:THR_LEVER1');
    const tla2 = sim.get('C:THR_LEVER2');
    const maxTla = Math.max(tla1, tla2);
    // FLX: armed on ground by a FLEX temperature in the MCDU; kept after lift-off until CL or TOGA.
    if (gnd) this.flexActive = this.flexTemp > 0 && maxTla <= 35.5;
    else if (maxTla > 35.5 || maxTla <= 25.5) this.flexActive = false;
    let type: LimitType;
    if (tla1 < -3 || tla2 < -3) type = LimitType.MREV;
    else if (maxTla > 35.5) type = LimitType.TOGA;
    else if (gnd) type = this.flexActive ? LimitType.FLX : maxTla > 25.5 ? LimitType.MCT : LimitType.TOGA;
    else type = maxTla <= 25.5 ? LimitType.CLB : this.flexActive ? LimitType.FLX : LimitType.MCT;
    this.limitType = type;
    this.limitN1 = [this.toga, this.flx, this.mct, this.clb, this.mrev][type];
  }

  /** N1 commanded by a thrust lever angle (manual thrust), detents interpolated linearly. */
  n1ForTla(tlaDeg: number, idle: number): number {
    if (tlaDeg <= -3) return idle + (this.mrev - idle) * clamp((-tlaDeg - 6) / 14, 0, 1);
    if (tlaDeg <= 0) return idle;
    const mctFlx = this.flexActive ? this.flx : this.mct;
    if (tlaDeg <= 25) return idle + (this.clb - idle) * (tlaDeg / 25);
    if (tlaDeg <= 35) return this.clb + (mctFlx - this.clb) * ((tlaDeg - 25) / 10);
    return mctFlx + (this.toga - mctFlx) * clamp((tlaDeg - 35) / 10, 0, 1);
  }

  /* ------------------------------------------------------------------ */

  publish(sim: Sim): void {
    this.bleed.publish(sim);
    this.packs.publish(sim);
    this.press.publish(sim);
    this.vent.publish(sim);
    this.ai.publish(sim);
  }

  publishEngines(sim: Sim): void {
    const r = (v: number, k = 10) => Math.round(v * k) / k;
    for (const i of [0, 1] as const) {
      const n = i + 1;
      const f = this.eng[i];
      const c = f.core;
      sim.set(`S:ENG${n}_N1`, r(c.n1, 100));
      sim.set(`S:ENG${n}_N2`, r(c.n2, 100));
      sim.set(`S:ENG${n}_EGT`, r(c.egt));
      sim.set(`S:ENG${n}_FF`, r(c.ff));
      sim.set(`S:ENG${n}_OIL_PRESS`, r(c.oilPress));
      sim.set(`S:ENG${n}_OIL_TEMP`, r(c.oilTemp));
      sim.set(`S:ENG${n}_OIL_QTY`, r(c.oilQty));
      sim.set(`S:ENG${n}_VIB_N1`, r(c.vibN1, 100));
      sim.set(`S:ENG${n}_VIB_N2`, r(c.vibN2, 100));
      sim.set(`S:ENG${n}_START_VALVE`, f.startValvePos > 0.5 ? 1 : 0);
      sim.set(`S:ENG${n}_START_VALVE_POS`, r(f.startValvePos, 100));
      sim.set(`S:ENG${n}_START_VALVE_CMD`, f.startValveCmd ? 1 : 0);
      sim.set(`S:ENG${n}_IGN_A`, f.ignA ? 1 : 0);
      sim.set(`S:ENG${n}_IGN_B`, f.ignB ? 1 : 0);
      sim.set(`S:ENG${n}_CONT_IGN`, f.contIgn ? 1 : 0);
      sim.set(`S:ENG${n}_HP_FUEL_VALVE`, f.hpValve ? 1 : 0);
      sim.set(`S:ENG${n}_STATE`, f.state);
      sim.set(`S:ENG${n}_RUNNING`, f.running ? 1 : 0);
      sim.set(`S:ENG${n}_LIT`, c.lit ? 1 : 0);
      sim.set(`S:ENG${n}_FADEC_ON`, f.powered ? 1 : 0);
      sim.set(`S:ENG${n}_NAC_TEMP`, r(c.nacTemp));
      sim.set(`S:ENG${n}_REV`, r(f.rev, 100));
      sim.set(`S:ENG${n}_START_FAULT`, f.startFault);
      sim.set(`S:ENG${n}_START_ATTEMPT`, f.attempt);
      sim.set(`S:ENG${n}_STARTER_TIME`, r(f.starterTime));
      sim.set(`S:ENG${n}_STARTER_LIMIT`, f.starterLimit ? 1 : 0);
      sim.set(`S:ENG${n}_N1_CMD`, r(Math.max(f.n1Cmd, c.idleN1), 100));
      sim.set(`S:ENG${n}_THRUST`, r(c.thrustKn));
      sim.set(`S:ENG${n}_IDLE_N2`, r(c.idleN2, 100));
    }
    sim.set('S:ENG_MODE_SEL', engMode(sim));
    sim.set('S:ENG_THR_LIMIT_TYPE', this.limitType);
    sim.set('S:ENG_THR_LIMIT_N1', r(this.limitN1));
    sim.set('S:ENG_FLX_TEMP', this.limitType === LimitType.FLX ? Math.round(this.flexTemp) : 0);
    sim.set('S:ENG_TOGA_N1', r(this.toga));
    sim.set('S:ENG_MCT_N1', r(this.mct));
    sim.set('S:ENG_CLB_N1', r(this.clb));
    sim.set('S:ENG_FLX_N1', r(this.flx));
    sim.set('S:ENG_MREV_N1', r(this.mrev));
    sim.set('S:ENG_IDLE_N1', r(this.eng[0].core.idleN1));
  }
}
