/**
 * DEPARTURES and ARRIVAL (with APPR VIAS) pages. Selections are made in the temporary flight plan
 * (yellow) and become active with INSERT*.
 */
import { KEEP, PAGES, type LskKey, type Mcdu, type Page, type View } from '../mcdu/mcdu';
import type { Color } from '../mcdu/screen';
import { MSG } from '../mcdu/format';
import type { FlightPlan } from '../fmgs/flightplan';
import type { DbApproach, DbProcedure, DbRunway, DbTransition } from '../navdb/types';
import { datL, datR, lblL, lblR } from './common';

const LIST_L: LskKey[] = ['L2', 'L3', 'L4', 'L5'];
const LIST_R: LskKey[] = ['R2', 'R3', 'R4', 'R5'];

function selColor(v: View): Color {
  return v.f.tmpy ? 'y' : 'g';
}

function bottomLine(v: View, m: Mcdu, back: () => void) {
  if (v.f.tmpy) {
    datL(v, 6, '<ERASE', 'a');
    datR(v, 6, 'INSERT*', 'a');
    v.on('L6', () => { v.f.eraseTmpy(); m.show(PAGES.FPLN); return KEEP; });
    v.on('R6', () => { v.f.insertTmpy(); m.show(PAGES.FPLN); return KEEP; });
  } else {
    datL(v, 6, '<RETURN');
    v.on('L6', () => { back(); return KEEP; });
  }
}

/* ======================================================================== DEPARTURES */

export function departurePage() {
  let mode: 'rwy' | 'sid' | undefined;
  let offset = 0;
  return (m: Mcdu): Page => {
    const f = m.fmgs;
    const list = (p: FlightPlan) => {
      const ap = p.origin!;
      if (mode === 'rwy') return ap.runways.length;
      return sidsFor(p).length + 1;
    };
    const sidsFor = (p: FlightPlan): DbProcedure[] => p.origin!.sids.filter((s) => !p.depRwy || s.runways.includes(p.depRwy.ident));
    return {
      id: 'DEPARTURE',
      draw(v) {
        const p = f.shownPlan();
        if (!p?.origin) { m.show(PAGES.FPLN); return; }
        if (!mode) mode = p.depRwy ? 'sid' : 'rwy';
        const ap = p.origin;
        const sc = selColor(v);
        v.s.text(0, 1, `DEPARTURES {s}FROM{l} {g}${ap.icao}`, 'w', false);
        v.arrows({ lr: true, up: list(p) > 4, down: list(p) > 4 });
        // selected
        lblL(v, 1, ' RWY');
        v.s.text(1, 10, 'SID', 'w', true);
        lblR(v, 1, 'TRANS ');
        if (p.depRwy) {
          const ils = f.db.ilsForRunway(ap, p.depRwy);
          datL(v, 1, `${p.depRwy.ident}${ils ? '{s}-ILS' : ''}`, sc);
        } else datL(v, 1, '---');
        if (p.sid) v.s.text(2, 9, p.sid.ident, sc, false);
        else if (p.sid === null) v.s.text(2, 9, 'NONE', sc, false);
        else v.s.text(2, 9, '------', 'w', false);
        if (p.sidTrans) datR(v, 1, p.sidTrans.ident, sc);
        else if (p.sidTrans === null) datR(v, 1, 'NONE', sc);
        else datR(v, 1, '------');

        if (mode === 'rwy') {
          v.s.text(3, 3, 'AVAILABLE RUNWAYS', 'w', false);
          const rw = ap.runways;
          if (offset > Math.max(0, rw.length - 4)) offset = 0;
          for (let i = 0; i < 4; i++) {
            const r: DbRunway | undefined = rw[offset + i];
            if (!r) break;
            const sel = p.depRwy?.ident === r.ident;
            const c: Color = sel ? sc : 'c';
            const row = 4 + i * 2;
            v.s.text(row, 0, `${sel ? ' ' : '<'}${r.ident}`, c, false);
            v.s.text(row, 7, `${r.lengthM}{s}M`, c, false);
            const ils = f.db.ilsForRunway(ap, r);
            v.s.text(row + 1, 3, `CRS${String(r.magCrs).padStart(3, '0')}`, c, true);
            if (ils) v.s.text(row + 1, 12, `${ils.ident.padEnd(4)}${ils.freq.toFixed(2)}`, c, true);
            v.on(LIST_L[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              t.depRwy = r;
              t.sid = undefined;
              t.sidTrans = undefined;
              t.rebuildDeparture();
              mode = 'sid';
              offset = 0;
              return KEEP;
            });
          }
        } else {
          v.s.text(3, 0, 'SIDS', 'w', false);
          v.s.text(3, 7, 'AVAILABLE', 'w', true);
          v.s.right(3, 'TRANS', 'w', false);
          const sids: (DbProcedure | null)[] = [...sidsFor(p), null];
          if (offset > Math.max(0, sids.length - 4)) offset = 0;
          for (let i = 0; i < 4; i++) {
            const s = sids[offset + i];
            if (s === undefined) break;
            const sel = s ? p.sid?.ident === s.ident : p.sid === null;
            const c: Color = sel ? sc : 'c';
            v.s.text(4 + i * 2, 0, `${sel ? ' ' : '<'}${s ? s.ident : 'NO SID'}`, c, false);
            v.on(LIST_L[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              if (!t.depRwy && s) t.depRwy = f.db.runway(ap, s.runways[0]);
              t.sid = s;
              t.sidTrans = s && s.trans.length ? undefined : null;
              t.rebuildDeparture();
              return KEEP;
            });
          }
          // transitions of the selected SID
          const trans: (DbTransition | null)[] = p.sid ? [...p.sid.trans, ...(p.sid.trans.length ? [null] : [])] : [];
          for (let i = 0; i < Math.min(4, trans.length); i++) {
            const tr = trans[i];
            const sel = tr ? p.sidTrans?.ident === tr.ident : p.sidTrans === null;
            const c: Color = sel ? sc : 'c';
            v.s.right(4 + i * 2, `${tr ? tr.ident : 'NO TRANS'}${sel ? ' ' : '>'}`, c, false);
            v.on(LIST_R[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              t.sidTrans = tr;
              t.rebuildDeparture();
              return KEEP;
            });
          }
        }
        bottomLine(v, m, () => m.show(PAGES.FPLN));
      },
      up() { offset++; },
      down() { offset = Math.max(0, offset - 1); },
      next() { mode = mode === 'rwy' ? 'sid' : 'rwy'; offset = 0; },
      prev() { mode = mode === 'rwy' ? 'sid' : 'rwy'; offset = 0; },
    };
  };
}

/* ======================================================================== ARRIVAL */

export function arrivalPage() {
  let mode: 'appr' | 'star' | 'via' | undefined;
  let offset = 0;
  return (m: Mcdu): Page => {
    const f = m.fmgs;
    const starsFor = (p: FlightPlan): DbProcedure[] =>
      p.dest!.stars.filter((s) => !p.approach || s.runways.includes(p.approach.runway));
    const count = (p: FlightPlan) => (mode === 'appr' ? p.dest!.approaches.length : mode === 'star' ? starsFor(p).length + 1 : (p.approach?.vias.length ?? 0) + 1);
    return {
      id: 'ARRIVAL',
      draw(v) {
        const p = f.shownPlan();
        if (!p?.dest) { m.show(PAGES.FPLN); return; }
        if (!mode) mode = p.approach ? 'star' : 'appr';
        const ap = p.dest;
        const sc = selColor(v);
        const perPage = mode === 'via' ? 4 : 3;
        const n = count(p);
        v.s.center(0, `ARRIVAL {s}TO{l} {g}${ap.icao}`, 'w', false);
        v.arrows({ lr: mode !== 'via', up: n > perPage, down: n > perPage });
        lblL(v, 1, ' APPR');
        v.s.text(1, 10, 'VIA', 'w', true);
        lblR(v, 1, 'STAR ');
        if (p.approach) datL(v, 1, p.approach.ident, sc);
        else datL(v, 1, '------');
        if (p.appVia) v.s.text(2, 10, p.appVia.ident, sc, false);
        else if (p.appVia === null) v.s.text(2, 10, 'NONE', sc, false);
        else v.s.text(2, 10, '------', 'w', false);
        if (p.star) datR(v, 1, p.star.ident, sc);
        else if (p.star === null) datR(v, 1, 'NONE', sc);
        else datR(v, 1, '------');

        if (mode === 'via') {
          lblL(v, 2, ' APPR VIAS');
          const vias: (DbTransition | null)[] = [null, ...(p.approach?.vias ?? [])];
          if (offset > Math.max(0, vias.length - 4)) offset = 0;
          for (let i = 0; i < 4; i++) {
            const t = vias[offset + i];
            if (t === undefined) break;
            const sel = t ? p.appVia?.ident === t.ident : p.appVia === null;
            const c: Color = sel ? sc : 'c';
            datL(v, i + 2, `${sel ? ' ' : '<'}${t ? t.ident : 'NO VIA'}`, c);
            v.on(LIST_L[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const tp = f.editPlan()!;
              tp.appVia = t;
              tp.rebuildArrival();
              mode = 'star';
              offset = 0;
              return KEEP;
            });
          }
          datL(v, 6, '<RETURN');
          v.on('L6', () => { mode = 'star'; offset = 0; return KEEP; });
          if (f.tmpy) { datR(v, 6, 'INSERT*', 'a'); v.on('R6', () => { f.insertTmpy(); m.show(PAGES.FPLN); return KEEP; }); }
          return;
        }

        lblL(v, 2, ' APPR');
        if (p.approach?.vias.length) {
          datL(v, 2, '<VIAS');
          v.on('L2', (sp) => { if (sp) return MSG.NOT_ALLOWED; mode = 'via'; offset = 0; return KEEP; });
        }
        lblR(v, 2, 'TRANS ');
        if (p.starTrans) datR(v, 2, p.starTrans.ident, sc);
        else if (p.starTrans === null) datR(v, 2, 'NONE', sc);
        else datR(v, 2, '------');

        if (mode === 'appr') {
          v.s.text(5, 0, 'APPR', 'w', false);
          v.s.text(5, 6, 'AVAILABLE', 'w', true);
          const list = ap.approaches;
          if (offset > Math.max(0, list.length - 3)) offset = 0;
          for (let i = 0; i < 3; i++) {
            const a: DbApproach | undefined = list[offset + i];
            if (!a) break;
            const sel = p.approach?.ident === a.ident;
            const c: Color = sel ? sc : 'c';
            const row = 6 + i * 2;
            const r = f.db.runway(ap, a.runway);
            v.s.text(row, 0, `${sel ? ' ' : '<'}${a.ident}`, c, false);
            if (r) {
              v.s.text(row, 9, `${r.lengthM}{s}M`, c, false);
              const ils = f.db.ilsForRunway(ap, r);
              v.s.text(row + 1, 3, `${String(r.magCrs).padStart(3, '0')}°`, c, true);
              if (ils) v.s.text(row + 1, 9, `${ils.ident.padEnd(4)}${ils.freq.toFixed(2)}`, c, true);
            }
            v.on((['L3', 'L4', 'L5'] as LskKey[])[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              t.approach = a;
              t.appVia = a.vias.length ? undefined : null;
              if (t.star && !t.star.runways.includes(a.runway)) { t.star = undefined; t.starTrans = undefined; }
              t.rebuildArrival();
              mode = 'star';
              offset = 0;
              return KEEP;
            });
          }
        } else {
          v.s.text(5, 0, 'STARS', 'w', false);
          v.s.text(5, 7, 'AVAILABLE', 'w', true);
          v.s.right(5, 'TRANS', 'w', false);
          const stars: (DbProcedure | null)[] = [...starsFor(p), null];
          if (offset > Math.max(0, stars.length - 3)) offset = 0;
          for (let i = 0; i < 3; i++) {
            const s = stars[offset + i];
            if (s === undefined) break;
            const sel = s ? p.star?.ident === s.ident : p.star === null;
            const c: Color = sel ? sc : 'c';
            v.s.text(6 + i * 2, 0, `${sel ? ' ' : '<'}${s ? s.ident : 'NO STAR'}`, c, false);
            v.on((['L3', 'L4', 'L5'] as LskKey[])[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              t.star = s;
              t.starTrans = s && s.trans.length ? undefined : null;
              t.rebuildArrival();
              return KEEP;
            });
          }
          const trans: (DbTransition | null)[] = p.star ? [...p.star.trans, ...(p.star.trans.length ? [null] : [])] : [];
          for (let i = 0; i < Math.min(3, trans.length); i++) {
            const tr = trans[i];
            const sel = tr ? p.starTrans?.ident === tr.ident : p.starTrans === null;
            const c: Color = sel ? sc : 'c';
            v.s.right(6 + i * 2, `${tr ? tr.ident : 'NO TRANS'}${sel ? ' ' : '>'}`, c, false);
            v.on((['R3', 'R4', 'R5'] as LskKey[])[i], (sp) => {
              if (sp) return MSG.NOT_ALLOWED;
              const t = f.editPlan()!;
              t.starTrans = tr;
              t.rebuildArrival();
              return KEEP;
            });
          }
        }
        bottomLine(v, m, () => m.show(PAGES.FPLN));
      },
      up() { offset++; },
      down() { offset = Math.max(0, offset - 1); },
      next() { if (mode !== 'via') { mode = mode === 'appr' ? 'star' : 'appr'; offset = 0; } },
      prev() { if (mode !== 'via') { mode = mode === 'appr' ? 'star' : 'appr'; offset = 0; } },
    };
  };
}
