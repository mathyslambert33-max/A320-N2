/**
 * mainpanel module: glareshield (FCU, EFIS CPs, warning panels), main instrument panel (DU bezels,
 * lateral panels, centre panel with ISIS / triple indicator / clock / gear / AUTO BRK), the clock
 * logic + CLOCK display, and the standby compass. See docs/vars/mainpanel.md.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { buildGlareshield } from './glareshield';
import { buildMainPanel } from './main';
import { buildCompass } from './compass';
import { installClockLogic } from './clock';

export default function install(app: App): void {
  installClockLogic(app);
  const root = new THREE.Group();
  root.name = 'mainpanel';
  root.add(buildMainPanel(app));
  root.add(buildGlareshield(app));
  root.add(buildCompass(app));
  app.cockpit.add(root);
  // Draw-call reduction: batched caps/knobs/levers/legends + merged statics (kit.optimise). `&mpBatch=0` disables it.
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const batch = q?.get('mpBatch') === '0' ? null : app.kit.optimise(root, 'MAIN');
  app.services.mainpanel = { root, batch };
}
