# Shared simulation variables (interface between modules)

All values are numbers (booleans 0/1). Prefixes: `C:` controls (catalog), `L:` lights (catalog),
`S:` system state, `G:` ground/scenario/environment (see `src/core/scenario.ts`).

**Rule:** only the owner writes a variable. Anything *read by another module* must be in this list.
Modules may create private variables freely **inside their own prefix** (e.g. `S:ELEC_...` for elec)
and must document their additions in `docs/vars/<module>.md`.
`node tools/check-vars.mjs` lists variables read but never written.

Owners (module folder → agent):
`sys-elec` = src/systems/elec-hyd-fuel-apu · `sys-air` = src/systems/air-eng · `sys-misc` = src/systems/misc ·
`ecam` = src/avionics/ecam · `pfdnd` = src/avionics/pfdnd · `mcdu` = src/avionics/mcdu · `pedestal` = src/cockpit/pedestal ·
`mainpanel` = src/cockpit/mainpanel · `world` = src/world · `ui` = src/ui

## Electrical (owner sys-elec)
| var | meaning |
|---|---|
| `S:ELEC_BAT1_V`, `S:ELEC_BAT2_V` | battery voltage (V) — ~25.5-25.9 at rest, 28 when charging |
| `S:ELEC_BAT1_A`, `S:ELEC_BAT2_A` | battery current (A, + charge / − discharge) |
| `S:ELEC_HOT_BUS1`, `S:ELEC_HOT_BUS2` | hot battery buses powered (always 1 unless battery flat) |
| `S:ELEC_DC_BAT_BUS` | DC BAT BUS powered |
| `S:ELEC_DC_ESS_BUS`, `S:ELEC_DC_ESS_SHED` | DC ESS / DC ESS SHED powered |
| `S:ELEC_DC1_BUS`, `S:ELEC_DC2_BUS` | DC 1 / DC 2 powered |
| `S:ELEC_AC1_BUS`, `S:ELEC_AC2_BUS` | AC BUS 1 / 2 powered |
| `S:ELEC_AC_ESS_BUS`, `S:ELEC_AC_ESS_SHED` | AC ESS / AC ESS SHED powered |
| `S:ELEC_STAT_INV` | static inverter operating |
| `S:ELEC_EXT_PWR_ON` | external power supplying the network |
| `S:ELEC_APU_GEN_ON`, `S:ELEC_GEN1_ON`, `S:ELEC_GEN2_ON` | generator line contactor closed (supplying) |
| `S:ELEC_GALLEY_SHED` | galley shed |
| `S:ELEC_AC_POWERED` | convenience: any main AC bus powered (1/0) |
| `S:ELEC_<SRC>_V/_HZ/_LOAD` | SD ELEC page values for EXT, APU_GEN, GEN1, GEN2, TR1, TR2, ESS_TR, STAT_INV, EMER_GEN (…_A for TR current) |

## Hydraulics / brakes (owner sys-elec)
| var | meaning |
|---|---|
| `S:HYD_G_PRESS`, `S:HYD_B_PRESS`, `S:HYD_Y_PRESS` | system pressure (psi, 3000 nominal) |
| `S:HYD_G_QTY`, `S:HYD_B_QTY`, `S:HYD_Y_QTY` | reservoir quantity (L) |
| `S:HYD_PTU_ACTIVE` | PTU running (barking dog sound) |
| `S:HYD_PTU_DIR` | 1 = G→Y, -1 = Y→G, 0 idle |
| `S:HYD_Y_ELEC_PUMP_ON`, `S:HYD_B_ELEC_PUMP_ON` | electric pumps running |
| `S:HYD_ENG1_PUMP_ON`, `S:HYD_ENG2_PUMP_ON` | EDP delivering pressure |
| `S:HYD_RAT_DEPLOYED` | 0..1 RAT extension |
| `S:BRK_ACCU_PRESS` | brake accumulator pressure (psi) |
| `S:BRK_PRESS_L`, `S:BRK_PRESS_R` | brake pressure on triple indicator (psi) |
| `S:BRK_PARK_ON` | parking brake applied (effective) |
| `S:BRK_TEMP_1..4` | brake temperatures °C |
| `S:NWS_AVAIL` | nose-wheel steering available (yellow press + A/SKID&N/W STRG ON + no tow bar) |

## Fuel (owner sys-elec)
| var | meaning |
|---|---|
| `S:FUEL_LO_KG`, `S:FUEL_LI_KG`, `S:FUEL_C_KG`, `S:FUEL_RI_KG`, `S:FUEL_RO_KG` | tank quantities |
| `S:FUEL_FOB_KG` | fuel on board |
| `S:FUEL_ENG1_FEED`, `S:FUEL_ENG2_FEED` | fuel pressure available at engine LP valve (pumps or suction) 0/1 |
| `S:FUEL_ENG1_LP_VALVE`, `S:FUEL_ENG2_LP_VALVE` | LP valve open (closed by ENG FIRE pb) |
| `S:FUEL_XFEED_OPEN` | cross-feed valve fully open |
| `S:FUEL_PUMP_L1_ON`, `S:FUEL_PUMP_L2_ON`, `S:FUEL_PUMP_C1_ON`, `S:FUEL_PUMP_C2_ON`, `S:FUEL_PUMP_R1_ON`, `S:FUEL_PUMP_R2_ON` | pump actually running 0/1 (pb IN + AC powered; centre pumps per MODE SEL AUTO logic) — used by audio |
| `S:FUEL_XFEED_MOVING` | cross-feed valve in transit 0/1 (audio) |
| `S:FUEL_APU_FEED` | APU fuel available |
| `S:FUEL_USED_1`, `S:FUEL_USED_2` | fuel used since engine start (kg) |
| `S:FUEL_TEMP_L`, `S:FUEL_TEMP_R` | °C |

## APU (owner sys-elec)
| var | meaning |
|---|---|
| `S:APU_N` | speed % |
| `S:APU_EGT` | °C |
| `S:APU_AVAIL` | APU available (N>95% +2s) |
| `S:APU_FLAP_POS` | air intake flap 0 closed .. 1 open |
| `S:APU_STARTING` | start sequence running |
| `S:APU_BLEED_PRESS` | APU bleed pressure (psi) delivered when APU BLEED valve open |
| `S:APU_BLEED_VALVE` | APU bleed valve open |
| `S:APU_FUEL_USED`, `S:APU_OIL_LOW` | misc for SD APU page |
| `S:APU_SHUTTING_DOWN` | cooling / shutdown in progress |

## Pneumatics / air conditioning / pressurisation (owner sys-air)
| var | meaning |
|---|---|
| `S:BLEED_ENG1_VALVE`, `S:BLEED_ENG2_VALVE` | engine bleed (PR) valve open |
| `S:BLEED_ENG1_HP_VALVE`, `S:BLEED_ENG2_HP_VALVE` | HP valve |
| `S:BLEED_XBLEED_VALVE` | cross bleed valve open |
| `S:BLEED_PRESS_1`, `S:BLEED_PRESS_2` | bleed duct pressure left/right (psi) — used for engine start (needs ≥ ~25 psi) |
| `S:BLEED_TEMP_1`, `S:BLEED_TEMP_2` | °C |
| `S:PACK1_VALVE`, `S:PACK2_VALVE` | pack flow control valve open |
| `S:PACK1_FLOW`, `S:PACK2_FLOW` | 0..1.2 normalised flow |
| `S:PACK1_OUT_TEMP`, `S:PACK2_OUT_TEMP`, `S:PACK1_COMP_TEMP`, `S:PACK2_COMP_TEMP` | °C |
| `S:COND_CKPT_TEMP`, `S:COND_FWD_TEMP`, `S:COND_AFT_TEMP` | zone temperatures °C |
| `S:COND_CKPT_DUCT`, `S:COND_FWD_DUCT`, `S:COND_AFT_DUCT` | duct temps °C |
| `S:COND_HOT_AIR_VALVE`, `S:COND_RAM_AIR_VALVE` | valves |
| `S:PRESS_CAB_ALT`, `S:PRESS_CAB_VS`, `S:PRESS_DELTA_P`, `S:PRESS_OUTFLOW` (0..1), `S:PRESS_SAFETY_VALVE`, `S:PRESS_ACTIVE_SYS` (1/2), `S:PRESS_LDG_ELEV` (ft) |
| `S:VENT_BLOWER_ON`, `S:VENT_EXTRACT_ON`, `S:VENT_INLET_VALVE`, `S:VENT_EXTRACT_VALVE` | avionics ventilation (fan noise) |
| `S:AI_WING_VALVE_L`, `S:AI_WING_VALVE_R`, `S:AI_ENG1_VALVE`, `S:AI_ENG2_VALVE`, `S:AI_PROBE_HEAT` | anti ice |

## Engines CFM56-5B (owner sys-air)
Per engine n = 1, 2:
| var | meaning |
|---|---|
| `S:ENGn_N1`, `S:ENGn_N2` | % |
| `S:ENGn_EGT` | °C |
| `S:ENGn_FF` | fuel flow kg/h |
| `S:ENGn_OIL_PRESS` psi, `S:ENGn_OIL_TEMP` °C, `S:ENGn_OIL_QTY` qt |
| `S:ENGn_VIB_N1`, `S:ENGn_VIB_N2` | vibrations |
| `S:ENGn_START_VALVE` | start valve open |
| `S:ENGn_IGN_A`, `S:ENGn_IGN_B` | igniter A/B active |
| `S:ENGn_HP_FUEL_VALVE` | HP fuel shut-off valve open |
| `S:ENGn_STATE` | 0 off, 1 dry crank, 2 start in progress, 3 running (stabilised), 4 shutting down, 5 start aborted |
| `S:ENGn_RUNNING` | 1 when stabilised at or above idle |
| `S:ENGn_FADEC_ON` | FADEC powered (ECAM ENG indications valid; amber XX otherwise) |
| `S:ENGn_NAC_TEMP` | nacelle temp °C |
| `S:ENGn_REV` | reverser position 0..1 |
| `S:ENG_MODE_SEL` | mirror of the ENG MODE selector state seen by FADECs (0 crank, 1 norm, 2 ign/start) |
| `S:ENG_THR_LIMIT_TYPE` | 0 TOGA, 1 FLX, 2 MCT, 3 CLB, 4 MREV |
| `S:ENG_THR_LIMIT_N1` | % (E/WD top-right) |
| `S:ENG_FLX_TEMP` | °C when FLX is displayed |

## Misc systems (owner sys-misc)
| var | meaning |
|---|---|
| `S:ADIRS_IRn_STATE` n=1..3 | 0 off, 1 aligning, 2 NAV (aligned), 3 ATT, 4 fault/align fault |
| `S:ADIRS_IRn_ALIGN_REMAIN` | s remaining |
| `S:ADIRS_IRn_ALIGNED` | alignment complete (attitude + heading valid) |
| `S:ADIRS_ADRn_ON` | ADR n providing valid air data |
| `S:ADIRS_ON_BAT` | at least one ADIRU on battery |
| `S:ADIRS_POS_ENTERED` | present position received (MCDU ALIGN IRS or CDU entry) |
| `S:ADIRS_HDG_TRUE`, `S:ADIRS_HDG_MAG`, `S:ADIRS_TRK_MAG` | deg |
| `S:ADIRS_PITCH`, `S:ADIRS_ROLL` | deg (+ nose up, + right wing down) |
| `S:ADIRS_LAT`, `S:ADIRS_LON` | IR position |
| `S:ADIRS_GS` | ground speed kt |
| `S:ADIRS_IAS`, `S:ADIRS_MACH`, `S:ADIRS_TAS` | air data |
| `S:ADIRS_BARO_ALT_STD` | pressure altitude ft (1013) — PFD corrects with its own baro setting |
| `S:ADIRS_VS` | ft/min |
| `S:ADIRS_SAT`, `S:ADIRS_TAT` | °C |
| `S:ADIRS_WIND_DIR`, `S:ADIRS_WIND_SPD` | wind |
| `S:FIRE_ENG1_DET`, `S:FIRE_ENG2_DET`, `S:FIRE_APU_DET` | fire detected (or test) |
| `S:FIRE_ENG1_TEST`, `S:FIRE_ENG2_TEST`, `S:FIRE_APU_TEST` | test in progress |
| `S:FIRE_ENG1_AGENT1_DISCH`, … `S:FIRE_APU_AGENT_DISCH` | bottle discharged |
| `S:FCTL_ELACn_ON` n=1,2, `S:FCTL_SECn_ON` n=1..3, `S:FCTL_FACn_ON` n=1,2 | computers operative |
| `S:FCTL_AIL_L`, `S:FCTL_AIL_R`, `S:FCTL_ELEV_L`, `S:FCTL_ELEV_R`, `S:FCTL_RUDDER` | surface deflection deg |
| `S:FCTL_SPLR_L1..L5`, `S:FCTL_SPLR_R1..R5` | spoiler deflection deg |
| `S:FCTL_THS` | THS deg (+ nose up) |
| `S:FCTL_RUD_TRIM` | rudder trim deg (+ right) |
| `S:FCTL_SLATS`, `S:FCTL_FLAPS` | surface angle deg |
| `S:FCTL_FLAPS_CONF` | 0, 1, 1.5 (1+F), 2, 3, 4 (FULL) — actual configuration |
| `S:FCTL_SLATS_MOVING`, `S:FCTL_FLAPS_MOVING` |
| `S:FCTL_GND_SPLR_ARMED` |
| `S:GEAR_L_POS`, `S:GEAR_N_POS`, `S:GEAR_R_POS` | 0 up .. 1 down-locked |
| `S:GEAR_DOORS_CLOSED` |
| `S:NWS_ANGLE` | deg |
| `S:AUTOBRK_MODE` | 0 off, 1 LO, 2 MED, 3 MAX |
| `S:EXTLT_BEACON` | 0/1 instantaneous flash state (red beacon) |
| `S:EXTLT_STROBE` | 0/1 instantaneous flash |
| `S:EXTLT_NAV`, `S:EXTLT_LOGO`, `S:EXTLT_WING`, `S:EXTLT_TAXI`, `S:EXTLT_TO`, `S:EXTLT_RWY_TURNOFF` | 0/1 (powered & on) |
| `S:EXTLT_LAND_L`, `S:EXTLT_LAND_R` | light on 0/1 |
| `S:EXTLT_LAND_L_EXT`, `S:EXTLT_LAND_R_EXT` | extension 0..1 |
| `S:INTLT_DOME` | 0..1 dome light intensity (powered) |
| `S:INTLT_FLOOD_MAIN`, `S:INTLT_FLOOD_PED` | 0..1 |
| `S:INTLT_INTEG_OVHD`, `S:INTLT_INTEG_MAIN`, `S:INTLT_INTEG_GLARE` | 0..1 panel back-lighting (legends & engravings glow) |
| `S:INTLT_CONSOLE_CAPT`, `S:INTLT_CONSOLE_FO`, `S:INTLT_READING_CAPT`, `S:INTLT_READING_FO` | 0..1 |
| `S:INTLT_STBY_COMPASS` | 0/1 |
| `S:INTLT_ANN_TEST` | 1 while ANN LT TEST and annunciators powered → all lights on |
| `S:INTLT_ANN_DIM` | 1 when ANN LT DIM |
| `S:ANN_POWER` | 1 when annunciator lights are powered (DC BAT/ESS) — **written by sys-elec** (read-only for sys-misc) |
| `S:SIGNS_SEATBELTS`, `S:SIGNS_NOSMOKING`, `S:SIGNS_EXIT` | cabin signs on (chime) |
| `S:CKPT_DOOR_LOCKED` | cockpit door locked |
| `G:DOOR_CKPT` | cockpit door open ratio 0 closed..1 open — written by **shell** (door is clickable in 3D); init 0. Audio reads it |
| `S:WIPER_CAPT_POS`, `S:WIPER_FO_POS` | wiper blade angle 0..1 |
| `S:RCDR_CVR_ON` | CVR running |
| `S:OXY_CREW_PRESS` | psi (DOOR/OXY page) |

## Avionics
| var | owner | meaning |
|---|---|---|
| `S:FCU_SPD` | pfdnd | selected speed kt (or mach×100 if `S:FCU_SPD_IS_MACH`) |
| `S:FCU_SPD_MANAGED` | pfdnd | 1 = managed (dashes + dot) |
| `S:FCU_HDG`, `S:FCU_HDG_MANAGED` | pfdnd | |
| `S:FCU_ALT` | pfdnd | selected altitude ft |
| `S:FCU_VS`, `S:FCU_VS_ACTIVE` | pfdnd | ft/min |
| `S:FCU_TRK_FPA` | pfdnd | 1 = TRK/FPA mode |
| `S:FCU_FD1`, `S:FCU_FD2` | pfdnd | flight directors on |
| `S:FCU_LS1`, `S:FCU_LS2` | pfdnd | LS pb on |
| `S:FCU_AP1`, `S:FCU_AP2`, `S:FCU_ATHR` (0 off, 1 armed, 2 active) | pfdnd | |
| `S:FCU_POWERED` | pfdnd | |
| `S:EFISn_BARO_HPA` | pfdnd | baro setting in hPa |
| `S:EFISn_BARO_STD` | pfdnd | 1 = STD |
| `S:EFISn_BARO_INHG` | pfdnd | 1 = display in inHg |
| `S:EFISn_ND_MODE` / `S:EFISn_ND_RANGE` | pfdnd | 0..4 / NM |
| `S:FMGS_V1`, `S:FMGS_VR`, `S:FMGS_V2` | mcdu | kt (0 if not entered) |
| `S:FMGS_FLEX` | mcdu | FLEX TO temp °C (0 = none) |
| `S:FMGS_TO_CONF` | mcdu | 1,2,3 |
| `S:FMGS_THS_FOR` | mcdu | deg (+ UP) |
| `S:FMGS_THR_RED`, `S:FMGS_ACC`, `S:FMGS_EO_ACC` | mcdu | ft |
| `S:FMGS_CRZ_FL`, `S:FMGS_CI`, `S:FMGS_TRANS_ALT` | mcdu | |
| `S:FMGS_ZFW`, `S:FMGS_ZFWCG`, `S:FMGS_BLOCK`, `S:FMGS_TOW`, `S:FMGS_GW`, `S:FMGS_CG` | mcdu | |
| `S:FMGS_INIT_A_DONE`, `S:FMGS_INIT_B_DONE`, `S:FMGS_FPLN_DONE`, `S:FMGS_PERF_TO_DONE` | mcdu | checks |
| `S:FMGS_FPLN_ACTIVE` | mcdu | origin & destination entered |
| `S:FMGS_DEP_RWY_HDG`, `S:FMGS_DEP_RWY_ELEV` | mcdu | |
| `S:FMGS_POWERED` | mcdu | FMGC powered (MCDU shows data) |
| `S:NAV_VOR1_FREQ`, `S:NAV_VOR2_FREQ`, `S:NAV_ILS_FREQ`, `S:NAV_ILS_CRS`, `S:NAV_ADF1_FREQ`, `S:NAV_ADF2_FREQ` | mcdu | tuned (MHz / kHz) |
| `S:XPDR_CODE` (octal digits as decimal e.g. 2000), `S:XPDR_MODE`, `S:TCAS_MODE` | pedestal | |
| `S:RADIO_VHF1_ACT`, `S:RADIO_VHF1_STBY` … | pedestal | MHz |
| `S:FWC_MASTER_WARN`, `S:FWC_MASTER_CAUT` | ecam | active (lights L:MASTER_WARN / L:MASTER_CAUT) |
| `S:FWC_TO_MEMO`, `S:FWC_TO_CONFIG_OK` | ecam | |
| `S:ECAM_SD_PAGE` | ecam | 0 none, 1 ENG, 2 BLEED, 3 PRESS, 4 ELEC, 5 HYD, 6 FUEL, 7 APU, 8 COND, 9 DOOR, 10 WHEEL, 11 F/CTL, 12 STS, 13 CRUISE |
| `S:DMC_POWERED_1/2/3` | ecam | display management computers |

## Requested by consumers (owners: please write these exact names)

Reported by the finished ecam / mcdu / audio modules (2026-09-28). Each consumer has a fallback, but the owner must publish them.

| Owner | Vars |
|---|---|
| sys-misc | `S:RA_ALT` (radio altimeter ft, ~0 on ground, 0 when unpowered), `S:TIRE_PRESS_1..6` (psi), `S:SMOKE_CARGO_FWD_DET`, `S:SMOKE_CARGO_AFT_DET`, `S:FIRE_ENG1_TEST`/`S:FIRE_ENG2_TEST`/`S:FIRE_APU_TEST` (test in progress 0/1); ADIRS: `S:ADIRS_IRn_STATE`, `S:ADIRS_IRn_ALIGNED`, `S:ADIRS_IRn_ALIGN_REMAIN` (s), `S:ADIRS_POS_ENTERED` (set on event `adirs:position {lat,lon}` from MCDU INIT A), `S:ADIRS_LAT`, `S:ADIRS_LON`, `S:ADIRS_BARO_ALT_STD`, `S:ADIRS_GS`, `S:ADIRS_HDG_TRUE`, `S:ADIRS_HDG_MAG`, `S:ADIRS_TRK_MAG`, `S:ADIRS_SAT` |
| sys-misc (or air) | `S:VENT_INLET_VALVE`, `S:VENT_EXTRACT_VALVE` (0 closed .. 1 open, avionics skin valves) |
| pfdnd (FCU/EFIS) | `S:EFIS1_BARO_STD`, `S:EFIS2_BARO_STD` (0/1) |
| sys-air | `S:ENG_TOGA_N1`, `S:ENG_IDLE_N1` (%, current limits for E/WD), `S:ENG1_N1`, `S:ENG2_N1`, `S:ENG1_RUNNING`, `S:ENG2_RUNNING` |
| sys-elec | `S:ELEC_EMER_GEN_ON`, `S:ELEC_EMER_GEN_V`, `S:ELEC_EMER_GEN_HZ`, `S:ELEC_IDG1_TEMP`, `S:ELEC_IDG2_TEMP` (°C), `S:ELEC_IDG1_DISC`, `S:ELEC_IDG2_DISC`, `S:FUEL_CTR_PUMPS_ON` (either centre pump running), `S:FUEL_OUTER_XFR_L`, `S:FUEL_OUTER_XFR_R` (outer-to-inner transfer valves open), `S:FUEL_TEMP_L/R`, `S:HYD_G_RSVR_OVHT`/`B`/`Y`, `S:HYD_G_RSVR_LO_AIR`/`B`/`Y`, `S:ELEC_AC_ESS_SHED`, `S:ANN_POWER` |
| world / ui (ground services, EFB) | `G:CABIN_READY` (cabin secured, 0/1), `G:REFUELING` (0/1), `G:SLIDES_ARMED` (0/1) |
| shell | `G:DOOR_CKPT` (see Misc) |

Conventions assumed by ECAM for F/CTL: aileron/elevator positive = trailing edge down; rudder positive = right.

## Services (rich objects in `sim.services`)
- `sim.services.fmgs` — owner **mcdu**. See `src/core/fmgs-api.ts`: flight plan legs, navaids, airports for the ND.
- `sim.services.ecam` — owner **ecam**. Optional: active warnings list for the EFB/debug.
- `sim.services.ground` — owner **ui** (EFB ground services) : `connectGpu(bool)`, `startPushback(...)` etc.

## Events (sim.emit / sim.on)
- `${controlId}:press` / `:release` — momentary pushbuttons & keys (kit).
- `${controlId}:toggle` — latching pb changed (payload {value}).
- `${controlId}:change` — ANY control position changed by the player (payload {value, old}) — sw/rot/pot/lever/pb.
- `${controlId}:inc` / `:dec` (payload {steps}) / `:push` / `:pull` — encoders.
- `MCDU1_KEY` / `MCDU2_KEY` payload `{key}` (see catalog MCDU_KEYS), `XPDR_KEY` (no ADIRS CDU on this aircraft).
- `sfx` payload `{kind, id, x?, y?, z?}` — mechanical click sounds (kit → audio).
- `fwc:sound` payload `{sound: 'SC'|'CRC'|'CAVALRY'|'CCHORD'|'CLICK'|'TRIPLECLICK'|'BUZZER'|'STOP_CRC'}` — ecam → audio.
- `cabin:chime` — seat belt / no smoking chime (sys-misc → audio).
- `adirs:position` payload `{lat, lon}` — mcdu → sys-misc (ALIGN IRS).
- `ground:*` — EFB → world/systems (see ui docs).
