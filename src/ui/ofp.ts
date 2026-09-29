/**
 * EFB documents for flight SIM6205 LFBD→LFPO (owner: ui) — DOM-free text/data generation:
 * operational flight plan (with a navlog computed from the MCDU navigation database), loadsheet, take-off
 * performance and weather. Everything derives from SCENARIO (src/core/scenario.ts) so the EFB always matches
 * what the FMGS predicts (TRIP 2.3 t / 0055, 319 NM, TOW 63.6 t).
 */
import { SCENARIO, weatherFor, type Weather } from '../core/scenario';
import type { TimeOfDay } from '../core/settings';
import { bearingDeg, distanceNm } from '../core/fmgs-api';
import { navDb, toMag } from '../avionics/mcdu/navdb/navdb';

export type WeightUnit = 'kg' | 'lbs';
const LB = 2.20462;

/** Weight in the chosen unit, rounded (kg to the kg, lb to 10 lb). */
export function wt(kg: number, unit: WeightUnit): number {
  return unit === 'kg' ? Math.round(kg) : Math.round((kg * LB) / 10) * 10;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const lpad = (s: string | number, n: number) => String(s).padStart(n);
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(Math.round(min % 60)).padStart(2, '0')}`;
const clock = (utcMin: number) => hhmm(((Math.round(utcMin) % 1440) + 1440) % 1440);

/** Aircraft limits (A320-214, weight variant with MTOW 73.5 t). */
export const LIMITS = { mtow: 73_500, mlw: 64_500, mzfw: 61_000 };

/** Fuel plan (kg / min). Sums to the scenario block fuel. */
export const FUEL_PLAN = {
  trip: { kg: SCENARIO.weights.tripFuel, min: 55 },
  cont: { kg: 120, min: 3 },
  altn: { kg: 1_180, min: 21 },
  finres: { kg: 1_150, min: 30 },
  extra: { kg: 1_250, min: 32 },
  taxi: { kg: SCENARIO.weights.taxiFuel, min: 10 },
};

export interface Schedule {
  /** UTC minutes of the day. */
  std: number;
  etot: number;
  eta: number;
  sta: number;
  eetMin: number;
  date: string;
}

export function schedule(tod: TimeOfDay): Schedule {
  const w = weatherFor(tod);
  const start = w.utcHour * 60;
  const std = Math.ceil((start + 40) / 5) * 5;
  const etot = std + FUEL_PLAN.taxi.min;
  const eta = etot + FUEL_PLAN.trip.min;
  return { std, etot, eta, sta: eta + 5, eetMin: FUEL_PLAN.trip.min, date: '27SEP26' };
}

export interface NavlogRow {
  ident: string;
  via: string;
  mt: number | null;
  dist: number;
  cum: number;
  fl: string;
  timeMin: number;
  efobKg: number;
}

const ROUTE: Array<[string, string]> = [
  ['BD230', 'CNA6P'], ['BD923', 'CNA6P'], ['ROVFU', 'CNA6P'], ['CNA', 'CNA6P'],
  ['VERAC', 'B19'], ['POI', 'B19'], ['OMARI', 'B19'], ['AMB', 'B19'],
  ['DIBES', 'AMB9W'], ['CAD', 'AMB9W'], ['SOTIP', 'AMB9W'], ['ODILO', 'AMB9W'],
  ['VASOL', 'ILS25'], ['PO615', 'ILS25'], ['EMMAQ', 'ILS25'], ['MEDWY', 'ILS25'], ['VEKUH', 'ILS25'], ['FPO25', 'ILS25'],
];
const RW23 = { lat: 44.838694, lon: -0.701 };
const RW25 = { lat: 48.726383, lon: 2.396392 };

let navlogCache: NavlogRow[] | null = null;

/** Navlog from the MCDU navigation database (RW23 → … → RW25), with a simple climb/cruise/descent profile. */
export function navlog(): NavlogRow[] {
  if (navlogCache) return navlogCache;
  const db = navDb();
  const pts: Array<{ ident: string; via: string; lat: number; lon: number }> = [{ ident: 'LFBD', via: 'RW23', ...RW23 }];
  let prev = RW23;
  for (const [id, via] of ROUTE) {
    const f = db.fix(id, prev);
    if (!f) continue;
    pts.push({ ident: id, via, lat: f.lat, lon: f.lon });
    prev = f;
  }
  pts.push({ ident: 'LFPO', via: 'RW25', ...RW25 });
  const legs = pts.map((p, i) => {
    if (i === 0) return { d: 0, mt: null as number | null };
    const a = pts[i - 1];
    return { d: distanceNm(a.lat, a.lon, p.lat, p.lon), mt: Math.round(toMag(bearingDeg(a.lat, a.lon, p.lat, p.lon), a.lat, a.lon)) || 360 };
  });
  const total = legs.reduce((s, l) => s + l.d, 0);
  const TOC = 112, TOD = total - 118, CRZ = SCENARIO.flight.crzFl;
  // time and fuel along the profile (normalised to the trip time / fuel)
  const seg = (x0: number, x1: number) => {
    let t = 0, f = 0;
    const step = 0.5;
    for (let x = x0; x < x1; x += step) {
      const dx = Math.min(step, x1 - x);
      const phase = x < TOC ? 0 : x < TOD ? 1 : 2;
      const gs = [320, 470, 300][phase];
      const flowPerMin = [1.45, 1.0, 0.45][phase];
      const dt = (dx / gs) * 60;
      t += dt; f += dt * flowPerMin;
    }
    return { t, f };
  };
  const whole = seg(0, total);
  const kT = FUEL_PLAN.trip.min / whole.t, kF = FUEL_PLAN.trip.kg / whole.f;
  const tof = SCENARIO.weights.blockFuel - SCENARIO.weights.taxiFuel;
  let cum = 0;
  navlogCache = pts.map((p, i) => {
    cum += legs[i].d;
    const s = seg(0, cum);
    const alt = cum <= TOC ? (cum / TOC) * CRZ : cum >= TOD ? Math.max(0, ((total - cum) / (total - TOD)) * CRZ) : CRZ;
    const fl = i === 0 || i === pts.length - 1 ? '---' : Math.abs(alt - CRZ) < 1 ? String(CRZ) : lpad(Math.max(10, Math.round(alt / 10) * 10), 3).replace(/ /g, '0');
    return {
      ident: p.ident, via: p.via, mt: legs[i].mt, dist: legs[i].d, cum,
      fl, timeMin: s.t * kT, efobKg: tof - s.f * kF,
    };
  });
  return navlogCache;
}

export function ofpText(tod: TimeOfDay, unit: WeightUnit): string {
  const S = SCENARIO, f = S.flight, w = S.weights;
  const sch = schedule(tod);
  const U = unit === 'kg' ? 'KG' : 'LB';
  const L: string[] = [];
  const rule = '─'.repeat(66);
  L.push(`SIMAIR  OPERATIONAL FLIGHT PLAN                         PAGE 1/1`);
  L.push(rule);
  L.push(`${f.number}   ${sch.date}   ${f.from}-${f.to}   ${S.aircraft.type} ${S.aircraft.registration}   ${S.aircraft.engines}`);
  L.push(`STD ${clock(sch.std)}Z  ETOT ${clock(sch.etot)}Z  ETA ${clock(sch.eta)}Z  STA ${clock(sch.sta)}Z  EET ${hhmm(sch.eetMin)}`);
  L.push(`CRZ FL${f.crzFl}   CI ${f.costIndex}   AVG W/C M005   ISA DEV P04   AIR DIST ${f.distanceNm}NM`);
  L.push(`DEP ${f.from} RWY${f.depRunway} SID ${f.sid}         ARR ${f.to} RWY${f.arrRunway} STAR ${f.star}`);
  L.push(`APPR ${f.approach}   ALTN ${f.altn} (CO RTE ${f.altnCoRoute})`);
  L.push(`CO RTE ${f.coRoute}`);
  L.push(`ROUTE  ${f.route}`);
  L.push(rule);
  L.push(`FUEL (${U})             FUEL   TIME`);
  const fl = (name: string, kg: number, min?: number) => L.push(`${pad(name, 20)}${lpad(wt(kg, unit), 7)}   ${min !== undefined ? hhmm(min) : ''}`);
  const fp = FUEL_PLAN;
  const minTo = fp.trip.kg + fp.cont.kg + fp.altn.kg + fp.finres.kg;
  const minToT = fp.trip.min + fp.cont.min + fp.altn.min + fp.finres.min;
  fl('TRIP', fp.trip.kg, fp.trip.min);
  fl('CONT 5%', fp.cont.kg, fp.cont.min);
  fl(`ALTN ${f.altn}`, fp.altn.kg, fp.altn.min);
  fl('FINRES', fp.finres.kg, fp.finres.min);
  fl('MIN T/O FUEL', minTo, minToT);
  fl('EXTRA', fp.extra.kg, fp.extra.min);
  fl('T/O FUEL', minTo + fp.extra.kg, minToT + fp.extra.min);
  fl('TAXI', fp.taxi.kg, fp.taxi.min);
  fl('BLOCK FUEL', w.blockFuel);
  L.push(rule);
  const tow = w.zfw + w.blockFuel - w.taxiFuel;
  const lw = tow - w.tripFuel;
  L.push(`WEIGHTS (${U})            EST      MAX`);
  const wl = (name: string, kg: number, max?: number, extra = '') => L.push(`${pad(name, 20)}${lpad(wt(kg, unit), 7)}  ${max ? lpad(wt(max, unit), 7) : '       '}  ${extra}`);
  wl('DOW', w.dow);
  wl('PAYLOAD', w.paxMass + w.cargo, undefined, `PAX ${w.pax}  CARGO ${wt(w.cargo, unit)}`);
  wl('ZFW', w.zfw, LIMITS.mzfw);
  wl('TOW', tow, LIMITS.mtow);
  wl('LW', lw, LIMITS.mlw);
  L.push(rule);
  L.push(`NAVLOG`);
  L.push(`WPT     VIA      MT  DIST   CUM   FL   TIME  ETO    EFOB`);
  for (const r of navlog()) {
    L.push(`${pad(r.ident, 8)}${pad(r.via, 7)}${lpad(r.mt === null ? '---' : String(r.mt).padStart(3, '0'), 4)}${lpad(r.dist ? Math.round(r.dist) : '', 6)}${lpad(Math.round(r.cum), 6)}  ${lpad(r.fl, 3)}   ${hhmm(r.timeMin)}  ${clock(sch.etot + r.timeMin)}  ${lpad(wt(r.efobKg, unit), 6)}`);
  }
  L.push(rule);
  L.push(`ALTN ${f.altn}  CO RTE ${f.altnCoRoute}  FL100  DIST 52NM  ${wt(fp.altn.kg, unit)} ${U}  ${hhmm(fp.altn.min)}`);
  L.push(`ATC FPL: (FPL-SIM6205-IS -A320/M-SDE2E3FGHIJ1RWY/LB1 -LFBD${clock(sch.std)} -N0450F350 CNA6P CNA B19 AMB AMB9W -LFPO0055 LFPG)`);
  L.push(`DISPATCHER SIMAIR OCC            CAPTAIN SIGNATURE ..............`);
  return L.join('\n');
}

/** Loadsheet text (final once boarding and loading are complete, otherwise preliminary). */
export function loadsheetText(tod: TimeOfDay, unit: WeightUnit, final: boolean, paxOnBoard: number): string {
  const S = SCENARIO, w = S.weights;
  const sch = schedule(tod);
  const U = unit === 'kg' ? 'KILOS' : 'POUNDS';
  const tof = w.blockFuel - w.taxiFuel;
  const tow = w.zfw + tof;
  const lw = tow - w.tripFuel;
  const under = Math.min(LIMITS.mzfw - w.zfw, LIMITS.mtow - tow, LIMITS.mlw - lw);
  const lim = under === LIMITS.mlw - lw ? 'L' : under === LIMITS.mtow - tow ? 'T' : 'Z';
  const n = (kg: number) => lpad(wt(kg, unit), 6);
  const L: string[] = [];
  L.push(final ? 'LOADSHEET FINAL' : 'LOADSHEET PRELIMINARY — NOT FOR DEPARTURE');
  L.push(`ALL WEIGHTS IN ${U}                              EDNO ${final ? 2 : 1}`);
  L.push('');
  L.push('FROM/TO FLIGHT       A/C REG VERSION CREW  DATE    TIME');
  L.push(`${S.flight.from} ${S.flight.to} ${S.flight.number}/27 ${S.aircraft.registration.replace('-', '')}  Y174    2/4   ${sch.date} ${clock(sch.std - (final ? 16 : 45))}`);
  L.push('                        WEIGHT   DISTRIBUTION');
  const c1 = Math.round(w.cargo * 0.42), c3 = Math.round(w.cargo * 0.34), c4 = w.cargo - c1 - c3;
  L.push(`LOAD IN COMPARTMENTS    ${n(w.cargo)}   1/${wt(c1, unit)} 3/${wt(c3, unit)} 4/${wt(c4, unit)} 5/0`);
  L.push(`PASSENGER/CABIN BAG     ${n(w.paxMass)}   ${w.pax}/0/0  TTL ${w.pax}  CAB 0`);
  L.push(`                                 SOC 0/0  BLKD 0`);
  L.push(`TOTAL TRAFFIC LOAD      ${n(w.paxMass + w.cargo)}`);
  L.push(`DRY OPERATING WEIGHT    ${n(w.dow)}`);
  L.push(`ZERO FUEL WEIGHT ACTUAL ${n(w.zfw)}  MAX ${n(LIMITS.mzfw)}  ${lim === 'Z' ? 'L' : ' '}  ADJ`);
  L.push(`TAKE OFF FUEL           ${n(tof)}`);
  L.push(`TAKE OFF WEIGHT  ACTUAL ${n(tow)}  MAX ${n(LIMITS.mtow)}  ${lim === 'T' ? 'L' : ' '}  ADJ`);
  L.push(`TRIP FUEL               ${n(w.tripFuel)}`);
  L.push(`LANDING WEIGHT   ACTUAL ${n(lw)}  MAX ${n(LIMITS.mlw)}  ${lim === 'L' ? 'L' : ' '}  ADJ`);
  L.push('');
  L.push('BALANCE AND SEATING CONDITIONS          LAST MINUTE CHANGES');
  L.push('DOI  49.75   DLI  47.10                 DEST SPEC CL/CPT + - WEIGHT');
  L.push('LIZFW 52.49  LITOW 51.84  LILAW 51.95');
  L.push(`MACZFW ${w.zfwcg.toFixed(1)}  MACTOW 27.9  MACLAW 28.1`);
  L.push(`STAB TO ${S.takeoff.thsFor.toFixed(1)} UP   CONF 1+F`);
  L.push('SEATING CONDITIONS  0A/42  0B/60  0C/54');
  L.push(`UNDERLOAD BEFORE LMC  ${n(under)}          LMC TOTAL`);
  L.push('');
  L.push('LOADMESSAGE AND CAPTAINS INFORMATION BEFORE LMC');
  L.push(`TAXI FUEL ${wt(w.taxiFuel, unit)}   TAXI WEIGHT ${wt(tow + w.taxiFuel, unit)}   BLOCK FUEL ${wt(w.blockFuel, unit)}`);
  L.push(`PAX ON BOARD ${final ? w.pax : paxOnBoard}/${w.pax}   NOTOC: NIL`);
  L.push('PREPARED BY  LOAD CONTROL SIMAIR BOD');
  return L.join('\n');
}

export interface PerfTo {
  runway: string;
  tora: number;
  toda: number;
  asda: number;
  elevFt: number;
  rwyHdg: number;
  oat: number;
  qnh: number;
  wind: string;
  headwind: number;
  crosswind: number;
  tow: number;
  conf: string;
  flex: number;
  v1: number;
  vr: number;
  v2: number;
  ths: string;
  thrRed: number;
  acc: number;
  eoAcc: number;
  mtowRwy: number;
  cg: number;
}

export function perfTo(tod: TimeOfDay): PerfTo {
  const w: Weather = weatherFor(tod);
  const t = SCENARIO.takeoff;
  const rwyHdg = 225;
  const a = ((w.windDir - rwyHdg) * Math.PI) / 180;
  return {
    runway: `${SCENARIO.airport.icao} RWY ${SCENARIO.flight.depRunway}`,
    tora: 3100, toda: 3100, asda: 3100, elevFt: 151, rwyHdg,
    oat: w.oatC, qnh: w.qnh,
    wind: `${String(w.windDir).padStart(3, '0')}/${String(w.windKt).padStart(2, '0')}`,
    headwind: Math.round(w.windKt * Math.cos(a)),
    crosswind: Math.round(w.windKt * Math.sin(a)),
    tow: SCENARIO.weights.tow,
    conf: '1+F', flex: t.flex, v1: t.v1, vr: t.vr, v2: t.v2,
    ths: `${t.thsFor.toFixed(1)} UP`, thrRed: t.thrRed, acc: t.acc, eoAcc: t.engOutAcc,
    mtowRwy: 77_400, cg: 27.9,
  };
}

export interface WxDoc {
  station: string;
  name: string;
  role: string;
  metar: string;
  taf: string;
}

/** METAR / TAF for departure, destination and alternate at the selected time of day. */
export function weatherDocs(tod: TimeOfDay): { atis: string; docs: WxDoc[]; decoded: string[] } {
  const w = weatherFor(tod);
  const day = tod === 'day', dusk = tod === 'dusk';
  const issue = day ? '271100Z' : dusk ? '271700Z' : '272000Z';
  const valid = day ? '2712/2818' : dusk ? '2718/2824' : '2721/2803';
  const docs: WxDoc[] = [
    {
      station: 'LFBD', name: 'BORDEAUX MERIGNAC', role: 'DEP',
      metar: w.metar,
      taf: `TAF LFBD ${issue} ${valid} ${day ? '24010KT 9999 FEW030 SCT045 BECMG 2718/2720 VRB03KT' : '23006KT CAVOK BECMG 2800/2802 VRB02KT'} ${day ? 'TEMPO 2803/2808 4000 BR' : 'TEMPO 2803/2807 3000 BR'}`,
    },
    {
      station: 'LFPO', name: 'PARIS ORLY', role: 'DEST',
      metar: day ? 'LFPO 271200Z 23009KT 9999 FEW035 SCT048 18/10 Q1016 NOSIG' : dusk ? 'LFPO 271730Z 24006KT CAVOK 16/09 Q1017 NOSIG' : 'LFPO 272100Z 22004KT CAVOK 12/08 Q1018 NOSIG',
      taf: `TAF LFPO ${issue} ${valid} ${day ? '23010KT 9999 FEW035 SCT050 BECMG 2718/2720 22005KT' : '22006KT CAVOK BECMG 2800/2802 VRB03KT'}`,
    },
    {
      station: 'LFPG', name: 'PARIS CHARLES DE GAULLE', role: 'ALTN',
      metar: day ? 'LFPG 271200Z 22010KT 9999 SCT045 18/09 Q1016 NOSIG' : dusk ? 'LFPG 271730Z 23007KT CAVOK 16/08 Q1017 NOSIG' : 'LFPG 272100Z 21005KT CAVOK 12/08 Q1018 NOSIG',
      taf: `TAF LFPG ${issue} ${valid} ${day ? '22010KT 9999 SCT045 BECMG 2719/2721 21005KT' : '22007KT CAVOK BECMG 2800/2802 VRB03KT'}`,
    },
  ];
  const vis = w.visM >= 9999 ? '10 km ou plus' : `${w.visM} m`;
  const clouds = w.metar.includes('CAVOK') ? 'CAVOK (pas de nuage significatif)' : w.metar.match(/(FEW|SCT|BKN|OVC)\d{3}/g)?.map((c) => {
    const k = { FEW: 'quelques nuages', SCT: 'nuages épars', BKN: 'nuages fragmentés', OVC: 'couvert' }[c.slice(0, 3)] ?? c;
    return `${k} à ${Number(c.slice(3)) * 100} ft`;
  }).join(', ') ?? '';
  const decoded = [
    `Vent ${String(w.windDir).padStart(3, '0')}° / ${w.windKt} kt`,
    `Visibilité ${vis}`,
    clouds,
    `Température ${w.oatC} °C, point de rosée ${w.dewC} °C`,
    `QNH ${w.qnh} hPa`,
  ].filter(Boolean);
  return { atis: w.atis, docs, decoded };
}

/** "12:40Z" style. */
export function utcLabel(utcMin: number): string {
  const c = clock(utcMin);
  return `${c.slice(0, 2)}:${c.slice(2)}Z`;
}
