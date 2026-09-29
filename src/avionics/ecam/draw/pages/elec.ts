/**
 * SD ELEC page (600 design space): batteries, DC BAT / DC 1 / DC 2 / DC ESS buses, TR 1 / TR 2 /
 * ESS TR, EMER GEN, AC 1 / AC 2 / AC ESS buses, GEN 1 / GEN 2, APU GEN, EXT PWR / STAT INV, IDGs,
 * GALLEY SHED. Contactor states are derived from the bus / source states published by sys-elec.
 */
import type { Sim } from '../../../../core/sim';
import type { EcamCore } from '../../logic/ecam';
import { C, pageTitle, poly, rect, tx } from '../common';

const K = 1024 / 600;
const AS = 13.737375; // arrow size

export function drawElecPage(ctx: CanvasRenderingContext2D, sim: Sim, core: EcamCore): void {
  ctx.scale(K, K);
  const a = core.fwc.a;
  const b = (n: string) => sim.getB(n);
  const g = (n: string) => sim.get(n);
  pageTitle(ctx, 'ELEC', 6, 24, 24);

  // ---- network state
  const ac1 = a.ac1;
  const ac2 = a.ac2;
  const acEss = a.acEss;
  const dc1 = a.dc1;
  const dc2 = a.dc2;
  const dcEss = a.dcEss;
  const dcBat = a.dcBat;
  const gen1 = b('S:ELEC_GEN1_ON');
  const gen2 = b('S:ELEC_GEN2_ON');
  const apuGen = b('S:ELEC_APU_GEN_ON');
  const ext = b('S:ELEC_EXT_PWR_ON');
  const statInv = b('S:ELEC_STAT_INV');
  const emerGen = b('S:ELEC_EMER_GEN_ON') || g('S:ELEC_EMER_GEN_V') > 100;
  const btc1 = ac1 && !gen1 && (ext || apuGen || gen2);
  const btc2 = ac2 && !gen2 && (ext || apuGen || gen1);
  const essFeedNorm = b('C:ELEC_AC_ESS_FEED');
  const ac1ToEss = acEss && ac1 && essFeedNorm && !emerGen && !statInv;
  const ac2ToEss = acEss && ac2 && !essFeedNorm && !emerGen && !statInv;
  const tr1 = dc1 && ac1;
  const tr2 = dc2 && ac2;
  const dc1Bat = dc1 && dcBat;
  const dc2Bat = !dc1 && dc2 && dcBat;
  const essTr = dcEss && (emerGen || (acEss && !(dc1 || dc2)));
  const batEss = dcEss && dcBat && !essTr;

  // ---- wires
  const W = (pts: number[], amber = false) => poly(ctx, pts, amber ? C.A : C.G, 2.25);
  batWire(ctx, sim, 196.611875, 50.77125, 1);
  batWire(ctx, sim, 367.724375, 50.77125, 2);
  if (tr1) W([56.25, 117, 56.25, 161.1]);
  W([56.25, 238.35, 56.25, 267.35], !ac1);
  if (tr2) W([536.25, 117, 536.25, 161.1]);
  W([536.25, 238.35, 536.25, 267.35], !ac2);
  if (ac1ToEss) W([138.57, 279.32, 233.2, 279.32]);
  if (ac2ToEss) W([367.5, 279.32, 462.13, 279.32]);
  if (dc1Bat && !batEss) W([90.15, 103.125, 258.84, 103.125, 258.84, 62.125]);
  if (dc1Bat && batEss) { W([90.15, 103.125, 258.84, 103.125, 258.84, 59.125]); W([258.84, 103.125, 258.84, 117.125]); }
  if (!dc1Bat && batEss) W([258.84, 59.125, 258.84, 117.125]);
  if (dc2Bat) W([341.16, 103.125, 507.82, 103.125]), W([341.16, 103.125, 341.16, 60.6]);
  if (essTr && !emerGen) W([258.84, 237.65, 258.84, 266.17]);
  if (essTr) W([258.84, 143.63, 258.84, 150.74]);
  arrow(ctx, 258.84 - AS / 2, 157.58, 'up', essTr ? C.G : C.W);
  if (emerGen) W([319.02, 207.9, 298.98, 207.9]);
  arrow(ctx, 326.25, 214.77, 'left', emerGen ? C.G : C.W);
  if (emerGen && acEss) {
    W([343.55, 237.62, 343.55, 251.87]);
    arrow(ctx, 350.42, 252.87, 'down', C.G);
  }
  // AC sources to buses
  if (ext && btc1 && !btc2) W([56.44, 302.81, 56.44, 321.56, 361.54, 321.56, 361.54, 379.5]);
  if (ext && !btc1 && btc2) W([536.25, 302.81, 536.25, 321.56, 361.57, 321.56, 361.57, 379.5]);
  if (ext && btc1 && btc2) W([536.25, 302.81, 536.25, 321.56, 56.44, 321.56, 56.44, 302.81]), W([361.57, 321.56, 361.57, 379.5]);
  if (apuGen && btc1 && !btc2) W([56.44, 302.81, 56.44, 321.56, 216.04, 321.56, 216.04, 357.23]);
  if (apuGen && !btc1 && btc2) W([536.25, 302.81, 536.25, 321.56, 216.05, 321.56, 216.05, 357.23]);
  if (apuGen && btc1 && btc2) W([536.25, 302.81, 536.25, 321.56, 56.44, 321.56, 56.44, 302.81]), W([216.05, 321.56, 216.05, 357.23]);
  if (gen1 && !btc1) W([56.44, 302.81, 56.44, 345.31]);
  if (gen1 && btc2) W([56.44, 302.81, 56.44, 345.31]), W([56.44, 321.56, 536.25, 321.56, 536.25, 300.81]);
  if (gen2 && !btc2) W([536.25, 302.81, 536.25, 345.31]);
  if (gen2 && btc1) W([536.25, 302.81, 536.25, 345.31]), W([536.25, 321.56, 56.44, 321.56, 56.44, 300.81]);
  if (gen1 || btc1) arrow(ctx, 56.25 - AS / 2, 303.77, 'up', C.G);
  if (gen2 || btc2) arrow(ctx, 536.25 - AS / 2, 303.77, 'up', C.G);
  if (ext && (btc1 || btc2)) arrow(ctx, 354.77, 385.88, 'up', C.G);
  if (apuGen && (btc1 || btc2)) arrow(ctx, 209.09, 363.75, 'up', C.G);

  // ---- boxes
  battery(ctx, sim, 108.75, 10, 1, statInv);
  battery(ctx, sim, 405, 10, 2, false);
  const batAuto = b('C:ELEC_BAT1') || b('C:ELEC_BAT2');
  bus(ctx, 232.5, 35, 135, batAuto ? 'DC BAT' : 'XX', undefined, dcBat && batAuto);
  bus(ctx, 6, 90, 86.25, 'DC', 1, dc1);
  bus(ctx, 507.75, 90, 86.25, 'DC', 2, dc2);
  bus(ctx, 232.5, 116.25, 135, 'DC ESS', undefined, dcEss, !a.dcEssShed);
  bus(ctx, 6, 266.25, 135, 'AC', 1, ac1);
  bus(ctx, 459, 266.25, 135, 'AC', 2, ac2);
  bus(ctx, 232.5, 266.25, 135, 'AC ESS', undefined, acEss, !a.acEssShed);

  engGen(ctx, sim, 13.125, 345, 1);
  engGen(ctx, sim, 493.125, 345, 2);
  apuGenBox(ctx, sim, 168.75, 367.5, a.apuMaster);
  if (statInv) vfBox(ctx, 315, 390, 'STAT INV', g('S:ELEC_STAT_INV_V'), g('S:ELEC_STAT_INV_HZ'));
  else if (b('G:GND_EXT_PWR')) vfBox(ctx, 315, 390, 'EXT PWR', g('S:ELEC_EXT_V') || 115, g('S:ELEC_EXT_HZ') || 400);
  trBox(ctx, 13.125, 161.25, 'TR', 1, g('S:ELEC_TR1_V'), g('S:ELEC_TR1_A'), false);
  trBox(ctx, 493.125, 161.25, 'TR', 2, g('S:ELEC_TR2_V'), g('S:ELEC_TR2_A'), false);
  trBox(ctx, 213.75, 161.25, 'ESS TR', 0, g('S:ELEC_ESS_TR_V'), g('S:ELEC_ESS_TR_A'), !essTr);
  if (emerGen) {
    rect(ctx, 330, 161.25, 103.125, 75, C.grey, 2.5);
    const v = g('S:ELEC_EMER_GEN_V');
    const hz = g('S:ELEC_EMER_GEN_HZ');
    const ok = v >= 110 && v <= 120 && hz >= 390 && hz <= 410;
    tx(ctx, 'EMER GEN', 381.6, 185.6, ok ? C.W : C.A, 19, 'center');
    prop(ctx, 393.75, 208.1, v, 'V', v >= 110 && v <= 120);
    prop(ctx, 393.75, 230.6, hz, 'HZ', hz >= 390 && hz <= 410);
  } else tx(ctx, 'EMER GEN', 331, 206.25, C.W, 18, 'left', 'middle');

  if (b('S:ELEC_GALLEY_SHED')) {
    tx(ctx, 'GALLEY', 300, 483.75, C.W, 19, 'center');
    tx(ctx, 'SHED', 300, 502.5, C.W, 19, 'center');
  }
  // IDGs
  for (const n of [1, 2] as const) {
    const disc = b(`S:ELEC_IDG${n}_DISC`);
    const x = n === 1 ? 28.13 : 513.75;
    tx(ctx, 'IDG', x, 476.25, disc ? C.A : C.W, 19);
    tx(ctx, String(n), x + 39.38, 476.25, disc ? C.A : C.W, 22);
    const tv = sim.has(`S:ELEC_IDG${n}_TEMP`) ? g(`S:ELEC_IDG${n}_TEMP`) : a.eng[n - 1].running ? 65 : g('G:ENV_OAT');
    const tx0 = n === 1 ? 135 : 480;
    tx(ctx, String(Math.round(tv)), tx0, 476.25, C.G, 19, 'right');
    tx(ctx, '°C', tx0 + 3.75, 476.25, C.C, 19);
    if (disc) tx(ctx, 'DISC', n === 1 ? 29.13 : 518.75, 495, C.A, 19);
  }
}

function prop(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, unit: string, ok: boolean): void {
  tx(ctx, String(Math.round(v)), x, y, ok ? C.G : C.A, 19, 'right');
  tx(ctx, unit, x + 3.75, y, C.C, 19);
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right', col: string): void {
  const p: number[] = [];
  switch (dir) {
    case 'up': p.push(x, y, x + AS, y, x + AS - 6.8685, y - 8.99325); break;
    case 'down': p.push(x, y, x - AS, y, x - AS + 6.8685, y + 8.99325); break;
    case 'right': p.push(x, y, x, y + AS, x + 8.99325, y + AS - 6.8685); break;
    case 'left': p.push(x, y, x, y - AS, x - 8.99325, y - AS + 6.8685); break;
  }
  poly(ctx, p, col, 2.25, true);
}

function bus(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, name: string, n: number | undefined, ok: boolean, shed = false): void {
  rect(ctx, x, y, w, 26.25, C.grey, 0, C.grey);
  const col = ok ? C.G : C.A;
  if (n !== undefined) {
    tx(ctx, name, x + w / 2, y + 21, col, 24, 'right');
    tx(ctx, String(n), x + w / 2 + 3.75, y + 22, col, 26);
  } else tx(ctx, name, x + w / 2, y + 21, col, 24, 'center');
  if (shed) tx(ctx, 'SHED', x + w / 2, y + 26.25 + 8.25, C.A, 15, 'center', 'middle');
}

function battery(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, n: 1 | 2, statInv: boolean): void {
  const auto = sim.getB(`C:ELEC_BAT${n}`);
  const v = sim.get(`S:ELEC_BAT${n}_V`);
  const aAmp = sim.get(`S:ELEC_BAT${n}_A`);
  const vOk = v >= 25 && v <= 31;
  const aOk = aAmp > -5;
  const amber = auto && !(vOk && aOk);
  rect(ctx, x, y, 86.25, 71.25, C.grey, 2.5);
  tx(ctx, 'BAT', x + 52.5, y + 21.625, amber ? C.A : C.W, 19, 'right');
  tx(ctx, String(n), x + 56.25, y + 21.625, amber ? C.A : C.W, 22);
  if (auto) {
    tx(ctx, v.toFixed(0), x + 52.5, y + 43.125, vOk ? C.G : C.A, 19, 'right');
    tx(ctx, 'V', x + 56.25, y + 43.125, C.C, 19);
    tx(ctx, String(Math.round(Math.abs(aAmp))), x + 52.5, y + 65.625, aOk ? C.G : C.A, 19, 'right');
    tx(ctx, 'A', x + 56.25, y + 65.625, C.C, 19);
  } else tx(ctx, 'OFF', x + 43.125, y + 41.25, C.W, 19, 'center', 'middle');
  if (n === 1 && statInv) {
    arrow(ctx, x + 92.57625, y + 1.875, 'right', C.G);
    tx(ctx, 'STAT INV', x + 108.75, y + 15, C.W, 18);
  }
}

function batWire(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, n: 1 | 2): void {
  const auto = sim.getB(`C:ELEC_BAT${n}`);
  if (!auto || !sim.getB('S:ELEC_DC_BAT_BUS')) return;
  const cur = sim.get(`S:ELEC_BAT${n}_A`);
  const charging = cur > 1;
  const discharging = cur < -1;
  ctx.save();
  ctx.translate(x, y);
  if (charging || discharging) {
    const col = discharging ? C.A : C.G;
    const right = (n === 2 && charging) || (n === 1 && discharging);
    if (right) { poly(ctx, [0.3, 0, 24.83, 0], col, 2.25); arrow(ctx, 25.525625, -AS / 2, 'right', col); }
    else { poly(ctx, [11.5, 0, 36.02, 0], col, 2.25); arrow(ctx, 10, AS / 2, 'left', col); }
  } else poly(ctx, [0.3, 0, 36.45, 0], C.G, 2.25);
  ctx.restore();
}

function engGen(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, n: 1 | 2): void {
  const on = sim.getB(`C:ELEC_GEN${n}`);
  const load = sim.get(`S:ELEC_GEN${n}_LOAD`);
  const v = sim.get(`S:ELEC_GEN${n}_V`);
  const hz = sim.get(`S:ELEC_GEN${n}_HZ`);
  const loadOk = load <= 100;
  const vOk = v >= 110 && v <= 120;
  const hzOk = hz >= 390 && hz <= 410;
  const amber = !on || !(loadOk && vOk && hzOk);
  rect(ctx, x, y, 86.25, 93.75, C.grey, 2.5);
  tx(ctx, 'GEN', x + 54.375, y + 22.5, amber ? C.A : C.W, 19, 'right');
  tx(ctx, String(n), x + 58.125, y + 22.5, amber ? C.A : C.W, 22);
  if (on) {
    prop(ctx, x + 54.375, y + 45, load, '%', loadOk);
    prop(ctx, x + 54.375, y + 67.5, v, 'V', vOk);
    prop(ctx, x + 54.375, y + 90, hz, 'HZ', hzOk);
  } else tx(ctx, 'OFF', x + 43.125, y + 54.375, C.W, 19, 'center', 'middle');
}

function apuGenBox(ctx: CanvasRenderingContext2D, sim: Sim, x: number, y: number, master: boolean): void {
  const on = sim.getB('C:ELEC_APU_GEN');
  const load = sim.get('S:ELEC_APU_GEN_LOAD');
  const v = sim.get('S:ELEC_APU_GEN_V');
  const hz = sim.get('S:ELEC_APU_GEN_HZ');
  const loadOk = load <= 100;
  const vOk = v >= 110 && v <= 120;
  const hzOk = hz >= 390 && hz <= 410;
  const titleCol = !master || (on && loadOk && vOk && hzOk) ? C.W : C.A;
  if (!master) { tx(ctx, 'APU GEN', x + 46.875, y + 18.75, C.W, 19, 'center'); return; }
  rect(ctx, x, y, 93.75, 90, C.grey, 2.5);
  tx(ctx, 'APU GEN', x + 46.875, y + 18.75, titleCol, 19, 'center');
  if (on) {
    prop(ctx, x + 58.125, y + 41.25, load, '%', loadOk);
    prop(ctx, x + 58.125, y + 63.75, v, 'V', vOk);
    prop(ctx, x + 58.125, y + 86.25, hz, 'HZ', hzOk);
  } else tx(ctx, 'OFF', x + 46.875, y + 48.75, C.W, 19, 'center', 'middle');
}

function vfBox(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, v: number, hz: number): void {
  const vOk = v >= 110 && v <= 120;
  const hzOk = hz >= 390 && hz <= 410;
  rect(ctx, x, y, 93.75, 67.5, C.grey, 2.5);
  tx(ctx, title, x + 46.875, y + 18.75, vOk && hzOk ? C.W : C.A, title.length > 7 ? 16.875 : 19, 'center');
  prop(ctx, x + 52.5, y + 41.25, v, 'V', vOk);
  prop(ctx, x + 52.5, y + 63.75, hz, 'HZ', hzOk);
}

function trBox(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, n: number, v: number, amp: number, titleOnly: boolean): void {
  const vOk = v >= 25 && v <= 31;
  const aOk = n === 0 ? true : amp > 5;
  const amber = !titleOnly && !(vOk && aOk);
  const tX = n === 0 ? 80 : 50;
  if (titleOnly) { tx(ctx, title, x + tX, y + 24.375, C.W, 19, 'right'); return; }
  rect(ctx, x, y, 86.25, 75, C.grey, 2.5);
  tx(ctx, title, x + tX, y + 24.375, amber ? C.A : C.W, 19, 'right');
  if (n !== 0) tx(ctx, String(n), x + 53.75, y + 24.375, amber ? C.A : C.W, 22);
  prop(ctx, x + 54.375, y + 46.875, v, 'V', vOk);
  prop(ctx, x + 54.375, y + 69.375, amp, 'A', aOk);
}
