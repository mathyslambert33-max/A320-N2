/**
 * PFD / ND / ISIS / FCU module (owner: pfdnd).
 *
 * Logic (DOM-free, unit-tested) lives in ./logic; Canvas 2D drawing in ./draw (loaded only when a
 * DOM exists). Displays: PFD1, ND1, PFD2, ND2, ISIS, EFIS1_BARO, EFIS2_BARO, FCU_SPD, FCU_HDG,
 * FCU_ALT, FCU_VS. Variables: see docs/vars/pfdnd.md.
 */
import type { App } from '../../app';
import { installPfdNdLogic } from './logic';

export default async function install(app: App): Promise<void> {
  installPfdNdLogic(app.sim);
  if (typeof document === 'undefined' || (app as any).headless) return;
  const { registerPfdNdDisplays } = await import('./draw/displays');
  registerPfdNdDisplays();
}
