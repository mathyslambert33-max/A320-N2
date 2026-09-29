/**
 * MCDU dev scenarios: /dev.html?display=MCDU1&mods=mcdu&power=1&scenario=mcdu.<name>
 * Each scenario powers the FMGS, prepares it with real key presses and leaves MCDU1 on a page.
 */
import type { Sim } from '../../core/sim';
import {
  doInitA, doInitB, doPerfTo, enter, irsAligned, irsAligning, powerUp, press, type,
} from '../../avionics/mcdu/testing';

const base = (sim: Sim) => { powerUp(sim); irsAligning(sim); };
const prepared = (sim: Sim) => {
  base(sim);
  doInitA(sim);
  press(sim, 1, 'R3'); // ALIGN IRS
  irsAligned(sim);
  doInitB(sim);
  doPerfTo(sim);
  sim.run(1);
};

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** Cold power-up: MCDU self test, MCDU MENU while the FMGC initialises. */
  powerUp(sim) {
    for (const v of ['S:ELEC_AC_ESS_BUS', 'S:ELEC_AC_ESS_SHED', 'S:ELEC_AC2_BUS', 'S:ELEC_AC_POWERED']) sim.set(v, 1);
    sim.run(4);
  },
  status(sim) { powerUp(sim); },
  menu(sim) { powerUp(sim); press(sim, 1, 'MENU'); },
  initEmpty(sim) { base(sim); press(sim, 1, 'INIT'); },
  initA(sim) { base(sim); doInitA(sim); },
  routeSel(sim) { base(sim); press(sim, 1, 'INIT'); enter(sim, 1, 'LFBD/LFPO', 'R1'); },
  initB(sim) { base(sim); doInitA(sim); doInitB(sim); press(sim, 1, 'INIT', 'NEXT'); },
  fuelPlanning(sim) {
    base(sim); doInitA(sim); press(sim, 1, 'INIT', 'NEXT'); enter(sim, 1, '57.6/27.4', 'R1');
  },
  fplnDone(sim) { prepared(sim); press(sim, 1, 'FPLN'); },
  fplnB(sim) { prepared(sim); press(sim, 1, 'FPLN', 'NEXT'); },
  fplnArr(sim) { prepared(sim); press(sim, 1, 'FPLN', 'AIRPORT'); },
  tmpy(sim) { prepared(sim); press(sim, 1, 'FPLN'); press(sim, 1, 'CLR', 'L3'); },
  perfTo(sim) { prepared(sim); press(sim, 1, 'PERF'); },
  perfToEmpty(sim) { base(sim); doInitA(sim); doInitB(sim); press(sim, 1, 'PERF'); },
  perfClb(sim) { prepared(sim); press(sim, 1, 'PERF', 'R6'); },
  perfAppr(sim) { prepared(sim); press(sim, 1, 'PERF', 'R6', 'R6', 'R6', 'R6'); },
  depart(sim) { base(sim); doInitA(sim); press(sim, 1, 'FPLN', 'L1', 'L1'); },
  departRwy(sim) { base(sim); press(sim, 1, 'INIT'); enter(sim, 1, 'LFBD/LFPO', 'R1'); press(sim, 1, 'L6', 'FPLN', 'L1', 'L1'); },
  arrival(sim) { base(sim); doInitA(sim); press(sim, 1, 'FPLN', 'L6', 'R1'); },
  arrivalAppr(sim) { base(sim); doInitA(sim); press(sim, 1, 'FPLN', 'L6', 'R1', 'NEXT'); },
  latRev(sim) { base(sim); doInitA(sim); press(sim, 1, 'FPLN', 'L5'); },
  airways(sim) {
    base(sim); press(sim, 1, 'INIT'); enter(sim, 1, 'LFBD/LFPO', 'R1'); press(sim, 1, 'L6', 'FPLN');
    enter(sim, 1, 'CNA', 'L2');
    press(sim, 1, 'L2', 'R5');
    enter(sim, 1, 'B19', 'L1');
    enter(sim, 1, 'AMB', 'R1');
  },
  vertRev(sim) { prepared(sim); press(sim, 1, 'FPLN', 'UP', 'UP', 'UP', 'UP', 'UP', 'UP', 'R3'); },
  dirTo(sim) { prepared(sim); press(sim, 1, 'DIR'); },
  radnav(sim) { prepared(sim); press(sim, 1, 'RADNAV'); },
  fuelPred(sim) { prepared(sim); press(sim, 1, 'FUEL'); },
  prog(sim) { prepared(sim); press(sim, 1, 'PROG'); enter(sim, 1, 'LFPO', 'R4'); },
  data(sim) { prepared(sim); press(sim, 1, 'DATA'); },
  data2(sim) { prepared(sim); press(sim, 1, 'DATA', 'NEXT'); },
  posMonitor(sim) { prepared(sim); press(sim, 1, 'DATA', 'L1'); },
  irsMonitor(sim) { base(sim); press(sim, 1, 'DATA', 'L2'); },
  gpsMonitor(sim) { prepared(sim); press(sim, 1, 'DATA', 'L3'); },
  navaid(sim) { prepared(sim); press(sim, 1, 'DATA', 'NEXT', 'L2'); enter(sim, 1, 'BMC', 'L1'); },
  runway(sim) { prepared(sim); press(sim, 1, 'DATA', 'NEXT', 'L3'); enter(sim, 1, 'LFPO25', 'L1'); },
  secIndex(sim) { prepared(sim); press(sim, 1, 'SECFPLN', 'L1'); },
  /** Scratchpad messages. */
  formatError(sim) { base(sim); press(sim, 1, 'INIT'); enter(sim, 1, 'LFBD-LFPO', 'R1'); },
  notInDb(sim) { base(sim); press(sim, 1, 'INIT'); enter(sim, 1, 'LFBD/LFXX', 'R1'); },
  scratch(sim) { base(sim); press(sim, 1, 'INIT'); type(sim, 1, 'LFBD/LFPO'); },
  checkTo(sim) {
    prepared(sim);
    press(sim, 1, 'FPLN', 'L1', 'L1', 'NEXT');
    press(sim, 1, 'L2', 'R6');
    press(sim, 1, 'PERF');
  },
};
