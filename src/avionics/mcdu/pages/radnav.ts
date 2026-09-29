/**
 * RADIO NAV page: VOR1/2 (+CRS), ILS (+CRS), ADF1/2. Autotuned values are small, manual entries large.
 * CLR on a manually tuned navaid returns it to autotuning.
 */
import { CLR, type Mcdu, type Page } from '../mcdu/mcdu';
import { MSG, isMsg, parseAdfFreq, parseCourse, parseIlsFreq, parseVorFreq, type McduMessage } from '../mcdu/format';
import type { Fmgs, Tuned } from '../fmgs/fmgs';
import type { DbNavaid } from '../navdb/types';
import { datL, datR, lblL, lblR, title } from './common';

function tune(f: Fmgs, sp: string, kind: 'VOR' | 'ILS' | 'ADF'): Tuned | McduMessage {
  const types: DbNavaid['type'][] = kind === 'VOR' ? ['VOR', 'VORDME', 'DME'] : kind === 'ILS' ? ['ILS'] : ['NDB'];
  const pos = f.position();
  if (/^[A-Z]{1,4}$/.test(sp)) {
    const n = f.db.navaids
      .filter((x) => x.ident === sp && types.includes(x.type))
      .sort((a, b) => Math.hypot(a.lat - pos.lat, a.lon - pos.lon) - Math.hypot(b.lat - pos.lat, b.lon - pos.lon))[0];
    if (!n) return MSG.NOT_IN_DATABASE;
    return { ident: n.ident, freq: n.freq, navaid: n, manual: true };
  }
  const fr = kind === 'VOR' ? parseVorFreq(sp) : kind === 'ILS' ? parseIlsFreq(sp) : parseAdfFreq(sp);
  if (fr === null) return MSG.FORMAT_ERROR;
  if (isMsg(fr)) return fr;
  const n = f.db.navaidsByFreq(fr, types, pos)[0];
  return { ident: n?.ident, freq: fr, navaid: n, manual: true };
}

const fmtF = (t: Tuned, kind: 'VOR' | 'ILS' | 'ADF') => (kind === 'ADF' ? t.freq.toFixed(1) : t.freq.toFixed(2));

export function radNavPage(_m: Mcdu): Page {
  return {
    id: 'RADNAV',
    draw(v) {
      const f = v.f;
      title(v, 'RADIO NAV');
      // VOR1
      lblL(v, 1, 'VOR1/FREQ');
      const v1 = f.vor1();
      if (v1) datL(v, 1, `${(v1.ident ?? '').padEnd(3)}/${fmtF(v1, 'VOR')}`, 'c', !v1.manual);
      else datL(v, 1, '[ ]/[  .  ]', 'c');
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (!f.vor1Man) return MSG.NOT_ALLOWED; f.vor1Man = undefined; f.vor1Crs = undefined; return; }
        const r = tune(f, sp.replace(/^\//, ''), 'VOR');
        if (isMsg(r)) return r;
        f.vor1Man = r;
      });
      // VOR2
      lblR(v, 1, 'FREQ/VOR2');
      const v2 = f.vor2();
      if (v2) datR(v, 1, `${fmtF(v2, 'VOR')}/${(v2.ident ?? '').padStart(3)}`, 'c', !v2.manual);
      else datR(v, 1, '[  .  ]/[ ]', 'c');
      v.on('R1', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (!f.vor2Man) return MSG.NOT_ALLOWED; f.vor2Man = undefined; f.vor2Crs = undefined; return; }
        const r = tune(f, sp.replace(/\/$/, ''), 'VOR');
        if (isMsg(r)) return r;
        f.vor2Man = r;
      });
      // courses
      lblL(v, 2, 'CRS');
      datL(v, 2, f.vor1Crs !== undefined ? String(f.vor1Crs).padStart(3, '0') : '[ ]', 'c');
      v.on('L2', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.vor1Crs = undefined; return; }
        if (!f.vor1()) return MSG.NOT_ALLOWED;
        const r = parseCourse(sp);
        if (isMsg(r)) return r;
        f.vor1Crs = r;
      });
      lblR(v, 2, 'CRS');
      datR(v, 2, f.vor2Crs !== undefined ? String(f.vor2Crs).padStart(3, '0') : '[ ]', 'c');
      v.on('R2', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.vor2Crs = undefined; return; }
        if (!f.vor2()) return MSG.NOT_ALLOWED;
        const r = parseCourse(sp);
        if (isMsg(r)) return r;
        f.vor2Crs = r;
      });
      // ILS
      lblL(v, 3, 'ILS /FREQ');
      const ils = f.ils();
      if (ils) datL(v, 3, `${(ils.ident ?? '').padEnd(3)}/${fmtF(ils, 'ILS')}`, 'c', !ils.manual);
      else datL(v, 3, '[  ]/[  .  ]', 'c');
      v.on('L3', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (!f.ilsMan) return MSG.NOT_ALLOWED; f.ilsMan = undefined; f.ilsCrsMan = undefined; return; }
        const r = tune(f, sp.replace(/^\//, ''), 'ILS');
        if (isMsg(r)) return r;
        f.ilsMan = r;
        f.ilsCrsMan = undefined;
      });
      lblL(v, 4, 'CRS');
      const ic = f.ilsCourse();
      if (ic !== undefined) datL(v, 4, String(Math.round(ic)).padStart(3, '0'), 'c', f.ilsCrsMan === undefined);
      else datL(v, 4, '[ ]', 'c');
      v.on('L4', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (f.ilsCrsMan === undefined) return MSG.NOT_ALLOWED; f.ilsCrsMan = undefined; return; }
        if (!f.ils()) return MSG.NOT_ALLOWED;
        const r = parseCourse(sp.replace(/^[FB]/, ''));
        if (isMsg(r)) return r;
        f.ilsCrsMan = r;
      });
      // ADF
      lblL(v, 5, 'ADF1/FREQ');
      const a1 = f.adf1Man;
      if (a1) datL(v, 5, `${(a1.ident ?? '').padEnd(3)}/${fmtF(a1, 'ADF')}`, 'c');
      else datL(v, 5, '[ ]/[   .]', 'c');
      v.on('L5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (!f.adf1Man) return MSG.NOT_ALLOWED; f.adf1Man = undefined; return; }
        const r = tune(f, sp.replace(/^\//, ''), 'ADF');
        if (isMsg(r)) return r;
        f.adf1Man = r;
      });
      lblR(v, 5, 'FREQ/ADF2');
      const a2 = f.adf2Man;
      if (a2) datR(v, 5, `${fmtF(a2, 'ADF')}/${(a2.ident ?? '').padStart(3)}`, 'c');
      else datR(v, 5, '[   .]/[ ]', 'c');
      v.on('R5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { if (!f.adf2Man) return MSG.NOT_ALLOWED; f.adf2Man = undefined; return; }
        const r = tune(f, sp.replace(/\/$/, ''), 'ADF');
        if (isMsg(r)) return r;
        f.adf2Man = r;
      });
    },
  };
}
