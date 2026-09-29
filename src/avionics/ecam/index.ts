/**
 * ECAM module: E/WD (upper ECAM), SD (lower ECAM), ECAM control panel logic, FWC.
 *
 * Logic (DOM-free) lives in ./logic, drawing (Canvas 2D) in ./draw.
 */
import type { App } from '../../app';
import { installEcamLogic } from './logic';

export default async function install(app: App): Promise<void> {
  const core = installEcamLogic(app);
  if (typeof document === 'undefined' || (app as any).headless) return;
  const { registerEcamDisplays } = await import('./draw/displays');
  registerEcamDisplays(core);
}
