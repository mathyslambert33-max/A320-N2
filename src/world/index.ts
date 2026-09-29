/**
 * World module (world agent): LFBD airport around stand 14, sky / sun / moon / weather, exterior A320, exterior
 * lights, ground equipment driven by the G: ground-service variables. See docs/vars/world.md.
 */
import * as THREE from 'three';
import type { App } from '../app';
import type { TimeOfDay } from '../core/settings';
import { Environment } from './env/environment';
import { dataToLatLon, FLOOR_HEIGHT, GROUND_PITCH, GROUND_ROLL, headingToRotY, STAND_14, type StandDef } from './geo';
import { buildGround } from './airport/ground';
import { buildBuildings } from './airport/buildings';
import { setMaxAnisotropy } from './mat/textures';
import { markCaster } from './env/lighting';
import { WL_DEBUG } from './env/worldMaterial';

export interface WorldApi {
  stand: StandDef;
  floorHeight: number;
  env: Environment;
  /** Time of day currently displayed. */
  timeOfDay(): TimeOfDay;
  setTimeOfDay(tod: TimeOfDay): void;
  /** Force the exterior shadow cascades to re-render (after moving exterior objects). */
  invalidateShadows(): void;
  /** Root groups. */
  groups: { airport: THREE.Group; exterior: THREE.Group };
}

export default async function install(app: App): Promise<void> {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const stand = STAND_14;
  let tod: TimeOfDay = app.settings.get().timeOfDay;
  if (app.isHarness) {
    tod = q.get('night') === '1' ? 'night' : ((q.get('tod') as TimeOfDay) || 'day');
    // the harness applied the 'day' scenario unless &night=1: align the UTC time for &tod=dusk
    if (q.get('tod')) {
      const { weatherFor } = await import('../core/scenario');
      app.sim.set('G:TIME_UTC', weatherFor(tod).utcHour * 3600);
    }
    // remove the harness studio lights (the world brings the real sun/sky)
    for (const o of [...app.scene.children]) if ((o as THREE.Light).isLight) app.scene.remove(o);
    app.scene.environment = null;
    app.scene.background = null;
  }
  setMaxAnisotropy(app.renderer.capabilities.getMaxAnisotropy());
  /** Harness debug switches: &wno=sky,env,shadows,ground */
  const wno = new Set((app.isHarness ? q.get('wno') ?? '' : '').split(',').filter(Boolean));
  WL_DEBUG.noPatch = wno.has('patch');
  WL_DEBUG.noLights = wno.has('lights');
  WL_DEBUG.noShadows = wno.has('wshadows');

  // --- aircraft placement: eye station at the world origin, floor 3.40 m above the apron ---
  const ac = app.aircraft;
  ac.position.set(0, FLOOR_HEIGHT, 0);
  ac.rotation.set((GROUND_PITCH * Math.PI) / 180, headingToRotY(stand.heading), (-GROUND_ROLL * Math.PI) / 180, 'YXZ');
  ac.updateMatrixWorld(true);

  // --- static attitude / position variables ---
  const [lat, lon] = dataToLatLon(stand.x, stand.y);
  const writePos = () => {
    app.sim.set('G:AC_LAT', lat);
    app.sim.set('G:AC_LON', lon);
    app.sim.set('G:AC_HDG_TRUE', stand.heading);
    app.sim.set('G:AC_ALT_AGL_FT', 0);
    app.sim.set('G:AC_PITCH', GROUND_PITCH);
    app.sim.set('G:AC_ROLL', GROUND_ROLL);
    app.sim.set('G:AC_VS_FPM', 0);
    app.sim.set('G:AC_GS_KT', 0);
    app.sim.set('G:AC_ON_GROUND', 1);
  };
  writePos();
  app.sim.register({ name: 'world-position', order: 1, update: writePos });

  // --- environment (sky, sun, key light, fog, environment map) ---
  const env = new Environment(app, tod, wno);
  env.cockpitCenter.copy(ac.localToWorld(new THREE.Vector3(0, 1.1, -0.6)));
  env.standCenter.copy(ac.localToWorld(new THREE.Vector3(0, -FLOOR_HEIGHT, 14)));

  // --- airport ---
  const airport = new THREE.Group();
  airport.name = 'world-airport';
  app.world.add(airport);
  if (!wno.has('ground')) {
    const ground = buildGround(stand, app.renderer.capabilities.getMaxAnisotropy(), wno);
    airport.add(ground.group);
  }

  const buildings = wno.has('buildings') ? null : buildBuildings(stand, new Set());
  if (buildings) airport.add(buildings.group);
  env.onChange((st) => buildings?.setNight(st.artificial * 1.2));

  const exterior = new THREE.Group();
  exterior.name = 'world-exterior';
  ac.add(exterior);
  markCaster(exterior);

  env.update(0, app.time(), true);
  app.onFrame((dt, t) => env.update(dt, t), -50);

  const api: WorldApi = {
    stand,
    floorHeight: FLOOR_HEIGHT,
    env,
    timeOfDay: () => env.state.tod,
    setTimeOfDay: (t) => env.setTimeOfDay(t, true),
    invalidateShadows: () => env.shadows.invalidate(),
    groups: { airport, exterior },
  };
  app.services.world = api;
  app.settings.onChange((s, key) => {
    if (key === 'timeOfDay' && s.timeOfDay !== env.state.tod) env.setTimeOfDay(s.timeOfDay, true);
  });
}
