/**
 * Exterior & interior lighting, cabin signs, emergency lighting (FCOM DSC-33).
 *
 * Exterior (AC powered):
 *  - BEACON: red anti-collision lights, ≈ 50 flashes/min (S:EXTLT_BEACON = instantaneous flash).
 *  - STROBE ON, or AUTO when airborne (main gear shock absorbers extended): white double flash every 1.2 s.
 *  - NAV & LOGO 1/2: nav lights (system 1 or 2); LOGO lights on ground or with flaps extended ≥ 15°.
 *  - LAND L/R: ON = extend and light (lamp lit once fully extended), OFF = extended but off,
 *    RETRACT = retract (≈ 8 s travel). NOSE T.O = take-off + taxi lights, TAXI = taxi light; both go out
 *    automatically when the nose gear is not down-locked. RWY TURN OFF idem.
 * Interior:
 *  - DOME BRT/DIM: supplied by the hot battery bus (works in cold & dark), else DC ESS.
 *  - Integral lighting (OVHD INTEG LT pot, INTEG LT MAIN PNL & PED pot): AC.
 *    The glareshield/FCU integral lighting follows the MAIN PNL & PED pot (no FCU knob in the catalog).
 *  - Flood lights (main panel DC ESS or DC 1, pedestal DC 2 or DC ESS), console/floor (BRT 1, DIM 0.4),
 *    reading lights, ICE IND & STBY COMPASS.
 *  - ANN LT: TEST → S:INTLT_ANN_TEST (only when the annunciators are powered, S:ANN_POWER from sys-elec),
 *    DIM → S:INTLT_ANN_DIM. The cockpit kit applies them to every annunciator.
 * Signs (CIDS, DC):
 *  - SEAT BELTS ON; NO SMOKING ON, or AUTO with the landing gear down-locked; EXIT signs with NO SMOKING
 *    ON/AUTO (gear down) or EMER EXIT LT ON; all signs on when the cabin altitude exceeds 11 300 ft.
 *    Each seat belt / no smoking sign change → `cabin:chime {type:'lo'}`.
 *  - EMER EXIT LT ON: emergency lights on; ARM: they come on automatically when DC SHED ESS BUS is lost.
 */
import { approach } from '../../core/sim';
import { type Ctx, clamp } from './common';

const LAND_TRAVEL = 8;

export class LightsModel {
  landExt = [0, 0];
  private lastBelts: boolean | null = null;
  private lastNoSmk: boolean | null = null;

  /** ANN LT TEST / DIM (also run early in the frame by index.ts so every light system sees them). */
  static annLt(c: Ctx): void {
    const { sim } = c;
    const annPwr = sim.has('S:ANN_POWER') ? sim.getB('S:ANN_POWER') : c.p.ann;
    const sel = Math.round(sim.get('C:INTLT_ANN_LT')); // 0 TEST, 1 BRT, 2 DIM
    sim.set('S:INTLT_ANN_TEST', annPwr && sel === 0);
    sim.set('S:INTLT_ANN_DIM', sel === 2);
  }

  update(c: Ctx): void {
    this.exterior(c);
    this.interior(c);
    this.signs(c);
  }

  private exterior(c: Ctx): void {
    const { sim, dt, t, p } = c;
    const ac = p.ac1 || p.ac2 || p.acEss;
    const noseDown = sim.getB('S:GEAR_DOWNLOCKED') || c.onGround;

    const beaconOn = ac && Math.round(sim.get('C:EXTLT_BEACON')) === 0;
    const bPhase = t % 1.2;
    sim.set('S:EXTLT_BEACON_ON', beaconOn);
    sim.set('S:EXTLT_BEACON', beaconOn && bPhase < 0.14);

    const strobeSel = Math.round(sim.get('C:EXTLT_STROBE')); // 0 ON, 1 AUTO, 2 OFF
    const strobeOn = ac && (strobeSel === 0 || (strobeSel === 1 && !c.onGround));
    const sPhase = t % 1.2;
    sim.set('S:EXTLT_STROBE_ON', strobeOn);
    sim.set('S:EXTLT_STROBE', strobeOn && (sPhase < 0.06 || (sPhase >= 0.14 && sPhase < 0.2)));

    const navSel = Math.round(sim.get('C:EXTLT_NAV_LOGO')); // 0 '2', 1 '1', 2 OFF (both systems light the same lamps)
    const navOn = ac && navSel !== 2;
    const flaps = sim.get('S:FCTL_FLAPS');
    sim.set('S:EXTLT_NAV', navOn);
    sim.set('S:EXTLT_LOGO', navOn && (c.onGround || flaps >= 15));

    sim.set('S:EXTLT_WING', ac && Math.round(sim.get('C:EXTLT_WING')) === 0);
    sim.set('S:EXTLT_RWY_TURNOFF', ac && noseDown && Math.round(sim.get('C:EXTLT_RWY_TURNOFF')) === 0);

    const nose = Math.round(sim.get('C:EXTLT_NOSE')); // 0 T.O, 1 TAXI, 2 OFF
    sim.set('S:EXTLT_TAXI', ac && noseDown && nose <= 1);
    sim.set('S:EXTLT_TO', ac && noseDown && nose === 0);

    const landSel = [Math.round(sim.get('C:EXTLT_LAND_L')), Math.round(sim.get('C:EXTLT_LAND_R'))]; // 0 ON, 1 OFF, 2 RETRACT
    for (let i = 0; i < 2; i++) {
      const target = landSel[i] === 2 ? 0 : 1;
      if (ac) this.landExt[i] = approach(this.landExt[i], target, 1 / LAND_TRAVEL, dt);
    }
    const lampL = ac && landSel[0] === 0 && this.landExt[0] >= 1;
    const lampR = ac && landSel[1] === 0 && this.landExt[1] >= 1;
    sim.set('S:EXTLT_LAND_L', lampL);
    sim.set('S:EXTLT_LAND_R', lampR);
    sim.set('S:EXTLT_LAND_L_EXT', Math.round(this.landExt[0] * 1000) / 1000);
    sim.set('S:EXTLT_LAND_R_EXT', Math.round(this.landExt[1] * 1000) / 1000);
  }

  private interior(c: Ctx): void {
    const { sim, p } = c;
    const ac = p.ac1 || p.ac2 || p.acEss;
    const dome = Math.round(sim.get('C:INTLT_DOME')); // 0 BRT, 1 DIM, 2 OFF
    const domePwr = p.hot1 || p.hot2 || p.dcEss || p.dcBat;
    sim.set('S:INTLT_DOME', domePwr ? (dome === 0 ? 1 : dome === 1 ? 0.35 : 0) : 0);

    const ovhd = clamp(sim.get('C:INTLT_OVHD_INTEG'), 0, 1);
    const mainPed = clamp(sim.get('C:INTEG_MAIN_PNL_PED'), 0, 1);
    sim.set('S:INTLT_INTEG_OVHD', ac ? ovhd : 0);
    sim.set('S:INTLT_INTEG_MAIN', ac ? mainPed : 0);
    sim.set('S:INTLT_INTEG_GLARE', ac ? mainPed : 0);

    const floodMain = clamp(sim.get('C:FLOOD_MAIN_PNL'), 0, 1);
    const floodPed = clamp(sim.get('C:FLOOD_PED'), 0, 1);
    sim.set('S:INTLT_FLOOD_MAIN', p.dcEss || p.dc1 ? floodMain : 0);
    sim.set('S:INTLT_FLOOD_PED', p.dc2 || p.dcEss ? floodPed : 0);

    const cf = (v: number) => (v === 0 ? 1 : v === 1 ? 0.4 : 0);
    sim.set('S:INTLT_CONSOLE_CAPT', p.dc1 || p.dcEss ? cf(Math.round(sim.get('C:MAIN_CONSOLE_FLOOR_CAPT'))) : 0);
    sim.set('S:INTLT_CONSOLE_FO', p.dc2 || p.dcEss ? cf(Math.round(sim.get('C:MAIN_CONSOLE_FLOOR_FO'))) : 0);
    sim.set('S:INTLT_READING_CAPT', p.dc1 || p.dcEss ? clamp(sim.get('C:READING_LT_CAPT'), 0, 1) : 0);
    sim.set('S:INTLT_READING_FO', p.dc2 || p.dcEss ? clamp(sim.get('C:READING_LT_FO'), 0, 1) : 0);

    const iceInd = Math.round(sim.get('C:INTLT_ICE_IND')) === 0 && (p.dcEss || p.dcBat || ac);
    sim.set('S:INTLT_STBY_COMPASS', iceInd);
    sim.set('S:INTLT_ICE_IND', iceInd);
  }

  private signs(c: Ctx): void {
    const { sim, p } = c;
    const cids = p.dcEss || p.dc1 || p.dc2;
    const gearDown = sim.getB('S:GEAR_DOWNLOCKED') || c.onGround;
    const highCab = sim.get('S:PRESS_CAB_ALT') > 11300;
    const beltsSel = Math.round(sim.get('C:SIGNS_SEAT_BELTS')) === 0;
    const nsSel = Math.round(sim.get('C:SIGNS_NO_SMOKING')); // 0 ON, 1 AUTO, 2 OFF
    const emerSel = Math.round(sim.get('C:SIGNS_EMER_EXIT_LT')); // 0 ON, 1 ARM, 2 OFF
    const belts = cids && (beltsSel || highCab);
    const noSmk = cids && (nsSel === 0 || (nsSel === 1 && gearDown) || highCab);
    const emerLt = emerSel === 0 || (emerSel === 1 && !p.dcEssShed);
    const exit = (cids && (nsSel === 0 || (nsSel === 1 && gearDown) || highCab)) || emerLt;
    if (this.lastBelts !== null && cids && (belts !== this.lastBelts || noSmk !== this.lastNoSmk)) {
      sim.emit('cabin:chime', { type: 'lo' });
    }
    this.lastBelts = belts;
    this.lastNoSmk = noSmk;
    sim.set('S:SIGNS_SEATBELTS', belts);
    sim.set('S:SIGNS_NOSMOKING', noSmk);
    sim.set('S:SIGNS_EXIT', exit);
    sim.set('S:SIGNS_EMER_LT', emerLt);
    sim.set('S:SIGNS_EMER_EXIT_LT_OFF', emerSel !== 1);
  }
}
