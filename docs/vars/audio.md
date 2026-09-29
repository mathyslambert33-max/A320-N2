# Audio module (`src/audio/`)

Procedural Web Audio engine: every sound is synthesised (oscillators, looping noise buffers, filters,
wave-shapers, buffers rendered in JS at start-up). No audio files. The module **writes no sim variable**;
it only reads the sim and listens to events.

## Files
| file | content |
|---|---|
| `index.ts` | `install(app)`: lazy AudioContext (first pointerdown/keydown/touchstart), event wiring, 30 Hz update, `app.services.audio` |
| `engine.ts` | `AudioEngine`: voices, listener (camera pose in the aircraft body frame), openings (windows/doors), relays, event dispatch |
| `core.ts` | buses, hull transmission, leak paths through openings, node helpers, `Voice` base class (sources stopped when silent), body-frame source positions `POS` |
| `mappings.ts` | pure helpers (N1/N2/APU → pitch & levels, PTU bark rhythm, openings, envelopes, fan dynamics…) — unit tested |
| `synth.ts` | pure offline synthesis: FWC alerts, cabin chime, mechanical clicks (modal synthesis), whump, noise loops, room IR — unit tested |
| `alerts.ts` | FWC aural alerts + cabin chime playback / repetition |
| `oneshots.ts` | 'sfx' clicks, relays, valve thumps, igniter snaps, light-off whumps (pooled panners) |
| `voices/*.ts` | continuous voices: cockpit (avionics fans, elec hum, pack air, cabin air), engines + APU, hydraulics/fuel/valves, ground (tug, GPU, jet bridge, horns), ambience, wipers/windows |
| `selftest.ts` | `audioSelfTest(app, filter?)` — plays everything in sequence through an override layer (sim untouched) |

## Service `app.services.audio`
```ts
resume(): Promise<void>      // create + resume the AudioContext (call from a user gesture, e.g. the menu "Start" button)
context: AudioContext | null // null until the first gesture / resume()
setMuted(b: boolean): void   // smooth mute (master)
muted: boolean
selfTest(filter?: string): Promise<void>   // see below
stopSelfTest(): void
engine: AudioEngine | null   // debug access (engine.overrides, engine.debug())
debug(): { state, sampleRate, voices: { name: running } }
```
In a HeadlessApp / node (no `window` or no `AudioContext`) the service is a no-op stub.
Volumes follow `settings.masterVolume`, `cockpitVolume` (systems, clicks, exterior), `alertVolume`
(FWC alerts), x² perceptual curve, live via `settings.onChange`. The context is suspended while the tab is hidden.

### Self-test (browser console)
Click once anywhere in the page (browser autoplay policy), then:
```js
window.__app.services.audio.selfTest()            // everything, ~6 min
window.__app.services.audio.selfTest('alerts')    // only steps whose name contains 'alerts'
window.__app.services.audio.stopSelfTest()
```
Steps: `clicks, relays, alerts, cabin, battery, fans, packs, hyd-yellow, hyd-blue, ptu, fuel, apu, engine,
wipers, window, gpu, tug, jetbridge, ambience, horns`. The console logs each step. Works in the game and in
`/dev.html?module=audio`. The self-test never writes sim variables (engine-side overrides only).

## Events consumed
| event | payload | use |
|---|---|---|
| `sfx` | `{kind, id, x, y, z}` (kit; **x/y/z in aircraft body frame**) | mechanical click at the control. Kinds: `pb pbm sw swm rot rotm pot enc push pull key guard lever detent` (unknown kind → pb). Optional `up/release/phase:'up'` → lighter release click, `value:0` → pb released. Special ids: `ENG_MASTER*` (lever-lock pull + snap), `PARK_BRK` (ratchet + clunk), `GEAR_LEVER` (heavy), `THR_LEVER*`/`FLAPS_LEVER`/`SPDBRK_LEVER` (detent clunk), `WINDOW_*` (latch), `PITCH_TRIM` (ratchet), `ADIRS_KEY*`/`XPDR_KEY*` (hard keys). Missing x/y/z → rough panel position from the catalog. Wheel storms are rate-limited per control. |
| `fwc:sound` | `{sound}` | `SC`, `CRC` (repeats until `STOP_CRC`), `CAVALRY` (1.5 s), `CCHORD` (1.5 s), `CLICK`, `TRIPLECLICK`, `BUZZER` (1.2 s). **Extensions** (optional): `{sound:'CAVALRY', loop:true}` continuous until `STOP_CAVALRY`; `{sound:'CCHORD', loop:true}` until `STOP_CCHORD`; `{sound:'BUZZER', duration:s}` or `loop:true` until `STOP_BUZZER`; `CRICKET`/`STOP_CRICKET`; `STOP_ALL`. A string payload (`'SC'`) is also accepted. |
| `cabin:chime` | `{type?: 'lo'｜'hi'｜'hilo'}` (default `lo`) | CIDS chime heard through the cockpit door (low single chime for signs) |
| `WARN_MASTER_WARN_CAPT/FO:press` | — | stops CRC + continuous cavalry / C chord (safety net; ECAM also sends STOP_CRC) |
| `ECP_EMER_CANC:press` | — | stops CRC |
| `SIDESTICK_CAPT/FO_TAKEOVER:press` | — | stops the cavalry charge |
| `EVAC_HORN_SHUTOFF:press` | — | silences the cockpit EVAC horn |
| `fcs:dual_input`, `fcs:priority` `{side}` | — | synthetic voice "DUAL INPUT", "PRIORITY LEFT / RIGHT" (`callouts.ts`, browser speech synthesis, en-US) |
| `gpws:aural` | `{msg, test?}` | synthetic voice of the GPWS message (e.g. the GPWS TEST sequence) |

Also driven by state: `S:CALLS_MECH` (CALLS MECH held → the nose-gear-bay horn sounds continuously to call the
ground mechanic) and `S:RCDR_CVR_TEST` (CVR TEST held → low-frequency 400 Hz test signal in both loudspeakers,
scaled by the LOUDSPEAKER knobs `C:MAIN_LOUDSPEAKER_CAPT/FO`).

## Variables read
Only read; fallbacks in brackets. **Assumed** = not in SIMVARS.md.

| sound | variables |
|---|---|
| Avionics ventilation fans | `S:VENT_BLOWER_ON`, `S:VENT_EXTRACT_ON` [fallback when not defined: `S:ELEC_AC_POWERED`/`S:ELEC_AC1_BUS`/`S:ELEC_AC2_BUS`] |
| Electrical hum / DC whine | `S:ELEC_AC_POWERED`, `S:ELEC_AC1_BUS`, `S:ELEC_AC2_BUS`, `S:ELEC_EXT_PWR_ON`, `S:ELEC_APU_GEN_ON`, `S:ELEC_GEN1_ON`, `S:ELEC_GEN2_ON`, `S:ELEC_{EXT,APU_GEN,GEN1,GEN2}_HZ` (hum pitch), `S:ELEC_STAT_INV`, `S:ELEC_DC_BAT_BUS`, `S:ELEC_DC_ESS_BUS`, `S:ELEC_DC1_BUS` |
| Contactor clacks (bus transfers) | transitions of `S:ELEC_DC_BAT_BUS`, `DC_ESS_BUS`, `DC1_BUS`, `DC2_BUS`, `AC1_BUS`, `AC2_BUS`, `AC_ESS_BUS`, `EXT_PWR_ON`, `APU_GEN_ON`, `GEN1_ON`, `GEN2_ON`, `STAT_INV`, `HOT_BUS1/2` |
| Pack air (cockpit outlets, duct, ACM whine) | `S:PACK1_FLOW`, `S:PACK2_FLOW` |
| Cabin air through the door | `C:VENT_CAB_FANS` + AC powered, `S:PACK1_FLOW`, `S:PACK2_FLOW` |
| Engines (per n) | `S:ENGn_N1`, `S:ENGn_N2`, `S:ENGn_EGT`, `S:ENGn_FF`, `S:ENGn_START_VALVE`, `S:ENGn_IGN_A`, `S:ENGn_IGN_B`, `S:ENGn_STATE`, `G:ENV_OAT` |
| APU | `S:APU_N`, `S:APU_EGT`, `S:APU_FLAP_POS` (motor runs while it moves), `S:APU_STARTING` [fallback: N rising below 56 %], `S:APU_BLEED_VALVE` (load), `G:ENV_OAT` |
| Hydraulic pumps | `S:HYD_Y_ELEC_PUMP_ON`, `S:HYD_B_ELEC_PUMP_ON`, `S:HYD_Y_PRESS`, `S:HYD_B_PRESS` |
| PTU | `S:HYD_PTU_ACTIVE` (each rising edge barks immediately; while held, barks are generated, steady drone after 7 s) |
| Fuel pumps (very faint) | **inferred** from `C:FUEL_L_PUMP1/2`, `C:FUEL_R_PUMP1/2` pb + AC powered; centre pumps if `S:FUEL_C_KG` > 50 and an engine `S:ENGn_RUNNING` (no `S:` pump-running var exists) |
| X FEED valve motor | changes of `C:FUEL_XFEED` with DC power (1.6 s travel) |
| Avionics skin valve motors | changes of `S:VENT_EXTRACT_VALVE`, `S:VENT_INLET_VALVE` (0/1 → 4 s travel; fractional → while moving) |
| Pneumatic valve slams | transitions of `S:PACK1_VALVE`, `S:PACK2_VALVE`, `S:APU_BLEED_VALVE`, `S:BLEED_XBLEED_VALVE`, `S:BLEED_ENG1_VALVE`, `S:BLEED_ENG2_VALVE`, `S:ENGn_START_VALVE` |
| Openings / hull | `C:WINDOW_CAPT`, `C:WINDOW_FO`, `G:DOOR_PAX_L1`, `G:JETBRIDGE`, cockpit door: **assumed `G:DOOR_CKPT`** (0 closed..1 open) → **assumed `S:CKPT_DOOR_OPEN`** → default **open** (typical at the gate) |
| Wipers | `S:WIPER_CAPT_POS`, `S:WIPER_FO_POS` (end-of-stroke thumps from direction reversals) |
| Window slide rumble | `C:WINDOW_CAPT`, `C:WINDOW_FO` (velocity) |
| Pushback tug | `G:GND_TOWBAR` (idling), `G:GND_PUSHBACK` (==1 pushing), `G:AC_GS_KT` |
| GPU diesel | `G:GND_EXT_PWR`, `S:ELEC_EXT_PWR_ON` (load) |
| Jet bridge | `G:JETBRIDGE` (hum while docked, drive motors + beeper ~12 s after each change) |
| Nose-gear-bay horn | `S:ADIRS_ON_BAT` && !`S:ELEC_AC_POWERED` → intermittent; `S:FIRE_APU_DET` → continuous; only if `G:AC_ON_GROUND` (≠0 or undefined) |
| Cockpit EVAC horn | `C:EVAC_COMMAND` + DC power (`S:ELEC_DC_BAT_BUS`/`S:ELEC_DC_ESS_BUS`), silenced by `EVAC_HORN_SHUTOFF:press` |
| Ambience | `G:ENV_WIND_KT` (wind noise, gusts), `settings.timeOfDay` (night = quieter, fewer events) |

## Spatialisation
Listener = camera pose expressed in the aircraft body frame (`inverse(aircraft.matrixWorld) × camera.matrixWorld`),
updated at 30 Hz with smoothing; sources are placed in the same body frame (identical geometry to world space;
nothing to update during pushback). HRTF panners for flight-deck sources (clicks, fans, vents, wipers, windows,
leaks through openings), equal-power for distant/diffuse ones (engines, APU, pumps, tug, GPU, FWC loudspeakers).
Main positions (m, body frame): avionics bay (0.1, −1.1, 1.3); FWC loudspeakers (±0.85, 1.62, −0.1); cockpit door
(0, 1, 1.75); engines (±5.75, −1.7, 12.5); APU (0, 1.4, 32); PTU (0.4, −2.2, 12.8); Y/B pumps (±1.1, −2.2, 13.2);
tug (0, −2.7, −5.5); GPU (2.8, −2.9, −1.2); L1 door (−1.9, 0.9, 3.4).

Exterior sources (outside the pressure hull) reach the ear through two paths: the **hull** (low-pass 650-1100 Hz
+ −10 dB high shelf, mass law) and **leaks** through open windows (bright, next to the ear) or the cockpit door + L1
door (muffled when the jet bridge is docked). Sound design keeps the aircraft almost silent in cold & dark with
everything closed.

## Sound design notes
- **Clicks** — modal synthesis (sum of decaying modes + filtered noise transient), 4 random variants per kind,
  ±2.5 % pitch: Airbus pushbutton = plunger "clack" + latch 28 ms later; toggle = sharp metallic snap (4-7 kHz);
  rotary = two-stage detent tick; guard = hollow plastic clack + rattle; MCDU key = soft rubber dome thud + release;
  thrust/flap lever detent = heavy 160 Hz clunk; ENG MASTER = pull then snap; parking brake = ratchet then clunk.
- **Avionics ventilation** — pink broadband whoosh (bay, under the floor) + hiss through the panel grilles with slow
  turbulence, two slightly detuned impeller whines (≈ 590/707 Hz at speed → beating). AC motors spin up in ~3 s
  (τ 0.9 s) and coast down in ~8 s (τ 2.6 s). DC-only (batteries) = almost silent: faint 3.9 kHz electronic whine.
- **Electrical** — 400 Hz network hum dominated by the 800 Hz magnetostriction harmonic (pitch from `S:ELEC_*_HZ`);
  contactor clunks under the floor on each bus transfer.
- **Packs** — overhead + lateral outlet airflow, mixer-duct rumble, faint air-cycle-machine whine (≈ 2.4-2.6 kHz) through the floor.
- **CFM56-5B** — start valve: band-passed air rush (600 → 2400 Hz with N2) and a valve thump; air-turbine starter
  whine 160 Hz + 52 Hz/%N2 (only while the valve is open, ends at 50 % N2); HP core whine 90 + 22.5 Hz/%N2
  (≈ 1.4 kHz at idle); 2× HP shaft tone; fan BPF 36 blades × N1 (585 Hz at 19.5 % N1) + fan broadband;
  combustion rumble (needs FF and EGT > OAT+40) with turbulent flutter; light-off whump when EGT first exceeds
  OAT+60 °C with fuel; igniter snaps ≈ 1.6/s per igniter (faint); buzz-saw sawtooth at the fan shaft rate above
  75 % N1. Spool-down simply follows N1/N2.
- **APU 131-9A** — far aft, very faint in the cockpit with doors closed: DC starter sawtooth (70 Hz + 13 Hz/%N,
  cut-out at 55 %), turbine whine 120 + 27 Hz/%N (≈ 2.8 kHz at 100 %), shaft tone, exhaust roar, light-off, flap
  actuator motor while `S:APU_FLAP_POS` moves; bleed load: roar +35 %, pitch −1.2 %.
- **Hydraulics** — electric pumps: 800 Hz motor hum + rotor whine + 9-piston ripple (1.13 kHz at speed), pitch
  −3.5 % and less flow noise once pressurised. **PTU barking dog**: shaft saw (≈ 40 → 90-110 Hz sweep per bark)
  + 9× piston ripple + AM mechanical noise, soft-clipped; barks 0.28-0.45 s, gaps 0.55-1.05 s then tightening;
  steady drone after 7 s of continuous activity.
- **FWC alerts** (from the two loudspeakers, level set by `alertVolume`, not by the LOUDSPEAKER knobs — as on the
  aircraft): SC = electronic bell "ding" A5 (880 Hz, harmonic partials 1/2/3/4.16/5.43, τ 0.34 s); CRC = same chime,
  shorter decay, every 0.37 s; cavalry charge = brassy "Charge!" bugle motif C5-F5-A5-C6-A5-C6 in 1.5 s (repeats if
  continuous); C chord = C5-E5-G5 organ tone 1.5 s; click / triple click = woody 1.65 kHz "tock" (3 pulses in 0.5 s);
  buzzer = 370 Hz square with 50 Hz rasp; cricket = 4.2 kHz chirps.
- **Cabin chime** — low 587 Hz CIDS bong (hi 831 Hz / hi-lo), heard through the cockpit door (−13 dB & 700 Hz LP when closed).
- **Wipers (dry glass)** — rubber stick-slip judder (70-115 Hz saw, random), scraping hiss, occasional squeal, motor
  whine, thump at each end of stroke.
- **Ground** — diesels: firing-rate sawtooth through a soft clipper + half-order lope + clatter AM'd at the firing
  rate + exhaust hiss; tug 6-cyl 760 rpm idle / ~1600 rpm pushing (+ transmission whine with ground speed), GPU
  4-cyl 1500 rpm + 400 Hz alternator whine. Jet bridge: HVAC/converter hum at L1, drive motors + 2.9 kHz beeper.
- **Ambience** — distant jet rumble bed (breathing), wind with gusts (∝ `G:ENV_WIND_KT`), a neighbour's APU that comes
  and goes, random events: take-off roll on RWY 23, jet taxiing past (pitch drift), reversing beeper, engine start at a
  nearby stand. Mostly audible through open doors/windows.

## CPU
Idle voices are detached from the rendering graph (sources stopped after ~1.5 s of silence, bus links
removed), leak paths through closed windows/doors are unlinked, one-shot panners are linked only while
playing, and shared params are only re-automated when their target changes. Static graph cost ≈ 0.5 % of
real time; measured (offline, M-series) ≈ 2-4 % in typical states and ≈ 10-15 % in the busiest state
(2 engines + APU + PTU + pumps + tug + wipers + window open). JS update ≈ 0.2-0.3 ms at 30 Hz.

## Calibrated levels (unity volumes, captain seat, offline render)
| state | RMS dBFS |
|---|---|
| cold & dark, all closed | −52 |
| at the gate: L1 + cockpit door open, GPU, jet bridge | −37 |
| AC power, avionics fans | −27.5 |
| + both packs | −23 |
| both engines idle + fans (closed) | −19 |
| both engines idle, captain window open | −15 |
| engine start at 25 % N2 (starter) | −27 |
| PTU (steady drone; barks ≈ 6 dB higher) | −24 |
| yellow elec pump alone | −37 |
| batteries only | −61 |
| single chime (peak) | −7 |
| pushbutton click (peak / 10 ms RMS) | −13.5 / −28 |

## Known gaps / requests to other modules
- Cockpit door open state: no variable in SIMVARS.md. Audio reads `G:DOOR_CKPT` (0..1) or `S:CKPT_DOOR_OPEN`
  if someone defines it, otherwise assumes the door is open.
- No `S:` variable for fuel pump running (inferred from pbs + AC), nor for the X FEED valve motion (inferred from the pb).
- `S:APU_STARTING` is used when present for the DC starter; otherwise inferred.
- Voice call-outs use the browser speech synthesis (not routed through WebAudio: no spatialisation, no hull filtering).
  Flight-phase call-outs (RETARD, TOO LOW…) are out of scope for ground ops.
- Real FWC chime timbres/pitches are not published; values above are designed from descriptions and recordings memory.
