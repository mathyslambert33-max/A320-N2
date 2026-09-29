/**
 * Overhead module: forward overhead panel (anchor OVHD) and aft overhead (anchor OVHD_AFT).
 * Layout after the user's reference photo (docs/ref/overhead-reference.webp), real Airbus module sizes.
 * Every functional control uses the catalog ids; the kit wires C: vars, lights, sounds and tooltips.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { ANCHORS, placeAt } from '../layout';
import { buildForward } from './fwd';
import { buildAftSection, buildAftOverhead } from './aft';
import { buildFrameFwd, buildFrameAft } from './frame';
import { ovhdMats } from './lib';
import { optimiseOverhead } from './batch';

export default function install(app: App): void {
  const fwd = new THREE.Group();
  fwd.name = 'overhead:OVHD';
  buildForward(app, fwd);
  buildAftSection(app, fwd);
  buildFrameFwd(fwd);
  placeAt(fwd, ANCHORS.OVHD);
  app.cockpit.add(fwd);

  const aft = new THREE.Group();
  aft.name = 'overhead:OVHD_AFT';
  buildAftOverhead(app, aft);
  buildFrameAft(aft);
  placeAt(aft, ANCHORS.OVHD_AFT);
  app.cockpit.add(aft);

  // Draw-call reduction (merged statics, batched caps & legends); the updaters follow the kit's animation/lights.
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const updaters = q?.get('ovhdBatch') === '0' ? [] : [optimiseOverhead(app, fwd, 'OVHD'), optimiseOverhead(app, aft, 'OVHD_AFT')];

  // Green synoptic lines glow with the overhead integral lighting like the engravings.
  const syn = ovhdMats().syn;
  let last = -1;
  app.onFrame(() => {
    for (const u of updaters) u();
    const v = app.sim.get('S:INTLT_INTEG_OVHD');
    if (v === last) return;
    last = v;
    for (const mt of syn) mt.emissiveIntensity = v * 1.5;
  }, 900);
  app.services.overhead = { fwd, aft };
}
