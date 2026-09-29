/**
 * Landing gear indications (LGCIU), autobrake, nose wheel steering angle, tyre pressures, radio altimeter.
 * FCOM DSC-32 (landing gear, braking, steering), DSC-34 (radio altimeter).
 *
 *  - LGCIU 1: DC ESS BUS, LGCIU 2: DC 2 BUS. The LDG GEAR indicator panel (centre panel) is driven by
 *    LGCIU 1: green ▼ = gear down-locked, red UNLK = gear not locked in the lever position.
 *  - Gear actuation (green hydraulics): doors open (≈ 3 s), gear travel (≈ 10 s up / 12 s down), doors close.
 *    Retraction is inhibited on ground (shock absorbers compressed).
 *  - Red arrow on the gear lever: in flight, gear not down-locked, RA < 750 ft and (CONF 3/FULL or
 *    thrust levers at idle) — i.e. the "L/G GEAR NOT DOWN" condition.
 *  - Autobrake (BSCU): arming needs green pressure, A/SKID & N/W STRG ON, BSCU powered (DC 1 or DC 2) and
 *    at least two valid IRs; MAX can only be armed on ground. Pressing the lit pb disarms. Activation when
 *    the ground spoilers extend (delay LO 4 s, MED 2 s, MAX 0 s); target deceleration LO 1.7, MED 3.0, MAX 6 m/s²
 *    (MAX: max braking pressure). DECEL light when the actual deceleration ≥ 80 % of the target. Disarmed
 *    by a brake pedal deflection > 0.5 once active, by the loss of an arming condition, or when the ground
 *    spoilers retract after activation. The braking force itself is applied by the world/physics
 *    (S:AUTOBRK_ACTIVE, S:AUTOBRK_TARGET_DECEL).
 *  - Nose wheel steering (hydraulic, yellow, when sys-elec's S:NWS_AVAIL): tiller ±75° (full authority up to
 *    20 kt, fading to 0 at 70 kt, non-linear law), rudder pedals ±6° (up to 40 kt, fading to 0 at 130 kt).
 *    Without NWS the wheel castors (towing / pushback) and self-centres with the aircraft moving.
 *  - Tyres: main 200 psi, nose 182 psi nominal (cold, 15 °C), gas law with the tyre temperature (OAT plus a
 *    fraction of the brake temperature).
 *  - Radio altimeters: RA 1 AC ESS SHED, RA 2 AC 2. 0 ft on ground, G:AC_RADALT_FT (or G:AC_ALT_AGL_FT)
 *    airborne; NCD above 2500 ft (S:RA_VALID 0). S:RA_ALT = 0 when unpowered.
 */
import { approach } from '../../core/sim';
import { type Ctx, b2n, clamp, interp, HYD_OK, Edge } from './common';

const DOOR_TIME = 3;
const RETRACT_TIME = 10;
const EXTEND_TIME = 12;
const AB_TARGET = [0, 1.7, 3.0, 6.0];
const AB_DELAY = [0, 4, 2, 0];
const TIRE_NOM = [200, 199, 201, 200, 182, 181];
const KT_TO_MS = 0.514444;

export class GearModel {
  /** Gear position 0 up .. 1 down-locked (nose, left, right move together). */
  gear = 1;
  doors = 0;
  // autobrake
  abMode = 0;
  abActive = false;
  private abDelay = 0;
  private abWasActive = false;
  private decel = 0;
  private lastGs = 0;
  private abEdges = [new Edge(), new Edge(), new Edge()];
  // steering
  nws = 0;
  // tyres (°C)
  private tireT: number[] = [];

  update(c: Ctx): void {
    this.updateGear(c);
    this.updateAutobrake(c);
    this.updateSteering(c);
    this.updateTires(c);
    this.updateRadioAlt(c);
  }

  private updateGear(c: Ctx): void {
    const { sim, dt, p } = c;
    const lever = Math.round(sim.get('C:GEAR_LEVER')); // 0 UP, 1 DOWN
    const gPress = sim.get('S:HYD_G_PRESS') > HYD_OK;
    const lgciu1 = p.dcEss;
    const lgciu2 = p.dc2;
    if (c.onGround) {
      // Shock absorbers compressed: gear down-locked, retraction inhibited.
      this.gear = 1;
      this.doors = approach(this.doors, 0, 1 / DOOR_TIME, dt);
    } else {
      const target = lever === 1 ? 1 : 0;
      const needMove = Math.abs(this.gear - target) > 1e-6;
      if (gPress) {
        if (needMove) {
          this.doors = approach(this.doors, 1, 1 / DOOR_TIME, dt);
          if (this.doors >= 1) this.gear = approach(this.gear, target, 1 / (target === 1 ? EXTEND_TIME : RETRACT_TIME), dt);
        } else {
          this.doors = approach(this.doors, 0, 1 / DOOR_TIME, dt);
        }
      }
    }
    const downLocked = this.gear >= 1 - 1e-6;
    const upLocked = this.gear <= 1e-6;
    const lockedInLever = lever === 1 ? downLocked : upLocked;
    const lp = p.ann && lgciu1;
    const unlk = lp && !lockedInLever;
    const down = lp && downLocked;
    sim.set('L:GEAR_L_DOWN', b2n(down));
    sim.set('L:GEAR_NOSE_DOWN', b2n(down));
    sim.set('L:GEAR_R_DOWN', b2n(down));
    sim.set('L:GEAR_L_UNLK', b2n(unlk));
    sim.set('L:GEAR_NOSE_UNLK', b2n(unlk));
    sim.set('L:GEAR_R_UNLK', b2n(unlk));
    // Red arrow: landing configuration without the gear down-locked.
    const ra = this.raValue(c);
    const conf = sim.get('S:FCTL_FLAPS_CONF');
    const idle = sim.get('C:THR_LEVER1') < 2.5 && sim.get('C:THR_LEVER2') < 2.5;
    const redArrow = !c.onGround && !downLocked && ra < 750 && (conf >= 3 || idle) && (lgciu1 || lgciu2);
    sim.set('L:GEAR_LEVER_RED', b2n(p.ann && redArrow));
    const g = Math.round(this.gear * 1000) / 1000;
    sim.set('S:GEAR_L_POS', g);
    sim.set('S:GEAR_N_POS', g);
    sim.set('S:GEAR_R_POS', g);
    sim.set('S:GEAR_DOORS_CLOSED', this.doors <= 1e-6);
    sim.set('S:GEAR_DOORS_POS', Math.round(this.doors * 1000) / 1000);
    sim.set('S:GEAR_DOWNLOCKED', downLocked);
    sim.set('S:GEAR_UPLOCKED', upLocked);
    sim.set('S:LGCIU1_POWERED', lgciu1);
    sim.set('S:LGCIU2_POWERED', lgciu2);
    sim.set('S:LGCIU_ON_GROUND', (lgciu1 || lgciu2) && c.onGround);
  }

  private updateAutobrake(c: Ctx): void {
    const { sim, dt, p } = c;
    // Measured longitudinal deceleration (m/s²), filtered.
    const gs = Math.abs(c.gs);
    const raw = dt > 0 ? ((this.lastGs - gs) * KT_TO_MS) / dt : 0;
    this.lastGs = gs;
    this.decel += (raw - this.decel) * clamp(dt / 0.5, 0, 1);

    const green = sim.get('S:HYD_G_PRESS') > HYD_OK;
    const askid = Math.round(sim.get('C:ASKID_NWSTRG')) === 0;
    const bscu = p.dc1 || p.dc2;
    let irs = 0;
    if (sim.getB('S:ADIRS_IR1_NAV_VALID') || sim.getB('S:ADIRS_IR1_ATT_VALID')) irs++;
    if (sim.getB('S:ADIRS_IR2_NAV_VALID') || sim.getB('S:ADIRS_IR2_ATT_VALID')) irs++;
    if (sim.getB('S:ADIRS_IR3_NAV_VALID') || sim.getB('S:ADIRS_IR3_ATT_VALID')) irs++;
    const armable = green && askid && bscu && irs >= 2;

    const pbs = [sim.get('C:AUTOBRK_LO'), sim.get('C:AUTOBRK_MED'), sim.get('C:AUTOBRK_MAX')];
    for (let i = 0; i < 3; i++) {
      if (!this.abEdges[i].rise(pbs[i] > 0.5)) continue;
      const mode = i + 1;
      if (this.abMode === mode) { this.abMode = 0; this.abActive = false; continue; }
      if (!armable) continue;
      if (mode === 3 && !c.onGround) continue;
      this.abMode = mode;
      this.abActive = false;
      this.abDelay = 0;
    }
    if (!armable) { this.abMode = 0; this.abActive = false; }

    const gndSplr = sim.getB('S:FCTL_GND_SPLR_EXT');
    if (this.abMode > 0) {
      if (gndSplr && c.onGround) {
        this.abDelay += dt;
        if (this.abDelay >= AB_DELAY[this.abMode]) this.abActive = true;
      } else {
        if (this.abWasActive) this.abMode = 0; // ground spoilers retracted after activation
        this.abActive = false;
        this.abDelay = 0;
      }
      const pedals = Math.max(sim.get('C:BRAKE_L'), sim.get('C:BRAKE_R'));
      if (this.abActive && pedals > 0.5) { this.abMode = 0; this.abActive = false; }
    } else {
      this.abActive = false;
      this.abDelay = 0;
    }
    this.abWasActive = this.abActive;

    const target = this.abMode > 0 ? AB_TARGET[this.abMode] : 0;
    const decelOk = this.abActive && gs > 1 && this.decel >= 0.8 * target;
    const lp = p.ann;
    sim.set('L:AUTOBRK_LO_ON', b2n(lp && this.abMode === 1));
    sim.set('L:AUTOBRK_MED_ON', b2n(lp && this.abMode === 2));
    sim.set('L:AUTOBRK_MAX_ON', b2n(lp && this.abMode === 3));
    sim.set('L:AUTOBRK_LO_DECEL', b2n(lp && this.abMode === 1 && decelOk));
    sim.set('L:AUTOBRK_MED_DECEL', b2n(lp && this.abMode === 2 && decelOk));
    sim.set('L:AUTOBRK_MAX_DECEL', b2n(lp && this.abMode === 3 && decelOk));
    sim.set('S:AUTOBRK_MODE', this.abMode);
    sim.set('S:AUTOBRK_ARMABLE', armable);
    sim.set('S:AUTOBRK_ACTIVE', this.abActive);
    sim.set('S:AUTOBRK_DECEL', decelOk);
    sim.set('S:AUTOBRK_TARGET_DECEL', this.abActive ? target : 0);
    sim.set('S:AUTOBRK_MEASURED_DECEL', Math.round(this.decel * 100) / 100);
  }

  private updateSteering(c: Ctx): void {
    const { sim, dt } = c;
    const avail = sim.getB('S:NWS_AVAIL');
    const gs = Math.abs(c.gs);
    const tiller = clamp(sim.get('C:TILLER_CAPT') + sim.get('C:TILLER_FO'), -1, 1);
    const ta = Math.abs(tiller);
    const tillerDeg = 75 * Math.sign(tiller) * (0.25 * ta + 0.75 * ta * ta * ta) * interp(gs, [0, 20, 70], [1, 1, 0]);
    const pedalDeg = 6 * clamp(sim.get('C:RUDDER'), -1, 1) * interp(gs, [0, 40, 130], [1, 1, 0]);
    const cmd = clamp(tillerDeg + pedalDeg, -75, 75);
    if (avail && c.onGround) this.nws = approach(this.nws, cmd, 20, dt);
    else if (c.onGround && gs > 0.5 && !sim.getB('G:GND_TOWBAR')) this.nws = approach(this.nws, 0, 2 * Math.min(gs, 10) / 10, dt);
    else if (!c.onGround) this.nws = approach(this.nws, 0, 10, dt); // centring cam in flight
    sim.set('S:NWS_ANGLE', Math.round(this.nws * 10) / 10);
  }

  private updateTires(c: Ctx): void {
    const { sim, dt } = c;
    const oat = sim.get('G:ENV_OAT');
    if (this.tireT.length === 0) this.tireT = [oat, oat, oat, oat, oat, oat];
    for (let i = 0; i < 6; i++) {
      const brk = i < 4 ? sim.get(`S:BRK_TEMP_${i + 1}`) : oat;
      const target = oat + 0.15 * Math.max(0, (brk || oat) - oat);
      this.tireT[i] += (target - this.tireT[i]) * clamp(dt / 600, 0, 1);
      const press = TIRE_NOM[i] * (this.tireT[i] + 273.15) / (15 + 273.15);
      sim.set(`S:TIRE_PRESS_${i + 1}`, Math.round(press));
    }
  }

  private raValue(c: Ctx): number {
    const { sim } = c;
    if (c.onGround) return 0;
    if (sim.has('G:AC_RADALT_FT')) return Math.max(0, sim.get('G:AC_RADALT_FT'));
    if (sim.has('G:AC_ALT_AGL_FT')) return Math.max(0, sim.get('G:AC_ALT_AGL_FT'));
    return 5000;
  }

  private updateRadioAlt(c: Ctx): void {
    const { sim, p } = c;
    const ra1 = p.acEssShed;
    const ra2 = p.ac2;
    const powered = ra1 || ra2;
    const h = this.raValue(c);
    sim.set('S:RA1_POWERED', ra1);
    sim.set('S:RA2_POWERED', ra2);
    sim.set('S:RA_ALT', powered ? Math.round(h * 10) / 10 : 0);
    sim.set('S:RA_VALID', powered && h <= 2500);
  }
}
