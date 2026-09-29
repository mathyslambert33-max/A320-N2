/** Variables forced by the dev harness with `&power=1` so panels/displays can be viewed without the systems. */
export const FAKE_POWER_VARS: Record<string, number> = {
  'S:ELEC_HOT_BUS1': 1, 'S:ELEC_HOT_BUS2': 1, 'S:ELEC_DC_BAT_BUS': 1, 'S:ELEC_DC_ESS_BUS': 1, 'S:ELEC_DC_ESS_SHED': 1,
  'S:ELEC_DC1_BUS': 1, 'S:ELEC_DC2_BUS': 1, 'S:ELEC_AC1_BUS': 1, 'S:ELEC_AC2_BUS': 1, 'S:ELEC_AC_ESS_BUS': 1,
  'S:ELEC_AC_ESS_SHED': 1, 'S:ELEC_AC_POWERED': 1, 'S:ELEC_EXT_PWR_ON': 1,
  'S:ELEC_BAT1_V': 28.1, 'S:ELEC_BAT2_V': 28.0,
  'S:ANN_POWER': 1,
  'S:FCU_POWERED': 1, 'S:FMGS_POWERED': 1, 'S:DMC_POWERED_1': 1, 'S:DMC_POWERED_2': 1, 'S:DMC_POWERED_3': 1,
  'S:ENG1_FADEC_ON': 1, 'S:ENG2_FADEC_ON': 1,
  'S:INTLT_INTEG_OVHD': 0.5, 'S:INTLT_INTEG_MAIN': 0.5, 'S:INTLT_INTEG_GLARE': 0.5,
};
