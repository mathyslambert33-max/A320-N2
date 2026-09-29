/**
 * F-PLN A / B, LAT REV, AIRWAYS, VERT REV and DIR TO pages.
 */
import { CLR, KEEP, OVFY, PAGES, type LskKey, type Mcdu, type Page, type View } from '../mcdu/mcdu';
import type { Color } from '../mcdu/screen';
import { MSG, fmtLat, fmtLon, hhmm, isMsg, parseAltitude, parseSpeed, t1, type McduMessage } from '../mcdu/format';
import { FlightPlan, isLeg, type FpLeg } from '../fmgs/flightplan';
import type { Fmgs } from '../fmgs/fmgs';
import type { LegPred, PseudoWpt } from '../fmgs/perf';
import type { AltCstr } from '../navdb/types';
import { toMag } from '../navdb/navdb';
import { datL, datR, lblL, lblR, title } from './common';

/* ======================================================================== rows */

type Row =
  | { kind: 'leg'; leg: FpLeg; idx: number; altn?: boolean }
  | { kind: 'disco'; idx: number; altn?: boolean }
  | { kind: 'pseudo'; pw: PseudoWpt }
  | { kind: 'end' }
  | { kind: 'noaltn' }
  | { kind: 'endaltn' };

const LSKL: LskKey[] = ['L1', 'L2', 'L3', 'L4', 'L5'];
const LSKR: LskKey[] = ['R1', 'R2', 'R3', 'R4', 'R5'];

function buildRows(f: Fmgs, p: FlightPlan, withPreds: boolean): Row[] {
  const rows: Row[] = [];
  const from = Math.max(0, p.activeIndex - 1);
  const pseudo = withPreds && f.preds ? [...f.preds.pseudo].sort((a, b) => a.dist - b.dist) : [];
  let cum = 0;
  let pi = 0;
  p.items.forEach((it, idx) => {
    if (isLeg(it)) {
      cum += it.dist;
      while (pi < pseudo.length && pseudo[pi].dist <= cum - 0.05 && idx > 0) {
        if (idx > from) rows.push({ kind: 'pseudo', pw: pseudo[pi] });
        pi++;
      }
      if (idx >= from) rows.push({ kind: 'leg', leg: it, idx });
    } else if (idx >= from) rows.push({ kind: 'disco', idx });
  });
  rows.push({ kind: 'end' });
  if (p.altn) {
    p.altnItems.forEach((it, idx) => rows.push(isLeg(it) ? { kind: 'leg', leg: it, idx, altn: true } : { kind: 'disco', idx, altn: true }));
    rows.push({ kind: 'endaltn' });
  } else rows.push({ kind: 'noaltn' });
  return rows;
}

/* ======================================================================== formatting */

export function fmtCstrAlt(c: AltCstr, transFt: number): string {
  const f = (a: number) => (a > transFt ? `FL${String(Math.round(a / 100)).padStart(3, '0')}` : String(a));
  switch (c.type) {
    case 'at': return f(c.alt);
    case 'above': return `+${f(c.alt)}`;
    case 'below': return `-${f(c.alt)}`;
    case 'between': return `+${f(Math.min(c.alt, c.alt2 ?? c.alt))}`;
  }
}

const fmtSpd = (s: number) => (s < 2 ? `.${Math.round(s * 100)}` : String(Math.round(s)));
const fmtPredAlt = (alt: number, trans: number) => (alt > trans ? `FL${String(Math.round(alt / 100)).padStart(3, '0')}` : String(Math.round(alt / 10) * 10));

function cstrMet(c: AltCstr, alt: number): boolean {
  switch (c.type) {
    case 'at': return Math.abs(alt - c.alt) < 250;
    case 'above': return alt >= c.alt - 250;
    case 'below': return alt <= c.alt + 250;
    case 'between': return alt >= Math.min(c.alt, c.alt2 ?? c.alt) - 250 && alt <= Math.max(c.alt, c.alt2 ?? c.alt) + 250;
  }
}

/** Speed/altitude column (cols 13..23) of a F-PLN A line. */
function spdAlt(v: View, row: number, f: Fmgs, leg: FpLeg | undefined, pred: LegPred | undefined, origin: boolean, tmpy: boolean) {
  const trans = pred?.phase === 'des' ? (f.transFlDest() ?? 60) * 100 : f.transAlt() ?? 18000;
  // speed (cols 13..16)
  let spd = ' ---';
  let spdC: Color = 'w';
  let spdSmall = false;
  if (origin) { spd = ' ---'; }
  else if (leg?.spd) {
    spd = `${pred && !tmpy ? '*' : ' '}${leg.spd}`.padStart(4);
    spdC = 'm';
  } else if (pred && !tmpy) { spd = fmtSpd(pred.spd).padStart(4); spdC = 'g'; spdSmall = true; }
  v.s.text(row, 13, spd, spdC, spdSmall);
  v.s.text(row, 17, '/', 'w', false);
  // altitude (cols 18..23)
  let alt = ' -----';
  let altC: Color = 'w';
  let altSmall = false;
  if (origin && leg) { alt = String(leg.elevFt ?? 0).padStart(6); altC = tmpy ? 'y' : 'g'; }
  else if (leg?.alt) {
    if (pred && !tmpy) {
      const met = cstrMet(leg.alt, pred.alt);
      v.s.text(row, 18, '*', met ? 'm' : 'a', false);
      alt = fmtPredAlt(pred.alt, trans).padStart(5);
      v.s.text(row, 19, alt, 'g', true);
      return;
    }
    alt = fmtCstrAlt(leg.alt, trans).padStart(6);
    altC = 'm';
  } else if (pred && !tmpy) { alt = fmtPredAlt(pred.alt, trans).padStart(6); altC = 'g'; altSmall = true; }
  v.s.text(row, 18, alt, altC, altSmall);
}

/* ======================================================================== F-PLN A / B */

export function fplnPage(m: Mcdu, pageB = false, sec = false): Page & { airport(): void; setOffset(o: number): void } {
  const f = m.fmgs;
  let offset = 0;
  let airportStep = 0;
  let nRows = 0;
  const countRows = () => {
    const p = sec ? f.sec : f.shownPlan();
    return p ? buildRows(f, p, !sec && !f.tmpy && !!f.preds).length : 0;
  };
  const page = {
    id: `${sec ? 'SEC_' : ''}${pageB ? 'FPLN_B' : 'FPLN_A'}`,
    draw(v: View) {
      const tmpy = !sec && !!f.tmpy;
      const p = sec ? f.sec : f.shownPlan();
      v.arrows({ lr: true });
      if (!p) return drawEmpty(v, pageB);
      const withPreds = !sec && !tmpy && !!f.preds;
      const rows = buildRows(f, p, withPreds);
      nRows = rows.length;
      if (offset >= nRows) offset = 0;
      if (nRows > 5) v.arrows({ lr: true, up: true, down: true });

      // title line
      if (offset === 0) v.s.text(0, 1, 'FROM', 'w', true);
      if (tmpy) v.s.text(0, 6, 'TMPY', 'y', false);
      if (sec) v.s.text(0, 16, 'SEC', 'w', false);
      else if (f.flightNo) v.s.text(0, 20 - f.flightNo.length + 1, f.flightNo, 'w', true);

      // header
      v.s.text(1, 8, pageB ? 'EFOB' : 'TIME', 'w', true);
      v.s.text(1, pageB ? 18 : 14, pageB ? 'T.WIND' : 'SPD/ALT', 'w', true);

      for (let i = 0; i < 5; i++) {
        const k = offset + i;
        if (k >= nRows && nRows <= 5) break;
        const row = rows[k % nRows];
        drawRow(v, f, p, row, i, tmpy || sec, pageB, offset === 0 && i === 0, sec);
        if (sec) {
          // Secondary F-PLN revisions are not simulated: read-only.
          v.on(LSKL[i], (sp) => (sp ? MSG.NOT_ALLOWED : KEEP));
          v.on(LSKR[i], (sp) => (sp ? MSG.NOT_ALLOWED : KEEP));
          continue;
        }
        v.on(LSKL[i], (sp) => leftLsk(m, row, sp));
        v.on(LSKR[i], (sp) => rightLsk(m, row, sp));
      }

      // bottom line
      if (tmpy) {
        datL(v, 6, '<ERASE', 'a');
        datR(v, 6, 'INSERT*', 'a');
        v.on('L6', () => { f.eraseTmpy(); return KEEP; });
        v.on('R6', () => { f.insertTmpy(); return KEEP; });
      } else if (sec) {
        drawDest(v, f, p, false);
      } else {
        drawDest(v, f, p, withPreds);
        v.on('L6', (sp) => {
          const di = p.destIndex();
          if (di < 0) return sp ? MSG.NOT_ALLOWED : KEEP;
          if (sp) return MSG.NOT_ALLOWED;
          m.show(latRevPage(di));
          return KEEP;
        });
      }
    },
    up() { const n = countRows(); if (n > 5) offset = (offset + 1) % n; },
    down() { const n = countRows(); if (n > 5) offset = (offset - 1 + n) % n; },
    next() { const n = fplnPage(m, !pageB, sec); n.setOffset(offset); m.show(n); },
    prev() { const n = fplnPage(m, !pageB, sec); n.setOffset(offset); m.show(n); },
    setOffset(o: number) { offset = o; },
    /** AIRPORT key: destination, then alternate, then origin at the top. */
    airport() {
      const p = f.shownPlan();
      if (!p) return;
      const rows = buildRows(f, p, !f.tmpy && !!f.preds);
      const destRow = rows.findIndex((r) => r.kind === 'leg' && !r.altn && r.leg.seg === 'dest');
      const altnRow = rows.findIndex((r) => r.kind === 'leg' && r.altn && r.leg.seg === 'dest');
      const targets = [destRow, altnRow, 0].filter((x) => x >= 0);
      const t = targets[airportStep % targets.length];
      airportStep++;
      offset = t === 0 ? 0 : Math.max(0, t - 3);
    },
  };
  return page;
}

function drawEmpty(v: View, pageB: boolean) {
  v.s.text(1, 8, pageB ? 'EFOB' : 'TIME', 'w', true);
  v.s.text(1, pageB ? 18 : 14, pageB ? 'T.WIND' : 'SPD/ALT', 'w', true);
  datL(v, 1, 'PPOS', 'g');
  v.s.text(2, 8, '----', 'w', false);
  v.s.text(2, 13, '    / -----', 'w', false);
  datL(v, 2, '---F-PLN DISCONTINUITY--');
  datL(v, 3, '------END OF F-PLN------');
  datL(v, 4, '-----NO ALTN F-PLN------');
  lblL(v, 6, ' DEST');
  v.s.text(11, 8, 'TIME', 'w', true);
  lblR(v, 6, 'DIST  EFOB');
  datL(v, 6, '-------');
  v.s.text(12, 8, '----', 'w', true);
  v.s.right(12, '----  ---.-', 'w', true);
}

function legColor(p: FlightPlan, row: { leg: FpLeg; idx: number; altn?: boolean }, tmpy: boolean): Color {
  if (tmpy) return 'y';
  if (row.altn || row.leg.seg === 'miss') return 'c';
  if (row.idx === p.activeIndex) return 'w';
  return 'g';
}

function drawRow(v: View, f: Fmgs, p: FlightPlan, row: Row, i: number, tmpy: boolean, pageB: boolean, isFrom: boolean, sec = false) {
  const lr = i * 2 + 1;
  const dr = i * 2 + 2;
  switch (row.kind) {
    case 'disco':
      v.s.text(dr, 0, '---F-PLN DISCONTINUITY--', 'w', false);
      return;
    case 'end':
      v.s.text(dr, 0, '------END OF F-PLN------', 'w', false);
      return;
    case 'noaltn':
      v.s.text(dr, 0, '-----NO ALTN F-PLN------', 'w', false);
      return;
    case 'endaltn':
      v.s.text(dr, 0, '---END OF ALTN F-PLN----', 'w', false);
      return;
    case 'pseudo': {
      const pw = row.pw;
      v.s.text(dr, 0, pw.ident, 'g', false);
      v.s.text(dr, 8, hhmm(pw.pred.timeMin), 'g', true);
      if (pageB) v.s.text(dr, 12, t1(pw.pred.efob).padStart(5), 'g', true);
      else spdAlt(v, dr, f, undefined, pw.pred, false, false);
      return;
    }
    case 'leg': {
      const leg = row.leg;
      const c = sec ? (row.altn || leg.seg === 'miss' ? 'c' : 'w') : legColor(p, row, tmpy);
      // label line: annotation, course / bearing, distance
      if (!isFrom && i > 0) {
        if (leg.via) v.s.text(lr, 1, leg.via.slice(0, 7), c === 'w' ? 'g' : c, true);
        let crs = '';
        if (!row.altn && row.idx === p.activeIndex && i === 1 && !tmpy && f.positionValid()) {
          const b = f.bearingDistTo(leg.lat, leg.lon);
          crs = `BRG${String(Math.round(b.brg) % 360 || 360).padStart(3, '0')}°`;
        } else if ((leg.legType === 'CF' || leg.legType === 'CA' || leg.legType === 'VA') && leg.crs !== undefined) {
          crs = `C${String(leg.crs).padStart(3, '0')}°`;
        } else if (i === 2 && leg.dist > 0.05) {
          crs = `TRK${String(p.legMagTrack(leg)).padStart(3, '0')}°`;
        }
        if (crs) v.s.text(lr, 9, crs, c === 'w' ? 'g' : c, true);
        if (!leg.afterDisco && leg.dist > 0) {
          const d = String(Math.round(leg.dist));
          v.s.text(lr, 19 - d.length, d, c === 'w' ? 'g' : c, true);
          if (i === 1) v.s.text(lr, 19, 'NM', c === 'w' ? 'g' : c, true);
        }
      } else if (i > 0 && leg.via) v.s.text(lr, 1, leg.via.slice(0, 7), c, true);
      // data line
      v.s.text(dr, 0, leg.ident.slice(0, 7), c, false);
      if (leg.ovfy) v.s.text(dr, Math.min(7, leg.ident.length), OVFY, c, false);
      const pred = row.altn || tmpy ? undefined : f.preds?.legs.get(leg);
      const origin = leg.seg === 'orig';
      if (origin && !row.altn) v.s.text(dr, 8, '0000', tmpy ? 'y' : 'g', !isFrom);
      else if (pred) v.s.text(dr, 8, hhmm(pred.timeMin), 'g', true);
      else v.s.text(dr, 8, '----', 'w', false);
      if (pageB) {
        v.s.text(dr, 12, pred ? t1(pred.efob).padStart(5) : '---.-', pred ? 'g' : 'w', !!pred);
        v.s.text(dr, 18, pred?.phase === 'crz' ? '000°/000' : '', 'c', true);
      } else spdAlt(v, dr, f, leg, pred, origin && !row.altn, tmpy);
      return;
    }
  }
}

function drawDest(v: View, f: Fmgs, p: FlightPlan, withPreds: boolean) {
  lblL(v, 6, ' DEST');
  v.s.text(11, 8, 'TIME', 'w', true);
  lblR(v, 6, 'DIST  EFOB');
  const d = p.destLeg();
  datL(v, 6, d ? d.ident : '-------', 'w');
  // distance to go (along the plan from the aircraft)
  let dist = 0;
  for (let i = p.activeIndex; i < p.items.length; i++) {
    const it = p.items[i];
    if (!isLeg(it)) continue;
    dist += it.dist;
    if (it.seg === 'dest') break;
  }
  const pr = withPreds ? f.preds : undefined;
  v.s.text(12, 8, pr ? hhmm(pr.tripTime) : '----', pr ? 'g' : 'w', true);
  const efob = pr ? t1(pr.destEfob).padStart(5) : '---.-';
  v.s.right(12, `${String(Math.round(dist)).padStart(4)} ${efob.padStart(5)}`, pr ? 'g' : 'w', true);
}

/* ======================================================================== F-PLN LSK actions */

function leftLsk(m: Mcdu, row: Row, sp: string): McduMessage | void | typeof KEEP {
  const f = m.fmgs;
  if (row.kind === 'leg' && !row.altn) {
    const p = f.shownPlan()!;
    const leg = row.leg;
    if (!sp) {
      if (leg.kind === 'pseudo' && leg.legType === 'TP') return KEEP;
      m.show(latRevPage(row.idx));
      return KEEP;
    }
    if (sp === CLR) {
      if (leg.seg === 'orig' || leg.seg === 'dest' || row.idx < p.activeIndex) return MSG.NOT_ALLOWED;
      if (row.idx === p.activeIndex && f.flightPhase >= 1) return MSG.NOT_ALLOWED;
      const t = f.editPlan()!;
      if (!t.deleteAt(row.idx)) return MSG.NOT_ALLOWED;
      return;
    }
    if (sp === OVFY) {
      if (leg.seg === 'orig' || leg.seg === 'dest' || leg.kind === 'pseudo') return MSG.NOT_ALLOWED;
      leg.ovfy = !leg.ovfy;
      return;
    }
    if (leg.seg === 'orig' || row.idx < p.activeIndex) return MSG.NOT_ALLOWED;
    return insertWpt(f, row.idx - 1, sp);
  }
  if (row.kind === 'disco' && !row.altn) {
    const p = f.shownPlan()!;
    if (sp === CLR) {
      const prev = p.items[row.idx - 1];
      if (row.idx <= p.activeIndex - 1 || !prev) return MSG.NOT_ALLOWED;
      const t = f.editPlan()!;
      t.deleteAt(row.idx);
      return;
    }
    if (!sp) return KEEP;
    return insertWpt(f, row.idx - 1, sp);
  }
  return sp ? MSG.NOT_ALLOWED : KEEP;
}

function insertWpt(f: Fmgs, afterIdx: number, sp: string): McduMessage | void {
  if (!/^[A-Z0-9]{1,7}$/.test(sp)) return MSG.FORMAT_ERROR;
  const p = f.shownPlan()!;
  const prev = p.items[afterIdx];
  const ref = isLeg(prev) ? prev : f.position();
  const fix = f.db.fix(sp, ref);
  if (!fix) return MSG.NOT_IN_DATABASE;
  const t = f.editPlan()!;
  t.insertNext(afterIdx, fix);
}

function rightLsk(m: Mcdu, row: Row, sp: string): McduMessage | void | typeof KEEP {
  const f = m.fmgs;
  if (row.kind !== 'leg' || row.altn) return sp ? MSG.NOT_ALLOWED : KEEP;
  const leg = row.leg;
  if (!sp) {
    if (leg.kind === 'pseudo' && leg.legType === 'TP') return KEEP;
    m.show(vertRevPage(row.idx));
    return KEEP;
  }
  if (leg.seg === 'orig') return MSG.NOT_ALLOWED;
  return applyConstraint(f, leg, sp);
}

/** "SPD/ALT", "SPD/", "/ALT" or "ALT" constraint entry on a leg. */
function applyConstraint(f: Fmgs, leg: FpLeg, sp: string): McduMessage | void {
  if (sp === CLR) { leg.alt = undefined; leg.spd = undefined; f.markDirty(); return; }
  const parts = sp.includes('/') ? sp.split('/') : ['', sp];
  if (parts.length > 2) return MSG.FORMAT_ERROR;
  const [s, a] = parts;
  let spd: number | undefined, alt: AltCstr | undefined;
  if (s) {
    const r = parseSpeed(s, 90, 350);
    if (isMsg(r)) return r;
    if (r < 2) return MSG.FORMAT_ERROR;
    spd = r;
  }
  if (a) {
    const c = parseAltCstr(a);
    if (isMsg(c)) return c;
    alt = c;
  }
  if (spd !== undefined) leg.spd = spd;
  if (alt) leg.alt = alt;
  f.markDirty();
}

export function parseAltCstr(s: string): AltCstr | McduMessage {
  const r = /^([+-]?)(FL\d{1,3}|\d{1,5})$/.exec(s);
  if (!r) return MSG.FORMAT_ERROR;
  const alt = parseAltitude(r[2], -1000, 39000);
  if (isMsg(alt)) return alt;
  return { type: r[1] === '+' ? 'above' : r[1] === '-' ? 'below' : 'at', alt };
}

/* ======================================================================== LAT REV */

export function latRevPage(idx: number) {
  return (m: Mcdu): Page => ({
    id: 'LAT_REV',
    draw(v) {
      const f = v.f;
      const p = f.shownPlan();
      const leg = p?.items[idx];
      if (!p || !isLeg(leg)) { m.show(PAGES.FPLN); return; }
      const origin = leg.seg === 'orig';
      const dest = leg.seg === 'dest';
      v.s.center(0, `LAT REV {s}FROM{l} {g}${leg.ident}`, 'w', false);
      v.s.center(1, `${fmtLat(leg.lat)}/${fmtLon(leg.lon)}`, 'g', true);
      if (origin) {
        datL(v, 1, '<DEPARTURE');
        v.on('L1', () => { m.show(departurePage()); return KEEP; });
      }
      if (dest) {
        datR(v, 1, 'ARRIVAL>');
        v.on('R1', () => { m.show(arrivalPage()); return KEEP; });
      } else if (!origin) datR(v, 1, 'FIX INFO>');
      if (!origin && !dest) {
        datL(v, 2, '<OFFSET');
        lblR(v, 2, 'LL XING/INCR/NO');
        datR(v, 2, '[  ]°/[ ]°/[]', 'c');
        datL(v, 3, '<HOLD');
      }
      if (!dest) {
        lblR(v, 3, 'NEXT WPT ');
        datR(v, 3, '[     ]', 'c');
        v.on('R3', (sp) => {
          if (!sp) return;
          if (sp === CLR) return MSG.NOT_ALLOWED;
          const r = insertWpt(f, idx, sp);
          if (r) return r;
          m.show(PAGES.FPLN);
        });
      }
      if (!dest || f.flightPhase > 0) {
        lblR(v, 4, 'NEW DEST ');
        datR(v, 4, '[  ]', 'c');
        v.on('R4', (sp) => {
          if (!sp) return;
          if (sp === CLR) return MSG.NOT_ALLOWED;
          if (!/^[A-Z]{4}$/.test(sp)) return MSG.FORMAT_ERROR;
          const ap = f.db.airport(sp);
          if (!ap) return MSG.NOT_IN_DATABASE;
          f.editPlan()!.newDest(idx, ap);
          m.show(PAGES.FPLN);
        });
      }
      if (!origin && !dest) {
        datR(v, 5, 'AIRWAYS>');
        v.on('R5', () => { m.show(airwaysPage(idx)); return KEEP; });
      }
      if (dest) {
        datL(v, 5, '<ALTN', 'w');
      }
      if (f.tmpy) {
        datL(v, 6, '<TMPY', 'a');
        datR(v, 6, 'INSERT*', 'a');
        v.on('R6', () => { f.insertTmpy(); m.show(PAGES.FPLN); return KEEP; });
        v.on('L6', () => { m.show(PAGES.FPLN); return KEEP; });
      } else {
        datL(v, 6, '<RETURN');
        v.on('L6', () => { m.show(PAGES.FPLN); return KEEP; });
      }
    },
  });
}

/* ======================================================================== AIRWAYS */

export function airwaysPage(fromIdx: number) {
  const entries: { via: string; to?: string; toIdx?: number; fromIdx: number; fromIdent: string }[] = [];
  let startIdent = '';
  return (m: Mcdu): Page => ({
    id: 'AIRWAYS',
    draw(v) {
      const f = v.f;
      const p = f.shownPlan();
      const leg = p?.items[fromIdx];
      if (!startIdent && isLeg(leg)) startIdent = leg.ident;
      v.s.center(0, `AIRWAYS {s}FROM{l} {g}${startIdent}`, 'w', false);
      for (let i = 0; i < 5; i++) {
        const e = entries[i];
        const prev = entries[i - 1];
        if (!e && i > 0 && !prev?.to) break;
        lblL(v, i + 1, ' VIA');
        lblR(v, i + 1, 'TO ');
        if (e) {
          datL(v, i + 1, e.via, 'y');
          if (e.to) datR(v, i + 1, e.to, 'y');
          else datR(v, i + 1, '[    ]', 'c');
        } else {
          datL(v, i + 1, '[   ]', 'c');
          datR(v, i + 1, '[    ]', 'c');
        }
        v.on(LSKL[i], (sp) => {
          if (!sp) return;
          if (sp === CLR || e?.to) return MSG.NOT_ALLOWED;
          if (!/^[A-Z0-9]{2,5}$/.test(sp)) return MSG.FORMAT_ERROR;
          const awy = f.db.airways[sp];
          if (!awy) return MSG.NOT_IN_DATABASE;
          const fi = i === 0 ? fromIdx : prev!.toIdx!;
          const fromIdent = i === 0 ? startIdent : prev!.to!;
          if (!awy.includes(fromIdent)) return MSG.AWY_WPT_MISMATCH;
          entries[i] = { via: sp, fromIdx: fi, fromIdent };
        });
        v.on(LSKR[i], (sp) => {
          if (!sp) return;
          if (sp === CLR || !e || e.to) return MSG.NOT_ALLOWED;
          if (!/^[A-Z0-9]{1,5}$/.test(sp)) return MSG.FORMAT_ERROR;
          if (!f.db.lookup(sp).length) return MSG.NOT_IN_DATABASE;
          const seg = f.db.airwaySegment(e.via, e.fromIdent, sp);
          if (!seg) return MSG.AWY_WPT_MISMATCH;
          const t = f.editPlan()!;
          const ref = t.items[e.fromIdx] as FpLeg;
          const fixes = seg.map((id) => f.db.fix(id, ref)!).filter(Boolean);
          e.toIdx = t.insertAirway(e.fromIdx, e.via, fixes);
          e.to = sp;
        });
      }
      if (f.tmpy) {
        datL(v, 6, '<ERASE', 'a');
        datR(v, 6, 'INSERT*', 'a');
        v.on('L6', () => { f.eraseTmpy(); entries.length = 0; m.show(PAGES.FPLN); return KEEP; });
        v.on('R6', () => { f.insertTmpy(); m.show(PAGES.FPLN); return KEEP; });
      } else {
        datL(v, 6, '<RETURN');
        v.on('L6', () => { m.show(latRevPage(fromIdx)); return KEEP; });
      }
    },
  });
}

/* ======================================================================== VERT REV */

export function vertRevPage(idx: number) {
  return (m: Mcdu): Page => ({
    id: 'VERT_REV',
    draw(v) {
      const f = v.f;
      const p = f.shownPlan();
      const leg = p?.items[idx];
      if (!p || !isLeg(leg)) { m.show(PAGES.FPLN); return; }
      v.s.center(0, `VERT REV {s}AT{l} {g}${leg.ident}`, 'w', false);
      const pred = f.tmpy ? undefined : f.preds?.legs.get(leg);
      const fp = f.fuelPred();
      v.s.text(1, 1, `EFOB=${pred ? t1(pred.efob) : '---.-'}`, 'w', true);
      v.s.text(1, 13, `EXTRA=${fp ? t1(fp.extra) : '---.-'}`, 'w', true);
      const climb = !pred || pred.phase === 'clb';
      if (!pred || pred.phase !== 'crz') {
        lblL(v, 2, climb ? ' CLB SPD LIM' : ' DES SPD LIM');
        datL(v, 2, '250/FL100', 'm');
      }
      lblL(v, 3, ' SPD CSTR');
      lblR(v, 3, 'ALT CSTR ');
      const trans = climb ? f.transAlt() ?? 5000 : (f.transFlDest() ?? 60) * 100;
      if (leg.spd) datL(v, 3, ` ${leg.spd}`, 'm'); else datL(v, 3, '[   ]', 'c');
      if (leg.alt) datR(v, 3, fmtCstrAlt(leg.alt, trans), 'm'); else datR(v, 3, '[    ]', 'c');
      const origin = leg.seg === 'orig';
      v.on('L3', (sp) => {
        if (!sp) return;
        if (origin) return MSG.NOT_ALLOWED;
        if (sp === CLR) { leg.spd = undefined; f.markDirty(); return; }
        const r = parseSpeed(sp, 90, 350);
        if (isMsg(r)) return r;
        if (r < 2) return MSG.FORMAT_ERROR;
        leg.spd = r;
        f.markDirty();
      });
      v.on('R3', (sp) => {
        if (!sp) return;
        if (origin) return MSG.NOT_ALLOWED;
        if (sp === CLR) { leg.alt = undefined; f.markDirty(); return; }
        const c = parseAltCstr(sp);
        if (isMsg(c)) return c;
        leg.alt = c;
        f.markDirty();
      });
      lblL(v, 4, ' MACH/START WPT');
      datL(v, 4, '[ ]/[     ]', 'c');
      datL(v, 5, '<WIND');
      datR(v, 5, 'STEP ALTS>');
      datL(v, 6, '<RETURN');
      v.on('L6', () => { m.show(PAGES.FPLN); return KEEP; });
    },
  });
}

/* ======================================================================== DIR TO */

export function dirToPage(m: Mcdu): Page {
  let offset = 0;
  let target: { ident: string; idx?: number } | undefined;
  return {
    id: 'DIR_TO',
    draw(v) {
      const f = v.f;
      const p = f.active;
      title(v, 'DIR TO');
      lblL(v, 1, ' WAYPOINT');
      lblR(v, 1, 'UTC   DIST ');
      if (target) datL(v, 1, target.ident, 'y'); else datL(v, 1, '[     ]', 'c');
      datR(v, 1, '----  ---- ', 'w', true);
      v.on('L1', (sp) => {
        if (!sp) return;
        if (!p) return MSG.NOT_ALLOWED;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        if (!/^[A-Z0-9]{1,7}$/.test(sp)) return MSG.FORMAT_ERROR;
        const idx = p.items.findIndex((it, k) => k >= p.activeIndex && isLeg(it) && it.ident === sp && it.seg !== 'miss');
        if (idx < 0 && !f.db.lookup(sp).length) return MSG.NOT_IN_DATABASE;
        target = { ident: sp, idx: idx >= 0 ? idx : undefined };
      });
      lblL(v, 2, ' F-PLN WPTS');
      const list: { ident: string; idx: number }[] = [];
      if (p) p.items.forEach((it, k) => { if (k >= p.activeIndex && isLeg(it) && it.seg !== 'miss' && it.kind !== 'pseudo') list.push({ ident: it.ident, idx: k }); });
      if (list.length > 4) v.arrows({ up: true, down: true });
      if (offset > Math.max(0, list.length - 4)) offset = 0;
      for (let i = 0; i < 4; i++) {
        const e = list[offset + i];
        if (!e) break;
        datL(v, i + 2, `<${e.ident}`, 'c');
        const L = (['L2', 'L3', 'L4', 'L5'] as LskKey[])[i];
        v.on(L, (sp) => {
          if (sp) return MSG.NOT_ALLOWED;
          target = { ident: e.ident, idx: e.idx };
          return KEEP;
        });
      }
      lblR(v, 3, 'RADIAL IN ');
      datR(v, 3, '[ ]°', 'c');
      lblR(v, 4, 'RADIAL OUT ');
      datR(v, 4, '[ ]°', 'c');
      if (target) {
        lblL(v, 6, ' DIR TO');
        datL(v, 6, '<ERASE', 'a');
        datR(v, 6, 'INSERT*', 'a');
        v.on('L6', () => { target = undefined; return KEEP; });
        v.on('R6', () => {
          if (!p || !target) return KEEP;
          const pos = f.position();
          if (target.idx !== undefined) p.directTo(pos, p.items[target.idx] as FpLeg, target.idx);
          else {
            const fix = f.db.fix(target.ident, pos);
            if (!fix) return MSG.NOT_IN_DATABASE;
            p.directTo(pos, fix);
          }
          target = undefined;
          f.markDirty();
          m.show(PAGES.FPLN);
          return KEEP;
        });
      }
      void m;
    },
    up() { offset++; },
    down() { offset = Math.max(0, offset - 1); },
  };
}

/* late-bound imports (avoid cycles) */
import { arrivalPage, departurePage } from './proc';
export { toMag };
