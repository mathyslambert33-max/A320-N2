/**
 * Brakes (FCOM DSC-32-30): normal braking (GREEN, BSCU, anti-skid) and alternate braking (YELLOW +
 * brake accumulator), parking brake, triple pressure indicator, brake temperatures, brake fans,
 * nose-wheel steering availability. DOM-free.
 *
 *  - Brake accumulator (yellow): 1 US gal, nitrogen precharge 1000 psi, charged to 3000 psi by any
 *    yellow pump (check valve). Gauge reads 0 when the fluid is exhausted. ≈ 7 full brake applications.
 *    Slow internal leakage (a charged accumulator holds the parking brake > 12 h). Cold & dark value
 *    random 2000-2800 psi (bled down overnight): the Y ELEC PUMP recharges it.
 *  - Parking brake ON: alternate circuit, pressure limited to ≈ 2100 psi (≈ 2500 psi with pedal input),
 *    read on the triple indicator L/R needles. With pedals and no parking brake: normal (green) brakes
 *    if GREEN > 2176/1305 psi (hysteresis) and A/SKID ON — the triple indicator then reads 0 — otherwise
 *    alternate brakes (limit 1000-1160 psi with A/SKID OFF).
 *  - Brake temperatures from the braking energy (GW, speed, pressure) and cooling (τ ≈ 50 min, ≈ 12 min
 *    with BRK FANS). HOT above 300 °C.
 *  - NWS available: yellow pressure > 1500 psi, A/SKID & N/W STRG ON, towing pin not inserted (tow bar
 *    connected), BSCU powered, on ground.
 */
import type { Sim } from '../../core/sim';
import { clamp, approach } from '../../core/sim';
import type { Model } from './model';
import { askidOn, onGround, oat, parkBrakeOn } from './common';

const ACC_V0 = 1.0; // gal
const ACC_P0 = 1000; // psi precharge
const BRAKE_VOL = 0.045; // gal of fluid per brake side at 3000 psi
const volAt = (p: number) => BRAKE_VOL * Math.sqrt(clamp(p, 0, 3200) / 3000);

export class BrakeModel {
  accuFluidGal: number;
  accuPress = 0;
  pressL = 0;
  pressR = 0;
  normL = 0;
  normR = 0;
  temps: number[] = [15, 15, 15, 15];
  fansRunning = false;
  normalAvail = false;
  nwsAvail = false;
  parkEffective = false;

  constructor(private m: Model) {
    const p = 2000 + 800 * m.rng();
    this.accuFluidGal = ACC_V0 * (1 - ACC_P0 / p);
    this.accuPress = p;
  }

  init(sim: Sim): void {
    const t = oat(sim);
    const r = this.m.rng;
    this.temps = [0, 1, 2, 3].map(() => Math.round((t - 1 + 2 * r()) * 10) / 10);
    // The parking brake was set overnight: brakes pressurised from the accumulator.
    if (parkBrakeOn(sim)) {
      const p = Math.min(2103, this.accuPress);
      this.pressL = p;
      this.pressR = p;
    }
  }

  /** Force a charged accumulator (presets). */
  setAccu(p: number): void {
    this.accuFluidGal = p > ACC_P0 ? ACC_V0 * (1 - ACC_P0 / p) : 0;
    this.accuPress = p;
  }

  update(dt: number, sim: Sim): void {
    const m = this.m;
    const h = m.hyd;
    const e = m.elec;
    const gnd = onGround(sim);
    const park = parkBrakeOn(sim);
    const askid = askidOn(sim);
    const pedL = clamp(sim.get('C:BRAKE_L'), 0, 1);
    const pedR = clamp(sim.get('C:BRAKE_R'), 0, 1);
    const bscu = (e.ac1 && e.dc1) || (e.ac2 && e.dc2) || (e.dcEss && e.acEss);

    // ---------------- accumulator charging from yellow ----------------
    const pY = h.press.Y;
    if (pY > this.accuPress + 20 && h.yCap > 0.01) {
      const flow = Math.min(0.11 * h.yCap, 0.4) * dt; // gal
      const fluidAtPy = ACC_V0 * (1 - ACC_P0 / Math.max(pY, ACC_P0 + 1));
      this.accuFluidGal = Math.min(fluidAtPy, this.accuFluidGal + flow);
    }
    // Slow internal leakage (~0.02 psi/s at 3000 psi) — "holds more than 12 h".
    this.accuFluidGal = Math.max(0, this.accuFluidGal - 2.5e-6 * dt * (this.accuPress / 3000));
    this.updateAccuPress();

    // ---------------- normal / alternate selection ----------------
    const pG = h.press.G;
    if (pG > 2176) this.normalAvail = true;
    else if (pG < 1305) this.normalAvail = false;
    const greenBrakes = this.normalAvail && askid && !park && bscu;
    const yellowManual = pedL > 0.2 || pedR > 0.2;
    let limit: number;
    let demL: number;
    let demR: number;
    if (greenBrakes) {
      demL = 0;
      demR = 0;
      limit = 0;
      this.normL = approach(this.normL, pedL * 2538, 12000, dt);
      this.normR = approach(this.normR, pedR * 2538, 12000, dt);
    } else {
      this.normL = approach(this.normL, 0, 12000, dt);
      this.normR = approach(this.normR, 0, 12000, dt);
      if (park) {
        limit = yellowManual ? 2538 : 2103;
        demL = 1;
        demR = 1;
      } else {
        limit = askid ? 2538 : 1160;
        demL = pedL;
        demR = pedR;
      }
    }

    // ---------------- alternate circuit pressures ----------------
    const src = Math.max(pY, this.accuPress);
    const fromSystem = pY >= this.accuPress && h.yCap > 0.05;
    const step = (cur: number, dem: number) => {
      const target = Math.min(dem * limit, Math.max(0, src - 30));
      if (target > cur) {
        const next = approach(cur, target, 9000, dt);
        const need = volAt(next) - volAt(cur);
        if (!fromSystem) {
          // taken from the accumulator
          const take = Math.min(need, this.accuFluidGal);
          this.accuFluidGal -= take;
          this.updateAccuPress();
          if (take < need) return cur + (next - cur) * (need > 0 ? take / need : 0);
        }
        return next;
      }
      return approach(cur, target, 9000, dt); // released fluid returns to the reservoir
    };
    this.pressL = step(this.pressL, demL);
    this.pressR = step(this.pressR, demR);
    // Pressure in the brakes can never exceed the source (accumulator) pressure.
    this.pressL = Math.min(this.pressL, Math.max(this.accuPress, pY));
    this.pressR = Math.min(this.pressR, Math.max(this.accuPress, pY));
    // Special case: parking brake ON but yellow cannot hold it → normal brakes available on pedals
    if (park && (this.pressL < 507 || this.pressR < 507) && this.normalAvail && bscu) {
      this.normL = approach(this.normL, pedL * 2538, 12000, dt);
      this.normR = approach(this.normR, pedR * 2538, 12000, dt);
    }
    this.parkEffective = park && Math.min(this.pressL, this.pressR) > 500;

    // ---------------- brake temperatures ----------------
    const gsKt = Math.abs(sim.get('G:AC_GS_KT'));
    const gw = sim.get('G:AC_GW_KG') || 64000;
    const T = oat(sim);
    this.fansRunning = sim.get('C:BRK_FAN') > 0.5 && e.ac2 && gnd;
    const tau = this.fansRunning ? 12 * 60 : 50 * 60;
    const effL = Math.max(this.pressL, this.normL);
    const effR = Math.max(this.pressR, this.normR);
    const v = gsKt * 0.5144;
    for (let i = 0; i < 4; i++) {
      const p = i < 2 ? effL : effR;
      // decel ≈ 5 m/s² at 3000 psi; power per brake = m·a·v / 4; heat capacity ≈ 110 kJ/K per carbon brake
      const heat = v > 0.2 ? (gw * 5 * (p / 3000) * v) / 4 / 110e3 : 0;
      this.temps[i] += (heat - (this.temps[i] - T) / tau) * dt;
    }
    this.nwsAvail = gnd && pY > 1500 && askid && !sim.getB('G:GND_TOWBAR') && bscu;

    // brake fans load (AC 2)
    if (this.fansRunning) e.extraAc.AC2 += 0.5;

    this.publish(sim, park);
  }

  private updateAccuPress(): void {
    this.accuPress = this.accuFluidGal > 1e-5 ? ACC_P0 * ACC_V0 / (ACC_V0 - this.accuFluidGal) : 0;
  }

  private publish(sim: Sim, park: boolean): void {
    const set = (k: string, v: number | boolean) => sim.set(k, v);
    set('S:BRK_ACCU_PRESS', Math.round(this.accuPress));
    set('S:BRK_PRESS_L', Math.round(this.pressL));
    set('S:BRK_PRESS_R', Math.round(this.pressR));
    set('S:BRK_NORM_PRESS_L', Math.round(this.normL));
    set('S:BRK_NORM_PRESS_R', Math.round(this.normR));
    set('S:BRK_NORM_AVAIL', this.normalAvail);
    set('S:BRK_PARK_ON', this.parkEffective);
    set('S:BRK_PARK_LEVER', park);
    for (let i = 0; i < 4; i++) set(`S:BRK_TEMP_${i + 1}`, Math.round(this.temps[i] * 10) / 10);
    set('S:BRK_HOT', this.temps.some((t) => t > 300));
    set('S:BRK_FAN_RUNNING', this.fansRunning);
    set('S:NWS_AVAIL', this.nwsAvail);
  }
}
