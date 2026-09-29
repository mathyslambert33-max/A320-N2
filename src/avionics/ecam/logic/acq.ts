/**
 * FWC / SDAC acquisition: reads every input of the ECAM once per tick into typed fields.
 *
 * Other modules are written in parallel, so every read goes through helpers that handle
 * missing variables gracefully (documented names from docs/SIMVARS.md first, then a
 * fallback on the cockpit control positions which always exist).
 */
import type { Sim } from '../../../core/sim';

export interface EngAcq {
  n1: number;
  n2: number;
  egt: number;
  ff: number;
  oilPress: number;
  oilTemp: number;
  oilQty: number;
  /** Stabilised at or above idle. */
  running: boolean;
  /** 0 off, 1 dry crank, 2 start in progress, 3 running, 4 shutting down, 5 start aborted. */
  state: number;
  fadec: boolean;
  /** ENG MASTER lever ON (catalog pos ['ON','OFF']: 0 = ON). */
  master: boolean;
  tla: number;
  startValve: boolean;
  ignA: boolean;
  ignB: boolean;
  startFault: number;
  fireDet: boolean;
  fireTest: boolean;
  /** ENG FIRE pb released (pushed out). */
  firePbOut: boolean;
  agent1: boolean;
  agent2: boolean;
  bleedPress: number;
  bleedValve: boolean;
  hpValve: boolean;
  lpValve: boolean;
  genOn: boolean;
  genPb: boolean;
  edpOn: boolean;
  edpPb: boolean;
  bleedPb: boolean;
  aiPb: boolean;
  rev: number;
  manStart: boolean;
}

export class Acq {
  sim!: Sim;
  t = 0;

  // power
  acEss = false; ac1 = false; ac2 = false; acEssShed = false;
  dcEss = false; dcBat = false; dc1 = false; dc2 = false; dcEssShed = false; hot1 = false; hot2 = false;
  annPower = false;
  fwc1 = false; fwc2 = false; sdac1 = false; sdac2 = false;
  dmc1 = false; dmc2 = false; dmc3 = false;

  // aircraft
  onGround = true;
  ias = 0;
  gs = 0;
  radioAlt = 0;
  radioAltValid = false;

  eng: [EngAcq, EngAcq] = [newEng(), newEng()];
  engModeSel = 1;
  anyEngRunning = false;
  bothEngRunning = false;

  // APU
  apuMaster = false; apuAvail = false; apuN = 0; apuBleedValve = false; apuBleedPb = false; apuStarting = false;
  /** Time (s) since the APU BLEED pb was selected ON (SD APU page valve disagree). */
  apuBleedPbFor = 0;
  private apuBleedPbSince = -1;
  apuFireDet = false; apuFireTest = false; apuFirePbOut = false; apuAgent = false;

  // flight controls
  flapsLever = 0; slats = 0; flaps = 0; flapsConf = 0; slatsMoving = false; flapsMoving = false;
  spdBrkLever = 0; gndSplrArmed = false; ths = 0; rudTrim = 0;
  sidestickMoved = false; rudderMoved = false;

  // brakes / gear
  parkBrake = false; brkTemps = [0, 0, 0, 0]; autobrake = 0; brkAccu = 3000; brkFanPb = false;
  towbar = false; askidNws = true; nwsAvail = false;

  // signs / lights
  seatBelts = false; noSmoking = false; strobeSw = 2; landLtExt = false;

  // ADIRS
  irState = [0, 0, 0]; irRemain = [0, 0, 0]; irMode = [0, 0, 0]; adrOn = [false, false, false];
  adrPb = [true, true, true]; irPb = [true, true, true];
  posEntered = false; sat = 15; tat = 15; baroAlt = 0; satValid = false; tatValid = false;

  // hydraulics
  hydG = 0; hydB = 0; hydY = 0; hydGQty = 14; hydBQty = 6.5; hydYQty = 12.5;
  ptuActive = false; ptuPb = true; yElecPumpOn = false; bElecPumpOn = false; yElecPb = false; bElecPb = true;
  ratDeployed = 0;

  // fuel
  fuelLo = 0; fuelLi = 0; fuelC = 0; fuelRi = 0; fuelRo = 0; fob = 0;
  xfeedPb = false; xfeedOpen = false; wingPumpPb = [true, true, true, true]; ctrPumpPb = [true, true]; fuelModeAuto = true;

  // anti ice
  wingAiPb = false; wingAiOn = false; eng1AiOn = false; eng2AiOn = false;

  // switching / misc
  swAttHdg = 1; swAirData = 1; swEisDmc = 1; swEcamNdXfr = 1; audioSw = 1;
  gpwsFlapModeOff = false; gpwsFlap3 = false; gpwsTerrOff = false; gpwsSysOff = false; pwsOff = false;
  ldgElevMan = false; pressModeMan = false;
  cabinReady = false; refuel = false;
  packPb = [true, true]; packValve = [false, false]; hotAirPb = true;

  // T.O data
  v1 = 0; vr = 0; v2 = 0; flexTemp = 0; toConf = 0; thsFor = 0; perfToDone = false;

  // doors (0 closed .. 1 open)
  doors: Record<string, number> = {};

  update(sim: Sim, t: number): void {
    this.sim = sim;
    this.t = t;
    const g = (n: string) => sim.get(n);
    const b = (n: string) => sim.get(n) > 0.5;
    const h = (n: string) => sim.has(n);
    /** Documented system var if it exists, otherwise fallback value. */
    const sv = (n: string, fb: number) => (h(n) ? g(n) : fb);
    const sb = (n: string, fb: boolean) => (h(n) ? b(n) : fb);

    // ---------------- power
    this.acEss = b('S:ELEC_AC_ESS_BUS');
    this.ac1 = b('S:ELEC_AC1_BUS');
    this.ac2 = b('S:ELEC_AC2_BUS');
    this.acEssShed = b('S:ELEC_AC_ESS_SHED');
    this.dcEss = b('S:ELEC_DC_ESS_BUS');
    this.dcEssShed = b('S:ELEC_DC_ESS_SHED');
    this.dcBat = b('S:ELEC_DC_BAT_BUS');
    this.dc1 = b('S:ELEC_DC1_BUS');
    this.dc2 = b('S:ELEC_DC2_BUS');
    this.hot1 = b('S:ELEC_HOT_BUS1');
    this.hot2 = b('S:ELEC_HOT_BUS2');
    this.annPower = sb('S:ANN_POWER', this.dcBat || this.dcEss);
    // FWC 1 / SDAC 1 / DMC 1: AC ESS BUS. FWC 2 / SDAC 2 / DMC 2: AC BUS 2. DMC 3: AC BUS 1.
    this.fwc1 = this.acEss;
    this.fwc2 = this.ac2;
    this.sdac1 = this.acEss;
    this.sdac2 = this.ac2;
    this.dmc1 = this.acEss;
    this.dmc2 = this.ac2;
    this.dmc3 = this.ac1;

    // ---------------- aircraft state
    this.onGround = sb('G:AC_ON_GROUND', true);
    this.gs = g('G:AC_GS_KT');
    const adrValid = b('S:ADIRS_ADR1_ON') || b('S:ADIRS_ADR2_ON') || b('S:ADIRS_ADR3_ON');
    this.ias = adrValid && h('S:ADIRS_IAS') ? g('S:ADIRS_IAS') : this.gs;
    this.radioAltValid = h('G:AC_RADALT_FT') || h('S:RA_ALT');
    this.radioAlt = h('S:RA_ALT') ? g('S:RA_ALT') : h('G:AC_RADALT_FT') ? g('G:AC_RADALT_FT') : this.onGround ? 0 : 5000;
    this.satValid = adrValid && h('S:ADIRS_SAT');
    this.tatValid = adrValid && h('S:ADIRS_TAT');
    this.sat = this.satValid ? g('S:ADIRS_SAT') : g('G:ENV_OAT');
    this.tat = this.tatValid ? g('S:ADIRS_TAT') : this.sat;
    this.baroAlt = h('S:ADIRS_BARO_ALT_STD') ? g('S:ADIRS_BARO_ALT_STD') : g('G:ENV_ELEV_FT');

    // ---------------- engines
    for (const n of [1, 2] as const) {
      const e = this.eng[n - 1];
      e.n1 = g(`S:ENG${n}_N1`);
      e.n2 = g(`S:ENG${n}_N2`);
      e.egt = sv(`S:ENG${n}_EGT`, g('G:ENV_OAT'));
      e.ff = g(`S:ENG${n}_FF`);
      e.oilPress = g(`S:ENG${n}_OIL_PRESS`);
      e.oilTemp = sv(`S:ENG${n}_OIL_TEMP`, g('G:ENV_OAT'));
      e.oilQty = sv(`S:ENG${n}_OIL_QTY`, 17);
      e.state = g(`S:ENG${n}_STATE`);
      e.running = h(`S:ENG${n}_RUNNING`) ? b(`S:ENG${n}_RUNNING`) : e.n2 > 55 && e.state !== 2;
      e.fadec = b(`S:ENG${n}_FADEC_ON`);
      e.master = g(`C:ENG_MASTER${n}`) < 0.5; // pos ['ON','OFF']
      e.tla = g(`C:THR_LEVER${n}`);
      e.startValve = b(`S:ENG${n}_START_VALVE`);
      e.ignA = b(`S:ENG${n}_IGN_A`);
      e.ignB = b(`S:ENG${n}_IGN_B`);
      e.startFault = g(`S:ENG${n}_START_FAULT`);
      e.fireDet = b(`S:FIRE_ENG${n}_DET`);
      // fallback when no fire detection system publishes the test state: the TEST pb held (DC powered)
      e.fireTest = sb(`S:FIRE_ENG${n}_TEST`, b(`C:FIRE_ENG${n}_TEST`) && (this.dcBat || this.dcEss));
      e.firePbOut = b(`C:FIRE_ENG${n}_PB`);
      e.agent1 = b(`S:FIRE_ENG${n}_AGENT1_DISCH`);
      e.agent2 = b(`S:FIRE_ENG${n}_AGENT2_DISCH`);
      e.bleedPress = g(`S:BLEED_PRESS_${n}`);
      e.bleedValve = b(`S:BLEED_ENG${n}_VALVE`);
      e.hpValve = b(`S:BLEED_ENG${n}_HP_VALVE`);
      e.lpValve = sb(`S:FUEL_ENG${n}_LP_VALVE`, !e.firePbOut);
      e.genOn = b(`S:ELEC_GEN${n}_ON`);
      e.genPb = b(`C:ELEC_GEN${n}`);
      e.edpOn = b(`S:HYD_ENG${n}_PUMP_ON`);
      e.edpPb = b(`C:HYD_ENG${n}_PUMP`);
      e.bleedPb = b(`C:AIR_ENG${n}_BLEED`);
      e.aiPb = b(`C:AI_ENG${n}`);
      e.rev = g(`S:ENG${n}_REV`);
      e.manStart = b(`C:ENG_MAN_START${n}`);
    }
    this.engModeSel = h('S:ENG_MODE_SEL') ? g('S:ENG_MODE_SEL') : g('C:ENG_MODE');
    this.anyEngRunning = this.eng[0].running || this.eng[1].running;
    this.bothEngRunning = this.eng[0].running && this.eng[1].running;

    // ---------------- APU
    this.apuMaster = b('C:APU_MASTER');
    this.apuAvail = b('S:APU_AVAIL');
    this.apuN = g('S:APU_N');
    this.apuStarting = b('S:APU_STARTING');
    this.apuBleedPb = b('C:AIR_APU_BLEED');
    if (!this.apuBleedPb) this.apuBleedPbSince = -1;
    else if (this.apuBleedPbSince < 0) this.apuBleedPbSince = t;
    this.apuBleedPbFor = this.apuBleedPb ? t - this.apuBleedPbSince : 0;
    this.apuBleedValve = sb('S:APU_BLEED_VALVE', this.apuAvail && this.apuBleedPb);
    this.apuFireDet = b('S:FIRE_APU_DET');
    this.apuFireTest = sb('S:FIRE_APU_TEST', b('C:FIRE_APU_TEST') && (this.dcBat || this.dcEss));
    this.apuFirePbOut = b('C:FIRE_APU_PB');
    this.apuAgent = b('S:FIRE_APU_AGENT_DISCH');

    // ---------------- flight controls
    this.flapsLever = Math.round(g('C:FLAPS_LEVER'));
    const leverConf = [0, 1.5, 2, 3, 4][this.flapsLever] ?? 0;
    const leverSlats = [0, 18, 22, 22, 27][this.flapsLever] ?? 0;
    const leverFlaps = [0, 10, 15, 20, 40][this.flapsLever] ?? 0;
    this.slats = sv('S:FCTL_SLATS', leverSlats);
    this.flaps = sv('S:FCTL_FLAPS', leverFlaps);
    this.flapsConf = sv('S:FCTL_FLAPS_CONF', leverConf);
    this.slatsMoving = b('S:FCTL_SLATS_MOVING');
    this.flapsMoving = b('S:FCTL_FLAPS_MOVING');
    this.spdBrkLever = g('C:SPDBRK_LEVER');
    this.gndSplrArmed = sb('S:FCTL_GND_SPLR_ARMED', b('C:SPDBRK_ARM'));
    this.ths = sv('S:FCTL_THS', g('C:PITCH_TRIM'));
    this.rudTrim = g('S:FCTL_RUD_TRIM');
    this.sidestickMoved = Math.abs(g('C:SIDESTICK_CAPT_X')) > 0.05 || Math.abs(g('C:SIDESTICK_CAPT_Y')) > 0.05 ||
      Math.abs(g('C:SIDESTICK_FO_X')) > 0.05 || Math.abs(g('C:SIDESTICK_FO_Y')) > 0.05;
    this.rudderMoved = Math.abs(g('C:RUDDER')) > 0.2;

    // ---------------- brakes / gear / steering
    this.parkBrake = sb('S:BRK_PARK_ON', b('C:PARK_BRK'));
    for (let i = 0; i < 4; i++) this.brkTemps[i] = sv(`S:BRK_TEMP_${i + 1}`, g('G:ENV_OAT'));
    this.autobrake = g('S:AUTOBRK_MODE');
    this.brkAccu = sv('S:BRK_ACCU_PRESS', 3000);
    this.brkFanPb = b('C:BRK_FAN');
    this.towbar = b('G:GND_TOWBAR');
    this.askidNws = g('C:ASKID_NWSTRG') < 0.5; // pos ['ON','OFF']
    this.nwsAvail = b('S:NWS_AVAIL');

    // ---------------- signs / lights
    const sbSw = g('C:SIGNS_SEAT_BELTS'); // ['ON','OFF']
    const nsSw = g('C:SIGNS_NO_SMOKING'); // ['ON','AUTO','OFF']
    const gearDown = sv('S:GEAR_N_POS', 1) > 0.9;
    this.seatBelts = sb('S:SIGNS_SEATBELTS', sbSw < 0.5);
    this.noSmoking = sb('S:SIGNS_NOSMOKING', nsSw < 0.5 || (Math.round(nsSw) === 1 && gearDown));
    this.strobeSw = Math.round(g('C:EXTLT_STROBE'));
    this.landLtExt = sv('S:EXTLT_LAND_L_EXT', g('C:EXTLT_LAND_L') < 1.5 ? 1 : 0) > 0.05 ||
      sv('S:EXTLT_LAND_R_EXT', g('C:EXTLT_LAND_R') < 1.5 ? 1 : 0) > 0.05;

    // ---------------- ADIRS
    for (let i = 0; i < 3; i++) {
      const n = i + 1;
      this.irMode[i] = Math.round(g(`C:ADIRS_IR${n}_MODE`));
      this.irState[i] = h(`S:ADIRS_IR${n}_STATE`) ? g(`S:ADIRS_IR${n}_STATE`) : 0;
      this.irRemain[i] = g(`S:ADIRS_IR${n}_ALIGN_REMAIN`);
      this.adrOn[i] = b(`S:ADIRS_ADR${n}_ON`);
      this.adrPb[i] = b(`C:ADIRS_ADR${n}`);
      this.irPb[i] = b(`C:ADIRS_IR${n}`);
    }
    this.posEntered = b('S:ADIRS_POS_ENTERED');

    // ---------------- hydraulics
    this.hydG = g('S:HYD_G_PRESS');
    this.hydB = g('S:HYD_B_PRESS');
    this.hydY = g('S:HYD_Y_PRESS');
    this.hydGQty = sv('S:HYD_G_QTY', 14);
    this.hydBQty = sv('S:HYD_B_QTY', 6.5);
    this.hydYQty = sv('S:HYD_Y_QTY', 12.5);
    this.ptuActive = b('S:HYD_PTU_ACTIVE');
    this.ptuPb = b('C:HYD_PTU');
    this.yElecPumpOn = b('S:HYD_Y_ELEC_PUMP_ON');
    this.bElecPumpOn = b('S:HYD_B_ELEC_PUMP_ON');
    this.yElecPb = b('C:HYD_YELLOW_ELEC_PUMP');
    this.bElecPb = b('C:HYD_BLUE_ELEC_PUMP');
    this.ratDeployed = g('S:HYD_RAT_DEPLOYED');

    // ---------------- fuel
    this.fuelLo = g('S:FUEL_LO_KG');
    this.fuelLi = g('S:FUEL_LI_KG');
    this.fuelC = g('S:FUEL_C_KG');
    this.fuelRi = g('S:FUEL_RI_KG');
    this.fuelRo = g('S:FUEL_RO_KG');
    this.fob = h('S:FUEL_FOB_KG') ? g('S:FUEL_FOB_KG') : this.fuelLo + this.fuelLi + this.fuelC + this.fuelRi + this.fuelRo;
    this.xfeedPb = b('C:FUEL_XFEED');
    this.xfeedOpen = sb('S:FUEL_XFEED_OPEN', this.xfeedPb);
    this.wingPumpPb = [b('C:FUEL_L_PUMP1'), b('C:FUEL_L_PUMP2'), b('C:FUEL_R_PUMP1'), b('C:FUEL_R_PUMP2')];
    this.ctrPumpPb = [b('C:FUEL_CTR_PUMP1'), b('C:FUEL_CTR_PUMP2')];
    this.fuelModeAuto = b('C:FUEL_MODE_SEL');

    // ---------------- anti ice
    this.wingAiPb = b('C:AI_WING');
    this.wingAiOn = sb('S:AI_WING_VALVE_L', this.wingAiPb) || sb('S:AI_WING_VALVE_R', this.wingAiPb);
    this.eng1AiOn = this.eng[0].aiPb;
    this.eng2AiOn = this.eng[1].aiPb;

    // ---------------- switching & misc
    this.swAttHdg = Math.round(g('C:SW_ATT_HDG'));
    this.swAirData = Math.round(g('C:SW_AIR_DATA'));
    this.swEisDmc = Math.round(g('C:SW_EIS_DMC'));
    this.swEcamNdXfr = Math.round(g('C:SW_ECAM_ND_XFR'));
    this.audioSw = Math.round(g('C:AUDIO_SWITCHING'));
    this.gpwsFlapModeOff = !b('C:GPWS_FLAP_MODE');
    this.gpwsFlap3 = b('C:GPWS_LDG_FLAP3');
    this.gpwsTerrOff = !b('C:GPWS_TERR');
    this.gpwsSysOff = !b('C:GPWS_SYS');
    this.pwsOff = g('C:WXR_PWS') > 0.5; // ['AUTO','OFF']
    this.ldgElevMan = g('C:PRESS_LDG_ELEV') > 0.5;
    this.pressModeMan = !b('C:PRESS_MODE_SEL');
    this.cabinReady = b('G:CABIN_READY');
    this.refuel = b('G:REFUELING');
    this.packPb = [b('C:AIR_PACK1'), b('C:AIR_PACK2')];
    this.packValve = [b('S:PACK1_VALVE'), b('S:PACK2_VALVE')];
    this.hotAirPb = b('C:AIR_HOT_AIR');

    // ---------------- T.O data (FMGS)
    this.v1 = g('S:FMGS_V1');
    this.vr = g('S:FMGS_VR');
    this.v2 = g('S:FMGS_V2');
    this.flexTemp = h('S:ENG_FLX_TEMP') && g('S:ENG_FLX_TEMP') > 0 ? g('S:ENG_FLX_TEMP') : g('S:FMGS_FLEX');
    this.toConf = g('S:FMGS_TO_CONF');
    this.thsFor = g('S:FMGS_THS_FOR');
    this.perfToDone = b('S:FMGS_PERF_TO_DONE');

    // ---------------- doors
    for (const d of DOOR_VARS) this.doors[d] = g(`G:DOOR_${d}`);
  }

  /** Engine at T.O power (TLA at or above FLX/MCT with FLX temp, or above MCT). */
  toPower(): boolean {
    const [e1, e2] = this.eng;
    const flex = this.flexTemp > 0;
    const mct = (tla: number) => tla > 33.3 && tla < 36.7;
    const aboveMct = e1.tla >= 36.7 || e2.tla >= 36.7;
    return aboveMct || (flex && (mct(e1.tla) || mct(e2.tla)));
  }
}

export const DOOR_VARS = ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2', 'CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK'] as const;

function newEng(): EngAcq {
  return {
    n1: 0, n2: 0, egt: 0, ff: 0, oilPress: 0, oilTemp: 0, oilQty: 0, running: false, state: 0, fadec: false,
    master: false, tla: 0, startValve: false, ignA: false, ignB: false, startFault: 0, fireDet: false, fireTest: false,
    firePbOut: false, agent1: false, agent2: false, bleedPress: 0, bleedValve: false, hpValve: false, lpValve: true,
    genOn: false, genPb: true, edpOn: false, edpPb: true, bleedPb: true, aiPb: false, rev: 0, manStart: false,
  };
}
