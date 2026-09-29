/**
 * FUEL PRED, PROG (+ REPORT, PREDICTIVE GPS) pages.
 */
import { CLR, KEEP, PAGES, type Mcdu, type Page } from '../mcdu/mcdu';
import { MSG, box, hhmm, isMsg, parseCg, parseWeight, t1 } from '../mcdu/format';
import { optFl, recMaxFl } from '../fmgs/perf';
import { isLeg } from '../fmgs/flightplan';
import { datL, datR, lblL, lblR, title } from './common';

/* ======================================================================== FUEL PRED */

export function fuelPredPage(_m: Mcdu): Page {
  return {
    id: 'FUEL_PRED',
    draw(v) {
      const f = v.f;
      title(v, 'FUEL PRED');
      const fp = f.fuelPred();
      const p = f.active;
      v.s.text(1, 1, 'AT', 'w', true);
      v.s.text(1, 9, 'UTC', 'w', true);
      v.s.text(1, 15, 'EFOB', 'w', true);
      if (p?.dest) {
        datL(v, 1, p.dest.icao, 'g');
        v.s.text(2, 9, fp ? hhmm(fp.tripTime) : '----', fp ? 'g' : 'w', !!fp);
        v.s.text(2, 14, fp ? t1(fp.destEfob).padStart(5) : '---.-', fp ? 'g' : 'w', !!fp);
      }
      if (p?.altn) {
        datL(v, 2, p.altn.icao, 'g');
        v.s.text(4, 9, fp ? hhmm(fp.tripTime + fp.altnTime) : '----', fp ? 'g' : 'w', !!fp);
        v.s.text(4, 14, fp ? t1(fp.destEfob - fp.altn).padStart(5) : '---.-', fp ? 'g' : 'w', !!fp);
      }
      lblL(v, 3, 'RTE RSV/%');
      datL(v, 3, fp ? `{c}${t1(fp.rsv)}{w}/{c}${fp.rsvPct.toFixed(1)}` : `---.-/{c}${f.rsvPct.toFixed(1)}`, fp ? 'c' : 'w', true);
      lblR(v, 3, 'ZFW/ZFWCG');
      const zc = f.zfw !== undefined && f.zfwcg !== undefined;
      datR(v, 3, zc ? `${t1(f.zfw!)}/${f.zfwcg!.toFixed(1)}` : `${box(3)}.${box(1)}/${box(2)}.${box(1)}`, zc ? 'c' : 'a');
      v.on('R3', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        const [a, b] = sp.split('/');
        if (a) { const r = parseWeight(a, 35, 80); if (isMsg(r)) return r; f.zfw = r; }
        if (b) { const r = parseCg(b); if (isMsg(r)) return r; f.zfwcg = r; }
        f.markDirty();
      });
      lblL(v, 4, 'ALTN /TIME');
      datL(v, 4, fp && p?.altn ? `{c}${t1(fp.altn)}{w}/{g}${hhmm(fp.altnTime)}` : '---.-/----', fp ? 'c' : 'w', !!fp);
      lblR(v, 4, 'FOB     ');
      const fob = f.fob();
      datR(v, 4, fob !== undefined ? `${t1(fob)}   {w}{s}${f.enginesRunning() ? 'FF+FQ' : '     '}` : '---.-', fob !== undefined ? 'g' : 'w', true);
      lblL(v, 5, 'FINAL/TIME');
      datL(v, 5, fp ? `{c}${t1(fp.final)}{w}/{c}${hhmm(f.finalTime)}` : `---.-/{c}${hhmm(f.finalTime)}`, fp ? 'c' : 'w', true);
      lblR(v, 5, 'GW/   CG');
      const gw = f.gw(), cg = f.cg();
      datR(v, 5, gw !== undefined && cg !== undefined ? `${t1(gw)}/${cg.toFixed(1)}` : '---.-/--.-', gw ? 'g' : 'w', !!gw);
      lblL(v, 6, 'MIN DEST FOB');
      const mf = f.minDestFobPilot ?? fp?.minDestFob;
      datL(v, 6, mf !== undefined ? t1(mf) : '---.-', 'c', f.minDestFobPilot === undefined);
      lblR(v, 6, 'EXTRA/TIME');
      datR(v, 6, fp ? `${t1(fp.extra)}/${hhmm(fp.extraTime)}` : '---.-/----', fp ? 'g' : 'w', !!fp);
    },
  };
}

/* ======================================================================== PROG */

const PHASE_NAMES = ['TO', 'TO', 'CLB', 'CRZ', 'DES', 'APPR', 'GA', ''];

export function progPage(m: Mcdu): Page {
  let bdTo: string | undefined;
  return {
    id: 'PROG',
    draw(v) {
      const f = v.f;
      const ph = PHASE_NAMES[f.flightPhase] ?? '';
      v.s.text(0, 11 - ph.length + 1, ph, 'g', false);
      if (f.flightNo) v.s.text(0, 13, f.flightNo, 'w', false);
      lblL(v, 1, ' CRZ');
      lblR(v, 1, 'OPT    REC MAX ');
      datL(v, 1, f.crzFl ? `FL${String(f.crzFl).padStart(3, '0')}` : '-----', 'c');
      const gw = f.gw();
      if (gw && f.zfwcg !== undefined) {
        const rm = recMaxFl(gw);
        v.s.text(2, 12, `FL${Math.floor(optFl(gw) / 5) * 5}`, 'g', false);
        v.s.text(2, 18, `FL${rm}`, 'm', false);
      } else {
        v.s.text(2, 12, '-----', 'w', false);
        v.s.text(2, 18, '-----', 'w', false);
      }
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) return MSG.NOT_ALLOWED;
        const r = /^(?:FL)?(\d{1,3})$/.exec(sp);
        if (!r) return MSG.FORMAT_ERROR;
        if (+r[1] < 10 || +r[1] > 398) return MSG.ENTRY_OUT_OF_RANGE;
        f.crzFl = +r[1];
        f.markDirty();
      });
      datL(v, 2, '<REPORT');
      v.on('L2', () => { m.show(reportPage); return KEEP; });
      const gpsPrimary = f.positionValid();
      if (!gpsPrimary) {
        lblL(v, 3, ' POSITION UPDATE AT');
        datL(v, 3, '{s}*{l}[    ]', 'c');
      }
      lblL(v, 4, '  BRG / DIST');
      const fix = bdTo ? f.db.fix(bdTo, f.position()) : undefined;
      if (fix && gpsPrimary) {
        const b = f.bearingDistTo(fix.lat, fix.lon);
        datL(v, 4, ` ${String(Math.round(b.brg) % 360 || 360).padStart(3, '0')}° /${b.dist.toFixed(1).padStart(5)}`, 'g', true);
      } else datL(v, 4, ' ---° /----.-', 'w', true);
      v.s.text(8, 14, 'TO', 'w', true);
      v.s.text(8, 17, bdTo ?? '[     ]', 'c', false);
      v.on('R4', (sp) => {
        if (!sp) return;
        if (sp === CLR) { bdTo = undefined; return; }
        if (!/^[A-Z0-9]{1,7}$/.test(sp)) return MSG.FORMAT_ERROR;
        if (!f.db.lookup(sp).length) return MSG.NOT_IN_DATABASE;
        bdTo = sp;
      });
      lblL(v, 5, ' PREDICTIVE');
      datL(v, 5, '<GPS');
      v.on('L5', () => { m.show(predGpsPage); return KEEP; });
      if (gpsPrimary) datR(v, 5, 'GPS PRIMARY', 'g');
      v.s.text(11, 0, 'REQUIRED', 'w', true);
      v.s.text(11, 9, 'ACCUR', 'w', true);
      v.s.right(11, 'ESTIMATED', 'w', true);
      const req = f.flightPhase >= 5 ? 0.3 : f.flightPhase >= 3 ? 2.0 : 1.0;
      datL(v, 6, `${req.toFixed(1)}NM`, 'c', true);
      v.s.text(12, 9, gpsPrimary ? 'HIGH' : 'LOW', gpsPrimary ? 'g' : 'a', false);
      datR(v, 6, gpsPrimary ? '0.05NM' : '-.--NM', 'g', true);
    },
  };
}

function reportPage(m: Mcdu): Page {
  return {
    id: 'REPORT',
    draw(v) {
      const f = v.f;
      title(v, 'REPORT');
      lblL(v, 1, ' OVHD');
      v.s.text(1, 12, 'ALT', 'w', true);
      v.s.right(1, 'UTC ', 'w', true);
      const p = f.active;
      const to = p?.items[p.activeIndex];
      const next = p?.items.slice((p?.activeIndex ?? 0) + 1).find(isLeg);
      lblL(v, 2, ' TO');
      datL(v, 2, isLeg(to) ? to.ident : '-----', 'g');
      lblL(v, 3, ' NEXT');
      datL(v, 3, next ? next.ident : '-----', 'g');
      lblL(v, 4, ' SAT');
      lblR(v, 4, 'FOB  T. WIND');
      const sat = f.sim.has('S:ADIRS_SAT') ? f.sim.get('S:ADIRS_SAT') : f.sim.get('G:ENV_OAT');
      datL(v, 4, `${sat >= 0 ? '+' : ''}${Math.round(sat)}°`, 'g', true);
      const fob = f.fob();
      datR(v, 4, fob !== undefined ? t1(fob) : '---.-', 'g', true);
      lblL(v, 6, ' DEST');
      datL(v, 6, p?.destLeg()?.ident ?? '-----', 'g');
      datR(v, 6, f.preds ? `${hhmm(f.preds.tripTime)} ${Math.round(f.preds.tripDist)}` : '---- ----', 'g', true);
      v.on('L6', () => { m.show(PAGES.PROG); return KEEP; });
    },
  };
}

function predGpsPage(m: Mcdu): Page {
  return {
    id: 'PRED_GPS',
    draw(v) {
      const f = v.f;
      title(v, 'PREDICTIVE GPS');
      lblL(v, 1, 'DEST');
      lblR(v, 1, 'ETA ');
      datL(v, 1, f.active?.dest?.icao ?? '----', 'g');
      datR(v, 1, f.preds ? hhmm(f.preds.tripTime) : '----', 'c');
      v.s.text(3, 2, '-15 -10 -5 ETA+5 +10 +15', 'w', true);
      v.s.text(4, 4, 'Y   Y   Y   Y  Y   Y   Y', 'g', true);
      lblL(v, 3, 'WPT');
      lblR(v, 3, 'ETA ');
      datL(v, 3, '[ ]', 'c');
      lblR(v, 5, 'DESELECTED SATELLITES');
      datL(v, 5, '[ ]', 'c');
      datL(v, 6, '<RETURN');
      v.on('L6', () => { m.show(PAGES.PROG); return KEEP; });
    },
  };
}
