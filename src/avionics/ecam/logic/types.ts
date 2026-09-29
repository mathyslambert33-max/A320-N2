/**
 * Shared ECAM types (DOM-free).
 */

/** ECAM colours: W white, G green, A amber, R red, C cyan (Airbus "blue"), M magenta. */
export type Col = 'W' | 'G' | 'A' | 'R' | 'C' | 'M';

/** A run of text on an E/WD line. The warning/memo area uses a fixed character pitch. */
export interface Seg {
  t: string;
  c: Col;
  /** Underlined (system title of a failure, T.O / LDG memo title). */
  u?: boolean;
  /** Boxed (primary failure title in some standards). */
  box?: boolean;
  /** Flashing (e.g. IRS IN ALIGN when an alignment problem exists). */
  flash?: boolean;
}

export type Line = Seg[];

/** SD pages, numbering as published in S:ECAM_SD_PAGE (docs/SIMVARS.md). */
export enum SdPage {
  NONE = 0,
  ENG = 1,
  BLEED = 2,
  PRESS = 3,
  ELEC = 4,
  HYD = 5,
  FUEL = 6,
  APU = 7,
  COND = 8,
  DOOR = 9,
  WHEEL = 10,
  FCTL = 11,
  STS = 12,
  CRUISE = 13,
}

/** Pages cycled by the ALL key (in that order) and their ECP key ids. */
export const PAGE_KEYS: Array<[SdPage, string]> = [
  [SdPage.ENG, 'ECP_ENG'],
  [SdPage.BLEED, 'ECP_BLEED'],
  [SdPage.PRESS, 'ECP_PRESS'],
  [SdPage.ELEC, 'ECP_ELEC'],
  [SdPage.HYD, 'ECP_HYD'],
  [SdPage.FUEL, 'ECP_FUEL'],
  [SdPage.APU, 'ECP_APU'],
  [SdPage.COND, 'ECP_COND'],
  [SdPage.DOOR, 'ECP_DOOR'],
  [SdPage.WHEEL, 'ECP_WHEEL'],
  [SdPage.FCTL, 'ECP_FCTL'],
];

export const PAGE_NAMES: Record<number, string> = {
  0: 'NONE', 1: 'ENG', 2: 'BLEED', 3: 'PRESS', 4: 'ELEC', 5: 'HYD', 6: 'FUEL', 7: 'APU', 8: 'COND',
  9: 'DOOR', 10: 'WHEEL', 11: 'F/CTL', 12: 'STS', 13: 'CRUISE',
};

/** Alert levels: 3 = warning (red, MASTER WARN + CRC), 2 = caution (amber, MASTER CAUT + SC), 1 = caution without attention getters. */
export type Level = 1 | 2 | 3;

/** Aural alerts emitted as sim.emit('fwc:sound', { sound }). */
export type FwcSound = 'SC' | 'CRC' | 'CAVALRY' | 'CCHORD' | 'CLICK' | 'TRIPLECLICK' | 'BUZZER' | 'STOP_CRC';

/** One line of an ECAM procedure (below the alert title). */
export interface ProcLine {
  /** Text as displayed (24 columns max), e.g. ' -THR LEVER 1.......IDLE'. */
  text: string;
  /** Colour: 'C' actions (cyan), 'W' conditions / notes, 'A' amber sub-titles, 'G' info. */
  c: Col;
  /** When it returns true the line is removed (sensed action completed). */
  done?: () => boolean;
  /** Line displayed only when this returns true. */
  show?: () => boolean;
}

/** Contribution of an alert to the STATUS page. */
export interface StatusInfo {
  /** Limitations / procedures (cyan) and info (green / white) lines on the left side. */
  left?: Array<{ text: string; c: Col }>;
  /** INOP SYS (amber) on the right side. */
  inop?: string[];
}

export interface AlertDef {
  id: string;
  level: Level;
  /** System title (underlined), e.g. 'ELEC', 'ENG 1 FIRE', 'CONFIG'. */
  sys: string;
  /** Text after the system title on the same line, e.g. 'GEN 1 FAULT' (may be empty). */
  title: string;
  /** Optional extra title lines displayed in the alert colour (e.g. 'FLAPS NOT IN T.O CONFIG'). */
  sub?: string[] | (() => string[]);
  /** Flight phases in which a NEW occurrence is inhibited. */
  inhibit: number[];
  cond: () => boolean;
  /** Confirmation time before the alert is displayed (s). */
  confirm?: number;
  /** Aural alert (default CRC for level 3, SC for level 2, none for level 1). 'NONE' to suppress. */
  aural?: FwcSound | 'NONE';
  /** SD page called when the alert is displayed. */
  page?: SdPage;
  procedure?: () => ProcLine[];
  status?: () => StatusInfo;
  /** CLR does not remove it while active (config warnings, fire...). */
  noClear?: boolean;
  /** EMER CANC cannot cancel the aural (e.g. fire? no - fire CRC can be silenced). */
  noCancel?: boolean;
}
