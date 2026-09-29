# Lead notes: cross-module requests to hand to upcoming agents

**SCOPE (user, 2026-09-28): the game ends once both engines are started. No pushback, no taxi. Go fast.**

## In progress (agents launched 2026-09-29, cloud session)
- pedestal: 3D pedestal + ACP / XPDR / RMP logic and windows; THS from `S:FCTL_THS` on the pitch trim indicator;
  no ACP3 (it is on the overhead). `index.ts` must install its logic in the headless app.
- shell: structure, windows, seats, sidesticks/pedals/tillers, side consoles, cockpit door (writes `G:DOOR_CKPT`
  0..1; sys-misc mirrors it into `S:CKPT_DOOR_OPEN`), interior lights. Blender available as the `bpy` module.
- world: LFBD stand 14, sky/sun per time of day, exterior A320 + lights, ground equipment visualising the `G:` vars;
  writes the static `G:AC_ALT_AGL_FT`, `G:AC_PITCH`, `G:AC_ROLL`, `G:AC_VS_FPM`.
- ui: first-person camera, menus (FR), EFB; owns the logic of the ground `G:` vars (`G:GND_EXT_PWR`, `G:JETBRIDGE`,
  chocks, doors `G:DOOR_*`, `G:CABIN_READY`, `G:REFUELING`, `G:SLIDES_ARMED`) through `sim.services.ground`;
  end-of-game screen when both engines run.

## Integration (lead, after the agents)
- Whole-game test: install every logic module entry point together (incl. pedestal and ui) and check that every
  catalog light is written at runtime (the static `check-vars` cannot resolve generic writes such as `L:${key}`),
  then run the SOP through `sim.services.ground` instead of raw `G:` writes.
- Full game in the browser: console errors, draw calls / frame time with everything loaded, views from both seats.
- Playable static build (`npx vite build --base ./`) published as an artifact; progress page republished.
- Performance: kit-level legend batching (overhead's `batch.ts` approach) for mainpanel/pedestal if draw calls are high.
- Visual polish: glareshield depth looks shallow (mainpanel) — judge once the shell (windshield) is in.

## Done by the lead (2026-09-29)
- EMER EXIT LT amber OFF light (catalog `SIGNS_EMER_EXIT_LT_OFF`, sys-misc writes it, overhead annunciator).
- Clear guard material less milky (kit).
- Audio: DUAL INPUT / PRIORITY LEFT-RIGHT / GPWS voice callouts (speech synthesis), CVR TEST tone, CALLS MECH horn.
- `check-vars` no longer lets generic template writes hide undriven lights.
- Tooling for Linux containers: `shot.mjs` (Playwright Chromium + SwiftShader), `blender.sh` (bpy module).

## Optional
- mcdu: emit `adirs:heading` for IR ATT mode (manual heading entry).
