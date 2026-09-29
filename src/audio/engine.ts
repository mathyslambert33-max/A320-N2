/**
 * The procedural audio engine: owns the AudioCore graph and all voices, reads the sim at ≤ 30 Hz,
 * updates the listener from the camera, and dispatches the sim events ('sfx', 'fwc:sound',
 * 'cabin:chime', …). Works with any BaseAudioContext (an OfflineAudioContext is used for level checks).
 */
import * as THREE from 'three';
import type { Sim } from '../core/sim';
import type { Settings } from '../core/settings';
import { Alerts, type FwcPayload } from './alerts';
import { AudioCore, POS, Voice, db, hold, type Leak, type VarReader, type Vec3 } from './core';
import { clamp, lerp, openings, volumeToGain } from './mappings';
import { OneShots, type SfxPayload } from './oneshots';
import { AirportAmbience } from './voices/ambience';
import { AvionicsFans, CabinAir, CvrTestVoice, ElecHum, PackAir } from './voices/cockpit';
import { ApuVoice, EngineVoice } from './voices/engines';
import { DieselVoice, HornVoice, JetbridgeVoice, gpuDrive, tugDrive } from './voices/ground';
import { ElecPumpVoice, FuelPumpsVoice, PtuVoice, ValveMotorVoice } from './voices/hyd';
import { WindowSlideVoice, WiperVoice } from './voices/wipers';

export interface EngineHost {
  sim: Sim;
  camera?: THREE.Object3D;
  aircraft?: THREE.Object3D;
}

/** Electrical state variables whose transitions make contactors clack in the electrical bay. */
const RELAY_VARS = [
  'S:ELEC_DC_BAT_BUS', 'S:ELEC_DC_ESS_BUS', 'S:ELEC_DC1_BUS', 'S:ELEC_DC2_BUS', 'S:ELEC_AC1_BUS', 'S:ELEC_AC2_BUS',
  'S:ELEC_AC_ESS_BUS', 'S:ELEC_EXT_PWR_ON', 'S:ELEC_APU_GEN_ON', 'S:ELEC_GEN1_ON', 'S:ELEC_GEN2_ON', 'S:ELEC_STAT_INV',
  'S:ELEC_HOT_BUS1', 'S:ELEC_HOT_BUS2',
];

/** Pneumatic valves whose opening/closing slam is heard through the structure: [var, body position, dB]. */
const VALVE_VARS: Array<[string, Vec3, number]> = [
  ['S:PACK1_VALVE', [-1, -2.1, 11], -4],
  ['S:PACK2_VALVE', [1, -2.1, 11], -4],
  ['S:APU_BLEED_VALVE', [0, 0.5, 26], -8],
  ['S:BLEED_XBLEED_VALVE', [0, -1.6, 11.5], -8],
  ['S:BLEED_ENG1_VALVE', [-5.2, -1.2, 13], -8],
  ['S:BLEED_ENG2_VALVE', [5.2, -1.2, 13], -8],
];

export class AudioEngine implements VarReader {
  readonly core: AudioCore;
  readonly shots: OneShots;
  readonly alerts: Alerts;
  readonly ambience: AirportAmbience;
  readonly voices: Voice[] = [];
  /** Self-test / debug overrides: take precedence over the sim. */
  readonly overrides = new Map<string, number>();
  private prevRelay = new Map<string, number>();
  private prevValve = new Map<string, number>();
  private evacSilenced = false;
  private prevEvac = 0;
  private muted = false;
  private first = true;
  private m = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private vp = new THREE.Vector3();
  private vf = new THREE.Vector3();
  private vu = new THREE.Vector3();
  private ckptDoor = 1;

  constructor(ctx: BaseAudioContext, private host: EngineHost, settings: Readonly<Settings>) {
    this.core = new AudioCore(ctx);
    this.shots = new OneShots(this.core);
    this.alerts = new Alerts(this.core);
    const c = this.core;
    const s = this.shots;
    this.ambience = new AirportAmbience(c, () => settings.timeOfDay === 'night');
    this.voices.push(
      new AvionicsFans(c),
      new ElecHum(c),
      new PackAir(c),
      new CabinAir(c),
      new EngineVoice(c, 1, s),
      new EngineVoice(c, 2, s),
      new ApuVoice(c, s),
      new ElecPumpVoice(c, 'Y'),
      new ElecPumpVoice(c, 'B', -2),
      new PtuVoice(c),
      new FuelPumpsVoice(c),
      new ValveMotorVoice(c, 'xfeed-valve', POS.xfeed, 'C:FUEL_XFEED', 1.6, -46),
      new ValveMotorVoice(c, 'avncs-extract-valve', [0.3, -1.3, 1.9], 'S:VENT_EXTRACT_VALVE', 4, -44),
      new ValveMotorVoice(c, 'avncs-inlet-valve', [-0.3, -1.3, 0.9], 'S:VENT_INLET_VALVE', 4, -46),
      new DieselVoice(c, 'tug', POS.tug, 6, -18, -15, tugDrive),
      new DieselVoice(c, 'gpu', POS.gpu, 4, -30, -20, gpuDrive),
      new JetbridgeVoice(c),
      new HornVoice(c, 'nose-horn', POS.noseGear, true, -16, [311, 392], 0.5, (v) => {
        // CALLS MECH held: the same nose-gear-bay horn calls the ground mechanic.
        if (v.get('S:CALLS_MECH') > 0) return 'cont';
        if (v.has('G:AC_ON_GROUND') && v.get('G:AC_ON_GROUND') <= 0) return 'off';
        if (v.get('S:FIRE_APU_DET') > 0) return 'cont';
        if (v.get('S:ADIRS_ON_BAT') > 0 && v.get('S:ELEC_AC_POWERED') <= 0) return 'inter';
        return 'off';
      }),
      new HornVoice(c, 'evac-horn', [0, 2.05, -0.1], false, -20, [415, 523], 1.0, (v) => {
        const dc = v.get('S:ELEC_DC_BAT_BUS') > 0 || v.get('S:ELEC_DC_ESS_BUS') > 0;
        return dc && v.get('C:EVAC_COMMAND') > 0 && !this.evacSilenced ? 'inter' : 'off';
      }),
      new WiperVoice(c, 'CAPT', s),
      new WiperVoice(c, 'FO', s),
      new WindowSlideVoice(c, 'CAPT'),
      new WindowSlideVoice(c, 'FO'),
      new CvrTestVoice(c),
      this.ambience,
    );
    this.applySettings(settings);
  }

  /* ---------------------------------------------------------------- VarReader */
  get(name: string): number {
    const o = this.overrides.get(name);
    return o !== undefined ? o : this.host.sim.get(name);
  }
  has(name: string): boolean {
    return this.overrides.has(name) || this.host.sim.has(name);
  }

  /* ---------------------------------------------------------------- settings */
  applySettings(s: Readonly<Settings>): void {
    const t = this.core.now;
    this.core.master.gain.setTargetAtTime(volumeToGain(s.masterVolume), t, 0.05);
    this.core.cockpitBus.gain.setTargetAtTime(volumeToGain(s.cockpitVolume), t, 0.05);
    this.core.alertBus.gain.setTargetAtTime(volumeToGain(s.alertVolume), t, 0.05);
  }

  setMuted(b: boolean): void {
    this.muted = b;
    this.core.muteGain.gain.setTargetAtTime(b ? 0 : 1, this.core.now, 0.05);
  }
  get isMuted(): boolean {
    return this.muted;
  }

  /* ---------------------------------------------------------------- events */
  sfx(p: SfxPayload): void {
    this.shots.sfx(p);
  }
  fwc(p: FwcPayload | string): void {
    this.alerts.handle(p);
  }
  cabinChime(p?: { type?: 'lo' | 'hi' | 'hilo' }): void {
    this.alerts.cabinChime(p?.type ?? 'lo');
  }
  onPress(id: string): void {
    if (id === 'WARN_MASTER_WARN_CAPT' || id === 'WARN_MASTER_WARN_FO') this.alerts.masterWarn();
    else if (id === 'ECP_EMER_CANC') this.alerts.handle('STOP_CRC');
    else if (id === 'SIDESTICK_CAPT_TAKEOVER' || id === 'SIDESTICK_FO_TAKEOVER') this.alerts.handle('STOP_CAVALRY');
    else if (id === 'EVAC_HORN_SHUTOFF') this.evacSilenced = true;
  }

  /* ---------------------------------------------------------------- update */

  /** Cockpit door open amount: G:DOOR_CKPT (assumed) → S:CKPT_DOOR_OPEN (assumed) → open at the gate. */
  private cockpitDoor(): number {
    if (this.has('G:DOOR_CKPT')) return clamp(this.get('G:DOOR_CKPT'), 0, 1);
    if (this.has('S:CKPT_DOOR_OPEN')) return clamp(this.get('S:CKPT_DOOR_OPEN'), 0, 1);
    return 1;
  }

  private updateListener(): void {
    const cam = this.host.camera;
    if (!cam) return;
    cam.updateWorldMatrix(true, false);
    const ac = this.host.aircraft;
    if (ac) {
      this.inv.copy(ac.matrixWorld).invert();
      this.m.multiplyMatrices(this.inv, cam.matrixWorld);
    } else this.m.copy(cam.matrixWorld);
    this.vp.setFromMatrixPosition(this.m);
    this.vf.set(0, 0, -1).transformDirection(this.m);
    this.vu.set(0, 1, 0).transformDirection(this.m);
    const L = this.core.ctx.listener;
    const t = this.core.now;
    const tau = this.first ? 0 : 0.03;
    if (L.positionX) {
      const set = (p: AudioParam, v: number) => (tau === 0 ? p.setValueAtTime(v, t) : p.setTargetAtTime(v, t, tau));
      set(L.positionX, this.vp.x); set(L.positionY, this.vp.y); set(L.positionZ, this.vp.z);
      set(L.forwardX, this.vf.x); set(L.forwardY, this.vf.y); set(L.forwardZ, this.vf.z);
      set(L.upX, this.vu.x); set(L.upY, this.vu.y); set(L.upZ, this.vu.z);
    } else {
      (L as any).setPosition(this.vp.x, this.vp.y, this.vp.z);
      (L as any).setOrientation(this.vf.x, this.vf.y, this.vf.z, this.vu.x, this.vu.y, this.vu.z);
    }
  }

  /** Place the listener at the captain's eye looking forward (no camera: offline checks). */
  placeListenerAtCaptain(): void {
    const L = this.core.ctx.listener;
    const [x, y, z] = POS.captEye;
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      (L as any).setPosition(x, y, z);
      (L as any).setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  private lastParam = new Map<AudioParam, number>();
  /**
   * Automate a shared param only when its target changes (lets Chrome settle the automation and mark
   * silent branches — e.g. closed windows — as silent, so their HRTF panners stop processing).
   */
  private param(p: AudioParam, v: number, tau: number): void {
    const prev = this.lastParam.get(p);
    if (prev !== undefined && Math.abs(prev - v) <= 1e-4 * Math.max(1, Math.abs(v))) return;
    const now = this.core.now;
    if (prev !== undefined) hold(p, now);
    this.lastParam.set(p, v);
    p.setTargetAtTime(v, now, tau);
    // An exact 0 lets the downstream nodes be flagged silent (setTarget alone only approaches 0).
    if (v === 0) p.setValueAtTime(0, now + tau * 10);
  }

  /** Drive a leak path; its HRTF branch is detached from the graph 1.5 s after the opening closed. */
  private leakLink(l: Leak, v: number, tau: number): void {
    const now = this.core.now;
    if (v > 0) {
      l.offSince = 0;
      if (!l.linked) {
        l.linked = true;
        l.gain.connect(l.pan);
      }
    } else if (l.linked) {
      if (l.offSince === 0) l.offSince = now;
      else if (now - l.offSince > 1.5) {
        l.linked = false;
        try { l.gain.disconnect(l.pan); } catch { /* not connected */ }
      }
    }
    this.param(l.gain.gain, v, tau);
  }

  /** Main update (call at ≤ 30 Hz with the real elapsed time). */
  update(dt: number): void {
    const now = this.core.now;
    if (this.first) {
      // Audio started mid-session: jump the slow dynamics to their steady state.
      for (const v of this.voices) if (v instanceof AvionicsFans) v.settle(this);
      for (const k of RELAY_VARS) this.prevRelay.set(k, this.get(k) > 0 ? 1 : 0);
      for (const [k] of VALVE_VARS) this.prevValve.set(k, this.get(k) > 0.5 ? 1 : 0);
    }
    this.updateListener();

    // Openings → hull / leak paths.
    this.ckptDoor = lerp(this.ckptDoor, this.cockpitDoor(), clamp(dt / 0.15, 0, 1));
    const o = openings({
      windowCapt: this.get('C:WINDOW_CAPT'),
      windowFo: this.get('C:WINDOW_FO'),
      doorL1: this.has('G:DOOR_PAX_L1') ? this.get('G:DOOR_PAX_L1') : 0,
      ckptDoor: this.ckptDoor,
      jetbridge: this.get('G:JETBRIDGE'),
    });
    const c = this.core;
    const tau = this.first ? 0.001 : 0.08;
    this.param(c.hull.lp.frequency, o.hullCutoff, tau);
    this.param(c.hull.gain.gain, db(-6) * o.hullGain, tau);
    this.leakLink(c.leak.winCapt, db(-2) * o.windowCapt, tau);
    this.leakLink(c.leak.winFo, db(-2) * o.windowFo, tau);
    this.leakLink(c.leak.door, db(-16) * o.door, tau);
    this.param(c.leak.door.lp.frequency, o.doorCutoff, tau);
    this.param(c.leak.cabin.gain.gain, lerp(0.22, 1, this.ckptDoor), tau);
    this.param(c.leak.cabin.lp.frequency, lerp(700, 5000, this.ckptDoor), tau);

    // Contactors clacking on bus transfers.
    let changes = 0;
    for (const k of RELAY_VARS) {
      const v = this.get(k) > 0 ? 1 : 0;
      if (v !== (this.prevRelay.get(k) ?? 0)) changes++;
      this.prevRelay.set(k, v);
    }
    if (changes > 0) this.shots.relays(Math.min(4, 1 + Math.ceil(changes / 2)));

    // Pneumatic valve slams.
    for (const [k, pos, dbv] of VALVE_VARS) {
      const v = this.get(k) > 0.5 ? 1 : 0;
      if (v !== (this.prevValve.get(k) ?? v)) this.shots.exterior('valve', pos, dbv + (v ? 0 : -3));
      this.prevValve.set(k, v);
    }

    // EVAC horn shut-off latch resets when the EVAC command is cancelled.
    const evac = this.get('C:EVAC_COMMAND') > 0 ? 1 : 0;
    if (evac && !this.prevEvac) this.evacSilenced = false;
    this.prevEvac = evac;

    for (const v of this.voices) {
      try {
        v.update(dt, this);
      } catch (e) {
        console.error(`[audio] voice ${v.name}`, e);
      }
    }
    this.alerts.update();
    this.first = false;
  }

  /** Names + running state of the voices (debug). */
  debug(): Record<string, boolean> {
    const r: Record<string, boolean> = {};
    for (const v of this.voices) r[v.name] = v.running;
    return r;
  }

  dispose(): void {
    for (const v of this.voices) v.stop();
    this.alerts.stopAll();
  }
}
