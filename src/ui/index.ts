/**
 * UI module (owner: ui): first-person player, menus (French), EFB tablet, ground services, end of game.
 *
 * The DOM-free logic (ground services `sim.services.ground`, end-of-game monitor `sim.services.game`) is installed
 * first so the module also works in the headless test app; the DOM / Three.js side is loaded only when a document
 * exists. Variables, events and services: docs/vars/ui.md.
 */
import type { App } from '../app';
import { installGround } from './ground';
import { installGame } from './game';
import { uiPrefs } from './prefs';

export default async function install(app: App): Promise<void> {
  const ground = installGround(app.sim, { pace: uiPrefs().groundPace });
  const game = installGame(app.sim);
  if (!app.services) (app as { services: Record<string, unknown> }).services = {};
  app.services.ground = ground;
  app.services.game = game;
  if (typeof document === 'undefined' || (app as unknown as { headless?: boolean }).headless) return;
  const { installUi } = await import('./main');
  installUi(app, ground, game);
}
