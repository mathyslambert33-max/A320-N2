/**
 * Navigation database access (DOM-free).
 */
import { distanceNm, type NavPoint, type WaypointKind } from '../../../core/fmgs-api';
import { AIRPORTS, CO_ROUTES } from './airports';
import { AIRWAYS, NAVAIDS, WAYPOINTS } from './generated';
import type { DbAirport, DbCoRoute, DbNavaid, DbRunway } from './types';

export interface NavFix {
  ident: string;
  lat: number;
  lon: number;
  kind: WaypointKind;
  navaid?: DbNavaid;
  airport?: DbAirport;
}

/** Active / second data base cycles (AIRAC). */
export const NAV_DB = {
  ident: 'SA20269001',
  active: { cycle: 2609, from: '03SEP', to: '30SEP' },
  second: { cycle: 2610, from: '01OCT', to: '28OCT' },
};

function navaidKind(n: DbNavaid): WaypointKind {
  switch (n.type) {
    case 'VOR': return 'vor';
    case 'VORDME': return 'vordme';
    case 'DME': return 'dme';
    case 'NDB': return 'ndb';
    default: return 'fix';
  }
}

/**
 * Magnetic variation (deg, + East) as used by the charts of the area (epoch 2020 station declinations:
 * BMC 0.3°E, Paris 1.0°E) so that FMS courses match the published procedure courses.
 */
export function magVar(_lat: number, lon: number): number {
  const v = 0.3 + 0.2258 * (lon + 0.72);
  return Math.max(-1, Math.min(2, v));
}

export const toMag = (trueDeg: number, lat: number, lon: number) => (trueDeg - magVar(lat, lon) + 360) % 360;
export const toTrue = (magDeg: number, lat: number, lon: number) => (magDeg + magVar(lat, lon) + 360) % 360;

export class NavDb {
  readonly airports = new Map<string, DbAirport>();
  readonly navaids: DbNavaid[] = NAVAIDS;
  private readonly fixes = new Map<string, NavFix[]>();
  readonly airways: Record<string, string[]> = AIRWAYS;
  readonly coRoutes: DbCoRoute[] = CO_ROUTES;
  private readonly wptList: NavFix[] = [];

  constructor() {
    for (const a of AIRPORTS) this.airports.set(a.icao, a);
    for (const [ident, lat, lon] of WAYPOINTS) {
      const f: NavFix = { ident, lat, lon, kind: 'wpt' };
      this.addFix(f);
      this.wptList.push(f);
    }
    for (const n of NAVAIDS) {
      if (n.type === 'ILS') continue;
      this.addFix({ ident: n.ident, lat: n.lat, lon: n.lon, kind: navaidKind(n), navaid: n });
    }
    for (const a of AIRPORTS) this.addFix({ ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport', airport: a });
  }

  private addFix(f: NavFix) {
    const l = this.fixes.get(f.ident);
    if (l) l.push(f); else this.fixes.set(f.ident, [f]);
  }

  /** All database fixes with this ident (waypoints, navaids, airports). */
  lookup(ident: string): NavFix[] {
    return this.fixes.get(ident.toUpperCase()) ?? [];
  }

  /** Best fix with this ident (closest to the reference position when duplicated). */
  fix(ident: string, near?: { lat: number; lon: number }): NavFix | undefined {
    const l = this.lookup(ident);
    if (l.length <= 1 || !near) return l[0];
    let best = l[0], bd = Infinity;
    for (const f of l) {
      const d = distanceNm(near.lat, near.lon, f.lat, f.lon);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }

  airport(icao: string): DbAirport | undefined {
    return this.airports.get(icao.toUpperCase());
  }

  runway(ap: DbAirport, ident: string): DbRunway | undefined {
    return ap.runways.find((r) => r.ident === ident);
  }

  /** Navaid (VOR/DME/NDB/ILS) by ident, closest to reference. */
  navaid(ident: string, near?: { lat: number; lon: number }): DbNavaid | undefined {
    const l = this.navaids.filter((n) => n.ident === ident.toUpperCase());
    if (!l.length) return undefined;
    if (!near) return l[0];
    return l.reduce((a, b) => (distanceNm(near.lat, near.lon, a.lat, a.lon) <= distanceNm(near.lat, near.lon, b.lat, b.lon) ? a : b));
  }

  /** Navaids tuned on a frequency (closest first). */
  navaidsByFreq(freq: number, types: DbNavaid['type'][], near?: { lat: number; lon: number }): DbNavaid[] {
    const l = this.navaids.filter((n) => types.includes(n.type) && Math.abs(n.freq - freq) < 0.004);
    if (near) l.sort((a, b) => distanceNm(near.lat, near.lon, a.lat, a.lon) - distanceNm(near.lat, near.lon, b.lat, b.lon));
    return l;
  }

  ilsForRunway(ap: DbAirport, rwy: DbRunway): DbNavaid | undefined {
    return rwy.ils ? this.navaids.find((n) => n.type === 'ILS' && n.ident === rwy.ils && n.runway === ap.icao + rwy.ident) : undefined;
  }

  /** Fixes of an airway strictly after `from` up to and including `to` (null if not on the airway). */
  airwaySegment(awy: string, from: string, to: string): string[] | null {
    const l = this.airways[awy.toUpperCase()];
    if (!l) return null;
    const i = l.indexOf(from), j = l.indexOf(to);
    if (i < 0 || j < 0 || i === j) return null;
    return i < j ? l.slice(i + 1, j + 1) : l.slice(j, i).reverse();
  }

  coRoute(ident: string): DbCoRoute | undefined {
    return this.coRoutes.find((r) => r.ident === ident.toUpperCase());
  }

  coRoutesFor(from: string, to: string): DbCoRoute[] {
    return this.coRoutes.filter((r) => r.from === from && r.to === to);
  }

  /** Nearby items for the ND (ARPT, VOR.D, NDB, WPT options). */
  nearby(kind: 'airport' | 'vor' | 'ndb' | 'wpt', lat: number, lon: number, radiusNm: number): NavPoint[] {
    const out: NavPoint[] = [];
    const dLat = radiusNm / 60;
    const within = (la: number, lo: number) => Math.abs(la - lat) <= dLat && distanceNm(lat, lon, la, lo) <= radiusNm;
    if (kind === 'airport') {
      for (const a of this.airports.values()) if (within(a.lat, a.lon)) out.push({ ident: a.icao, kind: 'airport', lat: a.lat, lon: a.lon, elevation: a.elevFt });
    } else if (kind === 'wpt') {
      for (const w of this.wptList) if (!/\d/.test(w.ident) && within(w.lat, w.lon)) out.push({ ident: w.ident, kind: 'wpt', lat: w.lat, lon: w.lon });
    } else {
      for (const n of this.navaids) {
        const ok = kind === 'ndb' ? n.type === 'NDB' : n.type === 'VOR' || n.type === 'VORDME' || n.type === 'DME';
        if (ok && within(n.lat, n.lon)) out.push({ ident: n.ident, kind: navaidKind(n), lat: n.lat, lon: n.lon, freq: n.freq });
      }
    }
    return out;
  }
}

let shared: NavDb | undefined;
export function navDb(): NavDb {
  return (shared ??= new NavDb());
}
