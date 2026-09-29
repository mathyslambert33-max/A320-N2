/**
 * ECAM dev scenarios: /dev.html?display=EWD|SD&mods=ecam&power=1&scenario=ecam.<name>
 *
 * The harness loads only the ECAM module, so these scenarios write the system outputs directly
 * (the variables the aircraft systems publish, see docs/SIMVARS.md). Extra scenarios `sd<PAGE>`
 * (sdENG, sdBLEED, ... sdCRUISE, sdSTS) show one SD page with both engines running.
 */
import type { Sim } from '../../core/sim';
import type { EcamService } from '../../avionics/ecam/logic';
import { SdPage } from '../../avionics/ecam/logic/types';

type Scenario = (sim: Sim) => void;

const svc = (sim: Sim): EcamService | undefined => sim.services.ecam as EcamService | undefined;

/** Run `fn` once, `delay` s of sim time after the start. */
function after(sim: Sim, delay: number, fn: () => void): void {
  let t = 0;
  let done = false;
  sim.register({
    name: `ecam-scenario-${delay}`, order: 95,
    update(dt) {
      if (done) return;
      t += dt;
      if (t >= delay) { done = true; fn(); }
    },
  });
}

function set(sim: Sim, vars: Record<string, number>): void {
  for (const [k, v] of Object.entries(vars)) sim.set(k, v);
}

/** Electrical network normal on external power (DMCs, FWCs, SDACs powered). */
function extPower(sim: Sim): void {
  set(sim, {
    'S:ELEC_HOT_BUS1': 1, 'S:ELEC_HOT_BUS2': 1, 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1, 'S:ELEC_DC_ESS_SHED': 1,
    'S:ELEC_DC1_BUS': 1, 'S:ELEC_DC2_BUS': 1, 'S:ELEC_AC1_BUS': 1, 'S:ELEC_AC2_BUS': 1, 'S:ELEC_AC_ESS_BUS': 1,
    'S:ELEC_AC_ESS_SHED': 1, 'S:ELEC_EXT_PWR_ON': 1, 'S:ANN_POWER': 1,
    'S:ELEC_BAT1_V': 28.2, 'S:ELEC_BAT2_V': 28.1, 'S:ELEC_BAT1_A': 2, 'S:ELEC_BAT2_A': 2,
    'S:ELEC_EXT_V': 115, 'S:ELEC_EXT_HZ': 400,
    'S:ELEC_TR1_V': 28, 'S:ELEC_TR1_A': 60, 'S:ELEC_TR2_V': 28, 'S:ELEC_TR2_A': 55,
    'C:ELEC_BAT1': 1, 'C:ELEC_BAT2': 1, 'C:ELEC_EXT_PWR': 1,
    'C:ECP_UPPER_BRT': 0.8, 'C:ECP_LOWER_BRT': 0.8,
    'S:FCTL_ELAC1_ON': 1, 'S:FCTL_ELAC2_ON': 1, 'S:FCTL_SEC1_ON': 1, 'S:FCTL_SEC2_ON': 1, 'S:FCTL_SEC3_ON': 1,
    'S:FCTL_FAC1_ON': 1, 'S:FCTL_FAC2_ON': 1,
    'S:FUEL_LO_KG': 691, 'S:FUEL_LI_KG': 2409, 'S:FUEL_C_KG': 0, 'S:FUEL_RI_KG': 2409, 'S:FUEL_RO_KG': 691,
    'S:FUEL_FOB_KG': 6200,
    'S:BRK_ACCU_PRESS': 3000, 'S:BRK_PARK_ON': 1, 'C:PARK_BRK': 1,
    'S:BRK_TEMP_1': 20, 'S:BRK_TEMP_2': 21, 'S:BRK_TEMP_3': 20, 'S:BRK_TEMP_4': 19,
    'S:COND_CKPT_TEMP': 22, 'S:COND_FWD_TEMP': 23, 'S:COND_AFT_TEMP': 23,
    'S:COND_CKPT_DUCT': 22, 'S:COND_FWD_DUCT': 22, 'S:COND_AFT_DUCT': 22,
    'S:PRESS_ACTIVE_SYS': 1, 'S:PRESS_OUTFLOW': 1, 'S:PRESS_LDG_ELEV': 300,
    'S:OXY_CREW_PRESS': 1850,
  });
}

/** IRS aligned (NAV), ADRs valid. */
function irsAligned(sim: Sim): void {
  for (const n of [1, 2, 3]) {
    set(sim, {
      [`C:ADIRS_IR${n}_MODE`]: 1, [`S:ADIRS_IR${n}_STATE`]: 2, [`S:ADIRS_IR${n}_ALIGNED`]: 1,
      [`S:ADIRS_IR${n}_ALIGN_REMAIN`]: 0, [`S:ADIRS_ADR${n}_ON`]: 1,
    });
  }
  set(sim, { 'S:ADIRS_POS_ENTERED': 1, 'S:ADIRS_IAS': 0, 'S:ADIRS_SAT': 19, 'S:ADIRS_TAT': 19, 'S:ADIRS_BARO_ALT_STD': 60 });
}

/** APU running, APU BLEED on, APU GEN supplying. */
function apuRunning(sim: Sim, bleed = true): void {
  set(sim, {
    'C:APU_MASTER': 1, 'S:APU_AVAIL': 1, 'S:APU_N': 100, 'S:APU_EGT': 480, 'S:APU_FLAP_POS': 1, 'S:APU_STARTING': 0,
    'C:AIR_APU_BLEED': bleed ? 1 : 0, 'S:APU_BLEED_VALVE': bleed ? 1 : 0, 'S:APU_BLEED_PRESS': bleed ? 38 : 0,
    'S:ELEC_APU_GEN_ON': 1, 'S:ELEC_APU_GEN_V': 115, 'S:ELEC_APU_GEN_HZ': 400, 'S:ELEC_APU_GEN_LOAD': 28,
    'S:BLEED_XBLEED_VALVE': bleed ? 1 : 0, 'S:BLEED_PRESS_1': bleed ? 38 : 0, 'S:BLEED_PRESS_2': bleed ? 38 : 0,
    'S:ELEC_EXT_PWR_ON': 0, 'G:GND_EXT_PWR': 0,
  });
}

/** One engine stabilised at idle (CFM56-5B4/P, ISA+4 at LFBD). */
function engineIdle(sim: Sim, n: 1 | 2): void {
  set(sim, {
    [`C:ENG_MASTER${n}`]: 0, [`S:ENG${n}_FADEC_ON`]: 1, [`S:ENG${n}_STATE`]: 3, [`S:ENG${n}_RUNNING`]: 1,
    [`S:ENG${n}_N1`]: 19.6 + (n === 2 ? 0.2 : 0), [`S:ENG${n}_N2`]: 58.9 + (n === 2 ? 0.3 : 0), [`S:ENG${n}_EGT`]: 412 + n * 6,
    [`S:ENG${n}_FF`]: 290 + n * 10, [`S:ENG${n}_OIL_PRESS`]: 28, [`S:ENG${n}_OIL_TEMP`]: 62, [`S:ENG${n}_OIL_QTY`]: 16.5,
    [`S:ENG${n}_VIB_N1`]: 0.2, [`S:ENG${n}_VIB_N2`]: 0.4, [`S:ENG${n}_START_VALVE`]: 0, [`S:ENG${n}_IGN_A`]: 0, [`S:ENG${n}_IGN_B`]: 0,
    [`S:ENG${n}_HP_FUEL_VALVE`]: 1, [`S:FUEL_ENG${n}_LP_VALVE`]: 1, [`S:FUEL_USED_${n}`]: 40 + n * 10,
    [`S:ELEC_GEN${n}_ON`]: 1, [`S:ELEC_GEN${n}_V`]: 115, [`S:ELEC_GEN${n}_HZ`]: 400, [`S:ELEC_GEN${n}_LOAD`]: 30,
    [`S:HYD_ENG${n}_PUMP_ON`]: 1, [`S:BLEED_ENG${n}_VALVE`]: 1, [`S:BLEED_ENG${n}_HP_VALVE`]: 1, [`S:BLEED_PRESS_${n}`]: 42,
    [`S:BLEED_TEMP_${n}`]: 170, [`S:PACK${n}_VALVE`]: 1, [`S:PACK${n}_FLOW`]: 1, [`S:PACK${n}_OUT_TEMP`]: 12, [`S:PACK${n}_COMP_TEMP`]: 95,
  });
  if (n === 1) set(sim, { 'S:HYD_G_PRESS': 3000 });
  else set(sim, { 'S:HYD_Y_PRESS': 3000 });
  set(sim, { 'S:HYD_B_PRESS': 3000, 'S:HYD_B_ELEC_PUMP_ON': 1, 'S:ELEC_EXT_PWR_ON': 0, 'S:NWS_AVAIL': 1 });
}

function bothEnginesRunning(sim: Sim): void {
  extPower(sim);
  irsAligned(sim);
  apuRunning(sim, false);
  engineIdle(sim, 1);
  engineIdle(sim, 2);
  set(sim, {
    'C:AIR_APU_BLEED': 0, 'S:BLEED_XBLEED_VALVE': 0, 'S:PRESS_DELTA_P': 0, 'S:PRESS_CAB_ALT': 150,
    'C:SIGNS_SEAT_BELTS': 0, 'C:SIGNS_NO_SMOKING': 1, 'S:SIGNS_SEATBELTS': 1, 'S:SIGNS_NOSMOKING': 1,
    'S:FMGS_ZFW': 57554, 'S:FMGS_ZFWCG': 27.4, 'S:FMGS_GW': 57554 + 6150, 'S:FMGS_CG': 27.9,
    'S:FMGS_V1': 142, 'S:FMGS_VR': 144, 'S:FMGS_V2': 148, 'S:FMGS_FLEX': 58, 'S:FMGS_TO_CONF': 1, 'S:FMGS_THS_FOR': 1,
    'S:ENG_THR_LIMIT_TYPE': 1, 'S:ENG_THR_LIMIT_N1': 88.6, 'S:ENG_FLX_TEMP': 58,
    'G:TIME_UTC': 12 * 3600 + 23 * 60,
    // doors closed, jet bridge and GPU removed, crew oxygen ON
    'G:DOOR_PAX_L1': 0, 'G:DOOR_PAX_L2': 0, 'G:DOOR_PAX_R1': 0, 'G:DOOR_PAX_R2': 0,
    'G:DOOR_CARGO_FWD': 0, 'G:DOOR_CARGO_AFT': 0, 'G:DOOR_CARGO_BULK': 0, 'G:JETBRIDGE': 0, 'G:GND_EXT_PWR': 0,
    'G:SLIDES_ARMED': 1, 'C:OXY_CREW_SUPPLY': 1, 'S:ELEC_APU_GEN_ON': 0,
  });
}

const PAGE_SCENARIOS: Record<string, Scenario> = {};
for (const [name, page] of Object.entries({
  ENG: SdPage.ENG, BLEED: SdPage.BLEED, PRESS: SdPage.PRESS, ELEC: SdPage.ELEC, HYD: SdPage.HYD, FUEL: SdPage.FUEL,
  APU: SdPage.APU, COND: SdPage.COND, DOOR: SdPage.DOOR, WHEEL: SdPage.WHEEL, FCTL: SdPage.FCTL, CRUISE: SdPage.CRUISE,
})) {
  PAGE_SCENARIOS[`sd${name}`] = (sim) => {
    bothEnginesRunning(sim);
    const s = svc(sim);
    s?.debug.skipSelfTest();
    s?.debug.forcePhase(2);
    if (page === SdPage.CRUISE) {
      // cruise page is automatic in phase 6
      set(sim, { 'G:AC_ON_GROUND': 0, 'G:AC_RADALT_FT': 35000, 'S:ADIRS_IAS': 270, 'C:THR_LEVER1': 25, 'C:THR_LEVER2': 25,
        'S:PRESS_DELTA_P': 7.9, 'S:PRESS_CAB_ALT': 6800, 'S:PRESS_CAB_VS': 0, 'S:ADIRS_SAT': -52, 'S:ADIRS_TAT': -28,
        'S:ADIRS_BARO_ALT_STD': 35000, 'S:EFIS1_BARO_STD': 1, 'S:FCTL_FLAPS_CONF': 0, 'S:FCTL_SLATS': 0, 'S:FCTL_FLAPS': 0,
        'C:APU_MASTER': 0, 'S:APU_AVAIL': 0, 'S:APU_N': 0, 'S:APU_EGT': 20, 'S:APU_FLAP_POS': 0, 'S:ELEC_APU_GEN_ON': 0,
        'S:GEAR_N_POS': 0, 'S:GEAR_L_POS': 0, 'S:GEAR_R_POS': 0, 'S:FUEL_USED_1': 1840, 'S:FUEL_USED_2': 1870,
        'S:ENG1_N1': 84.1, 'S:ENG2_N1': 84.1, 'S:ENG1_N2': 91.2, 'S:ENG2_N2': 91.4, 'S:ENG1_EGT': 610, 'S:ENG2_EGT': 615,
        'S:ENG1_FF': 1180, 'S:ENG2_FF': 1195, 'S:ENG1_VIB_N1': 0.8, 'S:ENG2_VIB_N1': 0.7, 'S:ENG1_VIB_N2': 1.1, 'S:ENG2_VIB_N2': 1.0,
        'S:ENG1_OIL_QTY': 14.5, 'S:ENG2_OIL_QTY': 15.0, 'S:PRESS_LDG_ELEV': 290,
        'S:COND_CKPT_TEMP': 23, 'S:COND_FWD_TEMP': 24, 'S:COND_AFT_TEMP': 24 });
      s?.debug.forcePhase(6);
      s?.debug.showPage(page);
    } else s?.core.sd.pressPage(page);
  };
}

export const scenarios: Record<string, Scenario> = {
  /** Batteries + external power just connected, everything else cold (DUs already tested). */
  coldDarkPowered(sim) {
    extPower(sim);
    set(sim, { 'S:BRK_ACCU_PRESS': 2100, 'S:ENG1_FADEC_ON': 0, 'S:ENG2_FADEC_ON': 0, 'G:TIME_UTC': 12 * 3600 + 5 * 60 });
    for (const n of [1, 2, 3]) set(sim, { [`C:ADIRS_IR${n}_MODE`]: 1, [`S:ADIRS_IR${n}_STATE`]: 1, [`S:ADIRS_IR${n}_ALIGN_REMAIN`]: 540 });
    svc(sim)?.debug.skipSelfTest();
  },

  /** APU running with APU BLEED ON, IRS aligned, engines off. */
  apuRunning(sim) {
    extPower(sim);
    irsAligned(sim);
    apuRunning(sim, true);
    set(sim, { 'S:HYD_Y_PRESS': 0, 'G:TIME_UTC': 12 * 3600 + 15 * 60, 'C:SIGNS_SEAT_BELTS': 0, 'S:SIGNS_SEATBELTS': 1 });
    svc(sim)?.debug.skipSelfTest();
  },

  /** Engine 2 start in progress (ENG MODE IGN/START, MASTER 2 ON, N2 ~ 24 %, igniter A). */
  eng2Starting(sim) {
    extPower(sim);
    irsAligned(sim);
    apuRunning(sim, true);
    set(sim, {
      'C:ENG_MODE': 2, 'C:ENG_MASTER2': 0, 'S:ENG1_FADEC_ON': 1, 'S:ENG2_FADEC_ON': 1,
      'S:ENG2_STATE': 2, 'S:ENG2_RUNNING': 0, 'S:ENG2_N1': 4.8, 'S:ENG2_N2': 24.6, 'S:ENG2_EGT': 180, 'S:ENG2_FF': 150,
      'S:ENG2_START_VALVE': 1, 'S:ENG2_IGN_A': 1, 'S:ENG2_OIL_PRESS': 12, 'S:ENG2_OIL_TEMP': 24, 'S:ENG2_OIL_QTY': 16.5,
      'S:ENG2_HP_FUEL_VALVE': 1, 'S:BLEED_PRESS_2': 34, 'S:BLEED_PRESS_1': 36,
      'S:ENG1_OIL_QTY': 16.5, 'S:ENG1_OIL_TEMP': 22,
      'C:SIGNS_SEAT_BELTS': 0, 'S:SIGNS_SEATBELTS': 1, 'C:EXTLT_BEACON': 0,
      'G:TIME_UTC': 12 * 3600 + 21 * 60,
    });
    svc(sim)?.debug.skipSelfTest();
  },

  /** Both engines stabilised at idle, APU still running (bleed off), phase 2. */
  enginesRunning(sim) {
    bothEnginesRunning(sim);
    const s = svc(sim);
    s?.debug.skipSelfTest();
    s?.debug.forcePhase(2);
  },

  /** ENG 1 fire test (FIRE TEST pb held) with engines stopped, APU running. */
  fireTest(sim) {
    extPower(sim);
    irsAligned(sim);
    apuRunning(sim, true);
    set(sim, { 'S:FIRE_ENG1_TEST': 1, 'S:FIRE_ENG1_DET': 1 });
    svc(sim)?.debug.skipSelfTest();
  },

  /** Engines running, T.O MEMO displayed (items still to be done). */
  toMemo(sim) {
    bothEnginesRunning(sim);
    set(sim, { 'C:FLAPS_LEVER': 1, 'S:FCTL_SLATS': 18, 'S:FCTL_FLAPS': 10, 'S:FCTL_FLAPS_CONF': 1.5, 'S:AUTOBRK_MODE': 3 });
    const s = svc(sim);
    s?.debug.skipSelfTest();
    s?.debug.forcePhase(2);
    s?.debug.forceToMemo();
  },

  /** Engines running, all T.O MEMO items done and T.O CONFIG test passed ("T.O CONFIG NORMAL"). */
  toMemoDone(sim) {
    scenarios.toMemo(sim);
    set(sim, {
      'C:SPDBRK_ARM': 1, 'S:FCTL_GND_SPLR_ARMED': 1, 'G:CABIN_READY': 1, 'C:SIGNS_NO_SMOKING': 1, 'S:SIGNS_NOSMOKING': 1,
      'S:BRK_PARK_ON': 0, 'C:PARK_BRK': 0,
    });
    // T.O CONFIG pb pressed once the configuration is stable
    after(sim, 1.0, () => sim.emit('ECP_TO_CONFIG:press'));
  },

  ...PAGE_SCENARIOS,

  /** STATUS page: BRAKES A/SKID N/W STRG OFF caution, then CLR pressed (STATUS called automatically). */
  sdSTS(sim) {
    bothEnginesRunning(sim);
    set(sim, { 'C:ASKID_NWSTRG': 1, 'S:NWS_AVAIL': 0 });
    const s = svc(sim);
    s?.debug.skipSelfTest();
    s?.debug.forcePhase(2);
    after(sim, 2.0, () => sim.emit('ECP_CLR_L:press'));
  },
};
