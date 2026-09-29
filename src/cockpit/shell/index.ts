/**
 * shell module: flight-deck structure, windows, seats, flight controls, lateral consoles, door,
 * interior lighting. See docs/vars/shell.md.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { buildStructure } from './structure';
import { buildWindows } from './windows';
import { buildControls } from './controls';
import { buildConsoles } from './consoles';
import { buildSeats } from './seats';
import { SHELL_GEOM } from './geom';

export default function install(app: App): void {
  const root = new THREE.Group();
  root.name = 'shell';
  const s = buildStructure(app);
  root.add(s.root);
  for (const b of s.blockers) app.interaction.addBlocker(b);
  const w = buildWindows(app);
  root.add(w.root);
  const c = buildControls(app);
  root.add(c.root);
  const k = buildConsoles(app);
  root.add(k.root);
  for (const b of k.blockers) app.interaction.addBlocker(b);
  root.add(buildSeats(app));
  app.cockpit.add(root);
  app.onFrame((dt) => {
    w.update();
    c.update(dt);
    k.update(dt);
  }, 50);
  app.services.shell = { root, geom: SHELL_GEOM };
}
