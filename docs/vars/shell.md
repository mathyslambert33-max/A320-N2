# shell — flight-deck structure, windows, seats, flight controls, consoles, door, interior lights (`src/cockpit/shell`)

Entry `index.ts` → builders: `structure.ts` (walls, windshield frame + corner posts, ceiling, floor, bulkhead, side
closures), `windows.ts` (glass, sliding windows, wipers, eye-position indicator, sun visors), `controls.ts` (sidesticks,
tillers, rudder pedals), `consoles.ts` (lateral consoles, oxygen-mask boxes, wall items), `seats.ts`, `door.ts` (door +
entrance area), `rear.ts` (closet, jump seats, rear C/B panel, emergency equipment), `lights.ts` (interior lighting).
Shared: `geom.ts` (reference geometry, exported as `SHELL_GEOM`), `surf.ts` (parametric-surface / loft utilities),
`mats.ts` (materials + procedural textures), `logic.ts` (DOM-free helpers, tested in `tests/shell/logic.test.ts`).
Service: `app.services.shell = { root, geom: SHELL_GEOM }`. Dev scenarios: `src/dev/scenarios/shell.ts`
(`doorClosed`, `windowsOpen`, `controlsDeflected`, `wipers`, `nightLights`, `oxyFlow`).
Harness: `/dev.html?module=shell&mods=overhead,mainpanel&power=1` (`&night=1&set=S:INTLT_DOME=1` for the lights).
Everything is procedural Three.js (no binary assets).

## Variables written
| var | meaning |
|---|---|
| `G:DOOR_CKPT` | cockpit door open ratio 0 closed..1 open (animated swing, ≈ 1.6 s). **Init 1 (open, at the gate)** via `sim.init` (a value set earlier by a scenario wins). Click the door leaf to toggle; an external write (EFB, scenario) makes the door swing to that value. sys-misc mirrors it into `S:CKPT_DOOR_OPEN`. |
| `C:SIDESTICK_CAPT_X/_Y`, `C:SIDESTICK_FO_X/_Y` | written while the player drags a sidestick (−1..1, Y + = pull = mouse down, X + = right); spring return to 0 (τ 90 ms) after release, then no more writes (other inputs may drive them) |
| `C:TILLER_CAPT`, `C:TILLER_FO` | drag (−1..1, + = right), spring return after release |
| `C:RUDDER` | drag sideways on a rudder pedal (−1..1), spring return after release |
| `C:BRAKE_L`, `C:BRAKE_R` | 1 while the upper (toe) part of the left / right pedal is held with the mouse, 0 on release |
| `C:WINDOW_CAPT`, `C:WINDOW_FO` | via `kit.lever` on the sliding-window handle: drag horizontally (captain: drag left = open/aft, F/O: drag right), wheel or click → detents 0 / 1 |
| `C:SIDESTICK_*_TAKEOVER`, `C:SIDESTICK_*_PTT` | kit `press`/`release` (momentary, events `<id>:press` / `<id>:release`) |
| `C:READING_LT_CAPT/FO` | kit pot on the lateral console (READING LT, OFF..BRT) |
| `C:OXY_MASK_TEST_CAPT/FO` | kit pbm "PRESS TO TEST AND RESET" on the mask stowage box |

Events emitted: kit events of the controls above; `sfx` `{kind:'door_open'|'door_close'|'door_latch', id:'DOOR_CKPT_LEAF', x, y, z}`
(unknown kinds fall back to a click in the audio module), window handle detents `sfx` kind `lever`.

## Variables read
| var | use |
|---|---|
| `C:SIDESTICK_*_X/Y`, `C:TILLER_*`, `C:RUDDER`, `C:BRAKE_L/R`, `C:WINDOW_*` | visuals always follow the C: vars (keyboard / gamepad from ui can drive them) |
| `S:WIPER_CAPT_POS`, `S:WIPER_FO_POS` | exterior wiper arm angle 0..1 → 0..68° from the parked position (parked along the windshield base, below the glareshield sight line) |
| `S:OXY_MASK_FLOW_CAPT/FO` | yellow cross in the mask-box flow blinker |
| `S:INTLT_DOME` | 2 dome area lights in the ceiling linings beside the aft overhead + lenses |
| `S:INTLT_FLOOD_MAIN` | main-panel flood strip under the glareshield lip (area light) |
| `S:INTLT_FLOOD_PED` | pedestal flood spot under the aft overhead |
| `S:INTLT_CONSOLE_CAPT/FO` | console / floor spots under the side-window sills |
| `S:INTLT_READING_CAPT/FO` | reading-light spots in the ceiling above each pilot |

Lights: 8 (3 area, 5 spot), warm white, no shadow casters. They are only in the scene (visible) while at least one
interior light var is > 0, so the cold-and-dark / daytime shaders carry no interior lights; the "lights on" shader
variants are pre-compiled once 30 frames after start (`renderer.compile`) to avoid a stall when the first light is
switched on.

## Interaction / pointer ray
Blockers (`interaction.addBlocker`): the whole lining (walls, ceiling, floor, bulkhead, side closures), console
cabinets and mask boxes, door frame, rear equipment. The glass (windshields, side windows, visors) is not registered
(the ray passes through). Interactive: sidestick grips + takeover/PTT, tillers, pedals, window handles, door leaf,
console READING LT / PRESS TO TEST.

## Final geometry (body frame, metres; see `geom.ts` → `SHELL_GEOM`)
- **Floor** y 0 (carpet), from the forward lower wall z −0.984 to the rear bulkhead z **1.35**. Cockpit door opening
  x −0.40..+0.40, height 1.93, bulkhead 0.08 thick (cabin face z 1.43); leaf hinged at x −0.396 (captain side), opens
  98° forward into the flight deck (open leaf lies along x ≈ −0.43, z 0.57..1.35).
- **Side-wall lining half-width** (z ≤ 0.75): 0.985 (floor), 1.065 (y 0.66), 1.08 (y 1.0), 1.065 (y 1.3), 1.025 (1.5),
  0.975 (1.65), 0.93 (1.75, wall/ceiling junction = sun-visor rail); widening by +0.10 toward the bulkhead (z 0.75→1.4).
- **Windshields**: inner frame face = one plane `z = −0.975 + 0.2314 (y − 1.075)` (13.0° from vertical, both panes
  coplanar so the base matches the straight glareshield). Clear opening per pane (right; left mirrored), in (x, y) on
  that plane: (0.04, 1.085) (0.875, 1.085) (0.70, 1.668) (0.04, 1.745), corner radii 25–70 mm (≈ 0.48 m²). Glass inner
  surface 30 mm in front of the frame face (along the plane normal), 25 mm thick → outer skin ≈ 55 mm in front.
  Centre post cover 74 mm wide × 30 mm. Wipers pivot at (±0.80, 1.074) on the outer glass surface, parked pointing
  inboard along the base, sweep 0–68°.
- **Corner posts**: rounded fillet between the windshield plane and the side wall, radius 0.15 (sill) → 0.21 (top);
  tangent to the side wall at z = zT(y) ≈ −0.834 (y 1.035) … −0.634 (y 1.625).
- **Sliding windows** (opening = reveal wall): bottom y 1.035, top 1.625, front edge z = zT(y) + 0.08
  (−0.754 at the bottom, −0.554 at the top), aft edge z 0.05; sash covers ≈ 25 mm → clear ≈ 0.36 m². Opening sequence:
  C:WINDOW 0→0.08 = sash moves 16 mm inboard (unlatch), 0.08→1 = slides 0.50 m aft (behind the post and inside the
  fixed window). Handle at the front edge (y 1.29).
- **Fixed rear windows** (z, y): (0.16, 1.06) (0.62, 1.06) (0.70, 1.42) (0.16, 1.60), upper edge sloping down aft
  (≈ 0.25 m² clear). Glass 60 mm outboard of the lining.
- **Ceiling**: lining from the wall top (y 1.75) up to the overhead housing sides (x ±0.366, 0.10 m above the overhead
  face) and a flat centre strip at y **2.21** aft of the aft overhead (z 0.62 → 1.35).
- **Seats**: SRP (hip point, pan/back junction) (±0.53, 0.50, 0.12) = eye − (0, 0.78, −0.12); pan top ≈ 0.52 from z
  −0.34 to 0.13, backrest reclined 13°, headrest front ≈ z 0.30 at eye height; armrests y 0.72 (outboard x ±0.815).
- **Lateral consoles**: cabinet x ±0.82 (inboard face) → wall, top y 0.66, z −0.68..0.34 (anchors CONSOLE_CAPT/FO).
  Sidestick pivot (±0.885, 0.662, −0.245), grip ≈ 0.16 tall; tiller (±0.99, 0.672, −0.375) Ø 0.13; oxygen-mask box
  centre (±0.975, 0.69, 0.13).
- **Rudder pedals** per pilot centred (±0.53, 0, −0.82), pedal spacing 0.29, plates 90 × 250 mm leaning 28° forward,
  travel ±0.085 (left pedal forward for left rudder), toe brake 17°.
- **Eye-position indicator** on the centre post: white ball (0, 1.385, −0.826), red balls 35 mm closer to the crew on
  each pilot's line of sight from the design eye (±0.53, 1.28, 0).
- Aft: coat stowage x −1.25..−0.50, z 0.95..1.35 (4th-occupant seat folded on its forward face); 3rd-occupant seat
  folded on the bulkhead (x 0.5..0.9); rear C/B panel on the right wall (z 0.74..1.30, y 0.8..1.6); extinguisher
  behind the captain's seat; forward entrance area behind the door (z 1.43..3.35, galley right, lavatory left).

## Requests / notes for other modules
- lead: `layout.COCKPIT.seatCapt/seatFo` (0.18 aft) is not where a seat pan can be with the eye at z 0: use the seat
  SRP above (pan centre ≈ (±0.53, 0.52, −0.10)). `COCKPIT.ceilingY` 2.08 → the ceiling is 1.99 above the pilots
  (beside the overhead) and 2.21 behind the overhead. `COCKPIT.halfWidth` 1.08 ✓.
- ui (camera limits): head box roughly x ±0.35 around the eye, z −0.35 (glareshield ≈ z −0.72) … +0.25 (headrest
  front ≈ 0.30), y 1.0 … 1.55 (ceiling beside the overhead ≈ 1.95; overhead face 1.89 at z 0). Walking is not needed.
- world (exterior nose): windows as above; the lining is ≈ 30–60 mm inside the glass. The wipers are built here.
- Real aircraft data used: flight-deck window clear areas (windshield 0.52 m², sliding 0.36 m², total 2.36 m²),
  sidestick ±20° roll / ±16° pitch, NWS tiller ±75°, eye-position indicator (3 balls, red over white),
  reinforced door opening forward into the flight deck. Floor height above ground: the A320 forward door sill is
  ≈ 3.4 m (AC doc) — `COCKPIT.floorHeightAboveGround` 2.55 looks too low for the exterior (world/lead to check).
