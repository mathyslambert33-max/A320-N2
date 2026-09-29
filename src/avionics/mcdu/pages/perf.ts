/**
 * PERF pages: TAKE OFF, CLB, CRZ, DES, APPR, GO AROUND.
 */
import { CLR, KEEP, type Mcdu, type Page, type PageFactory, type View } from '../mcdu/mcdu';
import { MSG, box, fmtThs, hhmm, isMsg, parseSpeed, parseTemp, parseThs, parseWind, type McduMessage } from '../mcdu/format';
import type { Fmgs } from '../fmgs/fmgs';
import { charSpeeds, econSpeeds } from '../fmgs/perf';
import { datAt, datL, datR, lblL, lblR } from './common';

/** PERF key: page of the current flight phase. */
export function perfPage(m: Mcdu): Page {
  const ph = m.fmgs.flightPhase;
  const f: PageFactory = ph <= 1 ? perfTo : ph === 2 ? perfClb : ph === 3 ? perfCrz : ph === 4 ? perfDes : ph === 5 ? perfAppr : ph === 6 ? perfGa : perfTo;
  return f(m);
}

function phaseTitle(v: View, text: string, phase: number) {
  v.s.center(0, text, v.f.flightPhase === phase ? 'g' : 'w', false);
}

function prevNext(v: View, m: Mcdu, prev?: PageFactory, next?: PageFactory) {
  if (prev) {
    lblL(v, 6, ' PREV');
    datL(v, 6, '<PHASE');
    v.on('L6', () => { m.show(prev); return KEEP; });
  }
  if (next) {
    lblR(v, 6, 'NEXT ');
    datR(v, 6, 'PHASE>');
    v.on('R6', () => { m.show(next); return KEEP; });
  }
}

/** Altitude entry (ft) with a multiple of 10 feet. */
function parseFt(s: string, min: number, max: number): number | McduMessage {
  if (!/^\d{3,5}$/.test(s)) return MSG.FORMAT_ERROR;
  const v = +s;
  if (v < min || v > max) return MSG.ENTRY_OUT_OF_RANGE;
  return Math.round(v / 10) * 10;
}

/** F / S / O (green dot) speeds: labels at column `lc`, values at column `dc`. */
function fso(v: View, spd: { f: number; s: number; gd: number } | undefined, lc: number, dc: number) {
  v.s.text(1, lc, 'FLP RETR', 'w', true);
  v.s.text(3, lc, 'SLT RETR', 'w', true);
  v.s.text(5, lc + 3, 'CLEAN', 'w', true);
  const fmt = (k: string, x?: number) => `{w}${k}={g}${x !== undefined ? String(x) : '---'}`;
  v.s.text(2, dc, fmt('F', spd?.f), 'w', false);
  v.s.text(4, dc, fmt('S', spd?.s), 'w', false);
  v.s.text(6, dc, fmt('O', spd?.gd), 'w', false);
}

function checkV(f: Fmgs): McduMessage | void {
  const { v1, vr, v2 } = f;
  if ((v1 !== undefined && vr !== undefined && v1 > vr) || (vr !== undefined && v2 !== undefined && vr > v2) || (v1 !== undefined && v2 !== undefined && v1 > v2)) {
    return MSG.V1_VR_V2_DISAGREE;
  }
  f.removeMessage(MSG.V1_VR_V2_DISAGREE);
}

/* ======================================================================== TAKE OFF */

export function perfTo(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_TO',
    draw(v) {
      phaseTitle(v, 'TAKE OFF', 1);
      const ground = f.flightPhase <= 1;
      // V speeds
      const vs: ['v1' | 'vr' | 'v2', string, 'L1' | 'L2' | 'L3'][] = [['v1', 'V1', 'L1'], ['vr', 'VR', 'L2'], ['v2', 'V2', 'L3']];
      vs.forEach(([k, lbl, key], i) => {
        lblL(v, i + 1, lbl);
        const val = f[k];
        if (val !== undefined) datL(v, i + 1, String(val), 'c');
        else datL(v, i + 1, box(3), 'a');
        v.on(key, (sp) => {
          if (!sp) return;
          if (!ground) return MSG.NOT_ALLOWED;
          if (sp === CLR) { f[k] = undefined; return; }
          const r = parseSpeed(sp, 90, 350);
          if (isMsg(r)) return r;
          if (r < 2) return MSG.FORMAT_ERROR;
          f[k] = r;
          f.removeMessage(MSG.CHECK_TAKE_OFF_DATA);
          return checkV(f);
        });
      });
      fso(v, f.toSpeeds(), 5, 5);

      // RWY
      lblR(v, 1, 'RWY ');
      const rwy = f.active?.depRwy;
      datR(v, 1, rwy ? rwy.ident : '---', rwy ? 'g' : 'w');

      // TO SHIFT
      lblR(v, 2, 'TO SHIFT ');
      if (f.toShift !== undefined) v.s.right(4, `{w}{s}[M]{l}{c}${String(f.toShift).padStart(4)}`, 'c', false);
      else v.s.right(4, '{w}{s}[M]{l}{c}[   ]*', 'c', false);
      v.on('R2', (sp) => {
        if (!sp) return;
        if (!ground || !rwy) return MSG.NOT_ALLOWED;
        if (sp === CLR) { f.toShift = undefined; return; }
        if (!/^\d{1,4}$/.test(sp)) return MSG.FORMAT_ERROR;
        if (+sp > rwy.lengthM - 500) return MSG.ENTRY_OUT_OF_RANGE;
        f.toShift = +sp;
        f.checkToData();
      });

      // FLAPS / THS
      lblR(v, 3, 'FLAPS/THS');
      const fl = f.toFlaps !== undefined ? String(f.toFlaps) : '[ ]';
      const th = f.toThs !== undefined ? fmtThs(f.toThs) : '[   ]';
      datR(v, 3, `${fl}/${th}`, 'c');
      v.on('R3', (sp) => {
        if (!sp) return;
        if (!ground) return MSG.NOT_ALLOWED;
        if (sp === CLR) { f.toFlaps = undefined; f.toThs = undefined; return; }
        const parts = sp.split('/');
        if (parts.length > 2) return MSG.FORMAT_ERROR;
        const [a, b] = parts;
        let flaps: number | undefined, ths: number | undefined;
        if (a) {
          if (!/^[0-3]$/.test(a)) return MSG.FORMAT_ERROR;
          if (+a < 1) return MSG.ENTRY_OUT_OF_RANGE;
          flaps = +a;
        }
        if (b) {
          const r = parseThs(b);
          if (isMsg(r)) return r;
          ths = r;
        }
        if (flaps === undefined && ths === undefined) return MSG.FORMAT_ERROR;
        if (flaps !== undefined) f.toFlaps = flaps;
        if (ths !== undefined) f.toThs = ths;
      });

      // TRANS ALT
      lblL(v, 4, 'TRANS ALT');
      const ta = f.transAlt();
      if (ta !== undefined) datL(v, 4, String(ta), 'c', f.toTransAlt === undefined);
      else datL(v, 4, '-----');
      v.on('L4', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.toTransAlt = undefined; return; }
        const r = parseFt(sp, 1000, 39000);
        if (isMsg(r)) return r;
        f.toTransAlt = r;
        f.markDirty();
      });

      // FLEX TO TEMP
      lblR(v, 4, 'FLEX TO TEMP');
      datR(v, 4, f.flex !== undefined ? `${f.flex}°` : '[  ]°', 'c');
      v.on('R4', (sp) => {
        if (!sp) return;
        if (!ground) return MSG.NOT_ALLOWED;
        if (sp === CLR) { f.flex = undefined; return; }
        const r = parseTemp(sp, 0, 99);
        if (isMsg(r)) return r;
        const oat = f.sim.has('G:ENV_OAT') ? f.sim.get('G:ENV_OAT') : -99;
        if (r <= oat) return MSG.ENTRY_OUT_OF_RANGE;
        f.flex = r;
      });

      // THR RED / ACC
      lblL(v, 5, 'THR RED/ACC');
      const dflt = f.defaultThrRed();
      const red = f.thrRed ?? dflt;
      const acc = f.acc ?? dflt;
      if (red !== undefined) {
        v.s.left(10, `${String(red)}{w}/`, 'c', f.thrRed === undefined);
        datAt(v, 5, String(red).length + 1, String(acc), 'c', f.acc === undefined);
      } else datL(v, 5, '-----/-----');
      v.on('L5', (sp) => {
        if (!sp) return;
        if (!ground) return MSG.NOT_ALLOWED;
        if (sp === CLR) { f.thrRed = f.acc = undefined; return; }
        const parts = sp.split('/');
        if (parts.length > 2) return MSG.FORMAT_ERROR;
        const [a, b] = parts;
        const elev = f.depElevation();
        let nr = f.thrRed, na = f.acc;
        if (a) { const r = parseFt(a, 0, 39000); if (isMsg(r)) return r; if (r < elev + 400) return MSG.ENTRY_OUT_OF_RANGE; nr = r; }
        if (b) { const r = parseFt(b, 0, 39000); if (isMsg(r)) return r; if (r < elev + 400) return MSG.ENTRY_OUT_OF_RANGE; na = r; }
        if (nr !== undefined && na !== undefined && na < nr) return MSG.ENTRY_OUT_OF_RANGE;
        if (nr !== undefined && na === undefined && dflt !== undefined && dflt < nr) na = nr;
        f.thrRed = nr;
        f.acc = na;
        f.markDirty();
      });

      // ENG OUT ACC
      lblR(v, 5, 'ENG OUT ACC');
      const eo = f.eoAcc ?? dflt;
      datR(v, 5, eo !== undefined ? String(eo) : '-----', eo !== undefined ? 'c' : 'w', f.eoAcc === undefined);
      v.on('R5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.eoAcc = undefined; return; }
        const r = parseFt(sp, 0, 39000);
        if (isMsg(r)) return r;
        if (r < f.depElevation() + 400) return MSG.ENTRY_OUT_OF_RANGE;
        f.eoAcc = r;
      });

      prevNext(v, m, undefined, perfClb);
    },
    next() {},
  };
}

/* ======================================================================== CLB / CRZ / DES */

function managedBlock(v: View, f: Fmgs, speed: string) {
  lblL(v, 1, 'ACT MODE');
  datL(v, 1, 'MANAGED', 'g');
  lblL(v, 2, ' CI');
  datL(v, 2, f.ci !== undefined ? String(f.ci) : box(3), f.ci !== undefined ? 'c' : 'a');
  v.on('L2', (sp) => {
    if (!sp) return;
    if (sp === CLR) return MSG.NOT_ALLOWED;
    if (!/^\d{1,3}$/.test(sp)) return MSG.FORMAT_ERROR;
    f.ci = +sp;
    f.markDirty();
  });
  lblL(v, 3, ' MANAGED');
  datL(v, 3, speed, 'g');
}

function preselBlock(v: View, get: () => number | undefined, set: (n: number | undefined) => void, label = ' PRESEL') {
  lblL(v, 4, label);
  const s = get();
  datL(v, 4, s !== undefined ? ` ${s < 2 ? `.${Math.round(s * 100)}` : s}` : '*[ ]', 'c');
  v.on('L4', (sp) => {
    if (!sp) return;
    if (sp === CLR) { set(undefined); return; }
    const r = parseSpeed(sp, 100, 350);
    if (isMsg(r)) return r;
    set(r);
  });
}

export function perfClb(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_CLB',
    draw(v) {
      phaseTitle(v, 'CLB', 2);
      const e = econSpeeds(f.ci ?? 0);
      managedBlock(v, f, ` ${e.clb}/.${Math.round(e.clbMach * 100)}`);
      preselBlock(v, () => f.clbPresel, (n) => { f.clbPresel = n; });
      lblR(v, 2, 'PRED TO ');
      datR(v, 2, f.crzFl ? `FL${String(f.crzFl).padStart(3, '0')}` : '-----', 'c');
      lblR(v, 3, 'UTC  DIST');
      const tc = f.preds?.pseudo.find((x) => x.ident === '(T/C)');
      datR(v, 3, tc ? `${hhmm(tc.pred.timeMin)} ${String(Math.round(tc.dist)).padStart(4)}` : '---- ----', tc ? 'g' : 'w', true);
      prevNext(v, m, f.flightPhase <= 1 ? perfTo : undefined, perfCrz);
    },
  };
}

export function perfCrz(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_CRZ',
    draw(v) {
      phaseTitle(v, 'CRZ', 3);
      const e = econSpeeds(f.ci ?? 0);
      managedBlock(v, f, ` .${Math.round(e.crzMach * 100)}`);
      preselBlock(v, () => f.crzPresel, (n) => { f.crzPresel = n; });
      lblR(v, 2, 'UTC  DIST');
      const td = f.preds?.pseudo.find((x) => x.ident === '(T/D)');
      lblR(v, 1, 'TO T/D ');
      datR(v, 2, td ? `${hhmm(td.pred.timeMin)} ${String(Math.round(td.dist)).padStart(4)}` : '---- ----', td ? 'g' : 'w', true);
      lblR(v, 5, 'DES CABIN RATE');
      datR(v, 5, `${f.desCabinRate}{s}FT/MN`, 'c');
      v.on('R5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.desCabinRate = -350; return; }
        if (!/^-?\d{2,4}$/.test(sp)) return MSG.FORMAT_ERROR;
        const r = -Math.abs(+sp);
        if (r < -999 || r > -100) return MSG.ENTRY_OUT_OF_RANGE;
        f.desCabinRate = r;
      });
      prevNext(v, m, perfClb, perfDes);
    },
  };
}

export function perfDes(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_DES',
    draw(v) {
      phaseTitle(v, 'DES', 4);
      const e = econSpeeds(f.ci ?? 0);
      managedBlock(v, f, ` .${Math.round(e.desMach * 100)}/${e.des}`);
      lblR(v, 2, 'UTC  DIST');
      lblR(v, 1, 'PRED TO DEST ');
      const pr = f.preds;
      datR(v, 2, pr ? `${hhmm(pr.tripTime)} ${String(Math.round(pr.tripDist)).padStart(4)}` : '---- ----', pr ? 'g' : 'w', true);
      prevNext(v, m, perfCrz, perfAppr);
    },
  };
}

/* ======================================================================== APPR */

export function perfAppr(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_APPR',
    draw(v) {
      phaseTitle(v, 'APPR', 5);
      const spd = f.lwSpeeds();
      // QNH
      lblL(v, 1, 'QNH');
      datL(v, 1, f.qnh !== undefined ? (f.qnh < 100 ? f.qnh.toFixed(2) : String(f.qnh)) : '[    ]', 'c');
      v.on('L1', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.qnh = undefined; return; }
        if (/^\d{3,4}$/.test(sp)) {
          const q = +sp;
          if (q < 745 || q > 1100) return MSG.ENTRY_OUT_OF_RANGE;
          f.qnh = q;
        } else if (/^\d{2}\.\d{1,2}$/.test(sp)) {
          const q = +sp;
          if (q < 22 || q > 32.48) return MSG.ENTRY_OUT_OF_RANGE;
          f.qnh = q;
        } else return MSG.FORMAT_ERROR;
      });
      // TEMP
      lblL(v, 2, 'TEMP');
      datL(v, 2, f.destTemp !== undefined ? `${f.destTemp}°` : '[ ]°', 'c');
      v.on('L2', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.destTemp = undefined; return; }
        const r = parseTemp(sp);
        if (isMsg(r)) return r;
        f.destTemp = r;
      });
      // MAG WIND
      lblL(v, 3, 'MAG WIND');
      datL(v, 3, f.magWind ? `${String(f.magWind.dir).padStart(3, '0')}°/${String(f.magWind.spd).padStart(3, '0')}` : '[ ]°/[ ]', 'c');
      v.on('L3', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.magWind = undefined; return; }
        const r = parseWind(sp);
        if (isMsg(r)) return r;
        f.magWind = r;
      });
      // TRANS FL
      lblL(v, 4, 'TRANS FL');
      const tfl = f.transFlDest();
      datL(v, 4, tfl !== undefined ? `FL${String(tfl).padStart(3, '0')}` : '-----', 'c', f.destTransFl === undefined);
      v.on('L4', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.destTransFl = undefined; f.markDirty(); return; }
        const r = /^(?:FL)?(\d{1,3})$/.exec(sp);
        if (!r) return MSG.FORMAT_ERROR;
        if (+r[1] < 10 || +r[1] > 390) return MSG.ENTRY_OUT_OF_RANGE;
        f.destTransFl = +r[1];
        f.markDirty();
      });
      // VAPP / VLS
      lblL(v, 5, 'VAPP  VLS');
      const vapp = f.vappPilot ?? spd?.vapp;
      datL(v, 5, vapp !== undefined ? String(vapp) : '---', 'c', f.vappPilot === undefined);
      datAt(v, 5, 6, spd ? String(spd.vls) : '---', 'g');
      v.on('L5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.vappPilot = undefined; return; }
        const r = parseSpeed(sp, 90, 350);
        if (isMsg(r)) return r;
        if (r < 2) return MSG.FORMAT_ERROR;
        f.vappPilot = r;
      });
      // F / S / O at landing weight
      fso(v, spd ? charSpeeds((f.preds?.landingWeight ?? 60000), f.ldgConf) : undefined, 9, 10);
      // FINAL
      lblR(v, 1, 'FINAL');
      datR(v, 1, f.active?.approach ? f.active.approach.ident : '------', f.active?.approach ? 'g' : 'w');
      // MDA
      lblR(v, 2, 'MDA');
      datR(v, 2, f.mda !== undefined ? String(f.mda) : '[    ]', 'c');
      v.on('R2', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.mda = undefined; return; }
        if (!/^\d{1,5}$/.test(sp)) return MSG.FORMAT_ERROR;
        if (+sp > 5000 + (f.destElevation() ?? 0)) return MSG.ENTRY_OUT_OF_RANGE;
        f.mda = +sp;
      });
      // DH
      lblR(v, 3, 'DH');
      datR(v, 3, f.dh !== undefined ? String(f.dh) : '[    ]', 'c');
      v.on('R3', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.dh = undefined; return; }
        if (sp === 'NO') { f.dh = 'NO'; return; }
        if (!/^\d{1,4}$/.test(sp)) return MSG.FORMAT_ERROR;
        if (+sp > 700) return MSG.ENTRY_OUT_OF_RANGE;
        f.dh = +sp;
      });
      // LDG CONF
      lblR(v, 4, 'LDG CONF');
      datR(v, 4, f.ldgConf === 3 ? 'CONF3' : 'CONF3*', 'c', f.ldgConf !== 3);
      datR(v, 5, f.ldgConf === 4 ? 'FULL' : 'FULL*', 'c', f.ldgConf !== 4);
      v.on('R4', (sp) => { if (sp) return MSG.NOT_ALLOWED; f.ldgConf = 3; return KEEP; });
      v.on('R5', (sp) => { if (sp) return MSG.NOT_ALLOWED; f.ldgConf = 4; return KEEP; });
      prevNext(v, m, perfDes, perfGa);
    },
  };
}

/* ======================================================================== GO AROUND */

export function perfGa(m: Mcdu): Page {
  const f = m.fmgs;
  return {
    id: 'PERF_GA',
    draw(v) {
      phaseTitle(v, 'GO AROUND', 6);
      const lw = f.preds?.landingWeight;
      fso(v, lw ? charSpeeds(lw) : undefined, 5, 7);
      lblL(v, 5, 'THR RED/ACC');
      const d = f.defaultGaThrRed();
      const red = f.gaThrRed ?? d, acc = f.gaAcc ?? d;
      if (red !== undefined) {
        v.s.left(10, `${red}{w}/`, 'c', f.gaThrRed === undefined);
        datAt(v, 5, String(red).length + 1, String(acc), 'c', f.gaAcc === undefined);
      } else datL(v, 5, '-----/-----');
      v.on('L5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.gaThrRed = f.gaAcc = undefined; return; }
        const [a, b] = sp.split('/');
        if (a) { const r = parseFt(a, 0, 39000); if (isMsg(r)) return r; f.gaThrRed = r; }
        if (b) { const r = parseFt(b, 0, 39000); if (isMsg(r)) return r; f.gaAcc = r; }
      });
      lblR(v, 5, 'ENG OUT ACC');
      const eo = f.gaEoAcc ?? d;
      datR(v, 5, eo !== undefined ? String(eo) : '-----', 'c', f.gaEoAcc === undefined);
      v.on('R5', (sp) => {
        if (!sp) return;
        if (sp === CLR) { f.gaEoAcc = undefined; return; }
        const r = parseFt(sp, 0, 39000);
        if (isMsg(r)) return r;
        f.gaEoAcc = r;
      });
      prevNext(v, m, perfAppr, undefined);
    },
  };
}
