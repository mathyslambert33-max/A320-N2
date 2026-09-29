import { it } from 'vitest';

// Node global (tsconfig only has vite/client types).
declare const process: { env: Record<string, string | undefined> };
import { headlessApp } from '../../src/core/headless';
import { installMcduLogic } from '../../src/avionics/mcdu/index';
import { doInitA, doInitB, doPerfTo, irsAligning, lines, powerUp, press, enter } from '../../src/avionics/mcdu/testing';

const show = (t: string, l: string[]) => console.log(`---- ${t}\n` + l.map((x) => `|${x}|`).join('\n'));

it.skipIf(!process.env.MCDU_DUMP)('dump pages', () => {
  const app = headlessApp();
  const mod = installMcduLogic(app);
  app.sim.start();
  powerUp(app.sim);
  const m = mod.units[0];
  show('status', lines(m));
  irsAligning(app.sim);
  press(app.sim, 1, 'INIT');
  show('initA empty', lines(m));
  doInitA(app.sim);
  show('initA', lines(m));
  press(app.sim, 1, 'FPLN');
  show('fpln', lines(m));
  for (let i = 0; i < 4; i++) { press(app.sim, 1, 'UP', 'UP', 'UP', 'UP', 'UP'); show('fpln+', lines(m)); }
  doInitB(app.sim);
  show('initB', lines(m));
  press(app.sim, 1, 'FPLN');
  app.sim.run(1);
  show('fpln preds', lines(m));
  press(app.sim, 1, 'NEXT');
  show('fpln B', lines(m));
  doPerfTo(app.sim);
  show('perf to', lines(m));
  press(app.sim, 1, 'R6'); show('clb', lines(m));
  press(app.sim, 1, 'R6'); show('crz', lines(m));
  press(app.sim, 1, 'R6'); show('des', lines(m));
  press(app.sim, 1, 'R6'); show('appr', lines(m));
  press(app.sim, 1, 'R6'); show('ga', lines(m));
  press(app.sim, 1, 'RADNAV'); show('radnav', lines(m));
  press(app.sim, 1, 'FUEL'); show('fuel', lines(m));
  press(app.sim, 1, 'PROG'); show('prog', lines(m));
  press(app.sim, 1, 'DATA'); show('data', lines(m));
  press(app.sim, 1, 'NEXT'); show('data2', lines(m));
  press(app.sim, 1, 'DIR'); show('dir', lines(m));
  press(app.sim, 1, 'SECFPLN'); show('sec', lines(m));
  press(app.sim, 1, 'MENU'); show('menu', lines(m));
  press(app.sim, 1, 'FPLN', 'L1'); show('latrev orig', lines(m));
  press(app.sim, 1, 'L1'); show('departure', lines(m));
  press(app.sim, 1, 'NEXT'); show('departure rwy', lines(m));
  press(app.sim, 1, 'FPLN', 'L6'); show('latrev dest', lines(m));
  press(app.sim, 1, 'R1'); show('arrival', lines(m));
  press(app.sim, 1, 'NEXT'); show('arrival appr', lines(m));
  press(app.sim, 1, 'L2'); show('vias', lines(m));
  void enter;
});
