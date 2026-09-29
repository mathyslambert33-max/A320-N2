/**
 * Nav database types (ARINC 424-like, simplified). DOM-free.
 */

export type NavaidType = 'VOR' | 'VORDME' | 'DME' | 'NDB' | 'ILS';

export interface DbNavaid {
  ident: string;
  name: string;
  type: NavaidType;
  lat: number;
  lon: number;
  /** MHz for VOR/DME/ILS, kHz for NDB. */
  freq: number;
  elev?: number;
  /** ILS localizer course (magnetic). */
  course?: number;
  /** ILS: airport+runway served, e.g. 'LFPO25'. */
  runway?: string;
}

export interface AltCstr {
  /** at, at or above (+), at or below (-), window. Altitudes in feet (FL070 = 7000). */
  type: 'at' | 'above' | 'below' | 'between';
  alt: number;
  /** For 'between': upper = alt, lower = alt2. */
  alt2?: number;
}

/** ARINC 424 path terminators used here. */
export type LegType = 'IF' | 'TF' | 'CF' | 'DF' | 'CA' | 'VA' | 'VM' | 'FM';

export interface ProcLeg {
  t: LegType;
  /** Fix ident (none for CA/VA/VM/FM). */
  fix?: string;
  /** Magnetic course for CF/CA/VA/FM legs. */
  crs?: number;
  alt?: AltCstr;
  /** Max IAS at the fix (kt). */
  spd?: number;
  ovfy?: boolean;
  turn?: 'L' | 'R';
  /** Insert a F-PLN DISCONTINUITY after this leg (radar vectoring / manual termination). */
  disco?: boolean;
}

export interface DbTransition {
  ident: string;
  legs: ProcLeg[];
}

export interface DbProcedure {
  /** e.g. 'CNA6P' (ARINC 6-char ident as shown on the MCDU). */
  ident: string;
  /** Chart name, e.g. 'CNA 6P'. */
  name: string;
  runways: string[];
  /** SID: runway -> end of common part. STAR: common part -> IAF. */
  legs: ProcLeg[];
  /** SID: en-route transitions after the common part. STAR: en-route transitions before it. */
  trans: DbTransition[];
  rnav?: boolean;
}

export interface DbApproach {
  /** MCDU name, e.g. 'ILS25'. */
  ident: string;
  runway: string;
  type: 'ILS' | 'LOC' | 'RNAV' | 'VOR';
  /** Approach transitions (VIAS), e.g. ODILO. */
  vias: DbTransition[];
  /** Final approach legs from IF to the runway (runway itself not included). */
  legs: ProcLeg[];
  /** Missed approach legs. */
  missed: ProcLeg[];
  /** Localizer ident for ILS/LOC. */
  ils?: string;
}

export interface DbRunway {
  /** '23', '06', '26R' ... */
  ident: string;
  /** Landing threshold (displaced threshold when there is one). */
  lat: number;
  lon: number;
  /** Physical start of runway for take-off, if different from the landing threshold. */
  startLat?: number;
  startLon?: number;
  magCrs: number;
  trueCrs: number;
  lengthM: number;
  /** Threshold elevation (ft). */
  elevFt: number;
  ils?: string;
  gsAngle?: number;
  /** Threshold crossing height (ft). */
  tchFt?: number;
}

export interface DbAirport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevFt: number;
  /** Transition altitude (ft) and default transition level (FL). */
  transAlt: number;
  transFl: number;
  runways: DbRunway[];
  sids: DbProcedure[];
  stars: DbProcedure[];
  approaches: DbApproach[];
}

export interface CoRouteElement {
  /** Airway ident or 'DCT'. */
  via: string;
  to: string;
}

export interface DbCoRoute {
  ident: string;
  from: string;
  to: string;
  altn?: string;
  altnCoRoute?: string;
  costIndex?: number;
  crzFl?: number;
  depRwy?: string;
  sid?: string;
  sidTrans?: string;
  route: CoRouteElement[];
  star?: string;
  starTrans?: string;
  approach?: string;
  appVia?: string;
}
