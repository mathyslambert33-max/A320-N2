/**
 * SOP reference (French) from cold & dark to both engines started, after the Airbus A320 FCOM normal procedures
 * (PRO-NOR-SOP). Reference text for the EFB only — the game never highlights the next action. DOM-free.
 * Control names stay in English, as engraved on the panels.
 */
import { SCENARIO, weatherFor } from '../core/scenario';
import type { TimeOfDay } from '../core/settings';

export interface SopStep {
  /** Control or item (English, as engraved), or '' for a plain sentence. */
  c: string;
  /** Action / expected result (French). */
  a: string;
}

export interface SopSection {
  id: string;
  title: string;
  en: string;
  intro?: string;
  groups: Array<{ title?: string; steps: SopStep[] }>;
  checklist?: string;
}

export function sopSections(tod: TimeOfDay): SopSection[] {
  const w = weatherFor(tod);
  const t = SCENARIO.takeoff;
  const wt = SCENARIO.weights;
  const zfw = (wt.zfw / 1000).toFixed(1).replace('.', ',');
  const blk = (wt.blockFuel / 1000).toFixed(1).replace('.', ',');
  return [
    {
      id: 'ext',
      title: '1. Inspection extérieure de sécurité',
      en: 'SAFETY EXTERIOR INSPECTION',
      intro: "Avant toute mise sous tension, s'assurer que l'avion peut être alimenté et que les systèmes peuvent être actionnés sans danger pour les équipes au sol.",
      groups: [{
        steps: [
          { c: 'CHOCKS', a: 'en place (le frein de parc seul ne suffit pas : pression d’accumulateur non garantie avion froid).' },
          { c: 'DOORS', a: 'état des portes et trappes noté (passerelle à L1, soutes AV/AR ouvertes pour le chargement).' },
          { c: 'GPU', a: 'branché ; zones des moteurs, des gouvernes et des trains dégagées.' },
          { c: '', a: 'Dans le jeu : EFB › Services sol › « Tour de sécurité » (le copilote fait le tour et rend compte).' },
        ],
      }],
    },
    {
      id: 'prelim',
      title: '2. Préparation préliminaire du poste',
      en: 'PRELIMINARY COCKPIT PREPARATION',
      groups: [
        {
          title: 'Avant la mise sous tension',
          steps: [
            { c: 'ENG MASTER 1 & 2', a: 'OFF.' },
            { c: 'ENG MODE sel', a: 'NORM.' },
            { c: 'WEATHER RADAR', a: 'OFF.' },
            { c: 'L/G lever', a: 'DOWN.' },
            { c: 'WIPERS', a: 'OFF.' },
          ],
        },
        {
          title: 'Mise sous tension',
          steps: [
            { c: 'BAT 1 & BAT 2', a: 'vérifier la tension de chaque batterie (> 25,5 V, poussoirs relâchés), puis enfoncer (AUTO).' },
            { c: 'EXT PWR', a: 'ON (voyant vert AVAIL → bleu ON) : tout le réseau électrique est alimenté.' },
            { c: 'COCKPIT LIGHTS', a: 'selon besoin (INTEG LT, FLOOD LT, DOME).' },
          ],
        },
        {
          title: 'APU (si besoin d’air ou d’électricité sans GPU)',
          steps: [
            { c: 'APU FIRE', a: 'test : maintenir APU FIRE TEST → poussoir APU FIRE allumé, SQUIB et DISCH, alarme ECAM.' },
            { c: 'APU MASTER SW', a: 'ON (le volet d’entrée d’air s’ouvre).' },
            { c: 'APU START', a: 'ON. AVAIL vert après environ 1 min ; page APU sur l’ECAM.' },
            { c: 'APU BLEED', a: 'ON quand l’APU est disponible (climatisation, puis démarrage des moteurs).' },
          ],
        },
        {
          title: 'Vérifications ECAM',
          steps: [
            { c: 'ENG page', a: 'quantité d’huile moteurs.' },
            { c: 'HYD page', a: 'niveaux des réservoirs hydrauliques.' },
            { c: 'DOOR/OXY page', a: 'pression d’oxygène équipage.' },
            { c: 'BRAKES', a: 'pression d’accumulateur et de frein de parc sur l’indicateur triple.' },
            { c: 'RCL', a: 'maintenir 3 s pour rappeler les alertes annulées.' },
          ],
        },
      ],
    },
    {
      id: 'prep',
      title: '3. Préparation du poste',
      en: 'COCKPIT PREPARATION',
      intro: 'Balayage du panneau supérieur de gauche à droite et de l’arrière vers l’avant : en configuration normale, aucun voyant blanc allumé.',
      groups: [
        {
          title: 'Panneau supérieur',
          steps: [
            { c: 'ADIRS IR 1, 2, 3', a: 'NAV : l’alignement démarre (≈ 7 min à Bordeaux en mode réel) ; voyant ON BAT quelques secondes.' },
            { c: 'FLT CTL', a: 'ELAC, SEC, FAC : ON (voyants éteints).' },
            { c: 'GPWS / RCDR', a: 'poussoirs enfoncés ; CVR selon besoin.' },
            { c: 'OXYGEN CREW SUPPLY', a: 'ON (voyant OFF éteint).' },
            { c: 'FIRE', a: 'tests ENG 1, APU, ENG 2.' },
            { c: 'HYD · FUEL · ELEC', a: 'pompes et génératrices sur ON/AUTO, aucun voyant.' },
            { c: 'AIR COND', a: 'PACK 1 & 2 ON, ENG 1 & 2 BLEED ON, X BLEED AUTO, températures selon besoin.' },
            { c: 'ANTI ICE · CABIN PRESS', a: 'PROBE/WINDOW HEAT AUTO ; LDG ELEV AUTO, MODE SEL AUTO.' },
            { c: 'EXT LT', a: 'NAV & LOGO selon compagnie, STROBE AUTO, BEACON OFF pour l’instant.' },
            { c: 'SIGNS', a: 'SEAT BELTS ON, NO SMOKING ON ou AUTO, EMER EXIT LT ARM.' },
          ],
        },
        {
          title: 'Planche de bord et pylône',
          steps: [
            { c: 'CLOCK · ISIS', a: 'heure vérifiée, instruments de secours.' },
            { c: 'A/SKID & N/W STRG', a: 'ON.' },
            { c: 'PARKING BRAKE', a: 'ON ; vérifier la pression de l’accumulateur et des freins.' },
            { c: 'RMP · ACP · ATC', a: 'fréquences, transpondeur (code, STBY).' },
          ],
        },
        {
          title: 'FMGS (MCDU)',
          steps: [
            { c: 'DATA', a: 'A/C STATUS : base de données de navigation en cours de validité.' },
            { c: 'INIT A', a: `CO RTE ${SCENARIO.flight.coRoute} (ou FROM/TO ${SCENARIO.flight.from}/${SCENARIO.flight.to}), FLT NBR ${SCENARIO.flight.number}, COST INDEX ${SCENARIO.flight.costIndex}, CRZ FL${SCENARIO.flight.crzFl}, puis ALIGN IRS.` },
            { c: 'F-PLN', a: `départ piste ${SCENARIO.flight.depRunway}, SID ${SCENARIO.flight.sid} ; comparer la route avec l’OFP (CNA B19 AMB, STAR ${SCENARIO.flight.star}, ILS 25 via ODILO), pas de discontinuité.` },
            { c: 'RAD NAV', a: 'moyens radio (sélection automatique).' },
            { c: 'INIT B', a: `ZFW ${zfw} / ZFWCG ${wt.zfwcg} / BLOCK ${blk} (d’après le devis de masse).` },
            { c: 'PERF T.O', a: `V1 ${t.v1}, VR ${t.vr}, V2 ${t.v2}, FLEX TO TEMP ${t.flex}, FLAPS/THS 1/UP${t.thsFor.toFixed(1)}, THR RED/ACC ${t.thrRed}.` },
          ],
        },
        {
          title: 'Glareshield',
          steps: [
            { c: 'BARO REF', a: `QNH ${w.qnh} hPa sur les deux EFIS.` },
            { c: 'FD · ND', a: 'FD ON, mode et échelle du ND selon besoin.' },
          ],
        },
      ],
      checklist: 'COCKPIT PREP',
    },
    {
      id: 'before',
      title: '4. Avant la mise en route',
      en: 'BEFORE PUSHBACK OR START',
      groups: [{
        steps: [
          { c: 'FINAL LOADSHEET', a: 'vérifier le devis de masse définitif ; mettre à jour INIT B et PERF T.O si besoin.' },
          { c: 'CABIN', a: 'embarquement terminé, portes fermées (page ECAM DOOR), toboggans armés, cabine prête.' },
          { c: 'JET BRIDGE · GPU', a: 'passerelle retirée ; EXT PWR OFF (l’APU GEN prend le relais) puis GPU débranché.' },
          { c: 'WINDOWS', a: 'fermées.' },
          { c: 'THR LEVERS', a: 'IDLE.' },
          { c: 'PARKING BRAKE', a: 'ON.' },
          { c: 'APU BLEED', a: 'ON (air pour le démarrage).' },
          { c: 'GROUND CLEARANCE', a: 'accord du mécanicien au casque : zone dégagée.' },
          { c: 'BEACON', a: 'ON : prévient les équipes au sol que les moteurs vont démarrer.' },
        ],
      }],
      checklist: 'BEFORE START',
    },
    {
      id: 'start',
      title: '5. Mise en route (démarrage automatique)',
      en: 'ENGINE START',
      groups: [
        {
          steps: [
            { c: 'ENG MODE sel', a: 'IGN/START : la page ENG s’affiche sur le SD, les packs se ferment.' },
            { c: 'BLEED PRESS', a: 'vérifier la pression d’air disponible (≥ 25 PSI).' },
            { c: 'ENG MASTER 2', a: 'ON — le moteur 2 d’abord : il pressurise le circuit hydraulique jaune qui alimente le frein de parc.' },
          ],
        },
        {
          title: 'Surveiller sur l’E/WD et la page ENG',
          steps: [
            { c: 'N2', a: 'augmente ; vanne de démarrage ouverte.' },
            { c: 'IGN', a: 'allumeur A ou B vers 16 % N2.' },
            { c: 'FF', a: 'débit carburant vers 22 % N2.' },
            { c: 'EGT', a: 'allumage en moins de 15 s, puis montée de l’EGT.' },
            { c: 'N1 · OIL', a: 'N1 augmente, pression d’huile en hausse.' },
            { c: 'START VALVE', a: 'fermée vers 50 % N2 ; allumeurs coupés.' },
            { c: 'IDLE', a: 'ralenti stabilisé en ≈ 45 s : N1 ≈ 19,5 %, N2 ≈ 59 %, EGT ≈ 400 °C, FF ≈ 290 kg/h.' },
          ],
        },
        {
          steps: [
            { c: 'ENG MASTER 1', a: 'ON, même surveillance.' },
            { c: '', a: 'En cas d’anomalie, le FADEC interrompt lui-même le démarrage (voyant ENG FAULT) : ENG MASTER OFF puis procédure ECAM.' },
          ],
        },
      ],
    },
    {
      id: 'after',
      title: '6. Après la mise en route',
      en: 'AFTER START',
      groups: [{
        steps: [
          { c: 'ENG MODE sel', a: 'NORM.' },
          { c: 'APU BLEED', a: 'OFF.' },
          { c: 'ENG / WING ANTI ICE', a: 'selon les conditions givrantes.' },
          { c: 'APU MASTER SW', a: 'OFF (selon besoin).' },
          { c: 'ECAM STATUS', a: 'vérifier.' },
          { c: 'GROUND SPOILERS', a: 'ARM.' },
          { c: 'RUDDER TRIM', a: 'ZERO.' },
          { c: 'FLAPS', a: `position de décollage (CONF ${t.conf}+F → levier 1).` },
          { c: 'PITCH TRIM', a: `réglé pour le décollage (${t.thsFor.toFixed(1)} UP).` },
        ],
      }],
      checklist: 'AFTER START',
    },
  ];
}
