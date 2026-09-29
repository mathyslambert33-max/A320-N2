/**
 * Pedestal assembly. Real layout (FCOM pedestal figure, FBW A32NX renders), real module sizes:
 *
 *  sloped section (anchor PED_FWD, 20°):  MCDU 1 | SWITCHING + ECAM CP + blank + quadrant front cover | MCDU 2
 *  flat section (anchor PED), wide part (x ±0.2575, 146 / 214 / 146 mm columns):
 *     RMP 1  | thrust levers, trim wheels | RMP 2
 *     ACP 1  |          "                 | ACP 2
 *     LIGHTS |          "                 | FLOOD PED / AIDS / DFDR
 *     WXR    | blank · ENG · blank         | ATC / TCAS
 *  narrow aft part (x ±0.1955, 146 / 91 / 146 mm):
 *     SPEED BRAKE | RUD TRIM        | FLAPS
 *     COCKPIT DOOR| PARKING BRK     | PRINTER
 *     RMP 3       | GRAVITY GEAR    |   "
 *
 * Flat section rows are given in the PED anchor frame (local y = forward, 0.425 = slope break, body z = 0.025 − y).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { ANCHORS, placeAt } from '../layout';
import type { PedestalLogic } from './logic';
import { buildMcdu, buildSwitching, buildEcp, blank } from './fwd';
import { buildRmp, buildAcp, RMP_H, ACP_H } from './radio';
import { buildLightingCapt, buildLightingFo, buildWxr, buildAtc, buildCockpitDoor, buildRudTrim, buildParkBrkPlate, buildGravityGear, buildPrinter } from './panels';
import { buildQuadrant, buildEngPanel } from './quadrant';
import { buildSpeedBrake, buildFlaps, addParkBrakeHandle } from './levers';
import { buildBody, wheelWells } from './body';
import { Plate } from './lib';

const MMm = 0.001;
/** Column centres (m). */
const COL = { L: -0.18, R: 0.18, AL: -0.1185, AR: 0.1185 };
/** Slope break in the PED frame. */
const Y0 = 0.425;

function at(parent: THREE.Group, g: THREE.Group, x: number, y: number): THREE.Group {
  g.position.set(x, y, 0);
  parent.add(g);
  return g;
}

export function buildPedestal(app: App, _logic: PedestalLogic): THREE.Group {
  const root = new THREE.Group();
  root.name = 'pedestal';
  const fwd = new THREE.Group();
  fwd.name = 'pedestal:PED_FWD';
  placeAt(fwd, ANCHORS.PED_FWD);
  const flat = new THREE.Group();
  flat.name = 'pedestal:PED';
  placeAt(flat, ANCHORS.PED);
  root.add(fwd, flat);

  // ---------------- sloped section (slope-local y: −0.13 at the break … +0.108 at the fairing)
  const mcduY = -0.128 + 0.229 / 2;
  at(fwd, buildMcdu(app, 1), COL.L, mcduY);
  at(fwd, buildMcdu(app, 2), COL.R, mcduY);
  const top = 0.101;
  at(fwd, buildSwitching(app), 0, top - 0.0667 / 2);
  at(fwd, buildEcp(app), 0, top - 0.0667 - 0.0762 / 2);
  const blankTop = top - 0.0667 - 0.0762;
  at(fwd, blank(app, 'PED_CTR_BLANK', 214, 25.4, [[-101, 7], [101, 7]]), 0, blankTop - 0.0127);
  // quadrant front cover: centre plate and the two plates ahead of the trim wheel slots
  const coverTop = blankTop - 0.0254;
  const coverLen = coverTop + 0.13;
  at(fwd, blank(app, 'PED_THR_FWD', 159, coverLen / MMm, [[-72, coverLen / MMm / 2 - 6], [72, coverLen / MMm / 2 - 6]]), 0, coverTop - coverLen / 2);
  const sideLen = coverTop + 0.098;
  for (const s of [-1, 1]) at(fwd, blank(app, `PED_THR_FWD_${s < 0 ? 'L' : 'R'}`, 27.5, sideLen / MMm, false), s * 0.0935, coverTop - sideLen / 2);
  // forward trim strip under the fairing
  at(fwd, blank(app, 'PED_FWD_STRIP', 506, 7, []), 0, 0.1045);

  // ---------------- flat section, wide part
  let y = Y0;
  const rmpY = y - (RMP_H * MMm) / 2; y -= RMP_H * MMm;
  const acpY = y - (ACP_H * MMm) / 2; y -= ACP_H * MMm;
  const ltY = y - 0.0476 / 2; y -= 0.0476;
  const wxY = y - 0.0667 / 2; y -= 0.0667;
  const yStep = y; // 0.12975
  at(flat, buildRmp(app, 1), COL.L, rmpY);
  at(flat, buildRmp(app, 2), COL.R, rmpY);
  at(flat, buildAcp(app, 1), COL.L, acpY);
  at(flat, buildAcp(app, 2), COL.R, acpY);
  at(flat, buildLightingCapt(app), COL.L, ltY);
  at(flat, buildLightingFo(app), COL.R, ltY);
  at(flat, buildWxr(app), COL.L, wxY);
  at(flat, buildAtc(app), COL.R, wxY);
  // centre column: quadrant + ENG panel row
  buildQuadrant(app, flat);
  flat.add(wheelWells());
  const engY = yStep + 0.0762 / 2;
  at(flat, buildEngPanel(app), 0, engY);
  for (const s of [-1, 1]) at(flat, blank(app, `PED_ENG_BLANK_${s < 0 ? 'L' : 'R'}`, 51, 76.2, [[0, 32.6], [0, -32.6]]), s * 0.0815, engY);
  // strips between the ENG row and the quadrant cover (above the wheel slots' aft ends)
  const stripTop = Y0 - 0.2195;
  void stripTop;

  // ---------------- flat section, narrow aft part
  y = yStep;
  const spdY = y - 0.0889 / 2;
  const doorY = y - 0.0889 - 0.05715 / 2;
  const rmp3Y = y - 0.0889 - 0.05715 - (RMP_H * MMm) / 2;
  const endY = yStep - 0.26035;
  const lBlankTop = y - 0.0889 - 0.05715 - RMP_H * MMm;
  at(flat, buildSpeedBrake(app), COL.AL, spdY);
  at(flat, buildCockpitDoor(app), COL.AL, doorY);
  at(flat, buildRmp(app, 3), COL.AL, rmp3Y);
  at(flat, blank(app, 'PED_AFT_BLANK_L', 146, (lBlankTop - endY) / MMm), COL.AL, (lBlankTop + endY) / 2);
  const rudY = y - 0.09525 / 2;
  const pbY = y - 0.09525 - 0.0857 / 2;
  const ggY = y - 0.09525 - 0.0857 - 0.0794 / 2;
  at(flat, buildRudTrim(app), 0, rudY);
  const pbHx = 15, pbHy = -8;
  const pbPlate = at(flat, buildParkBrkPlate(app, pbHx, pbHy), 0, pbY);
  addParkBrakeHandle(app, pbPlate, pbHx, pbHy);
  at(flat, buildGravityGear(app), 0, ggY);
  at(flat, buildFlaps(app), COL.AR, spdY);
  at(flat, buildPrinter(app), COL.AR, y - 0.0889 - 0.17145 / 2);

  // ---------------- structure
  root.add(buildBody(app));

  app.cockpit.add(root);
  const stats = app.kit.optimise(root, 'PED');
  app.services.pedestal3d = { root, fwd, flat, stats };
  return root;
}

/** Re-export for scenario/debug code. */
export { Plate };
