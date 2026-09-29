/**
 * Headless app for unit tests (vitest, node): a Sim + the subset of App that logic modules may use.
 * Modules installed here must not touch renderer/scene/kit (guard with `if (app.isHarness !== undefined && app.kit)` or
 * split logic from 3D).
 *
 *   const app = headlessApp();
 *   installLogic(app, [elecInstall, airInstall]);
 *   app.sim.run(10);
 */
import { Sim } from './sim';
import { applyColdAndDark } from './catalog';
import { applyScenario } from './scenario';
import { settings } from './settings';

export interface HeadlessApp {
  sim: Sim;
  settings: typeof settings;
  isHarness: boolean;
  headless: true;
  services: Record<string, any>;
  onFrame(fn: (dt: number, t: number) => void, order?: number): () => void;
  time(): number;
  [k: string]: any;
}

export function headlessApp(opts: { timeOfDay?: 'day' | 'dusk' | 'night'; coldAndDark?: boolean } = {}): HeadlessApp {
  const sim = new Sim();
  if (opts.coldAndDark !== false) applyColdAndDark(sim);
  applyScenario(sim, opts.timeOfDay ?? 'day');
  return {
    sim,
    settings,
    isHarness: false,
    headless: true,
    services: {},
    onFrame: () => () => undefined,
    time: () => sim.time,
  };
}

/** Install logic modules into a headless app and start the sim. */
export async function installLogic(app: HeadlessApp, installers: Array<(app: any) => void | Promise<void>>): Promise<void> {
  for (const i of installers) await i(app);
  app.sim.start();
}

/** Press a momentary pushbutton (press → run → release). */
export function press(sim: Sim, id: string, holdS = 0.2): void {
  sim.set(`C:${id}`, 1);
  sim.emit(`${id}:press`);
  sim.run(holdS);
  sim.set(`C:${id}`, 0);
  sim.emit(`${id}:release`);
}

/** Set a latching control and emit its toggle event like the kit does. */
export function setControl(sim: Sim, id: string, value: number): void {
  sim.set(`C:${id}`, value);
  sim.emit(`${id}:toggle`, { value });
  sim.emit(`${id}:change`, { value });
}
