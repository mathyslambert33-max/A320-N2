/**
 * Pointer interaction with cockpit controls.
 *
 * - When the pointer is locked (first-person mode) the ray goes through the screen centre (crosshair);
 *   otherwise through the mouse position (free cursor mode).
 * - Left/right buttons, wheel and drags are dispatched to the Handle of the hit control.
 * - While a control captures the mouse (drag of a lever / knob), `capturing` is true: the camera
 *   controller (ui module) must not rotate the view.
 */
import * as THREE from 'three';
import type { App } from '../../app';

export interface InteractEvent {
  /** 0 left, 1 middle, 2 right. */
  button: number;
  /** Hit point in world space. */
  point: THREE.Vector3;
  /** Hit point in the handle's `ref` object local space. */
  local: THREE.Vector3;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface HandleInfo {
  /** Cockpit name (English). */
  name: string;
  /** French description. */
  fr?: string;
  /** Current state text (e.g. 'ON', '28 %'). */
  state?: string;
  id?: string;
}

export interface Handle {
  id: string;
  /** Object whose local frame is used for InteractEvent.local (usually the control root). */
  ref: THREE.Object3D;
  onDown?(e: InteractEvent): void;
  onUp?(e: InteractEvent): void;
  /** steps: +1 per wheel notch "up/forward", −1 "down/back" (may be fractional on trackpads, accumulated). */
  onWheel?(steps: number, e: InteractEvent): void;
  /** Mouse delta in pixels while the button is held after onDown (only if defined). */
  onDrag?(dx: number, dy: number, e: InteractEvent): void;
  describe?(): HandleInfo;
  /** Cursor hint for the UI crosshair. */
  cursor?: 'push' | 'toggle' | 'rotate' | 'drag' | 'key';
  enabled?(): boolean;
}

export class Interaction {
  enabled = true;
  hovered: Handle | null = null;
  hoverPoint = new THREE.Vector3();
  capturing = false;
  /** Mouse position in NDC (free cursor mode). */
  readonly mouse = new THREE.Vector2(0, 0);
  private readonly raycaster = new THREE.Raycaster();
  private readonly targets: THREE.Object3D[] = [];
  private active: { handle: Handle; e: InteractEvent } | null = null;
  private wheelAcc = 0;
  private wheelLast = 0;
  private dragDx = 0;
  private dragDy = 0;
  private listeners = new Set<(h: Handle | null) => void>();

  constructor(public app: App) {
    this.raycaster.far = 3.5;
    this.raycaster.near = 0.02;
    if (typeof window === 'undefined') return;
    const el = app.renderer.domElement;
    el.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    window.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    el.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    document.addEventListener('mousemove', (ev) => { if (this.isLocked()) this.onLockedMove(ev); });
    el.addEventListener('wheel', (ev) => this.onWheel(ev), { passive: false });
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  isLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.app.renderer.domElement;
  }

  /** Register every mesh under `obj` as a hit target for `handle`. */
  register(obj: THREE.Object3D, handle: Handle): void {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.handle = handle;
        this.targets.push(o);
      }
    });
  }

  /** Meshes that block the ray (panel faces, structure) without being interactive. */
  addBlocker(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.userData.blocker = true;
        this.targets.push(o);
      }
    });
  }

  unregister(obj: THREE.Object3D): void {
    const set = new Set<THREE.Object3D>();
    obj.traverse((o) => set.add(o));
    for (let i = this.targets.length - 1; i >= 0; i--) if (set.has(this.targets[i])) this.targets.splice(i, 1);
  }

  /** Called when the hovered control changes (UI tooltip). */
  onHoverChange(fn: (h: Handle | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private pick(): { handle: Handle; hit: THREE.Intersection } | null {
    const cam = this.app.camera;
    const ndc = this.isLocked() ? new THREE.Vector2(0, 0) : this.mouse;
    this.raycaster.setFromCamera(ndc, cam);
    const hits = this.raycaster.intersectObjects(this.targets, false);
    for (const h of hits) {
      const o = h.object;
      if (!o.visible && !o.userData.hitProxy) continue;
      if (o.userData.blocker) return null;
      const handle = o.userData.handle as Handle | undefined;
      if (!handle) continue;
      if (handle.enabled && !handle.enabled()) continue;
      return { handle, hit: h };
    }
    return null;
  }

  private makeEvent(handle: Handle, point: THREE.Vector3, ev: MouseEvent | WheelEvent | null, button = 0): InteractEvent {
    const local = handle.ref.worldToLocal(point.clone());
    return { button, point: point.clone(), local, shift: !!ev?.shiftKey, ctrl: !!(ev?.ctrlKey || ev?.metaKey), alt: !!ev?.altKey };
  }

  private onPointerDown(ev: PointerEvent) {
    if (!this.enabled) return;
    const p = this.pick();
    if (!p) return;
    ev.preventDefault();
    const e = this.makeEvent(p.handle, p.hit.point, ev, ev.button);
    this.active = { handle: p.handle, e };
    this.dragDx = this.dragDy = 0;
    if (p.handle.onDrag) this.capturing = true;
    try { p.handle.onDown?.(e); } catch (err) { console.error('[interaction] onDown', err); }
  }

  private onPointerUp(ev: PointerEvent) {
    const a = this.active;
    this.active = null;
    this.capturing = false;
    if (!a) return;
    try { a.handle.onUp?.({ ...a.e, button: ev.button }); } catch (err) { console.error('[interaction] onUp', err); }
  }

  private onPointerMove(ev: PointerEvent) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    if (!this.isLocked() && this.active?.handle.onDrag) this.dispatchDrag(ev.movementX, ev.movementY);
  }

  private onLockedMove(ev: MouseEvent) {
    if (this.active?.handle.onDrag) this.dispatchDrag(ev.movementX, ev.movementY);
  }

  private dispatchDrag(dx: number, dy: number) {
    const a = this.active!;
    this.dragDx += dx;
    this.dragDy += dy;
    try { a.handle.onDrag!(dx, dy, a.e); } catch (err) { console.error('[interaction] onDrag', err); }
  }

  private onWheel(ev: WheelEvent) {
    if (!this.enabled) return;
    const target = this.active?.handle ?? this.hovered;
    if (!target?.onWheel) return;
    ev.preventDefault();
    ev.stopPropagation();
    // Normalise: mouse wheel notch ≈ 100 px; trackpads send small deltas.
    let d = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    this.wheelAcc += -d;
    const now = performance.now();
    const fast = now - this.wheelLast < 45;
    this.wheelLast = now;
    const notch = 60;
    let steps = 0;
    while (this.wheelAcc >= notch) { steps++; this.wheelAcc -= notch; }
    while (this.wheelAcc <= -notch) { steps--; this.wheelAcc += notch; }
    if (!steps) return;
    const e = this.makeEvent(target, this.hoverPoint, ev, 1);
    (e as any).fast = fast;
    try { target.onWheel(steps, e); } catch (err) { console.error('[interaction] onWheel', err); }
  }

  /** True if the wheel is currently over a control (UI should not zoom then). */
  wheelConsumed(): boolean {
    return !!(this.hovered?.onWheel);
  }

  update(_dt: number, _t: number): void {
    if (!this.enabled) {
      if (this.hovered) { this.hovered = null; for (const l of this.listeners) l(null); }
      return;
    }
    if (this.active) return; // keep hover while holding
    const p = this.pick();
    const h = p?.handle ?? null;
    if (p) this.hoverPoint.copy(p.hit.point);
    if (h !== this.hovered) {
      this.hovered = h;
      for (const l of this.listeners) l(h);
    }
  }

  /** Info about the hovered control for tooltips. */
  hoverInfo(): HandleInfo | null {
    const h = this.hovered;
    if (!h) return null;
    return h.describe ? h.describe() : { name: h.id, id: h.id };
  }
}
