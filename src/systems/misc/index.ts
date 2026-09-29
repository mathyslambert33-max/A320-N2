/**
 * sys-misc module: ADIRS, fire protection, flight controls, landing gear / autobrake / steering, lighting,
 * cabin signs and the miscellaneous overhead / glareshield / pedestal panels. DOM-free (vitest-friendly).
 *
 * Sim systems (fixed 30 Hz step):
 *   12 'misc-annlt'  ANN LT TEST / DIM (S:INTLT_ANN_TEST/DIM) right after sys-elec's network (order 10)
 *   70 'misc'        ADIRS → fire → F/CTL → gear → lights → panels (after hydraulics 50 / brakes 55)
 *
 * Events listened to:
 *   adirs:position {lat, lon}      MCDU INIT A ALIGN IRS → present position for the IRs in alignment
 *   adirs:heading  {hdg, ir?}      heading entry for IRs in ATT mode (magnetic)
 *   misc:fire  {zone:'ENG1'|'ENG2'|'APU', on?, shots?}     debug fire injection
 *   misc:smoke {zone:'FWD'|'AFT'|'AVNCS', on?}             debug smoke injection
 *   misc:fault {id, on}   'IR1'..'IR3', 'ADR1'..'ADR3', 'ELAC1'…'FAC2', 'ENG1_LOOP_A'…  debug failures
 * Service: sim.services['sys-misc'] (also app.services) = { adirs, fire, fctl, gear, lights, panels, debug }.
 */
import type { Sim } from '../../core/sim';
import type { AlignMode } from '../../core/settings';
import { type Ctx, readPower, onGroundOf } from './common';
import { AdirsModel } from './adirs';
import { FireModel } from './fire';
import { FctlModel } from './fctl';
import { GearModel } from './gear';
import { LightsModel } from './lights';
import { PanelsModel } from './panels';

interface AppLike {
  sim: Sim;
  settings?: { get(): { irsAlign?: AlignMode } };
  services?: Record<string, any>;
}

export interface SysMiscService {
  adirs: AdirsModel;
  fire: FireModel;
  fctl: FctlModel;
  gear: GearModel;
  lights: LightsModel;
  panels: PanelsModel;
  debug: {
    /** Complete every energised NAV alignment now (position = aircraft position). */
    forceAligned(): void;
    injectFire(zone: 'ENG1' | 'ENG2' | 'APU', on?: boolean, shots?: number): void;
    injectSmoke(zone: 'FWD' | 'AFT' | 'AVNCS', on?: boolean): void;
    setFault(id: string, on: boolean): boolean;
  };
}

function makeCtx(sim: Sim, dt: number): Ctx {
  return {
    sim,
    dt,
    t: sim.time,
    p: readPower(sim),
    onGround: onGroundOf(sim),
    gs: Math.abs(sim.get('G:AC_GS_KT')),
  };
}

export default function install(app: AppLike): void {
  const sim = app.sim;
  const alignMode = (): AlignMode => app.settings?.get().irsAlign ?? 'real';
  const adirs = new AdirsModel(alignMode);
  const fire = new FireModel();
  const fctl = new FctlModel();
  const gear = new GearModel();
  const lights = new LightsModel();
  const panels = new PanelsModel();

  const setFault = (id: string, on: boolean): boolean => {
    const m = /^(IR|ADR)([123])$/.exec(id);
    if (m) { adirs.setFault(m[1] as 'IR' | 'ADR', Number(m[2]), on); return true; }
    if (fctl.setFault(id, on)) return true;
    return fire.setLoopFault(id, on);
  };

  const service: SysMiscService = {
    adirs, fire, fctl, gear, lights, panels,
    debug: {
      forceAligned: () => adirs.forceAligned(sim),
      injectFire: (zone, on = true, shots = 1) => fire.injectFire(zone, on, shots),
      injectSmoke: (zone, on = true) => {
        if (zone === 'AVNCS') panels.avncsSmoke = on;
        else fire.injectSmoke(zone, on);
      },
      setFault,
    },
  };
  sim.services['sys-misc'] = service;
  if (app.services) app.services['sys-misc'] = service;

  sim.on('adirs:position', (p?: { lat?: number; lon?: number }) => {
    if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
    const ok = adirs.enterPosition(sim, p.lat, p.lon);
    sim.emit('adirs:position_ack', { accepted: ok });
  });
  sim.on('adirs:heading', (p?: { hdg?: number; ir?: number }) => {
    if (!p || typeof p.hdg !== 'number') return;
    adirs.enterHeading(sim, p.hdg, p.ir);
  });
  sim.on('misc:fire', (p?: { zone?: string; on?: boolean; shots?: number }) => {
    if (p?.zone) fire.injectFire(p.zone, p.on ?? true, p.shots ?? 1);
  });
  sim.on('misc:smoke', (p?: { zone?: string; on?: boolean }) => {
    if (!p?.zone) return;
    if (p.zone === 'AVNCS') panels.avncsSmoke = p.on ?? true;
    else fire.injectSmoke(p.zone, p.on ?? true);
  });
  sim.on('misc:fault', (p?: { id?: string; on?: boolean }) => {
    if (p?.id) setFault(p.id, p.on ?? true);
  });

  sim.register({
    name: 'misc-annlt',
    order: 12,
    update(dt, s) {
      LightsModel.annLt(makeCtx(s, dt));
    },
  });

  sim.register({
    name: 'misc',
    order: 70,
    init(s) {
      adirs.init(s);
      fctl.init(makeCtx(s, 0));
    },
    update(dt, s) {
      const c = makeCtx(s, dt);
      adirs.update(c);
      fire.update(c);
      fctl.update(c);
      gear.update(c);
      lights.update(c);
      panels.update(c);
    },
  });
}
