/**
 * Fire protection (FCOM DSC-26): engine & APU fire detection (loops A/B + FDU), extinguishing (squibs,
 * Halon bottles), fire panel lights, pedestal ENG FIRE lights, cargo smoke detection & extinguishing,
 * APU AUTO EXTING TEST (maintenance panel).
 *
 *  - ENG n TEST pb held (FDU powered): ENG n FIRE pb red, both AGENT pbs SQUIB (white) + DISCH (amber),
 *    pedestal ENG n FIRE red; S:FIRE_ENGn_TEST = S:FIRE_ENGn_DET = 1 → the ECAM ENG n FIRE warning (CRC,
 *    MASTER WARN). Same for APU TEST (APU FIRE pb, APU AGENT SQUIB/DISCH, S:FIRE_APU_TEST/_DET; the APU
 *    is not shut down by the test).
 *  - FIRE pb released (C:FIRE_xxx_PB = 1): squibs armed → SQUIB lights while the squib is intact.
 *    AGENT pb (squib armed & squib supply) fires the squib: bottle pressure (600 psi at 21 °C) drops in
 *    ~1.5 s, DISCH light when the pressure switch trips (< 100 psi). The SQUIB light goes out once fired.
 *  - Fire warnings (red FIRE pb, pedestal FIRE) stay on while the fire is detected, whatever the pb position.
 *  - APU fire on ground: automatic shutdown (sys-elec reads S:FIRE_APU_DET) and automatic agent discharge
 *    3 s after detection.
 *  - Detection: fire and at least one healthy loop (loops A/B, faults injectable).
 *  - CARGO SMOKE TEST pb: DISCH lights while held (squib/lamp test), then two detection cycles
 *    (SMOKE lights + ECAM CARGO SMOKE, 3 s each, 2 s apart). Isolation valves close during smoke/test.
 *    One cargo bottle: FWD or AFT DISCH (guarded) discharges it into that compartment (DISCH light).
 *  - Supplies: fire detection units DC BAT / DC ESS / DC 2; squibs on the hot battery buses
 *    (ENG AGENT 1 + APU: HOT BUS 1, ENG AGENT 2: HOT BUS 2) so they work with BAT pbs OFF.
 *
 * Debug: event `misc:fire {zone:'ENG1'|'ENG2'|'APU', on?, shots?}` (shots = bottles needed),
 * `misc:smoke {zone:'FWD'|'AFT', on?}`, `misc:fault {id:'ENG1_LOOP_A'…, on}`.
 */
import { type Ctx, b2n } from './common';

class Bottle {
  press = 600;
  squibFired = false;
  get discharged(): boolean { return this.press < 100; }
  update(dt: number, oat: number): void {
    const nominal = 600 + 6 * (oat - 21);
    if (this.squibFired) this.press = Math.max(0, this.press * Math.exp(-dt / 0.45) - dt * 2);
    else this.press = nominal;
  }
}

interface FireZone {
  fire: boolean;
  shots: number;
  outAt: number;
  loopAFault: boolean;
  loopBFault: boolean;
}

const newZone = (): FireZone => ({ fire: false, shots: 1, outAt: -1, loopAFault: false, loopBFault: false });

export class FireModel {
  readonly eng = [
    { zone: newZone(), bottles: [new Bottle(), new Bottle()], test: false, det: false },
    { zone: newZone(), bottles: [new Bottle(), new Bottle()], test: false, det: false },
  ];
  readonly apu = { zone: newZone(), bottle: new Bottle(), test: false, det: false, detT: 0, autoExtTestT: 0 };
  readonly cargo = {
    smokeFwd: false, smokeAft: false, bottle: new Bottle(), dischTo: '' as '' | 'FWD' | 'AFT',
    testT: -1, testHeld: false,
  };
  private lastAgent: Record<string, boolean> = {};

  injectFire(zone: string, on = true, shots = 1): void {
    const z = zone === 'ENG1' ? this.eng[0].zone : zone === 'ENG2' ? this.eng[1].zone : zone === 'APU' ? this.apu.zone : null;
    if (!z) return;
    z.fire = on;
    z.shots = Math.max(1, shots);
    z.outAt = -1;
  }

  injectSmoke(zone: string, on = true): void {
    if (zone === 'FWD') this.cargo.smokeFwd = on;
    if (zone === 'AFT') this.cargo.smokeAft = on;
  }

  setLoopFault(id: string, on: boolean): boolean {
    const m = /^(ENG1|ENG2|APU)_LOOP_([AB])$/.exec(id);
    if (!m) return false;
    const z = m[1] === 'ENG1' ? this.eng[0].zone : m[1] === 'ENG2' ? this.eng[1].zone : this.apu.zone;
    if (m[2] === 'A') z.loopAFault = on; else z.loopBFault = on;
    return true;
  }

  /** Squib fired into a zone: count down the bottles needed, fire out a few seconds later. */
  private agentInto(z: FireZone, t: number): void {
    if (!z.fire) return;
    z.shots -= 1;
    if (z.shots <= 0 && z.outAt < 0) z.outAt = t + 4;
  }

  /** Rising edge of a momentary pb (value read by the caller with a literal id). */
  private pressed(id: string, value: number): boolean {
    const v = value > 0.5;
    const was = this.lastAgent[id] ?? false;
    this.lastAgent[id] = v;
    return v && !was;
  }

  update(c: Ctx): void {
    const { sim, dt, t, p } = c;
    const oat = sim.get('G:ENV_OAT');
    const fdu = p.dcBat || p.dcEss || p.dc2;
    const lampPwr = p.ann || p.hot1 || p.hot2;
    const squibPwr = [p.hot1 || p.dcBat, p.hot2 || p.dcBat];

    // ---------------- engines
    for (let i = 0; i < 2; i++) {
      const n = i + 1;
      const e = this.eng[i];
      const z = e.zone;
      if (z.fire && z.outAt >= 0 && t >= z.outAt) { z.fire = false; z.outAt = -1; }
      const detected = z.fire && (!z.loopAFault || !z.loopBFault);
      e.test = fdu && sim.get(n === 1 ? 'C:FIRE_ENG1_TEST' : 'C:FIRE_ENG2_TEST') > 0.5;
      e.det = fdu && (detected || e.test);
      const pbOut = sim.get(n === 1 ? 'C:FIRE_ENG1_PB' : 'C:FIRE_ENG2_PB') > 0.5;
      for (let k = 0; k < 2; k++) {
        const b = e.bottles[k];
        const id = `FIRE_ENG${n}_AGENT${k + 1}`;
        if (this.pressed(id, sim.get(`C:FIRE_ENG${n}_AGENT${k + 1}`)) && pbOut && squibPwr[k] && !b.squibFired) {
          b.squibFired = true;
          this.agentInto(z, t);
        }
        b.update(dt, oat);
      }
      const squibLt = (k: number) => lampPwr && (e.test || (pbOut && squibPwr[k] && !e.bottles[k].squibFired));
      const dischLt = (k: number) => lampPwr && (e.test || e.bottles[k].discharged);
      if (n === 1) {
        sim.set('L:FIRE_ENG1_PB', b2n(e.det));
        sim.set('L:ENG1_FIRE', b2n(e.det));
        sim.set('L:FIRE_ENG1_AGENT1_SQUIB', b2n(squibLt(0)));
        sim.set('L:FIRE_ENG1_AGENT1_DISCH', b2n(dischLt(0)));
        sim.set('L:FIRE_ENG1_AGENT2_SQUIB', b2n(squibLt(1)));
        sim.set('L:FIRE_ENG1_AGENT2_DISCH', b2n(dischLt(1)));
      } else {
        sim.set('L:FIRE_ENG2_PB', b2n(e.det));
        sim.set('L:ENG2_FIRE', b2n(e.det));
        sim.set('L:FIRE_ENG2_AGENT1_SQUIB', b2n(squibLt(0)));
        sim.set('L:FIRE_ENG2_AGENT1_DISCH', b2n(dischLt(0)));
        sim.set('L:FIRE_ENG2_AGENT2_SQUIB', b2n(squibLt(1)));
        sim.set('L:FIRE_ENG2_AGENT2_DISCH', b2n(dischLt(1)));
      }
      sim.set(`S:FIRE_ENG${n}_DET`, e.det);
      sim.set(`S:FIRE_ENG${n}_TEST`, e.test);
      sim.set(`S:FIRE_ENG${n}_FIRE`, z.fire);
      sim.set(`S:FIRE_ENG${n}_AGENT1_DISCH`, e.bottles[0].discharged);
      sim.set(`S:FIRE_ENG${n}_AGENT2_DISCH`, e.bottles[1].discharged);
      sim.set(`S:FIRE_ENG${n}_BOTTLE1_PRESS`, Math.round(e.bottles[0].press));
      sim.set(`S:FIRE_ENG${n}_BOTTLE2_PRESS`, Math.round(e.bottles[1].press));
      sim.set(`S:FIRE_ENG${n}_SQUIB_ARMED`, pbOut);
      sim.set(`S:FIRE_ENG${n}_LOOP_A_FAULT`, z.loopAFault);
      sim.set(`S:FIRE_ENG${n}_LOOP_B_FAULT`, z.loopBFault);
    }

    // ---------------- APU
    const a = this.apu;
    const az = a.zone;
    if (az.fire && az.outAt >= 0 && t >= az.outAt) { az.fire = false; az.outAt = -1; }
    const apuDetected = az.fire && (!az.loopAFault || !az.loopBFault);
    a.test = fdu && sim.get('C:FIRE_APU_TEST') > 0.5;
    a.det = fdu && (apuDetected || a.test);
    const apuPbOut = sim.get('C:FIRE_APU_PB') > 0.5;
    a.detT = apuDetected && fdu ? a.detT + dt : 0;
    const apuSquibPwr = p.hot1 || p.dcBat;
    const manual = this.pressed('FIRE_APU_AGENT', sim.get('C:FIRE_APU_AGENT')) && apuPbOut;
    const auto = c.onGround && a.detT >= 3;
    if ((manual || auto) && apuSquibPwr && !a.bottle.squibFired) {
      a.bottle.squibFired = true;
      this.agentInto(az, t);
    }
    a.bottle.update(dt, oat);
    sim.set('L:FIRE_APU_PB', b2n(a.det));
    sim.set('L:FIRE_APU_AGENT_SQUIB', b2n(lampPwr && (a.test || ((apuPbOut || (apuDetected && c.onGround)) && apuSquibPwr && !a.bottle.squibFired))));
    sim.set('L:FIRE_APU_AGENT_DISCH', b2n(lampPwr && (a.test || a.bottle.discharged)));
    sim.set('S:FIRE_APU_DET', a.det);
    sim.set('S:FIRE_APU_TEST', a.test);
    sim.set('S:FIRE_APU_FIRE', az.fire);
    sim.set('S:FIRE_APU_AGENT_DISCH', a.bottle.discharged);
    sim.set('S:FIRE_APU_BOTTLE_PRESS', Math.round(a.bottle.press));
    sim.set('S:FIRE_APU_SQUIB_ARMED', apuPbOut);
    sim.set('S:FIRE_APU_LOOP_A_FAULT', az.loopAFault);
    sim.set('S:FIRE_APU_LOOP_B_FAULT', az.loopBFault);

    // APU AUTO EXTING TEST (maintenance panel): TEST while held, OK after a satisfactory 3 s test.
    const aeHeld = sim.get('C:MAINT_APU_AUTOEXT_TEST') > 0.5 && fdu;
    a.autoExtTestT = aeHeld ? a.autoExtTestT + dt : 0;
    sim.set('L:MAINT_APU_AUTOEXT_TEST_TEST', b2n(aeHeld && lampPwr));
    sim.set('L:MAINT_APU_AUTOEXT_TEST_OK', b2n(aeHeld && lampPwr && a.autoExtTestT >= 3 && !a.bottle.squibFired));
    sim.set('S:FIRE_APU_AUTOEXT_TEST', aeHeld);

    // ---------------- cargo smoke
    const cg = this.cargo;
    const cgPwr = p.dcEss || p.dcBat || p.dc2;
    const testHeld = sim.get('C:CARGO_SMOKE_TEST') > 0.5 && cgPwr;
    if (testHeld && !cg.testHeld && cg.testT < 0) cg.testT = 0;
    cg.testHeld = testHeld;
    if (cg.testT >= 0) {
      cg.testT += dt;
      if (cg.testT > 9) cg.testT = -1;
    }
    const testSmoke = cg.testT >= 0 && ((cg.testT >= 1 && cg.testT < 4) || (cg.testT >= 6 && cg.testT < 9));
    const smokeFwd = cgPwr && (cg.smokeFwd || testSmoke);
    const smokeAft = cgPwr && (cg.smokeAft || testSmoke);
    for (const zone of ['FWD', 'AFT'] as const) {
      const v = zone === 'FWD' ? sim.get('C:CARGO_SMOKE_FWD_DISCH') : sim.get('C:CARGO_SMOKE_AFT_DISCH');
      if (this.pressed(`CARGO_${zone}`, v) && cgPwr && !cg.bottle.squibFired) {
        cg.bottle.squibFired = true;
        cg.dischTo = zone;
      }
    }
    cg.bottle.update(dt, oat);
    if (cg.bottle.discharged && cg.dischTo === 'FWD') cg.smokeFwd = false;
    if (cg.bottle.discharged && cg.dischTo === 'AFT') cg.smokeAft = false;
    const lp = p.ann || p.dc2;
    sim.set('L:CARGO_SMOKE_FWD_DISCH_SMOKE', b2n(lp && smokeFwd));
    sim.set('L:CARGO_SMOKE_AFT_DISCH_SMOKE', b2n(lp && smokeAft));
    sim.set('L:CARGO_SMOKE_FWD_DISCH_DISCH', b2n(lp && (testHeld || (cg.bottle.discharged && cg.dischTo === 'FWD'))));
    sim.set('L:CARGO_SMOKE_AFT_DISCH_DISCH', b2n(lp && (testHeld || (cg.bottle.discharged && cg.dischTo === 'AFT'))));
    sim.set('S:SMOKE_CARGO_FWD_DET', smokeFwd);
    sim.set('S:SMOKE_CARGO_AFT_DET', smokeAft);
    // aliases read by sys-air's aft cargo ventilation (isolation valves close on smoke)
    sim.set('S:FIRE_CARGO_FWD_SMOKE', smokeFwd);
    sim.set('S:FIRE_CARGO_AFT_SMOKE', smokeAft);
    sim.set('S:FIRE_CARGO_TEST', cg.testT >= 0);
    sim.set('S:FIRE_CARGO_BOTTLE_DISCH', cg.bottle.discharged);
    sim.set('S:FIRE_CARGO_DISCH_FWD', cg.bottle.discharged && cg.dischTo === 'FWD');
    sim.set('S:FIRE_CARGO_DISCH_AFT', cg.bottle.discharged && cg.dischTo === 'AFT');
  }
}
