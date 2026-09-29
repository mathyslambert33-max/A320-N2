/**
 * World coordinates (world agent). Pure math, no THREE dependency, unit tested.
 *
 * Three frames:
 *  - geodetic lat/lon (deg);
 *  - "data" frame of the generated airport data (src/world/data/lfbd.ts): x = east, y = north (m), origin at the
 *    scenario point 44.83095 N, 0.70438 W (equirectangular, < 5 cm error over the airport);
 *  - three.js world: the aircraft eye station sits at the world origin (float precision near the camera),
 *    X = east, Y = up (ground at Y = 0), Z = south.
 */
export const DATA_ORIGIN = { lat: 44.83095, lon: -0.70438 } as const;
export const KX = 111320 * Math.cos((DATA_ORIGIN.lat * Math.PI) / 180);
export const KY = 111132;

/**
 * Cockpit floor height above the apron (m). The Airbus AC document gives passenger door 1 sill heights of about
 * 3.4 m for the A320 and the cabin floor continues flat into the flight deck, so the cockpit floor is ~3.40 m
 * above the ground (layout.ts says 2.55 m, which would put the door sill 0.85 m too low for the jet bridge).
 */
export const FLOOR_HEIGHT = 3.4;

/** Attitude on the ground (deg): + nose up / + right wing down. Same values as the ADIRS ground attitude (sys-misc). */
export const GROUND_PITCH = 0.4;
export const GROUND_ROLL = 0.1;

export function latLonToData(lat: number, lon: number): [number, number] {
  return [(lon - DATA_ORIGIN.lon) * KX, (lat - DATA_ORIGIN.lat) * KY];
}

export function dataToLatLon(x: number, y: number): [number, number] {
  return [DATA_ORIGIN.lat + y / KY, DATA_ORIGIN.lon + x / KX];
}

/**
 * Stand 14 (scenario: "Hall A, nose-in, true heading 298°").
 *
 * Real geometry (OpenStreetMap "Hall A" footprint): the aircraft is parked nose-in against the south-east facade of
 * the Hall A boarding pier (jetée, the side of gates B8/B9), a straight glazed facade running 045°/225° whose
 * outward normal points 135°. A true heading of 298° puts the nose 17° left of perpendicular, like the angled
 * stands found along that pier. The eye station is `dist` metres in front of the facade (nose ≈ 9 m from the
 * glass), in front of gate door B9.
 */
export const PIER_FACADE = {
  /** A point of the pier's south-east facade (gate B9 door), data frame. */
  p0: [1.6, -65.6] as [number, number],
  /** Unit vector along the facade toward its north-east end (bearing 045.2°). */
  dir: [0.70948, 0.70473] as [number, number],
  /** Outward unit normal (toward the apron, bearing 135.2°). */
  nrm: [0.70473, -0.70948] as [number, number],
  /** Facade extent along `dir` (m, relative to p0). */
  from: -166,
  to: 30.3,
};

export interface StandDef {
  name: string;
  /** Eye station position in the data frame (m). */
  x: number;
  y: number;
  /** True heading (deg). */
  heading: number;
}

function standOnPier(along: number, dist: number, heading: number, name: string): StandDef {
  const f = PIER_FACADE;
  return {
    name,
    x: f.p0[0] + along * f.dir[0] + dist * f.nrm[0],
    y: f.p0[1] + along * f.dir[1] + dist * f.nrm[1],
    heading,
  };
}

export const STAND_14: StandDef = standOnPier(0, 12, 298, '14');

/** Unit vector (east, north) of a true bearing. */
export function bearingVec(deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/** Data frame (x east, y north) → three.js world (X, Z) relative to the stand eye point. */
export function dataToWorldXZ(x: number, y: number, stand: StandDef = STAND_14): [number, number] {
  return [x - stand.x, -(y - stand.y)];
}

/**
 * Aircraft body frame (+X right, +Y up from the cockpit floor, −Z forward) → data frame (x, y) and height above
 * ground, for an aircraft standing at `stand` (level attitude).
 */
export function bodyToData(bx: number, by: number, bz: number, stand: StandDef = STAND_14): [number, number, number] {
  const [fe, fn] = bearingVec(stand.heading); // forward
  const re = fn, rn = -fe; // right = forward rotated +90°
  return [stand.x + bx * re - bz * fe, stand.y + bx * rn - bz * fn, by + FLOOR_HEIGHT];
}

/** Rotation of the aircraft group about +Y (radians) for a true heading. */
export function headingToRotY(headingDeg: number): number {
  return (-headingDeg * Math.PI) / 180;
}
