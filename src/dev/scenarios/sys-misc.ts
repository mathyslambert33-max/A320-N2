/**
 * Dev-harness scenarios for sys-misc (ADIRS, fire, F/CTL, gear, lights, misc panels), e.g.
 *   /dev.html?module=overhead&mods=sys-misc&power=1&scenario=sys-misc.aligning
 *   /dev.html?module=overhead&mods=sys-elec,sys-misc&scenario=sys-misc.fireTest
 * Without sys-elec, use &power=1 (fake buses). Hydraulic pressures are faked where needed (sys-elec,
 * when installed, overwrites them with its own values).
 */
import type { Sim } from '../../core/sim';
import type { SysMiscService } from '../../systems/misc/index';

type Scenario = (sim: Sim) => void;

const svc = (sim: Sim): SysMiscService | undefined => sim.services['sys-misc'] as SysMiscService | undefined;

/** Run `fn` once, `delay` s of sim time after the start. */
function after(sim: Sim, delay: number, fn: () => void, name = 'sys-misc-scenario'): void {
  let t = 0;
  let done = false;
  sim.register({
    name: `${name}-${delay}`,
    order: 96,
    update(dt) {
      if (done) return;
      t += dt;
      if (t >= delay) { done = true; fn(); }
    },
  });
}

const irsNav = (sim: Sim) => { for (const n of [1, 2, 3]) sim.set(`C:ADIRS_IR${n}_MODE`, 1); };
const hydOn = (sim: Sim) => { sim.set('S:HYD_G_PRESS', 3000); sim.set('S:HYD_B_PRESS', 3000); sim.set('S:HYD_Y_PRESS', 3000); };

export const scenarios: Record<string, Scenario> = {
  /** IRs NAV: alignment in progress (no position → stops at 1 min, ALIGN lights flashing). */
  aligning: (sim) => irsNav(sim),
  /** IRs NAV, MCDU position entered after 3 s: full alignment (≈ 7 min at LFBD, see settings.irsAlign). */
  aligningPos: (sim) => {
    irsNav(sim);
    after(sim, 3, () => sim.emit('adirs:position', { lat: sim.get('G:AC_LAT'), lon: sim.get('G:AC_LON') }));
  },
  /** IRs NAV and aligned (ADR/IR data valid). */
  aligned: (sim) => {
    irsNav(sim);
    after(sim, 1, () => svc(sim)?.debug.forceAligned());
  },
  /** ENG 1, ENG 2 and APU fire TEST pbs held: whole fire panel + pedestal ENG FIRE lit. */
  fireTest: (sim) => {
    sim.set('C:FIRE_ENG1_TEST', 1);
    sim.set('C:FIRE_ENG2_TEST', 1);
    sim.set('C:FIRE_APU_TEST', 1);
  },
  /** ENG 1 fire, FIRE pb released (SQUIB lights), AGENT 1 discharged after 5 s. */
  engFire: (sim) => {
    after(sim, 0.5, () => { svc(sim)?.debug.injectFire('ENG1', true, 2); sim.set('C:FIRE_ENG1_PB', 1); });
    after(sim, 5, () => sim.set('C:FIRE_ENG1_AGENT1', 1), 'agent-press');
    after(sim, 5.5, () => sim.set('C:FIRE_ENG1_AGENT1', 0), 'agent-release');
  },
  /** CARGO SMOKE TEST pressed for 1 s (DISCH, then two SMOKE cycles). */
  cargoSmokeTest: (sim) => {
    after(sim, 0.5, () => sim.set('C:CARGO_SMOKE_TEST', 1), 'press');
    after(sim, 1.5, () => sim.set('C:CARGO_SMOKE_TEST', 0), 'release');
  },
  /** Hydraulics on, F/CTL check: full right roll and full aft stick. */
  fctlCheck: (sim) => {
    hydOn(sim);
    sim.set('C:SIDESTICK_CAPT_X', 1);
    sim.set('C:SIDESTICK_CAPT_Y', 1);
    sim.set('C:RUDDER', 1);
  },
  /** Hydraulics on, flaps lever FULL (27/35). */
  flapsFull: (sim) => { hydOn(sim); sim.set('C:FLAPS_LEVER', 4); },
  /** Sidestick priority: CAPT takeover pb held, F/O stick deflected. */
  priority: (sim) => {
    sim.set('C:SIDESTICK_CAPT_TAKEOVER', 1);
    sim.set('C:SIDESTICK_FO_X', 0.6);
  },
  /** Airborne at 500 ft RA, gear lever UP: gear in transit (UNLK), then red arrow. */
  gearUp: (sim) => {
    hydOn(sim);
    sim.set('G:AC_ON_GROUND', 0);
    sim.set('G:AC_RADALT_FT', 500);
    sim.set('C:GEAR_LEVER', 0);
  },
  /** IRs aligned, hydraulics on, AUTO BRK MAX armed. */
  autobrakeMax: (sim) => {
    hydOn(sim);
    irsNav(sim);
    after(sim, 1, () => svc(sim)?.debug.forceAligned());
    after(sim, 2, () => sim.set('C:AUTOBRK_MAX', 1), 'ab-press');
    after(sim, 2.3, () => sim.set('C:AUTOBRK_MAX', 0), 'ab-release');
  },
  /** Night: every exterior light on, dome DIM, integral / flood lights up, seat belts. */
  nightLights: (sim) => {
    sim.set('C:EXTLT_BEACON', 0);
    sim.set('C:EXTLT_STROBE', 0);
    sim.set('C:EXTLT_WING', 0);
    sim.set('C:EXTLT_NAV_LOGO', 0);
    sim.set('C:EXTLT_RWY_TURNOFF', 0);
    sim.set('C:EXTLT_LAND_L', 0);
    sim.set('C:EXTLT_LAND_R', 0);
    sim.set('C:EXTLT_NOSE', 0);
    sim.set('C:INTLT_DOME', 1);
    sim.set('C:INTLT_OVHD_INTEG', 0.7);
    sim.set('C:INTEG_MAIN_PNL_PED', 0.7);
    sim.set('C:FLOOD_MAIN_PNL', 0.4);
    sim.set('C:FLOOD_PED', 0.4);
    sim.set('C:SIGNS_SEAT_BELTS', 0);
    sim.set('C:SIGNS_NO_SMOKING', 1);
    sim.set('C:SIGNS_EMER_EXIT_LT', 1);
  },
  /** EVAC COMMAND ON (EVAC flashing, horn). */
  evac: (sim) => sim.set('C:EVAC_COMMAND', 1),
  /** GPWS self-test (GPWS/G/S pb pressed on ground). */
  gpwsTest: (sim) => {
    after(sim, 0.5, () => sim.set('C:MAIN_GPWS_GS_CAPT', 1), 'gpws-press');
    after(sim, 0.8, () => sim.set('C:MAIN_GPWS_GS_CAPT', 0), 'gpws-release');
  },
  /** Wipers FAST both sides. */
  wipers: (sim) => { sim.set('C:WIPER_CAPT', 2); sim.set('C:WIPER_FO', 2); },
};
