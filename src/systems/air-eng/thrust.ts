/**
 * CFM56-5B4/P thrust rating limits computed by the FADEC (N1 %), displayed at the top right of the E/WD.
 *
 * Each rating is flat-rated in corrected N1 (N1c = N1/√θ2) up to a "corner point" temperature, then
 * decreases linearly with the (actual or FLEX/assumed) temperature. Data per pressure altitude:
 * [altitude ft, corner point °C, N1c flat %, N1c slope %/°C above the corner point].
 * Values are consistent with the CFM56-5B4 E/WD limits seen in service (TOGA ≈ 84.5-85.5 % N1 at sea
 * level ISA, FLX 5-7 % lower, CLB 88-96 % in climb/cruise), and with the ratings used in the
 * FlyByWire A32NX engine model (GPL data from real-aircraft observations).
 *
 * Note: 104 % is the N1 red line (mechanical limit), not the take-off N1: the CFM56-5B4 is flat-rated
 * at 27 000 lbf and reaches it at ~85 % N1 at sea level up to ISA+29 °C.
 */
import { clamp, interp } from './common';

type Row = readonly [alt: number, cp: number, n1cFlat: number, slope: number];

const TO: ReadonlyArray<Row> = [
  [-2000, 48, 83.3, 0.27], [0, 44, 84.6, 0.27], [2000, 40, 86.3, 0.28], [4000, 32, 88.2, 0.3], [6000, 25, 91.0, 0.32],
  [8000, 17, 94.0, 0.34], [10000, 13, 95.7, 0.35], [12000, 11, 96.3, 0.36], [14000, 10, 96.1, 0.36], [16600, 5, 96.6, 0.36],
];
const MCT: ReadonlyArray<Row> = [
  [-1000, 27, 82.5, 0.31], [3000, 18.2, 86.3, 0.31], [7000, 9.2, 89.1, 0.31], [11000, 4, 92.2, 0.35], [15000, -5.2, 96.0, 0.39],
  [20000, -15.1, 99.3, 0.41], [25000, -25.4, 98.4, 0.41], [31000, -36.8, 98.7, 0.41], [35000, -43.6, 98.4, 0.43], [39000, -47.3, 97.3, 0.41],
];
const CLB: ReadonlyArray<Row> = [
  [-2000, 30.8, 80.3, 0.32], [2000, 21, 82.6, 0.31], [5000, 16.1, 84.6, 0.33], [8000, 7.3, 86.8, 0.31], [10000, 4.1, 88.2, 0.34],
  [12000, 0.8, 88.3, 0.32], [15000, -4.9, 89.7, 0.33], [20000, -15.8, 92.1, 0.35], [24000, -22.8, 93.7, 0.38], [27000, -29.1, 93.8, 0.36],
  [31000, -35, 95.4, 0.39], [35000, -45.7, 96.1, 0.38], [39000, -45.7, 96.2, 0.4],
];

function row(table: ReadonlyArray<Row>, alt: number): { cp: number; flat: number; slope: number } {
  const col = (i: 1 | 2 | 3) => interp(table.map((r) => [r[0], r[i]] as const), alt);
  return { cp: col(1), flat: col(2), slope: col(3) };
}

export type Rating = 'TO' | 'MCT' | 'CLB';

export interface LimitInputs {
  pressAlt: number;
  oat: number;
  mach: number;
  packs: boolean;
  nai: boolean;
  wai: boolean;
}

/** Corrected N1 of a rating at a (possibly assumed) temperature. */
export function ratingN1c(r: Rating, alt: number, temp: number): number {
  const t = r === 'TO' ? TO : r === 'MCT' ? MCT : CLB;
  const { cp, flat, slope } = row(t, alt);
  return temp <= cp ? flat : flat - (temp - cp) * slope;
}

/** θ2 (total temperature ratio). */
export function theta2(oat: number, mach: number): number {
  return ((oat + 273.15) * (1 + 0.2 * mach * mach)) / 288.15;
}

function bleedDelta(r: Rating, i: LimitInputs): number {
  if (r === 'TO') return (i.packs ? -0.4 : 0) + (i.nai ? -0.6 : 0) + (i.wai ? -0.7 : 0);
  return (i.packs ? -0.3 : 0) + (i.nai ? -0.8 : 0) + (i.wai ? -1.0 : 0);
}

/** Typical mach used by the FADEC for each rating (take-off: actual; CLB/MCT: climb speed schedule in flight). */
function ratingMach(r: Rating, i: LimitInputs): number {
  return r === 'TO' ? Math.min(i.mach, 0.3) : i.mach;
}

/** N1 limit (%) of a rating at actual conditions. */
export function limitN1(r: Rating, i: LimitInputs): number {
  const n1c = ratingN1c(r, i.pressAlt, i.oat);
  return n1c * Math.sqrt(theta2(i.oat, ratingMach(r, i))) + bleedDelta(r, i);
}

/** Maximum FLEX temperature (TMAX FLX ≈ ISA + 60 °C at the airport). */
export function maxFlexTemp(pressAlt: number): number {
  return 15 - 1.98 * (pressAlt / 1000) + 60;
}

/** FLEX N1 (%): TO rating at the assumed temperature, never above TOGA, never below 25 % thrust reduction. */
export function flexN1(flexTemp: number, i: LimitInputs): number {
  const assumed = clamp(Math.max(flexTemp, i.oat), -60, maxFlexTemp(i.pressAlt));
  const n1c = ratingN1c('TO', i.pressAlt, assumed);
  return Math.min(limitN1('TO', i), n1c * Math.sqrt(theta2(i.oat, Math.min(i.mach, 0.3))) + bleedDelta('TO', i));
}

/** Max reverse N1 (%). */
export function mrevN1(i: LimitInputs): number {
  return 71 * Math.sqrt(theta2(i.oat, 0));
}
