/**
 * Navigation Display (A320 LCD DU, 1024 x 1024), drawn in a 768-unit square.
 * Modes: ROSE ILS / ROSE VOR / ROSE NAV, ARC, PLAN (FCOM DSC-31-45). Flight plan from
 * sim.services.fmgs (active green, TO waypoint white, TMPY yellow dashed, missed approach cyan).
 */
import type { Sim } from '../../../core/sim';
import { bearingDeg, distanceNm, isLeg, type FlightPlanLeg, type NavPoint } from '../../../core/fmgs-api';
import { angDiff, sideData, type Side, type SideData } from '../logic/sources';
import { ND_MODE } from '../logic/fcu';
import { C, type Ctx, line, pad, poly, txt, outlined } from './common';

export const ND_UNITS = 768;
const FS = { smallest: 22.5, small: 25, inter: 27.5, medium: 30, large: 32.5 };

const ARC_CLIP = 'M0,312 A492,492 0 0 1 768,312 L768,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L0,625 Z';
const ROSE_CLIP = 'M45,155 L282,155 A250,250 0 0 1 486,155 L723,155 L723,562 L648,562 L591,625 L591,768 L174,768 L174,683 L122,625 L45,625 Z';

/** FM messages shown on the ND (bottom centre). */
const ND_MESSAGES = ['GPS PRIMARY', 'GPS PRIMARY LOST', 'NAV ACCUR UPGRAD', 'NAV ACCUR DOWNGRAD', 'SPECIFIED VOR/D UNAVAIL', 'SET OFFSIDE RNG/MODE'];

interface Proj {
  cx: number;
  cy: number;
  ppn: number;
  /** Map up direction (true deg). */
  up: number;
  refLat: number;
  refLon: number;
}

function project(pr: Proj, lat: number, lon: number): [number, number] {
  const dist = distanceNm(pr.refLat, pr.refLon, lat, lon);
  const brg = bearingDeg(pr.refLat, pr.refLon, lat, lon);
  const a = ((brg - pr.up) * Math.PI) / 180;
  return [pr.cx + Math.sin(a) * dist * pr.ppn, pr.cy - Math.cos(a) * dist * pr.ppn];
}

interface NdCtx {
  sim: Sim;
  side: Side;
  d: SideData;
  mode: number;
  range: number;
  t: number;
}

export function drawNd(ctx: Ctx, sim: Sim, side: Side, t: number, sizePx: number): void {
  const k = sizePx / ND_UNITS;
  ctx.save();
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n: NdCtx = { sim, side, d: sideData(sim, side), mode: sim.get(`S:EFIS${side}_ND_MODE`), range: sim.get(`S:EFIS${side}_ND_RANGE`) || 10, t };
  const msg = sim.get(`S:EFIS${side}_ND_MSG`);
  const arc = n.mode === ND_MODE.ARC;
  const plan = n.mode === ND_MODE.PLAN;
  const cx = 384;
  const cy = arc ? 620 : 384;
  const hdgOk = n.d.hdgValid;
  const posOk = n.d.navValid;

  if (msg) {
    txt(ctx, msg === 1 ? 'MODE CHANGE' : 'RANGE CHANGE', 384, 320, C.green, FS.large, 'center');
  } else {
    if (plan) drawPlan(ctx, n);
    else {
      if (hdgOk) {
        const navMap = arc || n.mode === ND_MODE.ROSE_NAV;
        if (navMap && posOk) {
          const pr: Proj = { cx, cy, ppn: (arc ? 492 : 500) / n.range, up: n.d.hdgTrue, refLat: n.d.lat, refLon: n.d.lon };
          ctx.save();
          ctx.clip(new Path2D(arc ? ARC_CLIP : ROSE_CLIP));
          drawMap(ctx, n, pr);
          ctx.restore();
        }
        if (arc) arcRings(ctx, n); else roseRings(ctx, n);
        needles(ctx, n, cx, cy, arc ? 492 : 250);
        if (n.mode === ND_MODE.ROSE_ILS || n.mode === ND_MODE.ROSE_VOR) courseDeviation(ctx, n);
      }
      compass(ctx, n, cx, cy, arc ? 492 : 250, arc);
      aircraft(ctx, cx, cy, 0);
      if (!hdgOk) txt(ctx, 'HDG', 384, arc ? 241 : 241, C.red, FS.large, 'center');
      if ((arc || n.mode === ND_MODE.ROSE_NAV) && (!posOk || !hdgOk)) txt(ctx, 'MAP NOT AVAIL', 384, arc ? 320.6 : 340, C.red, FS.large, 'center');
    }
  }
  topLeft(ctx, n);
  if (n.mode === ND_MODE.ARC || n.mode === ND_MODE.ROSE_NAV || plan) toWaypoint(ctx, n);
  if (n.mode === ND_MODE.ROSE_ILS) ilsInfo(ctx, n);
  if (n.mode === ND_MODE.ROSE_VOR) vorInfo(ctx, n);
  if (!plan) bottomInfo(ctx, n);
  chrono(ctx, n);
  messages(ctx, n);
  terrain(ctx, n);
  ctx.restore();
}

/* ------------------------------------------------------------------ compass */

function compass(ctx: Ctx, n: NdCtx, cx: number, cy: number, r: number, arc: boolean): void {
  const ok = n.d.hdgValid;
  ctx.strokeStyle = ok ? C.white : C.red;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (!ok) return;
  const hdg = n.d.hdgMag;
  const big = arc ? 29 : 14;
  const small = arc ? 15 : 7;
  const fb = arc ? 34 : 30;
  const fsm = arc ? 22 : 20;
  for (let h = 0; h < 360; h += 5) {
    const a = angDiff(h, hdg);
    if (arc && Math.abs(a) > 55) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((a * Math.PI) / 180);
    line(ctx, 0, -r, 0, -r - (h % 10 === 0 ? big : small), C.white, 2);
    if (h % 10 === 0) txt(ctx, String(h / 10), 0, -r - (arc ? 37 : 22), C.white, h % 30 === 0 ? fb : fsm, 'center');
    ctx.restore();
  }
  // Lubber line
  line(ctx, 384, cy - r - (arc ? 20 : 20), 384, cy - r + (arc ? 20 : 18), C.yellow, 5);
  // Selected heading bug
  const sim = n.sim;
  if (sim.getB('S:FCU_POWERED') && !sim.getB('S:FCU_HDG_DASHES')) {
    const sel = sim.get('S:FCU_HDG');
    const a = angDiff(sel, sim.getB('S:FCU_TRK_FPA') ? n.d.trkMag : hdg);
    if (!arc || Math.abs(a) <= 50) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((a * Math.PI) / 180);
      poly(ctx, [-2, -r + 2, -14, -r - 25, 14, -r - 25, 2, -r + 2], C.cyan, 3);
      ctx.restore();
    } else txt(ctx, pad(Math.round(sel) % 360, 3), a < 0 ? 120 : 648, 70, C.cyan, FS.small, 'center');
  }
  // Track diamond
  if (n.d.navValid && n.d.gs > 30) {
    const a = angDiff(n.d.trkMag, hdg);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((a * Math.PI) / 180);
    poly(ctx, [0, -r + 2, -9, -r + 15, 0, -r + 28, 9, -r + 15], C.green, 3, true);
    ctx.restore();
  }
}

function aircraft(ctx: Ctx, x: number, y: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rot * Math.PI) / 180);
  outlined(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(-41, 0); ctx.lineTo(41, 0);
    ctx.moveTo(0, -29.5); ctx.lineTo(0, 40.75);
    ctx.moveTo(-11.75, 31); ctx.lineTo(11.75, 31);
  }, C.yellow, 5, 7.5);
  ctx.restore();
}

function dashedCircle(ctx: Ctx, cx: number, cy: number, r: number, dash: number[]): void {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

const fmtRange = (v: number) => (v < 1 ? v.toFixed(1).replace(/^0/, '') : String(Math.round(v * 10) / 10));

function arcRings(ctx: Ctx, n: NdCtx): void {
  ctx.save();
  ctx.clip(new Path2D(ARC_CLIP));
  dashedCircle(ctx, 384, 620, 369, [15, 10.5]);
  dashedCircle(ctx, 384, 620, 246, [15, 10]);
  ctx.restore();
  for (const a of [-60, -30, 0, 30, 60]) {
    ctx.save();
    ctx.translate(384, 620);
    ctx.rotate((a * Math.PI) / 180);
    line(ctx, 0, -123 - 6, 0, -123 + 6, C.white, 2);
    ctx.restore();
  }
  txt(ctx, fmtRange((n.range * 3) / 4), 58, 482, C.cyan, FS.smallest, 'left');
  txt(ctx, fmtRange((n.range * 3) / 4), 709, 482, C.cyan, FS.smallest, 'right');
  txt(ctx, fmtRange(n.range / 2), 175, 528, C.cyan, FS.smallest, 'left');
  txt(ctx, fmtRange(n.range / 2), 592, 528, C.cyan, FS.smallest, 'right');
}

function roseRings(ctx: Ctx, n: NdCtx): void {
  dashedCircle(ctx, 384, 384, 125, [15, 10]);
  for (let a = 0; a < 360; a += 30) {
    ctx.save();
    ctx.translate(384, 384);
    ctx.rotate((a * Math.PI) / 180);
    line(ctx, 0, -120, 0, -130, C.white, 2);
    ctx.restore();
  }
  for (let a = 45; a < 360; a += 45) {
    ctx.save();
    ctx.translate(384, 384);
    ctx.rotate((a * Math.PI) / 180);
    poly(ctx, [0, -252, -5, -261, 5, -261], C.white, 0, true, C.white);
    ctx.restore();
  }
  txt(ctx, fmtRange(n.range / 2), 212, 556, C.cyan, 22, 'left');
  txt(ctx, fmtRange(n.range / 4), 310, 474, C.cyan, 22, 'left');
}

/* ------------------------------------------------------------------ map */

function fmgs(sim: Sim): any {
  return sim.services.fmgs;
}

function legsOf(items: any[] | undefined): Array<FlightPlanLeg | null> {
  if (!items) return [];
  return items.map((it) => (isLeg(it) ? it : null));
}

function wptSymbol(ctx: Ctx, x: number, y: number, color: string): void {
  poly(ctx, [x, y - 9, x + 9, y, x, y + 9, x - 9, y], color, 2.5, true);
}

function runway(ctx: Ctx, pr: Proj, p: NavPoint, color: string, lengthNm = 1.67): void {
  if (p.heading === undefined) return;
  const [x1, y1] = project(pr, p.lat, p.lon);
  const a = ((p.heading - pr.up) * Math.PI) / 180;
  const len = Math.max(12, lengthNm * pr.ppn);
  const x2 = x1 + Math.sin(a) * len;
  const y2 = y1 - Math.cos(a) * len;
  const w = 4;
  const nx = Math.cos(a) * w;
  const ny = Math.sin(a) * w;
  poly(ctx, [x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny], color, 2, true);
  const ident = p.ident.replace(/^RW/, '');
  txt(ctx, ident, x1 - Math.sin(a) * 18 + 14, y1 + Math.cos(a) * 18 + 8, color, FS.smallest, 'left');
}

function drawPlanLine(ctx: Ctx, pr: Proj, legs: Array<FlightPlanLeg | null>, color: (l: FlightPlanLeg) => string, dash?: number[]): void {
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.lineWidth = 3;
  let prev: FlightPlanLeg | null = null;
  for (const l of legs) {
    if (!l) { prev = null; continue; }
    if (prev) {
      const [x1, y1] = project(pr, prev.point.lat, prev.point.lon);
      const [x2, y2] = project(pr, l.point.lat, l.point.lon);
      ctx.strokeStyle = color(l);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    prev = l;
  }
  ctx.restore();
}

function drawMap(ctx: Ctx, n: NdCtx, pr: Proj): void {
  const sim = n.sim;
  const fm = fmgs(sim);
  if (!fm || !sim.getB('S:FMGS_POWERED')) return;
  const option = sim.get(`S:EFIS${n.side}_OPTION`);
  const radius = n.range * 1.5;
  const safe = <T,>(f: () => T, dflt: T): T => { try { return f() ?? dflt; } catch { return dflt; } };

  // EFIS option symbols (magenta).
  const kinds: Record<number, 'airport' | 'vor' | 'ndb' | 'wpt'> = { 2: 'wpt', 3: 'vor', 4: 'ndb', 5: 'airport' };
  if (kinds[option] && fm.nearby) {
    const pts: NavPoint[] = safe(() => fm.nearby(kinds[option], pr.refLat, pr.refLon, radius), []);
    for (const p of pts.slice(0, 80)) {
      const [x, y] = project(pr, p.lat, p.lon);
      const col = C.magenta;
      if (p.kind === 'ndb') poly(ctx, [x, y - 10, x + 9, y + 7, x - 9, y + 7], col, 2.5, true);
      else if (p.kind === 'airport') {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 4;
          line(ctx, x - Math.cos(a) * 11, y - Math.sin(a) * 11, x + Math.cos(a) * 11, y + Math.sin(a) * 11, col, 2.5);
        }
      } else if (p.kind === 'wpt' || p.kind === 'fix') wptSymbol(ctx, x, y, col);
      else {
        // VOR / VOR-DME
        ctx.strokeStyle = col; ctx.lineWidth = 2.5;
        line(ctx, x - 9, y, x + 9, y, col, 2.5);
        line(ctx, x, y - 9, x, y + 9, col, 2.5);
        if (p.kind === 'vordme') { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
      }
      txt(ctx, p.ident, x + 13, y + 20, col, FS.smallest, 'left');
    }
  }

  // Runways
  const dep: NavPoint | undefined = safe(() => fm.departureRunway(), undefined);
  if (dep) runway(ctx, pr, dep, C.white);
  const arr: NavPoint | undefined = safe(() => fm.arrivalRunway(), undefined);
  if (arr) runway(ctx, pr, arr, C.white);

  const plan = legsOf(safe(() => fm.activePlan(), []));
  const toIdx = safe(() => fm.toIndex(), 1);
  const tmpy = sim.getB('S:FMGS_TMPY') ? legsOf(safe(() => fm.temporaryPlan?.(), [])) : [];
  if (tmpy.length) drawPlanLine(ctx, pr, tmpy, () => C.yellow, [15, 12]);
  drawPlanLine(ctx, pr, plan, (l) => (l.isMissedApproach ? C.cyan : C.green));
  const alt = legsOf(safe(() => fm.alternatePlan?.(), []));
  if (alt.length) drawPlanLine(ctx, pr, alt, () => C.cyan, [12, 12]);

  plan.forEach((l, i) => {
    if (!l || l.point.kind === 'runway' || l.point.kind === 'airport') return;
    const [x, y] = project(pr, l.point.lat, l.point.lon);
    if (x < -50 || x > 820 || y < -50 || y > 820) return;
    const col = i === toIdx ? C.white : l.isMissedApproach ? C.cyan : C.green;
    wptSymbol(ctx, x, y, col);
    txt(ctx, l.point.ident, x + 14, y + 22, col, FS.smallest, 'left');
    if (option === 1 && l.altConstraint) {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
      const c = l.altConstraint;
      const s = `${c.type === 'above' ? '+' : c.type === 'below' ? '-' : ''}${c.alt}`;
      txt(ctx, s, x + 14, y + 44, C.magenta, FS.smallest, 'left');
    }
  });
  tmpy.forEach((l) => {
    if (!l || l.point.kind === 'runway' || l.point.kind === 'airport') return;
    const [x, y] = project(pr, l.point.lat, l.point.lon);
    wptSymbol(ctx, x, y, C.yellow);
    txt(ctx, l.point.ident, x + 14, y + 22, C.yellow, FS.smallest, 'left');
  });

  // Pseudo waypoints
  const pw: Array<{ ident: string; lat: number; lon: number }> = safe(() => fm.pseudoWaypoints?.(), []);
  for (const p of pw) {
    const [x, y] = project(pr, p.lat, p.lon);
    if (p.ident.includes('T/C')) {
      poly(ctx, [x - 18, y + 6, x, y + 6, x + 14, y - 8], C.white, 2.5);
      poly(ctx, [x + 14, y - 8, x + 6, y - 6, x + 12, y], C.white, 2.5);
    } else if (p.ident.includes('T/D')) {
      poly(ctx, [x - 18, y - 8, x - 4, y + 6, x + 14, y + 6], C.white, 2.5);
      poly(ctx, [x + 14, y + 6, x + 6, y + 1, x + 6, y + 11], C.white, 2.5);
    } else if (p.ident.includes('DECEL')) {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
      txt(ctx, 'D', x, y + 8, C.magenta, 22, 'center');
    } else {
      ctx.strokeStyle = C.magenta; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ PLAN */

function drawPlan(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  const fm = fmgs(sim);
  let centre: { lat: number; lon: number } | undefined;
  try {
    const plan = fm?.activePlan?.() ?? [];
    const it = plan[fm.toIndex()];
    if (it && isLeg(it)) centre = it.point;
    else centre = fm?.origin?.();
  } catch { centre = undefined; }
  if (!centre && n.d.navValid) centre = { lat: n.d.lat, lon: n.d.lon };
  ctx.strokeStyle = C.white;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(384, 384, 250, 0, Math.PI * 2); ctx.stroke();
  dashedCircle(ctx, 384, 384, 125, [14, 13]);
  txt(ctx, fmtRange(n.range / 4), 310, 474, C.cyan, 22, 'left');
  txt(ctx, fmtRange(n.range / 2), 212, 556, C.cyan, 22, 'left');
  const card: Array<[string, number, number, number[]]> = [
    ['N', 384, 170, [384, 141.5, 390, 151, 378, 151]],
    ['E', 598, 384, [626.2, 384, 617, 390, 617, 378]],
    ['S', 384, 598, [384, 626.5, 390, 617, 378, 617]],
    ['W', 170, 384, [141.5, 384, 151, 390, 151, 378]],
  ];
  for (const [s, x, y, tri] of card) {
    txt(ctx, s, x, y, C.white, 25, 'center', 'middle');
    poly(ctx, tri, C.white, 0, true, C.white);
  }
  if (!centre) {
    txt(ctx, 'MAP NOT AVAIL', 384, 320, C.red, FS.large, 'center');
    return;
  }
  const pr: Proj = { cx: 384, cy: 384, ppn: 500 / n.range, up: 0, refLat: centre.lat, refLon: centre.lon };
  ctx.save();
  ctx.clip(new Path2D(ROSE_CLIP));
  drawMap(ctx, n, pr);
  if (n.d.navValid) {
    const [x, y] = project(pr, n.d.lat, n.d.lon);
    aircraft(ctx, x, y, n.d.hdgTrue);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ texts */

function topLeft(ctx: Ctx, n: NdCtx): void {
  const { d } = n;
  txt(ctx, 'GS', 2, 25, C.white, FS.smallest);
  if (d.navValid) txt(ctx, String(Math.round(d.gs)), 91, 25, C.green, FS.inter, 'right');
  txt(ctx, 'TAS', 97, 25, C.white, FS.smallest);
  if (d.adrValid) txt(ctx, d.tas >= 60 ? String(Math.round(d.tas)) : '---', 203, 25, C.green, FS.inter, 'right');
  if (d.navValid && d.adrValid) {
    if (d.windValid) {
      txt(ctx, pad(Math.round(d.windDir) % 360, 3), 48, 56, C.green, FS.small, 'right');
      txt(ctx, '/', 54, 55, C.white, FS.smallest);
      txt(ctx, String(Math.round(d.windSpd)), 73, 56, C.green, FS.small);
      if (d.windSpd >= 2) {
        ctx.save();
        ctx.translate(25, 80);
        ctx.rotate(((d.windDir + 180 - d.hdgTrue) * Math.PI) / 180);
        line(ctx, 0, -15, 0, 15, C.green, 2.5);
        poly(ctx, [-6, 5, 0, 15, 6, 5], C.green, 2.5);
        ctx.restore();
      }
    } else txt(ctx, '---/---', 2, 56, C.green, FS.small);
  }
}

function toWaypoint(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  const fm = fmgs(sim);
  if (!fm || !sim.getB('S:FMGS_POWERED') || !n.d.navValid) return;
  let leg: FlightPlanLeg | undefined;
  try {
    const it = fm.activePlan()[fm.toIndex()];
    if (it && isLeg(it)) leg = it;
  } catch { leg = undefined; }
  if (!leg) return;
  const dist = distanceNm(n.d.lat, n.d.lon, leg.point.lat, leg.point.lon);
  const brgTrue = bearingDeg(n.d.lat, n.d.lon, leg.point.lat, leg.point.lon);
  const brg = Math.round(((brgTrue - (n.d.hdgTrue - n.d.hdgMag)) % 360 + 360) % 360) % 360;
  txt(ctx, leg.point.ident, 677, 25, C.white, FS.inter, 'right');
  txt(ctx, pad(brg, 3), 740, 25, C.green, FS.inter, 'right');
  txt(ctx, '°', 742, 25, C.cyan, FS.inter);
  txt(ctx, dist < 20 ? dist.toFixed(1) : String(Math.round(dist)), 720, 57, C.green, FS.inter, 'right');
  txt(ctx, 'NM', 724, 57, C.cyan, FS.smallest);
  if (n.d.gs > 30) {
    const utc = n.sim.get('G:TIME_UTC') + (dist / n.d.gs) * 3600;
    const hh = Math.floor(utc / 3600) % 24;
    const mm = Math.floor((utc % 3600) / 60);
    txt(ctx, `${pad(hh, 2)}:${pad(mm, 2)}`, 762, 89, C.green, FS.inter, 'right');
  }
}

function navaidOf(sim: Sim, key: 'vor1' | 'vor2' | 'adf1' | 'adf2' | 'ils'): NavPoint | undefined {
  try { return sim.services.fmgs?.tunedNavaids?.()?.[key]; } catch { return undefined; }
}

function bottomInfo(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  for (const k of [1, 2] as const) {
    const sel = sim.get(`S:EFIS${n.side}_NAV${k}`);
    if (!sel) continue;
    const x = k === 1 ? 37 : 668;
    const adf = sel === 2;
    const col = adf ? C.green : C.white;
    const label = `${adf ? 'ADF' : 'VOR'}${k}`;
    const align: CanvasTextAlign = k === 1 ? 'left' : 'left';
    txt(ctx, label, x, 692, col, 24, align);
    // Needle symbol
    const sx = k === 1 ? 20 : 650;
    if (k === 1) line(ctx, sx, 700, sx, 666, col, 2);
    else { line(ctx, sx - 4, 700, sx - 4, 666, col, 2); line(ctx, sx + 4, 700, sx + 4, 666, col, 2); }
    const nav = navaidOf(sim, adf ? (k === 1 ? 'adf1' : 'adf2') : k === 1 ? 'vor1' : 'vor2');
    const freqVar = adf ? `S:NAV_ADF${k}_FREQ` : `S:NAV_VOR${k}_FREQ`;
    const freq = sim.get(freqVar);
    if (nav) txt(ctx, nav.ident, x, 722, col, 24, align);
    else if (freq > 0) txt(ctx, adf ? String(Math.round(freq)) : freq.toFixed(2), x, 722, col, 24, align);
    if (!adf && nav && n.d.navValid && (nav.kind === 'vordme' || nav.kind === 'dme')) {
      const dme = distanceNm(n.d.lat, n.d.lon, nav.lat, nav.lon);
      txt(ctx, dme < 20 ? dme.toFixed(1) : String(Math.round(dme)), x + 62, 759, C.green, 24, 'right');
      txt(ctx, 'NM', x + 66, 759, C.cyan, 20);
    } else if (!adf && nav) {
      txt(ctx, '---', x + 62, 759, C.green, 24, 'right');
      txt(ctx, 'NM', x + 66, 759, C.cyan, 20);
    }
  }
}

function needles(ctx: Ctx, n: NdCtx, cx: number, cy: number, r: number): void {
  const sim = n.sim;
  if (!n.d.navValid) return;
  for (const k of [1, 2] as const) {
    const sel = sim.get(`S:EFIS${n.side}_NAV${k}`);
    if (!sel) continue;
    const adf = sel === 2;
    const nav = navaidOf(sim, adf ? (k === 1 ? 'adf1' : 'adf2') : k === 1 ? 'vor1' : 'vor2');
    if (!nav) continue;
    const brg = bearingDeg(n.d.lat, n.d.lon, nav.lat, nav.lon);
    const a = angDiff(brg, n.d.hdgTrue);
    const col = adf ? C.green : C.white;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((a * Math.PI) / 180);
    const head = -r + 40;
    if (k === 1) {
      line(ctx, 0, -r + 8, 0, -r * 0.35, col, 3);
      line(ctx, 0, r * 0.35, 0, r - 8, col, 3);
      poly(ctx, [-12, head + 14, 0, head, 12, head + 14], col, 3);
    } else {
      for (const dx of [-5, 5]) {
        line(ctx, dx, -r + 20, dx, -r * 0.35, col, 3);
        line(ctx, dx, r * 0.35, dx, r - 10, col, 3);
      }
      line(ctx, 0, -r + 8, 0, -r + 20, col, 3);
      poly(ctx, [-12, head + 14, 0, head, 12, head + 14], col, 3);
    }
    ctx.restore();
  }
}

function courseDeviation(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  const ils = n.mode === ND_MODE.ROSE_ILS;
  const crs = ils ? sim.get('S:NAV_ILS_CRS') : sim.get(`S:NAV_VOR${n.side}_CRS`);
  const tuned = ils ? sim.get('S:NAV_ILS_FREQ') > 0 : sim.get(`S:NAV_VOR${n.side}_FREQ`) > 0;
  const col = ils ? C.magenta : C.cyan;
  const a = angDiff(crs, n.d.hdgMag);
  ctx.save();
  ctx.translate(384, 384);
  ctx.rotate((a * Math.PI) / 180);
  for (const dx of [-148, -74, 74, 148]) {
    ctx.strokeStyle = C.white; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx, 0, 7, 0, Math.PI * 2); ctx.stroke();
  }
  if (tuned) {
    poly(ctx, [0, -250 + 10, 0, -124], col, 4);
    poly(ctx, [-14, -200, 14, -200], col, 4);
    poly(ctx, [0, 124, 0, 240], col, 4);
  }
  ctx.restore();
}

function ilsInfo(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  const f = sim.get('S:NAV_ILS_FREQ');
  txt(ctx, `ILS${n.side}`, 594, 25, C.white, FS.small);
  if (f > 0) {
    txt(ctx, f.toFixed(2), 764, 25, C.magenta, FS.inter, 'right');
    txt(ctx, 'CRS', 628, 57, C.white, FS.small);
    txt(ctx, pad(Math.round(sim.get('S:NAV_ILS_CRS')) % 360, 3), 740, 57, C.magenta, FS.inter, 'right');
    txt(ctx, '°', 742, 57, C.cyan, FS.inter);
    const ils = navaidOf(sim, 'ils');
    if (ils) txt(ctx, ils.ident, 764, 89, C.magenta, FS.inter, 'right');
  }
}

function vorInfo(ctx: Ctx, n: NdCtx): void {
  const sim = n.sim;
  const f = sim.get(`S:NAV_VOR${n.side}_FREQ`);
  txt(ctx, `VOR${n.side}`, 594, 25, C.white, FS.small);
  if (f > 0) {
    txt(ctx, f.toFixed(2), 764, 25, C.cyan, FS.inter, 'right');
    txt(ctx, 'CRS', 628, 57, C.white, FS.small);
    txt(ctx, pad(Math.round(sim.get(`S:NAV_VOR${n.side}_CRS`)) % 360, 3), 740, 57, C.cyan, FS.inter, 'right');
    txt(ctx, '°', 742, 57, C.cyan, FS.inter);
    const v = navaidOf(sim, n.side === 1 ? 'vor1' : 'vor2');
    if (v) txt(ctx, v.ident, 764, 89, C.cyan, FS.inter, 'right');
  }
}

function chrono(ctx: Ctx, n: NdCtx): void {
  const st = n.sim.get(`S:EFIS${n.side}_CHRONO_STATE`);
  if (!st) return;
  const s = n.sim.get(`S:EFIS${n.side}_CHRONO_S`);
  const text = s < 3600 ? `${pad(Math.floor(s / 60), 2)}'${pad(Math.floor(s % 60), 2)}"` : `${pad(Math.floor(s / 3600), 2)}H${pad(Math.floor((s % 3600) / 60), 2)}'`;
  poly(ctx, [2, 628, 110, 628, 110, 660, 2, 660], C.white, 1.5, true, C.black);
  txt(ctx, text, 10, 652, C.green, 24);
}

function messages(ctx: Ctx, n: NdCtx): void {
  const fm = fmgs(n.sim);
  const list: Array<{ text: string; amber?: boolean }> = Array.isArray(fm?.messages) ? fm.messages : [];
  const m = [...list].reverse().find((x) => ND_MESSAGES.includes(x.text));
  if (m && n.sim.getB('S:FMGS_POWERED')) txt(ctx, m.text, 384, 722, m.amber ? C.amber : C.white, FS.inter, 'center');
}

function terrain(ctx: Ctx, n: NdCtx): void {
  if (!n.sim.getB(`S:EFIS${n.side}_TERR_ON_ND`) || n.mode === ND_MODE.PLAN) return;
  // Terrain around LFBD lies within 400 ft of the runway elevation: drawn black (EGPWS peaks mode).
  txt(ctx, 'TERR', 700, 646, C.cyan, FS.smallest, 'left');
  txt(ctx, '002', 718, 675, C.green, FS.smallest, 'left');
  txt(ctx, '000', 718, 700, C.green, FS.smallest, 'left');
}
