/**
 * Menus in French (owner: ui): title screen with the flight briefing, pause menu, settings, controls help,
 * confirmation dialog and the end-of-game debrief. DOM overlays only; the controller (main.ts) decides when
 * each one is shown.
 */
import type { App } from '../app';
import { SCENARIO, weatherFor } from '../core/scenario';
import type { Quality, TimeOfDay, AlignMode } from '../core/settings';
import { h, icon, ICONS, setText } from './dom';
import type { GroundService } from './ground';
import { formatDuration, type GameResult } from './game';
import { keyLabel, leanKeys, VIEW_KEYS } from './keys';
import { schedule, utcLabel } from './ofp';
import { setUiPref, uiPrefs, type GroundPace } from './prefs';

export interface MenuCtx {
  app: App;
  ground: GroundService;
  /** The player chose pointer lock ("visée") or the free cursor in the settings. */
  setPointerLockPref(v: boolean): void;
  /** Settings that need a page reload (quality) — asks for confirmation in game. */
  reload(): void;
  inGame(): boolean;
  confirm(text: string, ok: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ small controls */

type Opt<V> = [V, string, string?];

export function seg<V extends string | boolean | number>(opts: Array<Opt<V>>, get: () => V, set: (v: V) => void): HTMLElement {
  const el = h('div', 'a3-seg');
  const render = () => { for (const b of el.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.v === String(get())); };
  for (const [v, label, sub] of opts) {
    const b = h('button', { data: { v: String(v) }, attrs: { type: 'button' }, on: { click: () => { set(v); render(); } } }, label, sub ? h('small', null, sub) : null);
    el.append(b);
  }
  render();
  return el;
}

function range(min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string): HTMLElement {
  const out = h('output', null, fmt(get()));
  const inp = h('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) } });
  inp.addEventListener('input', () => { const v = Number(inp.value); set(v); setText(out, fmt(v)); });
  return h('div', 'a3-range', inp, out);
}

function sw(get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const el = h('div', { class: `a3-switch${get() ? ' on' : ''}`, attrs: { role: 'switch', tabindex: '0' } });
  const flip = () => { set(!get()); el.classList.toggle('on', get()); };
  el.addEventListener('click', flip);
  el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  return el;
}

function row(label: string, sub: string | null, control: HTMLElement): HTMLElement[] {
  return [h('div', 'lab', label, sub ? h('small', null, sub) : null), control];
}

/* ------------------------------------------------------------------ settings */

export function settingsForm(ctx: MenuCtx): HTMLElement {
  const s = ctx.app.settings;
  const g = () => s.get();
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const wrap = h('div', null);
  wrap.append(
    h('h3', 'a3-h3', 'Contrôles'),
    h('div', 'a3-set',
      ...row('Sensibilité de la souris', null, range(0.2, 3, 0.05, () => g().mouseSensitivity, (v) => s.set('mouseSensitivity', v), (v) => `${v.toFixed(2)}×`)),
      ...row("Inverser l'axe vertical", null, sw(() => g().invertY, (v) => s.set('invertY', v))),
      ...row('Champ de vision', 'vertical, sans zoom', range(40, 90, 1, () => g().fov, (v) => s.set('fov', v), (v) => `${v}°`)),
      ...row('Mode de visée', 'touche C en jeu', seg<boolean>([[true, 'Visée', 'pointeur verrouillé'], [false, 'Curseur libre', 'clic-glisser pour regarder']],
        () => uiPrefs().pointerLock, (v) => ctx.setPointerLockPref(v))),
    ),
    h('h3', 'a3-h3', 'Affichage'),
    h('div', 'a3-set',
      ...row('Info-bulles des commandes', 'nom, état et description', sw(() => g().tooltips, (v) => s.set('tooltips', v))),
      ...row("Compteur d'images (FPS)", null, sw(() => g().showFps, (v) => s.set('showFps', v))),
      ...row('Unité de masse', 'EFB (OFP, devis de masse)', seg<'kg' | 'lbs'>([['kg', 'kg'], ['lbs', 'lb']], () => g().weightUnit, (v) => s.set('weightUnit', v))),
      ...row('Thème de la tablette EFB', null, seg<string>([['auto', 'Auto'], ['day', 'Jour'], ['night', 'Nuit']],
        () => (uiPrefs().efbNight === null ? 'auto' : uiPrefs().efbNight ? 'night' : 'day'),
        (v) => setUiPref('efbNight', v === 'auto' ? null : v === 'night'))),
      ...row('Qualité graphique', 'appliquée au rechargement', seg<Quality>([['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute'], ['ultra', 'Ultra']],
        () => g().quality, (v) => {
          if (v === g().quality) return;
          if (!ctx.inGame()) { s.set('quality', v); ctx.reload(); return; }
          void ctx.confirm('Changer la qualité graphique recharge la page : la partie en cours sera perdue.', 'Recharger').then((yes) => {
            if (yes) { s.set('quality', v); ctx.reload(); }
          });
        })),
    ),
    h('h3', 'a3-h3', 'Son'),
    h('div', 'a3-set',
      ...row('Volume général', null, range(0, 1, 0.01, () => g().masterVolume, (v) => s.set('masterVolume', v), pct)),
      ...row('Cockpit et systèmes', 'ventilation, moteurs, clics', range(0, 1, 0.01, () => g().cockpitVolume, (v) => s.set('cockpitVolume', v), pct)),
      ...row('Alarmes', 'carillons et alarmes FWC', range(0, 1, 0.01, () => g().alertVolume, (v) => s.set('alertVolume', v), pct)),
    ),
    h('h3', 'a3-h3', 'Simulation'),
    h('div', 'a3-set',
      ...row('Alignement des IRS', 'durée de l’alignement ADIRS', seg<AlignMode>([['real', 'Réel', '≈ 7 min'], ['fast', 'Rapide', '90 s'], ['instant', 'Instantané', '5 s']],
        () => g().irsAlign, (v) => s.set('irsAlign', v))),
      ...row('Opérations au sol', 'embarquement, chargement, avitaillement', seg<GroundPace>([['real', 'Réalistes', '≈ 11 min d’embarquement'], ['fast', 'Accélérées', '≈ 3 min']],
        () => uiPrefs().groundPace, (v) => { setUiPref('groundPace', v); ctx.ground.setPace(v); })),
    ),
  );
  return wrap;
}

/* ------------------------------------------------------------------ help */

export function helpContent(): HTMLElement {
  const k = (code: string) => keyLabel(code);
  const t = (rows: Array<[string, string]>) => h('table', null, ...rows.map(([a, b]) => h('tr', null, h('td', { html: a }), h('td', null, b))));
  const kb = (s: string) => `<span class="a3-kbd">${s}</span>`;
  return h('div', 'a3-help',
    h('div', null,
      h('h3', 'a3-h3', 'Souris et vue'),
      t([
        ['Souris', 'Regarder autour (mode visée : le réticule vise la commande)'],
        ['Clic gauche / droit', 'Actionner la commande visée'],
        ['Molette', 'Sur une commande : la tourner ou la basculer — ailleurs : zoom'],
        ['Glisser', 'Leviers et potentiomètres (manettes, volets, frein de parc…)'],
        [`${kb(k('KeyC'))}`, 'Basculer visée ↔ curseur libre'],
        ['Curseur libre', 'Le curseur actionne les commandes ; cliquer-glisser dans le vide pour regarder'],
      ]),
      h('h3', { class: 'a3-h3', style: 'margin-top:18px' }, 'Commandes du cockpit'),
      t([
        ['Bouton-poussoir', 'Clic gauche. Enfoncé = position normale (voyants éteints)'],
        ['Interrupteur', 'Clic gauche = vers le haut, clic droit = vers le bas, ou molette'],
        ['Sélecteur rotatif', 'Molette ou clic droit = sens horaire, clic gauche = anti-horaire, ou glisser'],
        ['Encodeur (FCU, BARO)', 'Molette = tourner, clic gauche = pousser, clic droit = tirer'],
        ['Cache de protection', 'Clic pour ouvrir / fermer ; la commande dessous n’est accessible qu’ouvert'],
        ['Leviers', 'Glisser ou molette, avec crans (manettes de poussée, volets, frein de parc)'],
        ['ENG MASTER', 'Clic (tirer et basculer)'],
        ['MCDU', 'Clic sur les touches'],
      ]),
    ),
    h('div', null,
      h('h3', 'a3-h3', 'Clavier'),
      t([
        [`${kb(leanKeys().replace(/ /g, ' '))}`, 'Se pencher (avant, gauche, arrière, droite)'],
        [`${kb(k('KeyQ'))} ${kb(k('KeyE'))}`, 'Se baisser / se redresser'],
        [`${kb('←')} ${kb('↑')} ${kb('→')} ${kb('↓')}`, 'Tourner la tête'],
        [`${kb('Espace')}`, 'Recentrer la vue'],
        [`${kb('1')} … ${kb('9')} ${kb('0')}`, 'Vues prédéfinies (voir ci-dessous)'],
        [`${kb(k('KeyF'))}`, 'Changer de siège (commandant ↔ copilote)'],
        [`${kb('Tab')}`, 'Tablette EFB (ou clic sur la tablette)'],
        [`${kb('+')} ${kb('−')}`, 'Zoom'],
        [`${kb(k('KeyB'))} maintenu`, 'Freins (pédales)'],
        [`${kb('Pavé 0')} ${kb('Pavé Entrée')}`, 'Palonnier gauche / droit'],
        [`${kb(k('KeyH'))}`, 'Cette aide'],
        [`${kb('Échap')}`, 'Menu pause'],
      ]),
      h('h3', { class: 'a3-h3', style: 'margin-top:18px' }, 'Vues prédéfinies'),
      t(VIEW_KEYS.map(([key, , label]) => [kb(key), label] as [string, string])),
    ),
    h('div', 'full',
      h('h3', 'a3-h3', 'Manette de jeu'),
      h('p', 'a3-p', 'Stick droit : regarder · Stick gauche : se pencher · A : clic · B : clic droit · LB / RB : molette · Y : EFB · Start : pause · Croix : vues (haut : panneau supérieur, bas : pylône, gauche / droite : regards) · Select : recentrer · Gâchettes : freins.'),
    ),
  );
}

/* ------------------------------------------------------------------ panels */

export function panel(title: string, body: HTMLElement, onClose: () => void, wide = false, footer?: HTMLElement): HTMLElement {
  return h('div', 'a3-screen a3-dim',
    h('div', `a3-card a3-panel a3-center${wide ? ' wide' : ''}`,
      h('header', null, h('h2', 'a3-h2', title), h('button', { class: 'a3-xbtn', attrs: { type: 'button', 'aria-label': 'Fermer' }, on: { click: onClose } }, icon(ICONS.close))),
      h('div', 'body', body),
      footer ?? null,
    ),
  );
}

export function confirmDialog(text: string, okLabel: string, done: (ok: boolean) => void): HTMLElement {
  return h('div', 'a3-screen a3-dim',
    h('div', { class: 'a3-card a3-center', style: 'width:min(440px,92vw);padding:24px;display:flex;flex-direction:column;gap:18px' },
      h('p', 'a3-p', text),
      h('div', { class: 'a3-actions', style: 'justify-content:flex-end' },
        h('button', { class: 'a3-btn small', attrs: { type: 'button' }, on: { click: () => done(false) } }, 'Annuler'),
        h('button', { class: 'a3-btn small danger', attrs: { type: 'button' }, on: { click: () => done(true) } }, okLabel),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ title screen */

export interface StartHandlers {
  start(): void;
  help(): void;
  settings(): void;
}

export function startScreen(ctx: MenuCtx, hs: StartHandlers): HTMLElement {
  const s = ctx.app.settings;
  const tod = s.get().timeOfDay;
  const w = weatherFor(tod);
  const sch = schedule(tod);
  const f = SCENARIO.flight, a = SCENARIO.aircraft;
  const reload = (fn: () => void) => { fn(); ctx.reload(); };
  const lt = (utcMin: number) => { const m = (utcMin + 120) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  return h('div', 'a3-screen a3-start',
    h('div', 'col',
      h('div', null,
        h('div', 'a3-over', `SIMAIR · Vol ${f.number} · ${a.type} ${a.registration}`),
        h('h1', 'a3-h1', 'A320 Cold & Dark'),
        h('div', 'sub', 'Du poste froid et sombre aux deux moteurs démarrés, selon les procédures Airbus.'),
      ),
      h('div', 'a3-brief',
        h('div', 'a3-route',
          h('div', 'ap', h('b', null, f.from), h('span', null, 'Bordeaux-Mérignac')),
          h('div', 'mid', icon(ICONS.plane)),
          h('div', 'ap r', h('b', null, f.to), h('span', null, 'Paris-Orly')),
        ),
        h('div', 'a3-stats',
          h('div', null, h('small', null, 'Départ prévu'), h('b', null, `${utcLabel(sch.std)}`)),
          h('div', null, h('small', null, 'Temps de vol'), h('b', null, '0 h 55')),
          h('div', null, h('small', null, 'Croisière'), h('b', null, `FL${f.crzFl}`)),
          h('div', null, h('small', null, 'Passagers'), h('b', null, `${SCENARIO.weights.pax}`)),
        ),
        h('div', 'a3-metar', w.metar),
      ),
      h('div', 'a3-mission',
        h('p', 'a3-p', `Vous êtes commandant de bord. L'A320 est froid et sombre au poste 14 (Hall A), heure locale ${lt(w.utcHour * 60)}. ` +
          'Préparez l’avion selon les procédures Airbus, puis démarrez les deux moteurs. ' +
          'Aucune aide dans le cockpit : la tablette EFB contient le plan de vol, le devis de masse, la météo, les checklists, les procédures de référence et les services au sol.'),
      ),
      h('div', 'a3-opts',
        h('label', null, 'Moment de la journée'),
        seg<TimeOfDay>([['day', 'Jour', '14:00'], ['dusk', 'Crépuscule', '19:30'], ['night', 'Nuit', '23:00']], () => s.get().timeOfDay,
          (v) => { if (v !== s.get().timeOfDay) reload(() => s.set('timeOfDay', v)); }),
        h('label', null, 'Alignement IRS'),
        seg<AlignMode>([['real', 'Réel', '≈ 7 min'], ['fast', 'Rapide', '90 s'], ['instant', 'Instantané', '5 s']], () => s.get().irsAlign, (v) => s.set('irsAlign', v)),
        h('label', null, 'Opérations au sol'),
        seg<GroundPace>([['real', 'Réalistes', '≈ 11 min d’embarquement'], ['fast', 'Accélérées', '≈ 3 min']], () => uiPrefs().groundPace,
          (v) => { setUiPref('groundPace', v); ctx.ground.setPace(v); }),
        h('label', null, 'Qualité graphique'),
        seg<Quality>([['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute'], ['ultra', 'Ultra']], () => s.get().quality,
          (v) => { if (v !== s.get().quality) reload(() => s.set('quality', v)); }),
      ),
      h('div', 'a3-actions',
        h('button', { class: 'a3-btn primary big', attrs: { type: 'button' }, on: { click: hs.start } }, 'Commencer'),
        h('button', { class: 'a3-btn', attrs: { type: 'button' }, on: { click: hs.help } }, 'Commandes'),
        h('button', { class: 'a3-btn', attrs: { type: 'button' }, on: { click: hs.settings } }, 'Réglages'),
      ),
      h('div', 'a3-foot',
        h('span', null, h('span', 'a3-kbd', 'Échap'), ' menu'),
        h('span', null, h('span', 'a3-kbd', 'Tab'), ' tablette EFB'),
        h('span', null, h('span', 'a3-kbd', keyLabel('KeyC')), ' curseur libre'),
        h('span', null, h('span', 'a3-kbd', keyLabel('KeyH')), ' aide'),
        h('span', null, 'Le changement de moment de la journée ou de qualité recharge la page.'),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ pause */

export interface PauseHandlers {
  resume(): void;
  efb(): void;
  settings(): void;
  help(): void;
  fullscreen(): void;
  restart(): void;
  title(): void;
}

export function pauseMenu(hs: PauseHandlers, elapsed: () => number): { el: HTMLElement; refresh(): void } {
  const meta = h('div', 'meta');
  const b = (label: string, fn: () => void, cls = '') => h('button', { class: `a3-btn ${cls}`, attrs: { type: 'button' }, on: { click: fn } }, label);
  const el = h('div', 'a3-screen a3-dim',
    h('div', 'a3-card a3-pause a3-center',
      h('div', 'a3-over', 'Pause'),
      h('h2', 'a3-h2', `Vol ${SCENARIO.flight.number} · ${SCENARIO.flight.from} → ${SCENARIO.flight.to}`),
      meta,
      b('Reprendre', hs.resume, 'primary'),
      b('Tablette EFB', hs.efb),
      b('Réglages', hs.settings),
      b('Commandes et aide', hs.help),
      b('Plein écran', hs.fullscreen),
      b('Redémarrer la partie', hs.restart, 'danger'),
      b("Quitter vers l'écran titre", hs.title),
    ),
  );
  const refresh = () => setText(meta, `Temps écoulé : ${formatDuration(elapsed())}`);
  return { el, refresh };
}

/* ------------------------------------------------------------------ end of game */

export function endScreen(r: GameResult, hs: { explore(): void; restart(): void }): HTMLElement {
  const pct = r.total ? r.score / r.total : 0;
  const grade = pct >= 0.95 ? 'Exemplaire' : pct >= 0.8 ? 'Très bien' : pct >= 0.6 ? 'Correct' : pct >= 0.4 ? 'À revoir' : 'Insuffisant';
  const sec = (id: string, title: string) => {
    const items = r.items.filter((i) => i.section === id);
    return h('section', null,
      h('h3', 'a3-h3', title),
      h('ul', null, ...items.map((i) => h('li', i.ok ? 'ok' : 'ko', h('i', null, i.ok ? '✓' : '✗'), h('div', null, i.label, i.detail ? h('small', null, i.detail) : null)))),
    );
  };
  return h('div', 'a3-screen a3-end',
    h('div', 'wrap',
      h('div', null,
        h('div', 'a3-over', `Vol ${SCENARIO.flight.number} · ${SCENARIO.flight.from} poste 14`),
        h('div', { class: 'big', style: 'margin-top:10px' }, 'Deux moteurs démarrés'),
        h('p', { class: 'a3-p', style: 'margin-top:10px;max-width:720px' },
          'Les deux CFM56-5B sont stabilisés au ralenti : l’avion est prêt pour la suite du vol. Voici le bilan des points clés des procédures Airbus relevés pendant votre préparation.'),
      ),
      h('div', 'kpis',
        h('div', 'kpi', h('small', null, 'Temps écoulé'), h('b', null, formatDuration(r.elapsedS))),
        h('div', 'kpi', h('small', null, 'Points SOP respectés'), h('b', pct >= 0.8 ? 'g' : 'a', `${r.score} / ${r.total}`)),
        h('div', 'kpi', h('small', null, 'Appréciation'), h('b', pct >= 0.8 ? 'g' : 'a', grade)),
      ),
      h('div', 'a3-deb', sec('prep', 'Préparation'), sec('before', 'Avant la mise en route'), sec('start', 'Mise en route')),
      h('div', 'a3-actions',
        h('button', { class: 'a3-btn primary', attrs: { type: 'button' }, on: { click: hs.explore } }, 'Continuer à explorer'),
        h('button', { class: 'a3-btn', attrs: { type: 'button' }, on: { click: hs.restart } }, 'Recommencer'),
      ),
    ),
  );
}
