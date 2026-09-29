/**
 * FMGS flight plan (active / temporary / secondary). DOM-free.
 *
 * The plan is a flat list of items (legs and discontinuities), each tagged with the segment it belongs to so the
 * departure (runway + SID) and arrival (STAR + approach via + approach + missed approach) can be re-built when the
 * crew selects other procedures, while en-route edits (airways, NEXT WPT, DIR TO...) are preserved.
 */
import { bearingDeg, destinationPoint, distanceNm, type WaypointKind } from '../../../core/fmgs-api';
import { toMag, toTrue, type NavDb, type NavFix } from '../navdb/navdb';
import type { AltCstr, DbAirport, DbApproach, DbProcedure, DbRunway, DbTransition, LegType, ProcLeg } from '../navdb/types';

export type Seg = 'orig' | 'dep' | 'enr' | 'arr' | 'dest' | 'miss';

export interface FpLeg {
  disco?: false;
  ident: string;
  lat: number;
  lon: number;
  kind: WaypointKind;
  legType: LegType | 'RWY' | 'APT' | 'TP';
  seg: Seg;
  /** Annotation shown above the waypoint in F-PLN (procedure / airway ident). */
  via?: string;
  /** Magnetic course for CF / CA legs. */
  crs?: number;
  alt?: AltCstr;
  spd?: number;
  ovfy?: boolean;
  turn?: 'L' | 'R';
  /** Constraint copied from an arrival procedure onto an en-route leg (stripped when the arrival changes). */
  cstrFromArr?: boolean;
  runway?: DbRunway;
  airport?: DbAirport;
  elevFt?: number;
  /** Computed: distance (NM) and true track from the previous leg. */
  dist: number;
  trk: number;
  afterDisco?: boolean;
}

export interface FpDisco {
  disco: true;
  seg: Seg;
}

export type FpItem = FpLeg | FpDisco;

export const isLeg = (i: FpItem | undefined): i is FpLeg => !!i && !i.disco;

let uid = 0;

export class FlightPlan {
  items: FpItem[] = [];
  origin?: DbAirport;
  depRwy?: DbRunway;
  /** undefined = not selected, null = NONE (NO SID). */
  sid?: DbProcedure | null;
  sidTrans?: DbTransition | null;
  dest?: DbAirport;
  approach?: DbApproach | null;
  appVia?: DbTransition | null;
  star?: DbProcedure | null;
  starTrans?: DbTransition | null;
  altn?: DbAirport;
  altnItems: FpItem[] = [];
  /** Index of the active (TO) leg. */
  activeIndex = 1;
  readonly id = ++uid;

  constructor(readonly db: NavDb) {}

  clone(): FlightPlan {
    const p = new FlightPlan(this.db);
    p.items = this.items.map((i) => ({ ...i }) as FpItem);
    p.altnItems = this.altnItems.map((i) => ({ ...i }) as FpItem);
    p.origin = this.origin; p.depRwy = this.depRwy; p.sid = this.sid; p.sidTrans = this.sidTrans;
    p.dest = this.dest; p.approach = this.approach; p.appVia = this.appVia; p.star = this.star; p.starTrans = this.starTrans;
    p.altn = this.altn; p.activeIndex = this.activeIndex;
    return p;
  }

  /* ---------------------------------------------------------------- accessors */

  get length() { return this.items.length; }
  legs(): FpLeg[] { return this.items.filter(isLeg); }
  originLeg(): FpLeg | undefined { const l = this.items[0]; return isLeg(l) && l.seg === 'orig' ? l : undefined; }
  destIndex(): number { return this.items.findIndex((i) => isLeg(i) && i.seg === 'dest'); }
  destLeg(): FpLeg | undefined { const i = this.destIndex(); return i >= 0 ? (this.items[i] as FpLeg) : undefined; }
  hasDisco(): boolean { const d = this.destIndex(); return this.items.some((i, k) => i.disco && (d < 0 || k < d)); }

  /* ---------------------------------------------------------------- building */

  static create(db: NavDb, origin: DbAirport, dest: DbAirport): FlightPlan {
    const p = new FlightPlan(db);
    p.origin = origin;
    p.dest = dest;
    p.items = [p.originItem(), { disco: true, seg: 'enr' }, p.destItem()];
    p.recompute();
    return p;
  }

  private originItem(): FpLeg {
    const a = this.origin!;
    const r = this.depRwy;
    if (r) {
      return { ident: a.icao + r.ident, lat: r.startLat ?? r.lat, lon: r.startLon ?? r.lon, kind: 'runway', legType: 'RWY', seg: 'orig', runway: r, airport: a, elevFt: r.elevFt, dist: 0, trk: 0 };
    }
    return { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', legType: 'APT', seg: 'orig', airport: a, elevFt: a.elevFt, dist: 0, trk: 0 };
  }

  private destItem(): FpLeg {
    const a = this.dest!;
    const r = this.approach ? this.db.runway(a, this.approach.runway) : undefined;
    if (r) {
      return { ident: a.icao + r.ident, lat: r.lat, lon: r.lon, kind: 'runway', legType: 'RWY', seg: 'dest', runway: r, airport: a, elevFt: r.elevFt, via: this.approach?.ident, dist: 0, trk: 0 };
    }
    return { ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', legType: 'APT', seg: 'dest', airport: a, elevFt: a.elevFt, dist: 0, trk: 0 };
  }

  /** Convert procedure legs to flight plan items. */
  procItems(legs: ProcLeg[], via: string, seg: Seg, start: { lat: number; lon: number; elev: number }): FpItem[] {
    const out: FpItem[] = [];
    let prev = { lat: start.lat, lon: start.lon };
    let prevAlt = start.elev;
    for (const pl of legs) {
      if (pl.fix) {
        const f = this.db.fix(pl.fix, prev);
        if (!f) continue;
        const leg: FpLeg = {
          ident: f.ident, lat: f.lat, lon: f.lon, kind: fixKind(f), legType: pl.t, seg, via,
          crs: pl.t === 'CF' ? pl.crs : undefined, alt: pl.alt, spd: pl.spd, ovfy: pl.ovfy, turn: pl.turn, dist: 0, trk: 0,
        };
        out.push(leg);
        prev = f;
        if (pl.alt) prevAlt = pl.alt.alt;
      } else if (pl.t === 'CA' || pl.t === 'VA') {
        const alt = pl.alt?.alt ?? prevAlt + 1000;
        const d = Math.max(0.6, (alt - prevAlt) / 350);
        const p = destinationPoint(prev.lat, prev.lon, toTrue(pl.crs ?? 0, prev.lat, prev.lon), d);
        out.push({ ident: `(${alt})`, lat: p.lat, lon: p.lon, kind: 'pseudo', legType: pl.t, seg, via, crs: pl.crs, alt: pl.alt, dist: 0, trk: 0 });
        prev = p;
        prevAlt = alt;
      }
      if (pl.disco) out.push({ disco: true, seg });
    }
    return out;
  }

  private buildDeparture(): FpItem[] {
    const orig = this.originItem();
    const out: FpItem[] = [orig];
    if (this.sid) {
      const start = { lat: orig.lat, lon: orig.lon, elev: orig.elevFt ?? 0 };
      out.push(...this.procItems(this.sid.legs, this.sid.ident, 'dep', start));
      if (this.sidTrans) {
        const last = [...out].reverse().find(isLeg)!;
        out.push(...dedupeHead(last, this.procItems(this.sidTrans.legs, this.sidTrans.ident, 'dep', { lat: last.lat, lon: last.lon, elev: 5000 })));
      }
    }
    return out;
  }

  private buildArrival(): { arr: FpItem[]; dest: FpLeg; miss: FpItem[] } {
    const arr: FpItem[] = [];
    const d = this.dest!;
    const ref = { lat: d.lat, lon: d.lon, elev: 20000 };
    const add = (items: FpItem[]) => {
      const last = [...arr].reverse().find(isLeg);
      arr.push(...(last ? dedupeHead(last, items) : items));
    };
    if (this.starTrans) add(this.procItems(this.starTrans.legs, this.starTrans.ident, 'arr', ref));
    if (this.star) add(this.procItems(this.star.legs, this.star.ident, 'arr', ref));
    if (this.approach) {
      if (this.appVia) add(this.procItems(this.appVia.legs, this.appVia.ident, 'arr', ref));
      add(this.procItems(this.approach.legs, this.approach.ident, 'arr', ref));
    }
    // A discontinuity between STAR end and approach start when they do not connect.
    const dest = this.destItem();
    const miss: FpItem[] = [];
    if (this.approach?.missed.length && dest.runway) {
      miss.push(...this.procItems(this.approach.missed, this.approach.ident, 'miss', { lat: dest.lat, lon: dest.lon, elev: dest.elevFt ?? 0 }));
    }
    return { arr, dest, miss };
  }

  /** Re-build the departure part (runway, SID, transition) keeping the rest. */
  rebuildDeparture(): void {
    const old = this.items.filter((i) => i.seg === 'orig' || i.seg === 'dep');
    const oldEnd = [...old].reverse().find(isLeg)?.ident;
    const rest = this.items.filter((i) => i.seg !== 'orig' && i.seg !== 'dep');
    const dep = this.buildDeparture();
    const newEnd = [...dep].reverse().find(isLeg)?.ident;
    const first = rest[0];
    if (isLeg(first) && newEnd !== oldEnd && first.ident !== newEnd) rest.unshift({ disco: true, seg: 'enr' });
    this.items = [...dep, ...rest];
    this.normalize();
  }

  /** Re-build the arrival part (STAR, approach via, approach, runway, missed approach) keeping the rest. */
  rebuildArrival(): void {
    let keep = this.items.filter((i) => i.seg === 'orig' || i.seg === 'dep' || i.seg === 'enr');
    for (const i of keep) if (isLeg(i) && i.cstrFromArr) { i.alt = undefined; i.spd = undefined; i.cstrFromArr = false; }
    const { arr, dest, miss } = this.buildArrival();
    const firstArr = arr.find(isLeg);
    const last = keep[keep.length - 1];
    if (firstArr) {
      let k = -1;
      keep.forEach((it, n) => { if (n > 0 && isLeg(it) && it.ident === firstArr.ident) k = n; });
      if (k >= 0) keep = keep.slice(0, k + 1);
      else if (isLeg(last)) keep.push({ disco: true, seg: 'enr' });
    } else if (isLeg(last)) {
      keep.push({ disco: true, seg: 'enr' });
    }
    this.items = [...keep, ...arr, dest, ...miss];
    this.normalize();
  }

  /** Merge duplicated consecutive waypoints, drop useless discontinuities, then recompute geometry. */
  normalize(): void {
    const out: FpItem[] = [];
    const src = this.items;
    for (let k = 0; k < src.length; k++) {
      const it = src[k];
      const prev = out[out.length - 1];
      if (it.disco) {
        if (!prev || prev.disco) continue;
        const next = src[k + 1];
        if (isLeg(prev) && isLeg(next) && next.ident === prev.ident) continue;
        out.push(it);
        continue;
      }
      if (isLeg(prev) && prev.ident === it.ident && it.kind !== 'pseudo') {
        // same waypoint twice: keep one, merge the constraints
        if (!prev.alt && it.alt) { prev.alt = it.alt; prev.cstrFromArr = it.seg === 'arr'; }
        if (!prev.spd && it.spd) { prev.spd = it.spd; prev.cstrFromArr = it.seg === 'arr'; }
        if (it.seg === 'dest') out[out.length - 1] = it;
        continue;
      }
      out.push(it);
    }
    while (out.length && out[out.length - 1].disco) out.pop();
    this.items = out;
    this.recompute();
  }

  recompute(): void {
    let prev: FpLeg | undefined;
    let afterDisco = false;
    for (const it of this.items) {
      if (it.disco) { afterDisco = true; continue; }
      if (prev) {
        it.dist = distanceNm(prev.lat, prev.lon, it.lat, it.lon);
        it.trk = it.dist > 0.01 ? bearingDeg(prev.lat, prev.lon, it.lat, it.lon) : prev.trk;
      } else { it.dist = 0; it.trk = it.runway ? it.runway.trueCrs : 0; }
      it.afterDisco = afterDisco;
      afterDisco = false;
      prev = it;
    }
    if (this.activeIndex >= this.items.length) this.activeIndex = Math.max(0, this.items.length - 1);
    this.recomputeAltn();
  }

  /* ---------------------------------------------------------------- alternate */

  setAlternate(altn: DbAirport | undefined, route: { lat: number; lon: number; ident: string }[] = []): void {
    this.altn = altn;
    this.altnItems = [];
    if (!altn) return;
    for (const r of route) this.altnItems.push({ ident: r.ident, lat: r.lat, lon: r.lon, kind: 'wpt', legType: 'TF', seg: 'enr', dist: 0, trk: 0 });
    this.altnItems.push({ ident: altn.icao, lat: altn.lat, lon: altn.lon, kind: 'airport', legType: 'APT', seg: 'dest', airport: altn, elevFt: altn.elevFt, dist: 0, trk: 0 });
    this.recomputeAltn();
  }

  recomputeAltn(): void {
    const legs = this.legs();
    let prev: { lat: number; lon: number } | undefined = legs[legs.length - 1];
    for (const it of this.altnItems) {
      if (it.disco) continue;
      if (prev) { it.dist = distanceNm(prev.lat, prev.lon, it.lat, it.lon); it.trk = bearingDeg(prev.lat, prev.lon, it.lat, it.lon); }
      prev = it;
    }
  }

  altnDistance(): number {
    return this.altnItems.reduce((s, i) => s + (isLeg(i) ? i.dist : 0), 0);
  }

  /* ---------------------------------------------------------------- edits */

  /** Insert a fix after index `idx` (NEXT WPT). If the fix exists downstream, legs in between are removed. */
  insertNext(idx: number, f: NavFix): void {
    const leg = fixLeg(f, this.segForInsert(idx));
    const down = this.items.findIndex((it, k) => k > idx && isLeg(it) && it.ident === f.ident && it.seg !== 'miss');
    if (down > idx) {
      this.items.splice(idx + 1, down - idx - 1);
      const t = this.items[idx + 1] as FpLeg;
      t.legType = 'TF';
    } else {
      this.items.splice(idx + 1, 0, leg, { disco: true, seg: leg.seg });
    }
    this.normalize();
  }

  /** Insert an airway from the waypoint at `idx` through `fixes` (in order). Returns the index of the TO waypoint. */
  insertAirway(idx: number, awy: string, fixes: NavFix[]): number {
    const seg = this.segForInsert(idx);
    const legs: FpLeg[] = fixes.map((f) => ({ ...fixLeg(f, seg), via: awy }));
    const lastIdent = fixes[fixes.length - 1].ident;
    const down = this.items.findIndex((it, k) => k > idx && isLeg(it) && it.ident === lastIdent && it.seg !== 'miss');
    if (down > idx) {
      const old = this.items[down] as FpLeg;
      const last = legs[legs.length - 1];
      last.alt = old.alt; last.spd = old.spd; last.seg = old.seg;
      this.items.splice(idx + 1, down - idx, ...legs);
    } else {
      const next = this.items[idx + 1];
      this.items.splice(idx + 1, 0, ...legs, ...(next && !next.disco ? [{ disco: true, seg } as FpDisco] : []));
    }
    this.normalize();
    let res = -1;
    this.items.forEach((it, k) => { if (k > idx && res < 0 && isLeg(it) && it.ident === lastIdent) res = k; });
    return res;
  }

  /** Delete the item at idx (waypoint or discontinuity). */
  deleteAt(idx: number): boolean {
    const it = this.items[idx];
    if (!it) return false;
    if (isLeg(it) && (it.seg === 'orig' || it.seg === 'dest')) return false;
    this.items.splice(idx, 1);
    const next = this.items[idx];
    if (isLeg(next) && next.legType === 'CF') next.legType = 'TF';
    this.normalize();
    return true;
  }

  /** NEW DEST at the waypoint at idx: the route after it is deleted and replaced by the new destination. */
  newDest(idx: number, ap: DbAirport): void {
    this.items = this.items.slice(0, idx + 1);
    this.dest = ap; this.approach = undefined; this.appVia = undefined; this.star = undefined; this.starTrans = undefined;
    this.items.push(this.destItem());
    this.normalize();
  }

  /** DIR TO: from present position (T-P) to the fix. */
  directTo(pos: { lat: number; lon: number }, f: NavFix | FpLeg, idx?: number): void {
    const tp: FpLeg = { ident: 'T-P', lat: pos.lat, lon: pos.lon, kind: 'pseudo', legType: 'TP', seg: 'enr', dist: 0, trk: 0 };
    let rest: FpItem[];
    if (idx !== undefined && idx >= 0) {
      rest = this.items.slice(idx);
      const first = rest[0] as FpLeg;
      rest[0] = { ...first, legType: 'DF', via: undefined };
    } else {
      rest = [{ ...fixLeg(f as NavFix, 'enr'), legType: 'DF' }, { disco: true, seg: 'enr' }, ...this.items.slice(this.activeIndex)];
    }
    const orig = this.items[0];
    this.items = [orig, tp, ...rest];
    this.activeIndex = 2;
    this.normalize();
  }

  private segForInsert(idx: number): Seg {
    const it = this.items[idx];
    if (!it) return 'enr';
    if (it.seg === 'orig' || it.seg === 'dep') return this.items.slice(idx + 1).some((i) => i.seg === 'dep') ? 'dep' : 'enr';
    if (it.seg === 'arr') return 'arr';
    return 'enr';
  }

  /** Total distance from origin to destination runway along the plan (NM). */
  totalDistance(): number {
    let d = 0;
    for (const it of this.items) {
      if (!isLeg(it)) continue;
      d += it.dist;
      if (it.seg === 'dest') break;
    }
    return d;
  }

  /** Magnetic track of the leg ending at item i. */
  legMagTrack(l: FpLeg): number {
    return Math.round(toMag(l.trk, l.lat, l.lon)) % 360 || 360;
  }
}

function fixKind(f: NavFix): WaypointKind {
  return f.kind;
}

export function fixLeg(f: NavFix, seg: Seg): FpLeg {
  return { ident: f.ident, lat: f.lat, lon: f.lon, kind: fixKind(f), legType: 'TF', seg, dist: 0, trk: 0 };
}

function dedupeHead(last: FpLeg, items: FpItem[]): FpItem[] {
  const first = items[0];
  if (isLeg(first) && first.ident === last.ident) {
    if (!last.alt && first.alt) last.alt = first.alt;
    if (!last.spd && first.spd) last.spd = first.spd;
    return items.slice(1);
  }
  return items;
}
