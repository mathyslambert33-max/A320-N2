# ECAM module (`src/avionics/ecam/`)

FWC (flight phases, warnings / cautions / memos, aural alerts), DMC page logic, ECAM control panel,
E/WD and SD display units. Logic in `logic/` is DOM-free (vitest: `tests/ecam/`); drawing in `draw/`
(Canvas 2D, displays `EWD` and `SD`, 1024×1024, B612).

Dev harness: `/dev.html?display=EWD|SD&mods=ecam&power=1&scenario=ecam.<name>` with scenarios
`coldDarkPowered`, `apuRunning`, `eng2Starting`, `enginesRunning`, `fireTest`, `toMemo`, `toMemoDone`,
`sdENG` … `sdFCTL`, `sdCRUISE`, `sdSTS` (`src/dev/scenarios/ecam.ts`). Use `coldDarkPowered` without `power=1`
(the harness forces `S:ENGn_FADEC_ON`).

## Published variables

| Var | Meaning |
|---|---|
| `S:FWC_POWERED` | at least one FWC powered (FWC1 AC ESS BUS, FWC2 AC BUS 2) |
| `S:FWC_FLIGHT_PHASE` | 1..10 (0 when both FWCs unpowered) |
| `S:FWC_MASTER_WARN`, `S:FWC_MASTER_CAUT` | MASTER WARN / MASTER CAUT active (steady; the lights are below) |
| `S:FWC_CRC` | continuous repetitive chime active |
| `S:FWC_TO_MEMO` | T.O memo displayed |
| `S:FWC_TO_CONFIG_OK` | "T.O CONFIG NORMAL" displayed |
| `S:FWC_WARNING_COUNT`, `S:FWC_CAUTION_COUNT` | displayed level 3 / level 1-2 alerts |
| `S:ECAM_SD_PAGE` | page shown on the lower DU: 0 none (DU off / self test / E/WD transferred), 1 ENG, 2 BLEED, 3 PRESS, 4 ELEC, 5 HYD, 6 FUEL, 7 APU, 8 COND, 9 DOOR, 10 WHEEL, 11 F/CTL, 12 STS, 13 CRUISE |
| `S:ECAM_SD_PAGE_SELECTED` | page selected by the DMC logic (even if the DU is off) |
| `S:ECAM_UPPER_DU_ON`, `S:ECAM_LOWER_DU_ON` | DU on (not off / standby / self test) |
| `S:DMC_POWERED_1..3` | DMC1 AC ESS BUS, DMC2 AC BUS 2, DMC3 AC BUS 1 |

## Lights

`L:MASTER_WARN` (flashing 1 Hz), `L:MASTER_CAUT`, `L:ECP_ENG` … `L:ECP_FCTL` (page key lit when the page is
manually selected or called by a failure), `L:ECP_STS` (STATUS displayed), `L:ECP_CLR` (something to clear).
All need `S:ANN_POWER`; ECP lights also need the ECP (DC ESS / DC 2 / DC BAT) and an FWC.

## Events

- Emits `fwc:sound` `{sound}`: `CRC` (new level-3 warning, repeats in the audio module until `STOP_CRC`),
  `STOP_CRC` (MASTER WARN pb, EMER CANC, or no more level-3 warning), `SC` (new caution, max one per 2 s).
- Consumes: `WARN_MASTER_WARN_CAPT/FO:press`, `WARN_MASTER_CAUT_CAPT/FO:press`, `ECP_<PAGE>:press`,
  `ECP_ALL:press/release` (+ `C:ECP_ALL`), `ECP_CLR_L/R:press`, `ECP_STS:press`, `ECP_RCL:press` (+ `C:ECP_RCL`
  held 3 s recalls cancelled cautions), `ECP_EMER_CANC:press`, `ECP_TO_CONFIG:press` (+ `C:ECP_TO_CONFIG`).

## Service `sim.services.ecam`

```ts
activeWarnings(): { text: string; level: 1 | 2 | 3; displayed: boolean }[]  // highest priority first
ewdText(): { left: string[]; right: string[] }                            // E/WD memo/warning lines
flightPhase(): number;  sdPage(): number;  core: EcamCore
debug: { skipSelfTest(), forcePhase(p), forceToMemo(), showPage(p) }       // scenarios / tests
```

## Variables read (other modules) — all optional, missing vars degrade gracefully

Documented in `docs/SIMVARS.md` and used as is: ELEC buses / gens / batteries / `S:ELEC_<SRC>_V/_HZ/_LOAD/_A`,
HYD, BRK, FUEL, APU, BLEED/PACK/COND/PRESS, ENG (`S:ENGn_*`, `S:ENG_THR_LIMIT_*`, `S:ENG_FLX_TEMP`), ADIRS,
FIRE, FCTL, GEAR, AUTOBRK, SIGNS, `S:OXY_CREW_PRESS`, `S:NWS_AVAIL`; FMGS (`docs/vars/mcdu.md`): `S:FMGS_V1/VR/V2`,
`S:FMGS_FLEX`, `S:FMGS_TO_CONF`, `S:FMGS_THS_FOR`, `S:FMGS_ZFW`, `S:FMGS_GW`, `S:FMGS_CG`, `S:FMGS_DEST_ELEV`,
`S:FMGS_POWERED`; scenario `G:` vars (`G:DOOR_*`, `G:AC_ON_GROUND`, `G:AC_GS_KT`, `G:ENV_OAT`, `G:TIME_UTC`,
`G:GND_TOWBAR`); controls from the catalog.

**Assumed names (not in SIMVARS.md yet) — owners please publish or tell me the real name:**

| Var | Used for | Fallback when absent |
|---|---|---|
| `S:RA_ALT` / `G:AC_RADALT_FT` | phases 5/6/7 (1500 / 800 ft) | 0 on ground, 5000 airborne |
| `S:EFIS1_BARO_STD`, `S:EFIS2_BARO_STD` | ISA line on the SD | not shown |
| `S:ENG_TOGA_N1`, `S:ENG_IDLE_N1` | N1 max mark, TLA donut | 99.3 / 19.5 % |
| `S:ELEC_EMER_GEN_ON/_V/_HZ`, `S:ELEC_IDGn_TEMP/_DISC` | ELEC page | EMER GEN off, IDG 65 °C |
| `S:FUEL_CTR_PUMPS_ON`, `S:FUEL_OUTER_XFR_L/R`, `S:FUEL_TEMP_L/R` | FUEL page | pb state, closed, OAT |
| `S:TIRE_PRESS_1..6` | WHEEL page TPIS | nominal pressures |
| `S:SMOKE_CARGO_FWD_DET`, `S:SMOKE_CARGO_AFT_DET` | SMOKE FWD/AFT CARGO SMOKE | `C:CARGO_SMOKE_TEST` held > 1 s |
| `S:FIRE_ENGn_TEST`, `S:FIRE_APU_TEST` (documented) | fire test | `C:FIRE_ENGn_TEST` / `C:FIRE_APU_TEST` held |
| `S:VENT_INLET_VALVE`, `S:VENT_EXTRACT_VALVE` | PRESS page vent indicators | closed |
| `S:APU_OIL_LOW`, `S:APU_SHUTTING_DOWN` (documented) | APU page | — |
| `S:HYD_x_RSVR_OVHT`, `S:HYD_x_RSVR_LO_AIR` | HYD page | not shown |
| `G:CABIN_READY` | T.O memo CABIN READY | CHECK (cyan) until set |
| `G:REFUELING` | REFUELG memo | — |
| `G:SLIDES_ARMED` | DOOR page SLIDE labels | disarmed |

Surface sign convention assumed for F/CTL: `S:FCTL_AIL_*`, `S:FCTL_ELEV_*` + = trailing edge down;
`S:FCTL_RUDDER` + = right.
