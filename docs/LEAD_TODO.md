# Lead notes: cross-module requests to hand to upcoming agents

**SCOPE (user, 2026-09-28): the game ends once both engines are started. No pushback, no taxi. Go fast.**

- pedestal: display THS from `S:FCTL_THS` on the pitch trim wheel indicator; no ACP3 (it is on the overhead).
- ui/EFB ground services own the logic of the ground G: vars: `G:GND_EXT_PWR` (GPU), `G:JETBRIDGE`, chocks, doors `G:DOOR_*`, `G:CABIN_READY`, `G:REFUELING`, `G:SLIDES_ARMED`; world only visualises them. Launched: shell+world agent (Blender), 2026-09-29.
- shell: clickable cockpit door writes `G:DOOR_CKPT` (0..1); sys-misc mirrors it into `S:CKPT_DOOR_OPEN`.
- audio (polish later): listen to `fcs:dual_input`, `fcs:priority`, `gpws:aural`, `rcdr:cvr_test`, `calls:mech`.
- sys-air: read `S:SMOKE_CARGO_AFT_DET` (sys-misc also publishes aliases `S:FIRE_CARGO_FWD/AFT_SMOKE`).
- mcdu (optional): emit `adirs:heading` for ATT mode.
- integration: run `node tools/check-vars.mjs` over the whole tree, then the full SOP headless test.
- polish: EMER EXIT LT amber "OFF" light (catalog ann + sys-misc write + overhead window bind); kit-level legend batching (overhead's batch.ts approach) for mainpanel/pedestal draw calls; clear guard material less milky; glareshield depth looks shallow (mainpanel).
