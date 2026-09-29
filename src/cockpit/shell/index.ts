/**
 * shell module: flight-deck structure (walls, windshield frame, ceiling, floor, bulkhead), windows (glass,
 * sliding windows, wipers, eye-position indicator, sun visors), seats, flight controls (sidesticks, tillers,
 * rudder pedals), lateral consoles, cockpit door + entrance area, aft equipment, interior lighting.
 * See docs/vars/shell.md.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { buildStructure } from './structure';
import { buildWindows } from './windows';
import { buildControls } from './controls';
import { buildConsoles } from './consoles';
import { buildSeats } from './seats';
import { buildDoor } from './door';
import { buildRear } from './rear';
import { buildLights } from './lights';
import { mergeStatics } from './surf';
import { SHELL_GEOM } from './geom';

export default function install(app: App): void {
  const root = new THREE.Group();
  root.name = 'shell';
  const s = buildStructure(app);
  const w = buildWindows(app);
  const c = buildControls(app);
  const k = buildConsoles(app);
  const d = buildDoor(app);
  const r = buildRear(app);
  const l = buildLights(app);
  root.add(s.root, w.root, c.root, k.root, buildSeats(app), d.root, r.root, l.root);
  // Draw calls: every static shell mesh merged per material (moving parts, glass and kit panels stay separate).
  const statics = mergeStatics(root);
  for (const m of statics) if (!(m.material as THREE.Material).transparent) app.interaction.addBlocker(m);
  app.cockpit.add(root);
  // kit panels of the consoles / mask boxes / jack panels / C/B panel: batched like the other panel modules
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  if (q?.get('shellBatch') !== '0') {
    try { app.kit.optimise(k.root, 'SHELL_CONSOLES'); } catch (e) { console.warn('[shell] kit.optimise failed', e); }
  }
  app.onFrame((dt) => {
    w.update();
    c.update(dt);
    k.update(dt);
    d.update(dt);
    l.update();
  }, 50);
  app.services.shell = { root, geom: SHELL_GEOM, statics: statics.length };
}
