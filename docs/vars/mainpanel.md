# mainpanel — glareshield, main instrument panel, clock, standby compass (`src/cockpit/mainpanel`)

Entry `index.ts` → `buildMainPanel` (main.ts), `buildGlareshield` (glareshield.ts), `buildCompass` (compass.ts),
`installClockLogic` (clock.ts + DOM-free `clock-logic.ts`). Service: `app.services.mainpanel = { root }`.
Dev scenarios: `src/dev/scenarios/mainpanel.ts` (`clock`, `brakes`, `gearUp`). Tests: `tests/mainpanel/clock.test.ts`.

## What is built (every catalog control of GLARE_* and MAIN_* with its exact id — checked: 79/79 handles, 13/13 ann)
- **Glareshield housing**: painted face + chin tucked 2 cm over the main panel, padded anti-glare nose and top sloping
  down to the windshield base (body y 1.08, z −0.95), end caps. Blocks the pointer ray (not clickable).
- **GLARE_WARN_L/R**: MASTER WARN / MASTER CAUT (pbm, catalog legends), SIDE STICK PRIORITY (green CAPT / F/O + red
  arrow anns), AUTO LAND ann, CHRONO pb. Mirrored on the F/O side (MASTER lights outboard, CHRONO inboard).
- **GLARE_EFIS_L/R**: BARO window (`EFISn_BARO` display) + QNH/BARO engraving, BARO encoder (push = STD, pull = QNH),
  concentric **in Hg / hPa ring** (`EFISn_BARO_UNIT`, custom ring selector), FD, LS, CSTR, WPT, VOR.D, NDB, ARPT (light
  bar pbs), ND mode (LS VOR NAV ARC PLAN, 30° detents) and range (10…320) pointer selectors, ADF/VOR 1 and 2 needle
  selectors (catalog 'sw', built as 3-detent pointer selectors VOR / OFF / ADF).
- **GLARE_FCU**: SPD/MACH, HDG/TRK, ALT, V/S windows (pfdnd displays); encoders with distinct tops (SPD plain, HDG
  pointer, ALT stepped, V/S grip bar); **100 / 1000 ring** around the ALT knob (`FCU_ALT_INC`); SPD/MACH, HDG V/S–TRK FPA,
  LOC, AP 1, AP 2, A/THR, APPR, EXPED, METRIC ALT pbs.
- **MAIN_CAPT / MAIN_FO** (lateral panels outboard of the PFDs): CONSOLE/FLOOR (BRT/DIM/OFF), LOUD SPEAKER, PFD brightness,
  ND brightness (inner knob) + WX/TERR brightness (outer concentric ring), PFD/ND XFR, GPWS–G/S (PULL UP GPWS / G/S),
  TERR ON ND.
- **DU bezels**: PFD1, ND1, E/WD, SD, ND2, PFD2 — 190 mm bezels with rounded corners, 4 Phillips screws, black
  lining, 158.8 mm (6.25") active area recessed 6 mm behind glass. Positions = the lead's MAIN anchor values.
- **MAIN_CTR**: ISIS unit (screen `ISIS` + BUGS, LS, +, −, RST, BARO encoder), A/SKID & N/W STRG switch, BRK FAN pb;
  decorative **triple indicator** (ACCU PRESS / BRAKES L-R, 3 mechanical needles from `S:BRK_ACCU_PRESS`,
  `S:BRK_PRESS_L`, `S:BRK_PRESS_R`, 0–4000 psi, smoothed); blank plate under the clock; knee panels, lower returns,
  side cheeks, back closure.
- **MAIN_GEAR**: LDG GEAR indicator (L / NOSE / R: UNLK red over green ▼) and the gear lever panel. The lever
  (`GEAR_LEVER`, 0 UP / 1 DOWN) is a wheel-shaped handle with the red ▼ lens (`L:GEAR_LEVER_RED`); operating it pulls the
  handle out of its detent (13 mm), swings it 48° and pushes it back in. Drag up/down (28 px), wheel, or click (toggles).
- **MAIN_AUTOBRK**: LO / MED / MAX (DECEL green / ON blue) under the AUTO/BRK bracket, BRK FAN (HOT / ON) beside them.
- **MAIN_CLOCK**: CHR, RST, DATE pbs, ET selector (RUN / STP / RST), GPS / INT / SET selector, 3 LCD windows.
- **Standby compass** at the windshield centre post (body (0, 1.585, −0.772)) with bracket, damped whiskey-compass
  card (magnetic heading = `G:AC_HDG_TRUE − G:AC_MAGVAR`, higher headings appear to the left), orange lubber line,
  card + lubber lit by `S:INTLT_STBY_COMPASS`, and a STBY COMPASS CORRECTION card.

## Clock (display `CLOCK`, 256 × 256, 8 Hz; logic system `mainpanel-clock`, order 95)
- UTC from `G:TIME_UTC` (GPS). INT = internal clock keeps the offset last set. SET: CHR pb selects the field
  (HH → MM → DD → MO → YY, flashing), DATE pb increments it (HH/MM wrap without carry). Back to GPS = resync.
- DATE pb (GPS/INT): toggles the UTC window between time and date (DD MM | YY). Midnight rolls the date.
  The base date is the real current UTC date at start (no scenario date variable exists).
- CHR: `CLOCK_CHR` and the glareshield `CHRONO_CAPT` / `CHRONO_FO` pbs cycle START → STOP → RESET (blank); `CLOCK_RST`
  resets. MIN:SEC (HH:MM beyond 99:59). ET: RUN counts, STP holds, RST blanks. HH:MM.
- Windows lit when `S:ELEC_DC_BAT_BUS` or `S:ELEC_DC_ESS_BUS`; timekeeping continues unpowered.

| var (owner mainpanel) | meaning |
|---|---|
| `S:CLOCK_POWERED` | windows powered |
| `S:CLOCK_UTC_S` | displayed UTC, s since 00:00 |
| `S:CLOCK_DAY`, `S:CLOCK_MONTH`, `S:CLOCK_YEAR` | displayed date |
| `S:CLOCK_SHOW_DATE` | UTC window shows the date |
| `S:CLOCK_SET_FIELD` | −1, or 0..4 (HH, MM, DD, MO, YY) in SET |
| `S:CLOCK_CHR_S`, `S:CLOCK_CHR_RUN` | chrono seconds (−1 = blank), running |
| `S:CLOCK_ET_S` | elapsed time seconds (−1 = blank) |

Events listened: `CLOCK_CHR:press`, `CLOCK_RST:press`, `CLOCK_DATE:press`, `CHRONO_CAPT:press`, `CHRONO_FO:press`.
Reads: `G:TIME_UTC`, `G:AC_HDG_TRUE`, `G:AC_MAGVAR`, `C:CLOCK_ET`, `C:CLOCK_SRC`, `S:ELEC_DC_BAT_BUS`, `S:ELEC_DC_ESS_BUS`,
`S:BRK_ACCU_PRESS`, `S:BRK_PRESS_L`, `S:BRK_PRESS_R`, `S:INTLT_STBY_COMPASS`. All other lights are driven by their owners.

## Anchor change (glareshield)
The lead's `GLARE` anchor (origin (0, 1.10, −0.63), face tilted 25°) put the glareshield lower edge 11 cm aft of the
main panel: from `EYE_CAPT` it hid the top ~25 % of the PFD/ND (FMA). This module builds the glareshield in its own
frame `GLARE_MP` (common.ts): origin **(0, 1.111, −0.749)**, face reclined **40°**, face height 0.09 m. Its lower edge
(y 1.077, z −0.720) is 15.8° below the eye line, just above the DU bezel tops (16.3°); top of the nose ≈ 9.5° below the
horizon (was ≈ 11.7°). The windshield-base contact (y 1.08, z −0.95) is unchanged. `ANCHORS.MAIN` is used unchanged.
Shell: the glareshield top is straight across x ±0.95 and reaches z −0.95/−0.97 under the windshield; if the windshield
base is V-shaped in plan, trim the shell side or tell mainpanel.

## Performance
366 meshes for the whole module (≈ 105 materials; most are per-control kit meshes: pb caps, legend quads, knob parts;
statics merged per panel per material by the kit and by `Batch`). ~91 k triangles.
