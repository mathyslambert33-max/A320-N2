/**
 * 3D cockpit hardware kit (lead-owned). See README.md in this folder.
 *
 *   const p = app.kit.panel({ name: 'OVHD_ELEC', width: 0.146, height: 0.2, zone: 'ovhd' });
 *   p.label('ELEC', -0.06, 0.09, { align: 'left', size: 0.003 });
 *   p.pb('ELEC_BAT1', -0.03, 0.05, { label: 'BAT 1' });
 *   group.add(p.finish());
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Sim } from '../../core/sim';
import { getControl, registerControls, type ControlDef, type LightColor } from '../../core/catalog';
import { PanelBuilder, type PanelOptions } from './panel';
import { materials, LIGHT_COLORS, ZONE_UNIFORMS, BACKLIGHT_COLOR, type LightZone, type Materials } from './materials';
import { atlas } from './atlas';
import type { Handle, HandleInfo, Interaction } from './interaction';

export { PanelBuilder } from './panel';
export type { PanelOptions, PbOptions, SwitchOptions, KnobOptions, KeyOptions, ScreenOptions, LabelOptions } from './panel';
export type { Handle, HandleInfo, InteractEvent } from './interaction';
export type { LightZone } from './materials';
export * as geo from './geo';

export interface ControlInstance {
  id: string;
  /** Called every frame: update visuals from the sim (C: var). */
  sync(sim: Sim, dt: number): void;
}

interface LegendInstance {
  light: string;
  mat: THREE.MeshStandardMaterial;
  last: number;
}

export interface LeverOptions {
  /** Update the visual for a value. */
  apply(value: number): void;
  /** Mouse axis used when dragging (default 'y': moving the mouse up/forward increases). */
  dragAxis?: 'x' | 'y';
  /** Invert the drag direction. */
  invert?: boolean;
  /** Value change per pixel of mouse movement (default range/250). */
  perPixel?: number;
  /** Wheel step when there are no detents (default range/20). */
  wheelStep?: number;
  /** Detent values (default catalog detents). */
  detents?: number[];
  /** Snap distance to a detent on release (default 4% of range). */
  snap?: number;
  /** Gate a requested move (from → to) and return the allowed value (e.g. reverse latch, gated flaps). */
  gate?(from: number, to: number): number;
  /** Objects that receive clicks (default obj). */
  hit?: THREE.Object3D;
  /** Sound kind for detents (default 'detent'). */
  sfx?: string;
  /** Clicking without dragging: step to next detent toward the clicked side (default true). */
  clickSteps?: boolean;
  /** Custom min/max (default catalog). */
  min?: number;
  max?: number;
}

export class Kit {
  readonly mats: Materials;
  private instances: ControlInstance[] = [];
  private legends: LegendInstance[] = [];
  private keyMats = new Map<LightZone, THREE.MeshStandardMaterial>();
  /** Emissive intensity of a lit legend (BRT). */
  legendIntensity = 3.2;

  constructor(public app: App) {
    this.mats = typeof document !== 'undefined' ? materials() : ({} as Materials);
  }

  get sim(): Sim {
    return this.app.sim;
  }

  get interaction(): Interaction {
    return this.app.interaction;
  }

  /** Catalog definition (creates a placeholder with a warning if unknown). */
  def(id: string): ControlDef {
    let d = getControl(id);
    if (!d) {
      console.warn(`[kit] control ${id} is not in the catalog — registering a placeholder`);
      d = { id, panel: 'UNKNOWN', kind: 'pb', name: id, init: 0 };
      registerControls([d]);
    }
    return d;
  }

  /** Start a new panel. Call `.finish()` and add the returned group to your module root. */
  panel(opts: PanelOptions): PanelBuilder {
    return new PanelBuilder(this, opts);
  }

  /** Material for one lit legend (unique per instance so its brightness can vary). */
  legendMaterial(color: LightColor): THREE.MeshStandardMaterial {
    const c = LIGHT_COLORS[color] ?? LIGHT_COLORS.W;
    const tex = atlas().texture;
    return new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.07),
      map: tex,
      emissive: c,
      emissiveMap: tex,
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0,
    });
  }

  /** Shared material for printed key/cap text (back-lit by the zone integral lighting). */
  keyLabelMaterial(zone: LightZone): THREE.MeshStandardMaterial {
    let m = this.keyMats.get(zone);
    if (!m) {
      const tex = atlas().texture;
      m = new THREE.MeshStandardMaterial({
        color: 0xe8e8e2,
        alphaMap: tex,
        emissive: BACKLIGHT_COLOR,
        emissiveIntensity: 0,
        roughness: 0.6,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      this.keyMats.set(zone, m);
    }
    return m;
  }

  addLegend(light: string, mat: THREE.MeshStandardMaterial): void {
    this.legends.push({ light, mat, last: -1 });
  }

  addInstance(inst: ControlInstance): void {
    this.instances.push(inst);
  }

  /** Call fn(value) whenever C:<id> changes (for custom-built controls). */
  bindVisual(id: string, fn: (value: number, dt: number) => void): void {
    let last = NaN;
    this.addInstance({ id, sync: (sim, dt) => { const v = sim.get(`C:${id}`); if (v !== last) { last = v; fn(v, dt); } } });
  }

  /** Register interaction for an arbitrary object (custom controls). */
  interactive(obj: THREE.Object3D, handle: Handle): void {
    this.interaction.register(obj, handle);
  }

  /**
   * Change a control position as the player would: sets C:<id>, emits `<id>:change` (and `<id>:toggle`
   * for pushbuttons) and a positional click sound.
   */
  setControl(id: string, value: number, at?: THREE.Object3D, sfxKind: string | null = 'sw'): void {
    const old = this.sim.get(`C:${id}`);
    if (old === value) return;
    this.sim.set(`C:${id}`, value);
    const def = getControl(id);
    this.sim.emit(`${id}:change`, { value, old });
    if (def?.kind === 'pb') this.sim.emit(`${id}:toggle`, { value });
    if (sfxKind) this.sfx(sfxKind, id, at);
  }

  /** Momentary press (pbm / keys). */
  press(id: string, at?: THREE.Object3D): void {
    this.sim.set(`C:${id}`, 1);
    this.sim.emit(`${id}:press`);
    this.sfx('pbm', id, at);
  }

  release(id: string): void {
    this.sim.set(`C:${id}`, 0);
    this.sim.emit(`${id}:release`);
  }

  private tmp = new THREE.Vector3();
  /** Emit a positional mechanical sound (audio module listens to 'sfx'). Position in aircraft body frame. */
  sfx(kind: string, id: string, at?: THREE.Object3D): void {
    let x = 0, y = 1.2, z = -0.5;
    if (at) {
      at.getWorldPosition(this.tmp);
      this.app.aircraft.worldToLocal(this.tmp);
      x = this.tmp.x; y = this.tmp.y; z = this.tmp.z;
    }
    this.sim.emit('sfx', { kind, id, x, y, z });
  }

  /** Tooltip description of a catalog control. */
  describe(def: ControlDef): HandleInfo {
    return { name: def.name, fr: def.fr, state: this.stateText(def), id: def.id };
  }

  stateText(def: ControlDef): string {
    const v = this.sim.get(`C:${def.id}`);
    switch (def.kind) {
      case 'pb': {
        if (def.pos && def.pos[0] !== 'OUT') return def.pos[Math.round(v)] ?? String(v);
        const texts = (def.leg ?? []).map((l) => (Array.isArray(l.text) ? l.text.join(' ') : l.text));
        const has = (t: string) => texts.includes(t);
        if (has('OFF')) return v ? (has('AUTO') ? 'AUTO' : 'ON') : 'OFF';
        if (has('ON')) return v ? 'ON' : 'OFF';
        if (has('MAN')) return v ? 'AUTO' : 'MAN';
        if (has('ALTN')) return v ? 'NORM' : 'ALTN';
        if (has('OVRD')) return v ? 'AUTO' : 'OVRD';
        return v ? 'IN' : 'OUT';
      }
      case 'pbm':
      case 'key':
        return '';
      case 'sw':
      case 'swm':
      case 'rot':
      case 'rotm':
        return def.pos?.[Math.round(v)] ?? String(v);
      case 'pot':
        return v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`;
      case 'lever': {
        if (def.pos && def.detents) {
          let best = 0;
          def.detents.forEach((d, i) => { if (Math.abs(d - v) < Math.abs(def.detents![best] - v)) best = i; });
          const near = Math.abs(def.detents[best] - v) < ((def.max ?? 1) - (def.min ?? 0)) * 0.03;
          return near ? def.pos[best] : v.toFixed(1);
        }
        return v.toFixed(2);
      }
      default:
        return String(v);
    }
  }

  /**
   * Bind a custom lever / wheel object to a catalog 'lever' control (thrust levers, flaps, speed brake,
   * gear lever, pitch trim wheel, windows…). Handles drag, wheel, detents, sounds and `C:` updates.
   */
  lever(id: string, obj: THREE.Object3D, o: LeverOptions): void {
    const def = this.def(id);
    const min = o.min ?? def.min ?? 0, max = o.max ?? def.max ?? 1;
    const range = max - min;
    const detents = o.detents ?? def.detents ?? [];
    const snap = o.snap ?? range * 0.04;
    const perPixel = o.perPixel ?? range / 250;
    let dragging = false;
    let moved = 0;
    let last = NaN;
    this.addInstance({
      id,
      sync: (sim) => {
        const v = sim.get(`C:${id}`);
        if (v !== last) { last = v; o.apply(v); }
      },
    });
    o.apply(this.sim.get(`C:${id}`));
    const set = (target: number, sound: boolean) => {
      const cur = this.sim.get(`C:${id}`);
      let nv = Math.max(min, Math.min(max, target));
      if (o.gate) nv = o.gate(cur, nv);
      if (nv === cur) return;
      // detent crossing sound
      const crossed = detents.some((d) => (cur < d && nv >= d) || (cur > d && nv <= d));
      this.sim.set(`C:${id}`, nv);
      this.sim.emit(`${id}:change`, { value: nv, old: cur });
      if (sound && crossed) this.sfx(o.sfx ?? 'detent', id, obj);
    };
    const stepDetent = (dir: number) => {
      const cur = this.sim.get(`C:${id}`);
      if (!detents.length) return set(cur + dir * (o.wheelStep ?? range / 20), true);
      const sorted = [...detents].sort((a, b) => a - b);
      const eps = range * 0.002;
      const next = dir > 0 ? sorted.find((d) => d > cur + eps) : [...sorted].reverse().find((d) => d < cur - eps);
      if (next !== undefined) set(next, true);
    };
    const handle: Handle = {
      id,
      ref: obj,
      cursor: 'drag',
      onDown: () => { dragging = true; moved = 0; },
      onDrag: (dx, dy) => {
        if (!dragging) return;
        const d = (o.dragAxis ?? 'y') === 'y' ? -dy : dx;
        moved += Math.abs(d);
        set(this.sim.get(`C:${id}`) + d * perPixel * (o.invert ? -1 : 1), true);
      },
      onUp: (e) => {
        if (!dragging) return;
        dragging = false;
        const cur = this.sim.get(`C:${id}`);
        if (moved < 3 && o.clickSteps !== false) {
          // simple click: step toward the clicked side (left = decrease, right = increase)
          stepDetent(e.button === 2 ? -1 : 1);
          return;
        }
        let best: number | undefined;
        for (const d of detents) if (Math.abs(d - cur) <= snap && (best === undefined || Math.abs(d - cur) < Math.abs(best - cur))) best = d;
        if (best !== undefined && best !== cur) set(best, false);
      },
      onWheel: (steps) => stepDetent(steps > 0 ? 1 : -1),
      describe: () => this.describe(def),
    };
    this.interaction.register(o.hit ?? obj, handle);
  }

  update(dt: number, _t: number): void {
    const sim = this.sim;
    for (const inst of this.instances) inst.sync(sim, dt);
    const test = sim.getB('S:INTLT_ANN_TEST');
    const dimF = sim.getB('S:INTLT_ANN_DIM') ? 0.3 : 1;
    const I = this.legendIntensity * dimF;
    for (const L of this.legends) {
      let v = test ? 1 : sim.get(`L:${L.light}`);
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      const target = v * I;
      if (target !== L.last) { L.mat.emissiveIntensity = target; L.last = target; }
    }
    ZONE_UNIFORMS.ovhd.value = sim.get('S:INTLT_INTEG_OVHD');
    ZONE_UNIFORMS.main.value = sim.get('S:INTLT_INTEG_MAIN');
    ZONE_UNIFORMS.ped.value = sim.get('S:INTLT_INTEG_MAIN');
    ZONE_UNIFORMS.glare.value = sim.get('S:INTLT_INTEG_GLARE');
    for (const [zone, m] of this.keyMats) m.emissiveIntensity = ZONE_UNIFORMS[zone].value * 1.4;
    atlas().flush();
  }
}
