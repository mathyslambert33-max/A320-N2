# overhead — forward + aft overhead panels (`src/cockpit/overhead`)

3D only: no sim variables or events of its own. Every functional control is a kit control with its catalog id
(all 165 controls of the `OVHD_*` panels, incl. `OVHD_ACP3`, `OVHD_PA_VIDEO`, `OVHD_CARGO_VENT`, `OVHD_AUDIO_SW`, `OVHD_MAINT`);
the kit writes `C:` vars (and `C:<id>_GUARD`) and lights legends from `L:` vars. Service: `app.services.overhead = { fwd, aft }`
(the two anchor groups). Files: `index.ts` (install), `fwd.ts` (forward rack), `aft.ts` (aft strip + OVHD_AFT, C/Bs),
`frame.ts` (console structure), `lib.ts` (mm wrapper around `PanelBuilder`, synoptic overlay, lamps, round pbs),
`batch.ts` (draw-call reduction). Harness debug: `&ovhdBatch=0` disables the batching pass.

## Layout / sizes (anchor usage — no anchor changed)
- Real module sizes: lateral columns 146 mm (5.75" Dzus modules), centre column 328 mm, 5 mm rails → panel rack
  0.632 m wide, centred in the 0.73 m `OVHD` anchor; the remaining ±49 mm are the leather console trim and side housing.
- Forward rack (reference-photo arrangement) is 0.6515 m deep, from anchor local y −0.375 to +0.2765; the 0.10 m in front
  of it is the console nose (the anchor's forward edge meets the windshield). Plate heights (mm): centre 68 blank / 76 FIRE /
  136 HYD+FUEL / 100 ELEC / 114 AIR COND / 150 lower; left 20 / 45 PA+VIDEO / 128 ADIRS / 34 blank / 48 FLT CTL / 350 lower;
  right 90 ACP 3 / 80 + 100 blanks / 48 FLT CTL / 308 lower. The side columns' forward ends are chamfered 75 mm like the real panel.
- Aft of the rack (still in the `OVHD` plane, local y +0.2825 … +0.47, behind a small step lip): AUDIO SWITCHING panel
  (`OVHD_AUDIO_SW`, left) and circuit-breaker panels.
- `OVHD_AFT` (22° plane): MAINT panel 50VU (right column, forward end), circuit-breaker panels, blank plates.
- Note for the lead: the real forward overhead is ≈0.63 × 0.65 m; the 0.73 × 0.95 m anchor is filled with the console
  trim/nose and the aft C/B strip.

## Decorative items (no catalog id)
Blank plates, Dzus rails and fasteners, console frame/housing/nose/step, instanced circuit breakers (one `InstancedMesh`
per anchor; labels are generic system names and ratings), MAINT "RESET" pb and CVR HEADSET jack, EMER EXIT LT unlit window,
retractable landing-light symbols, green synoptic lines (one transparent overlay per synoptic plate, glowing with
`S:INTLT_INTEG_OVHD`).

## Lights shown on extra windows (read only)
- `L:EMER_ELEC_RAT_MAN_ON_FAULT` is shown in the separate "RAT & EMER GEN" window (the guarded MAN ON pb itself has no legend, as on the aircraft).
- `L:CARGO_SMOKE_FWD_DISCH_SMOKE` / `L:CARGO_SMOKE_AFT_DISCH_SMOKE` are shown in the FWD / AFT SMOKE windows next to the
  guarded DISCH pbs (which carry the DISCH legend).

## Performance
Statics merged per material and anchor, pushbutton caps/lenses and all lit legends in two `BatchedMesh`es per anchor
(legend brightness copied every frame from the kit's per-legend materials), guard lids / knob parts merged; only the
structure casts shadows. Whole overhead in view: ≈180 draw calls including the shadow pass (969 before batching);
from the captain's normal forward view: ≈12.

## Notes
- NAV & LOGO position labels follow the catalog order (`1` top, `2` middle, `OFF`); the real panel engraves `2` on top.
- DITCHING and EVAC COMMAND guards are red (catalog); the reference photo shows them black.
- ENG N1 MODE pbs are built (decorative on CFM, lights owned by sys-air). OXY HIGH ALT LDG (catalog) is placed left of MASK MAN ON.
