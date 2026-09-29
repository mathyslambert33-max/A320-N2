/**
 * Contract between the FMGS (owner: mcdu module) and its consumers (ND, PFD, EFB).
 * The mcdu module installs an implementation at `sim.services.fmgs`.
 * Consumers must handle `sim.services.fmgs` being undefined.
 */

export type WaypointKind = 'wpt' | 'vor' | 'vordme' | 'dme' | 'ndb' | 'airport' | 'runway' | 'pseudo' | 'fix';

export interface NavPoint {
  ident: string;
  kind: WaypointKind;
  lat: number;
  lon: number;
  /** MHz for VOR/ILS, kHz for NDB. */
  freq?: number;
  /** For runways: true heading (deg) and threshold elevation. */
  heading?: number;
  elevation?: number;
}

export interface FlightPlanLeg {
  point: NavPoint;
  /** Leg type from ARINC 424 (TF, CF, DF, VA, CA, IF...). Informational. */
  legType?: string;
  /** Via: SID/STAR/airway name, or 'DIRECT'. */
  via?: string;
  altConstraint?: { type: 'at' | 'above' | 'below' | 'between'; alt: number; alt2?: number };
  speedConstraint?: number;
  /** Course to this leg's point (true deg), and distance from previous (NM). */
  course?: number;
  distance?: number;
  /** Predictions (may be absent on ground before PERF/INIT B). */
  predTimeMin?: number;
  predAlt?: number;
  predSpeed?: number;
  isMissedApproach?: boolean;
  overfly?: boolean;
}

export type FlightPlanItem = FlightPlanLeg | { discontinuity: true };

export interface FmgsApi {
  /** Active flight plan items in order (origin first). */
  activePlan(): FlightPlanItem[];
  /** Index of the TO waypoint in activePlan(). */
  toIndex(): number;
  origin(): NavPoint | undefined;
  destination(): NavPoint | undefined;
  departureRunway(): NavPoint | undefined;
  arrivalRunway(): NavPoint | undefined;
  /** Nav database lookups for ND display options (ARPT, VOR.D, NDB, WPT) within a radius. */
  nearby(kind: 'airport' | 'vor' | 'ndb' | 'wpt', lat: number, lon: number, radiusNm: number): NavPoint[];
  /** Tuned radio navaids (autotune or manual) for ND bottom corners / DDRMI. */
  tunedNavaids(): { vor1?: NavPoint; vor2?: NavPoint; adf1?: NavPoint; adf2?: NavPoint; ils?: NavPoint & { course: number } };
  /** Flight phase: 0 preflight, 1 takeoff, 2 climb, 3 cruise, 4 descent, 5 approach, 6 go-around, 7 done. */
  phase(): number;
  /** Text for the PFD FMA / ND (e.g. flight number) — optional niceties. */
  flightNumber(): string;
}

export function isLeg(item: FlightPlanItem): item is FlightPlanLeg {
  return !(item as any).discontinuity;
}

/* ------------ Geo helpers shared by FMGS and ND ------------ */

const R_NM = 3440.065;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in NM. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = p2 - p1, dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2 (deg 0..360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given start, true bearing (deg) and distance (NM). */
export function destinationPoint(lat: number, lon: number, brgDeg: number, distNm: number): { lat: number; lon: number } {
  const d = distNm / R_NM, b = toRad(brgDeg), p1 = toRad(lat), l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

/** Local flat projection (NM) of a point relative to a reference, x east, y north. */
export function localNm(refLat: number, refLon: number, lat: number, lon: number): { x: number; y: number } {
  const y = (lat - refLat) * 60;
  const x = (lon - refLon) * 60 * Math.cos(toRad(refLat));
  return { x, y };
}
