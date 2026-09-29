/**
 * FMGS (dual FMGC in sync): flight plans, weights, performance data, radio autotuning, flight phase,
 * published variables and the FmgsApi service for the ND. DOM-free.
 */
import type { Sim } from '../../../core/sim';
import { bearingDeg, distanceNm, type FlightPlanItem, type FmgsApi, type NavPoint } from '../../../core/fmgs-api';
import { navDb, toMag, type NavDb, type NavFix } from '../navdb/navdb';
import type { DbAirport, DbNavaid } from '../navdb/types';
import { FlightPlan, isLeg, type FpLeg } from './flightplan';
import { altnFuel, charSpeeds, finalFuel, isaTemp, predict, type Predictions } from './perf';
import { MSG, type McduMessage } from '../mcdu/format';

export interface Tuned {
  ident?: string;
  freq: number;
  navaid?: DbNavaid;
  manual: boolean;
}

/** Seconds of FMGC power-up test before the FMGC answers on the MCDU. */
export const FMGC_INIT_S = 20;

const ceil10 = (v: number) => Math.ceil(v / 10) * 10;

export class Fmgs implements FmgsApi {
  readonly db: NavDb = navDb();
  readonly sim: Sim;

  /* power */
  fmgc1 = false;
  fmgc2 = false;
  ready = false;
  private initT = 0;
  private offT = 0;

  /* flight plans */
  active?: FlightPlan;
  tmpy?: FlightPlan;
  sec?: FlightPlan;

  /* INIT A */
  coRoute?: string;
  altnCoRoute?: string;
  flightNo?: string;
  ci?: number;
  crzFl?: number;
  crzTemp?: number;
  tropo = 36090;
  tropoPilot = false;
  gndTemp?: number;
  /** Position shown on INIT A (origin reference point or crew modified). */
  initPos?: { lat: number; lon: number };
  irsAlignSent = false;

  /* INIT B / fuel */
  zfw?: number;
  zfwcg?: number;
  block?: number;
  taxi = 200;
  taxiPilot = false;
  rsvPct = 5.0;
  rsvKgPilot?: number;
  finalTime = 30;
  finalKgPilot?: number;
  altnKgPilot?: number;
  tripWind = 0;
  tripWindPilot = false;
  minDestFobPilot?: number;
  fuelPlanning: 'idle' | 'computing' | 'done' = 'idle';
  private fuelPlanT = 0;

  /* PERF TAKE OFF */
  v1?: number;
  vr?: number;
  v2?: number;
  toTransAlt?: number;
  thrRed?: number;
  acc?: number;
  eoAcc?: number;
  toFlaps?: number;
  toThs?: number;
  flex?: number;
  toShift?: number;

  /* PERF CLB / CRZ / DES / APPR / GO AROUND */
  clbPresel?: number;
  crzPresel?: number;
  desCabinRate = -350;
  qnh?: number;
  destTemp?: number;
  magWind?: { dir: number; spd: number };
  destTransFl?: number;
  mda?: number;
  dh?: number | 'NO';
  ldgConf: 3 | 4 = 4;
  vappPilot?: number;
  gaThrRed?: number;
  gaAcc?: number;
  gaEoAcc?: number;

  /* RAD NAV (manual tuning) */
  vor1Man?: Tuned;
  vor2Man?: Tuned;
  vor1Crs?: number;
  vor2Crs?: number;
  ilsMan?: Tuned;
  ilsCrsMan?: number;
  adf1Man?: Tuned;
  adf2Man?: Tuned;
  /** Autotuned values (computed). */
  auto: { vor1?: Tuned; vor2?: Tuned; ils?: Tuned; ilsCrs?: number } = {};

  /* phase / predictions */
  flightPhase = 0;
  preds?: Predictions;
  private predT = 0;
  private dirty = true;

  /* messages (type II) shared by both MCDUs */
  messages: McduMessage[] = [];
  private gpsPrimaryShown = false;
  private gpsPrimaryT = 0;
  private initWeightShown = false;

  constructor(sim: Sim) {
    this.sim = sim;
  }

  /* ================================================================== messages */

  pushMessage(m: McduMessage): void {
    if (!this.messages.some((x) => x.text === m.text)) this.messages.push(m);
  }

  removeMessage(m: McduMessage | string): void {
    const t = typeof m === 'string' ? m : m.text;
    this.messages = this.messages.filter((x) => x.text !== t);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /* ================================================================== power / reset */

  private busPowered(name: string, fallback: string): boolean {
    return this.sim.has(name) ? this.sim.getB(name) : this.sim.getB(fallback);
  }

  /** Dev / tests: complete the FMGC power-up test immediately. */
  skipInit(): void {
    this.initT = FMGC_INIT_S;
    this.ready = true;
  }

  reset(): void {
    this.active = this.tmpy = this.sec = undefined;
    this.coRoute = this.altnCoRoute = this.flightNo = undefined;
    this.ci = this.crzFl = this.crzTemp = this.gndTemp = undefined;
    this.tropo = 36090; this.tropoPilot = false;
    this.initPos = undefined; this.irsAlignSent = false;
    this.zfw = this.zfwcg = this.block = undefined;
    this.taxi = 200; this.taxiPilot = false; this.rsvPct = 5; this.rsvKgPilot = undefined; this.finalTime = 30;
    this.finalKgPilot = this.altnKgPilot = undefined; this.tripWind = 0; this.tripWindPilot = false; this.fuelPlanning = 'idle'; this.minDestFobPilot = undefined;
    this.v1 = this.vr = this.v2 = this.toTransAlt = this.thrRed = this.acc = this.eoAcc = undefined;
    this.toFlaps = this.toThs = this.flex = this.toShift = undefined;
    this.clbPresel = this.crzPresel = undefined;
    this.qnh = this.destTemp = this.magWind = this.destTransFl = this.mda = this.dh = this.vappPilot = undefined;
    this.ldgConf = 4;
    this.vor1Man = this.vor2Man = this.ilsMan = this.adf1Man = this.adf2Man = undefined;
    this.vor1Crs = this.vor2Crs = this.ilsCrsMan = undefined;
    this.flightPhase = 0; this.preds = undefined; this.messages = [];
    this.gpsPrimaryShown = false; this.initWeightShown = false;
    this.dirty = true;
  }

  /* ================================================================== aircraft state helpers */

  position(): { lat: number; lon: number } {
    const aligned = [1, 2, 3].some((n) => this.sim.getB(`S:ADIRS_IR${n}_ALIGNED`));
    if (aligned && this.sim.has('S:ADIRS_LAT') && this.sim.get('S:ADIRS_LAT') !== 0) return { lat: this.sim.get('S:ADIRS_LAT'), lon: this.sim.get('S:ADIRS_LON') };
    return { lat: this.sim.get('G:AC_LAT'), lon: this.sim.get('G:AC_LON') };
  }

  /** True when at least one IR is aligned (FM position valid). */
  positionValid(): boolean {
    return [1, 2, 3].some((n) => this.sim.getB(`S:ADIRS_IR${n}_ALIGNED`) || this.sim.get(`S:ADIRS_IR${n}_STATE`) === 2);
  }

  irsAligning(): boolean {
    return [1, 2, 3].some((n) => this.sim.get(`S:ADIRS_IR${n}_STATE`) === 1);
  }

  onGround(): boolean {
    return this.sim.has('G:AC_ON_GROUND') ? this.sim.getB('G:AC_ON_GROUND') : true;
  }

  enginesRunning(): boolean {
    return this.sim.getB('S:ENG1_RUNNING') || this.sim.getB('S:ENG2_RUNNING');
  }

  /** Fuel on board used by the FMGS (block before engine start, FQI afterwards). */
  fob(): number | undefined {
    const fqi = this.sim.get('S:FUEL_FOB_KG');
    if (this.enginesRunning() && fqi > 0) return fqi;
    return this.block ?? (fqi > 0 ? fqi : undefined);
  }

  tow(): number | undefined {
    if (this.zfw === undefined || this.block === undefined) return undefined;
    return this.zfw + this.block - this.taxi;
  }

  gw(): number | undefined {
    const f = this.fob();
    return this.zfw !== undefined && f !== undefined ? this.zfw + f : undefined;
  }

  cg(): number | undefined {
    const f = this.fob();
    return this.zfwcg !== undefined ? +(this.zfwcg + 0.08 * ((f ?? 0) / 1000)).toFixed(1) : undefined;
  }

  /* ================================================================== flight plan helpers */

  /** Plan shown by F-PLN pages: temporary if it exists. */
  shownPlan(): FlightPlan | undefined {
    return this.tmpy ?? this.active;
  }

  origin(): NavPoint | undefined {
    const a = this.active?.origin;
    return a ? { ident: a.icao, kind: 'airport', lat: a.lat, lon: a.lon, elevation: a.elevFt } : undefined;
  }

  destination(): NavPoint | undefined {
    const a = this.active?.dest;
    return a ? { ident: a.icao, kind: 'airport', lat: a.lat, lon: a.lon, elevation: a.elevFt } : undefined;
  }

  departureRunway(): NavPoint | undefined {
    const p = this.active;
    const r = p?.depRwy;
    if (!p || !r) return undefined;
    return { ident: `RW${r.ident}`, kind: 'runway', lat: r.startLat ?? r.lat, lon: r.startLon ?? r.lon, heading: r.trueCrs, elevation: r.elevFt };
  }

  arrivalRunway(): NavPoint | undefined {
    const p = this.active;
    if (!p?.dest || !p.approach) return undefined;
    const r = this.db.runway(p.dest, p.approach.runway);
    return r ? { ident: `RW${r.ident}`, kind: 'runway', lat: r.lat, lon: r.lon, heading: r.trueCrs, elevation: r.elevFt } : undefined;
  }

  activePlan(): FlightPlanItem[] {
    return this.planItems(this.active);
  }

  /** Temporary flight plan (yellow on the ND) — extension of FmgsApi. */
  temporaryPlan(): FlightPlanItem[] {
    return this.planItems(this.tmpy);
  }

  secondaryPlan(): FlightPlanItem[] {
    return this.planItems(this.sec);
  }

  /** Alternate flight plan legs (after the missed approach) — extension of FmgsApi. */
  alternatePlan(): FlightPlanItem[] {
    const p = this.active;
    if (!p) return [];
    return p.altnItems.filter(isLeg).map((l) => this.toApiLeg(l, false));
  }

  /** Pseudo waypoints (T/C, T/D, LIM, DECEL) with positions — extension of FmgsApi. */
  pseudoWaypoints(): { ident: string; lat: number; lon: number; distNm: number }[] {
    const p = this.active, pr = this.preds;
    if (!p || !pr) return [];
    return pr.pseudo.map((x) => ({ ident: x.ident, distNm: x.dist, ...this.pointAtDistance(p, x.dist) }));
  }

  pointAtDistance(p: FlightPlan, dist: number): { lat: number; lon: number } {
    let acc = 0;
    let prev: FpLeg | undefined;
    for (const it of p.items) {
      if (!isLeg(it)) continue;
      if (prev && acc + it.dist >= dist && it.dist > 0) {
        const f = (dist - acc) / it.dist;
        return { lat: prev.lat + (it.lat - prev.lat) * f, lon: prev.lon + (it.lon - prev.lon) * f };
      }
      acc += it.dist;
      prev = it;
    }
    return prev ? { lat: prev.lat, lon: prev.lon } : { lat: 0, lon: 0 };
  }

  private toApiLeg(l: FpLeg, missed: boolean): FlightPlanItem {
    const pr = this.preds?.legs.get(l);
    const point: NavPoint = { ident: l.ident, kind: l.kind, lat: l.lat, lon: l.lon };
    if (l.runway) { point.heading = l.runway.trueCrs; point.elevation = l.runway.elevFt; }
    const nav = l.kind === 'vor' || l.kind === 'vordme' || l.kind === 'ndb' || l.kind === 'dme' ? this.db.navaid(l.ident, l) : undefined;
    if (nav) point.freq = nav.freq;
    return {
      point, legType: l.legType, via: l.via ?? 'DIRECT',
      altConstraint: l.alt ? { type: l.alt.type, alt: l.alt.alt, alt2: l.alt.alt2 } : undefined,
      speedConstraint: l.spd, course: l.trk, distance: l.dist,
      predTimeMin: pr?.timeMin, predAlt: pr?.alt, predSpeed: pr ? (pr.spd < 2 ? undefined : pr.spd) : undefined,
      isMissedApproach: missed || undefined, overfly: l.ovfy,
    };
  }

  private planItems(p?: FlightPlan): FlightPlanItem[] {
    if (!p) return [];
    return p.items.map((it) => (isLeg(it) ? this.toApiLeg(it, it.seg === 'miss') : { discontinuity: true as const }));
  }

  toIndex(): number {
    return this.active?.activeIndex ?? 0;
  }

  nearby(kind: 'airport' | 'vor' | 'ndb' | 'wpt', lat: number, lon: number, radiusNm: number): NavPoint[] {
    return this.db.nearby(kind, lat, lon, radiusNm);
  }

  tunedNavaids(): ReturnType<FmgsApi['tunedNavaids']> {
    const pt = (t?: Tuned): NavPoint | undefined => {
      if (!t?.navaid) return undefined;
      const n = t.navaid;
      const kind = n.type === 'VOR' ? 'vor' : n.type === 'VORDME' ? 'vordme' : n.type === 'NDB' ? 'ndb' : n.type === 'DME' ? 'dme' : 'fix';
      return { ident: n.ident, kind, lat: n.lat, lon: n.lon, freq: n.freq };
    };
    const ils = this.ils();
    return {
      vor1: pt(this.vor1()), vor2: pt(this.vor2()), adf1: pt(this.adf1Man), adf2: pt(this.adf2Man),
      ils: ils?.navaid ? { ...pt(ils)!, kind: 'fix', course: this.ilsCourse() ?? 0 } : undefined,
    };
  }

  phase(): number {
    return this.flightPhase;
  }

  flightNumber(): string {
    return this.flightNo ?? '';
  }

  vor1(): Tuned | undefined { return this.vor1Man ?? this.auto.vor1; }
  vor2(): Tuned | undefined { return this.vor2Man ?? this.auto.vor2; }
  ils(): Tuned | undefined { return this.ilsMan ?? this.auto.ils; }
  ilsCourse(): number | undefined { return this.ilsCrsMan ?? (this.ilsMan ? this.ilsMan.navaid?.course : this.auto.ilsCrs); }

  /* ================================================================== flight plan operations (INIT A) */

  /** Create a new active flight plan from origin to destination. */
  newFlightPlan(origin: DbAirport, dest: DbAirport): void {
    this.active = FlightPlan.create(this.db, origin, dest);
    this.tmpy = undefined;
    this.coRoute = undefined;
    this.altnCoRoute = undefined;
    this.initPos = { lat: origin.lat, lon: origin.lon };
    this.vor1Man = this.vor2Man = this.ilsMan = undefined;
    this.markDirty();
  }

  /** Build the active flight plan from a company route. Returns false when not in data base. */
  loadCoRoute(ident: string): boolean {
    const r = this.db.coRoute(ident);
    if (!r) return false;
    const o = this.db.airport(r.from), d = this.db.airport(r.to);
    if (!o || !d) return false;
    this.newFlightPlan(o, d);
    this.coRoute = r.ident;
    const p = this.active!;
    if (r.depRwy) p.depRwy = this.db.runway(o, r.depRwy);
    if (r.sid) {
      p.sid = o.sids.find((s) => s.ident === r.sid) ?? undefined;
      p.sidTrans = p.sid?.trans.length ? null : undefined;
    }
    p.rebuildDeparture();
    let idx = p.items.length - 1;
    for (let i = p.items.length - 1; i >= 0; i--) if (isLeg(p.items[i]) && p.items[i].seg !== 'dest') { idx = i; break; }
    for (const el of r.route) {
      const from = p.items[idx] as FpLeg;
      const to = this.db.fix(el.to, from);
      if (!to) continue;
      if (el.via === 'DCT') { p.insertNext(idx, to); idx = p.items.findIndex((i) => isLeg(i) && i.ident === to.ident); continue; }
      const fixes = this.db.airwaySegment(el.via, from.ident, el.to);
      if (!fixes) continue;
      idx = p.insertAirway(idx, el.via, fixes.map((f) => this.db.fix(f, from)!).filter(Boolean));
    }
    if (r.approach) {
      p.approach = d.approaches.find((a) => a.ident === r.approach);
      p.appVia = p.approach?.vias.find((v) => v.ident === r.appVia) ?? (p.approach?.vias.length ? undefined : null);
    }
    if (r.star) { p.star = d.stars.find((s) => s.ident === r.star); p.starTrans = p.star?.trans.length ? undefined : null; }
    p.rebuildArrival();
    if (r.altn) this.setAlternate(r.altn, r.altnCoRoute);
    if (r.costIndex !== undefined) this.ci = r.costIndex;
    if (r.crzFl !== undefined) { this.crzFl = r.crzFl; this.crzTemp = undefined; }
    this.markDirty();
    return true;
  }

  setAlternate(icao: string | undefined, coRte?: string): boolean {
    const p = this.active;
    if (!p) return false;
    if (!icao) { p.setAlternate(undefined); this.altnCoRoute = undefined; this.markDirty(); return true; }
    const a = this.db.airport(icao);
    if (!a) return false;
    const route: NavFix[] = [];
    const cr = coRte ? this.db.coRoute(coRte) : undefined;
    if (cr) for (const el of cr.route) { const f = this.db.fix(el.to, a); if (f) route.push(f); }
    p.setAlternate(a, route);
    this.altnCoRoute = cr?.ident;
    this.markDirty();
    return true;
  }

  /* ================================================================== temporary flight plan */

  /** Create (or return) the temporary flight plan for a revision. */
  editPlan(): FlightPlan | undefined {
    if (!this.active) return undefined;
    if (!this.tmpy) this.tmpy = this.active.clone();
    return this.tmpy;
  }

  insertTmpy(): void {
    if (!this.tmpy || !this.active) return;
    const rwyChanged = this.tmpy.depRwy?.ident !== this.active.depRwy?.ident;
    this.active = this.tmpy;
    this.tmpy = undefined;
    if (rwyChanged) this.onRunwayChanged();
    this.markDirty();
  }

  eraseTmpy(): void {
    this.tmpy = undefined;
  }

  private onRunwayChanged(): void {
    // Changing the take-off runway after the V speeds were entered: V speeds deleted + CHECK TAKE OFF DATA.
    if (this.v1 !== undefined || this.vr !== undefined || this.v2 !== undefined) {
      this.v1 = this.vr = this.v2 = undefined;
      this.pushMessage(MSG.CHECK_TAKE_OFF_DATA);
    }
    this.toShift = undefined;
  }

  /** Any change of weights / take-off data after V speeds entry. */
  checkToData(): void {
    if (this.v1 !== undefined || this.vr !== undefined || this.v2 !== undefined) this.pushMessage(MSG.CHECK_TAKE_OFF_DATA);
  }

  /* ================================================================== performance defaults */

  depElevation(): number {
    const p = this.active;
    return p?.depRwy?.elevFt ?? p?.origin?.elevFt ?? 0;
  }

  transAlt(): number | undefined {
    return this.toTransAlt ?? this.active?.origin?.transAlt;
  }

  defaultThrRed(): number | undefined {
    return this.active?.origin ? ceil10(this.depElevation() + 1500) : undefined;
  }

  destElevation(): number | undefined {
    const p = this.active;
    if (!p?.dest) return undefined;
    const r = p.approach ? this.db.runway(p.dest, p.approach.runway) : undefined;
    return r?.elevFt ?? p.dest.elevFt;
  }

  defaultGaThrRed(): number | undefined {
    const e = this.destElevation();
    return e !== undefined ? ceil10(e + 1500) : undefined;
  }

  transFlDest(): number | undefined {
    return this.destTransFl ?? this.active?.dest?.transFl;
  }

  /** Characteristic speeds at take-off weight. */
  toSpeeds() {
    const w = this.tow();
    return w ? charSpeeds(w) : undefined;
  }

  lwSpeeds() {
    const lw = this.preds?.landingWeight ?? (this.tow() ? this.tow()! - 2400 : undefined);
    if (!lw) return undefined;
    const hw = this.magWind && this.active?.approach && this.active.dest ? this.headwind() : 0;
    return charSpeeds(lw, this.ldgConf, hw);
  }

  private headwind(): number {
    const p = this.active!;
    const r = this.db.runway(p.dest!, p.approach!.runway)!;
    const w = this.magWind!;
    return Math.max(0, w.spd * Math.cos(((w.dir - r.magCrs) * Math.PI) / 180));
  }

  /* ================================================================== fuel */

  fuelPred() {
    const pr = this.preds;
    const tow = this.tow();
    if (!pr || tow === undefined) return undefined;
    const trip = pr.tripFuel;
    const rsv = this.rsvKgPilot ?? (trip * this.rsvPct) / 100;
    const lw = tow - trip;
    const altnDist = this.active!.altn ? this.altnRouteDistance() : 0;
    const altnCalc = this.active!.altn ? altnFuel(altnDist, lw) : { fuel: 0, time: 0 };
    const altn = this.altnKgPilot ?? altnCalc.fuel;
    const final = this.finalKgPilot ?? finalFuel(lw - altn, this.finalTime);
    const extra = (this.block ?? 0) - this.taxi - trip - rsv - altn - final;
    return {
      trip, tripTime: pr.tripTime, rsv, rsvPct: this.rsvKgPilot ? (this.rsvKgPilot / trip) * 100 : this.rsvPct,
      altn, altnTime: altnCalc.time, final, finalTime: this.finalTime, extra,
      extraTime: Math.max(0, extra) / (2250 * (lw / 62000)) * 60, tow, lw, destEfob: pr.destEfob,
      minDestFob: altn + final,
    };
  }

  altnRouteDistance(): number {
    const p = this.active!;
    let d = 0;
    let started = false;
    for (const it of p.items) {
      if (!isLeg(it)) continue;
      if (it.seg === 'dest') { started = true; continue; }
      if (started) d += it.dist;
    }
    return d + p.altnDistance();
  }

  /** Block fuel computed by FUEL PLANNING. */
  computedBlock(): number | undefined {
    const pr = this.preds;
    const zfw = this.zfw;
    if (!pr || zfw === undefined) return undefined;
    const trip = pr.tripFuel;
    const rsv = (trip * this.rsvPct) / 100;
    const lw = zfw + 3000;
    const a = this.active!.altn ? altnFuel(this.altnRouteDistance(), lw) : { fuel: 0, time: 0 };
    const f = finalFuel(lw, this.finalTime);
    return Math.ceil((this.taxi + trip + rsv + a.fuel + f) / 100) * 100;
  }

  startFuelPlanning(): void {
    this.fuelPlanning = 'computing';
    this.fuelPlanT = 0;
  }

  /* ================================================================== predictions */

  private computePredictions(): void {
    const p = this.active;
    if (!p || !p.dest || !this.crzFl) { this.preds = undefined; return; }
    let tow = this.tow();
    let fob = this.block !== undefined ? this.block - this.taxi : undefined;
    if (tow === undefined && this.zfw !== undefined) { fob = 6000; tow = this.zfw + fob; }
    if (tow === undefined || fob === undefined) { this.preds = undefined; return; }
    this.preds = predict(p, {
      crzFl: this.crzFl, costIndex: this.ci ?? 0, towKg: tow, fobKg: fob, windKt: this.tripWind,
      isaDev: this.crzTemp !== undefined ? this.crzTemp - isaTemp(this.crzFl * 100) : 0,
      transAlt: this.transAlt() ?? 5000, destTransFl: this.transFlDest() ?? 60,
      accAlt: this.acc ?? this.defaultThrRed(),
    });
  }

  /* ================================================================== radio autotuning */

  private autotune(): void {
    const pos = this.position();
    const vors = this.db.navaids.filter((n) => (n.type === 'VOR' || n.type === 'VORDME') && distanceNm(pos.lat, pos.lon, n.lat, n.lon) < 200);
    vors.sort((a, b) => distanceNm(pos.lat, pos.lon, a.lat, a.lon) - distanceNm(pos.lat, pos.lon, b.lat, b.lon));
    const t = (n?: DbNavaid): Tuned | undefined => (n ? { ident: n.ident, freq: n.freq, navaid: n, manual: false } : undefined);
    this.auto.vor1 = t(vors[0]);
    // VOR 2: next VOR of the active flight plan, else second closest
    let v2: DbNavaid | undefined;
    const p = this.active;
    if (p) {
      for (let i = p.activeIndex; i < p.items.length; i++) {
        const it = p.items[i];
        if (isLeg(it) && (it.kind === 'vor' || it.kind === 'vordme')) {
          const n = this.db.navaid(it.ident, it);
          if (n && n !== vors[0] && distanceNm(pos.lat, pos.lon, n.lat, n.lon) < 200) { v2 = n; break; }
        }
      }
    }
    this.auto.vor2 = t(v2 ?? vors[1]);
    // ILS: departure runway in preflight / take-off, destination approach afterwards
    let ils: DbNavaid | undefined;
    if (p) {
      if (this.flightPhase <= 1 && p.origin && p.depRwy) ils = this.db.ilsForRunway(p.origin, p.depRwy);
      else if (p.dest && p.approach) {
        const r = this.db.runway(p.dest, p.approach.runway);
        if (r) ils = this.db.ilsForRunway(p.dest, r);
      }
    }
    this.auto.ils = t(ils);
    this.auto.ilsCrs = ils?.course;
  }

  /* ================================================================== flight phase */

  private updatePhase(): void {
    const onGround = this.onGround();
    const n1 = Math.min(this.sim.get('S:ENG1_N1'), this.sim.get('S:ENG2_N1'));
    const gs = this.sim.get('G:AC_GS_KT');
    const alt = this.sim.get('S:ADIRS_BARO_ALT_STD');
    switch (this.flightPhase) {
      case 0:
        if (onGround && n1 > 75 && gs > 30) this.flightPhase = 1;
        break;
      case 1:
        if (!onGround && alt > (this.acc ?? this.defaultThrRed() ?? 1500)) this.flightPhase = 2;
        break;
      case 2:
        if (this.crzFl && alt >= this.crzFl * 100 - 200) this.flightPhase = 3;
        break;
      case 3:
        if (this.crzFl && alt < this.crzFl * 100 - 1500) this.flightPhase = 4;
        break;
      case 4: {
        const d = this.destination();
        const pos = this.position();
        if (d && distanceNm(pos.lat, pos.lon, d.lat, d.lon) < 15) this.flightPhase = 5;
        break;
      }
      case 5:
        if (onGround && gs < 30) this.flightPhase = 7;
        break;
    }
  }

  private sequence(): void {
    const p = this.active;
    if (!p || this.flightPhase === 0) return;
    const pos = this.position();
    const it = p.items[p.activeIndex];
    if (isLeg(it) && distanceNm(pos.lat, pos.lon, it.lat, it.lon) < 0.7) {
      const next = p.activeIndex + 1;
      if (next < p.items.length && isLeg(p.items[next])) p.activeIndex = next;
    }
  }

  /* ================================================================== system update */

  update(dt: number): void {
    const sim = this.sim;
    this.fmgc1 = this.busPowered('S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_POWERED');
    this.fmgc2 = this.busPowered('S:ELEC_AC2_BUS', 'S:ELEC_AC_POWERED');
    const powered = this.fmgc1 || this.fmgc2;
    if (!powered) {
      this.offT += dt;
      this.initT = 0;
      this.ready = false;
      // Long power interruption of both FMGCs: all flight data lost (cold start).
      if (this.offT > 10 && (this.active || this.zfw !== undefined)) this.reset();
    } else {
      this.offT = 0;
      this.initT += dt;
      this.ready = this.initT >= FMGC_INIT_S;
    }

    if (this.ready) {
      if (this.fuelPlanning === 'computing') {
        this.fuelPlanT += dt;
        if (this.fuelPlanT > 3 && this.preds) {
          const b = this.computedBlock();
          if (b !== undefined) { this.block = b; this.fuelPlanning = 'done'; this.markDirty(); }
        }
      }
      this.predT += dt;
      if (this.dirty || this.predT > 5) {
        this.computePredictions();
        this.dirty = false;
        this.predT = 0;
      }
      this.updatePhase();
      this.sequence();
      this.autotune();
      // messages
      if (this.positionValid()) {
        this.gpsPrimaryT += dt;
        if (!this.gpsPrimaryShown && this.gpsPrimaryT > 4) { this.gpsPrimaryShown = true; this.pushMessage(MSG.GPS_PRIMARY); }
      } else this.gpsPrimaryT = 0;
      if (!this.initWeightShown && this.enginesRunning() && (this.zfw === undefined || this.zfwcg === undefined)) {
        this.initWeightShown = true;
        this.pushMessage(MSG.INITIALIZE_WEIGHT_CG);
      }
      if (this.zfw !== undefined && this.zfwcg !== undefined) this.removeMessage(MSG.INITIALIZE_WEIGHT_CG);
      const fp = this.fuelPred();
      if (fp && this.block !== undefined && fp.destEfob < fp.minDestFob - 1) this.pushMessage(MSG.DEST_EFOB_BELOW_MIN);
      else this.removeMessage(MSG.DEST_EFOB_BELOW_MIN);
    }
    this.publish();
  }

  /* ================================================================== published variables */

  private publish(): void {
    const s = this.sim;
    const r = this.ready;
    const p = this.active;
    s.set('S:FMGS_POWERED', r ? 1 : 0);
    s.set('S:FMGS_FMGC1_POWERED', this.fmgc1 ? 1 : 0);
    s.set('S:FMGS_FMGC2_POWERED', this.fmgc2 ? 1 : 0);
    s.set('S:FMGS_PHASE', this.flightPhase);
    s.set('S:FMGS_V1', r ? this.v1 ?? 0 : 0);
    s.set('S:FMGS_VR', r ? this.vr ?? 0 : 0);
    s.set('S:FMGS_V2', r ? this.v2 ?? 0 : 0);
    s.set('S:FMGS_FLEX', r ? this.flex ?? 0 : 0);
    s.set('S:FMGS_TO_CONF', r ? this.toFlaps ?? 0 : 0);
    s.set('S:FMGS_THS_FOR', r ? this.toThs ?? 0 : 0);
    s.set('S:FMGS_THS_ENTERED', r && this.toThs !== undefined ? 1 : 0);
    s.set('S:FMGS_THR_RED', r ? this.thrRed ?? this.defaultThrRed() ?? 0 : 0);
    s.set('S:FMGS_ACC', r ? this.acc ?? this.defaultThrRed() ?? 0 : 0);
    s.set('S:FMGS_EO_ACC', r ? this.eoAcc ?? this.defaultThrRed() ?? 0 : 0);
    s.set('S:FMGS_CRZ_FL', r ? this.crzFl ?? 0 : 0);
    s.set('S:FMGS_CI', r ? this.ci ?? 0 : 0);
    s.set('S:FMGS_TRANS_ALT', r ? this.transAlt() ?? 0 : 0);
    s.set('S:FMGS_ZFW', r ? this.zfw ?? 0 : 0);
    s.set('S:FMGS_ZFWCG', r ? this.zfwcg ?? 0 : 0);
    s.set('S:FMGS_BLOCK', r ? this.block ?? 0 : 0);
    s.set('S:FMGS_TOW', r ? this.tow() ?? 0 : 0);
    s.set('S:FMGS_GW', r ? this.gw() ?? 0 : 0);
    s.set('S:FMGS_CG', r ? this.cg() ?? 0 : 0);
    const ts = r ? this.toSpeeds() : undefined;
    s.set('S:FMGS_F_SPEED', ts?.f ?? 0);
    s.set('S:FMGS_S_SPEED', ts?.s ?? 0);
    s.set('S:FMGS_GD_SPEED', ts?.gd ?? 0);
    s.set('S:FMGS_INIT_A_DONE', r && p?.dest && this.flightNo && this.ci !== undefined && this.crzFl ? 1 : 0);
    s.set('S:FMGS_INIT_B_DONE', r && this.zfw !== undefined && this.zfwcg !== undefined && this.block !== undefined ? 1 : 0);
    s.set('S:FMGS_FPLN_ACTIVE', r && p?.origin && p?.dest ? 1 : 0);
    s.set('S:FMGS_FPLN_DONE', r && p?.depRwy && p.sid !== undefined && !p.hasDisco() && p.approach ? 1 : 0);
    s.set('S:FMGS_PERF_TO_DONE', r && this.v1 && this.vr && this.v2 && this.toFlaps && this.toThs !== undefined ? 1 : 0);
    s.set('S:FMGS_DEP_RWY_HDG', r && p?.depRwy ? p.depRwy.magCrs : 0);
    s.set('S:FMGS_DEP_RWY_HDG_TRUE', r && p?.depRwy ? p.depRwy.trueCrs : 0);
    s.set('S:FMGS_DEP_RWY_ELEV', r && p?.depRwy ? p.depRwy.elevFt : 0);
    s.set('S:FMGS_DEST_ELEV', r ? this.destElevation() ?? 0 : 0);
    s.set('S:FMGS_DEST_QNH', r ? this.qnh ?? 0 : 0);
    s.set('S:FMGS_TMPY', r && this.tmpy ? 1 : 0);
    const pr = this.preds;
    s.set('S:FMGS_TRIP_FUEL', r && pr ? Math.round(pr.tripFuel) : 0);
    s.set('S:FMGS_TRIP_TIME', r && pr ? Math.round(pr.tripTime) : 0);
    // radio
    const v1 = r ? this.vor1() : undefined, v2 = r ? this.vor2() : undefined, ils = r ? this.ils() : undefined;
    s.set('S:NAV_VOR1_FREQ', v1?.freq ?? 0);
    s.set('S:NAV_VOR2_FREQ', v2?.freq ?? 0);
    s.set('S:NAV_VOR1_CRS', r ? this.vor1Crs ?? 0 : 0);
    s.set('S:NAV_VOR2_CRS', r ? this.vor2Crs ?? 0 : 0);
    s.set('S:NAV_ILS_FREQ', ils?.freq ?? 0);
    s.set('S:NAV_ILS_CRS', r ? this.ilsCourse() ?? 0 : 0);
    s.set('S:NAV_ADF1_FREQ', r ? this.adf1Man?.freq ?? 0 : 0);
    s.set('S:NAV_ADF2_FREQ', r ? this.adf2Man?.freq ?? 0 : 0);
    s.set('S:NAV_VOR1_AUTO', r && !this.vor1Man ? 1 : 0);
    s.set('S:NAV_VOR2_AUTO', r && !this.vor2Man ? 1 : 0);
    s.set('S:NAV_ILS_AUTO', r && !this.ilsMan ? 1 : 0);
  }

  /* ================================================================== misc helpers used by pages */

  /** Bearing (magnetic) and distance from aircraft to a point. */
  bearingDistTo(lat: number, lon: number): { brg: number; dist: number } {
    const pos = this.position();
    return { brg: toMag(bearingDeg(pos.lat, pos.lon, lat, lon), pos.lat, pos.lon), dist: distanceNm(pos.lat, pos.lon, lat, lon) };
  }
}
