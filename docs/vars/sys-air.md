# sys-air — PNEUMATICS / AIR COND / PRESS / VENT / ANTI-ICE / ENGINES CFM56-5B4/P (`src/systems/air-eng`)

Sim systems (order): `air-eng.pneu` 30 (bleed, X BLEED, APU/cart air), `air-eng.eng` 40 (FADECs + engines + limits),
`air-eng.air` 45 (packs, zone temps, pressurisation, ventilation, anti-ice), `air-eng.lights` 100.
Service `sim.services['sys-air']` (also `app.services['sys-air']`): `{ model, preset(name), fail(kind, n, on) }`
- presets (applied on the next tick): `enginesRunning` (both idle, MASTERs ON, ENG MODE NORM, APU BLEED OFF),
  `engine1Running` / `engine2Running` (that engine idle, MASTER ON, ENG MODE left at IGN/START).
- failures: `stall`, `ign` (no light-up), `startValve` (stuck closed), `hotStart` (rich schedule) for engine n;
  `bleedLeak` (side n), `apuLeak`, `packOverheat` (pack n), `ductOverheat`.
Event in: `sys-air:preset` `{name}` (or the name string). Dev scenarios: `src/dev/scenarios/sys-air.ts`
(`enginesRunning`, `engine2Running`, `eng2Starting`, `apuBleed`, `eng2StartNoBleed`; static values when sys-air is not installed).

## Writes — lights
All catalog lights of OVHD_AIRCOND, OVHD_ANTIICE, OVHD_PRESS, OVHD_VENT, OVHD_ENG (MAN START; `ENG_N1_MODE1/2_FAULT/ON`
always 0 — IAE only), OVHD_CARGO_VENT (`CARGO_VENT_AFT_ISOL_FAULT/OFF`), `MAINT_FADEC_GND_PWR1/2_ON`, `ENG1_FAULT`, `ENG2_FAULT`.
Gated by `S:ANN_POWER` (fallback DC BAT / DC ESS). PACK n FAULT is lit on external power with no bleed air (valve commanded open,
inlet < 8 psi for 5 s) — as on the aircraft — and goes out when APU BLEED is ON.

## Writes — S: vars (n = 1, 2)
| var | meaning |
|---|---|
| `S:BLEED_ENGn_VALVE`, `S:BLEED_ENGn_PRV_POS` | PRV open (0/1), position 0..1 |
| `S:BLEED_ENGn_HP_VALVE` | HP valve open (idle / low power) |
| `S:BLEED_XBLEED_VALVE`, `S:BLEED_XBLEED_POS` | X BLEED open (AUTO: open with APU bleed valve open), position (≈ 3 s travel) |
| `S:BLEED_PRESS_1/2`, `S:BLEED_TEMP_1/2` | duct pressure psi (regulated 44, ≈ 42 at idle, APU ≈ 30-39), temp °C |
| `S:BLEED_ENGn_FAULT`, `S:BLEED_APU_LEAK`, `S:BLEED_GND_HP_AIR` | engine bleed fault (overpress/overtemp/leak), APU leak, HP cart connected |
| `S:PACKn_VALVE`, `S:PACKn_FLOW` | FCV open, normalised flow 0..1.2 (LO .8 / NORM 1 / HI 1.2; HI forced on APU bleed or single pack) |
| `S:PACKn_OUT_TEMP`, `S:PACKn_COMP_TEMP`, `S:PACKn_BYPASS` | °C, °C, bypass valve 0..1 |
| `S:PACKn_FAULT`, `S:PACKn_START_CLOSED` | FAULT (as the light), valve closed by the engine-start logic |
| `S:COND_{CKPT,FWD,AFT}_{TEMP,DUCT,TRIM,SEL}` | zone °C, duct °C, trim valve 0..1, selected °C (18..30) |
| `S:COND_HOT_AIR_VALVE`, `S:COND_HOT_AIR_FAULT`, `S:COND_RAM_AIR_VALVE` | hot air PRV, duct overheat, ram air inlet |
| `S:PRESS_CAB_ALT` ft, `S:PRESS_CAB_VS` ft/min, `S:PRESS_DELTA_P` psi, `S:PRESS_CAB_PRESS_HPA` | cabin |
| `S:PRESS_OUTFLOW` 0..1, `S:PRESS_SAFETY_VALVE`, `S:PRESS_ACTIVE_SYS` 1/2, `S:PRESS_MAN` | valves / CPC in control |
| `S:PRESS_LDG_ELEV` ft, `S:PRESS_LDG_ELEV_AUTO` | FMGS dest elevation (`S:FMGS_DEST_ELEV`, else 291 ft LFPO) or knob |
| `S:PRESS_CPC1_FAULT`, `S:PRESS_CPC2_FAULT` | CPC unpowered/failed |
| `S:VENT_BLOWER_ON`, `S:VENT_EXTRACT_ON`, `S:VENT_INLET_VALVE`, `S:VENT_EXTRACT_VALVE` (0..1), `S:VENT_BLOWER_FAULT`, `S:VENT_EXTRACT_FAULT`, `S:VENT_CAB_FANS_ON` | avionics vent / recirculation |
| `S:CARGO_VENT_AFT_VALVE` 0..1, `S:CARGO_VENT_AFT_FAN` | aft cargo isolation valves / extract fan |
| `S:AI_WING_VALVE_L/R`, `S:AI_WING_CMD`, `S:AI_WING_FAULT` | wing anti-ice (ground: 30 s test) |
| `S:AI_ENGn_VALVE`, `S:AI_ENGn_FAULT` | nacelle anti-ice |
| `S:AI_PROBE_HEAT`, `S:AI_PITOT_HEAT` / `S:AI_WINDOW_HEAT` (0, .5 ground low, 1), `S:AI_TAT_HEAT` | probe & window heat |
| `S:ENGn_N1`, `_N2` %, `_EGT` °C, `_FF` kg/h, `_OIL_PRESS` psi, `_OIL_TEMP` °C, `_OIL_QTY` qt, `_VIB_N1/_VIB_N2` | engine parameters |
| `S:ENGn_START_VALVE` (0/1), `_START_VALVE_POS`, `_START_VALVE_CMD`, `_IGN_A`, `_IGN_B`, `_CONT_IGN`, `_HP_FUEL_VALVE`, `_LIT` | start/ignition |
| `S:ENGn_STATE` | 0 off, 1 dry crank, 2 starting, 3 running (stabilised), 4 shutting down, 5 start aborted |
| `S:ENGn_RUNNING`, `S:ENGn_FADEC_ON`, `S:ENGn_NAC_TEMP`, `S:ENGn_REV` 0..1, `S:ENGn_THRUST` kN, `S:ENGn_IDLE_N2`, `S:ENGn_N1_CMD` | |
| `S:ENGn_START_FAULT` | 0 none, 1 IGN FAULT, 2 EGT OVERLIMIT, 3 STALL, 4 HUNG START, 5 START VALVE FAULT, 7 LOW START AIR (6 unused on CFM) |
| `S:ENGn_START_ATTEMPT`, `S:ENGn_STARTER_TIME` s, `S:ENGn_STARTER_LIMIT` | recycle count, starter duty (> 120 s or > 3 cycles) |
| `S:ENG_MODE_SEL` | 0 crank, 1 norm, 2 ign/start |
| `S:ENG_THR_LIMIT_TYPE` (0 TOGA, 1 FLX, 2 MCT, 3 CLB, 4 MREV), `S:ENG_THR_LIMIT_N1`, `S:ENG_FLX_TEMP` (0 unless FLX shown) | E/WD limit |
| `S:ENG_TOGA_N1`, `S:ENG_MCT_N1`, `S:ENG_CLB_N1`, `S:ENG_FLX_N1`, `S:ENG_MREV_N1`, `S:ENG_IDLE_N1` | current limits % |
Presets also set `C:ENG_MASTERn`, `C:ENG_MODE`, `C:AIR_APU_BLEED` (controls of this module's panels).

## Reads from others
- sys-elec: `S:ELEC_DC_BAT_BUS`, `S:ELEC_DC_ESS_BUS`, `S:ELEC_DC1_BUS`, `S:ELEC_DC2_BUS`, `S:ELEC_AC1_BUS`, `S:ELEC_AC2_BUS`,
  `S:ELEC_AC_ESS_BUS`, `S:ELEC_AC_ESS_SHED`, `S:ELEC_AC_POWERED`, `S:ANN_POWER`, `S:APU_AVAIL`, `S:APU_BLEED_VALVE`,
  `S:APU_BLEED_PRESS` (already load-dependent), `S:FUEL_ENGn_FEED`, `S:FUEL_ENGn_LP_VALVE`, `S:HYD_G_PRESS`, `S:HYD_Y_PRESS` (reversers).
- sys-misc: `S:ADIRS_BARO_ALT_STD`, `S:ADIRS_MACH`, `S:ADIRS_SAT`, `S:ADIRS_VS`, `S:VENT_AVNCS_SMOKE`, `S:SMOKE_CARGO_AFT_DET` / `S:FIRE_CARGO_AFT_SMOKE`.
- MCDU/FMGS: `S:FMGS_FLEX` (°C, 0 none), `S:FMGS_DEST_ELEV` (ft, 0 = unknown → 291).
- G: `ENV_OAT`, `ENV_QNH`, `ENV_ELEV_FT`, `AC_ON_GROUND`, `GND_AIR_START_UNIT`, `DOOR_PAX_L1/L2/R1/R2`, `DOOR_CKPT` (nobody writes it; default open).
- Controls: all C: of the owned panels + `ENG_MASTERn`, `ENG_MODE`, `FIRE_ENGn_PB`, `THR_LEVERn`, `AIR_PACK_FLOW`, `AIR_TEMP_*`, `AIR_XBLEED`, `PRESS_*`.
Fallbacks when a producer is missing: no bus var → treated as powered by the generic AC/DC vars; no fuel vars → fuel with MASTER ON.

## Key values (LFBD 19 °C, QNH 1017, headless)
Auto start (APU bleed, MODE IGN/START, MASTER ON): packs close at IGN/START, duct 39 → dip ≈ 29 psi; start valve open < 0.5 s;
igniter at 16 % N2 (≈ 8 s, one igniter alternating A/B on ground, both on recycle); HP fuel at 22 % N2 (≈ 14 s, FF ≈ 170-200 kg/h);
light-off ≈ 4 s later; EGT peak ≈ 550 °C (limit 725); start valve closes ≥ 50 % N2 (≈ 37 s); stabilised ≈ 45 s: N1 19.7 %,
N2 59.2 %, EGT ≈ 395 °C, FF ≈ 290 kg/h, oil ≈ 36 psi. Packs reopen 30 s after the 2nd start. Engine bleed: ≈ 42 psi, ≈ 168 °C.
Protections: no light-up 15 s → IGN FAULT; 30 s dry crank; 2 attempts (IGN) / 3 (EGT, stall, hung); START VALVE FAULT when the valve
cannot open (no air) ≈ 7 s; FAULT light off at MASTER OFF.
Limits: TOGA ≈ 84.8 % N1 (flat-rated to ISA+15, CFM56-5B4 CN1 schedule), MCT 83.8, CLB 81.7, FLX 58 ≈ 81.0; TOGA spool-up
idle → 95 % of TOGA in ≈ 6 s, FF ≈ 3300 kg/h. FADEC: powered 5 min after aircraft power-up / after shutdown, or with IGN/START,
MASTER ON, MAN START or FADEC GND PWR. WAI on ground: 30 s test. Cabin: ground outflow valve fully open, TO pre-pressurisation
0.1 psi at −400 ft/min.

## Gaps / assumptions
- Bus assignments assumed: igniter A AC ESS SHED, B AC1 (eng 1) / AC2 (eng 2); FADEC 1 DC ESS/BAT, FADEC 2 DC2/DC ESS;
  CPC1 DC ESS/BAT, CPC2 DC2; AEVC DC1/DC2, blower AC1, extract AC2.
- In-flight pressurisation schedule simplified (no FMGS profile / climb-descent laws beyond rate limits).
- No LP ground air (conditioned air cart) input; HP cart only (`G:GND_AIR_START_UNIT`, left duct).
- ENG ANTI ICE pb ON with the engine stopped → FAULT (valve disagree, literal FCOM).
