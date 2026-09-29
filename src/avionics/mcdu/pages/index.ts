/**
 * Page registry: function keys -> page factories.
 */
import { PAGES, type Mcdu, type Page } from '../mcdu/mcdu';
import { menuPage, statusPage } from './menu';
import { initAPage, initBPage } from './init';
import { dirToPage, fplnPage } from './fpln';
import { perfPage } from './perf';
import { radNavPage } from './radnav';
import { fuelPredPage, progPage } from './fuelprog';
import { dataIndexPage, secIndexPage } from './data';

let registered = false;

export function registerPages(): void {
  if (registered) return;
  registered = true;
  PAGES.MENU = menuPage;
  PAGES.STATUS = statusPage;
  PAGES.INIT = initAPage;
  PAGES.INIT_A = initAPage;
  PAGES.INIT_B = initBPage;
  PAGES.FPLN = (m) => fplnPage(m);
  PAGES.DIR = dirToPage;
  PAGES.PERF = perfPage;
  PAGES.RADNAV = radNavPage;
  PAGES.FUEL = fuelPredPage;
  PAGES.PROG = progPage;
  PAGES.DATA = dataIndexPage;
  PAGES.SEC = secIndexPage;
  PAGES.AIRPORT = (m: Mcdu): Page => {
    const cur = m.page as Page & { airport?: () => void };
    if (cur.airport && cur.id === 'FPLN_A') { cur.airport(); return cur; }
    const p = fplnPage(m);
    p.airport();
    return p;
  };
}

registerPages();
