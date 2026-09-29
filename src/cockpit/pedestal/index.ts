/**
 * Pedestal module (owner: pedestal): 3D centre pedestal (MCDUs, SWITCHING, ECAM CP, RMP/ACP, thrust levers, trim
 * wheels, ENG panel, speed brake, flaps, RUD TRIM, PARK BRK, ATC/TCAS, WX radar, cockpit door, lighting, printer,
 * gravity gear extension) and its logic: RMP 1-3, ACP 1-3, ATC transponder / TCAS, RUD TRIM window, WXR, printer.
 * Logic is DOM-free (./logic, unit-tested in tests/pedestal); 3D + displays are loaded only when a DOM exists.
 * Variables / events: docs/vars/pedestal.md.
 */
import type { App } from '../../app';
import { installPedestalLogic } from './logic';

export default async function install(app: App): Promise<void> {
  const logic = installPedestalLogic(app);
  if (typeof document === 'undefined' || (app as any).headless) return;
  const { registerPedestalDisplays } = await import('./displays');
  registerPedestalDisplays(logic);
  const { buildPedestal } = await import('./build');
  buildPedestal(app, logic);
}
