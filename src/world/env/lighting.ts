/**
 * Key light and exterior shadow cascades (world agent).
 *
 *  - `key`: the only DirectionalLight of the scene (sun by day, moon / floodlight at night). Its three.js shadow map
 *    is a fixed box of ±2.6 m around the cockpit (4096² on high → ~1.3 mm texels): crisp window-frame shadows on
 *    the panels, from any occluder up to 300 m toward the light (terminal, jet bridge, fuselage).
 *  - `FarShadows`: two static cascades (±60 m stand area, ±650 m airport) rendered only when something changes,
 *    sampled by the patched world materials (see worldMaterial.ts).
 */
import * as THREE from 'three';
import { WU } from './worldMaterial';

/** Layer of the meshes that cast exterior shadows. */
export const CASTER_LAYER = 5;

export function markCaster(obj: THREE.Object3D, on = true) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      if (on) o.layers.enable(CASTER_LAYER);
      else o.layers.disable(CASTER_LAYER);
    }
  });
}

class Cascade {
  readonly rt: THREE.WebGLRenderTarget;
  readonly cam: THREE.OrthographicCamera;
  readonly matrix = new THREE.Matrix4();
  constructor(readonly half: number, readonly size: number, readonly depth: number) {
    const dt = new THREE.DepthTexture(size, size);
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter;
    dt.magFilter = THREE.LinearFilter;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      depthTexture: dt,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, depth * 2);
    this.cam.layers.set(CASTER_LAYER);
  }
  texel() {
    return (2 * this.half) / this.size;
  }
  aim(center: THREE.Vector3, dir: THREE.Vector3) {
    // snap the centre to the texel grid in light space (stable shadows while the sun moves slowly)
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir.clone().negate(), up);
    const inv = m.clone().invert();
    const c = center.clone().applyMatrix4(inv);
    const t = this.texel();
    c.x = Math.round(c.x / t) * t;
    c.y = Math.round(c.y / t) * t;
    c.applyMatrix4(m);
    this.cam.position.copy(c).addScaledVector(dir, this.depth);
    this.cam.up.copy(up);
    this.cam.lookAt(c);
    this.cam.updateMatrixWorld(true);
    this.cam.updateProjectionMatrix();
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.cam.projectionMatrix)
      .multiply(this.cam.matrixWorldInverse);
  }
}

export class FarShadows {
  readonly near: Cascade;
  readonly far: Cascade;
  private readonly depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private dirty = true;
  private lastDir = new THREE.Vector3();
  private lastRender = -1e9;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, quality: string) {
    const res = quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : 1024;
    this.near = new Cascade(60, res, 400);
    this.far = new Cascade(650, res, 1500);
    this.depthMat.polygonOffset = true;
    this.depthMat.polygonOffsetFactor = 1.5;
    this.depthMat.polygonOffsetUnits = 2;
    WU.wlShadowNear.value = this.near.rt.depthTexture;
    WU.wlShadowFar.value = this.far.rt.depthTexture;
  }

  invalidate() {
    this.dirty = true;
  }

  /**
   * Re-render the cascades if needed. `center` = world point to centre the stand cascade on; `dir` = unit vector
   * toward the light. Throttled to `maxHz` while things move.
   */
  update(center: THREE.Vector3, dir: THREE.Vector3, t: number, maxHz = 8) {
    WU.wlShadowParams.value.set(this.enabled && dir.y > 0.02 ? 1 : 0, this.near.texel(), this.far.texel(), 0);
    if (!this.enabled || dir.y <= 0.02) return;
    if (dir.angleTo(this.lastDir) > 0.002) this.dirty = true;
    if (!this.dirty || t - this.lastRender < 1 / maxHz) return;
    this.lastRender = t;
    this.dirty = false;
    this.lastDir.copy(dir);
    this.near.aim(center, dir);
    this.far.aim(center, dir);
    WU.wlShadowNearMat.value.copy(this.near.matrix);
    WU.wlShadowFarMat.value.copy(this.far.matrix);
    const r = this.renderer;
    const s = this.scene;
    const prevRT = r.getRenderTarget();
    const prevOverride = s.overrideMaterial;
    const prevBg = s.background;
    const prevFog = s.fog;
    const prevAuto = r.shadowMap.autoUpdate;
    const prevClear = r.autoClear;
    s.overrideMaterial = this.depthMat;
    s.background = null;
    s.fog = null;
    r.shadowMap.autoUpdate = false;
    r.autoClear = true;
    for (const c of [this.near, this.far]) {
      r.setRenderTarget(c.rt);
      r.clear(true, true, false);
      r.render(s, c.cam);
    }
    r.setRenderTarget(prevRT);
    s.overrideMaterial = prevOverride;
    s.background = prevBg;
    s.fog = prevFog;
    r.shadowMap.autoUpdate = prevAuto;
    r.autoClear = prevClear;
  }
}

export class KeyLight {
  readonly light = new THREE.DirectionalLight(0xffffff, 3);
  private readonly center = new THREE.Vector3();

  constructor(parent: THREE.Object3D, quality: string) {
    const l = this.light;
    l.name = 'world-key-light';
    l.castShadow = quality !== 'low';
    const size = quality === 'ultra' || quality === 'high' ? 4096 : 2048;
    l.shadow.mapSize.set(size, size);
    const c = l.shadow.camera;
    c.left = -2.6; c.right = 2.6; c.top = 2.6; c.bottom = -2.6;
    c.near = 1; c.far = 320;
    l.shadow.bias = -0.00004;
    l.shadow.normalBias = 0.0025;
    l.shadow.radius = 1.5;
    parent.add(l, l.target);
  }

  /** Aim at `cockpitCenter` (world) from `dir` (unit vector toward the light). */
  aim(cockpitCenter: THREE.Vector3, dir: THREE.Vector3) {
    this.center.copy(cockpitCenter);
    this.light.target.position.copy(cockpitCenter);
    this.light.position.copy(cockpitCenter).addScaledVector(dir, 300);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }
}
