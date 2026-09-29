/**
 * Annunciator lights of the panels owned by sys-air: OVHD_AIRCOND, OVHD_ANTIICE, OVHD_PRESS, OVHD_VENT,
 * OVHD_ENG, OVHD_CARGO_VENT, MAINT FADEC GND PWR, pedestal ENG 1/2 FAULT.
 * All gated by annunciator power (S:ANN_POWER, else DC BAT / DC ESS). ANN LT TEST / DIM are handled by the kit.
 * "OFF" / "OVRD" / "MAN" (white) and "ON" (blue) legends follow the pushbutton position.
 */
import type { Sim } from '../../core/sim';
import { annPower, pbIn } from './common';
import type { AirEngModel } from './model';

export function updateLights(sim: Sim, m: AirEngModel): void {
  const p = annPower(sim);
  const v = (on: boolean) => (on && p ? 1 : 0);
  const out = (id: string) => !pbIn(sim, id);
  const inn = (id: string) => pbIn(sim, id);

  // AIR COND
  sim.set('L:AIR_PACK1_FAULT', v(m.packs.fault[0]));
  sim.set('L:AIR_PACK1_OFF', v(out('AIR_PACK1')));
  sim.set('L:AIR_PACK2_FAULT', v(m.packs.fault[1]));
  sim.set('L:AIR_PACK2_OFF', v(out('AIR_PACK2')));
  sim.set('L:AIR_HOT_AIR_FAULT', v(m.packs.hotAirFault));
  sim.set('L:AIR_HOT_AIR_OFF', v(out('AIR_HOT_AIR')));
  sim.set('L:AIR_ENG1_BLEED_FAULT', v(m.bleed.engFault[0]));
  sim.set('L:AIR_ENG1_BLEED_OFF', v(out('AIR_ENG1_BLEED')));
  sim.set('L:AIR_ENG2_BLEED_FAULT', v(m.bleed.engFault[1]));
  sim.set('L:AIR_ENG2_BLEED_OFF', v(out('AIR_ENG2_BLEED')));
  sim.set('L:AIR_APU_BLEED_FAULT', v(m.bleed.apuLeak));
  sim.set('L:AIR_APU_BLEED_ON', v(inn('AIR_APU_BLEED')));
  sim.set('L:AIR_RAM_AIR_ON', v(inn('AIR_RAM_AIR')));

  // ANTI ICE
  sim.set('L:AI_WING_FAULT', v(m.ai.waiFault));
  sim.set('L:AI_WING_ON', v(inn('AI_WING')));
  sim.set('L:AI_ENG1_FAULT', v(m.ai.naiFault[0]));
  sim.set('L:AI_ENG1_ON', v(inn('AI_ENG1')));
  sim.set('L:AI_ENG2_FAULT', v(m.ai.naiFault[1]));
  sim.set('L:AI_ENG2_ON', v(inn('AI_ENG2')));
  sim.set('L:AI_PROBE_WINDOW_ON', v(inn('AI_PROBE_WINDOW')));

  // CABIN PRESS
  sim.set('L:PRESS_MODE_SEL_FAULT', v(!m.press.cpcOk[0] && !m.press.cpcOk[1]));
  sim.set('L:PRESS_MODE_SEL_MAN', v(out('PRESS_MODE_SEL')));
  sim.set('L:PRESS_DITCHING_ON', v(inn('PRESS_DITCHING')));

  // VENTILATION
  sim.set('L:VENT_BLOWER_FAULT', v(m.vent.blowerFault));
  sim.set('L:VENT_BLOWER_OVRD', v(out('VENT_BLOWER')));
  sim.set('L:VENT_EXTRACT_FAULT', v(m.vent.extractFault));
  sim.set('L:VENT_EXTRACT_OVRD', v(out('VENT_EXTRACT')));
  sim.set('L:VENT_CAB_FANS_OFF', v(out('VENT_CAB_FANS')));

  // CARGO VENT
  sim.set('L:CARGO_VENT_AFT_ISOL_FAULT', v(m.vent.cargoFault));
  sim.set('L:CARGO_VENT_AFT_ISOL_OFF', v(out('CARGO_VENT_AFT_ISOL')));

  // ENG (overhead): MAN START; N1 MODE pbs exist only for IAE engines — lights stay off on the CFM aircraft.
  sim.set('L:ENG_MAN_START1_ON', v(inn('ENG_MAN_START1')));
  sim.set('L:ENG_MAN_START2_ON', v(inn('ENG_MAN_START2')));
  sim.set('L:ENG_N1_MODE1_FAULT', 0);
  sim.set('L:ENG_N1_MODE1_ON', 0);
  sim.set('L:ENG_N1_MODE2_FAULT', 0);
  sim.set('L:ENG_N1_MODE2_ON', 0);

  // Maintenance panel
  sim.set('L:MAINT_FADEC_GND_PWR1_ON', v(inn('MAINT_FADEC_GND_PWR1')));
  sim.set('L:MAINT_FADEC_GND_PWR2_ON', v(inn('MAINT_FADEC_GND_PWR2')));

  // Pedestal ENG 1/2 FAULT (automatic start abort / start fault).
  sim.set('L:ENG1_FAULT', v(m.eng[0].faultLight));
  sim.set('L:ENG2_FAULT', v(m.eng[1].faultLight));
}
