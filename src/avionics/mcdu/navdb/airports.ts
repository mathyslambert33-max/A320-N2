/**
 * Airports, runways and terminal procedures — hand-coded from the French eAIP (AIRAC 2026-09):
 *  - AD 2 LFBD: AD 2.12 runways, AD 2.19 aids, DATA 01/02 (fixes), DATA SID RWY05/RWY23 RNAV CODE 01,
 *    SID RWY23 RNAV (chart + INSTR 01: CNA 6P / ROYAN 6P / OBLOC 6P / VAVIX 6P, initial clearance FL070).
 *  - AD 2 LFPO: AD 2.12, AD 2.19, DATA 01..04, DATA STAR RWY25 RNAV CODE 01/02, STAR RWY06 RNAV CODE 02,
 *    DATA RWY25/24/06 FNA ILS CAT123 LOC CODE, DATA RWY25/24/06 INA RNAV CODE GNSS, IAC RWY25 FNA ILS.
 *  - AD 2 LFPG: AD 2.12, AD 2.19.
 * Altitudes in feet (FL110 = 11000). Courses magnetic.
 * Simplifications (documented in docs/vars/mcdu.md): FM (vectoring) legs of the Orly initial approaches are
 * replaced either by the published radio-failure continuation (DF EMMAQ/MEDWY for RWY 25) or by a
 * F-PLN DISCONTINUITY; holdings are not coded.
 */
import type { AltCstr, DbAirport, DbCoRoute, DbProcedure, ProcLeg } from './types';

const at = (alt: number): AltCstr => ({ type: 'at', alt });
const blw = (alt: number): AltCstr => ({ type: 'below', alt });
const abv = (alt: number): AltCstr => ({ type: 'above', alt });

const IF = (fix: string, o: Partial<ProcLeg> = {}): ProcLeg => ({ t: 'IF', fix, ...o });
const TF = (fix: string, o: Partial<ProcLeg> = {}): ProcLeg => ({ t: 'TF', fix, ...o });
const DF = (fix: string, o: Partial<ProcLeg> = {}): ProcLeg => ({ t: 'DF', fix, ...o });
const CF = (fix: string, crs: number, o: Partial<ProcLeg> = {}): ProcLeg => ({ t: 'CF', fix, crs, ...o });
const CA = (crs: number, alt: number): ProcLeg => ({ t: 'CA', crs, alt: abv(alt) });

/* ------------------------------------------------------------------ LFBD */

const sid = (ident: string, name: string, runways: string[], legs: ProcLeg[]): DbProcedure => ({ ident, name, runways, legs, trans: [], rnav: true });

const LFBD_SIDS: DbProcedure[] = [
  // RWY 23 (GNSS only). "Climb to BD230 on course 225°, then turn right direct to BD923..."
  sid('CNA6P', 'CNA 6P', ['23'], [CF('BD230', 225, { ovfy: true }), DF('BD923', { turn: 'R' }), TF('ROVFU'), TF('CNA')]),
  sid('OBLOC6P', 'OBLOC 6P', ['23'], [CF('BD423', 225, { ovfy: true, spd: 220 }), CF('BD427', 126, { alt: abv(5000), turn: 'L' }), TF('OBLOC')]),
  sid('ROYAN6P', 'ROYAN 6P', ['23'], [CF('BD230', 225, { ovfy: true }), DF('BD923', { turn: 'R' }), TF('BD927'), TF('ROYAN')]),
  sid('VAVIX6P', 'VAVIX 6P', ['23'], [CF('BD423', 225, { ovfy: true }), DF('BD425', { turn: 'L' }), TF('VAVIX')]),
  // RWY 05
  sid('CNA6Q', 'CNA 6Q', ['05'], [CF('BD905', 45), TF('BD955'), TF('ROVFU'), TF('CNA')]),
  sid('OBLOC6Q', 'OBLOC 6Q', ['05'], [CF('BD905', 45), TF('BD961', { turn: 'R' }), TF('BD963'), TF('OBLOC')]),
  sid('ROYAN6Q', 'ROYAN 6Q', ['05'], [CF('BD905', 45), TF('BD955'), TF('ROYAN')]),
  sid('VAVIX6Q', 'VAVIX 6Q', ['05'], [CF('BD905', 45), TF('BD961', { turn: 'R' }), TF('VAVIX')]),
];

const LFBD: DbAirport = {
  icao: 'LFBD', name: 'BORDEAUX MERIGNAC',
  lat: 44.828611, lon: -0.715278, elevFt: 166, transAlt: 5000, transFl: 60,
  runways: [
    { ident: '05', lat: 44.819103, lon: -0.728983, magCrs: 45, trueCrs: 45.46, lengthM: 3100, elevFt: 160 },
    { ident: '11', lat: 44.831567, lon: -0.729242, magCrs: 106, trueCrs: 106.5, lengthM: 2415, elevFt: 153 },
    { ident: '23', lat: 44.838694, lon: -0.701, magCrs: 225, trueCrs: 225.48, lengthM: 3100, elevFt: 151, ils: 'BD', gsAngle: 3.0, tchFt: 60 },
    { ident: '29', lat: 44.825411, lon: -0.6999, magCrs: 286, trueCrs: 286.5, lengthM: 2415, elevFt: 160, ils: 'BEI', gsAngle: 3.0, tchFt: 54 },
  ],
  sids: LFBD_SIDS,
  stars: [],
  approaches: [
    { ident: 'ILS23', runway: '23', type: 'ILS', ils: 'BD', vias: [], legs: [IF('IBD23'), TF('FBD23')], missed: [] },
    { ident: 'ILS29', runway: '29', type: 'ILS', ils: 'BEI', vias: [], legs: [IF('IBD29'), TF('FBD29')], missed: [] },
  ],
};

/* ------------------------------------------------------------------ LFPO */

const star = (ident: string, name: string, runways: string[], legs: ProcLeg[]): DbProcedure => ({ ident, name, runways, legs, trans: [], rnav: true });
const W = ['20', '24', '25'];
const E = ['02', '06', '07'];
// Common endings (RWY 20-24-25: ODILO FL110 / RWY 02-06-07: SOTIP FL120 250 kt, ODILO FL100)
const toOdiloW = (): ProcLeg[] => [TF('CAD', { alt: at(13000) }), TF('SOTIP', { alt: blw(13000) }), TF('ODILO', { alt: at(11000) })];
const toOdiloE = (): ProcLeg[] => [TF('CAD', { alt: at(13000) }), TF('SOTIP', { alt: blw(12000), spd: 250 }), TF('ODILO', { alt: at(10000) })];
const toMolba = (): ProcLeg[] => [TF('OKRIX', { alt: blw(18000), spd: 280 }), TF('EBOMA', { alt: blw(12000), spd: 250 }), TF('MOLBA', { alt: at(10000) })];
const toVebek = (): ProcLeg[] => [TF('GIMER'), TF('VEBEK', { alt: at(11000), spd: 250 })];

const LFPO_STARS: DbProcedure[] = [
  star('AMB9W', 'AMB 9W', W, [IF('AMB', { alt: blw(26000), spd: 280 }), TF('DIBES'), ...toOdiloW()]),
  star('BOBSA9W', 'BOBSA 9W', W, [IF('BOBSA'), TF('BENAR', { alt: at(13000), spd: 280 }), ...toOdiloW()]),
  star('CAD9W', 'CAD 9W', W, [IF('CAD', { alt: at(13000), spd: 280 }), TF('SOTIP', { alt: blw(13000) }), TF('ODILO', { alt: at(11000) })]),
  star('LUMAN9W', 'LUMAN 9W', W, [IF('LUMAN', { spd: 280 }), ...toOdiloW()]),
  star('MATIX9W', 'MATIX 9W', W, [IF('MATIX'), TF('GITAN', { alt: at(14000), spd: 280 }), ...toVebek()]),
  star('MOPIL9W', 'MOPIL 9W', W, [IF('MOPIL', { alt: blw(26000) }), TF('SOTUS', { alt: blw(14000), spd: 280 }), ...toVebek()]),
  star('MOU9W', 'MOU 9W', W, [IF('MOU'), TF('AVLON'), ...toMolba()]),
  star('NIMER9W', 'NIMER 9W', W, [IF('NIMER'), TF('SOMED', { alt: blw(26000), spd: 280 }), TF('DIBES'), ...toOdiloW()]),
  star('RENSA9W', 'RENSA 9W', W, [IF('RENSA'), TF('SOTUS', { alt: blw(14000), spd: 280 }), ...toVebek()]),
  star('AMB9E', 'AMB 9E', E, [IF('AMB', { alt: blw(24000), spd: 280 }), TF('DIBES'), ...toOdiloE()]),
  star('BOBSA9E', 'BOBSA 9E', E, [IF('BOBSA'), TF('BENAR', { alt: at(13000), spd: 280 }), ...toOdiloE()]),
  star('CAD9E', 'CAD 9E', E, [IF('CAD', { alt: at(13000) }), TF('SOTIP', { alt: blw(12000), spd: 250 }), TF('ODILO', { alt: at(10000) })]),
  star('LUMAN9E', 'LUMAN 9E', E, [IF('LUMAN', { spd: 280 }), ...toOdiloE()]),
  star('MOU9E', 'MOU 9E', E, [IF('MOU'), TF('AVLON'), ...toMolba()]),
  star('NIMER9E', 'NIMER 9E', E, [IF('NIMER'), TF('SOMED', { alt: blw(24000), spd: 280 }), TF('DIBES'), ...toOdiloE()]),
];

// Missed approaches (FNA ILS CAT123 LOC codings)
const MISSED_25: ProcLeg[] = [CA(254, 700), DF('PO432', { alt: blw(2000), turn: 'L' }), TF('MLN', { alt: blw(4000), turn: 'L' }), TF('MOLBA', { alt: at(7000), spd: 230, ovfy: true })];
const MISSED_24: ProcLeg[] = [DF('PO431', { alt: blw(2000), ovfy: true }), DF('MLN', { alt: blw(4000), turn: 'L' }), TF('MOLBA', { alt: at(7000), spd: 230, ovfy: true })];
const MISSED_06: ProcLeg[] = [DF('PO411', { alt: blw(2000) }), TF('PO412', { alt: at(2000), turn: 'R' }), TF('MLN', { alt: blw(4000) }), TF('MOLBA', { alt: at(7000), spd: 230, ovfy: true })];

const LFPO: DbAirport = {
  icao: 'LFPO', name: 'PARIS ORLY',
  lat: 48.723333, lon: 2.379444, elevFt: 291, transAlt: 5000, transFl: 60,
  runways: [
    { ident: '02', lat: 48.717542, lon: 2.376697, magCrs: 17, trueCrs: 18.35, lengthM: 2400, elevFt: 287, ils: 'OLN', gsAngle: 3.0, tchFt: 50 },
    { ident: '06', lat: 48.721247, lon: 2.320514, startLat: 48.719975, startLon: 2.316919, magCrs: 61, trueCrs: 61.85, lengthM: 3650, elevFt: 283, ils: 'ORE', gsAngle: 3.0, tchFt: 57 },
    { ident: '07', lat: 48.719408, lon: 2.358592, magCrs: 73, trueCrs: 74.4, lengthM: 3320, elevFt: 277, ils: 'OLE', gsAngle: 3.0, tchFt: 53 },
    { ident: '20', lat: 48.738022, lon: 2.386969, magCrs: 197, trueCrs: 198.35, lengthM: 2400, elevFt: 288 },
    { ident: '24', lat: 48.735456, lon: 2.360678, magCrs: 241, trueCrs: 241.85, lengthM: 3650, elevFt: 285, ils: 'OLO', gsAngle: 3.0, tchFt: 53 },
    { ident: '25', lat: 48.726383, lon: 2.396392, startLat: 48.727431, startLon: 2.402069, magCrs: 253, trueCrs: 254.4, lengthM: 3320, elevFt: 288, ils: 'OLW', gsAngle: 3.0, tchFt: 54 },
  ],
  sids: [],
  stars: LFPO_STARS,
  approaches: [
    {
      ident: 'ILS06', runway: '06', type: 'ILS', ils: 'ORE',
      vias: [
        { ident: 'MOLBA', legs: [IF('MOLBA', { alt: at(10000), spd: 250 }), TF('MLN'), TF('PO621', { disco: true })] },
        { ident: 'ODILO', legs: [IF('ODILO', { alt: abv(10000), spd: 250 }), TF('PO609', { alt: abv(10000) }), TF('PO611')] },
        { ident: 'VEBEK', legs: [IF('VEBEK', { alt: at(11000), spd: 250 }), TF('CTL'), TF('VALPO'), TF('MLN'), TF('PO621', { disco: true })] },
      ],
      legs: [IF('IPO06', { alt: abv(4000) }), TF('FPO06')],
      missed: MISSED_06,
    },
    { ident: 'ILS07', runway: '07', type: 'ILS', ils: 'OLE', vias: [], legs: [IF('IPO07'), TF('FPO07')], missed: [] },
    {
      ident: 'ILS24', runway: '24', type: 'ILS', ils: 'OLO',
      vias: [
        { ident: 'MOLBA', legs: [IF('MOLBA', { alt: at(10000), spd: 250 }), TF('MLN'), TF('PO610', { disco: true })] },
        { ident: 'ODILO', legs: [IF('ODILO', { alt: at(11000), spd: 280 }), TF('VASOL', { alt: at(11000) }), TF('PO615', { alt: at(11000), disco: true })] },
        { ident: 'VEBEK', legs: [IF('VEBEK', { alt: at(11000), spd: 250 }), TF('CTL'), TF('VALPO', { disco: true })] },
      ],
      legs: [IF('IPO24', { alt: abv(3000) }), TF('FPO24', { alt: at(3000) })],
      missed: MISSED_24,
    },
    {
      ident: 'ILS25', runway: '25', type: 'ILS', ils: 'OLW',
      vias: [
        { ident: 'MOLBA', legs: [IF('MOLBA', { alt: at(10000), spd: 250 }), TF('MLN'), TF('PO610'), DF('EMMAQ'), TF('MEDWY')] },
        { ident: 'ODILO', legs: [IF('ODILO', { alt: at(11000), spd: 280 }), TF('VASOL', { alt: at(11000) }), TF('PO615', { alt: at(11000) }), DF('EMMAQ'), TF('MEDWY')] },
        { ident: 'VEBEK', legs: [IF('VEBEK', { alt: at(11000), spd: 250 }), TF('CTL'), TF('VALPO'), DF('MEDWY')] },
      ],
      legs: [IF('VEKUH', { alt: abv(3000) }), TF('FPO25', { alt: at(3000) })],
      missed: MISSED_25,
    },
  ],
};

/* ------------------------------------------------------------------ LFPG (alternate) */

const pgApp = (rwy: string, ils: string) => ({ ident: `ILS${rwy}`, runway: rwy, type: 'ILS' as const, ils, vias: [], legs: [], missed: [] });

const LFPG: DbAirport = {
  icao: 'LFPG', name: 'PARIS CHARLES DE GAULLE',
  lat: 49.009722, lon: 2.547778, elevFt: 392, transAlt: 5000, transFl: 60,
  runways: [
    { ident: '08L', lat: 48.995686, lon: 2.552744, magCrs: 84, trueCrs: 85.34, lengthM: 4142, elevFt: 338, ils: 'GLE', gsAngle: 3.0, tchFt: 57 },
    { ident: '08R', lat: 48.992914, lon: 2.565661, magCrs: 84, trueCrs: 85.35, lengthM: 2700, elevFt: 337, ils: 'DSE', gsAngle: 3.0, tchFt: 54 },
    { ident: '09L', lat: 49.02472, lon: 2.524895, magCrs: 84, trueCrs: 85.32, lengthM: 2700, elevFt: 378, ils: 'PNE', gsAngle: 3.0, tchFt: 54 },
    { ident: '09R', lat: 49.020617, lon: 2.513058, magCrs: 84, trueCrs: 85.31, lengthM: 4200, elevFt: 371, ils: 'CGE', gsAngle: 3.0, tchFt: 54 },
    { ident: '26L', lat: 48.994877, lon: 2.602436, magCrs: 264, trueCrs: 265.37, lengthM: 2700, elevFt: 317, ils: 'DSU', gsAngle: 3.0, tchFt: 57 },
    { ident: '26R', lat: 48.998319, lon: 2.602011, startLat: 48.9987, startLon: 2.609164, magCrs: 264, trueCrs: 265.38, lengthM: 4142, elevFt: 318, ils: 'GAU', gsAngle: 3.0, tchFt: 50 },
    { ident: '27L', lat: 49.023253, lon: 2.562117, startLat: 49.023692, startLon: 2.570294, magCrs: 264, trueCrs: 265.35, lengthM: 4200, elevFt: 388, ils: 'CGW', gsAngle: 3.0, tchFt: 56 },
    { ident: '27R', lat: 49.026695, lon: 2.561692, magCrs: 264, trueCrs: 265.35, lengthM: 2700, elevFt: 391, ils: 'PNW', gsAngle: 3.0, tchFt: 54 },
  ],
  sids: [],
  stars: [],
  approaches: [pgApp('08L', 'GLE'), pgApp('08R', 'DSE'), pgApp('09L', 'PNE'), pgApp('09R', 'CGE'), pgApp('26L', 'DSU'), pgApp('26R', 'GAU'), pgApp('27L', 'CGW'), pgApp('27R', 'PNW')],
};

export const AIRPORTS: DbAirport[] = [LFBD, LFPO, LFPG];

/**
 * Company routes (airline navigation database). LFBDLFPO1 is the recommended route of the scenario:
 * LFBD/23 CNA6P CNA B19 AMB AMB9W ODILO — ILS 25 via ODILO — LFPO, ALTN LFPG.
 */
export const CO_ROUTES: DbCoRoute[] = [
  {
    ident: 'LFBDLFPO1', from: 'LFBD', to: 'LFPO', altn: 'LFPG', altnCoRoute: 'LFPOLFPG1', costIndex: 25, crzFl: 350,
    depRwy: '23', sid: 'CNA6P', route: [{ via: 'B19', to: 'AMB' }], star: 'AMB9W', approach: 'ILS25', appVia: 'ODILO',
  },
  {
    ident: 'LFBDLFPO2', from: 'LFBD', to: 'LFPO', altn: 'LFPG', altnCoRoute: 'LFPOLFPG1', costIndex: 25, crzFl: 350,
    depRwy: '05', sid: 'CNA6Q', route: [{ via: 'B19', to: 'AMB' }], star: 'AMB9W', approach: 'ILS25', appVia: 'ODILO',
  },
  { ident: 'LFPOLFPG1', from: 'LFPO', to: 'LFPG', costIndex: 25, crzFl: 100, route: [], approach: 'ILS27R' },
];
