# 3D cockpit kit (lead-owned, read-only for module agents)

`app.kit` builds realistic Airbus hardware and wires it to the sim (C: vars, events, sounds, tooltips).
Everything is in metres. Look at `src/dev/kitdemo.ts` for a working example
(`/dev.html?module=kitdemo&power=1&set=L:ELEC_BAT1_OFF=1`).

## Panels
```ts
const p = app.kit.panel({ name: 'OVHD_ELEC', width: 0.438, height: 0.14, zone: 'ovhd' });
// local frame: origin = panel centre, +X right, +Y up (drawing), +Z out of the face; face at z = 0
p.label('ELEC', -0.205, 0.06, { align: 'left', size: 0.0032 });   // engraved, back-lit text (cap height m)
p.bracket('BAT', x0, x1, y);                                      // "— BAT —" group bracket
p.line([[x0,y0],[x1,y1]]); p.rect(x, y, w, h); p.arc(x, y, r, a0, a1);
p.pb('ELEC_BAT1', x, y, { label: 'BAT 1' });                        // pushbutton with catalog legends (+guard if catalog says so)
p.pb('FCU_AP1', x, y, { capText: 'AP 1', w: 0.02, h: 0.016 });      // FCU/EFIS/ECP style: printed text + light bar
p.pb('FIRE_ENG1_PB', x, y, { w: 0.03, h: 0.022, outWhenOn: true }); // fire pb (value 1 = released/out)
p.sw('EXTLT_STROBE', x, y, { label: 'STROBE' });                    // toggle switch; pos labels drawn from the catalog
p.sw('EVAC_CAPT_PURS', x, y, { horizontal: true });
p.rot('ADIRS_IR1_MODE', x, y, { label: 'IR 1', angles: [-45, 0, 45] }); // detented selector (pointer knob)
p.pot('AIR_TEMP_CKPT', x, y, { style: 'pointer', scale: ['COLD', 'HOT'] }); // continuous knob 0..1
p.enc('FCU_ALT', x, y, { size: 0.012 });                              // encoder: wheel turns, L-click push, R-click pull
p.key('MCDU1_KEY_A', x, y, w, h);                                    // keypad key (emits catalog event with {key})
p.ann('ADIRS_ON_BAT', x, y, w, h);                                   // stand-alone annunciator
p.screen('PFD1', x, y, 0.1588, 0.1588);                               // display area bound to a display id
p.addStatic(geometry, material, x, y, z, rotZdeg);                    // extra static geometry (merged)
p.add(object3D, x, y, z);                                             // extra dynamic object
const g = p.finish();                                                 // bake engravings, merge statics
```
Options: see `PbOptions`, `SwitchOptions`, `KnobOptions`, `KeyOptions`, `ScreenOptions` in `panel.ts`.
Knob styles: `pointer` (Airbus bar selector), `round`, `roundLarge` (FCU), `small`, `concentric`.
Zones (`ovhd`, `main`, `glare`, `ped`) choose which integral-lighting knob back-lights the engravings.

Place a finished panel (or a group of panels) with `placeAt(group, ANCHORS.X)` from `../layout`,
then `app.cockpit.add(group)`. Sub-panels are positioned inside your group in the anchor's local frame.

## Custom controls
- `kit.lever(id, obj, { apply(v){…}, dragAxis:'y', detents, gate(from,to){…} })` — levers, wheels (thrust levers,
  flaps, speed brake, gear lever, pitch trim wheel, windows…). Drag / wheel / click-steps, detent clicks, C: var.
- `kit.bindVisual(id, (v) => …)` — update your own mesh when `C:<id>` changes.
- `kit.interactive(obj, handle)` — raw interaction (see `Handle` in `interaction.ts`); use `kit.setControl(id, v, obj, 'sw')`,
  `kit.press(id, obj)`, `kit.release(id)`, `kit.sfx(kind, id, obj)`, `kit.describe(def)` inside.
- `kit.mats` — shared PBR materials (paint, paintDark, antiGlare, knob, knobKnurl, knobGrey, white, bezel, cap,
  chrome, alu, darkMetal, rubber, keyCap, guardRed/Black/Clear, screenGlass, black, lcdBlack). Don't mutate them.
- `geo` helpers (`import { geo } from '../kit'`): roundedBox, box, cylZ, latheZ, pointerGrip, toggleLever, rectRing,
  roundedRectShape, panelSlab, dzus, normalise, mergeGeometries.

## Real sizes (Airbus)
Pushbutton cap ≈ 19 × 19 mm (bezel 23.5 mm), wide ones 25 × 19; toggle lever ≈ 17 mm; pointer knob ≈ 17 mm
diameter skirt, 25 mm bar; FCU knobs ≈ 22–25 mm diameter; panel modules 146 mm (5.75") wide in multiples of
the Dzus rail spacing; DU active area 158.8 mm square (6.25"); MCDU ≈ 146 × 229 mm; engraving cap height 2.2–3.5 mm.

## Lights
Legends light from `L:<lightId>` (0..1). ANN LT TEST/DIM and back-lighting are global (`S:INTLT_*`).
