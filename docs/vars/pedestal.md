# pedestal — centre pedestal 3D + radio / audio / surveillance logic (`src/cockpit/pedestal`)

Entry `index.ts`: installs the DOM-free logic (`logic/`, one sim system `pedestal`, order 75) first, returns in the
headless test app, then registers the displays (`displays.ts`) and builds the 3D pedestal (`build.ts`).
Services: `sim.services.pedestal` / `app.services.pedestal` = `{ rmp, acp, xpdr, misc }` (logic models),
`app.services.pedestal3d = { root, fwd, flat, stats }` (3D groups, kit.optimise statistics).
Tests: `tests/pedestal/*.test.ts`. Dev scenarios: `src/dev/scenarios/pedestal.ts`
(`radios`, `xpdr`, `takeoff`, `engStart`, `landing`, `printer`):
`/dev.html?module=pedestal&mods=mcdu&power=1&scenario=pedestal.takeoff`.

## Layout (real module sizes, FCOM pedestal figure / FBW A32NX references)
- Sloped section (anchor `PED_FWD`, 20°): MCDU 1 / MCDU 2 (146 × 229 mm) on the outer columns; centre column
  (214 mm): SWITCHING (66.7 mm), ECAM CONTROL PANEL (76.2 mm), blank, front cover of the thrust quadrant. The slope ends
  at slope-local y = +0.108 (8 mm under the SD bezel) with a flat fairing to the main panel face.
- Flat section (anchor `PED`), wide part x ±0.2575 m (146 / 214 / 146 mm columns): RMP 1 / 2 (85.7 mm), ACP 1 / 2
  (95.25 mm), lighting panels (47.6 mm), WX RADAR / ATC-TCAS (66.7 mm); centre: thrust lever quadrant between the two
  pitch trim wheels, ENG panel (112 × 76.2 mm) between two blanks. Wide part ends at body z = −0.105.
- Narrow aft part x ±0.1955 m (146 / 91 / 146 mm): SPEED BRAKE, COCKPIT DOOR, RMP 3, blank | RUD TRIM, PARKING BRK,
  GRAVITY GEAR EXTN | FLAPS, PRINTER. **Aft end of the pedestal top at body z = +0.156** (the `PED` anchor nominally
  extended to +0.45; the real pedestal ends beside the seats), aft face sloping to z = +0.205 at the floor with a
  ventilation grille and the cockpit handset.
- Body: side walls to the floor (y = 0), kick plates, rim lips, dark backing under the panels.

## Controls (all catalog ids of PED_*; interaction beyond the kit defaults)
- Thrust levers `THR_LEVER1/2` (TLA −20…45, detents MAX REV −20, REV IDLE −6, IDLE 0, CL 25, FLX/MCT 35, TOGA 45):
  drag the grip (Shift/Ctrl = both levers), detents capture ±1.6°, click L/R = next/previous detent, wheel = detent
  steps. Reverse only via the **reverse latch** (finger lever in front of each grip) at IDLE: drag it toward you.
  A/THR instinctive disconnect pbs `THR_ATHR_DISC1/2` on the outboard grip ends.
- `PITCH_TRIM` (both wheels, −4…+13.5): pull the wheel top toward you / mouse down = nose UP, wheel = 0.1° (fast
  0.4°). THS pointers on both scales follow `S:FCTL_THS` (fallback `C:PITCH_TRIM`). Scales: degrees 4 DN…13.5 UP, CG
  20…40 % marks (THS = 3.8 − (CG − 17) × 6.3/23), green take-off band 2.6 DN…3.9 UP (the ECAM T.O range).
- `ENG_MASTER1/2`: lift-and-toggle animation (click toggles, drag up = ON, down = OFF, wheel). `ENG_MODE` rotary.
- `SPDBRK_LEVER` 0…1 (½ detent), `SPDBRK_ARM`: pull up at RET (click at RET, drag forward, wheel up); moving the
  lever out of RET disarms.
- `FLAPS_LEVER` 0…4: lifted out of each detent (animation), gates at 1 and 3 stop a single drag, click L/R = next /
  previous, wheel = steps.
- `PARK_BRK`: pull & turn clockwise (ON, pointer to the right) / back (OFF, pointer forward); click toggles, wheel.
- `RUD_TRIM` spring-loaded rotary (hold), `RUD_TRIM_RESET`, `DOOR_CKPT` spring-loaded toggle in its housing
  (UNLOCK / LOCK held), `ACPn_INT_RAD` (INT latched, RAD momentary).
- Selectors whose catalog order differs from the physical side (ALT RPTG ON right, GCS / PWS AUTO right): clicks and
  wheel follow the knob / lever side (right half = clockwise / right).

## Extra controls registered by this module (`registerControls`)
| id | kind | meaning |
|---|---|---|
| `ACPn_RX_<ch>_ON` (n = 1..3, ch = VHF1 VHF2 VHF3 HF1 HF2 INT CAB PA VOR1 VOR2 MKR ILS ADF1 ADF2) | pb | reception knob pulled out (1 = reception ON). Cold & dark: VHF1 and INT out. Click on a reception knob = push/pull, wheel = volume (`C:ACPn_RX_<ch>`). ACP 3 is on the overhead: its knobs have no push/pull there (defaults apply). |
| `AIDS_PRINT`, `DFDR_EVENT` | pbm | F/O lighting panel pushbuttons (events only) |

## Displays (drawn here)
`RMP1..3` 768 × 112 (ACTIVE x 0..384, STBY/CRS x 384..768), `XPDR` 256 × 96, `RUD_TRIM` 192 × 80: amber 7-segment
LEDs with faint unlit segments, 8s on ANN LT TEST, dimmed by ANN LT DIM. MCDU1/2 screens are placed (drawn by mcdu).

## Published variables
| var | meaning |
|---|---|
| `S:RMPn_POWERED`, `S:RMPn_ON` | RMP bus powered / RMP operating (switch ON + power) |
| `S:RMPn_SEL_RADIO` | 1 VHF1, 2 VHF2, 3 VHF3, 4 HF1, 5 HF2 |
| `S:RMPn_NAV`, `S:RMPn_NAV_SEL` | NAV back-up active; 1 VOR 2 ILS 3 MLS 4 ADF |
| `S:RMPn_ACT`, `S:RMPn_STBY` | windows (MHz; −1 = DATA) |
| `S:RADIO_<VHF1…HF2>_ACT`, `S:RADIO_<…>_STBY` | transceiver active / standby (MHz, 0 = DATA) |
| `S:RADIO_VHF3_DATA` | VHF 3 in DATA mode |
| `S:ACPn_POWERED`, `S:ACPn_TX` | ACP powered; transmission channel 0 none, 1 VHF1 … 5 HF2, 6 INT, 7 CAB, 8 PA |
| `S:ACPn_RX_<ch>` | effective reception volume 0..1 (knob out or channel selected for transmission) |
| `S:ACPn_CALL_<VHF1…PA>` | incoming call active on that key (INT = MECH, CAB = ATT) |
| `S:ACPn_INT_RAD` | −1 INT, 0 neutral, +1 RAD |
| `S:ACPn_VOICE` | VOICE filter ON |
| `S:XPDR_CODE` | active code, octal digits as decimal (2000 at start) |
| `S:XPDR_ENTRY` | a new code is being typed |
| `S:XPDR_MODE` | selector 0 STBY, 1 AUTO, 2 ON |
| `S:XPDR_SYS`, `S:XPDR_POWERED`, `S:XPDR_PANEL_POWERED` | selected transponder 1/2 and its power; control panel power |
| `S:XPDR_REPLY` | 0 silent, 1 mode S only (AUTO on ground), 2 all modes |
| `S:XPDR_ALT_RPTG`, `S:XPDR_IDENT`, `S:XPDR_FAIL` | altitude reported, IDENT (18 s), selected XPDR failed |
| `S:TCAS_MODE` | selector 0 STBY, 1 TA, 2 TA/RA |
| `S:TCAS_STATE` | effective 0 STBY / inoperative, 1 TA ONLY, 2 TA/RA (needs XPDR replying + ALT RPTG ON + AC 1) |
| `S:TCAS_POWERED`, `S:TCAS_TRAFFIC` | TCAS computer powered; 0 THRT, 1 ALL, 2 ABV, 3 BLW |
| `S:RUD_TRIM_IND_POWERED`, `S:RUD_TRIM_IND_VALID` | RUD TRIM window supplied (a FAC supply) / a FAC operative |
| `S:WXR_SYS` (0 OFF, 1, 2), `S:WXR_ON`, `S:WXR_MODE` (0 WX, 1 WX+T, 2 TURB, 3 MAP), `S:WXR_GAIN`, `S:WXR_TILT` (deg), `S:WXR_GCS`, `S:WXR_PWS` | WX radar panel state |
| `S:PRINTER_POWERED`, `S:PRINTER_PAPER` (m out of the slot), `S:PRINTER_BUSY` | printer |

Lights written: every catalog light of `PED_RMP1..3` (RMPn_VHF1/2/3, HF1/2, AM, NAV, VOR, ILS, MLS, ADF, BFO, SEL),
`PED_ACP1/2` and `OVHD_ACP3` (ACPn_TX_<ch> green bars, ACPn_TX_<ch>_CALL amber, ACPn_VOICE_ON), `XPDR_FAIL`, plus the
reception knob lights `L:ACPn_RX_<ch>_LT` (not in the catalog). All need the unit's bus and `S:ANN_POWER`.
Other pedestal lights are driven by their owners: MCDUn_* (mcdu), ECP_* (ecam), ENGn_FAULT (sys-air), ENGn_FIRE and
DOOR_CKPT_OPEN/FAULT (sys-misc). The MCDU annunciators are built with their real colours (FAIL, IND, FM1, FM2 amber,
RDY green, FMGC / MCDU MENU / FM white) on the same light ids.

## Events
- In: `XPDR_KEY {key}`, `XPDR_IDENT:press`, `RMPn_*:press`, `RMPn_OUTER/INNER:inc|dec {steps}`, `ACPn_TX_<ch>:press`,
  `ACPn_RESET:press`, `PRINTER_TEST:press`.
- In (for other modules): `acp:call {ch: 'MECH'|'ATT'|'VHF1'|…|'PA', on?: boolean, acp?: n | n[]}` — incoming call
  (MECH = ground mechanic calling the flight deck, ATT = cabin attendant); `xpdr:fail {sys, on?}`, `xpdr:code {code}`
  (e.g. EFB clearance), `printer:tear`.
- Out: `acp:call_start {ch}` (for the audio buzzer / chime), `sfx` (kit) with ids `ENG_MASTERn`, `PARK_BRK`,
  `PITCH_TRIM` (kind 'trim'), lever detents (kind 'detent').

## Power (logic/power.ts, fallback `S:ELEC_AC_POWERED` when a bus var is absent)
RMP 1 DC ESS, RMP 2 DC 2, RMP 3 DC 1; ACP (AMU) 1 DC ESS, 2 DC 2, 3 DC 1; XPDR 1 AC ESS SHED / AC ESS, XPDR 2 AC 2
(the ATC panel is lit by either); TCAS AC 1; WXR 1 AC 1, 2 AC 2; RUD TRIM window: FAC 1 (AC ESS + DC ESS SHED) or
FAC 2 (AC 2 + DC 2) supply; printer AC 1.
