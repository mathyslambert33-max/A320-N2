/**
 * Sun and moon positions (world agent). Pure functions, unit tested (tests/world/astro.test.ts).
 * Sun: NOAA solar position algorithm (Meeus), accuracy ~0.01° over 1950-2050.
 * Moon: low-precision lunar ephemeris (Astronomical Almanac), accuracy ~0.3°.
 */
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Scenario date: 27 September 2026 (the time of day comes from G:TIME_UTC). */
export const SCENARIO_DATE_UTC = Date.UTC(2026, 8, 27, 0, 0, 0);

export function julianDay(msUtc: number): number {
  return msUtc / 86400000 + 2440587.5;
}

export interface Horizontal {
  /** True azimuth (deg from north, clockwise). */
  azimuth: number;
  /** Apparent altitude above the horizon (deg, refraction included). */
  elevation: number;
}

/** Atmospheric refraction correction (deg) for an apparent elevation (Saemundsson-like, NOAA form). */
function refraction(el: number): number {
  if (el > 85) return 0;
  const te = Math.tan(el * D2R);
  let r: number;
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

function equatorialToHorizontal(raDeg: number, decDeg: number, lstDeg: number, latDeg: number): Horizontal {
  const H = (lstDeg - raDeg) * D2R;
  const dec = decDeg * D2R, lat = latDeg * D2R;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(-Math.sin(H) * Math.cos(dec), Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H));
  const el = alt * R2D;
  return { azimuth: norm360(az * R2D), elevation: el + refraction(el) };
}

/** Greenwich mean sidereal time (deg). */
export function gmst(msUtc: number): number {
  const jd = julianDay(msUtc);
  const T = (jd - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + T * T * (0.000387933 - T / 38710000));
}

export function sunPosition(msUtc: number, latDeg: number, lonDeg: number): Horizontal & { declination: number; eqTimeMin: number } {
  const jd = julianDay(msUtc);
  const T = (jd - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * D2R;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R)) * R2D;
  const ra = norm360(Math.atan2(Math.cos(eps * D2R) * Math.sin(lambda * D2R), Math.cos(lambda * D2R)) * R2D);
  const y = Math.tan((eps / 2) * D2R) ** 2;
  const L0r = L0 * D2R;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
    - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
  const h = equatorialToHorizontal(ra, decl, gmst(msUtc) + lonDeg, latDeg);
  return { ...h, declination: decl, eqTimeMin: eqTime };
}

export function moonPosition(msUtc: number, latDeg: number, lonDeg: number): Horizontal & { illumination: number; distanceKm: number } {
  const d = julianDay(msUtc) - 2451545.0;
  const L = norm360(218.316 + 13.176396 * d);
  const M = norm360(134.963 + 13.064993 * d) * D2R;
  const F = norm360(93.272 + 13.22935 * d) * D2R;
  const D = norm360(297.850 + 12.190749 * d) * D2R; // mean elongation
  const Ms = norm360(357.529 + 0.98560028 * d) * D2R; // sun mean anomaly
  // main periodic terms (evection, variation, annual equation)
  const lon = L + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) - 0.186 * Math.sin(Ms) + 0.214 * Math.sin(2 * M);
  const lat = 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);
  const eps = 23.4397 * D2R;
  const l = lon * D2R, b = lat * D2R;
  const ra = norm360(Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l)) * R2D);
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l)) * R2D;
  // topocentric parallax on altitude (~0.95°)
  const hor = equatorialToHorizontal(ra, dec, gmst(msUtc) + lonDeg, latDeg);
  const par = Math.asin(6378.14 / dist) * R2D * Math.cos(hor.elevation * D2R);
  // illuminated fraction from the sun-moon elongation (geocentric)
  const sun = sunEcliptic(d);
  const cosPsi = Math.cos(b) * Math.cos(l - sun * D2R);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const illumination = (1 - Math.cos(psi)) / 2;
  return { azimuth: hor.azimuth, elevation: hor.elevation - par, illumination, distanceKm: dist };
}

/** Apparent ecliptic longitude of the sun (deg) for d days since J2000. */
function sunEcliptic(d: number): number {
  const g = norm360(357.529 + 0.98560028 * d) * D2R;
  const q = norm360(280.459 + 0.98564736 * d);
  return norm360(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
}

/** Direction (three.js world: X east, Y up, Z south) of a horizontal position. */
export function horizontalToVec(h: Horizontal): [number, number, number] {
  const a = h.azimuth * D2R, e = h.elevation * D2R;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}

/** Equatorial (RA, Dec in deg) → three.js direction for a local sidereal time and latitude. */
export function equatorialToVec(raDeg: number, decDeg: number, lstDeg: number, latDeg: number): [number, number, number] {
  const H = (lstDeg - raDeg) * D2R;
  const dec = decDeg * D2R, lat = latDeg * D2R;
  // local frame: x east, y up, n north
  const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const east = -Math.cos(dec) * Math.sin(H);
  return [east, up, -north];
}

/**
 * Clear-sky solar illuminance factor and colour for a sun elevation (deg): simple air-mass model
 * (Kasten-Young air mass, Rayleigh + aerosol extinction per channel). Returns linear RGB transmittance.
 */
export function sunTransmittance(elevationDeg: number, turbidity = 2.5): [number, number, number] {
  if (elevationDeg < -2) return [0, 0, 0];
  const el = Math.max(elevationDeg, -1.5);
  const z = (90 - el) * D2R;
  const am = 1 / (Math.cos(z) + 0.50572 * Math.pow(Math.max(96.07995 - (90 - el), 0.01), -1.6364));
  // optical depths per channel (R 680, G 550, B 450 nm)
  const ray = [0.043, 0.094, 0.21];
  const aer = 0.035 * turbidity;
  const k = [0.9, 1.0, 1.15];
  const fade = elevationDeg < 0 ? Math.max(0, 1 + elevationDeg / 2) : 1;
  return [0, 1, 2].map((i) => Math.exp(-am * (ray[i] + aer * k[i])) * fade) as [number, number, number];
}
