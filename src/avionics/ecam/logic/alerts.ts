/**
 * ECAM warnings & cautions catalogue (A320ceo CFM56-5B, texts as displayed on the E/WD).
 *
 * Each entry: level (3 red warning / 2 amber caution / 1 amber caution without attention getters),
 * system title (underlined), title text, flight-phase inhibition of NEW occurrences, sensing
 * condition, called SD page, procedure lines (cyan actions disappear when sensed as done) and
 * STATUS page contribution.
 *
 * Order in this list = priority inside a given level (the FWC sorts level 3 > 2 > 1).
 */
import type { Acq, EngAcq } from './acq';
import { AlertDef, ProcLine, SdPage } from './types';

/** Signals computed by the FWC that alerts depend on. */
export interface AlertEnv {
  a: Acq;
  phase(): number;
  /** T.O CONFIG pb pressed, held min 1.5 s (config warnings test). */
  toCfgTest(): boolean;
  /** T.O CONFIG pb pressed in phase 2 or phase 3 reached (FLAP/MCDU, speeds checks). */
  toCfgChecked(): boolean;
  /** Config warnings latched in phases 3/4 (reset in phase 5 or when corrected). */
  cfg: { slats: boolean; flaps: boolean; spdBrk: boolean; pitch: boolean; rud: boolean; park: boolean };
  /** Engine "was running" memory for ENG FAIL. */
  engFail: [boolean, boolean];
  /** Seconds since engine n reached idle (0 when not running). */
  engRunFor: [number, number];
  /** Seconds since fire pb n was pushed (for the 10 s agent countdown). */
  firePbFor: [number, number];
  /** Cargo smoke test / detection. */
  cargoSmoke: { fwd: boolean; aft: boolean };
  /** Flags from light readings (FAULT legends driven by system owners). */
  light(id: string): boolean;
}

const pad = (label: string, value: string, width = 24) => {
  // " -LABEL.......VALUE" with dots to fill the 24-column line
  const dots = Math.max(1, width - label.length - value.length);
  return label + '.'.repeat(dots) + value;
};
/** Action line (cyan) with the standard 24 columns: ' -ENG MASTER 1.......OFF'. */
export const act = (label: string, value: string, done?: () => boolean, show?: () => boolean): ProcLine => ({
  text: pad(` -${label}`, value), c: 'C', done, show,
});
/** Condition / note line (white). */
export const note = (text: string, show?: () => boolean): ProcLine => ({ text, c: 'W', show });

export function buildAlerts(env: AlertEnv): AlertDef[] {
  const { a } = env;
  const ph = () => env.phase();
  const gnd = () => a.onGround;
  const E = (n: 1 | 2): EngAcq => a.eng[n - 1];
  const thrIdle = (n?: 1 | 2) => (n ? E(n).tla < 2.5 : E(1).tla < 2.5 && E(2).tla < 2.5);
  const list: AlertDef[] = [];

  /* ======================================================== LEVEL 3 */

  // ---- ENG 1(2) FIRE
  for (const n of [1, 2] as const) {
    const e = () => E(n);
    list.push({
      id: `ENG${n}_FIRE`, level: 3, sys: `ENG ${n} FIRE`, title: '', inhibit: [], page: SdPage.ENG, noClear: true,
      confirm: 0,
      cond: () => e().fireDet || e().fireTest,
      procedure: () => {
        if (gnd()) {
          return [
            act('THR LEVERS', 'IDLE', () => thrIdle()),
            note('  .WHEN A/C IS STOPPED:'),
            act('PARKING BRK', 'ON', () => a.parkBrake),
            act('ATC', 'NOTIFY'),
            act('CABIN CREW', 'ALERT'),
            act(`ENG MASTER ${n}`, 'OFF', () => !e().master),
            act(`ENG ${n} FIRE P/B`, 'PUSH', () => e().firePbOut),
            act('AGENT 1', 'DISCH', () => e().agent1),
            act('AGENT 2', 'DISCH', () => e().agent2),
            act('EMER EVAC PROC', 'APPLY'),
          ];
        }
        const cd = Math.max(0, Math.ceil(10 - env.firePbFor[n - 1]));
        return [
          act(`THR LEVER ${n}`, 'IDLE', () => thrIdle(n)),
          act(`ENG MASTER ${n}`, 'OFF', () => !e().master),
          act(`ENG ${n} FIRE P/B`, 'PUSH', () => e().firePbOut),
          e().firePbOut && cd > 0
            ? { text: pad(` -AGENT1 AFTER ${cd}S`, 'DISCH'), c: 'C', done: () => e().agent1 }
            : act('AGENT 1', 'DISCH', () => e().agent1),
          act('ATC', 'NOTIFY'),
          note('  .IF FIRE AFTER 30 S:'),
          act('AGENT 2', 'DISCH', () => e().agent2),
        ];
      },
      status: () => ({ inop: e().firePbOut ? [`ENG ${n}`] : [] }),
    });
  }

  // ---- APU FIRE
  list.push({
    id: 'APU_FIRE', level: 3, sys: 'APU FIRE', title: '', inhibit: [], page: SdPage.APU, noClear: true, confirm: 0,
    cond: () => a.apuFireDet || a.apuFireTest,
    procedure: () => [
      act('APU FIRE P/B', 'PUSH', () => a.apuFirePbOut),
      gnd()
        ? act('AGENT', 'DISCH', () => a.apuAgent)
        : act('AGENT AFTER 10S', 'DISCH', () => a.apuAgent),
      act('MASTER SW', 'OFF', () => !a.apuMaster),
    ],
    status: () => ({ inop: a.apuFirePbOut ? ['APU'] : [] }),
  });

  // ---- SMOKE FWD / AFT CARGO SMOKE (cargo smoke detection or test)
  for (const [k, name] of [['fwd', 'FWD'], ['aft', 'AFT']] as const) {
    list.push({
      id: `SMOKE_${name}_CARGO`, level: 3, sys: 'SMOKE', title: `${name} CARGO SMOKE`, inhibit: [4, 5, 7, 8], confirm: 0,
      cond: () => env.cargoSmoke[k],
      procedure: () => [
        act('CAB FANS', 'OFF', () => !a.sim.getB('C:VENT_CAB_FANS')),
        act('AGENT', 'DISCH'),
      ],
    });
  }

  // ---- ENG 1(2) OIL LO PR (red line 13 psi)
  for (const n of [1, 2] as const) {
    list.push({
      id: `ENG${n}_OIL_LO_PR`, level: 3, sys: `ENG ${n}`, title: 'OIL LO PR', inhibit: [1, 4, 5, 8, 10], page: SdPage.ENG,
      confirm: 5,
      cond: () => E(n).running && E(n).fadec && env.engRunFor[n - 1] > 20 && E(n).oilPress < 13,
      procedure: () => [act(`THR LEVER ${n}`, 'IDLE', () => thrIdle(n)), act(`ENG MASTER ${n}`, 'OFF', () => !E(n).master)],
      status: () => ({ inop: [`ENG ${n}`] }),
    });
  }

  // ---- CONFIG warnings (T.O CONFIG test or T.O power with wrong configuration)
  list.push({
    id: 'CONFIG_SLATS', level: 3, sys: 'CONFIG', title: '', sub: ['SLATS NOT IN T.O CONFIG'], inhibit: [5, 6, 7, 8],
    confirm: 0, noClear: true, cond: () => env.cfg.slats,
  });
  list.push({
    id: 'CONFIG_FLAPS', level: 3, sys: 'CONFIG', title: '', sub: ['FLAPS NOT IN T.O CONFIG'], inhibit: [5, 6, 7, 8],
    confirm: 0, noClear: true, cond: () => env.cfg.flaps,
  });
  list.push({
    id: 'CONFIG_SPD_BRK', level: 3, sys: 'CONFIG', title: '', sub: ['SPD BRK NOT RETRACTED'], inhibit: [5, 6, 7, 8],
    confirm: 0, noClear: true, page: SdPage.FCTL, cond: () => env.cfg.spdBrk,
  });
  list.push({
    id: 'CONFIG_PITCH_TRIM', level: 3, sys: 'CONFIG', title: 'PITCH TRIM', sub: ['    NOT IN T.O RANGE'],
    inhibit: [5, 6, 7, 8], confirm: 0, noClear: true, page: SdPage.FCTL, cond: () => env.cfg.pitch,
  });
  list.push({
    id: 'CONFIG_RUD_TRIM', level: 3, sys: 'CONFIG', title: 'RUD TRIM', sub: ['    NOT IN T.O RANGE'],
    inhibit: [5, 6, 7, 8], confirm: 0, noClear: true, page: SdPage.FCTL, cond: () => env.cfg.rud,
  });
  list.push({
    id: 'CONFIG_PARK_BRK', level: 3, sys: 'CONFIG', title: 'PARK BRK ON', inhibit: [1, 4, 5, 6, 7, 8, 9, 10],
    confirm: 0, noClear: true, cond: () => env.cfg.park,
  });

  /* ======================================================== LEVEL 2 */

  // ---- ENG 1(2) START FAULT (FADEC auto start abort; cause published by sys-air)
  const startCause = (c: number) =>
    ({ 1: ' IGN FAULT', 2: ' EGT OVERLIMIT', 3: ' STALL', 4: ' HUNG START', 5: ' START VALVE FAULT', 6: ' NO LIGHT UP', 7: ' LOW START AIR' } as Record<number, string>)[c];
  for (const n of [1, 2] as const) {
    list.push({
      id: `ENG${n}_START_FAULT`, level: 2, sys: `ENG ${n}`, title: 'START FAULT', inhibit: [3, 4, 5, 7, 8],
      page: SdPage.ENG, confirm: 0,
      cond: () => E(n).startFault > 0,
      sub: () => (startCause(Math.round(E(n).startFault)) ? [startCause(Math.round(E(n).startFault))!] : []),
      procedure: () => [
        act(`MAN START ${n}`, 'OFF', () => !E(n).manStart, () => E(n).manStart),
        act(`ENG MASTER ${n}`, 'OFF', () => !E(n).master),
      ],
    });
  }

  // ---- ENG 1(2) THR LEVER ABV IDLE (engine start on ground with thrust lever not at idle)
  for (const n of [1, 2] as const) {
    list.push({
      id: `ENG${n}_THR_ABV_IDLE`, level: 2, sys: `ENG ${n}`, title: 'THR LEVER ABV IDLE', inhibit: [3, 4, 5, 6, 7, 8],
      page: SdPage.ENG, confirm: 0.5,
      cond: () => gnd() && E(n).master && !E(n).running && E(n).tla > 3 && (a.engModeSel === 2 || E(n).manStart),
      procedure: () => [act(`THR LEVER ${n}`, 'IDLE', () => thrIdle(n))],
    });
  }

  // ---- ENG 1(2) FAIL (engine was running and core speed decayed below idle, master still ON)
  for (const n of [1, 2] as const) {
    list.push({
      id: `ENG${n}_FAIL`, level: 2, sys: `ENG ${n}`, title: 'FAIL', inhibit: [4, 5, 7, 8], page: SdPage.ENG, confirm: 1,
      cond: () => env.engFail[n - 1],
      procedure: () => gnd()
        ? [act(`ENG MASTER ${n}`, 'OFF', () => !E(n).master)]
        : [
          act('ENG MODE SEL', 'IGN', () => a.engModeSel === 2),
          act(`THR LEVER ${n}`, 'IDLE', () => thrIdle(n)),
          note('  .IF NO RELIGHT AFTER 30S:'),
          act(`ENG MASTER ${n}`, 'OFF', () => !E(n).master),
        ],
      status: () => ({ inop: [`ENG ${n}`] }),
    });
  }

  // ---- ENG THR LEVERS NOT SET (FLX detent without FLX temperature)
  list.push({
    id: 'ENG_THR_NOT_SET', level: 2, sys: 'ENG', title: 'THR LEVERS NOT SET', inhibit: [1, 4, 5, 6, 7, 8, 10], confirm: 0.5,
    cond: () => {
      const mct = (tla: number) => tla > 33.3 && tla < 36.7;
      return gnd() && a.anyEngRunning && (mct(E(1).tla) || mct(E(2).tla)) && a.flexTemp <= 0 && E(1).tla < 36.7 && E(2).tla < 36.7;
    },
    procedure: () => [act('THR LEVERS', 'TOGA', () => E(1).tla > 43 && E(2).tla > 43)],
  });

  // ---- T.O SPEEDS NOT INSERTED / V1/VR/V2 DISAGREE (T.O CONFIG pb or phase 3)
  list.push({
    id: 'TO_SPEEDS_NOT_INSERTED', level: 2, sys: 'T.O', title: 'SPEEDS NOT INSERTED', inhibit: [1, 4, 5, 6, 7, 8, 9, 10],
    confirm: 0, cond: () => env.toCfgChecked() && (a.v1 <= 0 || a.vr <= 0 || a.v2 <= 0) && a.sim.has('S:FMGS_V1'),
  });
  list.push({
    id: 'TO_V1VRV2_DISAGREE', level: 2, sys: 'T.O', title: 'V1/VR/V2 DISAGREE', inhibit: [1, 4, 5, 6, 7, 8, 9, 10],
    confirm: 0, cond: () => env.toCfgChecked() && a.v1 > 0 && a.vr > 0 && a.v2 > 0 && (a.v1 > a.vr || a.vr > a.v2),
  });

  // ---- F/CTL FLAP/MCDU DISAGREE, PITCH TRIM/MCDU/CG DISAGREE
  list.push({
    id: 'FCTL_FLAP_MCDU', level: 2, sys: 'F/CTL', title: 'FLAP/MCDU DISAGREE', inhibit: [1, 4, 5, 6, 7, 8, 9, 10], confirm: 0,
    cond: () => env.toCfgChecked() && a.toConf >= 1 && a.toConf <= 3 && a.flapsLever >= 1 && a.flapsLever <= 3 && a.flapsLever !== Math.round(a.toConf),
  });
  list.push({
    id: 'FCTL_PITCH_MCDU', level: 2, sys: 'F/CTL', title: 'PITCH TRIM/MCDU/CG', sub: ['     DISAGREE'],
    inhibit: [1, 4, 5, 6, 7, 8, 9, 10], confirm: 0,
    cond: () => env.toCfgChecked() && a.perfToDone && a.sim.has('S:FMGS_THS_FOR') && !env.cfg.pitch && Math.abs(a.thsFor - a.ths) > 1.2,
  });

  // ---- DOOR (cabin / cargo doors not closed with an engine running)
  const doorAlerts: Array<[string, string]> = [
    ['PAX_L1', 'L FWD CABIN'], ['PAX_R1', 'R FWD CABIN'], ['PAX_L2', 'L AFT CABIN'], ['PAX_R2', 'R AFT CABIN'],
    ['CARGO_FWD', 'FWD CARGO'], ['CARGO_AFT', 'AFT CARGO'], ['CARGO_BULK', 'BULK CARGO'],
  ];
  for (const [v, name] of doorAlerts) {
    list.push({
      id: `DOOR_${v}`, level: 2, sys: 'DOOR', title: name, inhibit: [1, 4, 5, 7, 8, 10], page: SdPage.DOOR, confirm: 1,
      cond: () => a.doors[v] > 0.02 && (a.anyEngRunning || !gnd()),
    });
  }

  // ---- ELEC
  for (const n of [1, 2] as const) {
    list.push({
      id: `ELEC_GEN${n}_FAULT`, level: 2, sys: 'ELEC', title: `GEN ${n} FAULT`, inhibit: [1, 4, 5, 7, 8, 10], page: SdPage.ELEC,
      confirm: 1,
      cond: () => E(n).running && env.engRunFor[n - 1] > 5 && E(n).genPb && !E(n).genOn && !E(n).firePbOut && a.sim.has(`S:ELEC_GEN${n}_ON`),
      procedure: () => [
        act(`GEN ${n}`, 'OFF THEN ON'),
        note('   .IF UNSUCCESSFUL:'),
        act(`GEN ${n}`, 'OFF', () => !E(n).genPb),
      ],
      status: () => ({ inop: [`GEN ${n}`] }),
    });
  }
  list.push({
    id: 'ELEC_APU_GEN_FAULT', level: 2, sys: 'ELEC', title: 'APU GEN FAULT', inhibit: [4, 5, 7, 8], page: SdPage.ELEC, confirm: 5,
    cond: () => a.apuAvail && a.sim.getB('C:ELEC_APU_GEN') && a.sim.has('S:ELEC_APU_GEN_V') && a.sim.get('S:ELEC_APU_GEN_V') < 100,
    procedure: () => [
      act('APU GEN', 'OFF THEN ON'),
      note('   .IF UNSUCCESSFUL:'),
      act('APU GEN', 'OFF', () => !a.sim.getB('C:ELEC_APU_GEN')),
    ],
    status: () => ({ inop: ['APU GEN'] }),
  });
  list.push({
    id: 'ELEC_AC_ESS_BUS_FAULT', level: 2, sys: 'ELEC', title: 'AC ESS BUS FAULT', inhibit: [4, 5, 7, 8], page: SdPage.ELEC,
    confirm: 1,
    cond: () => (a.ac1 || a.ac2) && !a.acEss,
    procedure: () => [act('AC ESS FEED', 'ALTN', () => !a.sim.getB('C:ELEC_AC_ESS_FEED'))],
    status: () => ({ inop: ['AC ESS BUS'] }),
  });

  // ---- HYD
  for (const n of [1, 2] as const) {
    const sysL = n === 1 ? 'G' : 'Y';
    const pump = n === 1 ? 'GREEN ENG 1 PUMP' : 'YELLOW ENG 2 PUMP';
    list.push({
      id: `HYD_${sysL}_ENG${n}_PUMP_LO_PR`, level: 2, sys: 'HYD', title: `${sysL} ENG ${n} PUMP LO PR`,
      inhibit: [1, 3, 4, 5, 7, 8, 10], page: SdPage.HYD, confirm: 3,
      cond: () => E(n).running && env.engRunFor[n - 1] > 3 && (!E(n).edpPb || !E(n).edpOn) && a.sim.has(`S:HYD_ENG${n}_PUMP_ON`),
      procedure: () => [act(pump, 'OFF', () => !E(n).edpPb)],
      status: () => ({ inop: [`${sysL} ENG ${n} PUMP`] }),
    });
  }
  list.push({
    id: 'HYD_B_ELEC_PUMP_LO_PR', level: 2, sys: 'HYD', title: 'B ELEC PUMP LO PR', inhibit: [1, 3, 4, 5, 7, 8, 10], page: SdPage.HYD,
    confirm: 3,
    cond: () => a.anyEngRunning && Math.max(env.engRunFor[0], env.engRunFor[1]) > 5 && (!a.bElecPb || !a.bElecPumpOn) && a.sim.has('S:HYD_B_ELEC_PUMP_ON'),
    procedure: () => [act('BLUE ELEC PUMP', 'OFF', () => !a.bElecPb)],
    status: () => ({ inop: ['B ELEC PUMP'] }),
  });
  list.push({
    id: 'HYD_Y_ELEC_PUMP_LO_PR', level: 2, sys: 'HYD', title: 'Y ELEC PUMP LO PR', inhibit: [3, 4, 5, 7, 8], page: SdPage.HYD,
    confirm: 3,
    cond: () => a.yElecPb && !a.yElecPumpOn && a.ac2 && a.sim.has('S:HYD_Y_ELEC_PUMP_ON'),
    procedure: () => [act('YELLOW ELEC PUMP', 'OFF', () => !a.yElecPb)],
    status: () => ({ inop: ['Y ELEC PUMP'] }),
  });
  const sysLoPr: Array<[string, () => number, () => boolean]> = [
    ['G', () => a.hydG, () => E(1).running || (E(2).running && a.ptuPb)],
    ['B', () => a.hydB, () => a.anyEngRunning && a.bElecPb],
    ['Y', () => a.hydY, () => E(2).running || a.yElecPb],
  ];
  for (const [s, p, expected] of sysLoPr) {
    list.push({
      id: `HYD_${s}_SYS_LO_PR`, level: 2, sys: 'HYD', title: `${s} SYS LO PR`, inhibit: [1, 3, 4, 5, 7, 8, 10], page: SdPage.HYD,
      confirm: 5,
      cond: () => a.anyEngRunning && Math.max(env.engRunFor[0], env.engRunFor[1]) > 10 && expected() && p() < 1450 &&
        a.sim.has(`S:HYD_${s}_PRESS`),
      status: () => ({ inop: [`${s} HYD`] }),
    });
  }

  // ---- FUEL
  const pumps: Array<[number, string, string]> = [[0, 'L TK PUMP 1', 'LI'], [1, 'L TK PUMP 2', 'LI'], [2, 'R TK PUMP 1', 'RI'], [3, 'R TK PUMP 2', 'RI']];
  for (const [i, name, tank] of pumps) {
    list.push({
      id: `FUEL_${name.replace(/ /g, '_')}_LO_PR`, level: 2, sys: 'FUEL', title: `${name} LO PR`, inhibit: [1, 3, 4, 5, 7, 8, 10],
      page: SdPage.FUEL, confirm: 2,
      cond: () => !a.wingPumpPb[i] && a.sim.get(`S:FUEL_${tank}_KG`) > 50,
      procedure: () => [act(name, 'OFF', () => !a.wingPumpPb[i])],
      status: () => ({ inop: [name] }),
    });
  }
  list.push({
    id: 'FUEL_LR_WING_LO_LVL', level: 2, sys: 'FUEL', title: 'L+R WING TK LO LVL', inhibit: [3, 4, 5, 7, 8, 9], page: SdPage.FUEL,
    confirm: 30,
    cond: () => a.sim.has('S:FUEL_LI_KG') && a.fuelLi < 750 && a.fuelRi < 750,
    procedure: () => [
      act('FUEL MODE SEL', 'MAN', () => !a.fuelModeAuto, () => a.fuelC > 0),
      act('L TK PUMP 1', 'ON', () => a.wingPumpPb[0]),
      act('L TK PUMP 2', 'ON', () => a.wingPumpPb[1]),
      act('R TK PUMP 1', 'ON', () => a.wingPumpPb[2]),
      act('R TK PUMP 2', 'ON', () => a.wingPumpPb[3]),
    ],
  });
  for (const [side, v] of [['L', () => a.fuelLi], ['R', () => a.fuelRi]] as const) {
    list.push({
      id: `FUEL_${side}_WING_LO_LVL`, level: 2, sys: 'FUEL', title: `${side} WING TK LO LVL`, inhibit: [3, 4, 5, 7, 8, 9],
      page: SdPage.FUEL, confirm: 30,
      cond: () => a.sim.has('S:FUEL_LI_KG') && v() < 750 && !(a.fuelLi < 750 && a.fuelRi < 750),
      procedure: () => [
        act('FUEL MODE SEL', 'MAN', () => !a.fuelModeAuto, () => a.fuelC > 0),
        note('  .IF NO FUEL LEAK AND'),
        note('   FUEL IMBALANCE:'),
        act('FUEL X FEED', 'ON', () => a.xfeedPb),
      ],
    });
  }

  // ---- AIR / COND / VENT (fault legends driven by sys-air)
  for (const n of [1, 2] as const) {
    list.push({
      id: `AIR_PACK${n}_FAULT`, level: 2, sys: 'AIR', title: `PACK ${n} FAULT`, inhibit: [3, 4, 5, 7, 8], page: SdPage.BLEED, confirm: 2,
      // no caution for the valve disagree that is normal with no bleed air on the ground (GPU only)
      cond: () => env.light(`AIR_PACK${n}_FAULT`) && a.packPb[n - 1] && E(n).bleedPress > 8,
      procedure: () => [act(`PACK ${n}`, 'OFF', () => !a.packPb[n - 1])],
      status: () => ({ inop: [`PACK ${n}`] }),
    });
  }
  for (const n of [1, 2] as const) {
    list.push({
      id: `AIR_PACK${n}_OFF`, level: 2, sys: 'AIR', title: `PACK ${n} OFF`, inhibit: [1, 2, 3, 4, 5, 7, 8, 9, 10], page: SdPage.BLEED,
      confirm: 60,
      cond: () => !a.packPb[n - 1] && !gnd(),
    });
  }
  for (const n of [1, 2] as const) {
    list.push({
      id: `AIR_ENG${n}_BLEED_FAULT`, level: 2, sys: 'AIR', title: `ENG ${n} BLEED FAULT`, inhibit: [3, 4, 5, 7, 8], page: SdPage.BLEED,
      confirm: 2,
      cond: () => env.light(`AIR_ENG${n}_BLEED_FAULT`) && E(n).running,
      status: () => ({ inop: [`ENG ${n} BLEED`] }),
    });
  }
  list.push({
    id: 'AIR_APU_BLEED_FAULT', level: 2, sys: 'AIR', title: 'APU BLEED FAULT', inhibit: [3, 4, 5, 7, 8], page: SdPage.BLEED, confirm: 2,
    cond: () => env.light('AIR_APU_BLEED_FAULT'),
    status: () => ({ inop: ['APU BLEED'] }),
  });
  list.push({
    id: 'COND_HOT_AIR_FAULT', level: 2, sys: 'COND', title: 'HOT AIR FAULT', inhibit: [3, 4, 5, 7, 8], page: SdPage.COND, confirm: 2,
    cond: () => env.light('AIR_HOT_AIR_FAULT') && a.hotAirPb,
    procedure: () => [act('HOT AIR', 'OFF', () => !a.hotAirPb)],
    status: () => ({ inop: ['HOT AIR'] }),
  });
  list.push({
    id: 'VENT_BLOWER_FAULT', level: 2, sys: 'VENT', title: 'BLOWER FAULT', inhibit: [3, 4, 5, 7, 8], confirm: 5,
    cond: () => env.light('VENT_BLOWER_FAULT') && a.sim.getB('C:VENT_BLOWER'),
    procedure: () => [act('BLOWER', 'OVRD', () => !a.sim.getB('C:VENT_BLOWER'))],
    status: () => ({ inop: ['BLOWER'] }),
  });
  list.push({
    id: 'VENT_EXTRACT_FAULT', level: 2, sys: 'VENT', title: 'EXTRACT FAULT', inhibit: [3, 4, 5, 7, 8], confirm: 5,
    cond: () => env.light('VENT_EXTRACT_FAULT') && a.sim.getB('C:VENT_EXTRACT'),
    procedure: () => [act('EXTRACT', 'OVRD', () => !a.sim.getB('C:VENT_EXTRACT'))],
    status: () => ({ inop: ['EXTRACT'] }),
  });

  // ---- BRAKES
  list.push({
    id: 'BRAKES_HOT', level: 2, sys: 'BRAKES', title: 'HOT', inhibit: [4, 8, 9, 10], page: SdPage.WHEEL, confirm: 1,
    cond: () => Math.max(...a.brkTemps) > 300,
    procedure: () => gnd()
      ? [
        { text: ' -PARK BRK:PREFER CHOCKS', c: 'C' },
        act('BRK FAN', 'ON', () => a.brkFanPb),
        { text: ' -DELAY T.O FOR COOL', c: 'C', show: () => ph() === 2 || ph() === 9 },
      ]
      : [
        note('   .IF PERF PERMITS :'),
        act('L/G', 'DN FOR COOL', () => a.sim.get('C:GEAR_LEVER') > 0.5),
        { text: ' MAX SPEED.......250/.60', c: 'C' },
      ],
  });
  list.push({
    id: 'BRAKES_ASKID_NWS_OFF', level: 2, sys: 'BRAKES', title: 'A/SKID N/WS OFF', inhibit: [4, 5], page: SdPage.WHEEL, confirm: 1,
    cond: () => !a.askidNws && (a.dc1 || a.dc2 || a.dcEss),
    procedure: () => [{ text: ' MAX BRK PR......1000PSI', c: 'C' }],
    status: () => ({ left: [{ text: 'MAX BRK PR......1000PSI', c: 'C' }], inop: ['ANTI SKID', 'N/W STRG'] }),
  });
  list.push({
    id: 'BRAKES_PARK_BRK_LO_PR', level: 2, sys: 'BRAKES', title: 'PARK BRK LO PR', inhibit: [3, 4, 5, 6, 7, 8], page: SdPage.WHEEL,
    confirm: 3,
    cond: () => a.parkBrake && a.sim.has('S:BRK_ACCU_PRESS') && a.brkAccu < 1500,
  });

  // ---- F/CTL & AUTO FLT computers
  const comps: Array<[string, string, string, number[], string]> = [
    ['ELAC1', 'F/CTL', 'ELAC 1 FAULT', [3, 4, 5, 7, 8], 'ELAC 1'],
    ['ELAC2', 'F/CTL', 'ELAC 2 FAULT', [3, 4, 5, 7, 8], 'ELAC 2'],
    ['SEC1', 'F/CTL', 'SEC 1 FAULT', [3, 4, 5], 'SEC 1'],
    ['SEC2', 'F/CTL', 'SEC 2 FAULT', [3, 4, 5], 'SEC 2'],
    ['SEC3', 'F/CTL', 'SEC 3 FAULT', [3, 4, 5], 'SEC 3'],
    ['FAC1', 'AUTO FLT', 'FAC 1 FAULT', [3, 4, 5, 7, 8], 'FAC 1'],
    ['FAC2', 'AUTO FLT', 'FAC 2 FAULT', [3, 4, 5, 7, 8], 'FAC 2'],
  ];
  for (const [id, sys, title, inhibit, name] of comps) {
    const pbId = `C:FLTCTL_${id}`;
    const onVar = `S:FCTL_${id}_ON`;
    list.push({
      id: `FCTL_${id}_FAULT`, level: 2, sys, title, inhibit, page: sys === 'F/CTL' ? SdPage.FCTL : undefined, confirm: 5,
      cond: () => a.sim.has(onVar) && !a.sim.getB(onVar) && (a.dcEss || a.dc1 || a.dc2),
      procedure: () => [
        act(name, 'OFF THEN ON'),
        note('   .IF UNSUCCESSFUL :'),
        act(name, 'OFF', () => !a.sim.getB(pbId)),
      ],
      status: () => ({ inop: [name] }),
    });
  }

  // ---- NAV
  list.push({
    id: 'NAV_IR_NOT_ALIGNED', level: 2, sys: 'NAV', title: 'IR NOT ALIGNED', inhibit: [1, 4, 5, 6, 7, 8, 10], confirm: 1,
    cond: () => {
      const aligning = a.irState.some((s) => s === 1);
      const posProblem = !a.posEntered && a.irState.some((s, i) => s === 1 && a.irRemain[i] <= 60);
      return (ph() === 3 && aligning) || ((ph() === 2 || ph() === 9) && posProblem);
    },
    sub: () => {
      const inAlign = [0, 1, 2].filter((i) => a.irState[i] === 1).map((i) => i + 1);
      const out: string[] = [];
      if (!a.posEntered && inAlign.length) out.push(' POSITION MISSING');
      else if (inAlign.length) out.push(` IR ${inAlign.join('+')} IN ALIGN`);
      return out;
    },
    procedure: () => [act('PRESENT POS', 'INSERT', () => a.posEntered, () => !a.posEntered)],
  });
  for (const n of [1, 2, 3]) {
    list.push({
      id: `NAV_IR${n}_FAULT`, level: 2, sys: 'NAV', title: `IR ${n} FAULT`, inhibit: [3, 4, 5, 7, 8], confirm: 2,
      cond: () => a.irState[n - 1] === 4,
      procedure: () => [act('ATT HDG SWTG', 'AS RQRD')],
      status: () => ({ inop: [`IR ${n}`] }),
    });
    list.push({
      id: `NAV_ADR${n}_FAULT`, level: 2, sys: 'NAV', title: `ADR ${n} FAULT`, inhibit: [3, 4, 5, 7, 8], confirm: 3,
      cond: () => a.irMode[n - 1] > 0 && a.irState[n - 1] > 0 && (!a.adrPb[n - 1] || (a.sim.has(`S:ADIRS_ADR${n}_ON`) && !a.adrOn[n - 1])),
      procedure: () => [act('AIR DATA SWTG', 'AS RQRD'), act(`ADR ${n} P/B`, 'OFF', () => !a.adrPb[n - 1])],
      status: () => ({ inop: [`ADR ${n}`] }),
    });
  }

  /* ======================================================== LEVEL 1 */
  for (const n of [1, 2] as const) {
    list.push({
      id: `ELEC_BAT${n}_OFF`, level: 1, sys: 'ELEC', title: `BAT ${n} OFF`, inhibit: [1, 3, 4, 5, 7, 8, 10], page: SdPage.ELEC,
      confirm: 1,
      cond: () => !a.sim.getB(`C:ELEC_BAT${n}`) && (a.hot1 || a.hot2),
      status: () => ({ inop: [`BAT ${n}`] }),
    });
  }

  return list;
}
