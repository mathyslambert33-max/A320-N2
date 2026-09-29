/**
 * Dev-harness scenarios for the sys-air module (pneumatics, air conditioning, pressurisation,
 * ventilation, anti-ice, CFM56 engines + FADEC), e.g.
 *   /dev.html?module=overhead&mods=sys-elec,sys-air&scenario=sys-air.enginesRunning
 *   /dev.html?module=pedestal&mods=sys-elec,sys-air&scenario=sys-air.eng2Starting
 *   /dev.html?display=EWD&mods=ecam&power=1&scenario=sys-air.enginesRunning   (no sys-air: static values)
 *
 * With sys-air installed the scenario sets the cockpit controls and asks the module for a preset (applied
 * on the next tick); with sys-elec installed too, the APU is started with its bleed ON (sys-elec preset
 * 'apuRunning'). Without sys-air (display-only harness) plausible static S: values are written instead.
 */
import type { Sim } from '../../core/sim';

type Svc = { preset(name: string): unknown } | undefined;

const air = (sim: Sim): Svc => sim.services['sys-air'] as Svc;
const elec = (sim: Sim): Svc => sim.services['sys-elec'] as Svc;

/** Latching pb: 1 = pressed IN. ENG MASTER: 0 = ON. ENG MODE: 0 CRANK / 1 NORM / 2 IGN-START. */
function controls(sim: Sim, v: Record<string, number>): void {
  for (const [k, x] of Object.entries(v)) sim.set(`C:${k}`, x);
}

/** APU running with APU BLEED ON (sys-elec), or an HP ground cart + X BLEED OPEN without sys-elec. */
function bleedAir(sim: Sim): void {
  const e = elec(sim);
  if (e) e.preset('apuRunning');
  else {
    sim.set('G:GND_AIR_START_UNIT', 1);
    controls(sim, { AIR_XBLEED: 2 });
  }
}

/** Static engine values for display-only harnesses (no sys-air installed). */
function staticEngine(sim: Sim, n: 1 | 2, running: boolean): void {
  const idle: Record<string, number> = {
    N1: 19.6, N2: 59.2, EGT: n === 1 ? 402 : 389, FF: n === 1 ? 292 : 284, OIL_PRESS: 36, OIL_TEMP: 72, OIL_QTY: n === 1 ? 17.1 : 17.8,
    VIB_N1: 0.4, VIB_N2: 0.6, START_VALVE: 0, IGN_A: 0, IGN_B: 0, HP_FUEL_VALVE: 1, STATE: 3, RUNNING: 1, LIT: 1, FADEC_ON: 1,
    NAC_TEMP: 80, REV: 0, START_FAULT: 0, THRUST: 5.5,
  };
  for (const [k, v] of Object.entries(idle)) {
    sim.set(`S:ENG${n}_${k}`, running ? v : k === 'FADEC_ON' ? 1 : k === 'OIL_QTY' ? v + 0.4 : k === 'EGT' || k === 'OIL_TEMP' ? 19 : 0);
  }
}

function staticLimits(sim: Sim): void {
  sim.set('S:ENG_THR_LIMIT_TYPE', 0);
  sim.set('S:ENG_THR_LIMIT_N1', 84.8);
  sim.set('S:ENG_TOGA_N1', 84.8);
  sim.set('S:ENG_MCT_N1', 83.8);
  sim.set('S:ENG_CLB_N1', 81.7);
  sim.set('S:ENG_IDLE_N1', 19.6);
  sim.set('S:ENG_MODE_SEL', sim.has('C:ENG_MODE') ? Math.round(sim.get('C:ENG_MODE')) : 1);
}

function staticBleed(sim: Sim, engines: boolean): void {
  const v: Record<string, number> = {
    'S:BLEED_ENG1_VALVE': engines ? 1 : 0, 'S:BLEED_ENG2_VALVE': engines ? 1 : 0,
    'S:BLEED_ENG1_HP_VALVE': engines ? 1 : 0, 'S:BLEED_ENG2_HP_VALVE': engines ? 1 : 0,
    'S:BLEED_XBLEED_VALVE': engines ? 0 : 1, 'S:BLEED_PRESS_1': engines ? 42 : 32, 'S:BLEED_PRESS_2': engines ? 42 : 32,
    'S:BLEED_TEMP_1': engines ? 168 : 160, 'S:BLEED_TEMP_2': engines ? 166 : 158,
    'S:PACK1_VALVE': 1, 'S:PACK2_VALVE': 1, 'S:PACK1_FLOW': engines ? 1 : 1.2, 'S:PACK2_FLOW': engines ? 1 : 1.2,
    'S:PACK1_OUT_TEMP': 12, 'S:PACK2_OUT_TEMP': 13, 'S:PACK1_COMP_TEMP': 110, 'S:PACK2_COMP_TEMP': 108,
    'S:PACK1_BYPASS': 0.15, 'S:PACK2_BYPASS': 0.16,
    'S:COND_CKPT_TEMP': 23, 'S:COND_FWD_TEMP': 22, 'S:COND_AFT_TEMP': 23,
    'S:COND_CKPT_DUCT': 16, 'S:COND_FWD_DUCT': 14, 'S:COND_AFT_DUCT': 15, 'S:COND_HOT_AIR_VALVE': 1,
    'S:PRESS_CAB_ALT': 160, 'S:PRESS_CAB_VS': 0, 'S:PRESS_DELTA_P': 0, 'S:PRESS_OUTFLOW': 1, 'S:PRESS_ACTIVE_SYS': 1,
    'S:PRESS_LDG_ELEV': 291, 'S:VENT_BLOWER_ON': 1, 'S:VENT_EXTRACT_ON': 1, 'S:VENT_INLET_VALVE': 1, 'S:VENT_EXTRACT_VALVE': 1,
    'S:AI_PROBE_HEAT': engines ? 1 : 0,
  };
  for (const [k, x] of Object.entries(v)) sim.set(k, x);
}

export const scenarios: Record<string, (sim: Sim) => void> = {
  /** Both engines stabilised at idle, ENG MODE NORM, APU (if sys-elec) still running with its bleed OFF. */
  enginesRunning: (sim) => {
    const a = air(sim);
    if (a) {
      // APU running (sys-elec); the sys-air preset then selects APU BLEED OFF and ENG MODE NORM.
      elec(sim)?.preset('apuRunning');
      a.preset('enginesRunning');
    } else {
      controls(sim, { ENG_MASTER1: 0, ENG_MASTER2: 0, ENG_MODE: 1 });
      staticEngine(sim, 1, true);
      staticEngine(sim, 2, true);
      staticLimits(sim);
      staticBleed(sim, true);
    }
  },

  /** ENG 2 running (first engine started), ENG MODE still IGN/START, APU bleed ON: ready for MASTER 1. */
  engine2Running: (sim) => {
    const a = air(sim);
    if (a) {
      bleedAir(sim);
      a.preset('engine2Running'); // sets MASTER 2 ON and keeps ENG MODE at IGN/START
    } else {
      controls(sim, { ENG_MODE: 2, ENG_MASTER2: 0 });
      staticEngine(sim, 1, false);
      staticEngine(sim, 2, true);
      staticLimits(sim);
      staticBleed(sim, false);
    }
  },

  /** APU bleed ON, ENG MODE IGN/START, MASTER 2 ON: the automatic start of ENG 2 runs live (≈ 45 s). */
  eng2Starting: (sim) => {
    const a = air(sim);
    bleedAir(sim);
    controls(sim, { ENG_MODE: 2, ENG_MASTER2: 0 });
    if (!a) {
      // Display-only: a frozen mid-start picture (≈ 35 % N2, light-off done, start valve open, igniter B).
      staticEngine(sim, 1, false);
      const mid: Record<string, number> = {
        N1: 6.8, N2: 35.2, EGT: 548, FF: 250, OIL_PRESS: 18, OIL_TEMP: 22, START_VALVE: 1, IGN_B: 1, HP_FUEL_VALVE: 1,
        STATE: 2, RUNNING: 0, LIT: 1, FADEC_ON: 1,
      };
      for (const [k, v] of Object.entries(mid)) sim.set(`S:ENG2_${k}`, v);
      staticLimits(sim);
      staticBleed(sim, false);
      sim.set('S:PACK1_VALVE', 0);
      sim.set('S:PACK2_VALVE', 0);
      sim.set('S:PACK1_FLOW', 0);
      sim.set('S:PACK2_FLOW', 0);
    }
  },

  /** APU bleed ON, packs running, engines stopped (cockpit preparation complete). */
  apuBleed: (sim) => {
    if (air(sim)) bleedAir(sim);
    else {
      staticEngine(sim, 1, false);
      staticEngine(sim, 2, false);
      staticLimits(sim);
      staticBleed(sim, false);
    }
  },

  /** ENG 2 start without any bleed air: START VALVE FAULT after ≈ 7 s (ENG 2 FAULT light, ECAM). */
  eng2StartNoBleed: (sim) => {
    elec(sim)?.preset('extPwr'); // aircraft powered by the GPU, APU not running
    controls(sim, { AIR_APU_BLEED: 0, ENG_MODE: 2, ENG_MASTER2: 0 });
    if (!air(sim)) {
      staticEngine(sim, 1, false);
      staticEngine(sim, 2, false);
      sim.set('S:ENG2_START_FAULT', 5);
      sim.set('S:ENG2_STATE', 5);
      sim.set('L:ENG2_FAULT', 1);
    }
  },
};
