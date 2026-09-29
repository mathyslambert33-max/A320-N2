/**
 * Environment controller (world agent): time of day → sun / moon / sky / clouds / key light / fog / environment map.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { weatherFor, type Weather } from '../../core/scenario';
import type { TimeOfDay } from '../../core/settings';
import { gmst, horizontalToVec, moonPosition, SCENARIO_DATE_UTC, sunPosition, sunTransmittance } from '../astro';
import { DATA_ORIGIN } from '../geo';
import { SkySystem } from './sky';
import { FarShadows, KeyLight } from './lighting';
import { WU } from './worldMaterial';

export interface CloudLayer { baseFt: number; oktas: number }

/** Cloud layers from a METAR string (FEW 1-2, SCT 3-4, BKN 5-7, OVC 8 oktas). */
export function metarClouds(metar: string): CloudLayer[] {
  if (/CAVOK|SKC|NSC|CLR/.test(metar)) return [];
  const out: CloudLayer[] = [];
  for (const m of metar.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3})\b/g)) {
    out.push({ baseFt: Number(m[2]) * 100, oktas: m[1] === 'FEW' ? 1.5 : m[1] === 'SCT' ? 3.5 : m[1] === 'BKN' ? 6 : 8 });
  }
  return out;
}

export interface EnvState {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  sunEl: number;
  moonEl: number;
  moonIllum: number;
  /** 0 day .. 1 full night */
  night: number;
  /** apron floodlights / terminal lights on (0..1) */
  artificial: number;
  weather: Weather;
  tod: TimeOfDay;
}

export class Environment {
  readonly sky: SkySystem;
  readonly key: KeyLight;
  readonly shadows: FarShadows;
  readonly fog: THREE.FogExp2;
  envMap: THREE.Texture | null = null;
  readonly state: EnvState;
  /** Offset (s) added to G:TIME_UTC after a live time-of-day change. */
  private timeOffset = 0;
  private lastSunUpdate = -1e9;
  private lastEnv = -1e9;
  private envSunDir = new THREE.Vector3(0, -1, 0);
  private envNight = -1;
  private cloudOffset = new THREE.Vector2();
  /** World point of the cockpit centre (key light target). */
  readonly cockpitCenter = new THREE.Vector3();
  /** World point the stand shadow cascade is centred on. */
  readonly standCenter = new THREE.Vector3();
  /** Night key light: direction toward the dominant apron floodlight and its colour/intensity. */
  floodKey = { dir: new THREE.Vector3(0.3, 0.6, 0.5).normalize(), color: new THREE.Color(1, 0.93, 0.8), intensity: 0.25 };
  private readonly listeners: ((s: EnvState) => void)[] = [];
  private readonly tmpC = new THREE.Color();

  constructor(private app: App, tod: TimeOfDay) {
    this.sky = new SkySystem(app.renderer);
    app.scene.add(this.sky.group);
    this.key = new KeyLight(app.scene, app.quality);
    this.shadows = new FarShadows(app.renderer, app.scene, app.quality);
    this.fog = new THREE.FogExp2(0x9fb0c0, 0.00005);
    app.scene.fog = this.fog;
    this.state = {
      sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0), sunEl: 45, moonEl: -10, moonIllum: 1,
      night: 0, artificial: 0, weather: weatherFor(tod), tod,
    };
    this.setTimeOfDay(tod, false);
  }

  onChange(fn: (s: EnvState) => void) {
    this.listeners.push(fn);
  }

  /** Current UTC time used for the sky (ms since epoch). */
  utcMs(): number {
    const t = (this.app.sim.get('G:TIME_UTC') + this.timeOffset + 86400) % 86400;
    return SCENARIO_DATE_UTC + t * 1000;
  }

  setTimeOfDay(tod: TimeOfDay, live: boolean) {
    const w = weatherFor(tod);
    this.state.tod = tod;
    this.state.weather = w;
    if (live) this.timeOffset = w.utcHour * 3600 - this.app.sim.get('G:TIME_UTC');
    const layers = metarClouds(w.metar);
    const u = this.sky.uniforms;
    const L = [u.cloud0.value, u.cloud1.value];
    L.forEach((v) => v.set(0, 0, 1, 0));
    layers.slice(0, 2).forEach((l, i) => {
      // FEW ~ 0.15 sky cover, SCT ~ 0.4, BKN ~ 0.75
      const cov = l.oktas <= 2 ? 0.28 : l.oktas <= 4 ? 0.5 : l.oktas <= 7 ? 0.78 : 1.0;
      L[i].set(l.baseFt * 0.3048, cov, 1.6, 1);
    });
    this.lastSunUpdate = -1e9;
    this.lastEnv = -1e9;
    this.update(0, this.app.time(), true);
  }

  update(dt: number, t: number, force = false) {
    const s = this.state;
    const u = this.sky.uniforms;
    // --- sun / moon (1 Hz) ---
    if (force || t - this.lastSunUpdate > 1) {
      this.lastSunUpdate = t;
      const ms = this.utcMs();
      const sun = sunPosition(ms, DATA_ORIGIN.lat, DATA_ORIGIN.lon);
      const moon = moonPosition(ms, DATA_ORIGIN.lat, DATA_ORIGIN.lon);
      s.sunEl = sun.elevation;
      s.moonEl = moon.elevation;
      s.moonIllum = moon.illumination;
      s.sunDir.fromArray(horizontalToVec(sun));
      s.moonDir.fromArray(horizontalToVec(moon));
      s.night = THREE.MathUtils.smoothstep(-s.sunEl, 1.5, 13);
      s.artificial = THREE.MathUtils.smoothstep(-s.sunEl, -7, 1); // floodlights on from ~7° above the horizon
      u.sunDir.value.copy(s.sunDir);
      u.moonDir.value.copy(s.moonDir);
      u.moonIllum.value = s.moonEl > -1 ? s.moonIllum : 0;
      u.nightFactor.value = s.night;
      // hazier and redder toward sunset
      const low = THREE.MathUtils.smoothstep(-s.sunEl, -20, 2);
      u.turbidity.value = 2.6 + 1.6 * low;
      u.rayleigh.value = 1.3 + 0.9 * low;
      u.mieCoefficient.value = 0.0045 + 0.002 * low;
      const tr = sunTransmittance(s.sunEl, 2.4);
      const lum = 0.2126 * tr[0] + 0.7152 * tr[1] + 0.0722 * tr[2];
      const sc = u.sunColor.value.setRGB(tr[0], tr[1], tr[2]);
      if (lum > 0) sc.multiplyScalar(1 / Math.max(tr[0], tr[1], tr[2]));
      this.sky.setVisibility(THREE.MathUtils.smoothstep(s.night, 0.55, 1.0), s.moonEl > -1 ? THREE.MathUtils.smoothstep(-s.sunEl, 0, 8) : 0);
      this.sky.update(this.app.camera.getWorldPosition(new THREE.Vector3()), gmst(ms) + DATA_ORIGIN.lon, DATA_ORIGIN.lat,
        Math.max(1, this.app.renderer.getPixelRatio()));

      // --- key light ---
      const k = this.key.light;
      const sunUp = THREE.MathUtils.smoothstep(s.sunEl, -1.0, 2.5);
      const dirKey = new THREE.Vector3();
      if (sunUp > 0.02) {
        dirKey.copy(s.sunDir);
        k.color.setRGB(tr[0], tr[1], tr[2]).multiplyScalar(1 / Math.max(1e-4, Math.max(tr[0], tr[1], tr[2])));
        k.intensity = 4.4 * lum * sunUp;
      } else {
        // night: the dominant apron floodlight acts as key light (window-frame shadows in the cockpit)
        const fk = this.floodKey;
        dirKey.copy(fk.dir);
        k.color.copy(fk.color);
        k.intensity = fk.intensity * s.artificial;
      }
      if (dirKey.y < 0.05) { dirKey.y = 0.05; dirKey.normalize(); }
      this.key.aim(this.cockpitCenter, dirKey);
      this.keyDir.copy(dirKey);

      // --- fog / aerial perspective: visibility 10 km+ ---
      const vis = Math.max(10000, s.weather.visM) * (s.tod === 'night' ? 1.6 : 1.0);
      this.fog.density = 1.6 / vis;
      const hc = this.tmpC.set(0, 0, 0);
      const c = new THREE.Color();
      for (let a = 0; a < 360; a += 45) hc.add(this.sky.horizonColor(a, c));
      hc.multiplyScalar(1 / 8);
      this.fog.color.copy(hc);
      this.app.scene.background = null;
      // environment intensity for the cockpit materials (unoccluded sky IBL overestimates the interior)
      this.app.scene.environmentIntensity = THREE.MathUtils.lerp(0.55, 0.9, s.night);
      for (const l of this.listeners) l(s);
    }

    // --- clouds drift with the wind aloft (2x surface wind, veered 20°) ---
    const w = s.weather;
    const wdir = ((w.windDir + 20) * Math.PI) / 180;
    const wspd = w.windKt * 0.514 * 2.0;
    // wind FROM wdir → clouds move toward wdir + 180
    this.cloudOffset.x -= Math.sin(wdir) * wspd * dt;
    this.cloudOffset.y += Math.cos(wdir) * wspd * dt;
    u.cloudOffset.value.set(-this.cloudOffset.x, -this.cloudOffset.y);
    u.cloudTime.value = t;
    this.sky.mesh.position.copy(this.app.camera.getWorldPosition(this.tmpV));

    // --- environment map: when the sun moved or every 90 s ---
    if (force || t - this.lastEnv > 90 || s.sunDir.angleTo(this.envSunDir) > 0.01 || Math.abs(s.night - this.envNight) > 0.05) {
      this.lastEnv = t;
      this.envSunDir.copy(s.sunDir);
      this.envNight = s.night;
      const g = this.groundBounce();
      this.envMap = this.sky.captureEnvironment(g);
      this.app.scene.environment = this.envMap;
      for (const l of this.listeners) l(s);
    }

    // --- exterior shadow cascades ---
    this.shadows.update(this.standCenter, this.keyDir, t);
    WU.wlShadowParams.value.x *= THREE.MathUtils.smoothstep(this.state.sunEl, -1, 2) > 0.02 ? 1 : 0;
  }

  readonly keyDir = new THREE.Vector3(0, 1, 0);
  private readonly tmpV = new THREE.Vector3();

  /** Radiance of the ground seen in the environment map (grey apron lit by sun + sky). */
  private groundBounce(): THREE.Color {
    const s = this.state;
    const k = this.key.light;
    const sunIrr = Math.max(0, this.keyDir.y) * k.intensity;
    const skyIrr = 0.9 * (1 - s.night) + 0.02;
    const albedo = new THREE.Color(0.30, 0.29, 0.27);
    const c = albedo.multiplyScalar((sunIrr + skyIrr) / Math.PI);
    c.r *= k.color.r; c.g *= k.color.g; c.b *= k.color.b;
    if (s.artificial > 0) c.add(new THREE.Color(0.02, 0.016, 0.01).multiplyScalar(s.artificial));
    return c;
  }
}
