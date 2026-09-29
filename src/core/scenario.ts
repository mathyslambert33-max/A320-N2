/**
 * Flight scenario: LFBD (Bordeaux-Mérignac) -> LFPO (Paris-Orly), A320-214 (CFM56-5B4/P).
 * Initial environment, stand, weights and OFP data. Shared by the FMGS, EFB, world and systems.
 */
import type { Sim } from './sim';
import type { TimeOfDay } from './settings';

export const SCENARIO = {
  aircraft: {
    type: 'A320-214',
    engines: 'CFM56-5B4/P',
    registration: 'F-HSIM',
    msn: 5231,
  },
  flight: {
    number: 'SIM6205',
    callsign: 'SIMAIR 6205',
    from: 'LFBD',
    to: 'LFPO',
    altn: 'LFPG',
    crzFl: 350,
    costIndex: 25,
    depRunway: '23',
    arrRunway: '25',
    /** Company route (in the MCDU nav database). */
    coRoute: 'LFBDLFPO1',
    route: 'LFBD/23 CNA6P CNA B19 AMB AMB9W ODILO ILS25 LFPO',
    sid: 'CNA6P',
    star: 'AMB9W',
    approach: 'ILS 25 via ODILO',
    altnCoRoute: 'LFPOLFPG1',
    distanceNm: 319,
    blockTime: '0055',
  },
  /** Stand at LFBD Hall A contact stand, nose-in toward the terminal. */
  stand: {
    name: 'Stand 14 (Hall A)',
    lat: 44.83095,
    lon: -0.70438,
    /** True heading of the aircraft at the stand (deg). */
    headingTrue: 298,
    elevationFt: 162,
  },
  airport: {
    icao: 'LFBD',
    name: 'Bordeaux-Mérignac',
    elevationFt: 162,
    magVar: 0.9, // deg East (2026, approx.)
    transAlt: 5000,
  },
  weights: {
    // kg
    dow: 42_600,
    pax: 156,
    paxMass: 84 * 156,
    cargo: 1_850,
    zfw: 42_600 + 84 * 156 + 1_850, // 57_554
    zfwcg: 27.4, // %MAC
    blockFuel: 6_200,
    taxiFuel: 200,
    tripFuel: 2_300, // matches the FMGS prediction (0055, 319 NM)
    tow: 42_600 + 84 * 156 + 1_850 + 6_200 - 200,
  },
  /** Fuel distribution at block (kg): wing tanks full-ish first, then centre. */
  fuel: { leftOuter: 691, leftInner: 2_409, center: 0, rightInner: 2_409, rightOuter: 691 },
  takeoff: {
    // Computed for RWY 23 (3100 m), CONF 1+F, FLEX 58, dry, 19°C, QNH 1017
    conf: 1,
    flex: 58,
    v1: 142,
    vr: 144,
    v2: 148,
    thrRed: 1_660,
    acc: 1_660,
    engOutAcc: 1_660,
    thsFor: 1.0, // UP 1.0
  },
} as const;

export interface Weather {
  metar: string;
  atis: string;
  oatC: number;
  dewC: number;
  qnh: number;
  windDir: number;
  windKt: number;
  visM: number;
  /** Local time (Europe/Paris, CEST = UTC+2 on 27 Sep). */
  localHour: number;
  utcHour: number;
}

export function weatherFor(tod: TimeOfDay): Weather {
  switch (tod) {
    case 'dusk':
      return {
        metar: 'LFBD 271730Z AUTO 25006KT 9999 FEW040 16/10 Q1018 NOSIG',
        atis: "BORDEAUX INFORMATION KILO, 1730Z. RUNWAY IN USE 23. WIND 250 DEGREES 6 KNOTS. VISIBILITY 10 KM OR MORE. FEW 4000 FT. TEMPERATURE 16, DEW POINT 10. QNH 1018. TRANSITION LEVEL 60. ACKNOWLEDGE INFORMATION KILO ON FIRST CONTACT.",
        oatC: 16, dewC: 10, qnh: 1018, windDir: 250, windKt: 6, visM: 10000, localHour: 19.5, utcHour: 17.5,
      };
    case 'night':
      return {
        metar: 'LFBD 272100Z AUTO 22004KT CAVOK 12/09 Q1019 NOSIG',
        atis: "BORDEAUX INFORMATION MIKE, 2100Z. RUNWAY IN USE 23. WIND 220 DEGREES 4 KNOTS. CAVOK. TEMPERATURE 12, DEW POINT 9. QNH 1019. TRANSITION LEVEL 60. ACKNOWLEDGE INFORMATION MIKE ON FIRST CONTACT.",
        oatC: 12, dewC: 9, qnh: 1019, windDir: 220, windKt: 4, visM: 10000, localHour: 23.0, utcHour: 21.0,
      };
    default:
      return {
        metar: 'LFBD 271200Z 24008KT 9999 FEW030 SCT045 19/11 Q1017 NOSIG',
        atis: "BORDEAUX INFORMATION DELTA, 1200Z. RUNWAY IN USE 23. WIND 240 DEGREES 8 KNOTS. VISIBILITY 10 KM OR MORE. FEW 3000 FT, SCATTERED 4500 FT. TEMPERATURE 19, DEW POINT 11. QNH 1017. TRANSITION LEVEL 60. ACKNOWLEDGE INFORMATION DELTA ON FIRST CONTACT.",
        oatC: 19, dewC: 11, qnh: 1017, windDir: 240, windKt: 8, visM: 10000, localHour: 14.0, utcHour: 12.0,
      };
  }
}

/**
 * Environment + scenario variables (G: prefix). Owner: core (this file) / EFB / world.
 *   G:ENV_OAT (°C) G:ENV_QNH (hPa) G:ENV_WIND_DIR G:ENV_WIND_KT G:ENV_ELEV_FT
 *   G:TIME_UTC (seconds since 00:00Z, advanced by the core clock)
 *   G:AC_LAT G:AC_LON G:AC_HDG_TRUE G:AC_GS_KT G:AC_ON_GROUND  (world/pushback owns position updates)
 *   G:AC_GW_KG G:AC_CG_MAC G:AC_ZFW_KG
 *   G:GND_EXT_PWR (GPU connected & running) G:GND_CHOCKS G:GND_TOWBAR (tow bar / tug connected)
 *   G:GND_PUSHBACK (0 none, 1 pushing, 2 finished) G:GND_AIR_START_UNIT (HP ground air)
 *   G:DOOR_PAX_L1 .. G:DOOR_PAX_R2, G:DOOR_CARGO_FWD, G:DOOR_CARGO_AFT, G:DOOR_CARGO_BULK (0 closed .. 1 open)
 *   G:JETBRIDGE (0 retracted, 1 docked)
 */
export function applyScenario(sim: Sim, tod: TimeOfDay): void {
  const w = weatherFor(tod);
  sim.set('G:ENV_OAT', w.oatC);
  sim.set('G:ENV_DEW', w.dewC);
  sim.set('G:ENV_QNH', w.qnh);
  sim.set('G:ENV_WIND_DIR', w.windDir);
  sim.set('G:ENV_WIND_KT', w.windKt);
  sim.set('G:ENV_ELEV_FT', SCENARIO.airport.elevationFt);
  sim.set('G:TIME_UTC', w.utcHour * 3600);
  sim.set('G:AC_LAT', SCENARIO.stand.lat);
  sim.set('G:AC_LON', SCENARIO.stand.lon);
  sim.set('G:AC_HDG_TRUE', SCENARIO.stand.headingTrue);
  sim.set('G:AC_MAGVAR', SCENARIO.airport.magVar);
  sim.set('G:AC_GS_KT', 0);
  sim.set('G:AC_ON_GROUND', 1);
  const fob = SCENARIO.fuel.leftOuter + SCENARIO.fuel.leftInner + SCENARIO.fuel.center + SCENARIO.fuel.rightInner + SCENARIO.fuel.rightOuter;
  sim.set('G:AC_ZFW_KG', SCENARIO.weights.zfw);
  sim.set('G:AC_GW_KG', SCENARIO.weights.zfw + fob);
  sim.set('G:AC_CG_MAC', 27.9);
  // Ground: GPU connected and running, chocks in, jet bridge docked, L1 door open, cargo doors open.
  sim.set('G:GND_EXT_PWR', 1);
  sim.set('G:GND_CHOCKS', 1);
  sim.set('G:GND_TOWBAR', 0);
  sim.set('G:GND_PUSHBACK', 0);
  sim.set('G:GND_AIR_START_UNIT', 0);
  sim.set('G:JETBRIDGE', 1);
  sim.set('G:DOOR_PAX_L1', 1);
  sim.set('G:DOOR_PAX_L2', 0);
  sim.set('G:DOOR_PAX_R1', 0);
  sim.set('G:DOOR_PAX_R2', 0);
  sim.set('G:DOOR_CARGO_FWD', 1);
  sim.set('G:DOOR_CARGO_AFT', 1);
  sim.set('G:DOOR_CARGO_BULK', 0);
}

/** Core clock: advances UTC time. Registered by the app. */
export const clockSystem = {
  name: 'clock',
  order: 0,
  update(dt: number, sim: Sim) {
    sim.set('G:TIME_UTC', (sim.get('G:TIME_UTC') + dt) % 86400);
  },
};
