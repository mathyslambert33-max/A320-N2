/**
 * Cockpit clock (MAIN_CLOCK): 3D unit + the 'CLOCK' display (three transflective LCD windows:
 * CHR MIN:SEC on top, UTC HH:MM SS in the middle, ET HH:MM at the bottom).
 */
import * as THREE from 'three';
import type { App } from '../../app';
import { geo } from '../kit';
import { createDisplayMaterial, drawSevenSeg, registerDisplay, FONT } from '../../displays/framework';
import { ClockLogic, clockTexts } from './clock-logic';
import { addScrew } from './common';
import { instrumentFace } from './instruments';

/** Canvas bands (px, 256 × 256 canvas): CHR 0-80, UTC 88-168, ET 176-256. */
const BANDS = { chr: [0, 80], utc: [88, 168], et: [176, 256] } as const;
const DIGIT = '#e6ebe1';
const GHOST = '#161b18';
const LCD_BG = '#0a0d0b';

export function installClockLogic(app: App): ClockLogic {
  const logic = new ClockLogic();
  app.sim.register(logic.attach(app.sim));
  registerDisplay({
    id: 'CLOCK',
    width: 256,
    height: 256,
    hz: 8,
    background: '#000',
    powered: (sim) => sim.getB('S:CLOCK_POWERED'),
    draw: (ctx, sim, info) => {
      const tx = clockTexts(sim, info.t);
      const band = (b: readonly [number, number], label: string) => {
        ctx.fillStyle = LCD_BG;
        ctx.fillRect(0, b[0], 256, b[1] - b[0]);
        ctx.font = `600 13px ${FONT.panel}`;
        ctx.fillStyle = '#7d847c';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(label, 7, b[0] + 5);
      };
      // CHR  MIN:SEC
      band(BANDS.chr, 'CHR');
      seg(ctx, tx.chr || '  :  ', 60, BANDS.chr[0] + 22, 50, !tx.chr);
      // UTC  HH:MM SS
      band(BANDS.utc, 'UTC');
      seg(ctx, tx.utc, 22, BANDS.utc[0] + 24, 46, false);
      seg(ctx, tx.utcSec, 196, BANDS.utc[0] + 40, 30, false);
      // ET  HH:MM
      band(BANDS.et, 'ET');
      seg(ctx, tx.et || '  :  ', 60, BANDS.et[0] + 22, 50, !tx.et);
    },
  });
  return logic;
}

function seg(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, h: number, blank: boolean) {
  // blank windows still show the (very faint) LCD segment pattern
  if (blank) s = s.replace(/[^:]/g, ' ');
  drawSevenSeg(ctx, s, x, y, h, blank ? GHOST : DIGIT, { ghost: GHOST, skew: 0.06 });
}

/** Build the clock unit (≈ 3 ATI, 90 × 95 mm) in its own local frame (face at z = 0). */
export function buildClock(app: App): THREE.Group {
  const M = app.kit.mats;
  const p = app.kit.panel({ name: 'MAIN_CLOCK', width: 0.09, height: 0.095, zone: 'main', material: instrumentFace(), screws: false, thickness: 0.008, radius: 0.004, pxPerM: 9000 });
  for (const [sx, sy] of [[-0.0405, 0.043], [0.0405, 0.043], [-0.0405, -0.043], [0.0405, -0.043]] as const) addScrew(p, M, sx, sy, 0);
  p.pb('CLOCK_CHR', -0.029, 0.036, { w: 0.0105, h: 0.0075, capText: 'CHR' });
  p.pb('CLOCK_RST', 0.029, 0.036, { w: 0.0105, h: 0.0075, capText: 'RST' });
  p.pb('CLOCK_DATE', -0.035, -0.0005, { w: 0.0095, h: 0.0075, capText: 'DATE' });
  p.rot('CLOCK_ET', -0.026, -0.0385, { style: 'pointer', size: 0.0045, angles: [-70, 0, 70], posLabels: false });
  p.label('RUN', -0.0345, -0.0345, { size: 0.0016 });
  p.label('STP', -0.026, -0.0295, { size: 0.0016 });
  p.label('RST', -0.0175, -0.0345, { size: 0.0016 });
  p.label('ET', -0.026, -0.0458, { size: 0.0015 });
  p.rot('CLOCK_SRC', 0.026, -0.0385, { style: 'pointer', size: 0.0045, angles: [-70, 0, 70], posLabels: false });
  p.label('GPS', 0.0175, -0.0345, { size: 0.0016 });
  p.label('INT', 0.026, -0.0295, { size: 0.0016 });
  p.label('SET', 0.0345, -0.0345, { size: 0.0016 });
  // LCD windows (one mesh, UV sub-rects of the CLOCK canvas)
  const wins: Array<{ x: number; y: number; w: number; h: number; band: readonly [number, number] }> = [
    { x: 0, y: 0.0195, w: 0.044, h: 0.0138, band: BANDS.chr },
    { x: 0.004, y: -0.0005, w: 0.051, h: 0.0159, band: BANDS.utc },
    { x: 0, y: -0.0205, w: 0.044, h: 0.0138, band: BANDS.et },
  ];
  const planes: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  for (const w of wins) {
    const g = new THREE.PlaneGeometry(w.w, w.h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const v0 = 1 - w.band[1] / 256, v1 = 1 - w.band[0] / 256;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
    g.translate(w.x, w.y, 0.0004);
    planes.push(g);
    const gl = new THREE.PlaneGeometry(w.w + 0.002, w.h + 0.002);
    gl.translate(w.x, w.y, 0.0016);
    glass.push(gl);
    // window frame (thin raised black lip)
    p.addStatic(geo.rectRing(w.w + 0.003, w.h + 0.003, w.w + 0.0004, w.h + 0.0004, 0.0012, 0.0008), M.black, w.x, w.y, 0);
  }
  const disp = new THREE.Mesh(geo.mergeGeometries(planes)!, createDisplayMaterial('CLOCK'));
  disp.name = 'display:CLOCK';
  p.add(disp, 0, 0, 0);
  const gm = new THREE.Mesh(geo.mergeGeometries(glass)!, M.screenGlass);
  gm.renderOrder = 2;
  p.add(gm, 0, 0, 0);
  app.interaction.addBlocker(disp);
  return p.finish();
}
