/**
 * First-person head rig (owner: ui). The player camera is parented to a head rig inside `app.aircraft`
 * (body frame), placed at the seat's design eye point + a bounded head offset, rotated by yaw/pitch.
 * Smooth mouse look, head lean, preset views with eased transitions, FOV zoom, seat switch.
 */
import * as THREE from 'three';
import type { App } from '../app';
import { EYE, clampAngles, clampHead, ease, presetPose, torsoTwist, type PresetId, type Seat, type Vec3 } from './view';

const D = Math.PI / 180;

interface FullPose { off: Vec3; yaw: number; pitch: number; zoom: number }

export class HeadCamera {
  readonly rig = new THREE.Group();
  seat: Seat = 'capt';
  enabled = true;
  /** Slow pan used behind the title screen. */
  attract = false;
  /** Head lean input, head-relative: x right, y up, z forward (−1..1). */
  readonly lean: Vec3 = [0, 0, 0];
  /** Keyboard / gamepad look rate input (−1..1): yaw left +, pitch up +. */
  readonly lookRate: [number, number] = [0, 0];
  /** Tablet position per seat (captain frame), set by the tablet module. */
  efbTarget?: Vec3;

  private off: Vec3 = [0, 0, 0];
  private offT: Vec3 = [0, 0, 0];
  private yaw = 0;
  private pitch = -12 * D;
  private yawT = 0;
  private pitchT = -12 * D;
  private zoom = 1;
  private zoomT = 1;
  private anim: { from: FullPose; to: FullPose; t: number; dur: number } | null = null;
  private last: { id: PresetId; variant: number } | null = null;
  private lastFov = 0;
  private t = 0;

  constructor(private app: App) {
    this.rig.name = 'ui:headRig';
    app.aircraft.add(this.rig);
    this.rig.add(app.camera);
    app.camera.position.set(0, 0, 0);
    app.camera.quaternion.identity();
    this.apply();
  }

  /** Mouse look in pixels (pointer lock movement or drag). */
  look(dx: number, dy: number): void {
    if (!this.enabled) return;
    if (this.anim) this.stopAnim();
    this.last = null;
    const s = this.app.settings.get();
    const k = 0.0021 * s.mouseSensitivity / this.zoom;
    this.yawT -= dx * k;
    this.pitchT -= dy * k * (s.invertY ? -1 : 1);
    [this.yawT, this.pitchT] = clampAngles(this.seat, this.yawT, this.pitchT);
  }

  zoomBy(steps: number): void {
    this.zoomT = Math.min(2.8, Math.max(1, this.zoomT * Math.pow(1.14, steps)));
  }

  resetZoom(): void {
    this.zoomT = 1;
  }

  /** Go to a preset view; pressing the same preset again cycles its variants. Returns the view label. */
  preset(id: PresetId, instant = false): string {
    const variant = this.last && this.last.id === id ? this.last.variant + 1 : 0;
    const p = presetPose(this.seat, id, variant, this.efbTarget);
    this.last = { id, variant };
    const to: FullPose = { off: p.off, yaw: p.yaw, pitch: p.pitch, zoom: p.zoom };
    if (instant) {
      this.anim = null;
      this.setPose(to);
    } else {
      const from: FullPose = { off: [...this.off] as Vec3, yaw: this.yaw, pitch: this.pitch, zoom: this.zoom };
      const dist = Math.hypot(to.yaw - from.yaw, to.pitch - from.pitch);
      this.anim = { from, to, t: 0, dur: 0.35 + Math.min(0.45, dist * 0.25) };
    }
    return p.label;
  }

  /** Put the head at the other seat, normal view (the caller fades the screen). */
  setSeat(seat: Seat): void {
    this.seat = seat;
    this.last = null;
    this.anim = null;
    const p = presetPose(seat, 'normal');
    this.setPose({ off: p.off, yaw: p.yaw, pitch: p.pitch, zoom: 1 });
  }

  /** Pose from a harness camera (eye position + target, body frame). */
  setFromLook(eye: Vec3, target: Vec3): void {
    const seat: Seat = eye[0] > 0 ? 'fo' : 'capt';
    this.seat = seat;
    const off = clampHead(seat, [eye[0] - EYE[seat][0], eye[1] - EYE[seat][1], eye[2] - EYE[seat][2]]);
    const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
    const [yaw, pitch] = clampAngles(seat, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
    this.setPose({ off, yaw, pitch, zoom: 1 });
  }

  private setPose(p: FullPose): void {
    this.off = [...p.off] as Vec3;
    this.offT = [...p.off] as Vec3;
    this.yaw = this.yawT = p.yaw;
    this.pitch = this.pitchT = p.pitch;
    this.zoom = this.zoomT = p.zoom;
    this.apply();
  }

  private stopAnim(): void {
    this.anim = null;
    this.offT = [...this.off] as Vec3;
    this.yawT = this.yaw;
    this.pitchT = this.pitch;
    this.zoomT = this.zoom;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.enabled) { this.apply(); return; }
    if (this.attract) {
      this.anim = null;
      this.yawT = -0.12 + 0.3 * Math.sin(this.t * 0.11);
      this.pitchT = -0.14 + 0.06 * Math.sin(this.t * 0.07 + 1);
      this.offT = [0.02 * Math.sin(this.t * 0.09), 0, 0];
    }
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = ease(Math.min(1, a.t / a.dur));
      const L = (x: number, y: number) => x + (y - x) * k;
      this.off = [L(a.from.off[0], a.to.off[0]), L(a.from.off[1], a.to.off[1]), L(a.from.off[2], a.to.off[2])];
      this.yaw = L(a.from.yaw, a.to.yaw);
      this.pitch = L(a.from.pitch, a.to.pitch);
      this.zoom = L(a.from.zoom, a.to.zoom);
      this.offT = [...this.off] as Vec3;
      this.yawT = this.yaw;
      this.pitchT = this.pitch;
      this.zoomT = this.zoom;
      if (k >= 1) this.anim = null;
      if (this.lean.some((v) => v !== 0) || this.lookRate.some((v) => v !== 0)) this.stopAnim();
    } else {
      // keyboard / gamepad look
      if (this.lookRate[0] || this.lookRate[1]) {
        const r = 1.6 / this.zoom;
        this.yawT += this.lookRate[0] * r * dt;
        this.pitchT += this.lookRate[1] * r * dt;
        [this.yawT, this.pitchT] = clampAngles(this.seat, this.yawT, this.pitchT);
        this.last = null;
      }
      // head lean, relative to the heading of the head
      const [lx, ly, lz] = this.lean;
      if (lx || ly || lz) {
        const v = 0.45 * dt;
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        this.offT = clampHead(this.seat, [
          this.offT[0] + (lx * c - lz * s) * v,
          this.offT[1] + ly * v,
          this.offT[2] + (-lx * s - lz * c) * v,
        ]);
        this.last = null;
      }
      const ka = 1 - Math.exp(-dt / 0.045);
      const ko = 1 - Math.exp(-dt / 0.09);
      this.yaw += (this.yawT - this.yaw) * ka;
      this.pitch += (this.pitchT - this.pitch) * ka;
      for (let i = 0; i < 3; i++) this.off[i] += (this.offT[i] - this.off[i]) * ko;
      this.zoom += (this.zoomT - this.zoom) * ko;
    }
    this.apply();
  }

  /** Current view angles (rad) and seat, for the HUD / debug. */
  pose(): { seat: Seat; yaw: number; pitch: number; off: Vec3; zoom: number } {
    return { seat: this.seat, yaw: this.yaw, pitch: this.pitch, off: [...this.off] as Vec3, zoom: this.zoom };
  }

  private apply(): void {
    const tw = torsoTwist(this.seat, this.yaw);
    const o = clampHead(this.seat, [this.off[0] + tw[0], this.off[1] + tw[1], this.off[2] + tw[2]]);
    const e = EYE[this.seat];
    this.rig.position.set(e[0] + o[0], e[1] + o[1], e[2] + o[2]);
    this.rig.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const cam = this.app.camera;
    // Keep the camera at the rig origin (the dev harness moves it once after the modules are installed).
    if (cam.parent !== this.rig) this.rig.add(cam);
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    const fov = this.app.settings.get().fov / this.zoom;
    if (Math.abs(fov - this.lastFov) > 1e-3) {
      this.lastFov = fov;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.rig.updateMatrixWorld(true);
  }
}
