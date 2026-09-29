/**
 * A320ceo fuel system (FCOM DSC-28). DOM-free.
 *
 * Tanks (kg, 0.785 kg/L): outer 691, inner 5436, centre 6476. Initial load from SCENARIO.fuel.
 * Pumps: L/R TK PUMP 1 + CTR TK PUMP 1 on AC BUS 1 (L1/R1 directly on GEN 1 in SMOKE config),
 * L/R TK PUMP 2 + CTR TK PUMP 2 on AC BUS 2. FAULT = low delivery pressure with the pb ON (centre pumps:
 * inhibited when stopped by the MODE SEL AUTO logic).
 * MODE SEL AUTO (centre pumps): run 2 min after the first engine start (even with slats extended); then
 * run when an engine runs and the slats are retracted; stop when the inner tanks are full (overflow) and
 * restart after 500 kg burnt; stop 5 min after the centre tank low level (≈ 130 kg). Centre pumps have
 * delivery priority over the wing pumps (sequence valves).
 * MODE SEL FAULT: centre tank > 250 kg while a wing tank holds < 5000 kg.
 * X FEED: motor valve (DC ESS SHED / DC 2), ≈ 1.6 s travel; OPEN green only when fully open.
 * ENG LP valves: open with ENG MASTER ON, closed by ENG MASTER OFF or ENG FIRE pb released.
 * Outer tank transfer valves open (latched) when an inner tank reaches 750 kg.
 * APU: fed from the left feed line through the APU LP valve (MASTER SW ON); APU fuel pump (AC STAT INV /
 * AC ESS SHED) runs when there is no pressure from the left pumps.
 * FUEL USED per engine reset when the ENG MASTER is set ON on the ground.
 */
import type { Sim } from '../../core/sim';
import { clamp, lag, approach } from '../../core/sim';
import { SCENARIO } from '../../core/scenario';
import type { Model } from './model';
import { engMasterOn, engRunning, fireReleased, onGround, oat, pbIn } from './common';

export type Tank = 'LO' | 'LI' | 'C' | 'RI' | 'RO';
export type Pump = 'L1' | 'L2' | 'C1' | 'C2' | 'R1' | 'R2';
export const CAPACITY: Record<Tank, number> = { LO: 691, LI: 5436, C: 6476, RI: 5436, RO: 691 };
const PUMPS: Pump[] = ['L1', 'L2', 'C1', 'C2', 'R1', 'R2'];
const PB: Record<Pump, string> = {
  L1: 'FUEL_L_PUMP1', L2: 'FUEL_L_PUMP2', C1: 'FUEL_CTR_PUMP1', C2: 'FUEL_CTR_PUMP2', R1: 'FUEL_R_PUMP1', R2: 'FUEL_R_PUMP2',
};

export class FuelModel {
  qty: Record<Tank, number>;
  pumpRunning: Record<Pump, boolean> = { L1: false, L2: false, C1: false, C2: false, R1: false, R2: false };
  pumpPress: Record<Pump, number> = { L1: 0, L2: 0, C1: 0, C2: 0, R1: 0, R2: 0 };
  pumpFault: Record<Pump, boolean> = { L1: false, L2: false, C1: false, C2: false, R1: false, R2: false };
  ctrAutoRun = false;
  modeSelFault = false;
  xfeedPos = 0;
  lpValve = [0, 0];
  apuLp = 0;
  apuPump = false;
  apuFeed = false;
  outerXfr = [false, false];
  used = [0, 0];
  temp = [15, 15];
  engFeed = [false, false];
  private ctrTestLeft = 0;
  private anyMasterWas = false;
  private masterWas = [false, false];
  private ctrLowFor = 0;
  private overflowStop = false;

  constructor(private m: Model) {
    const f = SCENARIO.fuel;
    this.qty = { LO: f.leftOuter, LI: f.leftInner, C: f.center, RI: f.rightInner, RO: f.rightOuter };
  }

  init(sim: Sim): void {
    const T = oat(sim);
    this.temp = [T - 2.5 + this.m.rng(), T - 2.5 + this.m.rng()];
    this.masterWas = [engMasterOn(sim, 1), engMasterOn(sim, 2)];
    this.anyMasterWas = this.masterWas[0] || this.masterWas[1];
    for (let i = 0; i < 2; i++) if (this.masterWas[i] && !fireReleased(sim, i === 0 ? 'FIRE_ENG1_PB' : 'FIRE_ENG2_PB')) this.lpValve[i] = 1;
    if (this.qty.LI <= 750) this.outerXfr[0] = true;
    if (this.qty.RI <= 750) this.outerXfr[1] = true;
  }

  update(dt: number, sim: Sim): void {
    const m = this.m;
    const e = m.elec;
    const gnd = onGround(sim);
    const masters = [engMasterOn(sim, 1), engMasterOn(sim, 2)];
    const anyRunning = engRunning(sim, 1) || engRunning(sim, 2);

    // ---------------- centre tank AUTO logic ----------------
    const auto = pbIn(sim, 'FUEL_MODE_SEL');
    const anyMaster = masters[0] || masters[1];
    if (anyMaster && !this.anyMasterWas) this.ctrTestLeft = 120; // first engine start
    this.anyMasterWas = anyMaster;
    this.ctrTestLeft = Math.max(0, this.ctrTestLeft - dt);
    const slatsRetracted = sim.get('S:FCTL_SLATS') < 1;
    const ctrLow = this.qty.C < 130;
    this.ctrLowFor = ctrLow ? this.ctrLowFor + dt : 0;
    const innerFull = this.qty.LI >= CAPACITY.LI - 5 || this.qty.RI >= CAPACITY.RI - 5;
    if (innerFull) this.overflowStop = true;
    else if (this.qty.LI < CAPACITY.LI - 500 && this.qty.RI < CAPACITY.RI - 500) this.overflowStop = false;
    this.ctrAutoRun = this.ctrTestLeft > 0 ||
      ((anyRunning || !gnd) && slatsRetracted && this.ctrLowFor < 300 && !this.overflowStop);

    // ---------------- pumps ----------------
    const acFor: Record<Pump, boolean> = {
      L1: e.ac1 || e.gen1Energised, R1: e.ac1 || e.gen1Energised, C1: e.ac1,
      L2: e.ac2, R2: e.ac2, C2: e.ac2,
    };
    const tankOf = (p: Pump): Tank => (p[0] === 'L' ? 'LI' : p[0] === 'R' ? 'RI' : 'C');
    for (const p of PUMPS) {
      const pb = pbIn(sim, PB[p]);
      const isCtr = p[0] === 'C';
      const cmd = pb && (!isCtr || !auto || this.ctrAutoRun);
      this.pumpRunning[p] = cmd && acFor[p];
      const hasFuel = this.qty[tankOf(p)] > 2;
      this.pumpPress[p] = approach(this.pumpPress[p], this.pumpRunning[p] && hasFuel ? 1 : 0, this.pumpRunning[p] ? 1.2 : 0.8, dt);
      const low = this.pumpPress[p] < 0.5;
      const inhibited = isCtr && auto && (!this.ctrAutoRun || ctrLow);
      this.pumpFault[p] = pb && low && !inhibited;
    }
    this.modeSelFault = this.qty.C > 250 && (this.qty.LI + this.qty.LO < 5000 || this.qty.RI + this.qty.RO < 5000);

    // ---------------- valves ----------------
    const xMotor = e.dcEssShed || e.dc2;
    if (xMotor) this.xfeedPos = approach(this.xfeedPos, pbIn(sim, 'FUEL_XFEED') ? 1 : 0, 1 / 1.6, dt);
    const lpMotor = e.dcEss || e.dc2;
    for (let i = 0; i < 2; i++) {
      const open = masters[i] && !fireReleased(sim, i === 0 ? 'FIRE_ENG1_PB' : 'FIRE_ENG2_PB');
      if (lpMotor) this.lpValve[i] = approach(this.lpValve[i], open ? 1 : 0, 1 / 1.2, dt);
    }
    const apuLpCmd = m.apu.lpValveCmd && !fireReleased(sim, 'FIRE_APU_PB');
    if (e.dcBat || e.hot1) this.apuLp = approach(this.apuLp, apuLpCmd ? 1 : 0, 1 / 1.2, dt);
    if (this.qty.LI <= 750) this.outerXfr[0] = true;
    if (this.qty.RI <= 750) this.outerXfr[1] = true;

    // ---------------- pressures & feed ----------------
    const leftP = Math.max(this.pumpPress.L1, this.pumpPress.L2);
    const rightP = Math.max(this.pumpPress.R1, this.pumpPress.R2);
    const ctrP = Math.max(this.pumpPress.C1, this.pumpPress.C2);
    const xOpen = this.xfeedPos > 0.5;
    // CTR pump 1 feeds the left engine line, CTR pump 2 the right one.
    const sideP = [
      Math.max(leftP, this.pumpPress.C1, xOpen ? Math.max(rightP, this.pumpPress.C2) : 0),
      Math.max(rightP, this.pumpPress.C2, xOpen ? Math.max(leftP, this.pumpPress.C1) : 0),
    ];
    // APU: left feed line (or right through X FEED); APU fuel pump when no pressure
    const apuPumpPowered = e.acStatInv || e.acEssShed;
    const apuNeedsFuel = m.apu.ecbOn && this.apuLp > 0.9;
    this.apuPump = apuNeedsFuel && sideP[0] < 0.5 && apuPumpPowered;
    const leftFuel = this.qty.LI + this.qty.C > 5 || (xOpen && this.qty.RI > 5);
    this.apuFeed = this.apuLp > 0.9 && (sideP[0] > 0.5 || this.apuPump) && leftFuel;
    // Engines: pump pressure, or suction feed from the inner tank (gravity) on ground / low altitude
    for (let i = 0; i < 2; i++) {
      const inner = i === 0 ? this.qty.LI : this.qty.RI;
      this.engFeed[i] = (sideP[i] > 0.5 || inner > 5) && (inner > 5 || this.qty.C > 5 || xOpen);
    }

    // ---------------- consumption ----------------
    const ff = [Math.max(0, sim.get('S:ENG1_FF')), Math.max(0, sim.get('S:ENG2_FF'))];
    const burn = [ff[0] * dt / 3600, ff[1] * dt / 3600];
    const apuBurn = (m.apu.fuelFlow * dt) / 3600;
    const ctrFeeds = ctrP > 0.5 && this.qty.C > 1;
    const draw = (side: 0 | 1, kg: number) => {
      if (kg <= 0) return;
      if (ctrFeeds) {
        const t = Math.min(kg, this.qty.C);
        this.qty.C -= t;
        kg -= t;
      }
      const sides: (0 | 1)[] = xOpen ? [0, 1] : [side];
      for (const sd of sides) {
        const inner: Tank = sd === 0 ? 'LI' : 'RI';
        const t = Math.min(kg / sides.length, this.qty[inner]);
        this.qty[inner] -= t;
        kg -= t;
      }
      if (kg > 0) {
        const inner: Tank = side === 0 ? 'LI' : 'RI';
        const other: Tank = side === 0 ? 'RI' : 'LI';
        const t = Math.min(kg, this.qty[inner]);
        this.qty[inner] -= t;
        kg -= t;
        if (kg > 0 && xOpen) this.qty[other] = Math.max(0, this.qty[other] - kg);
      }
    };
    draw(0, burn[0] + apuBurn);
    draw(1, burn[1]);
    for (let i = 0; i < 2; i++) this.used[i] += burn[i];
    // outer → inner transfer (gravity, ≈ 1 t/h per side)
    for (let i = 0; i < 2; i++) {
      if (!this.outerXfr[i]) continue;
      const o: Tank = i === 0 ? 'LO' : 'RO';
      const inn: Tank = i === 0 ? 'LI' : 'RI';
      const t = Math.min(this.qty[o], (1000 * dt) / 3600, CAPACITY[inn] - this.qty[inn]);
      this.qty[o] -= t;
      this.qty[inn] += t;
    }
    // FUEL USED reset at ENG MASTER ON on ground
    for (let i = 0; i < 2; i++) {
      if (masters[i] && !this.masterWas[i] && gnd) this.used[i] = 0;
      this.masterWas[i] = masters[i];
    }
    // temperatures (outer cells): soak toward OAT, warmed by the IDG oil-cooling return flow
    for (let i = 0; i < 2; i++) {
      const warm = engRunning(sim, i + 1) ? 7 : 0;
      this.temp[i] = lag(this.temp[i], oat(sim) + warm, warm ? 2400 : 7200, dt);
    }

    // elec loads
    for (const p of PUMPS) {
      if (!this.pumpRunning[p]) continue;
      const kva = this.pumpPress[p] > 0.5 ? 1.1 : 0.7;
      if (p === 'L1' || p === 'R1' || p === 'C1') e.extraAc.AC1 += e.ac1 ? kva : 0;
      else e.extraAc.AC2 += kva;
    }
    if (this.apuPump) {
      if (e.acEssShed) e.extraAc.ESS_SHED += 0.3;
      else e.extraAc.STAT_INV += 0.3;
    }

    this.publish(sim);
  }

  private publish(sim: Sim): void {
    const set = (k: string, v: number | boolean) => sim.set(k, v);
    const r = (v: number) => Math.round(v * 10) / 10;
    set('S:FUEL_LO_KG', r(this.qty.LO));
    set('S:FUEL_LI_KG', r(this.qty.LI));
    set('S:FUEL_C_KG', r(this.qty.C));
    set('S:FUEL_RI_KG', r(this.qty.RI));
    set('S:FUEL_RO_KG', r(this.qty.RO));
    set('S:FUEL_FOB_KG', r(this.qty.LO + this.qty.LI + this.qty.C + this.qty.RI + this.qty.RO));
    set('S:FUEL_ENG1_FEED', this.engFeed[0]);
    set('S:FUEL_ENG2_FEED', this.engFeed[1]);
    set('S:FUEL_ENG1_LP_VALVE', this.lpValve[0] >= 0.99);
    set('S:FUEL_ENG2_LP_VALVE', this.lpValve[1] >= 0.99);
    set('S:FUEL_ENG1_LP_VALVE_POS', Math.round(this.lpValve[0] * 100) / 100);
    set('S:FUEL_ENG2_LP_VALVE_POS', Math.round(this.lpValve[1] * 100) / 100);
    set('S:FUEL_XFEED_OPEN', this.xfeedPos >= 0.999);
    set('S:FUEL_XFEED_POS', Math.round(this.xfeedPos * 100) / 100);
    set('S:FUEL_XFEED_MOVING', this.xfeedPos > 0.001 && this.xfeedPos < 0.999);
    set('S:FUEL_APU_FEED', this.apuFeed);
    set('S:FUEL_APU_LP_VALVE', this.apuLp >= 0.99);
    set('S:FUEL_APU_PUMP_ON', this.apuPump);
    set('S:FUEL_USED_1', Math.round(this.used[0]));
    set('S:FUEL_USED_2', Math.round(this.used[1]));
    set('S:FUEL_TEMP_L', Math.round(this.temp[0]));
    set('S:FUEL_TEMP_R', Math.round(this.temp[1]));
    for (const p of PUMPS) {
      set(`S:FUEL_PUMP_${p}_ON`, this.pumpRunning[p]);
      set(`S:FUEL_PUMP_${p}_PRESS`, this.pumpPress[p] > 0.5);
    }
    set('S:FUEL_CTR_PUMPS_ON', (this.pumpPress.C1 > 0.5 || this.pumpPress.C2 > 0.5) && this.qty.C > 1);
    set('S:FUEL_CTR_AUTO_RUN', this.ctrAutoRun);
    set('S:FUEL_MODE_SEL_FAULT', this.modeSelFault);
    set('S:FUEL_OUTER_XFR_L', this.outerXfr[0]);
    set('S:FUEL_OUTER_XFR_R', this.outerXfr[1]);
  }
}
