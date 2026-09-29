/**
 * Radio management panels (RMP 1/2/3, 146 × 85.7 mm) and audio control panels (ACP 1/2, 146 × 95.25 mm).
 * Layouts after the FCOM figures / FlyByWire A32NX panel renders (positions in mm from the plate centre).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import type { Handle } from '../kit';
import { geo } from '../kit';
import { materials } from '../kit/materials';
import { Plate, leg, m, pedMats, toggle, blackIndex } from './lib';
import { atlas } from '../kit/atlas';
import { RMP_CANVAS } from './displays';

export const RMP_H = 85.7;
export const ACP_H = 95.25;

export function buildRmp(app: App, n: 1 | 2 | 3): THREE.Group {
  const M = materials();
  const PM = pedMats();
  const R = `RMP${n}`;
  const pl = new Plate(app, `PED_RMP${n}`, 146, RMP_H);
  // windows (ACTIVE = left half of the RMP canvas, STBY/CRS = right half)
  pl.label('ACTIVE', -40.5, 38.2, 2.3);
  pl.label('STBY/CRS', 40.5, 38.2, 2.3);
  const wy = 26.6;
  const ww = 45, wh = ww * (RMP_CANVAS.h / (RMP_CANVAS.w / 2));
  pl.window7(R, -40.5, wy, ww, wh, [0, 0.5, 0, 1], { w: ww + 5.5, h: wh + 5 });
  pl.window7(R, 40.5, wy, ww, wh, [0.5, 1, 0, 1], { w: ww + 5.5, h: wh + 5 });
  pl.pb(`${R}_XFER`, 0, wy, { w: 12.5, h: 8.4, capText: '↔' });
  // transceiver keys
  const kw = 13.4, kh = 9;
  pl.pb(`${R}_VHF1`, -52, 5, { w: kw, h: kh, capText: 'VHF 1' });
  pl.pb(`${R}_VHF2`, -34.6, 5, { w: kw, h: kh, capText: 'VHF 2' });
  pl.pb(`${R}_VHF3`, -17.2, 5, { w: kw, h: kh, capText: 'VHF 3' });
  pl.pb(`${R}_HF1`, -52, -11, { w: kw, h: kh, capText: 'HF 1' });
  pl.ann(`${R}_SEL`, -34.6, -11, 9.5, 7);
  pl.pb(`${R}_HF2`, -17.2, -11, { w: kw, h: kh, capText: 'HF 2' });
  pl.pb(`${R}_AM`, 0.2, -11, { w: kw, h: kh, capText: 'AM' });
  // NAV back-up section
  pl.line([[-63, -21.5], [63, -21.5]], 0.45, 0.8);
  pl.pb(`${R}_NAV`, -52, -32.5, { w: kw, h: kh, capText: 'NAV' });
  pl.pb(`${R}_VOR`, -34.6, -32.5, { w: kw, h: kh, capText: 'VOR' });
  pl.pb(`${R}_ILS`, -17.2, -32.5, { w: kw, h: kh, capText: 'ILS' });
  pl.pb(`${R}_MLS`, 0.2, -32.5, { w: kw, h: kh, capText: 'MLS' });
  pl.pb(`${R}_ADF`, 17.6, -32.5, { w: kw, h: kh, capText: 'ADF' });
  pl.pb(`${R}_BFO`, 35, -32.5, { w: kw, h: kh, capText: 'BFO' });
  // dual frequency selector: outer ring = MHz, inner knob = kHz (light grey)
  const kx = 27, ky = -3.5;
  pl.enc(`${R}_OUTER`, kx, ky, { style: 'concentric', size: 12.5, material: PM.knobWhite });
  pl.enc(`${R}_INNER`, kx, ky, { style: 'round', size: 8.2, material: PM.knobWhite });
  pl.addStatic(geo.latheZ('pedRmpKnobCollar', [[m(12.5), 0], [m(14.6), 0], [m(14.6), 0.0012], [m(12.5), 0.0016]], 48), M.bezel, kx, ky, 0);
  // ON / OFF
  toggle(pl, `${R}_ON`, 52.5, -28, { angles: [22, -22], length: 12 });
  pl.label('ON', 52.5, -17.4, 2.1);
  pl.label('OFF', 52.5, -39, 2.1);
  return pl.finish();
}

/**
 * Reception knob: kit pot (volume, wheel) + push/pull on click (knob out = reception ON, `C:ACPn_RX_<ch>_ON`).
 * The integral light ring is a kit legend (light `L:ACPn_RX_<ch>_LT`, driven by the ACP logic) so it is batched.
 */
function rxKnob(pl: Plate, n: number, k: string, x: number, y: number): void {
  const app = pl.app;
  const kit = pl.kit;
  const potId = `ACP${n}_RX_${k}`;
  const onId = `ACP${n}_RX_${k}_ON`;
  const root = pl.pot(potId, x, y, { style: 'round', size: 4.9 });
  const knob = root.children[0] as THREE.Group;
  const cell = atlas().cell(['▬'], 3, 'bar');
  const u = (cell.u0 + cell.u1) / 2, v = (cell.v0 + cell.v1) / 2;
  const rg = geo.latheZ('pedRxRing', [[m(4.95), 0.0005], [m(5.3), 0.0005], [m(5.3), 0.0021], [m(4.95), 0.0021]], 32).clone();
  const uv = rg.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  const mat = kit.legendMaterial('W');
  const ring = new THREE.Mesh(rg, mat);
  knob.add(ring);
  kit.addLegend(`ACP${n}_RX_${k}_LT`, mat);
  let out = kit.sim.get(`C:${onId}`) > 0.5 ? 0.0028 : 0;
  kit.addInstance({
    id: onId,
    sync: (sim, dt) => {
      const target = sim.get(`C:${onId}`) > 0.5 ? 0.0028 : 0;
      out += (target - out) * Math.min(1, dt * 25);
      knob.position.z = out;
    },
  });
  const def = kit.def(potId);
  const setVol = (val: number) => kit.setControl(potId, Math.max(0, Math.min(1, val)), root, 'pot');
  const handle: Handle = {
    id: potId,
    ref: root,
    cursor: 'rotate',
    onDown: (e) => {
      if (e.button === 2) { setVol(kit.sim.get(`C:${potId}`) - 0.1); return; }
      kit.setControl(onId, kit.sim.get(`C:${onId}`) > 0.5 ? 0 : 1, root, kit.sim.get(`C:${onId}`) > 0.5 ? 'push' : 'pull');
    },
    onWheel: (s, e) => setVol(kit.sim.get(`C:${potId}`) + s * ((e as { fast?: boolean }).fast ? 0.06 : 0.03)),
    describe: () => ({
      name: def.name, fr: `${def.fr ?? ''} — clic = tirer/pousser (écoute), molette = volume`, id: potId,
      state: `${kit.sim.get(`C:${onId}`) > 0.5 ? 'OUT (ON)' : 'IN (OFF)'} · ${Math.round(kit.sim.get(`C:${potId}`) * 100)} %`,
    }),
  };
  app.interaction.register(knob, handle);
}

export function buildAcp(app: App, n: 1 | 2): THREE.Group {
  const M = materials();
  const A = `ACP${n}`;
  const pl = new Plate(app, `PED_ACP${n}`, 146, ACP_H);
  const xs = [-52, -34.6, -17.2, 0.2, 17.6, 35, 52.4];
  const tx: Array<[string, string]> = [['VHF1', 'VHF 1'], ['VHF2', 'VHF 2'], ['VHF3', 'VHF 3'], ['HF1', 'HF 1'], ['HF2', 'HF 2'], ['INT', 'INT'], ['CAB', 'CAB']];
  tx.forEach(([k, name], i) => {
    const call = k === 'INT' ? 'MECH' : k === 'CAB' ? 'ATT' : 'CALL';
    // green selection bars on top, CALL / MECH / ATT legend below (amber when a call is received)
    pl.pb(`${A}_TX_${k}`, xs[i], 35, { w: 14.2, h: 9.4, capText: ' ', legends: [leg('▬', 'G', `${A}_TX_${k}`), leg(call, 'A', `${A}_TX_${k}_CALL`)] });
    pl.label(name, xs[i], 23.8, 2.0);
    rxKnob(pl, n, k, xs[i], 13.8);
  });
  // INT / RAD, VOICE, RESET, PA
  toggle(pl, `${A}_INT_RAD`, -48, -7.5, { angles: [24, 0, -24], springFrom: [2], rest: 1, length: 12 });
  pl.label('INT', -48, 2.8, 2.1);
  pl.label('RAD', -48, -17.8, 2.1);
  pl.pb(`${A}_VOICE`, -16.5, -7.5, { w: 15, h: 9.4, capText: 'VOICE' });
  pl.pb(`${A}_RESET`, 1.5, -7.5, { w: 15, h: 9.4, capText: 'RESET' });
  rxKnob(pl, n, 'PA', 22.5, -7.5);
  pl.label('PA', 32.5, -7.5, 2.1);
  pl.pb(`${A}_TX_PA`, 50.8, -7.5, { w: 14.2, h: 9.4, capText: ' ', legends: [leg('▬', 'G', `${A}_TX_PA`), leg('CALL', 'A', `${A}_TX_PA_CALL`)] });
  pl.rect(50.8, -7.5, 21, 15.5, 0.5);
  // navigation receivers (no MLS receiver on this aircraft: blank plug)
  const nav: Array<[string, string, number]> = [['VOR1', 'VOR 1', xs[0]], ['VOR2', 'VOR 2', xs[1]], ['MKR', 'MKR', xs[2]], ['ILS', 'ILS', xs[3]], ['ADF1', 'ADF 1', xs[5]], ['ADF2', 'ADF 2', xs[6]]];
  for (const [k, name, x] of nav) {
    pl.label(name, x, -25.6, 2.0);
    rxKnob(pl, n, k, x, -35.6);
  }
  pl.label('MLS', xs[4], -25.6, 2.0, { alpha: 0.35 });
  pl.addStatic(geo.cylZ(m(4.2), m(4.4), 0.0012, 28), M.bezel, xs[4], -35.6, 0);
  return pl.finish();
}

/** Keep the tree-shaker from dropping helper imports used only in some builds. */
export const _radioInternals = { blackIndex };
