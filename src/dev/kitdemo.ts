/** Lead's visual test of the 3D kit: a replica-ish ELEC panel + assorted controls. */
import * as THREE from 'three';
import type { App } from '../app';
import { ANCHORS, placeAt } from '../cockpit/layout';

export default function install(app: App) {
  const k = app.kit;
  const root = new THREE.Group();
  const p = k.panel({ name: 'DEMO_ELEC', width: 0.438, height: 0.12, zone: 'ovhd' });
  p.label('ELEC', -0.205, 0.05, { align: 'left', size: 0.0032 });
  p.pb('ELEC_BAT1', -0.15, 0.028, { label: 'BAT 1' });
  p.pb('ELEC_BAT2', -0.11, 0.028, { label: 'BAT 2' });
  p.screen('ELEC_BAT1_V', -0.15, 0.052, 0.022, 0.009, { glass: false, margin: 0.0015 });
  p.pb('ELEC_GEN1', -0.15, -0.025, { label: 'GEN 1' });
  p.pb('ELEC_APU_GEN', -0.07, -0.025, { label: 'APU GEN' });
  p.pb('ELEC_BUS_TIE', 0.0, -0.025, { label: 'BUS TIE' });
  p.pb('ELEC_EXT_PWR', 0.07, -0.025, { label: 'EXT PWR' });
  p.pb('ELEC_GEN2', 0.15, -0.025, { label: 'GEN 2' });
  p.pb('ELEC_IDG1', -0.19, -0.025, { label: 'IDG 1' });
  p.pb('ELEC_GALY_CAB', 0.0, 0.028, { label: ['GALY & CAB'] });
  p.pb('ELEC_AC_ESS_FEED', 0.07, 0.028, { label: ['AC ESS FEED'] });
  p.bracket('BAT', -0.165, -0.095, 0.05, {});
  p.sw('EXTLT_STROBE', 0.13, 0.03, { label: 'STROBE' });
  p.rot('ADIRS_IR1_MODE', 0.19, 0.02, { label: 'IR 1' });
  p.pot('AIR_TEMP_CKPT', 0.19, -0.03, { style: 'pointer', scale: ['COLD', 'HOT'], label: 'CKPT' });
  root.add(p.finish());
  placeAt(root, ANCHORS.OVHD);
  root.position.add(new THREE.Vector3(0, -0.02, -0.25));
  app.cockpit.add(root);

  const q = k.panel({ name: 'DEMO_FCU', width: 0.3, height: 0.08, zone: 'glare', material: 'paintDark' });
  q.enc('FCU_SPD', -0.1, 0, { label: 'SPD' });
  q.pb('FCU_AP1', 0, 0.012, { capText: 'AP 1', w: 0.02, h: 0.016 });
  q.pb('FCU_ATHR', 0.03, 0.012, { capText: 'A/THR', w: 0.02, h: 0.016 });
  q.key('MCDU1_KEY_A', 0.0, -0.022, 0.012, 0.012);
  q.key('MCDU1_KEY_FPLN', 0.03, -0.022, 0.018, 0.012);
  q.ann('ADIRS_ON_BAT', 0.08, 0.0, 0.018, 0.01);
  q.pb('FIRE_ENG1_PB', 0.12, 0.0, { w: 0.03, h: 0.022, outWhenOn: true });
  const g2 = q.finish();
  placeAt(g2, ANCHORS.GLARE);
  app.cockpit.add(g2);
}
