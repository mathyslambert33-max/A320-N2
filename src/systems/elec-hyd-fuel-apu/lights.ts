/**
 * Annunciator lights of every control owned by this module (OVHD ELEC / HYD / FUEL / APU / EMER ELEC,
 * maintenance BLUE PUMP OVRD + HYD LEAK, BRK FAN). Lights need annunciator power (DC BAT / DC ESS),
 * except the EXT PWR AVAIL legend which is supplied by the ground power control unit (GPCU) itself.
 * ANN LT TEST / DIM are applied by the cockpit kit.
 */
import type { Sim } from '../../core/sim';
import type { Model } from './model';
import { engN2, pbIn } from './common';

export function updateLights(sim: Sim, m: Model): void {
  const e = m.elec;
  const P = e.annPower;
  const set = (id: string, on: boolean) => sim.set(id, P && on ? 1 : 0);
  const out = (id: string) => !pbIn(sim, id);

  // ---------------- ELEC ----------------
  set('L:ELEC_BAT1_FAULT', e.bat[0].fault);
  set('L:ELEC_BAT1_OFF', out('ELEC_BAT1') && e.dcBat);
  set('L:ELEC_BAT2_FAULT', e.bat[1].fault);
  set('L:ELEC_BAT2_OFF', out('ELEC_BAT2') && e.dcBat);
  set('L:ELEC_AC_ESS_FEED_FAULT', !e.acEss);
  set('L:ELEC_AC_ESS_FEED_ALTN', out('ELEC_AC_ESS_FEED'));
  const overload = Math.max(e.genLoad.GEN1, e.genLoad.GEN2, e.genLoad.APU) > 100;
  set('L:ELEC_GALY_CAB_FAULT', overload);
  set('L:ELEC_GALY_CAB_OFF', out('ELEC_GALY_CAB'));
  set('L:ELEC_COMMERCIAL_OFF', out('ELEC_COMMERCIAL'));
  for (let i = 0; i < 2; i++) {
    const n = i + 1;
    // IDG FAULT: oil outlet overheat (> 185 °C) or low oil pressure (inhibited below 14 % N2); off once disconnected.
    const idgFault = e.idgConnected[i] && engN2(sim, n) > 14 && e.idgTemp[i] > 185;
    const genFault = pbIn(sim, `ELEC_GEN${n}`) && !(i === 0 ? e.gen1C : e.gen2C);
    if (n === 1) {
      set('L:ELEC_IDG1_FAULT', idgFault);
      set('L:ELEC_GEN1_FAULT', genFault);
      set('L:ELEC_GEN1_OFF', out('ELEC_GEN1'));
    } else {
      set('L:ELEC_IDG2_FAULT', idgFault);
      set('L:ELEC_GEN2_FAULT', genFault);
      set('L:ELEC_GEN2_OFF', out('ELEC_GEN2'));
    }
  }
  set('L:ELEC_APU_GEN_FAULT', pbIn(sim, 'ELEC_APU_GEN') && m.apu.genAvailable && !e.apuC && !e.extC && !(e.gen1C && e.gen2C));
  set('L:ELEC_APU_GEN_OFF', out('ELEC_APU_GEN'));
  set('L:ELEC_BUS_TIE_OFF', out('ELEC_BUS_TIE'));
  // EXT PWR: AVAIL (GPCU powered) when plugged & parameters normal and not ON; ON while selected.
  sim.set('L:ELEC_EXT_PWR_AVAIL', sim.getB('G:GND_EXT_PWR') && !e.extOn ? 1 : 0); // GPCU powered
  set('L:ELEC_EXT_PWR_ON', e.extOn);

  // ---------------- EMER ELEC PWR ----------------
  const emerConfig = !e.ac1 && !e.ac2;
  const onGnd = !sim.has('G:AC_ON_GROUND') || sim.getB('G:AC_ON_GROUND');
  set('L:EMER_ELEC_RAT_MAN_ON_FAULT', emerConfig && !e.emerGenOn && !onGnd);
  set('L:EMER_ELEC_GEN1_LINE_SMOKE', sim.getB('S:VENT_AVNCS_SMOKE'));
  set('L:EMER_ELEC_GEN1_LINE_OFF', out('EMER_ELEC_GEN1_LINE'));

  // ---------------- HYD ----------------
  const h = m.hyd;
  set('L:HYD_ENG1_PUMP_FAULT', h.edpFault[0]);
  set('L:HYD_ENG1_PUMP_OFF', out('HYD_ENG1_PUMP'));
  set('L:HYD_ENG2_PUMP_FAULT', h.edpFault[1]);
  set('L:HYD_ENG2_PUMP_OFF', out('HYD_ENG2_PUMP'));
  set('L:HYD_BLUE_ELEC_PUMP_FAULT', h.bFault);
  set('L:HYD_BLUE_ELEC_PUMP_OFF', out('HYD_BLUE_ELEC_PUMP'));
  set('L:HYD_PTU_FAULT', h.ptuFault);
  set('L:HYD_PTU_OFF', out('HYD_PTU'));
  set('L:HYD_YELLOW_ELEC_PUMP_FAULT', h.yFault);
  set('L:HYD_YELLOW_ELEC_PUMP_ON', pbIn(sim, 'HYD_YELLOW_ELEC_PUMP'));
  set('L:MAINT_BLUE_PUMP_OVRD_ON', pbIn(sim, 'MAINT_BLUE_PUMP_OVRD'));
  set('L:MAINT_HYD_LEAK_G_OFF', out('MAINT_HYD_LEAK_G'));
  set('L:MAINT_HYD_LEAK_B_OFF', out('MAINT_HYD_LEAK_B'));
  set('L:MAINT_HYD_LEAK_Y_OFF', out('MAINT_HYD_LEAK_Y'));

  // ---------------- FUEL ----------------
  const f = m.fuel;
  set('L:FUEL_L_PUMP1_FAULT', f.pumpFault.L1);
  set('L:FUEL_L_PUMP1_OFF', out('FUEL_L_PUMP1'));
  set('L:FUEL_L_PUMP2_FAULT', f.pumpFault.L2);
  set('L:FUEL_L_PUMP2_OFF', out('FUEL_L_PUMP2'));
  set('L:FUEL_CTR_PUMP1_FAULT', f.pumpFault.C1);
  set('L:FUEL_CTR_PUMP1_OFF', out('FUEL_CTR_PUMP1'));
  set('L:FUEL_CTR_PUMP2_FAULT', f.pumpFault.C2);
  set('L:FUEL_CTR_PUMP2_OFF', out('FUEL_CTR_PUMP2'));
  set('L:FUEL_R_PUMP1_FAULT', f.pumpFault.R1);
  set('L:FUEL_R_PUMP1_OFF', out('FUEL_R_PUMP1'));
  set('L:FUEL_R_PUMP2_FAULT', f.pumpFault.R2);
  set('L:FUEL_R_PUMP2_OFF', out('FUEL_R_PUMP2'));
  set('L:FUEL_MODE_SEL_FAULT', f.modeSelFault);
  set('L:FUEL_MODE_SEL_MAN', out('FUEL_MODE_SEL'));
  set('L:FUEL_XFEED_ON', pbIn(sim, 'FUEL_XFEED'));
  set('L:FUEL_XFEED_OPEN', f.xfeedPos >= 0.999);

  // ---------------- APU ----------------
  const a = m.apu;
  set('L:APU_MASTER_FAULT', !!a.fault);
  set('L:APU_MASTER_ON', pbIn(sim, 'APU_MASTER'));
  set('L:APU_START_ON', a.startOn);
  set('L:APU_START_AVAIL', a.available);

  // ---------------- BRK FAN ----------------
  set('L:BRK_FAN_HOT', m.brk.temps.some((t) => t > 300));
  set('L:BRK_FAN_ON', pbIn(sim, 'BRK_FAN'));
}
