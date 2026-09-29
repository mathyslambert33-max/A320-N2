# MCDU / FMGS / nav database module (`src/avionics/mcdu/`)

Two MCDUs (768x640 canvases, 24 columns x 14 lines, B612 Mono) sharing one FMGS (dual FMGC in sync).
Each MCDU has its own page and scratchpad. Logic is DOM-free; only `draw.ts` uses Canvas.

## Files
| file | content |
|---|---|
| `index.ts` | `install(app)` (async), `installMcduLogic(app)` (headless), power logic, lights, `sim.services.fmgs` / `sim.services.mcdu` |
| `navdb/generated.ts` | 1105 en-route/terminal waypoints, 71 navaids (VOR/DME/NDB/ILS), 158 airways — generated from the eAIP (AIRAC 2609) |
| `navdb/airports.ts` | LFBD, LFPO, LFPG: runways, SIDs, STARs, ILS approaches + vias + missed approaches, company routes |
| `navdb/navdb.ts` | `NavDb` look-ups, magnetic variation model, `NAV_DB` cycle idents |
| `fmgs/flightplan.ts` | flight plan (active / TMPY / SEC): departure / arrival rebuild, discontinuities, airways, NEXT WPT, NEW DEST, DIR TO |
| `fmgs/perf.ts` | ISA/CAS/Mach, F/S/green dot/VLS/VAPP, REC MAX/OPT FL, ECON speeds, vertical profile + time/fuel predictions, pseudo waypoints |
| `fmgs/fmgs.ts` | `Fmgs` (implements `FmgsApi`): INIT/PERF/fuel data, predictions, autotune, flight phase, messages, published vars |
| `mcdu/screen.ts`, `mcdu/format.ts`, `mcdu/mcdu.ts` | screen model, entry formats + messages, keyboard/scratchpad controller |
| `pages/*.ts` | MCDU MENU, A/C STATUS, INIT A, ROUTE SELECTION, WIND, INIT B, F-PLN A/B, LAT REV, AIRWAYS, VERT REV, DIR TO, DEPARTURES, ARRIVAL (+ APPR VIAS), PERF TAKE OFF/CLB/CRZ/DES/APPR/GO AROUND, RADIO NAV, FUEL PRED, PROG (+ REPORT, PREDICTIVE GPS), DATA INDEX 1/2, POSITION/IRS/IRSn/GPS MONITOR, CLOSEST AIRPORTS, WAYPOINT/NAVAID/RUNWAY/ROUTE, SEC INDEX + SEC F-PLN, ATSU/AIDS/CFDS menus |
| `draw.ts` | Canvas painting (amber boxes, arrows, overfly Δ drawn as vectors) |
| `testing.ts` | key-press helpers used by tests and dev scenarios |

## Events consumed
- `MCDU1_KEY` / `MCDU2_KEY` payload `{key}` (catalog `MCDU_KEYS`). BRT/DIM change the screen brightness (0.1..1).

## Events produced
- `adirs:position` `{lat, lon}` — INIT A **ALIGN IRS→** prompt (shown when FROM/TO entered, an IR is in ALIGN
  and `S:ADIRS_POS_ENTERED` is 0; disappears once pressed / position accepted / all IRs aligned).

## Variables written
| var | meaning |
|---|---|
| `S:FMGS_POWERED` | FMGC power-up test complete (20 s after AC power) |
| `S:FMGS_FMGC1_POWERED`, `S:FMGS_FMGC2_POWERED` | FMGC1 (AC ESS BUS) / FMGC2 (AC BUS 2) powered |
| `S:FMGS_PHASE` | 0 preflight, 1 take-off, 2 climb, 3 cruise, 4 descent, 5 approach, 6 go-around, 7 done |
| `S:FMGS_V1`, `S:FMGS_VR`, `S:FMGS_V2` | kt, 0 if not entered |
| `S:FMGS_FLEX` | °C, 0 = none |
| `S:FMGS_TO_CONF` | 1..3 (0 = not entered) |
| `S:FMGS_THS_FOR`, `S:FMGS_THS_ENTERED` | THS for take-off (deg, + UP) and entered flag |
| `S:FMGS_THR_RED`, `S:FMGS_ACC`, `S:FMGS_EO_ACC` | ft (defaults = RWY elevation + 1500 ft) |
| `S:FMGS_CRZ_FL`, `S:FMGS_CI`, `S:FMGS_TRANS_ALT` | |
| `S:FMGS_ZFW`, `S:FMGS_ZFWCG`, `S:FMGS_BLOCK`, `S:FMGS_TOW`, `S:FMGS_GW`, `S:FMGS_CG` | kg / %MAC |
| `S:FMGS_F_SPEED`, `S:FMGS_S_SPEED`, `S:FMGS_GD_SPEED` | take-off weight F / S / green dot (kt) |
| `S:FMGS_INIT_A_DONE` | FROM/TO, FLT NBR, CI, CRZ FL entered |
| `S:FMGS_INIT_B_DONE` | ZFW, ZFWCG, BLOCK entered |
| `S:FMGS_FPLN_ACTIVE` | origin & destination entered |
| `S:FMGS_FPLN_DONE` | runway + SID (or NONE) + approach selected, no discontinuity |
| `S:FMGS_PERF_TO_DONE` | V1, VR, V2, FLAPS, THS entered |
| `S:FMGS_DEP_RWY_HDG`, `S:FMGS_DEP_RWY_HDG_TRUE`, `S:FMGS_DEP_RWY_ELEV` | departure runway |
| `S:FMGS_DEST_ELEV`, `S:FMGS_DEST_QNH` | destination runway elevation, PERF APPR QNH |
| `S:FMGS_TMPY` | a temporary flight plan exists |
| `S:FMGS_TRIP_FUEL`, `S:FMGS_TRIP_TIME` | kg / min |
| `S:NAV_VOR1_FREQ`, `S:NAV_VOR2_FREQ`, `S:NAV_ILS_FREQ` | MHz (autotune or manual) |
| `S:NAV_VOR1_CRS`, `S:NAV_VOR2_CRS`, `S:NAV_ILS_CRS` | deg |
| `S:NAV_ADF1_FREQ`, `S:NAV_ADF2_FREQ` | kHz |
| `S:NAV_VOR1_AUTO`, `S:NAV_VOR2_AUTO`, `S:NAV_ILS_AUTO` | 1 = autotuned |
| `S:MCDU1_POWERED`, `S:MCDU2_POWERED`, `S:MCDU1_BRT`, `S:MCDU2_BRT` | MCDU power / brightness |
| `L:MCDUn_FAIL/FMGC/MENU/FM/IND/RDY/FM1/FM2` | annunciators (need `S:ANN_POWER`): FM/FMGC when a subsystem page is shown and an FMGC message is pending; IND when one FMGC only is powered; FM1/FM2 when that FMGC is lost |

## Variables read (written by other modules)
`S:ELEC_AC_ESS_BUS`, `S:ELEC_AC_ESS_SHED`, `S:ELEC_AC2_BUS` (fallback `S:ELEC_AC_POWERED`), `S:ANN_POWER`,
`S:ADIRS_IRn_STATE`, `S:ADIRS_IRn_ALIGNED`, `S:ADIRS_IRn_ALIGN_REMAIN`, `S:ADIRS_POS_ENTERED`, `S:ADIRS_LAT`,
`S:ADIRS_LON`, `S:ADIRS_BARO_ALT_STD`, `S:ADIRS_GS`, `S:ADIRS_HDG_TRUE`, `S:ADIRS_HDG_MAG`, `S:ADIRS_TRK_MAG`,
`S:ADIRS_SAT`, `S:ENG1_N1`, `S:ENG2_N1`, `S:ENG1_RUNNING`, `S:ENG2_RUNNING`, `S:FUEL_FOB_KG`,
`G:AC_LAT`, `G:AC_LON`, `G:AC_GS_KT`, `G:AC_ON_GROUND`, `G:AC_HDG_TRUE`, `G:ENV_OAT`, `G:ENV_ELEV_FT`, `G:TIME_UTC`.

## Service `sim.services.fmgs` (also `app.services.fmgs`)
Implements `FmgsApi` (`src/core/fmgs-api.ts`). Extensions usable by the ND:
`temporaryPlan()` (yellow TMPY legs), `secondaryPlan()`, `alternatePlan()` (legs after the missed approach),
`pseudoWaypoints()` → `{ident: '(T/C)'|'(T/D)'|'(LIM)'|'(DECEL)', lat, lon, distNm}[]`.
`sim.services.mcdu` = `{ fmgs, units: [Mcdu, Mcdu] }` (debug / EFB).

## Dev scenarios (`src/dev/scenarios/mcdu.ts`)
`/dev.html?display=MCDU1&mods=mcdu&power=1&scenario=mcdu.<name>` with `powerUp status menu initEmpty initA routeSel
initB fuelPlanning fplnDone fplnB fplnArr tmpy perfTo perfToEmpty perfClb perfAppr depart departRwy arrival
arrivalAppr latRev airways vertRev dirTo radnav fuelPred prog data data2 posMonitor irsMonitor gpsMonitor navaid runway
secIndex formatError notInDb scratch checkTo`.

## Recommended flight plan (EFB OFP)
`LFBD/23 CNA6P CNA B19 AMB AMB9W ODILO — ILS 25 via ODILO — LFPO`, ALTN LFPG (CO RTE LFPOLFPG1), company
route **LFBDLFPO1** (loads everything above, CI 25, FL350). Route distance 319 NM. MCDU predictions with
ZFW 57.6 / ZFWCG 27.4 / BLOCK 6.2 / TAXI 0.2: TRIP ≈ 2.3 t / 0055, TOW 63.6 t, F=151 S=190 O=212.
B19 is published FL065–FL195; above FL195 France is free route (DCT CNA–POI–AMB is flown the same way).

## Sources
- SIA eAIP France AIRAC 2026-09 (03 SEP 2026):
  `https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_03_SEP_2026/FRANCE/AIRAC-2026-09-03/html/eAIP/` —
  AD 2 LFBD / LFPO / LFPG (AD 2.12 runways, AD 2.19 radio aids, DATA fixes, SID/STAR/approach coding tables),
  ENR 3 (routes), ENR 4.1 (navaids), ENR 4.4 (significant points).
- Airbus A320 FCOM DSC-22_20 (MCDU pages, formats, messages), DSC-22_10 (FMGS architecture), PRO-NOR-SOP-01/-04 (FMGS preparation).
- FlyByWire A32NX legacy MCDU (GPL-3) consulted as a layout cross-check only; no code copied.

## Simplifications / known gaps
- Orly initial approaches: FM (vector) legs replaced by the published radio-failure continuation (RWY 25: DF EMMAQ →
  MEDWY) or by a discontinuity (RWY 24/06); holdings not coded. LFPG approaches have no legs (alternate only).
- HOLD, OFFSET, LL XING, FIX INFO, WIND pages, STEP ALTS, pilot-stored elements, datalink (INIT REQUEST, uplinks),
  PRINT, and SEC F-PLN revisions are displayed but not functional.
- Performance model is analytical (not Airbus PEP tables); predictions ignore winds except the INIT B trip wind.
- Lateral guidance / leg sequencing in flight is minimal (0.7 NM capture of the TO waypoint).
