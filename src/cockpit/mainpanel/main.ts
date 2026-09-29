/**
 * Main instrument panel: pilot panels (PFD / ND bezels, lateral lighting & GPWS panels, knee panels),
 * centre panel (E/WD, SD, ISIS, triple indicator, clock, gear, AUTO/BRK, A/SKID), structure returns.
 * Built in the MAIN anchor frame (origin = E/WD centre, reclined 12°).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo, type PanelBuilder } from '../kit';
import { ANCHORS, placeAt } from '../layout';
import { Batch, addScrew } from './common';
import { buildIsis, buildTripleIndicator } from './instruments';
import { buildClock } from './clock';
import { buildAutobrake, buildGearIndicator, buildGearLever } from './gear';

/** DU geometry: 6.25" (158.8 mm) active area in a 190 mm bezel. */
export const DU = { active: 0.1588, bezel: 0.19, opening: 0.1665 };
const SUB_Z = 0.002; // sub-panels / instruments stand proud of the base panels

export function buildMainPanel(app: App): THREE.Group {
  const root = new THREE.Group();
  root.name = 'mainpanel:main';
  for (const side of [1, 2] as const) {
    const k = side === 1 ? -1 : 1;
    root.add(pilotBase(app, side));
    const lat = lateral(app, side);
    lat.position.set(k * 0.815, -0.035, 0.0015);
    root.add(lat);
  }
  root.add(centreBase(app));
  const place = (g: THREE.Group, x: number, y: number) => { g.position.set(x, y, SUB_Z); root.add(g); };
  place(buildIsis(app), -0.195, 0.012);
  place(buildTripleIndicator(app), -0.195, -0.087);
  place(buildClock(app), -0.195, -0.188);
  place(blankPlate(app, 'MAIN_BLANK_L', 0.09, 0.07), -0.195, -0.277);
  place(buildGearIndicator(app), 0.195, 0.047);
  place(buildAutobrake(app), 0.195, -0.028);
  place(buildGearLever(app), 0.235, -0.2);
  root.add(structure(app));
  placeAt(root, ANCHORS.MAIN);
  return root;
}

/** DU bezel (rounded corners, 4 screws) + the display area bound to the display id. */
function du(p: PanelBuilder, app: App, id: string, x: number, y: number): void {
  const M = app.kit.mats;
  p.addStatic(geo.rectRing(DU.bezel, DU.bezel, DU.opening, DU.opening, 0.0085, 0.009), M.bezel, x, y, 0);
  // inner black chamfer lining the opening
  p.addStatic(geo.rectRing(DU.opening + 0.0006, DU.opening + 0.0006, DU.opening - 0.004, DU.opening - 0.004, 0.0058, 0.005), M.black, x, y, 0);
  const s = DU.bezel / 2 - 0.0068;
  for (const [sx, sy] of [[-s, s], [s, s], [-s, -s], [s, -s]] as const) addScrew(p, M, x + sx, y + sy, 0.0085);
  p.screen(id, x, y, DU.active, DU.active, { margin: 0.0035, recess: 0.006 });
}

function pilotBase(app: App, side: 1 | 2): THREE.Group {
  const k = side === 1 ? -1 : 1;
  const cx = k * 0.61, cy = -0.0725;
  const p = app.kit.panel({ name: side === 1 ? 'MAIN_CAPT_BASE' : 'MAIN_FO_BASE', width: 0.64, height: 0.375, zone: 'main', pxPerM: 2400,
    screws: [[-0.3125, 0.18], [0.3125, 0.18], [-0.3125, -0.18], [0.3125, -0.18], [-0.3125, -0.04], [0.3125, -0.04], [k * -0.05, -0.18], [k * 0.14, -0.18]] });
  du(p, app, `PFD${side}`, k * 0.6 - cx, -cy);
  du(p, app, `ND${side}`, k * 0.39 - cx, -cy);
  // knee panel seam (separate lower module)
  p.addStatic(geo.box(0.64, 0.0012, 0.0008), app.kit.mats.black, 0, -0.108 - cy, 0.0001);
  const g = p.finish();
  g.position.set(cx, cy, 0);
  return g;
}

function lateral(app: App, side: 1 | 2): THREE.Group {
  const S = side === 1 ? 'CAPT' : 'FO';
  const k = side === 1 ? 1 : -1; // column A = outboard
  const p = app.kit.panel({ name: side === 1 ? 'MAIN_CAPT' : 'MAIN_FO', width: 0.2, height: 0.28, zone: 'main', thickness: 0.0055, pxPerM: 6000 });
  const a = -0.045 * k, b = 0.045 * k;
  p.sw(`MAIN_CONSOLE_FLOOR_${S}`, a, 0.085, { label: 'CONSOLE/FLOOR' });
  p.pot(`MAIN_LOUDSPEAKER_${S}`, b, 0.085, { style: 'round', size: 0.0072, label: 'LOUD SPEAKER', scale: ['', ''], labelRadius: 0.0165 });
  p.pot(`MAIN_PFD${side}_BRT`, a, 0.018, { style: 'round', size: 0.0065, label: 'PFD', scale: ['OFF', 'BRT'], labelRadius: 0.016 });
  // ND: inner knob = ND brightness, outer ring = WX / TERR brightness
  p.pot(`MAIN_ND${side}_WX_BRT`, b, 0.018, { style: 'concentric', size: 0.0108 });
  p.pot(`MAIN_ND${side}_BRT`, b, 0.018, { style: 'round', size: 0.0062, label: 'ND', scale: ['OFF', 'BRT'], labelRadius: 0.0175 });
  p.pb(`MAIN_PFD_ND_XFR_${S}`, a, -0.05, { label: 'PFD/ND XFR' });
  p.pb(`MAIN_GPWS_GS_${S}`, b, -0.05, { w: 0.022, h: 0.019 });
  p.pb(`MAIN_TERR_ON_ND_${S}`, b, -0.108, { label: 'TERR ON ND' });
  return p.finish();
}

function centreBase(app: App): THREE.Group {
  const cy = -0.1075;
  const p = app.kit.panel({ name: 'MAIN_CTR', width: 0.58, height: 0.445, zone: 'main', pxPerM: 4000,
    screws: [[-0.2845, 0.2145], [0.2845, 0.2145], [-0.2845, -0.2145], [0.2845, -0.2145], [-0.13, -0.2145], [0.13, -0.2145]] });
  du(p, app, 'EWD', 0, -cy);
  du(p, app, 'SD', 0, -0.212 - cy);
  p.sw('ASKID_NWSTRG', 0.135, -0.175 - cy, { label: ['A/SKID &', 'N/W STRG'], labelSize: 0.0026 });
  const g = p.finish();
  g.position.set(0, cy, 0);
  return g;
}

function blankPlate(app: App, name: string, w: number, h: number): THREE.Group {
  const p = app.kit.panel({ name, width: w, height: h, zone: 'main' });
  return p.finish();
}

/** Returns / cheeks so the panel reads as a solid structure (not a floating plate). */
function structure(app: App): THREE.Group {
  const M = app.kit.mats;
  const b = new Batch();
  for (const k of [-1, 1]) {
    b.at(geo.box(0.64, 0.004, 0.13), M.paint, k * 0.61, -0.262, -0.065); // knee panel lower return
    b.at(geo.roundedBox(0.645, 0.012, 0.014, 0.005), M.paintDark, k * 0.61, -0.264, -0.004); // lower edge trim
    b.at(geo.box(0.004, 0.375, 0.15), M.paint, k * 0.932, -0.0725, -0.075); // outer cheek
    b.at(geo.box(0.004, 0.074, 0.13), M.paint, k * 0.2915, -0.296, -0.065); // centre panel side return
  }
  b.at(geo.box(0.58, 0.004, 0.13), M.paint, 0, -0.332, -0.065);
  b.at(geo.roundedBox(0.585, 0.012, 0.014, 0.005), M.paintDark, 0, -0.334, -0.004);
  b.at(geo.box(1.86, 0.46, 0.004), M.black, 0, -0.1, -0.12); // back closure
  const g = b.build('MAIN:structure');
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) app.interaction.addBlocker(o); });
  return g;
}
