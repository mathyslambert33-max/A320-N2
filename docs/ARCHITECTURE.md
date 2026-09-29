# A320 Cockpit — architecture & team contract

Goal: a **first-person, highly realistic 3D A320ceo (CFM56-5B) cockpit** running locally in the browser
(Three.js + TypeScript + Vite). The player starts **COLD & DARK** at LFBD (Bordeaux, stand 14) and must
bring the aircraft to **both engines started** following the **real Airbus SOPs** (safety exterior → preliminary
cockpit preparation → cockpit preparation → MCDU INIT/F-PLN/PERF → before start → engine start at the
stand → after start). **No pushback, no taxi** (user decision 2026-09-28). **Free mode only**: no highlighting of the next action. The aircraft must
react like the real one (ECAM, lights, sounds, timings). Game UI in **French**; cockpit labels,
ECAM, MCDU and checklists in **English**, like the real aircraft.

Quality bar: this is judged on realism and detail. Real dimensions, real layouts, real colours, real
behaviours, real timings. When unsure, research (WebSearch/WebFetch: Airbus FCOM descriptions,
FlyByWire A32NX docs `docs.flybywiresim.com`, smartcockpit, pilot forums) rather than guess.

## Run
```
source env.sh            # macOS workstation only: puts the project-local Node on PATH
npm run dev              # http://127.0.0.1:5173  (game)   — a shared dev server is usually already running
npm run typecheck        # tsc --noEmit over the whole repo
npm test                 # vitest (headless system tests, incl. the whole-game SOP test)
node tools/shot.mjs "/dev.html?..." shots/x.png 1600 1000 3000   # headless screenshot
node tools/check-vars.mjs  # variables read but never written, lights never driven, etc.
```
- macOS workstation: the repo path contains spaces — always quote paths. `shot.mjs` uses the system Chrome (Metal).
- Linux / cloud containers: Node is on PATH; `shot.mjs` uses the preinstalled Playwright Chromium with SwiftShader
  software WebGL (60–120 s per shot: serialise with `flock /tmp/shot.lock node tools/shot.mjs …` when several agents
  work at once). Blender is the `bpy` module (`pip install "bpy==4.5.*"`), run through `tools/blender.sh` as below.
- Static build (also used for the playable artifact): `npx vite build --base ./` — never hard-code absolute asset
  URLs; load files from `public/` with `import.meta.env.BASE_URL + 'models/…'`.

## Layout of the code (each agent owns ONE folder; never edit files outside your folder)

| folder | owner agent | content |
|---|---|---|
| `src/core/*`, `src/displays/framework.ts`, `src/cockpit/kit/*`, `src/cockpit/layout.ts`, `src/app.ts`, `src/main.ts`, `src/dev/harness.ts`, `tools/*`, `docs/ARCHITECTURE.md`, `docs/SIMVARS.md` | **lead** (integrator) | shared contract — read-only for everyone else |
| `src/systems/elec-hyd-fuel-apu/` | sys-elec | electrical, hydraulics+brakes, fuel, APU |
| `src/systems/air-eng/` | sys-air | pneumatics, air cond, pressurisation, anti-ice, CFM56 engines |
| `src/systems/misc/` | sys-misc | ADIRS, fire, F/CTL, gear/NWS/autobrake, lights & signs, misc overhead |
| `src/avionics/ecam/` | ecam | E/WD, SD pages, ECAM control panel logic, FWC (warnings, memos, chimes) |
| `src/avionics/pfdnd/` | pfdnd | PFD, ND, ISIS, FCU + EFIS CP logic & windows |
| `src/avionics/mcdu/` | mcdu | MCDU display & FMGS (nav database LFBD/LFPO, INIT, F-PLN, PERF, RAD NAV…) |
| `src/audio/` | audio | procedural WebAudio: systems, engines, APU, chimes, clicks |
| `src/cockpit/overhead/` | overhead | 3D overhead panel (fwd + aft maintenance + CB panels) |
| `src/cockpit/mainpanel/` | mainpanel | 3D glareshield (FCU, EFIS, warnings) + main instrument panel + clock/DDRMI/brake gauge |
| `src/cockpit/pedestal/` | pedestal | 3D pedestal + RMP/ACP/ATC/TCAS/WXR/rudder-trim logic & windows |
| `src/cockpit/shell/` | shell | 3D cockpit structure, windows, seats, sidesticks, pedals, tillers, consoles, interior lights |
| `src/world/` | world | LFBD airport, sky/sun/time of day, exterior aircraft, exterior lights, pushback motion |
| `src/ui/` | ui | first-person player/camera, menus (FR), settings, EFB tablet (checklists/OFP/ground services), tooltip, keyboard/gamepad input |
| `tests/<module>/` | same owner | vitest tests |
| `docs/vars/<module>.md` | same owner | variables your module exports (beyond SIMVARS.md) |

If you absolutely need a change in a lead-owned file, **do not edit it**: work around it locally and
explain the need in your final report.

## Module entry point
Every module folder has `index.ts`:
```ts
import type { App } from '../../app';          // adjust depth
export default function install(app: App): void | Promise<void> { … }
```
`App` (see `src/app.ts`) gives: `sim`, `settings`, `renderer`, `scene`, `aircraft` (group that moves with
pushback), `cockpit` (group, aircraft body frame), `world` (static airport group), `camera`, `kit`,
`interaction`, `onFrame(fn, order)`, `isHarness`, `post` (post-processing handle).
Systems/avionics modules must stay **DOM-free in their logic** (so vitest can run them): put logic in
separate files that only import `src/core/*`; drawing code may use Canvas.

## Simulation bus (`src/core/sim.ts`)
Flat numeric variables + events. `C:` controls, `L:` lights, `S:` systems, `G:` ground/env.
- Systems: `sim.register({ name, order, init?, update(dt, sim) })`, fixed step 1/30 s.
- Read controls with `sim.get('C:ELEC_BAT1')`; write lights `sim.set('L:ELEC_BAT1_OFF', 1)`.
- **Lights**: the system that owns a control computes its lights, *already accounting for power*
  (annunciators need DC power: use `S:ANN_POWER` from sys-misc or bus vars). The kit handles
  ANN LT TEST (`S:INTLT_ANN_TEST`) and DIM (`S:INTLT_ANN_DIM`) itself — do not fake them per light.
- Shared variables: `docs/SIMVARS.md` (the interface). Use string literals like `'S:ENG1_N2'` so tools
  can grep them; templates like `` `S:ENG${n}_N2` `` are OK.
- Cold & dark initial control positions come from `src/core/catalog.ts` (`applyColdAndDark`).
- Scenario/environment in `src/core/scenario.ts` (LFBD→LFPO, weights, weather per time of day, stand).

## Catalog (`src/core/catalog.ts`)
Every control, annunciator and display with exact ids, kinds, positions, legends and initial values.
3D agents must build **every** control of their panels with these ids. System agents must drive
**every** light of the controls they own.

## Displays (`src/displays/framework.ts`)
`registerDisplay({ id, width, height, hz, powered, brightness, draw })`; 3D side uses
`kit.screen(...)`/`getDisplayTexture(id)`. Helpers: `DU` colours, `FONT` (B612 = real Airbus display
font; B612 Mono for MCDU; Barlow Semi Condensed for panel engravings), `drawSevenSeg`, `text`.
Fonts are loaded by `src/fonts.ts` (imported by app & harness).

## Coordinates (3D)
Metres. Aircraft body frame: **+X right (toward F/O), +Y up, −Z forward (toward the nose)**.
Origin: aircraft centreline, cockpit floor level, Z = 0 at the pilots' design eye station.
Captain eye ≈ (−0.53, 1.28, 0.0); F/O eye ≈ (+0.53, 1.28, 0.0). Panel anchors are in
`src/cockpit/layout.ts` (lead) — build panels in their local frame and place them with the anchor.

## 3D kit (`src/cockpit/kit/`)
Factories for realistic Airbus hardware — use them so everything looks and behaves consistently:
panels with engraved/back-lit labels, pushbuttons with lit legends, toggle switches, rotary selectors,
knobs, encoders (push/pull), guards, levers, keys, annunciators, screens with glass, 7-seg windows.
They register interaction (click / right-click / wheel / drag) and write `C:` vars / emit events.
See `src/cockpit/kit/README.md`.

## Interaction conventions (implemented by the kit)
- pushbutton: left click toggles (latching) or press-and-hold (momentary).
- toggle switch: left click = up/next, right click = down/previous, wheel = up/down.
- rotary selector / knob: wheel up or right click = clockwise, wheel down or left click = counter-clockwise, or drag.
- encoder (FCU, baro): wheel = rotate (fast wheel = bigger steps), left click = PUSH, right click = PULL.
- guard: click the guard to open/close it; the control below is only reachable when open.
- levers: drag with the mouse (or wheel), snaps to detents.

## Dev harness (`dev.html`)
- `/dev.html?module=overhead` → builds only that module in an otherwise empty cockpit, camera at the
  captain eye looking at it; `&cam=px,py,pz,tx,ty,tz` custom camera; `&orbit=1` orbit controls;
  `&power=1` fake-powers everything (panel lights, displays); `&night=1` night lighting;
  `&test=1` ANN LT TEST; `&set=C:ELEC_BAT1=1,S:ENG1_N2=58` set vars; `&mods=a,b` load several modules.
- `/dev.html?display=PFD1&mods=pfdnd&scenario=<name>` → shows one display canvas 1:1.
  Scenarios: `src/dev/scenarios/<module>.ts` export `scenarios: Record<string, (sim)=>void>`.
- The harness sets `window.__ready = true` when it has rendered, for `tools/shot.mjs`.

## Performance budget (Apple M2, 2560x1664)
60 fps target at "high". Keep draw calls reasonable: merge static geometry per panel (the kit's
`PanelBuilder` does it), share materials, avoid per-frame allocations, redraw displays only at their
`hz`. Canvas displays ≤ 1024².

## Definition of done for every agent
1. `npm run typecheck` passes for your files (ignore errors in other agents' in-progress folders).
2. Your module installs without console errors in the harness (and the full game if it runs).
3. Tests (systems/avionics) pass; 3D modules checked visually with `tools/shot.mjs` (look at the PNGs!).
4. `docs/vars/<module>.md` lists exported variables/events; final report lists anything you needed
   from other modules or the lead.

## 3D assets from Blender (organic / curved parts only)
Panels and controls are generated in code with the kit (exact sizes, interactive). Blender (5.2.2 app in
`.tools/blender` on the macOS workstation, or the `bpy` 4.5 LTS Python module in Linux containers — scripts must run
on both: read args after `--`, start with `bpy.ops.wm.read_factory_settings(use_empty=True)`, Blender 4.5 APIs only) is for
organic or curved parts that code primitives render poorly: seats, sidesticks, tillers,
windshield/window frames, curved linings. Rules:
- Reproducible: a Python script per asset in `tools/blender/<module>/<name>.py`, run with
  `tools/blender.sh tools/blender/<module>/<name>.py -- public/models/<module>/<name>.glb`; commit the script and the .glb.
- Units metres; model in Blender Z-up (the glTF exporter converts to Y-up); origin at a meaningful pivot
  (e.g. sidestick pivot) so the part can be placed/animated in Three.js; apply modifiers on export (`export_apply=True`).
- Load with `GLTFLoader` (`three/examples/jsm/loaders/GLTFLoader.js`) from `import.meta.env.BASE_URL + 'models/...'`; replace materials by kit
  materials by name where possible; join meshes per material to keep draw calls low; moving parts as separate named nodes.
- Check the result in the harness with `tools/shot.mjs` (never trust the script without looking at the PNG).
