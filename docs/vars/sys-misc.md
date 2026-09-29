# sys-misc — ADIRS / FIRE / F/CTL / GEAR / LIGHTS / MISC PANELS (`src/systems/misc`)

Sim systems (order): `misc-annlt` 12 (ANN LT TEST/DIM, right after sys-elec's network), `misc` 70
(ADIRS → fire → F/CTL → gear → lights → panels, after hydraulics 50 / brakes 55).
Service: `sim.services['sys-misc']` (also `app.services`) = `{ adirs, fire, fctl, gear, lights, panels, debug }`,
`debug.forceAligned()`, `debug.injectFire(zone, on?, shots?)`, `debug.injectSmoke('FWD'|'AFT'|'AVNCS', on?)`,
`debug.setFault(id, on)` (`IR1..3`, `ADR1..3`, `ELAC1`…`FAC2`, `ENG1_LOOP_A`…). No display.
Dev scenarios: `src/dev/scenarios/sys-misc.ts` (aligning, aligningPos, aligned, fireTest, engFire, cargoSmokeTest,
fctlCheck, flapsFull, priority, gearUp, autobrakeMax, nightLights, evac, gpwsTest, wipers).

## Events
- In: `adirs:position {lat, lon}` (MCDU ALIGN IRS), `adirs:heading {hdg, ir?}` (ATT mode heading, magnetic),
  debug `misc:fire`, `misc:smoke`, `misc:fault`.
- Out: `adirs:position_ack {accepted}`, `cabin:chime {type:'lo'|'hi'|'hilo'}` (signs lo, FWD/AFT/ALL calls hi, EMER hilo),
  `calls:mech`, `gpws:aural {msg, test}`, `rcdr:cvr_test`, `rcdr:cvr_erase`, `oxy:mask_test {side}`,
  `rain:rplnt {side}`, `fcs:priority {side:'LEFT'|'RIGHT'}`, `fcs:dual_input`.

## Writes
Lights: every catalog light of OVHD_ADIRS (IR/ADR FAULT/ALIGN/OFF, ON BAT), FLTCTL, EVAC, GPWS, RCDR, OXY, CALLS,
FIRE (+ pedestal ENG1/2_FIRE), CARGO SMOKE, MAINT (APU AUTOEXT TEST, OXY TMR RESET, SVCE INT OVRD, AVIONICS COMPT LT),
COCKPIT DOOR VIDEO, glareshield AUTOLAND / PRIO, main panel TERR ON ND, GPWS/G/S, gear panel, AUTO BRK, PED_DOOR.
All gated on annunciator power (`S:ANN_POWER` / DC BAT / DC ESS); ADIRS ON BAT and fire lights also from the hot buses.
ANN LT TEST / DIM are applied by the cockpit kit from `S:INTLT_ANN_TEST` / `S:INTLT_ANN_DIM`.

| group | variables |
|---|---|
| ADIRS per IR n=1..3 | `S:ADIRS_IRn_STATE` (0 off, 1 aligning incl. waiting for position, 2 NAV, 3 ATT, 4 fault / >82°), `_ALIGN_REMAIN` (s), `_ALIGNED`, `_ALIGN_FAULT`, `_POS_OK`, `_ATT_VALID`, `_HDG_VALID`, `_NAV_VALID` (include the IR pb), `_ON_BAT`, `_LAT`, `_LON` (pure inertial, with drift); `S:ADIRS_ADRn_ON` |
| ADIRS global | `S:ADIRS_ON_BAT` (on battery or ON BAT test), `S:ADIRS_ON_BAT_SUPPLY`, `S:ADIRS_POS_ENTERED`, `S:ADIRS_ALIGN_REMAIN` (max), `S:ADIRS_ALIGN_FAULT`, `S:ADIRS_ANY_ALIGNED`, `S:ADIRS_CAPT_IR`/`FO_IR`/`CAPT_ADR`/`FO_ADR` (source 1..3 after ATT HDG / AIR DATA switching), `S:ADIRS_CAPT_`/`FO_` `ATT/HDG/NAV/ADR` `_VALID` |
| IR data | `S:ADIRS_PITCH`, `ROLL`, `HDG_TRUE`, `HDG_MAG`, `TRK_TRUE`, `TRK_MAG`, `GS`, `VS`, `LAT`, `LON` (GPIRS = true position once an IR is in NAV, else memorised) |
| ADR data | `S:ADIRS_BARO_ALT_STD`, `STATIC_PRESS` (hPa), `IAS` (0 below 30 kt), `TAS` (0 below 60), `MACH` (0 below 0.1), `SAT`, `TAT`, `WIND_VALID`/`WIND_DIR`/`WIND_SPD` (TAS > 100 kt only) |
| Fire | `S:FIRE_ENGn_DET`, `_TEST`, `_FIRE`, `_AGENT1_DISCH`, `_AGENT2_DISCH`, `_BOTTLE1_PRESS`, `_BOTTLE2_PRESS`, `_SQUIB_ARMED`, `_LOOP_A_FAULT`, `_LOOP_B_FAULT`; `S:FIRE_APU_DET`, `_TEST`, `_FIRE`, `_AGENT_DISCH`, `_BOTTLE_PRESS`, `_SQUIB_ARMED`, `_LOOP_A/B_FAULT`, `_AUTOEXT_TEST`; `S:SMOKE_CARGO_FWD_DET`, `S:SMOKE_CARGO_AFT_DET` (aliases `S:FIRE_CARGO_FWD_SMOKE` / `_AFT_SMOKE` for sys-air), `S:FIRE_CARGO_TEST`, `S:FIRE_CARGO_BOTTLE_DISCH`, `S:FIRE_CARGO_DISCH_FWD/AFT` |
| F/CTL | `S:FCTL_ELACn_ON/_FAULT`, `S:FCTL_SECn_ON/_FAULT`, `S:FCTL_FACn_ON/_FAULT`, `S:FCTL_AIL_L/R`, `ELEV_L/R` (+ = TE down), `RUDDER` (+ = right), `RUD_TRIM`, `RUD_TLU`, `THS` (+ = nose up), `SPLR_L1..L5/R1..R5`, `SPD_BRK`, `GND_SPLR_ARMED`, `GND_SPLR_EXT`, `SLATS`, `FLAPS`, `SLATS_TARGET`, `FLAPS_TARGET`, `FLAPS_CONF` (0,1,1.5,2,3,4 reached), `FLAPS_CONF_TARGET`, `SLATS_MOVING`, `FLAPS_MOVING`, `SFCC1_ON`, `SFCC2_ON`, `PRIORITY` (0/1 CAPT/2 FO), `DUAL_INPUT`, `STICK_ROLL`, `STICK_PITCH` |
| Gear / brakes | `S:GEAR_L/N/R_POS`, `S:GEAR_DOORS_CLOSED`, `S:GEAR_DOORS_POS`, `S:GEAR_DOWNLOCKED`, `S:GEAR_UPLOCKED`, `S:LGCIU1/2_POWERED`, `S:LGCIU_ON_GROUND`, `S:AUTOBRK_MODE` (0 off,1 LO,2 MED,3 MAX), `S:AUTOBRK_ARMABLE`, `S:AUTOBRK_ACTIVE`, `S:AUTOBRK_DECEL`, `S:AUTOBRK_TARGET_DECEL` (m/s²), `S:AUTOBRK_MEASURED_DECEL`, `S:NWS_ANGLE`, `S:TIRE_PRESS_1..6` (psi; 1-4 mains, 5-6 nose), `S:RA_ALT`, `S:RA_VALID`, `S:RA1/2_POWERED` |
| Lights | `S:EXTLT_BEACON` (flash), `_BEACON_ON`, `S:EXTLT_STROBE` (flash), `_STROBE_ON`, `S:EXTLT_NAV`, `LOGO`, `WING`, `RWY_TURNOFF`, `TAXI`, `TO`, `LAND_L/R`, `LAND_L/R_EXT`; `S:INTLT_DOME`, `INTEG_OVHD`, `INTEG_MAIN`, `INTEG_GLARE`, `FLOOD_MAIN`, `FLOOD_PED`, `CONSOLE_CAPT/FO`, `READING_CAPT/FO`, `STBY_COMPASS`, `ICE_IND`, `ANN_TEST`, `ANN_DIM` |
| Signs | `S:SIGNS_SEATBELTS`, `S:SIGNS_NOSMOKING`, `S:SIGNS_EXIT`, `S:SIGNS_EMER_LT`, `S:SIGNS_EMER_EXIT_LT_OFF` |
| Panels | `S:EVAC_ACTIVE`, `S:EVAC_HORN`, `S:EVAC_CAPT_ONLY`, `S:CALLS_MECH`, `S:CALLS_EMER`, `S:GPWS_POWERED`, `S:GPWS_SYS_ON`, `S:GPWS_GS_MODE_ON`, `S:GPWS_FLAP_MODE_ON`, `S:GPWS_LDG_FLAP3`, `S:GPWS_TERR_ON`, `S:GPWS_TEST`, `S:GPWS_TERR_TEST`, `S:TERR_ON_ND_CAPT/FO`, `S:RCDR_CVR_ON`, `S:RCDR_DFDR_ON`, `S:RCDR_CVR_TEST`, `S:OXY_CREW_SUPPLY_ON`, `S:OXY_CREW_PRESS`, `S:OXY_PAX_MASKS`, `S:OXY_PAX_SYS_ON`, `S:OXY_MASK_FLOW_CAPT/FO`, `S:WIPER_CAPT_POS`, `S:WIPER_FO_POS`, `S:RAIN_RPLNT_CAPT/FO`, `S:CKPT_DOOR_LOCKED`, `S:CKPT_DOOR_LOCK_SEL`, `S:CKPT_DOOR_OPEN` (mirror of `G:DOOR_CKPT` when it exists), `S:CKPT_DOOR_VIDEO_ON`, `S:OVHD_PA_ACTIVE`, `S:SVCE_INT_OVRD`, `S:AVNCS_COMPT_LT`, `S:VENT_AVNCS_SMOKE` |

Not written (owned elsewhere): `S:ANN_POWER` (sys-elec), avionics ventilation valves / fans, cargo AFT ISOL valve and
ENG N1 MODE lights (sys-air).

## Reads
- sys-elec: `S:ELEC_HOT_BUS1/2`, `S:ELEC_DC_BAT_BUS`, `S:ELEC_DC_ESS_BUS`, `S:ELEC_DC_ESS_SHED`, `S:ELEC_DC1/2_BUS`,
  `S:ELEC_AC_ESS_BUS`, `S:ELEC_AC_ESS_SHED`, `S:ELEC_AC1/2_BUS`, `S:ELEC_ANN_POWER`, `S:ANN_POWER`, `S:HYD_G/B/Y_PRESS`,
  `S:NWS_AVAIL`, `S:BRK_TEMP_1..4`.
- sys-air: `S:ENG1_RUNNING`, `S:ENG2_RUNNING`, `S:AI_PROBE_HEAT`, `S:PRESS_CAB_ALT`.
- G: `AC_LAT`, `AC_LON`, `AC_HDG_TRUE`, `AC_MAGVAR`, `AC_GS_KT`, `AC_ON_GROUND`, `GND_PUSHBACK`, `GND_TOWBAR`, `ENV_OAT`,
  `ENV_QNH`, `ENV_ELEV_FT`, `ENV_WIND_DIR`, `ENV_WIND_KT`, `DOOR_CKPT`; optional (if present) `AC_PITCH`, `AC_ROLL`,
  `AC_VS_FPM`, `AC_ALT_AGL_FT`, `AC_RADALT_FT`.
- Controls of every owned panel + `C:SW_ATT_HDG`, `C:SW_AIR_DATA`, sidesticks, rudder pedals, tillers, brake pedals,
  thrust levers, flaps / speed brake levers, pitch trim wheel, `C:ASKID_NWSTRG`, `C:PARK_BRK`.

## Key values (sources: FCOM DSC-34/26/27/32/33/35, FBW A32NX `adirs.rs` as cross-check)
- ADIRU power: 1 AC ESS, 2 AC 2, 3 AC 1 (AC ESS SHED with ATT HDG CAPT 3); battery back-up HOT 1/2/1, ADIRU 2 (and 3
  unless CAPT 3) cut after 5 min on battery. Full power-up: IR FAULT blink 0.1 s, ON BAT 5 s from t = 10.5 s,
  ADR valid 18 s, attitude 28 s.
- Align time 300 s / cos(lat) (≈ 423 s at LFBD), 600 s ≤ 73°, 1020 s ≤ 82°; `settings.irsAlign` fast 90 s, instant 5 s.
  Heading valid in the last 2 min. Without position: countdown frozen at 60 s, ALIGN flashing 1 Hz; entry > 1° from the
  memorised position rejected. Motion > 0.5 kt restarts the alignment (2 s after stop). OFF→NAV within 5 s when
  aligned: 30 s fast realignment, no ON BAT test.
- Fire bottles 600 psi at 21 °C, discharged < 100 psi in ≈ 1.5 s; APU auto discharge 3 s after detection on ground;
  cargo smoke test: DISCH while held then SMOKE 1–4 s and 6–9 s.
- F/CTL: computer self-test 8 s; ground law elevators −30/+17°, ailerons ±25° (+5° droop with flaps), roll spoilers
  35°, speed brakes 40°, ground spoilers 50°, rudder ±25° (TLU 25° → 3.4° from 160 to 380 kt); droop without
  hydraulics: ailerons +25°, elevators +17°; slats 0→27° in 20 s, flaps 0→35° in 28 s (half speed on one system),
  CONF 1 = 18/0, 1+F = 18/10 (from 0 at ≤ 100 kt, always on ground), 2 = 22/15, 3 = 22/20, FULL = 27/35 (A320ceo).
- Autobrake LO 1.7 m/s² (4 s delay), MED 3 m/s² (2 s), MAX 6 m/s²; DECEL at ≥ 80 % of target.
- NWS: tiller ±75° (full to 20 kt → 0 at 70 kt), pedals ±6° (full to 40 kt → 0 at 130 kt), 20°/s.
- Tyres 200 psi mains / 182 nose at 15 °C (gas law). Crew oxygen 1850 psi at 21 °C.

## Gaps / assumptions
- AUTO LAND lights always off (no autoland logic); GPWS alert modes in flight not modelled (only the ground self-test).
- Autobrake computes arming/activation and the target deceleration; the braking force must be applied by the world.
- Gear: the three legs move together; no gravity extension; LGCIU faults not modelled.
- Integral glareshield lighting follows the INTEG LT MAIN PNL & PED pot (no FCU brightness knob in the catalog).
- Door: electric strikes fail-safe unlocked without power; no emergency access code / buzzer.
