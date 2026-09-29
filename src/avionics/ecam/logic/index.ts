/**
 * ECAM logic entry point (DOM-free, used by the module install and by the vitest tests).
 */
import type { Sim } from '../../../core/sim';
import { EcamCore } from './ecam';
import type { Line } from './types';

export { EcamCore } from './ecam';
export { SdPage } from './types';

export interface EcamService {
  /** Warnings / cautions currently active (displayed or not), highest priority first. */
  activeWarnings(): Array<{ text: string; level: number; displayed: boolean }>;
  /** Current E/WD memo/warning lines as plain text (debug / EFB). */
  ewdText(): { left: string[]; right: string[] };
  flightPhase(): number;
  sdPage(): number;
  core: EcamCore;
  /** Scenario helpers. */
  debug: {
    skipSelfTest(): void;
    forcePhase(p: number): void;
    forceToMemo(): void;
    /** Show an SD page as if manually selected (also CRUISE / STATUS, dev screenshots only). */
    showPage(p: number): void;
  };
}

const lineText = (l: Line) => l.map((s) => s.t).join('');

export function installEcamLogic(app: { sim: Sim }): EcamCore {
  const sim = app.sim;
  const core = new EcamCore(sim);
  sim.register(core);
  const svc: EcamService = {
    core,
    activeWarnings: () =>
      core.fwc.activeAlerts().map((s) => ({
        text: `${s.def.sys} ${s.def.title}`.trim() + (typeof s.def.sub === 'function' ? ' ' + s.def.sub().join(' ').trim() : s.def.sub ? ' ' + s.def.sub.join(' ').trim() : ''),
        level: s.def.level,
        displayed: s.displayed && !s.cleared && !s.cancelled,
      })),
    ewdText: () => ({ left: core.fwc.leftLines.map(lineText), right: core.fwc.rightLines.map(lineText) }),
    flightPhase: () => core.fwc.phase,
    sdPage: () => core.sd.page,
    debug: {
      skipSelfTest: () => { core.duUpper.force('ON'); core.duLower.force('ON'); },
      forcePhase: (p) => core.fwc.forcePhase(p),
      forceToMemo: () => core.fwc.forceToMemo(),
      showPage: (p) => { core.sd.mode = 'MANUAL'; core.sd.selected = p; },
    },
  };
  sim.services.ecam = svc;
  return core;
}
