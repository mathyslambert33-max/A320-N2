# PFD / ND / ISIS / FCU module (`src/avionics/pfdnd/`)

Displays: `PFD1`, `ND1`, `PFD2`, `ND2` (1024²), `ISIS` (512²), `EFIS1_BARO`, `EFIS2_BARO` (256x96),
`FCU_SPD` (256x128), `FCU_HDG` (384x128), `FCU_ALT` (512x128, includes the HDG-V/S / TRK-FPA legend), `FCU_VS` (384x128).
Logic is DOM-free (`logic/`), drawing is Canvas 2D (`draw/`). Scope: ground operations until engine start.

## Files
| file | content |
|---|---|
| `index.ts` | `install(app)`: logic, then (DOM only) `draw/displays.ts` |
| `logic/sources.ts` | bus / DMC / FMGC availability, per-side ADIRS data with graceful fallbacks |
| `logic/fcu.ts` | FCU + EFIS control panels (order 80) |
| `logic/fg.ts` | FD engagement, FMA modes on ground (take-off modes), speed target (order 82) |
| `logic/du.ts` | DU power, self test, standby, PFD/ND transfers, INVALID DATA (order 85) |
| `logic/isis.ts` | ISIS power / 90 s INIT / baro / LS / bugs / brightness (order 85) |
| `draw/pfd.ts`, `draw/nd.ts`, `draw/isis.ts`, `draw/fcu.ts`, `draw/displays.ts` | pages |

## Events consumed
`FCU_SPD|FCU_HDG|FCU_ALT|FCU_VS :inc/:dec/:push/:pull`, `FCU_SPD_MACH|FCU_HDG_TRK|FCU_AP1|FCU_AP2|FCU_ATHR|FCU_LOC|FCU_APPR|FCU_EXPED|FCU_METRIC_ALT :press`,
`EFISn_BARO :inc/:dec/:push/:pull`, `EFISn_FD|LS|CSTR|WPT|VORD|NDB|ARPT :press`, `CHRONO_CAPT|CHRONO_FO :press`,
`MAIN_PFD_ND_XFR_CAPT|FO :press`, `SIDESTICK_CAPT|FO_TAKEOVER :press`, `THR_ATHR_DISC1|2 :press`,
`ISIS_BARO :inc/:dec/:push`, `ISIS_LS|BUGS|PLUS|MINUS :press`.

## Events produced
`fg:ap_disconnect {voluntary, ap?}`, `fg:athr_disconnect {voluntary}` (for FWC / audio), `fg:alt_pull`, `fg:alt_push` (in flight only).

## Variables written
| var | meaning |
|---|---|
| `S:FCU_POWERED` | FCU supplied (DC ESS or DC 2) |
| `S:FCU_SPD` | selected speed kt (Mach x100 when `S:FCU_SPD_IS_MACH`) |
| `S:FCU_SPD_IS_MACH`, `S:FCU_SPD_MANAGED`, `S:FCU_SPD_PRESET`, `S:FCU_SPD_DOT` | SPD window state (managed = dashes) |
| `S:FCU_HDG`, `S:FCU_HDG_MANAGED`, `S:FCU_HDG_DASHES`, `S:FCU_HDG_PRESET`, `S:FCU_HDG_DOT` | HDG/TRK window |
| `S:FCU_ALT`, `S:FCU_ALT_INC` (100/1000), `S:FCU_ALT_DOT` | ALT window (LVL/CH dot) |
| `S:FCU_VS` (ft/min), `S:FCU_FPA` (deg), `S:FCU_VS_ACTIVE`, `S:FCU_VS_DASHES`, `S:FCU_VS_PRESET` | V/S-FPA window |
| `S:FCU_TRK_FPA` | 1 = TRK/FPA |
| `S:FCU_AP1`, `S:FCU_AP2`, `S:FCU_ATHR` (0 off, 1 armed, 2 active), `S:FCU_LOC`, `S:FCU_APPR`, `S:FCU_EXPED`, `S:FCU_METRIC_ALT` | |
| `S:FCU_FD1`, `S:FCU_FD2`, `S:FCU_LS1`, `S:FCU_LS2` | EFIS FD / LS pb states |
| `S:EFISn_BARO_STD` | 1 = STD (read by ECAM) |
| `S:EFISn_BARO_HPA`, `S:EFISn_BARO_INHG` (1 = inHg display), `S:EFISn_BARO_PRESEL` (QNH preselected in STD) | |
| `S:EFISn_ND_MODE` (0 ROSE ILS, 1 ROSE VOR, 2 ROSE NAV, 3 ARC, 4 PLAN), `S:EFISn_ND_RANGE` (NM) | |
| `S:EFISn_ND_MSG` (0, 1 MODE CHANGE, 2 RANGE CHANGE), `S:EFISn_OPTION` (0, 1 CSTR, 2 WPT, 3 VOR.D, 4 NDB, 5 ARPT) | |
| `S:EFISn_NAV1`, `S:EFISn_NAV2` (0 off, 1 VOR, 2 ADF), `S:EFISn_CHRONO_STATE` (0/1 run/2 stop), `S:EFISn_CHRONO_S`, `S:EFISn_TERR_ON_ND` | |
| `S:FG_FD1_ENGAGED`, `S:FG_FD2_ENGAGED` | FD engaged (FD pb + FMGC + attitude) |
| `S:FG_THR_MODE` (0, 1 MAN TOGA, 2 MAN FLX, 3 MAN MCT), `S:FG_FLX_TEMP` | FMA column 1 |
| `S:FG_VERT_ACTIVE` (0, 1 SRS, 2 CLB, ...), `S:FG_VERT_ARMED` (0, 1 CLB, 2 ALT) | FMA column 2 |
| `S:FG_LAT_ACTIVE` (0, 1 RWY, 2 RWY TRK, 3 HDG, 4 TRK, 5 NAV), `S:FG_LAT_ARMED` (0, 1 NAV) | FMA column 3 |
| `S:FG_T_THR`, `S:FG_T_VERT`, `S:FG_T_LAT`, `S:FG_T_AP`, `S:FG_T_ATHR`, `S:FG_AP_STATE`, `S:FG_ATHR_STATE` | mode change times (10 s boxes) |
| `S:FG_MANAGED_SPD`, `S:FG_SPD_TARGET`, `S:FG_SPD_TARGET_MANAGED`, `S:FG_FD_PITCH`, `S:FG_FD_ROLL`, `S:FG_FD_YAW` | speed target / FD commands |
| `S:PFDND_DU_<PFD1/ND1/PFD2/ND2>_STATE` (0 off, 1 self test, 2 on, 3 standby), `_CONTENT` (0 PFD, 1 ND, 2 INVALID DATA), `_TEST_REMAIN` | DUs |
| `S:PFDND_XFR_1`, `S:PFDND_XFR_2` | PFD/ND XFR |
| `S:ISIS_POWERED`, `S:ISIS_STATE` (0 off, 1 INIT, 2 on), `S:ISIS_INIT_REMAIN`, `S:ISIS_BARO_HPA`, `S:ISIS_BARO_STD`, `S:ISIS_LS`, `S:ISIS_BUGS_PAGE`, `S:ISIS_BRT` | ISIS |
| `L:FCU_AP1`, `L:FCU_AP2`, `L:FCU_ATHR`, `L:FCU_LOC`, `L:FCU_APPR`, `L:FCU_EXPED` | FCU pb lights |
| `L:EFISn_FD`, `L:EFISn_LS`, `L:EFISn_CSTR/WPT/VORD/NDB/ARPT`, `L:MAIN_TERR_ON_ND_CAPT_ON`, `L:MAIN_TERR_ON_ND_FO_ON` | EFIS / TERR ON ND lights |

Service: `sim.services.pfdnd = { fcu, fg, du, isis }`.

## Variables read (other modules)
Electrical: `S:ELEC_AC_ESS_BUS`, `S:ELEC_AC_ESS_SHED`, `S:ELEC_AC1_BUS`, `S:ELEC_AC2_BUS` (fallback `S:ELEC_AC_POWERED`),
`S:ELEC_DC_ESS_BUS`, `S:ELEC_DC2_BUS`, `S:ELEC_HOT_BUS1`, `S:ANN_POWER`, `S:INTLT_ANN_TEST`. DMC: `S:DMC_POWERED_1..3` (ecam; fallback buses).
ADIRS (sys-misc): `S:ADIRS_CAPT|FO_ATT_VALID/HDG_VALID/NAV_VALID/ADR_VALID` (fallback `S:ADIRS_IRn_STATE`, `S:ADIRS_ADRn_ON`; absent = invalid → red flags),
`S:ADIRS_PITCH`, `S:ADIRS_ROLL`, `S:ADIRS_HDG_MAG/TRUE`, `S:ADIRS_TRK_MAG/TRUE`, `S:ADIRS_GS`, `S:ADIRS_IAS`, `S:ADIRS_TAS`, `S:ADIRS_MACH`,
`S:ADIRS_BARO_ALT_STD`, `S:ADIRS_STATIC_PRESS`, `S:ADIRS_VS`, `S:ADIRS_WIND_VALID/DIR/SPD`, `S:ADIRS_LAT/LON`, `S:ADIRS_SAT`, `S:RA_ALT` (fallback 0 on ground).
FMGS (mcdu): `S:FMGS_POWERED`, `S:FMGS_FMGC1/2_POWERED`, `S:FMGS_PHASE`, `S:FMGS_V1`, `S:FMGS_V2`, `S:FMGS_FLEX`, `S:FMGS_FPLN_ACTIVE`, `S:FMGS_TMPY`,
`S:NAV_ILS_FREQ/CRS`, `S:NAV_VOR1/2_FREQ/CRS`, `S:NAV_ADF1/2_FREQ`, `sim.services.fmgs` (activePlan, toIndex, temporaryPlan, alternatePlan,
pseudoWaypoints, departureRunway, arrivalRunway, nearby, tunedNavaids, messages).
Engines / controls: `S:ENG1_RUNNING`, `S:ENG2_RUNNING`, `C:THR_LEVER1/2`, `G:AC_ON_GROUND`, `G:TIME_UTC`, plus the catalog controls of the FCU,
EFIS panels, `C:MAIN_PFDn_BRT`, `C:MAIN_NDn_BRT`, `C:MAIN_TERR_ON_ND_*`, `C:SW_EIS_DMC`, `C:FCU_ALT_INC`, `C:EFISn_BARO_UNIT/ND_MODE/ND_RANGE/NAV1/NAV2`.

## Dev scenarios (`src/dev/scenarios/pfdnd.ts`)
`/dev.html?display=PFD1&mods=pfdnd,mcdu&power=1&scenario=pfdnd.<name>`: `coldDarkPowered aligning aligned readyForTaxi takeoffThrust
selfTest invalidData isisInit annTest ndRoseNav ndRoseIls ndRoseVor ndPlan ndArc40 ndVord ndArpt` (add `mcdu` for the FMGS flight plan).

## Known gaps
In-flight guidance (CLB/ALT/NAV/LOC/G/S laws, speed trend, VLS/VMAX/F/S/green dot on the tape, mach, FPV/FPD, ECAM/ND XFR on the ND DU,
weather radar, terrain colours (TERR ON ND shows the legend only; LFBD terrain is within 400 ft → black), ISIS bugs editing, ILS deviations
(scales and course only). AP engagement on ground is allowed with engines stopped (FCOM), refused / disconnected once an engine runs.
