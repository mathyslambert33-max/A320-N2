/**
 * INIT A, ROUTE SELECTION, (CLIMB) WIND and INIT B pages.
 */
import { KEEP, PAGES, type Mcdu, type Page, type View } from '../mcdu/mcdu';
import {
  MSG, box, fmtLat, fmtLon, fmtTemp, fmtTripWind, hhmm, parseCg, parseFl, parseLat, parseLon, parseTemp,
  parseTripWind, parseWeight, t1, isMsg, type McduMessage,
} from '../mcdu/format';
import { isaTemp } from '../fmgs/perf';
import { isLeg } from '../fmgs/flightplan';
import { CLR, apply, datAt, datL, datR, lblAt, lblL, lblR, title } from './common';

/* ======================================================================== INIT A */

export function initAPage(m: Mcdu): Page {
  const f = m.fmgs;
  const page: Page = {
    id: 'INIT_A',
    draw(v: View) {
      const p = f.active;
      const hasPlan = !!p?.origin && !!p?.dest;
      title(v, 'INIT');
      v.arrows({ lr: !f.enginesRunning() });

      // CO RTE
      lblL(v, 1, ' CO RTE');
      if (f.coRoute) datL(v, 1, f.coRoute, 'c');
      else datL(v, 1, box(10), 'a');
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        if (!/^[A-Z0-9]{1,10}$/.test(sp)) return MSG.FORMAT_ERROR;
        if (!f.loadCoRoute(sp)) return MSG.NOT_IN_DATABASE;
      });

      // FROM/TO
      lblR(v, 1, 'FROM/TO  ');
      if (hasPlan) datR(v, 1, `${p!.origin!.icao}/${p!.dest!.icao}`, 'c');
      else datR(v, 1, `${box(4)}/${box(4)}`, 'a');
      v.on('R1', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        const r = /^([A-Z]{4})\/([A-Z]{4})$/.exec(sp);
        if (!r) return MSG.FORMAT_ERROR;
        const o = f.db.airport(r[1]), d = f.db.airport(r[2]);
        if (!o || !d) return MSG.NOT_IN_DATABASE;
        if (f.flightPhase >= 2) return MSG.NOT_ALLOWED;
        f.newFlightPlan(o, d);
        if (f.db.coRoutesFor(o.icao, d.icao).length) m.show(routeSelectionPage(o.icao, d.icao));
      });

      // ALTN/CO RTE
      lblL(v, 2, 'ALTN/CO RTE');
      if (!hasPlan) datL(v, 2, '----/----------');
      else if (p!.altn) datL(v, 2, `${p!.altn.icao}${f.altnCoRoute ? `/${f.altnCoRoute}` : ''}`, 'c');
      else datL(v, 2, 'NONE', 'c');
      v.on('L2', (sp) => {
        if (!sp) return;
        if (!hasPlan) return MSG.NOT_ALLOWED;
        if (sp === CLR) { f.setAlternate(undefined); return; }
        const r = /^([A-Z]{4})(?:\/([A-Z0-9]{1,10}))?$/.exec(sp);
        if (!r) return MSG.FORMAT_ERROR;
        if (!f.db.airport(r[1])) return MSG.NOT_IN_DATABASE;
        if (r[2] && !f.db.coRoute(r[2])) return MSG.NOT_IN_DATABASE;
        f.setAlternate(r[1], r[2]);
      });

      // FLT NBR
      lblL(v, 3, 'FLT NBR');
      if (f.flightNo) datL(v, 3, f.flightNo, 'c');
      else datL(v, 3, box(8), 'a');
      v.on('L3', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        if (!/^[A-Z0-9]{1,8}$/.test(sp)) return MSG.FORMAT_ERROR;
        f.flightNo = sp;
      });

      // ALIGN IRS
      const posEntered = f.sim.getB('S:ADIRS_POS_ENTERED') || f.irsAlignSent;
      const allAligned = [1, 2, 3].every((n) => f.sim.getB(`S:ADIRS_IR${n}_ALIGNED`) || f.sim.get(`S:ADIRS_IR${n}_STATE`) !== 1);
      const showAlign = hasPlan && f.initPos && f.irsAligning() && !posEntered && !allAligned;
      if (showAlign) {
        datR(v, 3, 'ALIGN IRS→', 'a');
        v.on('R3', () => {
          f.sim.emit('adirs:position', { lat: f.initPos!.lat, lon: f.initPos!.lon });
          f.irsAlignSent = true;
          return KEEP;
        });
      }

      // LAT / LONG
      lblL(v, 4, 'LAT');
      lblR(v, 4, 'LONG');
      const aligned = f.positionValid();
      const pos = aligned ? f.position() : f.initPos;
      if (pos) {
        const c = aligned ? 'g' : 'c';
        datL(v, 4, fmtLat(pos.lat), c);
        datR(v, 4, fmtLon(pos.lon), c);
        if (!aligned) {
          datAt(v, 4, 11, '↑↓', 'w');
        }
      } else {
        datL(v, 4, '----.-');
        datR(v, 4, '-----.-');
      }
      const editPos = (sp: string, lat: boolean): McduMessage | void => {
        if (!sp) return;
        if (!f.initPos || aligned || posEntered) return MSG.NOT_ALLOWED;
        const val = lat ? parseLat(sp) : parseLon(sp);
        if (val === null) return MSG.FORMAT_ERROR;
        if (Number.isNaN(val)) return MSG.ENTRY_OUT_OF_RANGE;
        f.initPos = lat ? { ...f.initPos, lat: val } : { ...f.initPos, lon: val };
      };
      v.on('L4', (sp) => editPos(sp, true));
      v.on('R4', (sp) => editPos(sp, false));

      // COST INDEX
      lblL(v, 5, 'COST INDEX');
      if (f.ci !== undefined) datL(v, 5, String(f.ci), 'c');
      else if (hasPlan) datL(v, 5, box(3), 'a');
      else datL(v, 5, '---');
      v.on('L5', (sp) => {
        if (!sp) return;
        if (!hasPlan) return MSG.NOT_ALLOWED;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        if (!/^\d{1,3}$/.test(sp)) return MSG.FORMAT_ERROR;
        f.ci = +sp;
        f.markDirty();
      });

      datR(v, 5, 'WIND>');
      v.on('R5', () => { m.show(windPage); return KEEP; });

      // CRZ FL / TEMP
      lblL(v, 6, 'CRZ FL/TEMP');
      if (f.crzFl) {
        const temp = f.crzTemp ?? Math.round(isaTemp(f.crzFl * 100));
        datL(v, 6, `FL${String(f.crzFl).padStart(3, '0')}`, 'c');
        datAt(v, 6, 5, `/${fmtTemp(temp)}`, 'c', f.crzTemp === undefined);
      } else if (hasPlan) datL(v, 6, `${box(5)}/---°`, 'a');
      else datL(v, 6, '-----/---°');
      v.on('L6', (sp) => {
        if (!sp) return;
        if (!hasPlan) return MSG.NOT_ALLOWED;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        const [a, b] = sp.split('/');
        if (sp.split('/').length > 2) return MSG.FORMAT_ERROR;
        let fl = f.crzFl;
        if (a) {
          const r = parseFl(a);
          if (isMsg(r)) return r;
          fl = r;
        }
        let temp: number | undefined;
        if (b !== undefined) {
          const t = parseTemp(b, -99, 99);
          if (isMsg(t)) return t;
          temp = t;
        }
        if (!fl) return MSG.NOT_ALLOWED;
        const w = f.tow();
        if (w !== undefined && fl > recMax(w)) return MSG.ENTRY_OUT_OF_RANGE;
        f.crzFl = fl;
        if (a) f.crzTemp = undefined;
        if (temp !== undefined) f.crzTemp = temp;
        f.markDirty();
      });

      // TROPO
      lblR(v, 6, 'TROPO');
      datR(v, 6, String(f.tropo), 'c', !f.tropoPilot);
      v.on('R6', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.tropo = 36090; f.tropoPilot = false; return; }
        if (!/^\d{3,5}$/.test(sp)) return MSG.FORMAT_ERROR;
        const t = +sp;
        if (t > 60000) return MSG.ENTRY_OUT_OF_RANGE;
        f.tropo = Math.round(t / 10) * 10;
        f.tropoPilot = true;
      });
    },
    up() {
      if (f.initPos && !f.positionValid()) f.initPos = { ...f.initPos, lat: f.initPos.lat + 0.1 / 60 };
    },
    down() {
      if (f.initPos && !f.positionValid()) f.initPos = { ...f.initPos, lat: f.initPos.lat - 0.1 / 60 };
    },
    next() { if (!f.enginesRunning()) m.show(PAGES.INIT_B); },
    prev() { if (!f.enginesRunning()) m.show(PAGES.INIT_B); },
  };
  return page;
}

function recMax(towKg: number): number {
  const w = towKg / 1000;
  return Math.min(398, Math.round(398 - Math.max(0, w - 60) * 6.5));
}

/* ======================================================================== ROUTE SELECTION */

export function routeSelectionPage(from: string, to: string) {
  let idx = 0;
  return (m: Mcdu): Page => ({
    id: 'ROUTE_SELECTION',
    draw(v) {
      const list = v.f.db.coRoutesFor(from, to);
      const r = list[idx];
      title(v, 'ROUTE SELECTION');
      if (list.length > 1) { v.arrows({ lr: true }); v.s.text(0, 19, `${idx + 1}/${list.length}`, 'w', true); }
      if (!r) {
        datL(v, 1, 'NONE', 'g');
      } else {
        lblL(v, 1, ' CO RTE');
        lblR(v, 1, 'FROM/TO  ');
        datL(v, 1, r.ident, 'g');
        datR(v, 1, `${r.from}/${r.to}`, 'g');
        lblL(v, 2, ' VIA');
        lblAt(v, 2, 12, 'TO');
        const rows: [string, string][] = [];
        rows.push([r.sid ?? 'DCT', r.sid ? '' : '']);
        const sid = r.sid ? v.f.db.airport(r.from)?.sids.find((s) => s.ident === r.sid) : undefined;
        const sidEnd = sid ? [...sid.legs].reverse().find((l) => l.fix)?.fix ?? '' : '';
        rows[0][1] = sidEnd;
        for (const e of r.route) rows.push([e.via, e.to]);
        if (r.star) rows.push([r.star, `${r.approach ?? ''}`]);
        rows.slice(0, 4).forEach(([a, b], i) => {
          datL(v, i + 2, ` ${a}`, 'g');
          datAt(v, i + 2, 12, b, 'g');
        });
        v.on('R6', () => {
          v.f.loadCoRoute(r.ident);
          m.show(PAGES.INIT_A);
          return KEEP;
        });
        datR(v, 6, 'INSERT*', 'a');
      }
      datL(v, 6, '<RETURN');
      v.on('L6', () => { m.show(PAGES.INIT_A); return KEEP; });
    },
    next() { idx = (idx + 1) % Math.max(1, m.fmgs.db.coRoutesFor(from, to).length); },
    prev() { const n = Math.max(1, m.fmgs.db.coRoutesFor(from, to).length); idx = (idx + n - 1) % n; },
  });
}

/* ======================================================================== WIND (climb wind, not used by predictions) */

function windPage(m: Mcdu): Page {
  return {
    id: 'WIND',
    draw(v) {
      title(v, 'CLIMB WIND');
      lblL(v, 1, 'TRU WIND/ALT');
      for (let i = 1; i <= 5; i++) datL(v, i, '[ ]°/[ ]/[   ]', 'c');
      datR(v, 1, 'HISTORY>', 'w');
      datR(v, 5, 'NEXT PHASE>', 'w');
      datL(v, 6, '<RETURN');
      v.on('L6', () => { m.show(PAGES.INIT_A); return KEEP; });
    },
  };
}

/* ======================================================================== INIT B */

export function initBPage(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'INIT_B',
    draw(v) {
      title(v, 'INIT');
      v.arrows({ lr: true });
      const fp = f.fuelPred();

      // TAXI
      lblL(v, 1, 'TAXI');
      datL(v, 1, t1(f.taxi), 'c', !f.taxiPilot);
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.taxi = 200; f.taxiPilot = false; f.markDirty(); return; }
        return apply(parseWeight(sp, 0, 9.9), (w) => { f.taxi = w; f.taxiPilot = true; f.markDirty(); });
      });

      // ZFW / ZFWCG
      lblR(v, 1, 'ZFW/ZFWCG');
      const zfw = f.zfw !== undefined ? t1(f.zfw) : `${box(3)}.${box(1)}`;
      const cg = f.zfwcg !== undefined ? f.zfwcg.toFixed(1) : `${box(2)}.${box(1)}`;
      v.s.right(2, `{${f.zfw !== undefined ? 'c' : 'a'}}${zfw}{w}/{${f.zfwcg !== undefined ? 'c' : 'a'}}${cg}`, 'c', false);
      v.on('R1', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        const [a, b] = sp.split('/');
        if (sp.split('/').length > 2) return MSG.FORMAT_ERROR;
        let w: number | undefined, c: number | undefined;
        if (a) { const r = parseWeight(a, 35, 80); if (isMsg(r)) return r; w = r; }
        if (b !== undefined && b !== '') { const r = parseCg(b); if (isMsg(r)) return r; c = r; }
        if (w === undefined && c === undefined) return MSG.FORMAT_ERROR;
        if (w !== undefined) f.zfw = w;
        if (c !== undefined) f.zfwcg = c;
        f.markDirty();
      });

      // TRIP / TIME
      lblL(v, 2, 'TRIP');
      lblAt(v, 2, 4, '/TIME');
      if (fp) datL(v, 2, `${t1(fp.trip)}/${hhmm(fp.tripTime)}`, 'g', true);
      else datL(v, 2, '---.-/----');

      // BLOCK
      lblR(v, 2, 'BLOCK');
      if (f.block !== undefined) datR(v, 2, t1(f.block), 'c');
      else datR(v, 2, `${box(2)}.${box(1)}`, 'a');
      v.on('R2', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        return apply(parseWeight(sp, 0, 19.9), (w) => { f.block = w; f.fuelPlanning = 'idle'; f.markDirty(); });
      });

      // FUEL PLANNING
      if (f.zfw !== undefined && f.zfwcg !== undefined && f.block === undefined) {
        lblR(v, 3, 'FUEL ');
        datR(v, 3, f.fuelPlanning === 'computing' ? 'PLANNING ' : 'PLANNING→', 'a');
        v.on('R3', () => {
          if (!f.active?.dest || !f.crzFl) return MSG.NOT_ALLOWED;
          f.startFuelPlanning();
          return KEEP;
        });
      }

      // RTE RSV / %
      lblL(v, 3, 'RTE RSV/%');
      if (fp) datL(v, 3, `{c}${t1(fp.rsv)}{w}/{c}${fp.rsvPct.toFixed(1)}`, 'c', true);
      else v.s.left(6, `{w}---.-/{c}{s}${f.rsvPct.toFixed(1)}`, 'w', false);
      v.on('L3', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.rsvKgPilot = undefined; f.rsvPct = 5; f.markDirty(); return; }
        const [a, b] = sp.split('/');
        if (a) {
          const r = parseWeight(a, 0, 9.9);
          if (isMsg(r)) return r;
          f.rsvKgPilot = r;
        }
        if (b !== undefined && b !== '') {
          if (!/^\d{1,2}(\.\d)?$/.test(b)) return MSG.FORMAT_ERROR;
          if (+b > 15) return MSG.ENTRY_OUT_OF_RANGE;
          f.rsvPct = +b;
          f.rsvKgPilot = undefined;
        }
        f.markDirty();
      });

      // ALTN / TIME
      lblL(v, 4, 'ALTN');
      lblAt(v, 4, 4, '/TIME');
      if (fp && f.active?.altn) datL(v, 4, `{c}${t1(fp.altn)}{w}/{g}${hhmm(fp.altnTime)}`, 'c', true);
      else datL(v, 4, '---.-/----');
      v.on('L4', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.altnKgPilot = undefined; f.markDirty(); return; }
        return apply(parseWeight(sp, 0, 9.9), (w) => { f.altnKgPilot = w; f.markDirty(); });
      });

      // TOW / LW
      lblAt(v, 4, 15, 'TOW/   LW');
      if (fp) datR(v, 4, `${t1(fp.tow)}/${t1(fp.lw)}`, 'g', true);
      else datR(v, 4, '---.-/---.-');

      // FINAL / TIME
      lblL(v, 5, 'FINAL/TIME');
      if (fp) datL(v, 5, `{c}${t1(fp.final)}{w}/{c}${hhmm(f.finalTime)}`, 'c', true);
      else v.s.left(10, `{w}---.-/{c}{s}${hhmm(f.finalTime)}`, 'w', false);
      v.on('L5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.finalKgPilot = undefined; f.finalTime = 30; f.markDirty(); return; }
        const [a, b] = sp.split('/');
        if (a) { const r = parseWeight(a, 0, 9.9); if (isMsg(r)) return r; f.finalKgPilot = r; }
        if (b !== undefined && b !== '') {
          if (!/^\d{1,4}$/.test(b)) return MSG.FORMAT_ERROR;
          const t = b.length > 2 ? Math.floor(+b / 100) * 60 + (+b % 100) : +b;
          if (t > 90) return MSG.ENTRY_OUT_OF_RANGE;
          f.finalTime = t;
          f.finalKgPilot = undefined;
        }
        f.markDirty();
      });

      // TRIP WIND
      lblAt(v, 5, 15, 'TRIP WIND');
      datR(v, 5, fmtTripWind(f.tripWind), 'c', !f.tripWindPilot);
      v.on('R5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.tripWind = 0; f.tripWindPilot = false; f.markDirty(); return; }
        return apply(parseTripWind(sp), (w) => { f.tripWind = w; f.tripWindPilot = true; f.markDirty(); });
      });

      // MIN DEST FOB
      lblL(v, 6, 'MIN DEST FOB');
      const minFob = f.minDestFobPilot ?? fp?.minDestFob;
      if (minFob !== undefined) datL(v, 6, t1(minFob), 'c', f.minDestFobPilot === undefined);
      else datL(v, 6, '---.-');
      v.on('L6', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.minDestFobPilot = undefined; return; }
        return apply(parseWeight(sp, 0, 80), (w) => { f.minDestFobPilot = w; });
      });

      // EXTRA / TIME
      lblAt(v, 6, 14, 'EXTRA/TIME');
      if (fp) datR(v, 6, `${t1(fp.extra)}/${hhmm(fp.extraTime)}`, 'g', true);
      else datR(v, 6, '---.-/----');
    },
    next() { m.show(PAGES.INIT_A); },
    prev() { m.show(PAGES.INIT_A); },
  };
}

/** True when the flight plan has at least one leg between origin and destination (used by pages). */
export function planHasRoute(m: Mcdu): boolean {
  return (m.fmgs.active?.items.filter(isLeg).length ?? 0) > 2;
}
