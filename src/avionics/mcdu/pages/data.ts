/**
 * DATA INDEX 1/2 and its pages (POSITION / IRS / GPS MONITOR, WAYPOINT, NAVAID, RUNWAY, ROUTE),
 * SEC INDEX.
 */
import { CLR, KEEP, PAGES, type Mcdu, type Page, type View } from '../mcdu/mcdu';
import { MSG, fmtLat, fmtLon } from '../mcdu/format';
import { toMag } from '../navdb/navdb';
import { datL, datR, lblL, lblR, title } from './common';
import { fplnPage } from './fpln';

export function dataIndexPage(m: Mcdu): Page {
  let page2 = false;
  return {
    id: 'DATA_INDEX',
    draw(v) {
      title(v, 'DATA INDEX');
      v.s.right(0, `${page2 ? 2 : 1}/2  `, 'w', true);
      v.arrows({ lr: true });
      if (!page2) {
        lblL(v, 1, ' POSITION');
        datL(v, 1, '<MONITOR');
        v.on('L1', () => { m.show(positionMonitorPage); return KEEP; });
        lblL(v, 2, ' IRS');
        datL(v, 2, '<MONITOR');
        v.on('L2', () => { m.show(irsMonitorPage); return KEEP; });
        lblL(v, 3, ' GPS');
        datL(v, 3, '<MONITOR');
        v.on('L3', () => { m.show(gpsMonitorPage); return KEEP; });
        datL(v, 4, '<A/C STATUS');
        v.on('L4', () => { m.show(PAGES.STATUS); return KEEP; });
        lblL(v, 5, ' CLOSEST');
        datL(v, 5, '<AIRPORTS');
        v.on('L5', () => { m.show(closestAirportsPage); return KEEP; });
      } else {
        datL(v, 1, '<WAYPOINTS');
        datL(v, 2, '<NAVAIDS');
        datL(v, 3, '<RUNWAYS');
        datL(v, 4, '<ROUTES');
        v.on('L1', () => { m.show(lookupPage('WAYPOINT')); return KEEP; });
        v.on('L2', () => { m.show(lookupPage('NAVAID')); return KEEP; });
        v.on('L3', () => { m.show(lookupPage('RUNWAY')); return KEEP; });
        v.on('L4', () => { m.show(lookupPage('ROUTE')); return KEEP; });
        lblR(v, 1, 'PILOTS ');
        datR(v, 1, 'WAYPOINTS>');
        datR(v, 2, 'NAVAIDS>');
        datR(v, 3, 'RUNWAYS>');
        datR(v, 4, 'ROUTES>');
        lblR(v, 5, 'ACTIVE F-PLN ');
        datR(v, 5, 'WINDS>');
        lblR(v, 6, 'SEC F-PLN ');
        datR(v, 6, 'WINDS>');
      }
    },
    next() { page2 = !page2; },
    prev() { page2 = !page2; },
  };
}

const back = (v: View, m: Mcdu) => {
  datL(v, 6, '<RETURN');
  v.on('L6', () => { m.show(PAGES.DATA); return KEEP; });
};

function irsState(v: View, n: number): string {
  const st = v.f.sim.get(`S:ADIRS_IR${n}_STATE`);
  if (v.f.sim.getB(`S:ADIRS_IR${n}_ALIGNED`) || st === 2) return 'NAV';
  if (st === 1) {
    const r = v.f.sim.get(`S:ADIRS_IR${n}_ALIGN_REMAIN`);
    return `ALIGN TTN ${Math.max(1, Math.ceil(r / 60))}`;
  }
  if (st === 3) return 'ATT';
  if (st === 4) return 'FAULT';
  return 'OFF';
}

function positionMonitorPage(m: Mcdu): Page {
  return {
    id: 'POSITION_MONITOR',
    draw(v) {
      const f = v.f;
      title(v, 'POSITION MONITOR');
      const ok = f.positionValid();
      const pos = f.position();
      const ll = ok ? `${fmtLat(pos.lat)}/${fmtLon(pos.lon)}` : '----.-/-----.-';
      datL(v, 1, 'FMGC1');
      datR(v, 1, ll, ok ? 'g' : 'w', true);
      lblL(v, 2, '    3IRS/GPS');
      datL(v, 2, 'FMGC2');
      datR(v, 2, ll, ok ? 'g' : 'w', true);
      datL(v, 3, 'GPIRS');
      datR(v, 3, ll, ok ? 'g' : 'w', true);
      datL(v, 4, 'MIX IRS');
      datR(v, 4, ll, ok ? 'g' : 'w', true);
      v.s.text(9, 0, '  IRS1', 'w', true);
      v.s.text(9, 9, 'IRS2', 'w', true);
      v.s.text(9, 17, 'IRS3', 'w', true);
      const st = [1, 2, 3].map((n) => irsState(v, n).replace('ALIGN TTN ', 'ALN'));
      v.s.text(10, 1, st[0], 'g', true);
      v.s.text(10, 9, st[1], 'g', true);
      v.s.text(10, 17, st[2], 'g', true);
      datL(v, 6, '<FREEZE');
      lblR(v, 6, 'SEL ');
      datR(v, 6, 'NAVAIDS>');
    },
  };
}

function irsMonitorPage(m: Mcdu): Page {
  return {
    id: 'IRS_MONITOR',
    draw(v) {
      title(v, 'IRS MONITOR');
      for (const n of [1, 2, 3]) {
        lblL(v, n, ` ${irsState(v, n)}`, 'g');
        datL(v, n, `<IRS${n}`);
        v.on((['L1', 'L2', 'L3'] as const)[n - 1], () => { m.show(irsPage(n)); return KEEP; });
      }
      back(v, m);
    },
  };
}

function irsPage(n: number) {
  return (m: Mcdu): Page => ({
    id: `IRS${n}`,
    draw(v) {
      const s = v.f.sim;
      const st = irsState(v, n);
      title(v, `IRS${n} {s}(${st.startsWith('ALIGN') ? 'ALIGN' : st}){l}`);
      const nav = st === 'NAV';
      lblL(v, 1, 'POSITION');
      const pos = v.f.position();
      datL(v, 1, nav ? `${fmtLat(pos.lat)}/${fmtLon(pos.lon)}` : '----.--/-----.--', nav ? 'g' : 'w');
      lblL(v, 2, 'TTRK');
      lblR(v, 2, 'GS');
      datL(v, 2, nav ? `${String(Math.round(s.get('S:ADIRS_TRK_MAG') || s.get('S:ADIRS_HDG_TRUE'))).padStart(3, '0')}°` : '---°', nav ? 'g' : 'w');
      datR(v, 2, nav ? String(Math.round(s.get('S:ADIRS_GS'))) : '---', nav ? 'g' : 'w');
      lblL(v, 3, 'THDG');
      lblR(v, 3, 'WIND');
      datL(v, 3, nav ? `${String(Math.round(s.get('S:ADIRS_HDG_TRUE'))).padStart(3, '0')}°` : '---°', nav ? 'g' : 'w');
      datR(v, 3, '---°/---', 'w');
      lblL(v, 4, 'MHDG');
      lblR(v, 4, 'GPIRS ACCUR');
      datL(v, 4, nav ? `${String(Math.round(s.get('S:ADIRS_HDG_MAG'))).padStart(3, '0')}°` : '---°', nav ? 'g' : 'w');
      datR(v, 4, nav ? '0.05NM' : '-.--NM', nav ? 'g' : 'w');
      datL(v, 6, '<RETURN');
      v.on('L6', () => { m.show(irsMonitorPage); return KEEP; });
    },
  });
}

function gpsMonitorPage(_m: Mcdu): Page {
  return {
    id: 'GPS_MONITOR',
    draw(v) {
      const f = v.f;
      title(v, 'GPS MONITOR');
      // GPS receivers are powered with the ADIRUs (GPIRS): available as soon as an ADIRU is on.
      const on = [1, 2, 3].some((n) => f.sim.get(`S:ADIRS_IR${n}_STATE`) > 0) || f.positionValid();
      const lat = f.sim.get('G:AC_LAT'), lon = f.sim.get('G:AC_LON');
      const utc = f.sim.get('G:TIME_UTC');
      const p2 = (x: number) => String(Math.floor(x)).padStart(2, '0');
      const t = `${p2((utc / 3600) % 24)}:${p2((utc / 60) % 60)}:${p2(utc % 60)}`;
      const alt = String(Math.round(f.sim.get('G:ENV_ELEV_FT') || 162)).padStart(5);
      const gs = String(Math.round(f.sim.get('G:AC_GS_KT'))).padStart(3);
      const trk = (f.sim.get('G:AC_HDG_TRUE') || 0).toFixed(1).padStart(5, '0');
      for (const n of [0, 1]) {
        const r = n * 6;
        v.s.text(r + 1, 0, `GPS${n + 1} POSITION`, 'w', true);
        v.s.text(r + 2, 0, on ? `${fmtLat(lat, 2)}/${fmtLon(lon, 2)}` : '----.--/-----.--', on ? 'g' : 'w', false);
        v.s.text(r + 3, 0, ' TTRK     UTC    GPS ALT', 'w', true);
        v.s.text(r + 4, 0, on ? ` ${trk}  ${t} ${alt}` : ' ---.-  --:--:-- -----', on ? 'g' : 'w', false);
        v.s.text(r + 5, 0, ' MERIT   MODE/SAT    GS', 'w', true);
        v.s.text(r + 6, 0, on ? `  50FT    NAV/${n ? 8 : 9}      ${gs}` : '  ---    ---/-      ---', on ? 'g' : 'w', false);
      }
    },
  };
}

function closestAirportsPage(m: Mcdu): Page {
  return {
    id: 'CLOSEST_AIRPORTS',
    draw(v) {
      const f = v.f;
      title(v, 'CLOSEST AIRPORTS');
      lblR(v, 1, 'BRG    DIST   UTC ');
      const pos = f.position();
      const list = [...f.db.airports.values()]
        .map((a) => ({ a, ...f.bearingDistTo(a.lat, a.lon) }))
        .sort((x, y) => x.dist - y.dist)
        .slice(0, 4);
      list.forEach((e, i) => {
        datL(v, i + 1, e.a.icao, 'g');
        v.s.text(2 + i * 2, 8, `${String(Math.round(e.brg) % 360 || 360).padStart(3, '0')}°  ${String(Math.round(e.dist)).padStart(4)}   ----`, 'g', false);
      });
      void pos;
      back(v, m);
    },
  };
}

/** WAYPOINT / NAVAID / RUNWAY / ROUTE data base look-up pages. */
function lookupPage(kind: 'WAYPOINT' | 'NAVAID' | 'RUNWAY' | 'ROUTE') {
  let ident: string | undefined;
  return (m: Mcdu): Page => ({
    id: kind,
    draw(v) {
      const f = v.f;
      title(v, kind);
      lblL(v, 1, kind === 'ROUTE' ? ' CO RTE' : ' IDENT');
      datL(v, 1, ident ?? (kind === 'ROUTE' ? '[         ]' : kind === 'RUNWAY' ? '[      ]' : '[     ]'), ident ? 'g' : 'c');
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) { ident = undefined; return; }
        if (!/^[A-Z0-9]{1,10}$/.test(sp)) return MSG.FORMAT_ERROR;
        const ok = kind === 'WAYPOINT' ? f.db.lookup(sp).some((x) => x.kind === 'wpt')
          : kind === 'NAVAID' ? !!f.db.navaid(sp)
            : kind === 'RUNWAY' ? !!(f.db.airport(sp.slice(0, 4)) && f.db.runway(f.db.airport(sp.slice(0, 4))!, sp.slice(4)))
              : !!f.db.coRoute(sp);
        if (!ok) return MSG.NOT_IN_DATABASE;
        ident = sp;
      });
      if (ident) {
        const ref = f.position();
        if (kind === 'WAYPOINT') {
          const w = f.db.lookup(ident).find((x) => x.kind === 'wpt')!;
          lblL(v, 2, '     LAT/LONG');
          datL(v, 2, `${fmtLat(w.lat)}/${fmtLon(w.lon)}`, 'g');
        } else if (kind === 'NAVAID') {
          const n = f.db.navaid(ident, ref)!;
          lblL(v, 2, ' FREQ');
          datL(v, 2, n.type === 'NDB' ? n.freq.toFixed(1) : n.freq.toFixed(2), 'g');
          lblL(v, 3, '     LAT/LONG');
          datL(v, 3, `${fmtLat(n.lat)}/${fmtLon(n.lon)}`, 'g');
          lblL(v, 4, ' CLASS');
          datL(v, 4, { VOR: 'VOR', VORDME: 'VOR DME', DME: 'DME', NDB: 'NDB', ILS: 'ILS/DME' }[n.type], 'g');
          if (n.name) { lblL(v, 5, ' NAME'); datL(v, 5, n.name.slice(0, 24), 'g', true); }
          if (n.type === 'ILS') {
            lblR(v, 4, 'COURSE ');
            datR(v, 4, `${String(n.course ?? 0).padStart(3, '0')}°`, 'g');
            lblR(v, 5, 'RWY ');
            datR(v, 5, n.runway ?? '', 'g');
          }
        } else if (kind === 'RUNWAY') {
          const ap = f.db.airport(ident.slice(0, 4))!;
          const r = f.db.runway(ap, ident.slice(4))!;
          lblL(v, 2, '     LAT/LONG');
          datL(v, 2, `${fmtLat(r.startLat ?? r.lat)}/${fmtLon(r.startLon ?? r.lon)}`, 'g');
          lblL(v, 3, ' LENGTH');
          datL(v, 3, `${r.lengthM}M`, 'g');
          lblR(v, 3, 'CRS ');
          datR(v, 3, `${String(r.magCrs).padStart(3, '0')}°`, 'g');
          lblL(v, 4, ' ELV');
          datL(v, 4, `${r.elevFt}FT`, 'g');
          const ils = f.db.ilsForRunway(ap, r);
          if (ils) { lblR(v, 4, 'LS IDENT '); datR(v, 4, `${ils.ident}/${ils.freq.toFixed(2)}`, 'g'); }
        } else {
          const r = f.db.coRoute(ident)!;
          lblL(v, 2, ' FROM/TO');
          datL(v, 2, `${r.from}/${r.to}`, 'g');
          lblR(v, 2, 'CI/CRZ FL ');
          datR(v, 2, `${r.costIndex ?? '---'}/FL${r.crzFl ?? '---'}`, 'g');
          const parts = [r.depRwy ? `${r.from}/${r.depRwy}` : r.from, r.sid ?? '', ...r.route.map((e) => `${e.via} ${e.to}`), r.star ?? '', r.approach ?? '', r.to].filter(Boolean);
          const text = parts.join(' ');
          for (let i = 0; i < 3; i++) datL(v, i + 3, text.slice(i * 24, i * 24 + 24), 'g', true);
        }
      }
      back(v, m);
      void toMag;
    },
  });
}

/* ======================================================================== SEC INDEX */

export function secIndexPage(m: Mcdu): Page {
  return {
    id: 'SEC_INDEX',
    fmgc: true,
    draw(v) {
      const f = v.f;
      title(v, 'SEC INDEX');
      datL(v, 1, '<COPY ACTIVE');
      v.on('L1', () => {
        if (!f.active) return MSG.NOT_ALLOWED;
        f.sec = f.active.clone();
        return KEEP;
      });
      if (f.sec) {
        datL(v, 2, '<SEC F-PLN');
        v.on('L2', () => { m.show((mm) => fplnPage(mm, false, true)); return KEEP; });
        datL(v, 3, '<DELETE SEC');
        v.on('L3', () => { f.sec = undefined; return KEEP; });
        datR(v, 4, 'ACTIVATE SEC*', 'a');
        v.on('R4', () => {
          if (f.flightPhase >= 1 && f.flightPhase < 7) return MSG.NOT_ALLOWED;
          f.active = f.sec!.clone();
          f.tmpy = undefined;
          f.markDirty();
          return KEEP;
        });
      }
      datR(v, 1, 'INIT>');
      v.on('R1', () => { m.show(PAGES.INIT); return KEEP; });
      datR(v, 2, 'PERF>');
      v.on('R2', () => { m.show(PAGES.PERF); return KEEP; });
    },
  };
}
