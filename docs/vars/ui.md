# UI module (`src/ui/`)

First-person player (camera, input), menus in French, EFB tablet (overlay + 3D tablets), crew / ground messages,
**ground services logic** (owner of the ground `G:` variables) and **end of game** (both engines running).
The DOM-free logic (`ground.ts`, `game.ts`, `checklists.ts`, `sop.ts`, `ofp.ts`, `view.ts`) is unit-tested in
`tests/ui/`; `index.ts` installs it first and returns before any DOM / Three.js work in the headless app.

## Files
| file | content |
|---|---|
| `index.ts` | `install(app)`: ground services + game monitor (headless-safe), then dynamic import of `main.ts` when a document exists |
| `ground.ts` | **DOM-free** ground services model (`GroundServices` system, order 5) and `sim.services.ground` |
| `game.ts` | **DOM-free** end-of-game monitor (system order 98), SOP debrief `evaluate()`, `sim.services.game` |
| `checklists.ts` | Airbus normal checklist (COCKPIT PREP / BEFORE START / AFTER START) + tick state |
| `sop.ts` | SOP reference text (French) cold & dark → engines started |
| `ofp.ts` | OFP (navlog computed from the MCDU nav database, 319 NM / 0055), loadsheet, T.O performance, METAR/TAF/ATIS |
| `view.ts` | pure head model: seat envelope, angle limits, preset views, torso twist |
| `camera.ts` | Three.js head rig (camera parented to `app.aircraft`), smoothing, presets, zoom, seat switch |
| `main.ts` | controller: states (title / play / efb / pause / end), pointer lock, keyboard / mouse / gamepad, HUD wiring |
| `hud.ts`, `menus.ts`, `efb.ts`, `styles.ts`, `dom.ts`, `keys.ts`, `prefs.ts` | DOM overlays |
| `tablet.ts` | 3D EFB tablets (captain + F/O) on RAM-style arms, wall found by ray casting, clickable |

## Ground variables written (owner: ui)
All values 0/1 unless noted. The initial state comes from `applyScenario` (GPU connected, chocks in, jet bridge docked,
L1 open, FWD/AFT cargo open). A variable written by somebody else (test, dev scenario) is **adopted**: the model only
rewrites a variable while it animates it or when its own state changes.

| var | meaning / timing (real pace; "fast" pace shortens the long operations) |
|---|---|
| `G:GND_EXT_PWR` | GPU connected **and running** (EXT PWR AVAIL). Connect: cable at 30 s, power at 42 s. Disconnect: refused while `S:ELEC_EXT_PWR_ON`; GPU stops after 4 s, cable removed at 24 s |
| `G:GND_GPU_CABLE` | GPU cable plugged into the aircraft (for the world visual) |
| `G:JETBRIDGE` | 0 retracted … 1 docked at L1, **continuous**. Retract: refused unless L1 is fully closed; 8 s operator delay + 40 s travel. Dock: refused with an engine turning; 8 s + 55 s |
| `G:DOOR_PAX_L1`, `_L2`, `_R1`, `_R2` | 0 closed … 1 open. Cabin crew: 5 s delay + 7 s travel. Open refused if slides armed / engine turning / (L1) no jet bridge. L1 cannot close during boarding |
| `G:DOOR_CARGO_FWD`, `_AFT`, `_BULK` | 0 … 1. Ramp agents: 12 s delay + 18 s travel (bulk 6 s). Close refused while loading; FWD/AFT are closed by the ramp agents at the end of loading. Open refused with an engine turning. (The yellow elec pump runs while they move — sys-elec detects the motion) |
| `G:GND_CHOCKS` | chocks in place. Removal (15 s) needs `C:PARK_BRK` = 1 |
| `G:BOARDING` | boarding progress 0..1 (after the captain's authorisation; 11 min / 3 min) |
| `G:BOARDING_PAX` | passengers on board (0..156) |
| `G:CARGO_LOADING` | 1 while baggage / cargo loading is in progress (starts 20 s after the game starts; 9 min / 2.5 min) |
| `G:CABIN_READY` | cabin secured: boarding complete and all passenger doors closed, reported 90 s (25 s) later; back to 0 if a door opens |
| `G:SLIDES_ARMED` | escape slides armed (on request, all passenger doors closed; 22 s incl. cross-check) |
| `G:REFUELING` | refuelling in progress (optional truck session: truck 75 s, refuel 4 min — the block fuel is already on board, no fuel is added) |
| `G:GND_FUEL_TRUCK` | fuel truck at the aircraft (world visual) |
| `G:GND_AIR_START_UNIT` | HP air start unit connected (optional; sys-air uses it) — 50 s to connect |
| `G:GND_START_CLEARANCE` | mechanic's clearance for engine start (on request: GPU/bridge/doors/refuel checked, chocks removed if the parking brake is set) |

Not written: `G:GND_TOWBAR`, `G:GND_PUSHBACK` (no pushback in this game), `G:DOOR_CKPT` (shell).

## Controls written (keyboard / gamepad input)
`C:RUDDER` (−1..1, Numpad 0 / Numpad Enter, ramps at 2.5/s, written only while in use), `C:BRAKE_L`, `C:BRAKE_R`
(0..1, key B held or gamepad triggers, written on change only).

## Services
`sim.services.ground` (also `app.services.ground`) — every request returns `{ ok, msg }` and the crew answers with
messages:
```ts
gpu(connect) / connectGpu(connect) · jetbridge(dock) · door(id: 'PAX_L1'|'PAX_L2'|'PAX_R1'|'PAX_R2'|'CARGO_FWD'|'CARGO_AFT'|'CARGO_BULK', open)
chocks(inPlace) · boarding() · slides(arm) · refuel(start) · airStartUnit(connect) · walkaround() · startClearance()
status(): GroundStatus · messages(): GroundMessage[] · onMessage(fn) · pace() / setPace('real'|'fast')
debug: { finishBoarding(), finishLoading(), gateReady() }   // dev scenarios / tests
```
`sim.services.game` (also `app.services.game`):
```ts
state(): 'running'|'complete' · result(): GameResult|null · elapsed() · begin() · markChecklist(id, complete)
forceComplete() · record() · onComplete(fn)
```
`GameResult = { elapsedS, items: {id, section:'prep'|'before'|'start', label, ok, detail?}[], score, total, ecam: string[] }`.
The snapshot for the debrief is taken when the first engine start begins (`S:ENGn_STATE` 1 or 2). Items: safety
walk-around, IRS NAV, FMGS INIT A/F-PLN/INIT B/PERF T.O, BARO REF = QNH, EFB checklists COCKPIT PREP + BEFORE START,
doors/cargo closed + bridge retracted, GPU disconnected, cabin ready + slides armed, mechanic clearance (no refuelling),
beacon ON, parking brake, seat belts ON, windows closed, thrust levers IDLE, ENG MODE IGN/START, start air (APU bleed
or ASU) for each start, ENG 2 first, no start fault / abort / recycle, no ECAM caution at the end.

## Events
| event | direction | payload |
|---|---|---|
| `ground:message` | emitted | `GroundMessage {id, t, utc, from: 'mech'|'purser'|'ramp'|'bridge'|'fuel'|'agent'|'fo', text (French), level: 'info'|'ok'|'warn', call?}` |
| `game:complete` | emitted | `GameResult` (6 s after both `S:ENGn_RUNNING`) |
| `fwc:sound` | emitted | `{sound:'BUZZER', duration:0.45}` for crew calls to the cockpit (cabin ready, boarding complete, slides armed, start clearance) |
| `calls:mech`, `CALLS_FWD:press`, `CALLS_ALL:press` | consumed | the mechanic / purser answer the call |
| `app:ready` | consumed | fit the 3D tablets to the side walls |

## Variables read
`S:ELEC_EXT_PWR_ON`, `C:PARK_BRK`, `C:ELEC_BAT1/2`, `S:ENGn_STATE`, `S:ENGn_RUNNING`, `S:ENGn_N2`,
`S:ENGn_START_FAULT`, `S:ENGn_START_ATTEMPT`, `S:FUEL_FOB_KG`, `G:TIME_UTC`, `G:ENV_QNH`, and for the debrief
`C:EXTLT_BEACON`, `C:THR_LEVER1/2`, `C:ENG_MODE`, `C:SIGNS_SEAT_BELTS`, `C:WINDOW_CAPT/FO`, `C:AIR_APU_BLEED`,
`S:ADIRS_IRn_STATE`, `S:FMGS_INIT_A_DONE`, `S:FMGS_FPLN_DONE`, `S:FMGS_INIT_B_DONE`, `S:FMGS_PERF_TO_DONE`,
`S:EFISn_BARO_HPA`, `S:EFISn_BARO_STD`, `S:APU_AVAIL`, `S:APU_BLEED_VALVE`, `S:APU_BLEED_PRESS`,
`S:BLEED_PRESS_1/2`, `sim.services.ecam.activeWarnings()`.

## Player controls
| input | action |
|---|---|
| mouse | look around (pointer lock "visée", crosshair); in free-cursor mode drag in empty space to look |
| left / right click, wheel, drag | operate the control under the crosshair / cursor (kit conventions); wheel elsewhere = zoom |
| `C` | toggle visée (pointer lock) ↔ free cursor |
| `W A S D` (`Z Q S D` on AZERTY) | lean forward / left / back / right (bounded seat envelope) — physical key codes |
| `Q` / `E` (`A` / `E` on AZERTY) | lower / raise the head |
| arrows | turn the head · `Space` recentre (normal view, no zoom) · `+` / `−` zoom |
| `1`…`9`, `0` | preset views: normal, overhead (2×: aft/ADIRS), pedestal MCDU (2×: thrust levers/ENG, 3×: aft pedestal), ECAM, FCU/EFIS, opposite panel, look left, look right, cockpit door, EFB |
| `F` | switch seat captain ↔ F/O (fade) |
| `Tab` | EFB tablet (also click the 3D tablet) · `H` help · `Esc` pause menu (closes the EFB / sub-panels) |
| `B` held | toe brakes · `Numpad 0` / `Numpad Enter` rudder left / right |
| gamepad (standard) | right stick look, left stick lean, A click, B right click, LB/RB wheel, Y EFB, Start pause, D-pad views, Back recentre, L3 seat, triggers brakes |

Pointer lock is optional: if the page refuses it (sandboxed frame) the game falls back to the free cursor and says so.
Fullscreen (pause menu) failures are reported the same way. Reloads use `location.reload()` only; no absolute URL.

## Settings and preferences
Shared `settings` (src/core/settings.ts): `timeOfDay` and `quality` are changed on the title screen and **reload the
page**; `irsAlign`, `mouseSensitivity`, `invertY`, `fov`, the three volumes, `tooltips`, `showFps`, `weightUnit`
(EFB documents) apply live. UI-only preferences in localStorage `a320.ui` (guarded): `groundPace` ('real'|'fast'),
`efbNight` (null = auto), `pointerLock`.

## URL options and debug
Game or harness: `ui.menu=0|1` (skip / force the title screen; the harness skips it by default), `ui.free=1|0`,
`ui.fo=1`, `ui.view=<preset>`, `ui.efb=<ofp|load|perf|wx|check|sop|ground|settings>`, `ui.pause=1`, `ui.help=1`,
`ui.settings=1`, `ui.end=1`, `ui.gate=1` (ground ready for start), `ui.pace=real|fast`.
Debug handle `window.__ui` (`mode()`, `startGame()`, `openEfb(tab)`, `openPause()`, `help()`, `settings()`, `end()`,
`preset(id)`, `seat('capt'|'fo')`, `pose()`, `fitTablets()`, `ground`, `game`, …).
Dev scenarios (`src/dev/scenarios/ui.ts`): `ui.boarded`, `ui.gateReady`, `ui.startWithBridge`, `ui.enginesRunning`, `ui.endNow`.

## Notes for other modules
- **world**: visualise `G:JETBRIDGE` (continuous 0..1), the door angles (0..1), `G:GND_GPU_CABLE` (cable) /
  `G:GND_EXT_PWR` (GPU running), `G:GND_CHOCKS`, `G:CARGO_LOADING` (belt loaders / baggage carts at FWD/AFT),
  `G:GND_FUEL_TRUCK` (truck under the right wing), `G:GND_AIR_START_UNIT` (ASU cart), `G:BOARDING` (optional).
- The 3D EFB tablets are placed at body (∓0.905, 0.945, −0.50) facing each pilot; their wall plate follows the side
  wall found by ray casting after `app:ready` (nothing to do in the shell).
