/**
 * PFD / ND / ISIS / FCU dev scenarios:
 *   /dev.html?display=PFD1&mods=pfdnd&power=1&scenario=pfdnd.<name>
 *   (add `mcdu` to mods — `mods=pfdnd,mcdu` — to get the FMGS flight plan on the ND)
 *
 * The harness loads only a few modules, so these scenarios write the other systems' outputs
 * (electrical buses, ADIRS, engines) directly. Names:
 *   coldDarkPowered  aircraft just powered, IRs OFF (all PFD flags, ND HDG / MAP NOT AVAIL)
 *   aligning         IRs aligning: ADR data valid, ATT / HDG / V/S flags
 *   aligned          IRs in NAV, FMGS empty
 *   readyForTaxi     FMGS prepared, QNH 1017, ALT 5000, engines running
 *   takeoffThrust    readyForTaxi + thrust levers at FLX: MAN FLX +58 | SRS | RWY, CLB / NAV armed
 *   selfTest         DUs in their power-up self test      invalidData  DMC 1 lost (CAPT INVALID DATA)
 *   isisInit         ISIS 90 s initialisation              annTest      ANN LT TEST (FCU segments)
 *   ndRoseNav ndRoseIls ndRoseVor ndPlan ndArc40 ndVord ndArpt   ND modes / options (readyForTaxi)
 */
import type { Sim } from '../../core/sim';
import * as mcdu from '../../avionics/mcdu/testing';

type Scenario = (sim: Sim) => void;

function set(sim: Sim, vars: Record<string, number>): void {
  for (const [k, v] of Object.entries(vars)) sim.set(k, v);
}

/** Batteries + external power: every bus, DMCs, annunciators, FCU and FMGC powered. */
function powered(sim: Sim): void {
  set(sim, {
    'S:ELEC_HOT_BUS1': 1, 'S:ELEC_HOT_BUS2': 1, 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1, 'S:ELEC_DC_ESS_SHED': 1,
    'S:ELEC_DC1_BUS': 1, 'S:ELEC_DC2_BUS': 1, 'S:ELEC_AC1_BUS': 1, 'S:ELEC_AC2_BUS': 1, 'S:ELEC_AC_ESS_BUS': 1,
    'S:ELEC_AC_ESS_SHED': 1, 'S:ELEC_AC_POWERED': 1, 'S:ANN_POWER': 1,
    'S:DMC_POWERED_1': 1, 'S:DMC_POWERED_2': 1, 'S:DMC_POWERED_3': 1,
    'S:FCU_POWERED': 1, 'S:FMGS_POWERED': 1, 'S:FMGS_FMGC1_POWERED': 1, 'S:FMGS_FMGC2_POWERED': 1,
  });
}

/** ADIRS outputs. state: 0 off, 1 aligning (ADR valid), 2 NAV. */
function adirs(sim: Sim, state: 0 | 1 | 2): void {
  const att = state === 2 ? 1 : 0;
  const adr = state >= 1 ? 1 : 0;
  for (const s of ['CAPT', 'FO']) {
    set(sim, {
      [`S:ADIRS_${s}_ATT_VALID`]: att, [`S:ADIRS_${s}_HDG_VALID`]: att, [`S:ADIRS_${s}_NAV_VALID`]: att, [`S:ADIRS_${s}_ADR_VALID`]: adr,
    });
  }
  for (const n of [1, 2, 3]) {
    set(sim, {
      [`S:ADIRS_IR${n}_STATE`]: state, [`S:ADIRS_IR${n}_ALIGNED`]: att, [`S:ADIRS_IR${n}_ALIGN_REMAIN`]: state === 1 ? 420 : 0,
      [`S:ADIRS_ADR${n}_ON`]: adr, [`C:ADIRS_IR${n}_MODE`]: state ? 1 : 0,
    });
  }
  const lat = sim.get('G:AC_LAT');
  const lon = sim.get('G:AC_LON');
  set(sim, {
    'S:ADIRS_PITCH': 0.4, 'S:ADIRS_ROLL': 0, 'S:ADIRS_HDG_TRUE': 298, 'S:ADIRS_HDG_MAG': 297.1,
    'S:ADIRS_TRK_TRUE': 298, 'S:ADIRS_TRK_MAG': 297.1, 'S:ADIRS_GS': 0, 'S:ADIRS_VS': 0,
    'S:ADIRS_LAT': lat, 'S:ADIRS_LON': lon, 'S:ADIRS_IAS': 0, 'S:ADIRS_TAS': 0, 'S:ADIRS_MACH': 0,
    'S:ADIRS_BARO_ALT_STD': 60, 'S:ADIRS_STATIC_PRESS': 1011.2, 'S:ADIRS_SAT': 19, 'S:ADIRS_TAT': 19,
    'S:ADIRS_WIND_VALID': 0, 'S:ADIRS_POS_ENTERED': state === 2 ? 1 : 0, 'S:RA_ALT': 0,
  });
}

/** Prepare the FMGS with the MCDU (when the mcdu module is loaded): INIT A/B, F-PLN, PERF TO. */
function prepareFmgs(sim: Sim): void {
  if (!sim.services.mcdu) {
    set(sim, { 'S:FMGS_V1': 142, 'S:FMGS_VR': 144, 'S:FMGS_V2': 148, 'S:FMGS_FLEX': 58, 'S:FMGS_TO_CONF': 1 });
    return;
  }
  const m = mcdu;
  m.powerUp(sim);
  m.doInitA(sim);
  m.press(sim, 1, 'R3'); // ALIGN IRS
  adirs(sim, 2);
  m.irsAligned(sim);
  m.doInitB(sim);
  m.doPerfTo(sim);
  m.press(sim, 1, 'FPLN');
  sim.run(6);
}

/** FCU / EFIS set as after the cockpit preparation. */
function fcuPrepared(sim: Sim): void {
  set(sim, {
    'S:FCU_ALT': 5000, 'S:EFIS1_BARO_STD': 0, 'S:EFIS2_BARO_STD': 0, 'S:EFIS1_BARO_HPA': 1017, 'S:EFIS2_BARO_HPA': 1017,
    'C:EFIS1_NAV1': 0, 'C:EFIS1_NAV2': 0, 'C:EFIS2_NAV1': 0, 'C:EFIS2_NAV2': 0, 'S:ISIS_BARO_HPA': 1017,
  });
}

function enginesRunning(sim: Sim): void {
  set(sim, {
    'S:ENG1_RUNNING': 1, 'S:ENG2_RUNNING': 1, 'S:ENG1_STATE': 3, 'S:ENG2_STATE': 3, 'S:ENG1_N1': 19.5, 'S:ENG2_N1': 19.6,
    'S:ENG1_FADEC_ON': 1, 'S:ENG2_FADEC_ON': 1,
  });
}

function readyForTaxi(sim: Sim): void {
  powered(sim);
  adirs(sim, 2);
  prepareFmgs(sim);
  if (!sim.services.mcdu) set(sim, { 'S:FMGS_FPLN_ACTIVE': 1 });
  fcuPrepared(sim);
  enginesRunning(sim);
  set(sim, { 'C:FLAPS_LEVER': 1, 'S:FCTL_FLAPS_CONF': 1.5, 'S:FCU_LS1': 0 });
}

const nd = (mode: number, range = 0, extra: Record<string, number> = {}): Scenario => (sim) => {
  readyForTaxi(sim);
  set(sim, { 'C:EFIS1_ND_MODE': mode, 'C:EFIS1_ND_RANGE': range, 'C:EFIS2_ND_MODE': mode, 'C:EFIS2_ND_RANGE': range, ...extra });
};

export const scenarios: Record<string, Scenario> = {
  coldDarkPowered(sim) {
    powered(sim);
    adirs(sim, 0);
  },
  aligning(sim) {
    powered(sim);
    adirs(sim, 1);
  },
  aligned(sim) {
    powered(sim);
    adirs(sim, 2);
  },
  readyForTaxi: (sim) => readyForTaxi(sim),
  takeoffThrust(sim) {
    readyForTaxi(sim);
    set(sim, { 'C:THR_LEVER1': 35, 'C:THR_LEVER2': 35, 'S:FCU_LS1': 1 });
  },
  selfTest(sim) {
    powered(sim);
    adirs(sim, 0);
    for (const id of ['PFD1', 'ND1', 'PFD2', 'ND2']) set(sim, { [`S:PFDND_DU_${id}_STATE`]: 1, [`S:PFDND_DU_${id}_TEST_REMAIN`]: 20 });
  },
  invalidData(sim) {
    powered(sim);
    adirs(sim, 2);
    set(sim, { 'S:DMC_POWERED_1': 0 });
  },
  isisInit(sim) {
    powered(sim);
    set(sim, { 'S:ISIS_STATE': 1, 'S:ISIS_INIT_REMAIN': 76 });
  },
  annTest(sim) {
    powered(sim);
    set(sim, { 'S:INTLT_ANN_TEST': 1 });
  },
  ndRoseNav: nd(2, 1),
  ndRoseIls: nd(0, 1),
  ndRoseVor: nd(1, 1),
  ndPlan: nd(4, 1),
  ndArc40: nd(3, 2),
  ndVord: nd(3, 2, { 'S:EFIS1_OPTION': 3, 'S:EFIS2_OPTION': 3 }),
  ndArpt: nd(3, 3, { 'S:EFIS1_OPTION': 5, 'S:EFIS2_OPTION': 5 }),
};
