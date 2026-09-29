/** Game entry point (lead-owned). */
import { createApp } from './app';
import { MODULES, MODULE_ORDER } from './modules';
import { applyColdAndDark } from './core/catalog';
import { applyScenario, clockSystem } from './core/scenario';
import { settings } from './core/settings';

const bar = document.getElementById('loadbar') as HTMLDivElement;
const step = document.getElementById('loadstep') as HTMLDivElement;
const LABELS: Record<string, string> = {
  'sys-elec': 'Systèmes électriques, hydrauliques, carburant, APU',
  'sys-air': 'Pneumatique, conditionnement, moteurs CFM56',
  'sys-misc': 'ADIRS, feu, commandes de vol, éclairages',
  ecam: 'ECAM et alarmes',
  pfdnd: 'PFD, ND, FCU',
  mcdu: 'MCDU et FMGS',
  shell: 'Structure du cockpit',
  overhead: 'Panneau supérieur',
  mainpanel: 'Planche de bord et glareshield',
  pedestal: 'Pylône central',
  world: 'Aéroport de Bordeaux-Mérignac',
  audio: 'Sons',
  ui: 'Interface',
};

async function main() {
  const app = await createApp(document.getElementById('app')!);
  applyColdAndDark(app.sim);
  applyScenario(app.sim, settings.get().timeOfDay);
  app.sim.register(clockSystem);
  let i = 0;
  for (const name of MODULE_ORDER) {
    step.textContent = LABELS[name] ?? name;
    bar.style.width = `${(i++ / MODULE_ORDER.length) * 100}%`;
    try {
      const mod = await MODULES[name]();
      await mod.default(app);
    } catch (e) {
      console.error(`[main] module ${name} failed to install`, e);
    }
  }
  bar.style.width = '100%';
  app.start();
  app.sim.emit('app:ready');
  const loading = document.getElementById('loading')!;
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 700);
  (window as any).__ready = true;
}

main().catch((e) => {
  console.error(e);
  step.textContent = 'Erreur : ' + (e?.message ?? e);
});
