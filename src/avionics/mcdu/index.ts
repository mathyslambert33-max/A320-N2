/**
 * MCDU module: nav database, FMGS (flight plans, performance, radio autotune, predictions), both MCDUs
 * (keys, pages, scratchpad, annunciators) and their displays.
 *
 * Logic is DOM-free (./navdb, ./fmgs, ./mcdu, ./pages); ./draw paints the MCDU screens.
 *
 * Power: FMGC1 AC ESS BUS, FMGC2 AC BUS 2; MCDU1 AC ESS SHED BUS, MCDU2 AC BUS 2 (fallback S:ELEC_AC_POWERED).
 */
import type { App } from '../../app';
import type { Sim } from '../../core/sim';
import { Fmgs } from './fmgs/fmgs';
import { Mcdu } from './mcdu/mcdu';
import { registerPages } from './pages';

export interface McduModule {
  fmgs: Fmgs;
  units: [Mcdu, Mcdu];
}

function bus(sim: Sim, name: string): boolean {
  return sim.has(name) ? sim.getB(name) : sim.getB('S:ELEC_AC_POWERED');
}

export function mcduPowered(n: 1 | 2, sim: Sim): boolean {
  return n === 1 ? bus(sim, 'S:ELEC_AC_ESS_SHED') || bus(sim, 'S:ELEC_AC_ESS_BUS') : bus(sim, 'S:ELEC_AC2_BUS');
}

export function installMcduLogic(app: { sim: Sim; services?: Record<string, any> }): McduModule {
  registerPages();
  const sim = app.sim;
  const fmgs = new Fmgs(sim);
  const units: [Mcdu, Mcdu] = [new Mcdu(1, fmgs), new Mcdu(2, fmgs)];
  const mod: McduModule = { fmgs, units };
  sim.services.fmgs = fmgs;
  sim.services.mcdu = mod;
  if (app.services) { app.services.fmgs = fmgs; app.services.mcdu = mod; }

  for (const u of units) {
    sim.on(`MCDU${u.n}_KEY`, (p: { key?: string } | string | undefined) => {
      const key = typeof p === 'string' ? p : p?.key;
      if (key) u.key(key);
    });
  }

  sim.register({
    name: 'mcdu',
    order: 80,
    update(dt: number) {
      fmgs.update(dt);
      for (const u of units) {
        const pw = mcduPowered(u.n, sim);
        u.update(dt, pw);
        // Annunciators (DC powered with the other annunciators).
        const ann = sim.has('S:ANN_POWER') ? sim.getB('S:ANN_POWER') : pw;
        const on = ann && pw;
        const other = u.page.fmgc === false;
        sim.set(`L:MCDU${u.n}_FAIL`, 0);
        sim.set(`L:MCDU${u.n}_FMGC`, on && other && fmgs.ready && fmgs.messages.length > 0 ? 1 : 0);
        sim.set(`L:MCDU${u.n}_FM`, on && other && fmgs.ready && fmgs.messages.length > 0 ? 1 : 0);
        sim.set(`L:MCDU${u.n}_MENU`, 0);
        sim.set(`L:MCDU${u.n}_IND`, on && fmgs.ready && fmgs.fmgc1 !== fmgs.fmgc2 ? 1 : 0);
        sim.set(`L:MCDU${u.n}_RDY`, 0);
        sim.set(`L:MCDU${u.n}_FM1`, on && fmgs.ready && !fmgs.fmgc1 ? 1 : 0);
        sim.set(`L:MCDU${u.n}_FM2`, on && fmgs.ready && !fmgs.fmgc2 ? 1 : 0);
        sim.set(`S:MCDU${u.n}_POWERED`, pw ? 1 : 0);
        sim.set(`S:MCDU${u.n}_BRT`, u.brightness);
      }
    },
  });
  return mod;
}

export default async function install(app: App): Promise<void> {
  const mod = installMcduLogic(app);
  if (typeof document === 'undefined' || (app as any).headless) return;
  const { registerMcduDisplays } = await import('./draw');
  registerMcduDisplays(mod.units, mcduPowered);
}
