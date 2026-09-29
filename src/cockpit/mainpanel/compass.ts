/**
 * Standby compass hanging from the windshield centre post (above the glareshield), with its
 * correction card. Card lit by the ICE IND & STBY COMPASS switch (`S:INTLT_STBY_COMPASS`).
 * Built directly in the aircraft body frame.
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { FONT } from '../../displays/framework';
import { Batch, DEG } from './common';

/** Body-frame position of the compass case centre (windshield centre post, upper part). */
export const COMPASS_POS = new THREE.Vector3(0, 1.585, -0.772);

export function buildCompass(app: App): THREE.Group {
  const M = app.kit.mats;
  const root = new THREE.Group();
  root.name = 'mainpanel:compass';
  root.position.copy(COMPASS_POS);
  root.rotation.x = -8 * DEG; // hangs slightly tilted toward the crew

  const b = new Batch();
  const W = 0.07, H = 0.058, D = 0.052;
  // case: back body + front hood around the window
  b.at(geo.roundedBox(W, H, 0.043, 0.006), M.bezel, 0, 0, -0.0215);
  const hoodT = 0.004;
  b.at(geo.box(W, hoodT, D * 0.5), M.bezel, 0, H / 2 - hoodT / 2, D * 0.25);
  b.at(geo.box(W, hoodT, D * 0.5), M.bezel, 0, -H / 2 + hoodT / 2, D * 0.25);
  b.at(geo.box(hoodT, H, D * 0.5), M.bezel, W / 2 - hoodT / 2, 0, D * 0.25);
  b.at(geo.box(hoodT, H, D * 0.5), M.bezel, -W / 2 + hoodT / 2, 0, D * 0.25);
  const front = new THREE.Shape();
  front.moveTo(-W / 2, -H / 2); front.lineTo(W / 2, -H / 2); front.lineTo(W / 2, H / 2); front.lineTo(-W / 2, H / 2); front.closePath();
  const hole = new THREE.Path();
  const hw = 0.026, hh = 0.0135;
  hole.moveTo(-hw, -hh); hole.lineTo(hw, -hh); hole.quadraticCurveTo(hw + 0.004, 0, hw, hh); hole.lineTo(-hw, hh); hole.quadraticCurveTo(-hw - 0.004, 0, -hw, -hh);
  front.holes.push(hole);
  b.at(new THREE.ExtrudeGeometry(front, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2 }), M.bezel, 0, 0, D / 2 - 0.003);
  // compensator screws (N-S / E-W) on the lower face
  b.at(geo.cylZ(0.0022, 0.0022, 0.002, 16), M.chrome, -0.012, -H / 2 + 0.006, D / 2 + 0.0005);
  b.at(geo.cylZ(0.0022, 0.0022, 0.002, 16), M.chrome, 0.012, -H / 2 + 0.006, D / 2 + 0.0005);
  // mounting bracket up to the centre post / upper windshield frame
  b.at(geo.roundedBox(0.016, 0.07, 0.012, 0.003), M.darkMetal, 0, H / 2 + 0.033, -0.02);
  b.at(geo.roundedBox(0.05, 0.012, 0.03, 0.003), M.darkMetal, 0, H / 2 + 0.068, -0.03);
  // correction card holder under the case
  b.at(geo.roundedBox(0.064, 0.036, 0.004, 0.002), M.bezel, 0, -H / 2 - 0.022, 0.012);
  b.at(geo.box(0.008, 0.012, 0.01), M.bezel, 0, -H / 2 - 0.003, 0.006);
  const statics = b.build('STBY_COMPASS:case');
  root.add(statics);

  // card: drum with the heading scale (whiskey compass: higher headings appear to the LEFT)
  const { tex, cardTex } = makeTextures();
  const cardMat = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(1.0, 0.9, 0.72), emissiveMap: tex, emissiveIntensity: 0, roughness: 0.7 });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0205, 0.016, 64, 1, true), cardMat);
  drum.position.z = 0.002;
  root.add(drum);
  // float dome top/bottom (dark) to hide the drum interior
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0205, 48), M.black);
  cap.rotation.x = -Math.PI / 2;
  cap.position.set(0, 0.008, 0.002);
  const cap2 = cap.clone();
  cap2.rotation.x = Math.PI / 2;
  cap2.position.y = -0.008;
  root.add(cap, cap2);
  // lubber line + glass
  const lubber = new THREE.Mesh(geo.box(0.0009, 0.024, 0.0005), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 0, roughness: 0.5 }));
  lubber.position.set(0, 0, 0.0232);
  root.add(lubber);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.03), M.screenGlass);
  glass.position.z = 0.0245;
  glass.renderOrder = 2;
  root.add(glass);
  // correction card
  const cardMat2 = new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.8 });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.03), cardMat2);
  card.position.set(0, -H / 2 - 0.022, 0.0142);
  root.add(card);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o !== glass; o.receiveShadow = true; } });
  app.interaction.addBlocker(statics);

  let hdg = NaN;
  const lubberMat = lubber.material as THREE.MeshStandardMaterial;
  app.onFrame((dt) => {
    const sim = app.sim;
    const mag = (((sim.get('G:AC_HDG_TRUE') - sim.get('G:AC_MAGVAR')) % 360) + 360) % 360;
    if (Number.isNaN(hdg)) hdg = mag;
    let d = mag - hdg;
    d = ((d + 540) % 360) - 180;
    hdg += d * Math.min(1, dt * 2.2); // damped card
    drum.rotation.y = hdg * DEG;
    const lt = sim.get('S:INTLT_STBY_COMPASS');
    cardMat.emissiveIntensity = lt * 0.55;
    lubberMat.emissiveIntensity = lt * 0.8;
  });
  return root;
}

function makeTextures(): { tex: THREE.CanvasTexture; cardTex: THREE.CanvasTexture } {
  const W = 2048, H = 160;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0c0c';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#f0ede2';
  g.strokeStyle = '#f0ede2';
  const xOf = (h: number) => W * (1 - h / 360);
  for (let h = 0; h < 360; h += 5) {
    const x = xOf(h);
    const major = h % 10 === 0;
    g.lineWidth = major ? 4 : 3;
    g.beginPath();
    g.moveTo(x, H - 4);
    g.lineTo(x, H - (major ? 46 : 28));
    g.stroke();
    if (h % 30 === 0) {
      const lbl = h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : String(h / 10);
      g.font = `700 ${h % 90 === 0 ? 74 : 62}px ${FONT.panel}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const dx of [0, W, -W]) g.fillText(lbl, x + dx, 56);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;

  const c2 = document.createElement('canvas');
  c2.width = 512; c2.height = 264;
  const k = c2.getContext('2d')!;
  k.fillStyle = '#eceae2';
  k.fillRect(0, 0, 512, 264);
  k.fillStyle = '#111';
  k.font = `700 30px ${FONT.panel}`;
  k.textAlign = 'center';
  k.fillText('STBY COMPASS CORRECTION', 256, 38);
  k.font = `600 27px ${FONT.panel}`;
  const rows = [['FOR', 'N', '30', '60', 'E', '120', '150'], ['STEER', '359', '29', '61', '91', '121', '151'], ['FOR', 'S', '210', '240', 'W', '300', '330'], ['STEER', '181', '209', '239', '269', '298', '329']];
  rows.forEach((r, i) => r.forEach((t, j) => k.fillText(t, 50 + j * 69, 90 + i * 42)));
  k.strokeStyle = '#111';
  k.lineWidth = 2;
  k.strokeRect(6, 6, 500, 252);
  k.beginPath(); k.moveTo(6, 52); k.lineTo(506, 52); k.moveTo(6, 153); k.lineTo(506, 153); k.stroke();
  const cardTex = new THREE.CanvasTexture(c2);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  cardTex.anisotropy = 8;
  return { tex, cardTex };
}
