/**
 * THE CONTRACT: every cockpit control, annunciator light and display of the A320ceo (CFM56-5B).
 *
 * - 3D agents build every control listed for their panels, using the exact ids.
 * - System agents read `C:<id>` for controls and write `L:<lightId>` for every light.
 * - Initial values (`init`) are the real COLD & DARK state (aircraft secured after the previous flight).
 *
 * Conventions
 * - `pos` lists positions; for toggles index 0 = TOP (or LEFT for horizontal ones);
 *   for rotaries index 0 = most counter-clockwise.
 * - Pushbutton 'pb' value: 1 = pressed IN, 0 = released OUT. On Airbus, IN is the normal
 *   ("lights out") position for most pushbuttons; `pos` gives the names [OUT, IN].
 * - Legend light ids default to `${controlId}_${LEGEND}` (legend sanitised: 'G/S' -> 'GS', 'T.O' -> 'TO').
 * - Colours: W white, A amber, G green, B blue (cyan), R red.
 *
 * More controls may be registered at runtime with `registerControls()` from a module's own file
 * (decorative extras, options). Report any addition in your final summary.
 */

export type ControlKind =
  | 'pb' // latching pushbutton: 0 out / 1 in
  | 'pbm' // momentary pushbutton: C var = 1 while held; events `${id}:press` / `${id}:release`
  | 'sw' // toggle switch, N positions (index 0 = top/left)
  | 'swm' // spring-loaded toggle: returns to `init` on release
  | 'rot' // rotary selector, N detents (index 0 = full CCW)
  | 'rotm' // spring-loaded rotary: returns to `init` on release
  | 'pot' // continuous knob 0..1 (0 = full CCW / OFF)
  | 'enc' // endless encoder: events `${id}:inc` / `${id}:dec` (payload {steps}), and `${id}:push` / `${id}:pull` if pushPull
  | 'lever' // continuous lever value in [min,max] with detents
  | 'key' // keypad key, emits `${event}` with payload {key} (and sfx)
  | 'axis' // continuous input (sidestick, tiller, pedals) -1..1 or 0..1
  | 'ann'; // stand-alone annunciator light (not a control)

export type LightColor = 'W' | 'A' | 'G' | 'B' | 'R';

export interface Legend {
  /** One line or several lines of text engraved on this legend segment. */
  text: string | string[];
  color: LightColor;
  /** Light id (without the 'L:' prefix). */
  light: string;
}

export interface ControlDef {
  id: string;
  panel: string;
  kind: ControlKind;
  /** English cockpit name (as engraved / FCOM name). */
  name: string;
  /** French tooltip description. */
  fr?: string;
  pos?: string[];
  init?: number;
  min?: number;
  max?: number;
  detents?: number[];
  /** Pushbutton / annunciator legends, top to bottom. */
  leg?: Legend[];
  /** Guard cover colour when the control is guarded. Guard state var: C:<id>_GUARD (0 closed, 1 open). */
  guard?: 'red' | 'black' | 'clear';
  /** For 'enc': supports push / pull. */
  pushPull?: boolean;
  /** For 'key': event name emitted and key name in payload. */
  event?: string;
  key?: string;
}

const san = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]+/g, '');

function legends(id: string, leg?: Array<[string | string[], LightColor, string?]>): Legend[] | undefined {
  if (!leg) return undefined;
  return leg.map(([text, color, light]) => ({
    text,
    color,
    light: light ?? `${id}_${san(Array.isArray(text) ? text[0] : text)}`,
  }));
}

type L = Array<[string | string[], LightColor, string?]>;
const defs: ControlDef[] = [];
let P = '';
const panel = (p: string) => (P = p);
const add = (d: Omit<ControlDef, 'panel'>) => defs.push({ panel: P, ...d });

const pb = (id: string, name: string, leg: L | undefined, init = 1, fr?: string, extra: Partial<ControlDef> = {}) =>
  add({ id, kind: 'pb', name, leg: legends(id, leg), init, pos: ['OUT', 'IN'], fr, ...extra });
const pbm = (id: string, name: string, leg?: L, fr?: string, extra: Partial<ControlDef> = {}) =>
  add({ id, kind: 'pbm', name, leg: legends(id, leg), init: 0, fr, ...extra });
const sw = (id: string, name: string, pos: string[], init: number, fr?: string, extra: Partial<ControlDef> = {}) =>
  add({ id, kind: 'sw', name, pos, init, fr, ...extra });
const swm = (id: string, name: string, pos: string[], init: number, fr?: string) => add({ id, kind: 'swm', name, pos, init, fr });
const rot = (id: string, name: string, pos: string[], init: number, fr?: string) => add({ id, kind: 'rot', name, pos, init, fr });
const rotm = (id: string, name: string, pos: string[], init: number, fr?: string) => add({ id, kind: 'rotm', name, pos, init, fr });
const pot = (id: string, name: string, init: number, fr?: string, extra: Partial<ControlDef> = {}) =>
  add({ id, kind: 'pot', name, init, min: 0, max: 1, fr, ...extra });
const enc = (id: string, name: string, pushPull: boolean, fr?: string) => add({ id, kind: 'enc', name, pushPull, init: 0, fr });
const ann = (id: string, name: string, text: string | string[], color: LightColor, fr?: string) =>
  add({ id, kind: 'ann', name, leg: [{ text, color, light: id }], fr });
const keys = (prefix: string, event: string, list: string[], fr?: string) => {
  for (const k of list) add({ id: `${prefix}_${san(k) || 'KEY'}`, kind: 'key', name: k, event, key: k, fr });
};

const FAULT_OFF: L = [['FAULT', 'A'], ['OFF', 'W']];
const FAULT_ON_B: L = [['FAULT', 'A'], ['ON', 'B']];

/* ============================== OVERHEAD PANEL (forward) ============================== */

panel('OVHD_ADIRS');
pb('ADIRS_ADR1', 'ADR 1', FAULT_OFF, 1, 'Centrale anémométrique ADR 1');
pb('ADIRS_ADR3', 'ADR 3', FAULT_OFF, 1, 'Centrale anémométrique ADR 3');
pb('ADIRS_ADR2', 'ADR 2', FAULT_OFF, 1, 'Centrale anémométrique ADR 2');
pb('ADIRS_IR1', 'IR 1', [['FAULT', 'A'], ['ALIGN', 'W']], 1, 'Centrale inertielle IR 1');
pb('ADIRS_IR3', 'IR 3', [['FAULT', 'A'], ['ALIGN', 'W']], 1, 'Centrale inertielle IR 3');
pb('ADIRS_IR2', 'IR 2', [['FAULT', 'A'], ['ALIGN', 'W']], 1, 'Centrale inertielle IR 2');
rot('ADIRS_IR1_MODE', 'IR 1 mode selector', ['OFF', 'NAV', 'ATT'], 0, 'Sélecteur de mode IR 1');
rot('ADIRS_IR3_MODE', 'IR 3 mode selector', ['OFF', 'NAV', 'ATT'], 0, 'Sélecteur de mode IR 3');
rot('ADIRS_IR2_MODE', 'IR 2 mode selector', ['OFF', 'NAV', 'ATT'], 0, 'Sélecteur de mode IR 2');
ann('ADIRS_ON_BAT', 'ON BAT light', 'ON BAT', 'A', 'Voyant ADIRS sur batterie');
// Per the user's reference image (docs/ref): this aircraft has no ADIRS CDU (keyboard / DATA / SYS);
// the position is initialised from the MCDU INIT A page.

panel('OVHD_PA_VIDEO');
pbm('OVHD_PA', 'PA', undefined, 'Annonce passagers (3e occupant)');
pb('COCKPIT_DOOR_VIDEO', 'COCKPIT DOOR VIDEO', [['OFF', 'W']], 1, 'Vidéo de surveillance de la porte du poste');

panel('OVHD_FLTCTL_L');
pb('FLTCTL_ELAC1', 'ELAC 1', FAULT_OFF, 1, 'Calculateur de commandes de vol ELAC 1');
pb('FLTCTL_SEC1', 'SEC 1', FAULT_OFF, 1, 'Calculateur de spoilers/profondeur SEC 1');
pb('FLTCTL_FAC1', 'FAC 1', FAULT_OFF, 1, "Calculateur d'augmentation de vol FAC 1");

panel('OVHD_FLTCTL_R');
pb('FLTCTL_ELAC2', 'ELAC 2', FAULT_OFF, 1, 'Calculateur ELAC 2');
pb('FLTCTL_SEC2', 'SEC 2', FAULT_OFF, 1, 'Calculateur SEC 2');
pb('FLTCTL_SEC3', 'SEC 3', FAULT_OFF, 1, 'Calculateur SEC 3');
pb('FLTCTL_FAC2', 'FAC 2', FAULT_OFF, 1, 'Calculateur FAC 2');

panel('OVHD_EVAC');
pb('EVAC_COMMAND', 'EVAC COMMAND', [['EVAC', 'R'], ['ON', 'W']], 0, "Commande d'évacuation", { guard: 'black' });
pbm('EVAC_HORN_SHUTOFF', 'HORN SHUT OFF', undefined, "Arrêt de l'alarme d'évacuation");
sw('EVAC_CAPT_PURS', 'CAPT & PURS / CAPT', ['CAPT & PURS', 'CAPT'], 1, "Sélecteur commande d'évacuation");

panel('OVHD_EMER_ELEC');
pbm('EMER_ELEC_RAT_MAN_ON', 'RAT & EMER GEN MAN ON', [['FAULT', 'R']], 'Déploiement manuel RAT et génératrice de secours', { guard: 'red' });
pbm('EMER_ELEC_GEN_TEST', 'EMER GEN TEST', undefined, 'Test génératrice de secours', { guard: 'black' });
pb('EMER_ELEC_GEN1_LINE', 'GEN 1 LINE', [['SMOKE', 'A'], ['OFF', 'W']], 1, 'Contacteur de ligne GEN 1');

panel('OVHD_GPWS');
pb('GPWS_SYS', 'GPWS SYS', FAULT_OFF, 1, 'Système GPWS');
pb('GPWS_GS_MODE', 'G/S MODE', [['OFF', 'W']], 1, 'Mode alerte glide GPWS');
pb('GPWS_FLAP_MODE', 'FLAP MODE', [['OFF', 'W']], 1, 'Mode volets GPWS');
pb('GPWS_LDG_FLAP3', 'LDG FLAP 3', [['ON', 'B']], 0, 'Atterrissage volets 3');
pb('GPWS_TERR', 'TERR', FAULT_OFF, 1, 'Fonctions terrain EGPWS');

panel('OVHD_RCDR');
pb('RCDR_GND_CTL', 'GND CTL', [['ON', 'B']], 0, 'Commande sol des enregistreurs');
pbm('RCDR_CVR_ERASE', 'CVR ERASE', undefined, 'Effacement CVR');
pbm('RCDR_CVR_TEST', 'CVR TEST', undefined, 'Test CVR');

panel('OVHD_OXY');
pbm('OXY_MASK_MAN_ON', 'MASK MAN ON', undefined, 'Déploiement manuel des masques passagers', { guard: 'red' });
ann('OXY_PAX_SYS_ON', 'PASSENGER SYS ON light', ['SYS ON'], 'W');
pb('OXY_CREW_SUPPLY', 'CREW SUPPLY', [['OFF', 'W']], 0, 'Alimentation oxygène équipage');
pb('OXY_HIGH_ALT_LDG', 'HIGH ALT LDG', [['ON', 'B']], 0, 'Atterrissage haute altitude');

panel('OVHD_CALLS');
pbm('CALLS_MECH', 'MECH', undefined, 'Appel mécanicien');
pbm('CALLS_FWD', 'FWD', undefined, 'Appel PNC avant');
pbm('CALLS_AFT', 'AFT', undefined, 'Appel PNC arrière');
pbm('CALLS_ALL', 'ALL', undefined, 'Appel tous PNC');
pbm('CALLS_EMER', 'EMER CALL', [['CALL', 'W'], ['ON', 'W']], "Appel d'urgence cabine", { guard: 'black' });

panel('OVHD_WIPER_L');
rot('WIPER_CAPT', 'WIPER (CAPT)', ['OFF', 'SLOW', 'FAST'], 0, 'Essuie-glace commandant');
pbm('RAIN_RPLNT_CAPT', 'RAIN RPLNT (CAPT)', undefined, 'Anti-pluie commandant');

panel('OVHD_WIPER_R');
rot('WIPER_FO', 'WIPER (F/O)', ['OFF', 'SLOW', 'FAST'], 0, 'Essuie-glace copilote');
pbm('RAIN_RPLNT_FO', 'RAIN RPLNT (F/O)', undefined, 'Anti-pluie copilote');

panel('OVHD_FIRE');
pb('FIRE_ENG1_PB', 'ENG 1 FIRE pb', [[['ENG 1', 'FIRE'], 'R', 'FIRE_ENG1_PB']], 0, 'Poussoir feu moteur 1 (0 = enfoncé, 1 = libéré/tiré)', { guard: 'clear', pos: ['NORMAL (IN)', 'RELEASED (OUT)'] });
pbm('FIRE_ENG1_AGENT1', 'ENG 1 AGENT 1', [['SQUIB', 'W'], ['DISCH', 'A']], 'Extincteur 1 moteur 1');
pbm('FIRE_ENG1_AGENT2', 'ENG 1 AGENT 2', [['SQUIB', 'W'], ['DISCH', 'A']], 'Extincteur 2 moteur 1');
pbm('FIRE_ENG1_TEST', 'ENG 1 TEST', undefined, 'Test détection feu moteur 1');
pb('FIRE_APU_PB', 'APU FIRE pb', [[['APU', 'FIRE'], 'R', 'FIRE_APU_PB']], 0, 'Poussoir feu APU (0 = enfoncé, 1 = libéré)', { guard: 'clear', pos: ['NORMAL (IN)', 'RELEASED (OUT)'] });
pbm('FIRE_APU_AGENT', 'APU AGENT', [['SQUIB', 'W'], ['DISCH', 'A']], 'Extincteur APU');
pbm('FIRE_APU_TEST', 'APU TEST', undefined, 'Test détection feu APU');
pb('FIRE_ENG2_PB', 'ENG 2 FIRE pb', [[['ENG 2', 'FIRE'], 'R', 'FIRE_ENG2_PB']], 0, 'Poussoir feu moteur 2 (0 = enfoncé, 1 = libéré)', { guard: 'clear', pos: ['NORMAL (IN)', 'RELEASED (OUT)'] });
pbm('FIRE_ENG2_AGENT1', 'ENG 2 AGENT 1', [['SQUIB', 'W'], ['DISCH', 'A']], 'Extincteur 1 moteur 2');
pbm('FIRE_ENG2_AGENT2', 'ENG 2 AGENT 2', [['SQUIB', 'W'], ['DISCH', 'A']], 'Extincteur 2 moteur 2');
pbm('FIRE_ENG2_TEST', 'ENG 2 TEST', undefined, 'Test détection feu moteur 2');

panel('OVHD_HYD');
pb('HYD_ENG1_PUMP', 'ENG 1 PUMP (GREEN)', FAULT_OFF, 1, 'Pompe hydraulique moteur 1 (vert)');
pbm('HYD_RAT_MAN_ON', 'RAT MAN ON', undefined, 'Déploiement manuel RAT', { guard: 'red' });
pb('HYD_BLUE_ELEC_PUMP', 'BLUE ELEC PUMP', FAULT_OFF, 1, 'Pompe électrique bleue (AUTO)');
pb('HYD_PTU', 'PTU', FAULT_OFF, 1, 'Unité de transfert de puissance PTU (AUTO)');
pb('HYD_ENG2_PUMP', 'ENG 2 PUMP (YELLOW)', FAULT_OFF, 1, 'Pompe hydraulique moteur 2 (jaune)');
pb('HYD_YELLOW_ELEC_PUMP', 'YELLOW ELEC PUMP', FAULT_ON_B, 0, 'Pompe électrique jaune');

panel('OVHD_FUEL');
pb('FUEL_L_PUMP1', 'L TK PUMP 1', FAULT_OFF, 1, 'Pompe réservoir gauche 1');
pb('FUEL_L_PUMP2', 'L TK PUMP 2', FAULT_OFF, 1, 'Pompe réservoir gauche 2');
pb('FUEL_MODE_SEL', 'MODE SEL', [['FAULT', 'A'], ['MAN', 'W']], 1, 'Mode pompes réservoir central (AUTO)');
pb('FUEL_CTR_PUMP1', 'CTR TK PUMP 1', FAULT_OFF, 1, 'Pompe réservoir central 1');
pb('FUEL_CTR_PUMP2', 'CTR TK PUMP 2', FAULT_OFF, 1, 'Pompe réservoir central 2');
pb('FUEL_XFEED', 'X FEED', [['OPEN', 'G'], ['ON', 'W']], 0, 'Intercommunication carburant');
pb('FUEL_R_PUMP1', 'R TK PUMP 1', FAULT_OFF, 1, 'Pompe réservoir droit 1');
pb('FUEL_R_PUMP2', 'R TK PUMP 2', FAULT_OFF, 1, 'Pompe réservoir droit 2');

panel('OVHD_ELEC');
pb('ELEC_BAT1', 'BAT 1', FAULT_OFF, 0, 'Batterie 1');
pb('ELEC_BAT2', 'BAT 2', FAULT_OFF, 0, 'Batterie 2');
pb('ELEC_AC_ESS_FEED', 'AC ESS FEED', [['FAULT', 'A'], ['ALTN', 'W']], 1, 'Alimentation barre AC ESS');
pb('ELEC_GALY_CAB', 'GALY & CAB', FAULT_OFF, 1, 'Galleys et cabine');
pb('ELEC_COMMERCIAL', 'COMMERCIAL', [['OFF', 'W']], 1, 'Charges commerciales');
pbm('ELEC_IDG1', 'IDG 1', [['FAULT', 'A']], "Désaccouplement IDG 1 (irréversible en vol)", { guard: 'red' });
pb('ELEC_GEN1', 'GEN 1', FAULT_OFF, 1, 'Génératrice 1');
pb('ELEC_APU_GEN', 'APU GEN', FAULT_OFF, 1, 'Génératrice APU');
pb('ELEC_BUS_TIE', 'BUS TIE', [['OFF', 'W']], 1, 'Couplage des barres (AUTO)');
pb('ELEC_EXT_PWR', 'EXT PWR', [['AVAIL', 'G'], ['ON', 'B']], 0, 'Groupe de parc (prise de parc)');
pb('ELEC_GEN2', 'GEN 2', FAULT_OFF, 1, 'Génératrice 2');
pbm('ELEC_IDG2', 'IDG 2', [['FAULT', 'A']], 'Désaccouplement IDG 2', { guard: 'red' });

panel('OVHD_AIRCOND');
rot('AIR_PACK_FLOW', 'PACK FLOW', ['LO', 'NORM', 'HI'], 1, 'Débit des packs');
pot('AIR_TEMP_CKPT', 'CKPT temperature', 0.5, 'Température poste (COLD → HOT)');
pot('AIR_TEMP_FWD', 'FWD CABIN temperature', 0.5, 'Température cabine avant');
pot('AIR_TEMP_AFT', 'AFT CABIN temperature', 0.5, 'Température cabine arrière');
pb('AIR_HOT_AIR', 'HOT AIR', FAULT_OFF, 1, "Vanne d'air chaud");
pb('AIR_PACK1', 'PACK 1', FAULT_OFF, 1, 'Pack de conditionnement 1');
pb('AIR_PACK2', 'PACK 2', FAULT_OFF, 1, 'Pack de conditionnement 2');
pb('AIR_ENG1_BLEED', 'ENG 1 BLEED', FAULT_OFF, 1, 'Prélèvement moteur 1');
pb('AIR_APU_BLEED', 'APU BLEED', FAULT_ON_B, 0, 'Prélèvement APU');
pb('AIR_ENG2_BLEED', 'ENG 2 BLEED', FAULT_OFF, 1, 'Prélèvement moteur 2');
rot('AIR_XBLEED', 'X BLEED', ['SHUT', 'AUTO', 'OPEN'], 1, 'Vanne d’intercommunication pneumatique');
pb('AIR_RAM_AIR', 'RAM AIR', [['ON', 'B']], 0, "Entrée d'air dynamique", { guard: 'red' });

panel('OVHD_ANTIICE');
pb('AI_WING', 'WING ANTI ICE', FAULT_ON_B, 0, 'Antigivrage voilure');
pb('AI_ENG1', 'ENG 1 ANTI ICE', FAULT_ON_B, 0, 'Antigivrage moteur 1');
pb('AI_ENG2', 'ENG 2 ANTI ICE', FAULT_ON_B, 0, 'Antigivrage moteur 2');
pb('AI_PROBE_WINDOW', 'PROBE/WINDOW HEAT', [['ON', 'B']], 0, 'Réchauffage sondes et pare-brise (AUTO si relâché)');

panel('OVHD_PRESS');
rot('PRESS_LDG_ELEV', 'LDG ELEV', ['AUTO', '-2', '-1', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'], 0, "Altitude terrain d'arrivée (x1000 ft)");
swm('PRESS_MAN_VS', 'MAN V/S CTL', ['UP', 'NEUTRAL', 'DN'], 1, 'Commande manuelle de vario cabine');
pb('PRESS_MODE_SEL', 'MODE SEL', [['FAULT', 'A'], ['MAN', 'W']], 1, 'Mode pressurisation (AUTO)');
pb('PRESS_DITCHING', 'DITCHING', [['ON', 'B']], 0, 'Amerrissage', { guard: 'black' });

panel('OVHD_EXTLT');
sw('EXTLT_STROBE', 'STROBE', ['ON', 'AUTO', 'OFF'], 2, 'Feux à éclats (strobes)');
sw('EXTLT_BEACON', 'BEACON', ['ON', 'OFF'], 1, 'Feu anticollision rouge (beacon)');
sw('EXTLT_WING', 'WING', ['ON', 'OFF'], 1, "Phares d'inspection voilure");
sw('EXTLT_NAV_LOGO', 'NAV & LOGO', ['2', '1', 'OFF'], 2, 'Feux de navigation et logo');
sw('EXTLT_RWY_TURNOFF', 'RWY TURN OFF', ['ON', 'OFF'], 1, 'Phares de dégagement de piste');
sw('EXTLT_LAND_L', 'LAND (L)', ['ON', 'OFF', 'RETRACT'], 2, "Phare d'atterrissage gauche");
sw('EXTLT_LAND_R', 'LAND (R)', ['ON', 'OFF', 'RETRACT'], 2, "Phare d'atterrissage droit");
sw('EXTLT_NOSE', 'NOSE', ['T.O', 'TAXI', 'OFF'], 2, 'Phares de roulage / décollage (train avant)');

panel('OVHD_APU');
pb('APU_MASTER', 'APU MASTER SW', FAULT_ON_B, 0, "Interrupteur principal de l'APU");
pbm('APU_START', 'APU START', [['AVAIL', 'G'], ['ON', 'B']], "Démarrage de l'APU");

panel('OVHD_SIGNS');
sw('SIGNS_SEAT_BELTS', 'SEAT BELTS', ['ON', 'OFF'], 1, 'Consigne ceintures');
sw('SIGNS_NO_SMOKING', 'NO SMOKING', ['ON', 'AUTO', 'OFF'], 2, 'Consigne non-fumeur');
sw('SIGNS_EMER_EXIT_LT', 'EMER EXIT LT', ['ON', 'ARM', 'OFF'], 2, 'Éclairage de secours');

panel('OVHD_INTLT');
pot('INTLT_OVHD_INTEG', 'OVHD INTEG LT', 0, 'Éclairage intégré du panneau supérieur');
sw('INTLT_ICE_IND', 'ICE IND & STBY COMPASS', ['ON', 'OFF'], 1, 'Éclairage indicateur de givre et compas');
sw('INTLT_DOME', 'DOME', ['BRT', 'DIM', 'OFF'], 2, 'Plafonnier');
sw('INTLT_ANN_LT', 'ANN LT', ['TEST', 'BRT', 'DIM'], 1, 'Test / intensité des voyants');

panel('OVHD_VENT');
pb('VENT_BLOWER', 'BLOWER', [['FAULT', 'A'], ['OVRD', 'W']], 1, 'Ventilateur de soufflage avionique');
pb('VENT_EXTRACT', 'EXTRACT', [['FAULT', 'A'], ['OVRD', 'W']], 1, "Ventilateur d'extraction avionique");
pb('VENT_CAB_FANS', 'CAB FANS', [['OFF', 'W']], 1, 'Ventilateurs de recirculation cabine');

panel('OVHD_ENG');
pb('ENG_MAN_START1', 'ENG 1 MAN START', [['ON', 'B']], 0, 'Démarrage manuel moteur 1');
pb('ENG_MAN_START2', 'ENG 2 MAN START', [['ON', 'B']], 0, 'Démarrage manuel moteur 2');
pb('ENG_N1_MODE1', 'ENG 1 N1 MODE', [['FAULT', 'A'], ['ON', 'B']], 0, 'Mode N1 moteur 1 (moteurs IAE uniquement — sans effet sur CFM)');
pb('ENG_N1_MODE2', 'ENG 2 N1 MODE', [['FAULT', 'A'], ['ON', 'B']], 0, 'Mode N1 moteur 2 (moteurs IAE uniquement — sans effet sur CFM)');

panel('OVHD_CARGO_VENT');
pb('CARGO_VENT_AFT_ISOL', 'AFT ISOL VALVE', FAULT_OFF, 1, "Vanne d'isolement ventilation soute arrière");

panel('OVHD_CARGO_SMOKE');
pbm('CARGO_SMOKE_FWD_DISCH', 'CARGO SMOKE FWD DISCH', [['SMOKE', 'R'], ['DISCH', 'A']], 'Fumée soute avant / extinction', { guard: 'red' });
pbm('CARGO_SMOKE_AFT_DISCH', 'CARGO SMOKE AFT DISCH', [['SMOKE', 'R'], ['DISCH', 'A']], 'Fumée soute arrière / extinction', { guard: 'red' });
pbm('CARGO_SMOKE_TEST', 'CARGO SMOKE TEST', undefined, 'Test détection fumée soute');

panel('OVHD_AUDIO_SW');
rot('AUDIO_SWITCHING', 'AUDIO SWITCHING', ['CAPT 3', 'NORM', 'F/O 3'], 1, 'Commutation audio');

/* ============================== OVERHEAD PANEL (aft / maintenance) ============================== */

panel('OVHD_MAINT');
pb('MAINT_FADEC_GND_PWR1', 'ENG 1 FADEC GND PWR', [['ON', 'B']], 0, 'Alimentation sol FADEC 1');
pb('MAINT_FADEC_GND_PWR2', 'ENG 2 FADEC GND PWR', [['ON', 'B']], 0, 'Alimentation sol FADEC 2');
pb('MAINT_BLUE_PUMP_OVRD', 'BLUE PUMP OVRD', [['ON', 'B']], 0, 'Forçage pompe bleue', { guard: 'black' });
pbm('MAINT_APU_AUTOEXT_TEST', 'APU AUTO EXTING TEST', [['TEST', 'W'], ['OK', 'G']], 'Test extinction auto APU');
pb('MAINT_HYD_LEAK_G', 'HYD LEAK MEASUREMENT G', [['OFF', 'W']], 1, 'Vanne mesure fuite vert', { guard: 'black' });
pb('MAINT_HYD_LEAK_B', 'HYD LEAK MEASUREMENT B', [['OFF', 'W']], 1, 'Vanne mesure fuite bleu', { guard: 'black' });
pb('MAINT_HYD_LEAK_Y', 'HYD LEAK MEASUREMENT Y', [['OFF', 'W']], 1, 'Vanne mesure fuite jaune', { guard: 'black' });
pbm('MAINT_OXY_TMR_RESET', 'OXY TMR RESET', [['FAULT', 'A']], 'Réarmement minuterie oxygène');
pb('MAINT_SVCE_INT_OVRD', 'SVCE INT OVRD', [['ON', 'W']], 0, 'Interphone de service');
pb('MAINT_AVIONICS_COMPT_LT', 'AVIONICS COMPT LT', [['ON', 'W']], 0, 'Éclairage soute avionique');

/* ============================== GLARESHIELD ============================== */

panel('GLARE_WARN_L');
pbm('WARN_MASTER_WARN_CAPT', 'MASTER WARN (CAPT)', [[['MASTER', 'WARN'], 'R', 'MASTER_WARN']], "Alarme générale (appuyer pour l'arrêter)");
pbm('WARN_MASTER_CAUT_CAPT', 'MASTER CAUT (CAPT)', [[['MASTER', 'CAUT'], 'A', 'MASTER_CAUT']], 'Alerte générale (appuyer pour arrêter)');
pbm('CHRONO_CAPT', 'CHRONO (CAPT)', undefined, 'Chronomètre ND commandant');
ann('AUTOLAND_CAPT', 'AUTO LAND light (CAPT)', ['AUTO', 'LAND'], 'R');
ann('PRIO_CAPT', 'Side stick priority CAPT (green)', 'CAPT', 'G');
ann('PRIO_CAPT_ARROW', 'Side stick priority arrow (red)', '◀', 'R');

panel('GLARE_WARN_R');
pbm('WARN_MASTER_WARN_FO', 'MASTER WARN (F/O)', [[['MASTER', 'WARN'], 'R', 'MASTER_WARN']], 'Alarme générale');
pbm('WARN_MASTER_CAUT_FO', 'MASTER CAUT (F/O)', [[['MASTER', 'CAUT'], 'A', 'MASTER_CAUT']], 'Alerte générale');
pbm('CHRONO_FO', 'CHRONO (F/O)', undefined, 'Chronomètre ND copilote');
ann('AUTOLAND_FO', 'AUTO LAND light (F/O)', ['AUTO', 'LAND'], 'R');
ann('PRIO_FO', 'Side stick priority F/O (green)', 'F/O', 'G');
ann('PRIO_FO_ARROW', 'Side stick priority arrow (red)', '▶', 'R');

for (const s of [1, 2]) {
  panel(s === 1 ? 'GLARE_EFIS_L' : 'GLARE_EFIS_R');
  const e = `EFIS${s}`;
  enc(`${e}_BARO`, 'BARO REF knob', true, 'Calage altimétrique (tirer = QNH, pousser = STD)');
  sw(`${e}_BARO_UNIT`, 'BARO unit ring', ['inHg', 'hPa'], 1, 'Unité du calage (inHg / hPa)');
  pbm(`${e}_FD`, 'FD', [['▬', 'G', `${e}_FD`]], 'Directeur de vol');
  pbm(`${e}_LS`, 'LS', [['▬', 'G', `${e}_LS`]], 'Affichage ILS (LS) sur le PFD');
  pbm(`${e}_CSTR`, 'CSTR', [['▬', 'G', `${e}_CSTR`]], 'Contraintes sur ND');
  pbm(`${e}_WPT`, 'WPT', [['▬', 'G', `${e}_WPT`]], 'Waypoints sur ND');
  pbm(`${e}_VORD`, 'VOR.D', [['▬', 'G', `${e}_VORD`]], 'VOR/DME sur ND');
  pbm(`${e}_NDB`, 'NDB', [['▬', 'G', `${e}_NDB`]], 'NDB sur ND');
  pbm(`${e}_ARPT`, 'ARPT', [['▬', 'G', `${e}_ARPT`]], 'Aéroports sur ND');
  rot(`${e}_ND_MODE`, 'ND mode', ['LS', 'VOR', 'NAV', 'ARC', 'PLAN'], 3, 'Mode du ND');
  rot(`${e}_ND_RANGE`, 'ND range', ['10', '20', '40', '80', '160', '320'], 0, 'Échelle du ND (NM)');
  sw(`${e}_NAV1`, 'ADF/VOR 1 selector', ['VOR', 'OFF', 'ADF'], 1, 'Aiguille 1 sur ND (VOR / ADF)');
  sw(`${e}_NAV2`, 'ADF/VOR 2 selector', ['VOR', 'OFF', 'ADF'], 1, 'Aiguille 2 sur ND (VOR / ADF)');
}

panel('GLARE_FCU');
enc('FCU_SPD', 'SPD/MACH knob', true, 'Vitesse sélectée (tirer) / gérée (pousser)');
pbm('FCU_SPD_MACH', 'SPD/MACH', undefined, 'Bascule vitesse / Mach');
enc('FCU_HDG', 'HDG/TRK knob', true, 'Cap sélecté (tirer) / navigation gérée (pousser)');
pbm('FCU_HDG_TRK', 'HDG V/S - TRK FPA', undefined, 'Bascule HDG-V/S / TRK-FPA');
pbm('FCU_LOC', 'LOC', [['▬', 'G', 'FCU_LOC']], 'Mode LOC');
pbm('FCU_AP1', 'AP 1', [['▬', 'G', 'FCU_AP1']], 'Pilote automatique 1');
pbm('FCU_AP2', 'AP 2', [['▬', 'G', 'FCU_AP2']], 'Pilote automatique 2');
pbm('FCU_ATHR', 'A/THR', [['▬', 'G', 'FCU_ATHR']], 'Auto-manette');
enc('FCU_ALT', 'ALT knob', true, 'Altitude sélectée');
sw('FCU_ALT_INC', 'ALT increment 100/1000', ['100', '1000'], 1, "Pas de l'altitude (100 / 1000 ft)");
pbm('FCU_EXPED', 'EXPED', [['▬', 'G', 'FCU_EXPED']], 'Mode EXPED');
pbm('FCU_APPR', 'APPR', [['▬', 'G', 'FCU_APPR']], 'Mode approche');
enc('FCU_VS', 'V/S-FPA knob', true, 'Vitesse verticale (tirer) / mise en palier (pousser)');
pbm('FCU_METRIC_ALT', 'METRIC ALT', undefined, 'Altitude métrique sur ECAM');

/* ============================== MAIN INSTRUMENT PANEL ============================== */

for (const [side, n] of [['CAPT', 1], ['FO', 2]] as const) {
  panel(side === 'CAPT' ? 'MAIN_CAPT' : 'MAIN_FO');
  pot(`MAIN_PFD${n}_BRT`, 'PFD brightness', 0.8, 'Luminosité PFD (OFF = éteint)');
  pot(`MAIN_ND${n}_BRT`, 'ND brightness', 0.8, 'Luminosité ND (OFF = éteint)');
  pot(`MAIN_ND${n}_WX_BRT`, 'ND WX/TERR brightness (outer ring)', 0.8, 'Luminosité radar météo / terrain sur ND');
  pbm(`MAIN_PFD_ND_XFR_${side}`, 'PFD/ND XFR', undefined, 'Échange PFD / ND');
  sw(`MAIN_CONSOLE_FLOOR_${side}`, 'CONSOLE/FLOOR LT', ['BRT', 'DIM', 'OFF'], 2, 'Éclairage console et plancher');
  pot(`MAIN_LOUDSPEAKER_${side}`, 'LOUDSPEAKER', 0.5, 'Volume haut-parleur');
  pb(`MAIN_TERR_ON_ND_${side}`, 'TERR ON ND', [['ON', 'G']], 0, 'Terrain sur ND');
  pbm(`MAIN_GPWS_GS_${side}`, 'GPWS / G/S', [[['PULL UP', 'GPWS'], 'R', `MAIN_GPWS_GS_${side}_GPWS`], ['G/S', 'A', `MAIN_GPWS_GS_${side}_GS`]], 'Alarme GPWS / inhibition glide');
}

panel('MAIN_CTR');
enc('ISIS_BARO', 'ISIS BARO knob', true, 'Calage ISIS (pousser = STD)');
pbm('ISIS_BUGS', 'ISIS BUGS', undefined, 'ISIS repères');
pbm('ISIS_LS', 'ISIS LS', undefined, 'ISIS affichage ILS');
pbm('ISIS_PLUS', 'ISIS +', undefined, 'ISIS + (luminosité)');
pbm('ISIS_MINUS', 'ISIS -', undefined, 'ISIS - (luminosité)');
pbm('ISIS_RST', 'ISIS RST', undefined, 'ISIS remise à zéro assiette');
sw('ASKID_NWSTRG', 'A/SKID & N/W STRG', ['ON', 'OFF'], 0, 'Antiskid et orientation roue avant');
pb('BRK_FAN', 'BRK FAN', [['HOT', 'A'], ['ON', 'B']], 0, 'Ventilateurs de freins');

panel('MAIN_GEAR');
add({ id: 'GEAR_LEVER', kind: 'lever', name: 'LDG GEAR lever', pos: ['UP', 'DOWN'], init: 1, min: 0, max: 1, detents: [0, 1], fr: "Levier du train d'atterrissage (0 = UP, 1 = DOWN)" });
ann('GEAR_LEVER_RED', 'Gear lever red light', '▼', 'R');
ann('GEAR_L_UNLK', 'LDG GEAR L UNLK', 'UNLK', 'R');
ann('GEAR_NOSE_UNLK', 'LDG GEAR NOSE UNLK', 'UNLK', 'R');
ann('GEAR_R_UNLK', 'LDG GEAR R UNLK', 'UNLK', 'R');
ann('GEAR_L_DOWN', 'LDG GEAR L DOWN', '▼', 'G');
ann('GEAR_NOSE_DOWN', 'LDG GEAR NOSE DOWN', '▼', 'G');
ann('GEAR_R_DOWN', 'LDG GEAR R DOWN', '▼', 'G');

panel('MAIN_AUTOBRK');
pbm('AUTOBRK_LO', 'AUTO BRK LO', [['DECEL', 'G'], ['ON', 'B']], 'Freinage automatique LO');
pbm('AUTOBRK_MED', 'AUTO BRK MED', [['DECEL', 'G'], ['ON', 'B']], 'Freinage automatique MED');
pbm('AUTOBRK_MAX', 'AUTO BRK MAX', [['DECEL', 'G'], ['ON', 'B']], 'Freinage automatique MAX');

panel('MAIN_CLOCK');
pbm('CLOCK_CHR', 'CLOCK CHR', undefined, 'Chronomètre');
pbm('CLOCK_RST', 'CLOCK RST', undefined, 'RAZ chronomètre');
rot('CLOCK_ET', 'CLOCK ET', ['RUN', 'STOP', 'RST'], 2, 'Temps écoulé (ET)');
pbm('CLOCK_DATE', 'CLOCK DATE', undefined, 'Date');
rot('CLOCK_SRC', 'CLOCK GPS/INT/SET', ['GPS', 'INT', 'SET'], 0, "Source de l'horloge");

/* ============================== PEDESTAL ============================== */

const MCDU_KEYS = [
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6',
  'DIR', 'PROG', 'PERF', 'INIT', 'DATA', 'FPLN', 'RADNAV', 'FUEL', 'SECFPLN', 'ATC', 'MENU', 'AIRPORT',
  'PREV', 'NEXT', 'UP', 'DOWN',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'1234567890'.split(''),
  'DOT', 'PLUSMINUS', 'SLASH', 'SP', 'OVFY', 'CLR', 'BRT', 'DIM',
];
for (const n of [1, 2]) {
  panel(`PED_MCDU${n}`);
  keys(`MCDU${n}_KEY`, `MCDU${n}_KEY`, MCDU_KEYS, `Touche MCDU ${n}`);
  ann(`MCDU${n}_FAIL`, 'MCDU FAIL', 'FAIL', 'A');
  ann(`MCDU${n}_FMGC`, 'MCDU FMGC', 'FMGC', 'W');
  ann(`MCDU${n}_MENU`, 'MCDU MENU', ['MCDU', 'MENU'], 'W');
  ann(`MCDU${n}_FM`, 'MCDU FM', 'FM', 'W');
  ann(`MCDU${n}_IND`, 'MCDU IND', 'IND', 'W');
  ann(`MCDU${n}_RDY`, 'MCDU RDY', 'RDY', 'W');
  ann(`MCDU${n}_FM1`, 'MCDU FM1', 'FM1', 'W');
  ann(`MCDU${n}_FM2`, 'MCDU FM2', 'FM2', 'W');
}

panel('PED_SWITCHING');
rot('SW_ATT_HDG', 'ATT HDG', ['CAPT 3', 'NORM', 'F/O 3'], 1, 'Commutation IR');
rot('SW_AIR_DATA', 'AIR DATA', ['CAPT 3', 'NORM', 'F/O 3'], 1, 'Commutation ADR');
rot('SW_EIS_DMC', 'EIS DMC', ['CAPT 3', 'NORM', 'F/O 3'], 1, 'Commutation DMC');
rot('SW_ECAM_ND_XFR', 'ECAM/ND XFR', ['CAPT', 'NORM', 'F/O'], 1, 'Transfert ECAM sur ND');

panel('PED_ECAM');
pot('ECP_UPPER_BRT', 'UPPER DISPLAY brightness', 0.8, 'Luminosité ECAM haut (E/WD)');
pot('ECP_LOWER_BRT', 'LOWER DISPLAY brightness', 0.8, 'Luminosité ECAM bas (SD)');
pbm('ECP_TO_CONFIG', 'T.O CONFIG', undefined, 'Test configuration décollage');
pbm('ECP_EMER_CANC', 'EMER CANC', undefined, "Annulation d'alarme");
for (const p of ['ENG', 'BLEED', 'PRESS', 'ELEC', 'HYD', 'FUEL', 'APU', 'COND', 'DOOR', 'WHEEL', 'FCTL']) {
  pbm(`ECP_${p}`, p === 'FCTL' ? 'F/CTL' : p, [['▬', 'W', `ECP_${p}`]], `Page ECAM ${p}`);
}
pbm('ECP_ALL', 'ALL', undefined, 'Défilement de toutes les pages');
pbm('ECP_CLR_L', 'CLR (left)', [['▬', 'W', 'ECP_CLR']], 'Effacement ECAM');
pbm('ECP_CLR_R', 'CLR (right)', [['▬', 'W', 'ECP_CLR']], 'Effacement ECAM');
pbm('ECP_STS', 'STS', [['▬', 'W', 'ECP_STS']], 'Page STATUS');
pbm('ECP_RCL', 'RCL', undefined, 'Rappel des alertes');

for (const n of [1, 2, 3]) {
  panel(`PED_RMP${n}`);
  const r = `RMP${n}`;
  sw(`${r}_ON`, 'RMP ON/OFF', ['ON', 'OFF'], 1, `Panneau radio RMP ${n}`, { });
  pbm(`${r}_XFER`, 'Transfer', undefined, 'Transfert fréquence active / attente');
  enc(`${r}_OUTER`, 'Frequency selector (outer, MHz)', false, 'Sélecteur MHz');
  enc(`${r}_INNER`, 'Frequency selector (inner, kHz)', false, 'Sélecteur kHz');
  for (const k of ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'AM']) pbm(`${r}_${k}`, k, [['▬', 'G', `${r}_${k}`]], `Sélection ${k}`);
  pbm(`${r}_NAV`, 'NAV', [['▬', 'G', `${r}_NAV`]], 'Secours navigation', { guard: 'clear' });
  for (const k of ['VOR', 'ILS', 'MLS', 'ADF', 'BFO']) pbm(`${r}_${k}`, k, [['▬', 'G', `${r}_${k}`]], `Secours ${k}`);
  ann(`${r}_SEL`, 'SEL light', 'SEL', 'W');
}

for (const n of [1, 2, 3]) {
  // ACP 3 (third occupant) sits on the overhead on this aircraft (user reference image).
  panel(n === 3 ? 'OVHD_ACP3' : `PED_ACP${n}`);
  const a = `ACP${n}`;
  for (const k of ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'INT', 'CAB', 'PA']) {
    const call = k === 'INT' ? 'MECH' : k === 'CAB' ? 'ATT' : 'CALL';
    pbm(`${a}_TX_${k}`, `${k} transmission key`, [[call, 'A', `${a}_TX_${k}_CALL`], ['▬', 'G', `${a}_TX_${k}`]], `Émission ${k}`);
  }
  for (const k of ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'INT', 'CAB', 'PA', 'VOR1', 'VOR2', 'MKR', 'ILS', 'ADF1', 'ADF2']) {
    pot(`${a}_RX_${k}`, `${k} reception knob`, k.startsWith('VHF1') ? 0.6 : 0.3, `Volume ${k}`);
  }
  swm(`${a}_INT_RAD`, 'INT/RAD', ['INT', 'NEUTRAL', 'RAD'], 1, 'Interphone / radio');
  pb(`${a}_VOICE`, 'VOICE', [['ON', 'G']], 0, 'Filtre identification');
  pbm(`${a}_RESET`, 'RESET', undefined, 'Réinitialisation appels');
}

panel('PED_THR');
for (const n of [1, 2]) {
  add({
    id: `THR_LEVER${n}`, kind: 'lever', name: `Thrust lever ${n}`, init: 0, min: -20, max: 45,
    detents: [-20, -6, 0, 25, 35, 45], pos: ['MAX REV', 'REV IDLE', 'IDLE', 'CL', 'FLX/MCT', 'TOGA'],
    fr: `Manette de poussée ${n} (TLA en degrés)`,
  });
  pbm(`THR_ATHR_DISC${n}`, 'A/THR instinctive disconnect', undefined, "Déconnexion de l'auto-manette");
}

panel('PED_ENG');
sw('ENG_MASTER1', 'ENG 1 MASTER', ['ON', 'OFF'], 1, 'Interrupteur maître moteur 1 (tirer et basculer)');
sw('ENG_MASTER2', 'ENG 2 MASTER', ['ON', 'OFF'], 1, 'Interrupteur maître moteur 2 (tirer et basculer)');
rot('ENG_MODE', 'ENG MODE selector', ['CRANK', 'NORM', 'IGN/START'], 1, 'Sélecteur de mode moteurs');
ann('ENG1_FAULT', 'ENG 1 FAULT', 'FAULT', 'A');
ann('ENG1_FIRE', 'ENG 1 FIRE', 'FIRE', 'R');
ann('ENG2_FAULT', 'ENG 2 FAULT', 'FAULT', 'A');
ann('ENG2_FIRE', 'ENG 2 FIRE', 'FIRE', 'R');

panel('PED_SPDBRK');
add({ id: 'SPDBRK_LEVER', kind: 'lever', name: 'SPEED BRAKE lever', init: 0, min: 0, max: 1, detents: [0, 0.5, 1], pos: ['RET', '1/2', 'FULL'], fr: 'Levier aérofreins' });
sw('SPDBRK_ARM', 'Ground spoilers ARM (lever pulled up)', ['DISARM', 'ARM'], 0, 'Armement des spoilers sol');

panel('PED_FLAPS');
add({ id: 'FLAPS_LEVER', kind: 'lever', name: 'FLAPS lever', init: 0, min: 0, max: 4, detents: [0, 1, 2, 3, 4], pos: ['0', '1', '2', '3', 'FULL'], fr: 'Levier des volets / becs' });

panel('PED_TRIM');
add({ id: 'PITCH_TRIM', kind: 'lever', name: 'Pitch trim wheel', init: 0, min: -4, max: 13.5, fr: 'Volant de trim de profondeur (degrés THS, + = cabré)' });

panel('PED_RUDTRIM');
rotm('RUD_TRIM', 'RUD TRIM switch', ['L', 'NEUTRAL', 'R'], 1, 'Trim de direction');
pbm('RUD_TRIM_RESET', 'RUD TRIM RESET', undefined, 'Remise à zéro du trim de direction');

panel('PED_PARKBRK');
sw('PARK_BRK', 'PARKING BRAKE', ['OFF', 'ON'], 1, 'Frein de parc (tirer et tourner)');

panel('PED_ATC');
sw('XPDR_SYS', 'ATC SYS', ['1', '2'], 0, 'Système transpondeur');
rot('XPDR_MODE', 'ATC mode', ['STBY', 'AUTO', 'ON'], 0, 'Mode transpondeur');
sw('XPDR_ALT_RPTG', 'ALT RPTG', ['ON', 'OFF'], 0, "Report d'altitude");
keys('XPDR_KEY', 'XPDR_KEY', ['0', '1', '2', '3', '4', '5', '6', '7', 'CLR'], 'Code transpondeur');
pbm('XPDR_IDENT', 'IDENT', undefined, 'Ident transpondeur');
ann('XPDR_FAIL', 'ATC FAIL', 'FAIL', 'A');
rot('TCAS_MODE', 'TCAS mode', ['STBY', 'TA', 'TA/RA'], 0, 'Mode TCAS');
rot('TCAS_TRAFFIC', 'TCAS traffic', ['THRT', 'ALL', 'ABV', 'BLW'], 1, 'Trafic affiché');

panel('PED_WXR');
rot('WXR_SYS', 'WX RADAR SYS', ['1', 'OFF', '2'], 1, 'Radar météo');
sw('WXR_PWS', 'PWS', ['AUTO', 'OFF'], 1, 'Détection cisaillement prédictif');
sw('WXR_GCS', 'GCS', ['AUTO', 'OFF'], 0, 'Suppression échos sol');
rot('WXR_MODE', 'WX mode', ['WX', 'WX+T', 'TURB', 'MAP'], 0, 'Mode radar');
pot('WXR_GAIN', 'GAIN (CAL at 12 o’clock)', 0.5, 'Gain radar');
pot('WXR_TILT', 'TILT', 0.5, 'Inclinaison antenne');

panel('PED_DOOR');
swm('DOOR_CKPT', 'COCKPIT DOOR', ['UNLOCK', 'NORM', 'LOCK'], 1, 'Porte du poste');
ann('DOOR_CKPT_OPEN', 'CKPT DOOR OPEN', 'OPEN', 'A');
ann('DOOR_CKPT_FAULT', 'CKPT DOOR FAULT', 'FAULT', 'A');

panel('PED_LIGHTING');
pot('FLOOD_MAIN_PNL', 'FLOOD LT MAIN PNL', 0, 'Projecteurs planche de bord');
pot('INTEG_MAIN_PNL_PED', 'INTEG LT MAIN PNL & PED', 0, 'Éclairage intégré planche et pylône');
pot('FLOOD_PED', 'FLOOD LT PED', 0, 'Projecteur du pylône');

panel('PED_PRINTER');
pbm('PRINTER_FEED', 'PRINTER FEED', undefined, 'Avance papier imprimante');
pbm('PRINTER_TEST', 'PRINTER TEST', undefined, 'Test imprimante');

/* ============================== SIDE CONSOLES & FLIGHT CONTROLS ============================== */

for (const side of ['CAPT', 'FO'] as const) {
  panel(side === 'CAPT' ? 'CONSOLE_CAPT' : 'CONSOLE_FO');
  add({ id: `SIDESTICK_${side}_X`, kind: 'axis', name: 'Sidestick roll', init: 0, min: -1, max: 1, fr: 'Mini-manche (roulis)' });
  add({ id: `SIDESTICK_${side}_Y`, kind: 'axis', name: 'Sidestick pitch (+ = pull)', init: 0, min: -1, max: 1, fr: 'Mini-manche (tangage)' });
  pbm(`SIDESTICK_${side}_TAKEOVER`, 'Takeover / AP disconnect pb', undefined, 'Priorité / déconnexion PA');
  pbm(`SIDESTICK_${side}_PTT`, 'Radio push-to-talk', undefined, 'Alternat radio');
  add({ id: `TILLER_${side}`, kind: 'axis', name: 'Nose wheel steering tiller', init: 0, min: -1, max: 1, fr: 'Volant de direction roue avant' });
  pot(`READING_LT_${side}`, 'READING LT', 0, 'Liseuse');
  pbm(`OXY_MASK_TEST_${side}`, 'Oxygen mask PRESS TO TEST', undefined, 'Test du masque à oxygène');
  add({ id: `WINDOW_${side}`, kind: 'lever', name: 'Sliding window', init: 0, min: 0, max: 1, fr: 'Fenêtre coulissante (0 = fermée)' });
}
add({ id: 'RUDDER', kind: 'axis', name: 'Rudder pedals', init: 0, min: -1, max: 1, panel: 'CONSOLE_CAPT', fr: 'Palonnier' } as any);
add({ id: 'BRAKE_L', kind: 'axis', name: 'Left toe brake', init: 0, min: 0, max: 1, panel: 'CONSOLE_CAPT', fr: 'Frein gauche' } as any);
add({ id: 'BRAKE_R', kind: 'axis', name: 'Right toe brake', init: 0, min: 0, max: 1, panel: 'CONSOLE_CAPT', fr: 'Frein droit' } as any);

/* ============================== DISPLAYS ============================== */

export interface DisplaySpec {
  id: string;
  /** Module that registers the drawing. */
  owner: string;
  /** Panel that places the screen in 3D. */
  panel: string;
  /** Suggested canvas size in px. */
  w: number;
  h: number;
  desc: string;
}

export const DISPLAYS: DisplaySpec[] = [
  { id: 'PFD1', owner: 'pfdnd', panel: 'MAIN_CAPT', w: 1024, h: 1024, desc: 'Captain PFD (DU active area 6.25" x 6.25")' },
  { id: 'ND1', owner: 'pfdnd', panel: 'MAIN_CAPT', w: 1024, h: 1024, desc: 'Captain ND' },
  { id: 'EWD', owner: 'ecam', panel: 'MAIN_CTR', w: 1024, h: 1024, desc: 'Upper ECAM - Engine/Warning display' },
  { id: 'SD', owner: 'ecam', panel: 'MAIN_CTR', w: 1024, h: 1024, desc: 'Lower ECAM - System display' },
  { id: 'ND2', owner: 'pfdnd', panel: 'MAIN_FO', w: 1024, h: 1024, desc: 'F/O ND' },
  { id: 'PFD2', owner: 'pfdnd', panel: 'MAIN_FO', w: 1024, h: 1024, desc: 'F/O PFD' },
  { id: 'ISIS', owner: 'pfdnd', panel: 'MAIN_CTR', w: 512, h: 512, desc: 'Integrated standby instrument (3" ATI, 80 x 80 mm screen)' },
  { id: 'MCDU1', owner: 'mcdu', panel: 'PED_MCDU1', w: 768, h: 640, desc: 'MCDU 1 CRT/LCD (24 columns x 14 lines)' },
  { id: 'MCDU2', owner: 'mcdu', panel: 'PED_MCDU2', w: 768, h: 640, desc: 'MCDU 2' },
  { id: 'EFIS1_BARO', owner: 'pfdnd', panel: 'GLARE_EFIS_L', w: 256, h: 96, desc: 'Captain baro window (QNH/STD)' },
  { id: 'EFIS2_BARO', owner: 'pfdnd', panel: 'GLARE_EFIS_R', w: 256, h: 96, desc: 'F/O baro window' },
  { id: 'FCU_SPD', owner: 'pfdnd', panel: 'GLARE_FCU', w: 256, h: 128, desc: 'FCU SPD/MACH window' },
  { id: 'FCU_HDG', owner: 'pfdnd', panel: 'GLARE_FCU', w: 384, h: 128, desc: 'FCU HDG/TRK + LAT window' },
  { id: 'FCU_ALT', owner: 'pfdnd', panel: 'GLARE_FCU', w: 512, h: 128, desc: 'FCU ALT window (+ LVL/CH label)' },
  { id: 'FCU_VS', owner: 'pfdnd', panel: 'GLARE_FCU', w: 384, h: 128, desc: 'FCU V/S-FPA window' },
  { id: 'CLOCK', owner: 'mainpanel', panel: 'MAIN_CLOCK', w: 256, h: 256, desc: 'Clock: CHR, UTC, ET windows' },
  { id: 'ELEC_BAT1_V', owner: 'sys-elec', panel: 'OVHD_ELEC', w: 160, h: 64, desc: 'BAT 1 voltmeter' },
  { id: 'ELEC_BAT2_V', owner: 'sys-elec', panel: 'OVHD_ELEC', w: 160, h: 64, desc: 'BAT 2 voltmeter' },
  { id: 'RMP1', owner: 'pedestal', panel: 'PED_RMP1', w: 384, h: 96, desc: 'RMP 1 ACTIVE / STBY-CRS windows' },
  { id: 'RMP2', owner: 'pedestal', panel: 'PED_RMP2', w: 384, h: 96, desc: 'RMP 2' },
  { id: 'RMP3', owner: 'pedestal', panel: 'PED_RMP3', w: 384, h: 96, desc: 'RMP 3' },
  { id: 'XPDR', owner: 'pedestal', panel: 'PED_ATC', w: 192, h: 96, desc: 'ATC transponder code window' },
  { id: 'RUD_TRIM', owner: 'pedestal', panel: 'PED_RUDTRIM', w: 192, h: 96, desc: 'Rudder trim position (e.g. "L 0.0")' },
];

/* ============================== REGISTRY ============================== */

const byId = new Map<string, ControlDef>();
for (const d of defs) {
  if (byId.has(d.id)) throw new Error(`duplicate control id ${d.id}`);
  byId.set(d.id, d);
}

export const CONTROLS: readonly ControlDef[] = defs;

export function getControl(id: string): ControlDef | undefined {
  return byId.get(id);
}

/** Register extra controls (decorative/optional) from a module. */
export function registerControls(list: ControlDef[]): void {
  for (const d of list) {
    if (byId.has(d.id)) continue;
    defs.push(d);
    byId.set(d.id, d);
  }
}

export function controlsOfPanel(panelId: string): ControlDef[] {
  return defs.filter((d) => d.panel === panelId);
}

/** Every light id declared in the catalog (without 'L:'). */
export function allLights(): string[] {
  const s = new Set<string>();
  for (const d of defs) for (const l of d.leg ?? []) s.add(l.light);
  return [...s].sort();
}

/** Every panel id. */
export function allPanels(): string[] {
  return [...new Set(defs.map((d) => d.panel))];
}

/** Write the cold & dark initial control positions into the sim. */
export function applyColdAndDark(sim: { set(n: string, v: number): void }): void {
  for (const d of defs) {
    if (d.kind === 'ann' || d.kind === 'key' || d.kind === 'enc') continue;
    sim.set(`C:${d.id}`, d.init ?? 0);
    if (d.guard) sim.set(`C:${d.id}_GUARD`, 0);
  }
}
