/** Ordered list of game modules (lead-owned). Order = install order. */
import type { App } from './app';

export const MODULES: Record<string, () => Promise<{ default: (app: App) => void | Promise<void> }>> = {
  'sys-elec': () => import('./systems/elec-hyd-fuel-apu/index'),
  'sys-air': () => import('./systems/air-eng/index'),
  'sys-misc': () => import('./systems/misc/index'),
  ecam: () => import('./avionics/ecam/index'),
  pfdnd: () => import('./avionics/pfdnd/index'),
  mcdu: () => import('./avionics/mcdu/index'),
  shell: () => import('./cockpit/shell/index'),
  overhead: () => import('./cockpit/overhead/index'),
  mainpanel: () => import('./cockpit/mainpanel/index'),
  pedestal: () => import('./cockpit/pedestal/index'),
  world: () => import('./world/index'),
  audio: () => import('./audio/index'),
  ui: () => import('./ui/index'),
};

export const MODULE_ORDER = Object.keys(MODULES);
