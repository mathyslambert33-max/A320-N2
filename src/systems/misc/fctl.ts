/**
 * Flight controls (FCOM DSC-27): ELAC 1/2, SEC 1/2/3, FAC 1/2, SFCC 1/2, surfaces, sidestick priority.
 *
 * Sign conventions (shared with the ECAM F/CTL page): ailerons & elevators + = trailing edge DOWN,
 * rudder + = trailing edge RIGHT (nose right), rudder trim + = right, THS + = nose UP, spoilers + = up.
 *
 *  - Computers: ELAC 1 DC ESS, ELAC 2 DC 2, SEC 1 DC ESS, SEC 2/3 DC 2, FAC 1 AC ESS + DC ESS SHED,
 *    FAC 2 AC 2 + DC 2. Power-up test 8 s after power application or pb OFF→ON (FAULT light on during
 *    the test when the pb is ON). pb OFF: computer disengaged, OFF light.
 *  - Hydraulics: ailerons G+B, L elevator B+G, R elevator Y+B, rudder G+B+Y, THS G+Y (hydraulic motors),
 *    spoilers 1 G, 2 Y, 3 B, 4 Y, 5 G (SEC 3: 1-2, SEC 1: 3-4, SEC 2: 5), slats G+B, flaps G+Y.
 *  - Without hydraulic pressure the ailerons droop to their down stop (+25°) and the elevators to +17°
 *    (as seen on the F/CTL page at the gate); with pressure and no computer the elevators are centred,
 *    the ailerons are in damping mode.
 *  - Ground (direct) law: sidestick full aft → elevators 30° up (−30), full fwd → 17° down (+17); roll →
 *    ailerons ±25° (+5° droop when flaps extended) and roll spoilers 2-5 on the down-going wing up to 35°.
 *    Rudder ±25° from the pedals (+ trim), limited by the FAC travel limiter (25° up to 160 kt → 3.4° at
 *    380 kt). Speed brakes: spoilers 2-4 up to 40° with the lever. Ground spoilers (all, 50°) when armed on
 *    ground above 72 kt with thrust idle, or with reverse selected.
 *  - THS: mechanical trim wheel (C:PITCH_TRIM, −4..+13.5°) through the G and Y hydraulic motors,
 *    1°/s (half speed with one system). Rudder trim: RUD TRIM switch 1°/s, RESET 1.5°/s, ±20°, needs a FAC.
 *  - Slats/flaps: lever 0 = 0/0, 1 = 18/0 (CONF 1) or 18/10 (CONF 1+F, selected from 0 at ≤ 100 kt — always on
 *    ground — or from 2 at ≤ 210 kt; flaps auto-retract at 210 kt), 2 = 22/15, 3 = 22/20, FULL = 27/35
 *    (A320ceo). Two hydraulic motors per PCU, each controlled by one SFCC (SFCC 1 DC ESS → G motors,
 *    SFCC 2 DC 2 → slat B / flap Y motors): half speed with one. Full travel: slats 20 s, flaps 28 s,
 *    flap angle vs carriage travel non-linear (Fowler motion first).
 *  - Sidestick priority: takeover pb → priority (latched after 40 s), red arrow in front of the deactivated
 *    pilot, green CAPT/F-O light in front of the pilot with priority when the other stick is deflected;
 *    dual input (both sticks > 2°, no priority) → both green lights flash + `fcs:dual_input` event.
 */
import { approach } from '../../core/sim';
import { type Ctx, b2n, clamp, interp, flash1Hz, HYD_OK, Edge } from './common';

type CompId = 'ELAC1' | 'ELAC2' | 'SEC1' | 'SEC2' | 'SEC3' | 'FAC1' | 'FAC2';

interface Computer {
  id: CompId;
  testT: number;
  wasPowered: boolean;
  wasPb: boolean;
  on: boolean;
  fault: boolean;
  injected: boolean;
}

const mkComp = (id: CompId): Computer => ({ id, testT: 0, wasPowered: false, wasPb: false, on: false, fault: false, injected: false });

/** Slat/flap configurations: [slats, flaps] in degrees. */
const CONF: Record<string, [number, number]> = { '0': [0, 0], '1': [18, 0], '1.5': [18, 10], '2': [22, 15], '3': [22, 20], '4': [27, 35] };
/** Flap carriage travel (0..1) → flap angle (deg): pure aft translation first, then rotation. */
const FLAP_S = [0, 0.15, 0.3, 0.52, 0.63, 0.73, 1.0];
const FLAP_A = [0, 0, 5, 10, 15, 20, 35];
const flapAngle = (s: number) => interp(s, FLAP_S, FLAP_A);
const flapTravel = (a: number) => (a <= 0 ? 0 : interp(a, FLAP_A.slice(1), FLAP_S.slice(1)));
const SLAT_RATE = 27 / 20; // deg/s with both motors
const FLAP_TRAVEL_RATE = 1 / 28; // travel/s with both motors

export class FctlModel {
  readonly comps: Record<CompId, Computer> = {
    ELAC1: mkComp('ELAC1'), ELAC2: mkComp('ELAC2'), SEC1: mkComp('SEC1'), SEC2: mkComp('SEC2'),
    SEC3: mkComp('SEC3'), FAC1: mkComp('FAC1'), FAC2: mkComp('FAC2'),
  };
  // surfaces (deg)
  ailL = 25; ailR = 25; elevL = 17; elevR = 17; rudder = 0;
  splrL = [0, 0, 0, 0, 0]; splrR = [0, 0, 0, 0, 0];
  ths = 0; rudTrim = 0; rudTrimReset = false;
  slats = 0; flapS = 0; conf = '0'; lastConf = '0'; lever = 0;
  gndSplrExt = false;
  tlu = 25;
  // priority
  prio: 'NONE' | 'CAPT' | 'FO' = 'NONE';
  prioLatched = false;
  prioHoldT = 0;
  private capTk = new Edge();
  private foTk = new Edge();
  private dualT = 0;
  private resetEdge = new Edge();
  private initDone = false;

  setFault(id: string, on: boolean): boolean {
    const c = (this.comps as Record<string, Computer>)[id];
    if (!c) return false;
    c.injected = on;
    return true;
  }

  init(c: Ctx): void {
    const { sim } = c;
    this.ths = clamp(sim.get('C:PITCH_TRIM'), -4, 13.5);
    this.lever = Math.round(sim.get('C:FLAPS_LEVER'));
    const k = this.lever === 1 ? '1.5' : String(this.lever);
    this.conf = k;
    this.lastConf = k;
    const [s, f] = CONF[k] ?? [0, 0];
    this.slats = s;
    this.flapS = flapTravel(f);
    // Surfaces already pressurised at start (scenario): neutral, otherwise drooped.
    const g = sim.get('S:HYD_G_PRESS') > HYD_OK;
    const bl = sim.get('S:HYD_B_PRESS') > HYD_OK;
    const y = sim.get('S:HYD_Y_PRESS') > HYD_OK;
    if (g || bl) { this.ailL = 0; this.ailR = 0; this.elevL = 0; }
    if (y || bl) this.elevR = 0;
    this.initDone = true;
  }

  private computers(c: Ctx): void {
    const { sim, dt, p } = c;
    const pw: Record<CompId, boolean> = {
      ELAC1: p.dcEss, ELAC2: p.dc2, SEC1: p.dcEss, SEC2: p.dc2, SEC3: p.dc2,
      FAC1: p.acEss && p.dcEssShed, FAC2: p.ac2 && p.dc2,
    };
    const pb: Record<CompId, boolean> = {
      ELAC1: sim.get('C:FLTCTL_ELAC1') > 0.5, ELAC2: sim.get('C:FLTCTL_ELAC2') > 0.5,
      SEC1: sim.get('C:FLTCTL_SEC1') > 0.5, SEC2: sim.get('C:FLTCTL_SEC2') > 0.5, SEC3: sim.get('C:FLTCTL_SEC3') > 0.5,
      FAC1: sim.get('C:FLTCTL_FAC1') > 0.5, FAC2: sim.get('C:FLTCTL_FAC2') > 0.5,
    };
    for (const id of Object.keys(this.comps) as CompId[]) {
      const k = this.comps[id];
      const powered = pw[id];
      const on = pb[id];
      if (powered && on && (!k.wasPowered || !k.wasPb)) k.testT = 8;
      if (!powered || !on) k.testT = 0;
      k.testT = Math.max(0, k.testT - dt);
      k.wasPowered = powered;
      k.wasPb = on;
      k.on = powered && on && k.testT <= 0 && !k.injected;
      k.fault = powered && on && (k.testT > 0 || k.injected);
    }
    const ann = p.ann;
    const C = this.comps;
    const off = (v: boolean) => b2n(ann && !v);
    sim.set('L:FLTCTL_ELAC1_FAULT', b2n(ann && C.ELAC1.fault)); sim.set('L:FLTCTL_ELAC1_OFF', off(pb.ELAC1));
    sim.set('L:FLTCTL_ELAC2_FAULT', b2n(ann && C.ELAC2.fault)); sim.set('L:FLTCTL_ELAC2_OFF', off(pb.ELAC2));
    sim.set('L:FLTCTL_SEC1_FAULT', b2n(ann && C.SEC1.fault)); sim.set('L:FLTCTL_SEC1_OFF', off(pb.SEC1));
    sim.set('L:FLTCTL_SEC2_FAULT', b2n(ann && C.SEC2.fault)); sim.set('L:FLTCTL_SEC2_OFF', off(pb.SEC2));
    sim.set('L:FLTCTL_SEC3_FAULT', b2n(ann && C.SEC3.fault)); sim.set('L:FLTCTL_SEC3_OFF', off(pb.SEC3));
    sim.set('L:FLTCTL_FAC1_FAULT', b2n(ann && C.FAC1.fault)); sim.set('L:FLTCTL_FAC1_OFF', off(pb.FAC1));
    sim.set('L:FLTCTL_FAC2_FAULT', b2n(ann && C.FAC2.fault)); sim.set('L:FLTCTL_FAC2_OFF', off(pb.FAC2));
    for (const n of [1, 2]) {
      sim.set(`S:FCTL_ELAC${n}_ON`, (n === 1 ? C.ELAC1 : C.ELAC2).on);
      sim.set(`S:FCTL_ELAC${n}_FAULT`, (n === 1 ? C.ELAC1 : C.ELAC2).fault);
      sim.set(`S:FCTL_FAC${n}_ON`, (n === 1 ? C.FAC1 : C.FAC2).on);
      sim.set(`S:FCTL_FAC${n}_FAULT`, (n === 1 ? C.FAC1 : C.FAC2).fault);
    }
    for (const n of [1, 2, 3]) {
      const k = n === 1 ? C.SEC1 : n === 2 ? C.SEC2 : C.SEC3;
      sim.set(`S:FCTL_SEC${n}_ON`, k.on);
      sim.set(`S:FCTL_SEC${n}_FAULT`, k.fault);
    }
  }

  /** Sidestick priority logic; returns the combined order [roll, pitch] (−1..1, pitch + = pull). */
  private sticks(c: Ctx): [number, number] {
    const { sim, dt, t, p } = c;
    const cx = sim.get('C:SIDESTICK_CAPT_X');
    const cy = sim.get('C:SIDESTICK_CAPT_Y');
    const fx = sim.get('C:SIDESTICK_FO_X');
    const fy = sim.get('C:SIDESTICK_FO_Y');
    const capHeld = sim.get('C:SIDESTICK_CAPT_TAKEOVER') > 0.5;
    const foHeld = sim.get('C:SIDESTICK_FO_TAKEOVER') > 0.5;
    const capRise = this.capTk.rise(capHeld);
    const foRise = this.foTk.rise(foHeld);
    if (capRise) { this.prio = 'CAPT'; this.prioLatched = false; this.prioHoldT = 0; sim.emit('fcs:priority', { side: 'LEFT' }); }
    if (foRise) { this.prio = 'FO'; this.prioLatched = false; this.prioHoldT = 0; sim.emit('fcs:priority', { side: 'RIGHT' }); }
    const held = this.prio === 'CAPT' ? capHeld : this.prio === 'FO' ? foHeld : false;
    if (this.prio !== 'NONE' && !this.prioLatched) {
      if (held) {
        this.prioHoldT += dt;
        if (this.prioHoldT > 40) this.prioLatched = true;
      } else this.prio = 'NONE';
    }
    const TH = 0.125; // ~2° of the 16° stick travel
    const capDefl = Math.max(Math.abs(cx), Math.abs(cy)) > TH;
    const foDefl = Math.max(Math.abs(fx), Math.abs(fy)) > TH;
    const dual = this.prio === 'NONE' && capDefl && foDefl;
    if (dual) {
      if (this.dualT <= 0) sim.emit('fcs:dual_input', {});
      this.dualT += dt;
      if (this.dualT > 3) this.dualT = 0;
    } else this.dualT = 0;
    const lp = p.ann && (this.comps.ELAC1.on || this.comps.ELAC2.on || this.comps.SEC1.on || this.comps.SEC2.on);
    const fl = flash1Hz(t);
    sim.set('L:PRIO_CAPT', b2n(lp && ((this.prio === 'CAPT' && foDefl) || (dual && fl))));
    sim.set('L:PRIO_FO', b2n(lp && ((this.prio === 'FO' && capDefl) || (dual && fl))));
    sim.set('L:PRIO_CAPT_ARROW', b2n(lp && this.prio === 'FO'));
    sim.set('L:PRIO_FO_ARROW', b2n(lp && this.prio === 'CAPT'));
    sim.set('S:FCTL_PRIORITY', this.prio === 'CAPT' ? 1 : this.prio === 'FO' ? 2 : 0);
    sim.set('S:FCTL_DUAL_INPUT', dual);
    // AUTO LAND warning lights: autoland below 200 ft RA only (not modelled on ground) → off.
    sim.set('L:AUTOLAND_CAPT', 0);
    sim.set('L:AUTOLAND_FO', 0);
    if (this.prio === 'CAPT') return [cx, cy];
    if (this.prio === 'FO') return [fx, fy];
    return [clamp(cx + fx, -1, 1), clamp(cy + fy, -1, 1)];
  }

  update(c: Ctx): void {
    const { sim, dt, p } = c;
    if (!this.initDone) this.init(c);
    this.computers(c);
    const C = this.comps;
    const [roll, pitch] = this.sticks(c);
    sim.set('S:FCTL_STICK_ROLL', Math.round(roll * 1000) / 1000);
    sim.set('S:FCTL_STICK_PITCH', Math.round(pitch * 1000) / 1000);

    const pG = sim.get('S:HYD_G_PRESS');
    const pB = sim.get('S:HYD_B_PRESS');
    const pY = sim.get('S:HYD_Y_PRESS');
    const G = pG > HYD_OK;
    const B = pB > HYD_OK;
    const Y = pY > HYD_OK;
    const pf = (...ps: number[]) => clamp(Math.max(...ps) / 3000, 0, 1);
    const elac = C.ELAC1.on || C.ELAC2.on;
    const elevCtl = elac || C.SEC1.on || C.SEC2.on;
    const flapsExt = flapAngle(this.flapS) > 0.5;

    // ---------------- ailerons
    const droop = flapsExt ? 5 : 0;
    const ailCmdL = clamp(25 * roll + droop, -25, 25);
    const ailCmdR = clamp(-25 * roll + droop, -25, 25);
    const ailHyd = G || B;
    const moveAil = (cur: number, cmd: number) => {
      if (ailHyd && elac) return approach(cur, cmd, 50 * pf(pG, pB), dt);
      if (ailHyd) return cur + (25 - cur) * (1 - Math.exp(-dt / 90)); // damping mode: very slow droop
      return cur + (25 - cur) * (1 - Math.exp(-dt / 18)); // gravity droop to the down stop
    };
    this.ailL = moveAil(this.ailL, ailCmdL);
    this.ailR = moveAil(this.ailR, ailCmdR);

    // ---------------- elevators (direct/ground law)
    const elevCmd = pitch >= 0 ? -30 * pitch : -17 * pitch;
    const moveElev = (cur: number, hydOk: boolean, press: number) => {
      if (hydOk && elevCtl) return approach(cur, elevCmd, 35 * clamp(press / 3000, 0, 1), dt);
      if (hydOk) return approach(cur, 0, 8, dt); // centring mode
      return cur + (17 - cur) * (1 - Math.exp(-dt / 25));
    };
    this.elevL = moveElev(this.elevL, B || G, Math.max(pB, pG));
    this.elevR = moveElev(this.elevR, Y || B, Math.max(pY, pB));

    // ---------------- rudder trim / travel limiter / rudder
    const fac = C.FAC1.on || C.FAC2.on;
    const ias = sim.get('S:ADIRS_IAS');
    if (fac) this.tlu = this.slats > 1 ? 25 : interp(ias, [160, 380], [25, 3.4]);
    const rt = Math.round(sim.get('C:RUD_TRIM')); // 0 L, 1 neutral, 2 R
    if (this.resetEdge.rise(sim.get('C:RUD_TRIM_RESET') > 0.5)) this.rudTrimReset = true;
    if (fac) {
      if (rt !== 1) {
        this.rudTrimReset = false;
        this.rudTrim = clamp(this.rudTrim + (rt === 2 ? 1 : -1) * dt, -20, 20);
      } else if (this.rudTrimReset) {
        this.rudTrim = approach(this.rudTrim, 0, 1.5, dt);
        if (this.rudTrim === 0) this.rudTrimReset = false;
      }
    }
    const rudCmd = clamp(this.rudTrim + 25 * sim.get('C:RUDDER'), -this.tlu, this.tlu);
    if (G || B || Y) this.rudder = approach(this.rudder, rudCmd, 40 * pf(pG, pB, pY), dt);

    // ---------------- THS (mechanical trim wheel → hydraulic motors G + Y)
    const thsCmd = clamp(sim.get('C:PITCH_TRIM'), -4, 13.5);
    const thsRate = (G ? 0.5 : 0) + (Y ? 0.5 : 0);
    if (thsRate > 0) this.ths = approach(this.ths, thsCmd, thsRate, dt);

    // ---------------- slats / flaps (SFCC)
    const lever = Math.round(clamp(sim.get('C:FLAPS_LEVER'), 0, 4));
    if (lever !== this.lever) {
      if (lever === 1) {
        if (this.lever === 0) this.conf = ias <= 100 ? '1.5' : '1';
        else this.conf = ias <= 210 ? '1.5' : '1';
      } else this.conf = String(lever);
      this.lever = lever;
    }
    if (this.conf === '1.5' && ias > 210) this.conf = '1';
    const [slatT, flapT] = CONF[this.conf];
    const sfcc1 = p.dcEss;
    const sfcc2 = p.dc2;
    const slatSpeed = (sfcc1 && G ? 0.5 : 0) + (sfcc2 && B ? 0.5 : 0);
    const flapSpeed = (sfcc1 && G ? 0.5 : 0) + (sfcc2 && Y ? 0.5 : 0);
    const prevSlat = this.slats;
    const prevFlap = this.flapS;
    this.slats = approach(this.slats, slatT, SLAT_RATE * slatSpeed, dt);
    this.flapS = approach(this.flapS, flapTravel(flapT), FLAP_TRAVEL_RATE * flapSpeed, dt);
    const slatsMoving = Math.abs(this.slats - prevSlat) > 1e-6;
    const flapsMoving = Math.abs(this.flapS - prevFlap) > 1e-7;
    const flaps = flapAngle(this.flapS);
    for (const [k, [s, f]] of Object.entries(CONF)) {
      if (Math.abs(this.slats - s) < 0.3 && Math.abs(flaps - f) < 0.3) { this.lastConf = k; break; }
    }
    sim.set('S:FCTL_SLATS', Math.round(this.slats * 100) / 100);
    sim.set('S:FCTL_FLAPS', Math.round(flaps * 100) / 100);
    sim.set('S:FCTL_SLATS_TARGET', slatT);
    sim.set('S:FCTL_FLAPS_TARGET', flapT);
    sim.set('S:FCTL_FLAPS_CONF', Number(this.lastConf));
    sim.set('S:FCTL_FLAPS_CONF_TARGET', Number(this.conf));
    sim.set('S:FCTL_SLATS_MOVING', slatsMoving);
    sim.set('S:FCTL_FLAPS_MOVING', flapsMoving);
    sim.set('S:FCTL_SFCC1_ON', sfcc1);
    sim.set('S:FCTL_SFCC2_ON', sfcc2);

    // ---------------- spoilers
    const armed = sim.get('C:SPDBRK_ARM') > 0.5 && (C.SEC1.on || C.SEC2.on || C.SEC3.on);
    const tla1 = sim.get('C:THR_LEVER1');
    const tla2 = sim.get('C:THR_LEVER2');
    const idle1 = tla1 < 2.5;
    const idle2 = tla2 < 2.5;
    const rev = (tla1 < -2 && idle2) || (tla2 < -2 && idle1);
    const gndCond = c.onGround && ((armed && c.gs > 72 && idle1 && idle2) || (rev && c.gs > 72));
    if (gndCond) this.gndSplrExt = true;
    else if (!c.onGround || (!rev && (!armed || !idle1 || !idle2))) this.gndSplrExt = false;
    const sbLever = clamp(sim.get('C:SPDBRK_LEVER'), 0, 1);
    const sb = 40 * sbLever;
    const rollSpl = 35 * clamp((Math.abs(roll) - 0.05) / 0.95, 0, 1);
    const rollR = roll > 0 ? rollSpl : 0; // right wing spoilers up for a right roll
    const rollL = roll < 0 ? rollSpl : 0;
    const secOf = [C.SEC3.on, C.SEC3.on, C.SEC1.on, C.SEC1.on, C.SEC2.on];
    const hydOf = [G, Y, B, Y, G];
    const pOf = [pG, pY, pB, pY, pG];
    for (let i = 0; i < 5; i++) {
      const avail = secOf[i] && hydOf[i];
      const isSb = i >= 1 && i <= 3;
      const cmdFor = (own: number, other: number) => {
        if (this.gndSplrExt) return 50;
        if (i === 0) return 0;
        const base = isSb ? sb : 0;
        return clamp(base + own - other, 0, isSb ? 40 : 35);
      };
      const cL = cmdFor(rollL, rollR);
      const cR = cmdFor(rollR, rollL);
      if (avail) {
        const r = 45 * clamp(pOf[i] / 3000, 0, 1);
        this.splrL[i] = approach(this.splrL[i], cL, r, dt);
        this.splrR[i] = approach(this.splrR[i], cR, r, dt);
      } else {
        this.splrL[i] = approach(this.splrL[i], 0, 6, dt);
        this.splrR[i] = approach(this.splrR[i], 0, 6, dt);
      }
      sim.set(`S:FCTL_SPLR_L${i + 1}`, Math.round(this.splrL[i] * 10) / 10);
      sim.set(`S:FCTL_SPLR_R${i + 1}`, Math.round(this.splrR[i] * 10) / 10);
    }
    sim.set('S:FCTL_GND_SPLR_ARMED', armed);
    sim.set('S:FCTL_GND_SPLR_EXT', this.gndSplrExt);
    sim.set('S:FCTL_SPD_BRK', Math.round(sb * 10) / 10);

    sim.set('S:FCTL_AIL_L', Math.round(this.ailL * 100) / 100);
    sim.set('S:FCTL_AIL_R', Math.round(this.ailR * 100) / 100);
    sim.set('S:FCTL_ELEV_L', Math.round(this.elevL * 100) / 100);
    sim.set('S:FCTL_ELEV_R', Math.round(this.elevR * 100) / 100);
    sim.set('S:FCTL_RUDDER', Math.round(this.rudder * 100) / 100);
    sim.set('S:FCTL_RUD_TRIM', Math.round(this.rudTrim * 100) / 100);
    sim.set('S:FCTL_RUD_TLU', Math.round(this.tlu * 10) / 10);
    sim.set('S:FCTL_THS', Math.round(this.ths * 100) / 100);
  }
}
