/**
 * MCDU data entry formats, display formatting and scratchpad messages (FCOM DSC-22_20 "MCDU data format" /
 * "MCDU messages"). DOM-free.
 */

export interface McduMessage {
  text: string;
  amber: boolean;
  /** Type II messages are queued and stay until cleared / condition disappears. */
  type2?: boolean;
}

const m1 = (text: string, amber = false): McduMessage => ({ text, amber });
const m2 = (text: string, amber = false): McduMessage => ({ text, amber, type2: true });

export const MSG = {
  NOT_ALLOWED: m1('NOT ALLOWED'),
  FORMAT_ERROR: m1('FORMAT ERROR'),
  ENTRY_OUT_OF_RANGE: m1('ENTRY OUT OF RANGE'),
  NOT_IN_DATABASE: m1('NOT IN DATA BASE'),
  AWY_WPT_MISMATCH: m1('AWY/WPT MISMATCH'),
  SELECT_DESIRED_SYSTEM: m1('SELECT DESIRED SYSTEM'),
  TMPY_FPLN_EXISTS: m1('TMPY F-PLN EXISTS'),
  CHECK_TAKE_OFF_DATA: m2('CHECK TAKE OFF DATA', true),
  INITIALIZE_WEIGHT_CG: m2('INITIALIZE WEIGHT/CG', true),
  V1_VR_V2_DISAGREE: m2('V1/VR/V2 DISAGREE', true),
  SET_HOLD_SPEED: m2('SET HOLD SPEED'),
  GPS_PRIMARY: m2('GPS PRIMARY'),
  GPS_PRIMARY_LOST: m2('GPS PRIMARY LOST', true),
  NAV_ACCUR_UPGRAD: m2('NAV ACCUR UPGRAD'),
  NAV_ACCUR_DOWNGRAD: m2('NAV ACCUR DOWNGRAD', true),
  DEST_EFOB_BELOW_MIN: m2('DEST EFOB BELOW MIN', true),
  CHECK_DEST_DATA: m2('CHECK DEST DATA', true),
  ENTER_DEST_DATA: m2('ENTER DEST DATA', true),
  CHECK_GW: m2('CHECK GW', true),
  KEY_NOT_ACTIVE: m1('KEY NOT ACTIVE'),
  LIST_OF_20_IN_USE: m1('LIST OF 20 IN USE'),
  RWY_ILS_MISMATCH: m2('RWY/LS MISMATCH', true),
} as const;

export type Result = McduMessage | void;

/* ------------------------------------------------------------------ helpers */

export const pad = (s: string | number, n: number, ch = ' ') => String(s).padStart(n, ch);
export const padR = (s: string | number, n: number, ch = ' ') => String(s).padEnd(n, ch);
export const box = (n: number) => '□'.repeat(n);

/** "4449.8N" */
export function fmtLat(lat: number, dec = 1): string {
  const a = Math.abs(lat);
  let d = Math.floor(a);
  let m = +((a - d) * 60).toFixed(dec);
  if (m >= 60) { d += 1; m = 0; }
  return `${pad(d, 2, '0')}${pad(m.toFixed(dec), 3 + dec, '0')}${lat >= 0 ? 'N' : 'S'}`;
}

/** "00042.9W" */
export function fmtLon(lon: number, dec = 1): string {
  const a = Math.abs(lon);
  let d = Math.floor(a);
  let m = +((a - d) * 60).toFixed(dec);
  if (m >= 60) { d += 1; m = 0; }
  return `${pad(d, 3, '0')}${pad(m.toFixed(dec), 3 + dec, '0')}${lon >= 0 ? 'E' : 'W'}`;
}

export function parseLat(s: string): number | null {
  const r = /^(\d{2})(\d{2}(?:\.\d)?)([NS])$/.exec(s) ?? /^([NS])(\d{2})(\d{2}(?:\.\d)?)$/.exec(s);
  if (!r) return null;
  const [d, m, h] = r[1] === 'N' || r[1] === 'S' ? [r[2], r[3], r[1]] : [r[1], r[2], r[3]];
  const v = +d + +m / 60;
  if (+d > 90 || +m >= 60) return NaN;
  return h === 'S' ? -v : v;
}

export function parseLon(s: string): number | null {
  const r = /^(\d{3})(\d{2}(?:\.\d)?)([EW])$/.exec(s) ?? /^([EW])(\d{3})(\d{2}(?:\.\d)?)$/.exec(s);
  if (!r) return null;
  const [d, m, h] = r[1] === 'E' || r[1] === 'W' ? [r[2], r[3], r[1]] : [r[1], r[2], r[3]];
  const v = +d + +m / 60;
  if (+d > 180 || +m >= 60) return NaN;
  return h === 'W' ? -v : v;
}

/** Time in minutes -> "hhmm". */
export function hhmm(min: number): string {
  const t = Math.max(0, Math.round(min));
  return `${pad(Math.floor(t / 60) % 100, 2, '0')}${pad(t % 60, 2, '0')}`;
}

/** Tonnes with one decimal from kg. */
export const t1 = (kg: number) => (kg / 1000).toFixed(1);

/** Altitude display: "FL350" above the transition, else feet. */
export function fmtAlt(ft: number, transFt: number, width = 5): string {
  if (ft >= transFt + 1) return `FL${pad(Math.round(ft / 100), 3, '0')}`;
  return pad(Math.round(ft / 10) * 10, width);
}

export function fmtTemp(c: number): string {
  return `${c >= 0 ? '+' : '-'}${Math.abs(Math.round(c))}°`;
}

/* ------------------------------------------------------------------ parsers (return null = FORMAT ERROR) */

const num = (s: string) => (/^[+-]?\d+(\.\d+)?$/.test(s) ? +s : null);

/** Integer within [min,max]: returns number, or a message. */
export function parseInt3(s: string, min: number, max: number, maxLen = 3): number | McduMessage {
  if (!/^\d+$/.test(s) || s.length > maxLen) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** Weight in tonnes "57.6" / "57" -> kg. */
export function parseWeight(s: string, min: number, max: number): number | McduMessage {
  if (!/^\d{1,3}(\.\d)?$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return Math.round(v * 1000);
}

/** CG % MAC "27.4". */
export function parseCg(s: string): number | McduMessage {
  if (!/^\d{1,2}(\.\d)?$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < 8 || v > 50) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** Temperature -99..+99. */
export function parseTemp(s: string, min = -99, max = 99): number | McduMessage {
  if (!/^[+-]?\d{1,2}$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** Flight level entry "350" or "FL350" -> FL number. */
export function parseFl(s: string): number | McduMessage {
  const r = /^(?:FL)?(\d{1,3})$/.exec(s);
  if (!r) return MSG.FORMAT_ERROR;
  const v = +r[1];
  if (v < 10 || v > 398) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** Altitude "5000", "FL070" (-> ft). */
export function parseAltitude(s: string, min = -1000, max = 39800): number | McduMessage {
  let v: number | null;
  const fl = /^FL(\d{1,3})$/.exec(s);
  if (fl) v = +fl[1] * 100;
  else if (/^\d{1,5}$/.test(s)) v = +s;
  else return MSG.FORMAT_ERROR;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** Speed kt 90..350 or Mach ".78". */
export function parseSpeed(s: string, min = 90, max = 350): number | McduMessage {
  if (/^0?\.\d{2}$/.test(s)) {
    const m = +s;
    if (m < 0.15 || m > 0.82) return MSG.ENTRY_OUT_OF_RANGE;
    return m;
  }
  if (!/^\d{2,3}$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** VOR frequency 108.00-117.95 MHz. */
export function parseVorFreq(s: string): number | McduMessage | null {
  if (!/^\d{3}(\.\d{1,2})?$/.test(s)) return null;
  const v = +s;
  if (v < 108 || v > 117.95) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** ILS frequency 108.10-111.95 MHz (odd tenths). */
export function parseIlsFreq(s: string): number | McduMessage | null {
  if (!/^\d{3}(\.\d{1,2})?$/.test(s)) return null;
  const v = +s;
  if (v < 108.1 || v > 111.95) return MSG.ENTRY_OUT_OF_RANGE;
  const tenth = Math.floor(Math.round(v * 100) / 10) % 10;
  if (tenth % 2 === 0) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

/** ADF frequency 190.0-1750.0 kHz. */
export function parseAdfFreq(s: string): number | McduMessage | null {
  if (!/^\d{3,4}(\.\d)?$/.test(s)) return null;
  const v = +s;
  if (v < 190 || v > 1750) return MSG.ENTRY_OUT_OF_RANGE;
  return v;
}

export function parseCourse(s: string): number | McduMessage {
  if (!/^\d{1,3}$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v > 360) return MSG.ENTRY_OUT_OF_RANGE;
  return v % 360;
}

/** THS for take-off: "UP1.0", "1.0UP", "DN0.5", "0.5DN" -> + nose up. */
export function parseThs(s: string): number | McduMessage {
  const r = /^(UP|DN)(\d(?:\.\d)?)$/.exec(s) ?? /^(\d(?:\.\d)?)(UP|DN)$/.exec(s);
  if (!r) return MSG.FORMAT_ERROR;
  const [dir, val] = r[1] === 'UP' || r[1] === 'DN' ? [r[1], r[2]] : [r[2], r[1]];
  const v = +val;
  if (v > 2.5 && dir === 'UP') return MSG.ENTRY_OUT_OF_RANGE;
  if (v > 2.5 && dir === 'DN') return MSG.ENTRY_OUT_OF_RANGE;
  return dir === 'UP' ? v : -v;
}

export function fmtThs(v: number): string {
  return `${v >= 0 ? 'UP' : 'DN'}${Math.abs(v).toFixed(1)}`;
}

/** Wind "240/08" or "240/8" -> {dir, spd}. */
export function parseWind(s: string): { dir: number; spd: number } | McduMessage {
  const r = /^(\d{1,3})\/(\d{1,3})$/.exec(s);
  if (!r) return MSG.FORMAT_ERROR;
  const dir = +r[1], spd = +r[2];
  if (dir > 360 || spd > 250) return MSG.ENTRY_OUT_OF_RANGE;
  return { dir: dir % 360, spd };
}

/** Trip wind "HD010" / "TL005" / "-10" / "+5" -> kt (+ tail). */
export function parseTripWind(s: string): number | McduMessage {
  const r = /^(HD|H|-|TL|T|\+)?(\d{1,3})$/.exec(s);
  if (!r) return MSG.FORMAT_ERROR;
  const v = +r[2];
  if (v > 250) return MSG.ENTRY_OUT_OF_RANGE;
  const head = r[1] === 'HD' || r[1] === 'H' || r[1] === '-';
  return head ? -v : v;
}

export const fmtTripWind = (kt: number) => `${kt < 0 ? 'HD' : 'TL'}${pad(Math.abs(Math.round(kt)), 3, '0')}`;

export const isMsg = (v: unknown): v is McduMessage => typeof v === 'object' && v !== null && 'text' in (v as any);

export { num };
