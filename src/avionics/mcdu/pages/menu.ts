/**
 * MCDU MENU, A/C STATUS (IDENT) and the other MCDU subsystems (ATSU / AIDS / CFDS: menus only).
 */
import { KEEP, PAGES, type Mcdu, type Page, type View } from '../mcdu/mcdu';
import { NAV_DB } from '../navdb/navdb';
import { MSG } from '../mcdu/format';
import { datL, datR, lblL, lblR, title } from './common';

export function menuPage(m: Mcdu): Page {
  return {
    id: 'MENU',
    fmgc: false,
    draw(v: View) {
      title(v, 'MCDU MENU');
      const fmgcOk = v.f.ready;
      datL(v, 1, '<FMGC', fmgcOk ? 'g' : 'w');
      if (!fmgcOk && v.f.fmgc1) v.s.text(2, 6, '(REQ)', 'w', true);
      datL(v, 2, '<ATSU');
      datL(v, 3, '<AIDS');
      datL(v, 4, '<CFDS');
      v.on('L1', () => {
        if (!v.f.ready) return MSG.NOT_ALLOWED;
        m.show(v.f.active ? PAGES.FPLN : PAGES.STATUS);
        return KEEP;
      });
      v.on('L2', () => { m.show(subsystem('ATSU DATALINK', ['<AOC MENU', '', '', ''], ['ATC MENU>'])); return KEEP; });
      v.on('L3', () => { m.show(subsystem('AIDS MAIN MENU', ['<PARAM ALPHA CALL-UP', '<PARAM LABEL CALL-UP', '<PROGRAMMING', '<SAR/DAR'], [])); return KEEP; });
      v.on('L4', () => { m.show(subsystem('CFDS', ['<LAST LEG REPORT', '<LAST LEG ECAM REPORT', '<PREVIOUS LEGS REPORT', '<AVIONICS STATUS', '<SYSTEM REPORT / TEST'], [])); return KEEP; });
    },
  };
}

/** Other MCDU subsystems: static menus (not simulated), RETURN to the MCDU MENU. */
function subsystem(name: string, left: string[], right: string[]): Page {
  return {
    id: `SUB_${name}`,
    fmgc: false,
    draw(v) {
      title(v, name);
      left.forEach((t, i) => t && datL(v, i + 1, t));
      right.forEach((t, i) => t && datR(v, i + 1, t));
      datL(v, 6, '<RETURN');
      v.on('L6', () => { v.m.show(PAGES.MENU); return KEEP; });
    },
  };
}

/** A/C STATUS page (DATA INDEX / power-up page). */
export function statusPage(_m: Mcdu): Page {
  return {
    id: 'STATUS',
    draw(v) {
      title(v, 'A320-200');
      lblL(v, 1, ' ENG');
      datL(v, 1, 'CFM56-5B4/P', 'g');
      lblL(v, 2, ' ACTIVE NAV DATA BASE');
      datL(v, 2, ` ${NAV_DB.active.from}-${NAV_DB.active.to}`, 'c');
      datR(v, 2, NAV_DB.ident, 'g');
      lblL(v, 3, ' SECOND NAV DATA BASE');
      datL(v, 3, ` ${NAV_DB.second.from}-${NAV_DB.second.to}`, 'c', true);
      lblL(v, 5, 'CHG CODE');
      datL(v, 5, '[  ]', 'c');
      lblL(v, 6, 'IDLE/PERF');
      datL(v, 6, '+0.0/+0.0', 'g', true);
      // Second data base is not effective before 01OCT: swap not allowed.
      v.on('L3', () => MSG.NOT_ALLOWED);
      v.on('L5', (sp) => (sp ? MSG.NOT_ALLOWED : KEEP));
    },
  };
}
