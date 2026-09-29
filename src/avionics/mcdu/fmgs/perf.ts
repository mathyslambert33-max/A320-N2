/**
 * A320-214 (CFM56-5B4/P) simplified performance model for FMGS predictions. DOM-free.
 *
 * Characteristic speeds (kt CAS, W in tonnes), FCOM rules of thumb:
 *   green dot  O = 2 W + 85 (below FL200, +1 kt / 1000 ft above)
 *   S (slat retraction) ~ 1.22 VS1g clean,  F (flap retraction) ~ 1.23-1.26 VS1g CONF 1+F/2
 *   VLS CONF FULL ~ 1.23 VS1g CONF FULL, VAPP = VLS + 5 (wind correction 1/3 headwind, 5..15 kt)
 * Climb / cruise / descent: parametric rate of climb, fuel flows and idle descent gradient tuned to give
 * realistic trip figures for a ~350 NM sector (≈ 2.3-2.5 t trip fuel, 55-60 min).
 */
import { isLeg, type FlightPlan, type FpLeg } from './flightplan';
import type { AltCstr } from '../navdb/types';

/* ------------------------------------------------------------------ atmosphere */

export function isaTemp(altFt: number): number {
  return altFt < 36089 ? 15 - 1.9812 * (altFt / 1000) : -56.5;
}

/** Speed of sound (kt) at temperature °C. */
const aKt = (tC: number) => 38.967854 * Math.sqrt(tC + 273.15);

function pressureRatio(altFt: number): number {
  if (altFt < 36089) return Math.pow(1 - 6.8755856e-6 * altFt, 5.2558797);
  return 0.2233609 * Math.exp(-4.806346e-5 * (altFt - 36089));
}

export function casToMach(cas: number, altFt: number): number {
  const d = pressureRatio(altFt);
  const qc = 101325 * (Math.pow(1 + 0.2 * (cas / 661.4786) ** 2, 3.5) - 1);
  return Math.sqrt(5 * (Math.pow(qc / (101325 * d) + 1, 1 / 3.5) - 1));
}

export function machToCas(m: number, altFt: number): number {
  const d = pressureRatio(altFt);
  const qc = 101325 * d * (Math.pow(1 + 0.2 * m * m, 3.5) - 1);
  return 661.4786 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 1 / 3.5) - 1));
}

export function tas(casOrMach: number, altFt: number, isaDev = 0): number {
  const m = casOrMach < 2 ? casOrMach : casToMach(casOrMach, altFt);
  return m * aKt(isaTemp(altFt) + isaDev);
}

/* ------------------------------------------------------------------ characteristic speeds */

export interface CharSpeeds { f: number; s: number; gd: number; vls: number; vapp: number }

export function greenDot(wKg: number, altFt = 0): number {
  const w = wKg / 1000;
  return Math.round(2 * w + 85 + Math.max(0, (altFt - 20000) / 1000));
}

export function charSpeeds(wKg: number, ldgConf: 3 | 4 = 4, headwindKt = 0): CharSpeeds {
  const w = wKg / 1000;
  const f = Math.round(70 + 1.28 * w);
  const s = Math.round(97 + 1.47 * w);
  const vlsFull = 122 + (w - 55) * (w > 55 ? 1.0 : 0.8);
  const vls = Math.round(ldgConf === 4 ? vlsFull : vlsFull + 6);
  const corr = Math.min(15, Math.max(5, Math.round(headwindKt / 3)));
  return { f, s, gd: greenDot(wKg), vls, vapp: vls + corr };
}

/** REC MAX FL (buffet 0.3 g / thrust limited) as a function of weight. */
export function recMaxFl(wKg: number): number {
  const w = wKg / 1000;
  const fl = w <= 60 ? 398 - (w - 50) * 1.3 : 385 - (w - 60) * 2.8;
  return Math.min(398, Math.floor(fl));
}

export function optFl(wKg: number): number {
  return Math.min(recMaxFl(wKg) - 20, 390);
}

/* ------------------------------------------------------------------ predictions */

export interface PredParams {
  crzFl: number;
  costIndex: number;
  towKg: number;
  /** Fuel at take-off (kg). */
  fobKg: number;
  /** Average trip wind component (kt, + tail wind). */
  windKt: number;
  isaDev?: number;
  transAlt: number;
  destTransFl: number;
  accAlt?: number;
}

export interface LegPred {
  timeMin: number;
  alt: number;
  /** kt CAS, or Mach if < 2. */
  spd: number;
  efob: number;
  dist: number;
  altMet?: boolean;
  spdMet?: boolean;
  phase: 'clb' | 'crz' | 'des';
}

export interface PseudoWpt {
  ident: '(T/C)' | '(T/D)' | '(LIM)' | '(DECEL)';
  dist: number;
  pred: LegPred;
}

export interface Predictions {
  legs: Map<FpLeg, LegPred>;
  pseudo: PseudoWpt[];
  tripFuel: number;
  tripTime: number;
  tripDist: number;
  tcDist: number;
  tdDist: number;
  destEfob: number;
  landingWeight: number;
  climbSpeed: number;
  climbMach: number;
  crzMach: number;
  desMach: number;
  desSpeed: number;
}

/** ECON speeds as a function of cost index (A320 CFM, typical). */
export function econSpeeds(ci: number) {
  const c = Math.max(0, Math.min(999, ci));
  const k = Math.min(1, c / 100);
  return {
    clb: Math.round(280 + 20 * k), clbMach: +(0.76 + 0.02 * k).toFixed(2),
    crzMach: +(0.76 + 0.03 * k).toFixed(2),
    des: Math.round(270 + 30 * k), desMach: +(0.76 + 0.03 * k).toFixed(2),
  };
}

function rocFpm(altFt: number, wKg: number): number {
  const w = wKg / 1000;
  const base = 2900 - 52 * (altFt / 1000);
  return Math.max(300, base * Math.pow(62 / w, 1.3));
}

function ffClimb(altFt: number, wKg: number) { return (6300 - 85 * (altFt / 1000)) * Math.sqrt(wKg / 62000); }
function ffCruise(altFt: number, wKg: number) { return 2380 * (wKg / 62000) * (1 + Math.max(0, 35000 - altFt) / 1000 * 0.019); }
const FF_IDLE = 720;
const TO_ALLOWANCE = 120;
const FF_APPR = 1450;

interface Cstr { d: number; c: AltCstr; seg: string }

/**
 * Compute vertical profile, times and fuel along the plan (origin -> destination runway).
 */
export function predict(plan: FlightPlan, p: PredParams): Predictions | undefined {
  const legs: FpLeg[] = [];
  const cum: number[] = [];
  let d = 0;
  for (const it of plan.items) {
    if (!isLeg(it)) continue;
    d += it.dist;
    legs.push(it);
    cum.push(d);
    if (it.seg === 'dest') break;
  }
  if (legs.length < 2 || !p.crzFl) return undefined;
  const D = d;
  const orig = legs[0];
  const dest = legs[legs.length - 1];
  const elevO = orig.elevFt ?? 0;
  const elevD = dest.elevFt ?? 0;
  const crz = p.crzFl * 100;
  const acc = p.accAlt ?? elevO + 1500;
  const econ = econSpeeds(p.costIndex);
  const isaDev = p.isaDev ?? 0;
  const STEP = 0.5;
  const N = Math.max(2, Math.ceil(D / STEP) + 1);
  const at = (i: number) => Math.min(D, i * STEP);

  // constraints
  const cstrs: Cstr[] = [];
  const spdCstr: { d: number; spd: number }[] = [];
  legs.forEach((l, i) => {
    if (l.alt) cstrs.push({ d: cum[i], c: l.alt, seg: l.seg });
    if (l.spd) spdCstr.push({ d: cum[i], spd: l.spd });
  });
  const isClimbCstr = (c: Cstr) => c.seg === 'orig' || c.seg === 'dep' || (c.seg === 'enr' && c.d < D / 2);

  /* ---- climb profile (forward, time based) */
  const clbAlt = new Float64Array(N).fill(crz);
  {
    let alt = elevO, dist = 0, w = p.towKg, idx = 0;
    const dt = 4 / 3600; // h
    clbAlt[0] = elevO;
    while (dist < D && alt < crz && idx < N - 1) {
      // altitude cap from climb constraints ahead
      let cap = crz;
      for (const c of cstrs) if (isClimbCstr(c) && c.d > dist + 0.01 && (c.c.type === 'below' || c.c.type === 'at')) cap = Math.min(cap, c.c.alt);
      const cas = alt < acc ? 165 : alt < 10000 ? 250 : econ.clb;
      const v = Math.min(tas(cas, alt, isaDev), tas(econ.clbMach, alt, isaDev)) + p.windKt;
      const target = Math.max(alt, Math.min(cap, crz));
      alt = Math.min(target, alt + rocFpm(alt, w) * dt * 60);
      dist += v * dt;
      w -= ffClimb(alt, w) * dt;
      while (idx < N - 1 && at(idx + 1) <= dist) { idx++; clbAlt[idx] = alt; }
    }
    for (let i = idx + 1; i < N; i++) clbAlt[i] = crz;
  }

  /* ---- descent profile (backward, geometric) */
  const desAlt = new Float64Array(N).fill(crz);
  let decelDist = D;
  {
    const destCstrs = cstrs.filter((c) => !isClimbCstr(c));
    // FAF = last arrival leg with an "at" constraint before the runway
    let fafIdx = -1;
    for (let i = legs.length - 2; i >= 0; i--) {
      const l = legs[i];
      if (l.seg !== 'arr') break;
      if (l.alt && (l.alt.type === 'at' || l.alt.type === 'above') && l.alt.alt <= elevD + 5000) { fafIdx = i; break; }
    }
    const fafD = fafIdx >= 0 ? cum[fafIdx] : D - Math.max(5, 3000 / 318);
    decelDist = Math.max(0, fafD - 6);
    let alt = elevD + 50;
    let limLevel = 0;
    let passedLim = false;
    desAlt[N - 1] = alt;
    for (let i = N - 2; i >= 0; i--) {
      const d0 = at(i), d1 = at(i + 1);
      const dd = d1 - d0;
      let grad: number;
      if (d0 >= fafD) grad = 318; // glide path
      else if (d0 >= decelDist) grad = 0; // level deceleration
      else if (!passedLim && alt >= 10000 && limLevel < 4) { grad = 0; limLevel += dd; if (limLevel >= 4) passedLim = true; }
      else grad = alt < 10000 ? 300 : 330;
      alt += grad * dd;
      for (const c of destCstrs) {
        if (c.d > d0 - 1e-6 && c.d <= d1 + 1e-6) {
          if (c.c.type === 'at') alt = c.c.alt;
          else if (c.c.type === 'below') alt = Math.min(alt, c.c.alt);
          else if (c.c.type === 'above') alt = Math.max(alt, c.c.alt);
        }
      }
      desAlt[i] = Math.min(alt, crz);
    }
  }

  /* ---- merged profile */
  const prof = new Float64Array(N);
  for (let i = 0; i < N; i++) prof[i] = Math.min(clbAlt[i], desAlt[i]);
  const peak = Math.max(...prof);
  let tcI = prof.findIndex((a) => a >= peak - 1);
  let tdI = tcI;
  for (let i = N - 1; i >= 0; i--) if (prof[i] >= peak - 1) { tdI = i; break; }
  if (tcI < 0) tcI = 0;

  /* ---- time / fuel integration */
  const pts: LegPred[] = new Array(N);
  // take-off allowance (brake release to 1500 ft, not flown by the step integration)
  let t = 0, fuel = TO_ALLOWANCE, w = p.towKg - TO_ALLOWANCE;
  let lastCas = 165;
  const spdLimAt = (dist: number) => {
    let lim = 999;
    // speed constraints apply to the leg before (descent) or after (climb) the fix; use a window of the next fix
    for (const s of spdCstr) if (s.d >= dist - 0.01 && s.d - dist < 15) lim = Math.min(lim, s.spd);
    return lim;
  };
  for (let i = 0; i < N; i++) {
    const dist = at(i);
    const alt = prof[i];
    const phase: LegPred['phase'] = i <= tcI && tcI !== tdI ? 'clb' : i < tdI ? 'crz' : i === tdI && tcI === tdI ? 'clb' : 'des';
    let spd: number;
    if (phase === 'clb') {
      const cas = alt < acc ? 165 : alt < 10000 ? 250 : econ.clb;
      const m = casToMach(cas, alt);
      spd = m > econ.clbMach ? econ.clbMach : Math.min(cas, spdLimAt(dist));
    } else if (phase === 'crz') {
      spd = alt >= 25000 ? econ.crzMach : Math.min(econ.des + 10, 300);
    } else {
      if (dist >= decelDist) {
        const gd = greenDot(w);
        spd = dist >= D - 4 ? charSpeeds(w).vapp : dist >= decelDist + 3 ? Math.min(gd, 180) : gd;
      } else {
        const cas = alt <= 10000 ? 250 : econ.des;
        const m = casToMach(cas, alt);
        spd = m > econ.desMach ? econ.desMach : Math.min(cas, spdLimAt(dist));
      }
    }
    pts[i] = { timeMin: t / 60, alt, spd, efob: p.fobKg - fuel, dist, phase };
    if (i === N - 1) break;
    const dd = at(i + 1) - dist;
    const v = Math.max(100, tas(spd, alt, isaDev) + p.windKt);
    const dtH = dd / v;
    t += dtH * 3600;
    const climbing = prof[i + 1] > alt + 1;
    const level = Math.abs(prof[i + 1] - alt) < 1;
    let ff: number;
    if (dist >= decelDist && phase === 'des') ff = FF_APPR;
    else if (climbing) ff = ffClimb(alt, w);
    else if (level) ff = ffCruise(alt, w);
    else ff = FF_IDLE;
    const df = ff * dtH;
    fuel += df;
    w -= df;
    lastCas = spd;
  }
  void lastCas;

  const sample = (dist: number): LegPred => {
    const i = Math.min(N - 1, Math.max(0, Math.round(dist / STEP)));
    return { ...pts[i], dist };
  };

  const out = new Map<FpLeg, LegPred>();
  legs.forEach((l, i) => {
    const pr = sample(cum[i]);
    if (i === legs.length - 1) pr.alt = elevD;
    if (i === 0) { pr.alt = elevO; pr.timeMin = 0; }
    if (l.alt) {
      const a = pr.alt;
      const c = l.alt;
      pr.altMet = c.type === 'at' ? Math.abs(a - c.alt) < 250 : c.type === 'above' ? a >= c.alt - 100 : c.type === 'below' ? a <= c.alt + 100 : a <= c.alt + 100 && a >= (c.alt2 ?? 0) - 100;
    }
    if (l.spd) pr.spdMet = (pr.spd < 2 ? 999 : pr.spd) <= l.spd + 1;
    out.set(l, pr);
  });

  const pseudo: PseudoWpt[] = [];
  const tcD = at(tcI), tdD = at(tdI);
  pseudo.push({ ident: '(T/C)', dist: tcD, pred: sample(tcD) });
  // climb speed limit (FL100)
  const limC = prof.findIndex((a) => a >= 10000);
  if (limC > 0 && limC < tcI) pseudo.push({ ident: '(LIM)', dist: at(limC), pred: sample(at(limC)) });
  pseudo.push({ ident: '(T/D)', dist: tdD, pred: sample(tdD) });
  let limD = -1;
  for (let i = tdI; i < N; i++) if (prof[i] <= 10000) { limD = i; break; }
  if (limD > 0 && at(limD) < decelDist) pseudo.push({ ident: '(LIM)', dist: at(limD), pred: sample(at(limD)) });
  if (decelDist > tdD) pseudo.push({ ident: '(DECEL)', dist: decelDist, pred: sample(decelDist) });
  pseudo.sort((a, b) => a.dist - b.dist);

  const last = pts[N - 1];
  return {
    legs: out, pseudo,
    tripFuel: fuel, tripTime: t / 60, tripDist: D, tcDist: tcD, tdDist: tdD,
    destEfob: last.efob, landingWeight: p.towKg - fuel,
    climbSpeed: econ.clb, climbMach: econ.clbMach, crzMach: econ.crzMach, desMach: econ.desMach, desSpeed: econ.des,
  };
}

/** Alternate fuel/time for a given distance from the destination (go-around, climb FL100-FL200, approach). */
export function altnFuel(distNm: number, lwKg: number): { fuel: number; time: number } {
  const w = lwKg / 62000;
  const fuel = (380 + distNm * 5.2) * w + 180;
  const time = 8 + distNm / 4.2;
  return { fuel, time };
}

/** Final reserve: 30 min holding at 1500 ft above the alternate. */
export function finalFuel(wKg: number, minutes = 30): number {
  return 2250 * (wKg / 62000) * (minutes / 60);
}
