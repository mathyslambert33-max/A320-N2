import { describe, expect, it } from 'vitest';
import { moonPosition, SCENARIO_DATE_UTC, sunPosition, sunTransmittance, horizontalToVec, equatorialToVec, gmst } from '../../src/world/astro';
import { STAND_14, bodyToData, dataToLatLon, latLonToData, dataToWorldXZ, headingToRotY, bearingVec, PIER_FACADE } from '../../src/world/geo';
import { decodeI16, decodeLines, decodePolys } from '../../src/world/data/decode';
import * as LFBD from '../../src/world/data/lfbd';

const LAT = 44.83095, LON = -0.70438;
const at = (h: number) => SCENARIO_DATE_UTC + h * 3600e3;

describe('sun position at LFBD, 27 Sep 2026', () => {
  it('day 12:00Z: sun due south, ~43.4° high', () => {
    const s = sunPosition(at(12), LAT, LON);
    expect(s.azimuth).toBeGreaterThan(181);
    expect(s.azimuth).toBeLessThan(183.5);
    expect(s.elevation).toBeGreaterThan(43.1);
    expect(s.elevation).toBeLessThan(43.8);
    expect(s.declination).toBeCloseTo(-1.9, 0);
  });
  it('dusk 17:30Z: low sun in the west (~3°), sunset ~17:51Z', () => {
    const s = sunPosition(at(17.5), LAT, LON);
    expect(s.azimuth).toBeGreaterThan(263);
    expect(s.azimuth).toBeLessThan(266);
    expect(s.elevation).toBeGreaterThan(2.6);
    expect(s.elevation).toBeLessThan(3.8);
    const set = sunPosition(at(17 + 51 / 60), LAT, LON);
    expect(Math.abs(set.elevation + 0.83)).toBeLessThan(0.5);
  });
  it('night 21:00Z: sun far below the horizon', () => {
    expect(sunPosition(at(21), LAT, LON).elevation).toBeLessThan(-30);
  });
  it('moon at 21:00Z: nearly full, rising in the ESE', () => {
    const m = moonPosition(at(21), LAT, LON);
    expect(m.illumination).toBeGreaterThan(0.9);
    expect(m.azimuth).toBeGreaterThan(75);
    expect(m.azimuth).toBeLessThan(130);
    expect(m.elevation).toBeGreaterThan(8);
    expect(m.elevation).toBeLessThan(40);
  });
  it('direction vectors: azimuth 90° is +X (east), 180° is +Z (south)', () => {
    const e = horizontalToVec({ azimuth: 90, elevation: 0 });
    expect(e[0]).toBeCloseTo(1, 6);
    const s = horizontalToVec({ azimuth: 180, elevation: 0 });
    expect(s[2]).toBeCloseTo(1, 6);
    // celestial pole is north at altitude = latitude
    const p = equatorialToVec(0, 90, gmst(at(12)) + LON, LAT);
    expect(Math.asin(p[1]) * 180 / Math.PI).toBeCloseTo(LAT, 4);
    expect(p[2]).toBeLessThan(0);
  });
  it('sun transmittance: white at noon, reddened near the horizon', () => {
    const noon = sunTransmittance(43);
    const low = sunTransmittance(3);
    expect(noon[2] / noon[0]).toBeGreaterThan(0.7);
    expect(low[2] / low[0]).toBeLessThan(0.45);
    expect(sunTransmittance(-5)).toEqual([0, 0, 0]);
  });
});

describe('stand geometry', () => {
  it('lat/lon round trip', () => {
    const [x, y] = latLonToData(44.84, -0.69);
    const [lat, lon] = dataToLatLon(x, y);
    expect(lat).toBeCloseTo(44.84, 9);
    expect(lon).toBeCloseTo(-0.69, 9);
  });
  it('stand 14 is 12 m in front of the Hall A pier facade, heading 298', () => {
    const f = PIER_FACADE;
    const dx = STAND_14.x - f.p0[0], dy = STAND_14.y - f.p0[1];
    expect(dx * f.nrm[0] + dy * f.nrm[1]).toBeCloseTo(12, 3);
    expect(STAND_14.heading).toBe(298);
    const [lat, lon] = dataToLatLon(STAND_14.x, STAND_14.y);
    expect(Math.abs(lat - 44.8302)).toBeLessThan(0.001);
    expect(Math.abs(lon + 0.7043)).toBeLessThan(0.001);
  });
  it('body frame: the nose points to 298°, the right wing to 028°', () => {
    const [x0, y0] = bodyToData(0, 0, 0);
    const [x1, y1] = bodyToData(0, 0, -10);
    const brg = (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
    expect((brg + 360) % 360).toBeCloseTo(298, 6);
    const [x2, y2] = bodyToData(10, 0, 0);
    expect(((Math.atan2(x2 - x0, y2 - y0) * 180) / Math.PI + 360) % 360).toBeCloseTo(28, 6);
    // three.js rotation: body forward (0,0,-1) rotated by rotY must equal the bearing vector (east, -north)
    const r = headingToRotY(298);
    const fx = -Math.sin(r), fz = -Math.cos(r);
    const [e, n] = bearingVec(298);
    expect(fx).toBeCloseTo(e, 9);
    expect(fz).toBeCloseTo(-n, 9);
    const [wx, wz] = dataToWorldXZ(x1, y1);
    expect(wx).toBeCloseTo(10 * e, 6);
    expect(wz).toBeCloseTo(-10 * n, 6);
  });
});

describe('generated LFBD data', () => {
  it('decodes little-endian int16 streams', () => {
    // [1, -2, 300] little endian
    const b64 = btoa(String.fromCharCode(1, 0, 0xfe, 0xff, 0x2c, 0x01));
    expect(Array.from(decodeI16(b64))).toEqual([1, -2, 300]);
  });
  it('pavements, markings and buildings decode into sane records', () => {
    const pave = decodePolys(LFBD.PAVEMENTS, 1, 0.1);
    expect(pave.length).toBeGreaterThan(50);
    for (const p of pave) {
      expect([1, 2]).toContain(p.head[0]);
      for (const r of p.rings) expect(r.length).toBeGreaterThanOrEqual(6);
    }
    const marks = decodeLines(LFBD.MARKINGS, 0.1);
    expect(marks.length).toBeGreaterThan(100);
    const blds = decodePolys(LFBD.BUILDINGS, 2, 0.1);
    expect(blds.length).toBeGreaterThan(1000);
    const pier = Object.entries(LFBD.BUILDING_NAMES).find(([, n]) => n === 'Hall A (pier)');
    expect(pier).toBeTruthy();
    const b = blds[Number(pier![0])];
    expect(b.head[1]).toBe(7);
    // the pier footprint contains a point just behind the facade in front of stand 14
    const f = PIER_FACADE;
    const px = f.p0[0] - 3 * f.nrm[0], py = f.p0[1] - 3 * f.nrm[1];
    const r = b.rings[0];
    let inside = false;
    for (let i = 0, j = r.length / 2 - 1; i < r.length / 2; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    expect(inside).toBe(true);
  });
  it('runways 05/23 and 11/29 with ~45 m width', () => {
    expect(LFBD.RUNWAYS.length).toBe(2);
    const ids = LFBD.RUNWAYS.map((r) => r.ends.map((e) => e.id).join('/'));
    expect(ids).toContain('05/23');
    expect(ids).toContain('11/29');
    const r = LFBD.RUNWAYS[0];
    const len = Math.hypot(r.ends[1].x - r.ends[0].x, r.ends[1].y - r.ends[0].y);
    expect(len).toBeGreaterThan(3000);
    expect(len).toBeLessThan(3200);
  });
});
