/**
 * EFB — Electronic Flight Bag tablet overlay (owner: ui). Tabs: OFP, LOADSHEET, PERF T.O, MÉTÉO, CHECKLISTS,
 * SOP, SERVICES SOL, RÉGLAGES. Documents in English like the real EFB apps; the game parts (SOP help,
 * ground services, settings) in French. Only the open tab is refreshed (4 Hz), text only when it changes.
 */
import type { App } from '../app';
import { SCENARIO } from '../core/scenario';
import { h, icon, ICONS, setText, toggleClass } from './dom';
import { DOOR_IDS, SPEAKERS, type DoorId, type GroundMessage, type GroundService, type GroundStatus } from './ground';
import type { GameService } from './game';
import { normalChecklists, type ChecklistState } from './checklists';
import { sopSections } from './sop';
import { loadsheetText, ofpText, perfTo, schedule, utcLabel, weatherDocs, wt, FUEL_PLAN } from './ofp';
import { settingsForm, type MenuCtx } from './menus';
import { setUiPref, uiPrefs } from './prefs';

export type EfbTab = 'ofp' | 'load' | 'perf' | 'wx' | 'check' | 'sop' | 'ground' | 'settings';

const TABS: Array<[EfbTab, string, string]> = [
  ['ofp', 'OFP', ICONS.ofp],
  ['load', 'Loadsheet', ICONS.load],
  ['perf', 'Perf T.O', ICONS.perf],
  ['wx', 'Météo', ICONS.wx],
  ['check', 'Checklists', ICONS.check],
  ['sop', 'SOP', ICONS.sop],
  ['ground', 'Services sol', ICONS.ground],
  ['settings', 'Réglages', ICONS.gear],
];

export interface EfbCtx {
  app: App;
  ground: GroundService;
  game: GameService;
  checklists: ChecklistState;
  menu: MenuCtx;
  /** Short feedback (e.g. "already connected"). */
  notify(text: string): void;
  onClose(): void;
}

interface GroundRefs {
  chips: Record<string, HTMLElement>;
  bars: Record<string, HTMLElement>;
  btns: Record<string, HTMLButtonElement>;
  doorSt: Record<string, HTMLElement>;
  doorBtn: Record<string, HTMLButtonElement>;
  plan: SVGSVGElement;
  log: HTMLElement;
  logN: number;
  pace: HTMLElement;
}

const hhmmss = (s: number) => {
  const t = ((Math.floor(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export class Efb {
  readonly el: HTMLElement;
  private efb: HTMLElement;
  private main: HTMLElement;
  private rail = new Map<EfbTab, HTMLButtonElement>();
  private badge: HTMLElement;
  private tab: EfbTab = 'ofp';
  private opened = false;
  private utcEl: HTMLElement;
  private ltEl: HTMLElement;
  private themeBtn: HTMLButtonElement;
  private g: GroundRefs | null = null;
  private acc = 0;
  private unread = 0;
  private renderedKey = '';

  constructor(private ctx: EfbCtx) {
    const tod = ctx.app.settings.get().timeOfDay;
    this.ltEl = h('span', null, '--:--');
    this.utcEl = h('div', 'utc', 'UTC --:--:--');
    this.badge = h('span', 'badge a3-hidden', '0');
    this.themeBtn = h('button', { attrs: { type: 'button', title: 'Thème jour / nuit' }, on: { click: () => this.toggleTheme() } }, icon(ICONS.moon));
    const rail = h('nav', 'rail');
    for (const [id, label, ic] of TABS) {
      const b = h('button', { attrs: { type: 'button' }, on: { click: () => this.show(id) } }, icon(ic), h('span', null, label));
      if (id === 'ground') b.append(this.badge);
      this.rail.set(id, b);
      rail.append(b);
    }
    rail.append(h('div', 'grow'), this.utcEl);
    this.main = h('div', 'main');
    const f = SCENARIO.flight;
    this.efb = h('div', `a3-efb${tod !== 'day' ? ' night' : ''}`,
      h('div', 'sbar', this.ltEl, h('span', null, 'SIMAIR EFB'), h('span', 'bat', '87 %', h('i'))),
      h('div', 'hbar',
        h('div', 'logo', icon(ICONS.plane), 'EFB'),
        h('div', 'flt', `${f.number} · ${f.from} → ${f.to} · ${SCENARIO.aircraft.type} ${SCENARIO.aircraft.registration}`),
        h('div', 'sp'),
        this.themeBtn,
        h('button', { attrs: { type: 'button' }, on: { click: () => ctx.onClose() } }, icon(ICONS.close), 'Fermer'),
      ),
      rail,
      this.main,
    );
    this.el = h('div', 'a3-screen a3-efbwrap a3-hidden', h('div', 'a3-tablet', this.efb));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) ctx.onClose(); });
    ctx.ground.onMessage((m) => this.onMessage(m));
    ctx.checklists.onComplete((id, c) => ctx.game.markChecklist(id, c));
    this.applyTheme();
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(tab?: EfbTab): void {
    this.opened = true;
    this.el.classList.remove('a3-hidden');
    this.applyTheme();
    this.show(tab ?? this.tab, true);
    this.tick();
  }

  close(): void {
    this.opened = false;
    this.el.classList.add('a3-hidden');
    this.g = null;
    this.renderedKey = '';
  }

  private isNight(): boolean {
    const p = uiPrefs().efbNight;
    return p === null ? this.ctx.app.settings.get().timeOfDay !== 'day' : p;
  }

  private nightOverride: boolean | null = null;

  private toggleTheme(): void {
    this.nightOverride = !(this.nightOverride ?? this.isNight());
    this.applyTheme();
  }

  private applyTheme(): void {
    const night = this.nightOverride ?? this.isNight();
    toggleClass(this.efb, 'night', night);
    this.themeBtn.replaceChildren(icon(night ? ICONS.sun : ICONS.moon));
  }

  show(tab: EfbTab, force = false): void {
    const unit = this.ctx.app.settings.get().weightUnit;
    const key = `${tab}|${unit}`;
    if (!force && key === this.renderedKey) return;
    this.tab = tab;
    this.renderedKey = key;
    this.loadBanner = null;
    for (const [id, b] of this.rail) toggleClass(b, 'on', id === tab);
    this.g = null;
    this.main.scrollTop = 0;
    const tod = this.ctx.app.settings.get().timeOfDay;
    switch (tab) {
      case 'ofp': this.main.replaceChildren(...this.ofp(tod, unit)); break;
      case 'load': this.main.replaceChildren(...this.load(tod, unit)); break;
      case 'perf': this.main.replaceChildren(...this.perf(tod)); break;
      case 'wx': this.main.replaceChildren(...this.wx(tod)); break;
      case 'check': this.main.replaceChildren(...this.check(tod, unit)); break;
      case 'sop': this.main.replaceChildren(...this.sop(tod)); break;
      case 'ground': this.main.replaceChildren(...this.groundTab()); this.unread = 0; this.updateBadge(); break;
      case 'settings': this.main.replaceChildren(h('h2', null, 'Réglages'), h('p', 'lead', 'Réglages du jeu (enregistrés sur cet appareil).'), h('div', 'setwrap', settingsForm(this.ctx.menu))); break;
    }
    this.main.append(h('div', 'closehint', 'Tab ou Échap : fermer la tablette'));
    this.refresh();
  }

  /** Called every frame by the controller. */
  update(dt: number): void {
    if (!this.opened) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this.tick();
  }

  private tick(): void {
    const utc = this.ctx.app.sim.get('G:TIME_UTC');
    setText(this.utcEl, `UTC ${hhmmss(utc)}`);
    setText(this.ltEl, hhmmss(utc + 7200).slice(0, 5));
    // A unit change in the settings tab re-renders the documents when coming back to them.
    this.refresh();
  }

  private refresh(): void {
    if (this.tab === 'ground' && this.g) this.refreshGround(this.ctx.ground.status());
    if (this.tab === 'load' && this.loadBanner) {
      const st = this.ctx.ground.status();
      if (st.loadsheetFinal !== this.loadFinal) { this.show('load', true); return; }
      if (!st.loadsheetFinal) setText(this.loadBanner, this.pendingText(st));
    }
  }

  private loadBanner: HTMLElement | null = null;
  private loadFinal = false;

  private pendingText(st: GroundStatus): string {
    return `Devis de masse définitif en attente (embarquement ${st.boarding.pax}/${st.boarding.total}, chargement des soutes ${Math.round(st.loading.progress * 100)} %). Chiffres prévisionnels ci-dessous.`;
  }

  private onMessage(m: GroundMessage): void {
    if (this.g) this.appendLog(m);
    if (!(this.opened && this.tab === 'ground')) { this.unread++; this.updateBadge(); }
  }

  private updateBadge(): void {
    toggleClass(this.badge, 'a3-hidden', this.unread === 0);
    setText(this.badge, String(Math.min(99, this.unread)));
  }

  /* ------------------------------------------------------------------ tabs */

  private ofp(tod: ReturnType<App['settings']['get']>['timeOfDay'], unit: 'kg' | 'lbs'): Node[] {
    const sch = schedule(tod);
    const U = unit === 'kg' ? 'kg' : 'lb';
    const kv = (k: string, v: string, acc = false) => h('div', 'kv', h('small', null, k), h('b', acc ? 'acc' : null, v));
    return [
      h('h2', null, 'Operational Flight Plan'),
      h('p', 'lead', `${SCENARIO.flight.callsign} · ${SCENARIO.flight.route}`),
      h('div', 'cards',
        kv('STD', utcLabel(sch.std)), kv('ETA', utcLabel(sch.eta)), kv('EET', '0:55'), kv('CRZ FL / CI', `${SCENARIO.flight.crzFl} / ${SCENARIO.flight.costIndex}`),
        kv(`Trip fuel (${U})`, String(wt(FUEL_PLAN.trip.kg, unit))), kv(`Block fuel (${U})`, String(wt(SCENARIO.weights.blockFuel, unit)), true),
        kv('Dist', `${SCENARIO.flight.distanceNm} NM`), kv('ALTN', SCENARIO.flight.altn),
      ),
      h('div', 'doc', ofpText(tod, unit)),
    ];
  }

  private load(tod: ReturnType<App['settings']['get']>['timeOfDay'], unit: 'kg' | 'lbs'): Node[] {
    const st = this.ctx.ground.status();
    const w = SCENARIO.weights;
    const U = unit === 'kg' ? 'kg' : 'lb';
    const kv = (k: string, v: string, acc = false) => h('div', 'kv', h('small', null, k), h('b', acc ? 'acc' : null, v));
    const tow = w.zfw + w.blockFuel - w.taxiFuel;
    this.loadFinal = st.loadsheetFinal;
    this.loadBanner = h('span', null, st.loadsheetFinal ? 'LOADSHEET FINAL reçu — vérifiez ZFW / ZFWCG et le carburant dans le MCDU (INIT B).' : this.pendingText(st));
    return [
      h('h2', null, 'Loadsheet'),
      h('div', `banner ${st.loadsheetFinal ? 'ok' : 'warn'}`, st.loadsheetFinal ? '✓' : '⏳', this.loadBanner),
      h('div', 'cards',
        kv(`ZFW (${U})`, String(wt(w.zfw, unit)), true), kv('ZFWCG', `${w.zfwcg.toFixed(1)} %`, true), kv(`Block (${U})`, String(wt(w.blockFuel, unit))),
        kv(`TOW (${U})`, String(wt(tow, unit))), kv('CG TOW', '27.9 %'), kv('THS (STAB)', `${SCENARIO.takeoff.thsFor.toFixed(1)} UP`),
        kv('PAX', String(w.pax)), kv(`Cargo (${U})`, String(wt(w.cargo, unit))),
      ),
      h('div', 'doc', loadsheetText(tod, unit, st.loadsheetFinal, st.boarding.pax)),
    ];
  }

  private perf(tod: ReturnType<App['settings']['get']>['timeOfDay']): Node[] {
    const p = perfTo(tod);
    const kv = (k: string, v: string, acc = false) => h('div', 'kv', h('small', null, k), h('b', acc ? 'acc' : null, v));
    const tr = (a: string, b: string) => h('tr', null, h('td', null, a), h('td', 'm', b));
    return [
      h('h2', null, 'Take-off performance'),
      h('p', 'lead', `${p.runway} · computed ${utcLabel(schedule(tod).std - 30)} · A320-214 CFM56-5B4/P`),
      h('div', 'cards',
        kv('CONF', p.conf, true), kv('FLEX TO TEMP', `${p.flex} °C`, true), kv('V1', `${p.v1} kt`, true), kv('VR', `${p.vr} kt`, true), kv('V2', `${p.v2} kt`, true),
        kv('THS', p.ths), kv('THR RED / ACC', `${p.thrRed} / ${p.acc} ft`), kv('EO ACC', `${p.eoAcc} ft`),
      ),
      h('h3', null, 'Runway & conditions'),
      h('table', 't',
        tr('Runway', `${p.runway}  QFU ${p.rwyHdg}°  ELEV ${p.elevFt} ft`),
        tr('TORA / TODA / ASDA', `${p.tora} / ${p.toda} / ${p.asda} m`),
        tr('Surface', 'DRY'),
        tr('Wind', `${p.wind} kt  (headwind ${p.headwind} kt, crosswind ${Math.abs(p.crosswind)} kt ${p.crosswind >= 0 ? 'from right' : 'from left'})`),
        tr('OAT / QNH', `${p.oat} °C / ${p.qnh} hPa`),
        tr('TOW', `${p.tow} kg   (RWY limit ${p.mtowRwy} kg)`),
        tr('Air cond / anti-ice', 'ON / OFF'),
        tr('CG', `${p.cg} % MAC`),
      ),
      h('h3', null, 'MCDU'),
      h('p', 'lead', 'PERF TAKE OFF : V1, VR, V2, FLEX TO TEMP et FLAPS/THS à reporter dans le MCDU ; vérifier la cohérence avec le devis de masse (TOW).'),
    ];
  }

  private wx(tod: ReturnType<App['settings']['get']>['timeOfDay']): Node[] {
    const d = weatherDocs(tod);
    return [
      h('h2', null, 'Weather'),
      h('p', 'lead', 'Observations et prévisions (METAR / TAF) — départ, destination, dégagement.'),
      h('div', 'wx',
        h('div', 'card',
          h('header', null, h('b', null, 'ATIS LFBD'), h('i', null, 'DEP')),
          h('div', 'm', d.atis),
          h('ul', null, ...d.decoded.map((x) => h('li', null, x))),
        ),
        ...d.docs.map((x) => h('div', 'card',
          h('header', null, h('b', null, x.station), h('span', null, x.name), h('i', null, x.role)),
          h('div', 'm', x.metar),
          h('div', 'm taf', x.taf),
        )),
      ),
    ];
  }

  private check(tod: ReturnType<App['settings']['get']>['timeOfDay'], unit: 'kg' | 'lbs'): Node[] {
    const lists = normalChecklists(tod, unit);
    const cs = this.ctx.checklists;
    const out: Node[] = [
      h('h2', null, 'Normal checklist'),
      h('p', 'lead', 'Checklist normale A320 (lecture « challenge / réponse »). Touchez une ligne pour la cocher — aucune détection automatique.'),
    ];
    for (const cl of lists) {
      const count = h('span', null, '');
      const done = h('div', 'done a3-hidden', `${cl.title} CHECKLIST COMPLETED`);
      const rows = cl.items.map((it, i) => {
        const r = h('div', `row${cs.isTicked(cl.id, i) ? ' on' : ''}`,
          h('div', 'box', '✓'),
          h('div', 'line', h('span', 'it', it.item), h('span', 'dots'), h('span', 'rs', it.resp)),
          it.hint ? h('div', 'hint', it.hint) : null,
        );
        r.addEventListener('click', () => { cs.toggle(cl.id, i); r.classList.toggle('on', cs.isTicked(cl.id, i)); upd(); });
        return r;
      });
      const upd = () => { setText(count, `${cs.count(cl.id)}/${cl.items.length}`); toggleClass(done, 'a3-hidden', !cs.isComplete(cl.id)); };
      const reset = h('button', { class: 'eb', attrs: { type: 'button' }, on: { click: () => { cs.reset(cl.id); rows.forEach((r) => r.classList.remove('on')); upd(); } } }, 'Reset');
      out.push(h('div', 'cl', h('header', null, h('b', null, cl.title), h('div', { style: 'display:flex;gap:10px;align-items:center' }, count, reset)), ...rows, done));
      upd();
    }
    return out;
  }

  private sop(tod: ReturnType<App['settings']['get']>['timeOfDay']): Node[] {
    const out: Node[] = [
      h('h2', null, 'Procédures (SOP)'),
      h('p', 'lead', 'Aide-mémoire des procédures normales Airbus, du cold & dark aux deux moteurs démarrés (d’après le FCOM, section PRO-NOR-SOP). Référence uniquement : rien n’est signalé dans le cockpit.'),
    ];
    const div = h('div', 'sop');
    for (const s of sopSections(tod)) {
      const sec = h('section', null, h('h4', null, s.title, h('small', null, s.en)));
      if (s.intro) sec.append(h('div', 'intro', s.intro));
      for (const g of s.groups) {
        if (g.title) sec.append(h('h5', null, g.title));
        for (const st of g.steps) sec.append(st.c ? h('div', 'st', h('b', null, st.c), h('span', null, st.a)) : h('div', 'st plain', st.a));
      }
      if (s.checklist) sec.append(h('span', 'cltag', `→ ${s.checklist} CHECKLIST`));
      div.append(sec);
    }
    out.push(div);
    return out;
  }

  /* ------------------------------------------------------------------ ground services */

  private groundTab(): Node[] {
    const gs = this.ctx.ground;
    const act = (fn: () => { ok: boolean; msg: string }) => () => {
      const r = fn();
      if (!r.ok && r.msg) this.ctx.notify(r.msg);
      this.refreshGround(gs.status());
    };
    const chips: Record<string, HTMLElement> = {};
    const bars: Record<string, HTMLElement> = {};
    const btns: Record<string, HTMLButtonElement> = {};
    const btn = (id: string, label: string, fn: () => { ok: boolean; msg: string }, primary = false) => {
      const b = h('button', { class: `eb${primary ? ' p' : ''}`, attrs: { type: 'button' }, on: { click: act(fn) } }, label);
      btns[id] = b;
      return b;
    };
    const card = (id: string, title: string, desc: string, bar: boolean, ...buttons: Array<HTMLElement | null>) => {
      chips[id] = h('span', 'chip', '—');
      if (bar) bars[id] = h('i');
      return h('div', 'sv',
        h('div', 'top', h('b', null, title), chips[id]),
        h('div', 'desc', desc),
        bar ? h('div', 'bar', bars[id]) : null,
        buttons.length ? h('div', 'btns', ...buttons) : null,
      );
    };
    const doorSt: Record<string, HTMLElement> = {};
    const doorBtn: Record<string, HTMLButtonElement> = {};
    const doorRows = (ids: DoorId[], names: string[]) => h('div', 'doors', ...ids.flatMap((d, i) => {
      doorSt[d] = h('span', 'st', '—');
      doorBtn[d] = h('button', { class: 'eb', attrs: { type: 'button' }, on: { click: act(() => gs.door(d, gs.status().doors[d].target < 0.5)) } }, '…');
      return [h('span', null, names[i]), doorSt[d], doorBtn[d]];
    }));
    const pace = h('div', null);
    const renderPace = () => {
      pace.replaceChildren(h('div', 'tabs2',
        ...(['real', 'fast'] as const).map((p) => h('button', { class: gs.pace() === p ? 'on' : '', attrs: { type: 'button' }, on: { click: () => { gs.setPace(p); setUiPref('groundPace', p); renderPace(); } } },
          p === 'real' ? 'Rythme réaliste' : 'Rythme accéléré')),
      ));
    };
    renderPace();

    const plan = this.planSvg();
    const log = h('div', 'log');
    const services = h('div', 'svc',
      card('walk', 'Tour de sécurité', "Inspection extérieure de sécurité avant la mise sous tension : le copilote fait le tour de l'avion et vous rend compte.", false,
        btn('walk', 'Lancer le tour', () => gs.walkaround(), true)),
      card('board', 'Embarquement', `${SCENARIO.weights.pax} passagers par la passerelle (porte L1). Le devis de masse définitif suit la fin de l'embarquement et du chargement.`, true,
        btn('board', "Autoriser l'embarquement", () => gs.boarding(), true)),
      card('gpu', 'Groupe de parc (GPU)', 'Alimentation 115 V / 400 Hz au sol. Coupez EXT PWR avant de le faire débrancher.', false,
        btn('gpuOn', 'Brancher', () => gs.gpu(true)), btn('gpuOff', 'Débrancher', () => gs.gpu(false))),
      card('bridge', 'Passerelle', "Accostée à la porte L1. Elle ne se retire qu'une fois la porte L1 fermée.", true,
        btn('bridgeOn', 'Accoster', () => gs.jetbridge(true)), btn('bridgeOff', 'Retirer', () => gs.jetbridge(false))),
      (() => { const c = card('pax', 'Portes passagers', 'Manœuvrées par l’équipage de cabine (toboggans désarmés).', false); c.append(doorRows(['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2'], ['L1 (avant gauche)', 'L2 (arrière gauche)', 'R1 (avant droite)', 'R2 (arrière droite)'])); return c; })(),
      (() => { const c = card('cargo', 'Soutes', 'Chargement des bagages et du fret par les agents de piste, qui ferment les soutes à la fin.', true); c.append(doorRows(['CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK'], ['Soute avant', 'Soute arrière', 'Soute vrac'])); return c; })(),
      card('slides', 'Toboggans', 'Armement des toboggans par les PNC, toutes portes fermées, puis cross-check.', false,
        btn('slidesOn', 'Armer', () => gs.slides(true)), btn('slidesOff', 'Désarmer', () => gs.slides(false))),
      card('cabin', 'Cabine', 'Le chef de cabine annonce « cabine prête » une fois l’embarquement terminé et les portes fermées.', false),
      card('chocks', 'Cales', 'Retrait par le mécanicien, frein de parc serré.', false,
        btn('chocksOff', 'Retirer', () => gs.chocks(false)), btn('chocksOn', 'Mettre en place', () => gs.chocks(true))),
      card('start', 'Mise en route', 'Demander au mécanicien au casque l’accord pour la mise en route (zone dégagée, cales, équipements).', false,
        btn('start', "Demander l'accord", () => gs.startClearance(), true)),
      card('fuel', 'Avitaillement', `Camion avitailleur (quantité demandée : ${SCENARIO.weights.blockFuel.toLocaleString('fr-FR')} kg). Mémo ECAM REFUELG pendant l'opération.`, true,
        btn('fuelOn', 'Demander', () => gs.refuel(true)), btn('fuelOff', 'Interrompre', () => gs.refuel(false))),
      card('asu', 'Groupe de démarrage (ASU)', "Air haute pression au sol pour démarrer les moteurs sans l'APU BLEED.", false,
        btn('asuOn', 'Brancher', () => gs.airStartUnit(true)), btn('asuOff', 'Débrancher', () => gs.airStartUnit(false))),
    );
    this.g = { chips, bars, btns, doorSt, doorBtn, plan, log, logN: 0, pace };
    for (const m of gs.messages()) this.appendLog(m);
    return [
      h('h2', null, 'Services sol'),
      h('p', 'lead', 'Poste 14, Hall A — demandes aux équipes au sol et à l’équipage de cabine. Les réponses s’affichent aussi en jeu.'),
      pace,
      h('div', 'gs',
        h('div', 'left', plan, h('h3', { style: 'margin:4px 0 0' }, 'Messages'), log),
        services,
      ),
    ];
  }

  private appendLog(m: GroundMessage): void {
    const g = this.g;
    if (!g) return;
    const t = hhmmss(m.utc).slice(0, 5);
    g.log.prepend(h('div', m.level, h('time', null, `${t}Z`), h('b', null, SPEAKERS[m.from]), m.text));
    g.logN++;
    while (g.log.children.length > 60) g.log.lastElementChild?.remove();
  }

  private planSvg(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 300 400');
    svg.setAttribute('class', 'plan');
    svg.innerHTML = `
      <g class="ac">
        <path d="M150 16c11 0 17 22 17 52v250c0 22-7 50-17 70-10-20-17-48-17-70V68c0-30 6-52 17-52z"/>
        <path d="M133 168 40 228v12l93-28zM167 168l93 60v12l-93-28z"/>
        <path d="M136 342 100 362v8l36-8zM164 342l36 20v8l-36-8z"/>
        <rect x="72" y="194" width="15" height="30" rx="5"/><rect x="213" y="194" width="15" height="30" rx="5"/>
        <path d="M143 32h14l3 8h-20z" class="win"/>
      </g>
      <g id="p-bridge"><rect x="42" y="50" width="86" height="16" rx="2" class="eq"/><circle cx="36" cy="58" r="12" class="eq"/></g>
      <g id="p-gpu"><rect x="194" y="30" width="26" height="16" rx="2" class="eq"/><path id="p-cable" d="M194 40 C182 42 172 48 165 52" class="cable"/></g>
      <g id="p-fuel"><rect x="226" y="252" width="44" height="18" rx="3" class="eq"/><path d="M226 258 C214 252 206 246 200 240" class="cable"/></g>
      <g id="p-asu"><rect x="60" y="262" width="30" height="16" rx="2" class="eq"/><path d="M90 268 C110 262 124 252 138 244" class="cable"/></g>
      <g id="p-chocks"><rect x="143" y="76" width="4" height="7"/><rect x="153" y="76" width="4" height="7"/><rect x="128" y="210" width="4" height="8"/><rect x="168" y="210" width="4" height="8"/></g>
      <rect id="d-PAX_L1" class="d" x="129" y="54" width="6" height="12" rx="1"/>
      <rect id="d-PAX_R1" class="d" x="165" y="54" width="6" height="12" rx="1"/>
      <rect id="d-PAX_L2" class="d" x="129" y="306" width="6" height="12" rx="1"/>
      <rect id="d-PAX_R2" class="d" x="165" y="306" width="6" height="12" rx="1"/>
      <rect id="d-CARGO_FWD" class="d cg" x="158" y="118" width="8" height="14" rx="1.5"/>
      <rect id="d-CARGO_AFT" class="d cg" x="158" y="262" width="8" height="14" rx="1.5"/>
      <rect id="d-CARGO_BULK" class="d cg" x="158" y="286" width="7" height="9" rx="1.5"/>
      <text x="119" y="64" text-anchor="end">L1</text><text x="177" y="64">R1</text>
      <text x="123" y="316" text-anchor="end">L2</text><text x="177" y="316">R2</text>
      <text x="172" y="129">AV</text><text x="172" y="273">AR</text><text x="172" y="294">VRAC</text>
      <text x="36" y="84" text-anchor="middle" class="lab">passerelle</text>
      <text x="207" y="24" text-anchor="middle" class="lab">GPU</text>
      <text x="248" y="284" text-anchor="middle" class="lab">avitailleur</text>
      <text x="75" y="294" text-anchor="middle" class="lab">ASU</text>
      <text x="150" y="398" text-anchor="middle" class="lab">poste 14 · nez vers le terminal</text>`;
    return svg;
  }

  private refreshGround(s: GroundStatus): void {
    const g = this.g;
    if (!g) return;
    const chip = (id: string, text: string, cls: '' | 'ok' | 'warn' | 'busy') => {
      const c = g.chips[id];
      if (!c) return;
      setText(c, text);
      const want = `chip${cls ? ' ' + cls : ''}`;
      if (c.className !== want) c.className = want;
    };
    const bar = (id: string, v: number) => { const b = g.bars[id]; if (b) { const w = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`; if (b.style.width !== w) b.style.width = w; } };
    const dis = (id: string, d: boolean) => { const b = g.btns[id]; if (b && b.disabled !== d) b.disabled = d; };
    const link = (st: string, on: string, off: string) => st === 'connected' ? [on, 'ok'] as const : st === 'disconnected' ? [off, ''] as const : [st === 'connecting' ? 'Branchement…' : 'Débranchement…', 'busy'] as const;

    // walk-around
    const wk = s.walkaround.state;
    chip('walk', wk === 'done' ? 'Effectué' : wk === 'doing' ? 'En cours…' : 'À faire', wk === 'done' ? 'ok' : wk === 'doing' ? 'busy' : 'warn');
    dis('walk', wk === 'doing');
    // boarding
    const b = s.boarding;
    chip('board', b.state === 'complete' ? `Terminé ${b.total}/${b.total}` : b.state === 'boarding' ? `En cours ${b.pax}/${b.total}` : 'En attente', b.state === 'complete' ? 'ok' : b.state === 'boarding' ? 'busy' : 'warn');
    bar('board', b.progress);
    dis('board', b.state !== 'waiting');
    // GPU
    const [gt, gc] = link(s.gpu.state, 'Branché', 'Débranché');
    chip('gpu', gt, gc);
    dis('gpuOn', s.gpu.state === 'connected' || s.gpu.state === 'connecting');
    dis('gpuOff', s.gpu.state === 'disconnected' || s.gpu.state === 'disconnecting');
    // jet bridge
    const jb = s.jetbridge;
    chip('bridge', jb.moving ? `${jb.target > jb.pos ? 'Accostage' : 'Retrait'} ${Math.round(jb.pos * 100)} %` : jb.pos >= 1 ? 'Accostée' : 'Retirée', jb.moving ? 'busy' : jb.pos >= 1 ? 'warn' : 'ok');
    bar('bridge', jb.pos);
    dis('bridgeOn', jb.target >= 1);
    dis('bridgeOff', jb.target <= 0);
    // doors
    let paxOpen = 0, cargoOpen = 0;
    for (const d of DOOR_IDS) {
      const m = s.doors[d];
      const st = g.doorSt[d], bt = g.doorBtn[d];
      const open = m.pos > 0.001 || m.target > 0;
      if (open) { if (d.startsWith('PAX')) paxOpen++; else cargoOpen++; }
      if (st) {
        setText(st, m.moving ? (m.target > m.pos ? 'Ouverture…' : 'Fermeture…') : m.pos >= 1 ? 'Ouverte' : 'Fermée');
        const cls = `st ${m.moving ? 'm' : m.pos >= 1 ? 'o' : 'c'}`;
        if (st.className !== cls) st.className = cls;
      }
      if (bt) setText(bt, m.target >= 0.5 ? 'Fermer' : 'Ouvrir');
      const el = g.plan.querySelector(`#d-${d}`);
      if (el) {
        const cls = `d${d.startsWith('CARGO') ? ' cg' : ''} ${m.moving ? 'm' : m.pos > 0.001 ? 'o' : 'c'}`;
        if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
      }
    }
    chip('pax', paxOpen ? `${paxOpen} ouverte${paxOpen > 1 ? 's' : ''}` : 'Toutes fermées', paxOpen ? 'warn' : 'ok');
    const ld = s.loading;
    chip('cargo', ld.state === 'complete' ? (cargoOpen ? 'Chargée · ouverte' : 'Chargée · fermée') : ld.state === 'paused' ? 'Chargement suspendu' : `Chargement ${Math.round(ld.progress * 100)} %`,
      ld.state === 'complete' ? (cargoOpen ? 'warn' : 'ok') : 'busy');
    bar('cargo', ld.progress);
    // slides & cabin
    chip('slides', s.slides === 'armed' ? 'Armés' : s.slides === 'disarmed' ? 'Désarmés' : s.slides === 'arming' ? 'Armement…' : 'Désarmement…', s.slides === 'armed' ? 'ok' : s.slides === 'disarmed' ? '' : 'busy');
    dis('slidesOn', s.slides === 'armed' || s.slides === 'arming');
    dis('slidesOff', s.slides === 'disarmed' || s.slides === 'disarming');
    chip('cabin', s.cabinReady ? 'Cabine prête' : 'Non prête', s.cabinReady ? 'ok' : 'warn');
    // chocks
    chip('chocks', s.chocks === 'in' ? 'En place' : s.chocks === 'out' ? 'Retirées' : s.chocks === 'removing' ? 'Retrait…' : 'Mise en place…', s.chocks === 'out' ? 'ok' : s.chocks === 'in' ? '' : 'busy');
    dis('chocksOff', s.chocks === 'out' || s.chocks === 'removing');
    dis('chocksOn', s.chocks === 'in' || s.chocks === 'placing');
    // start clearance
    chip('start', s.clearance === 'granted' ? 'Accordée' : s.clearance === 'pending' ? 'Demande…' : s.clearance === 'denied' ? 'Refusée' : 'Non demandée', s.clearance === 'granted' ? 'ok' : s.clearance === 'pending' ? 'busy' : s.clearance === 'denied' ? 'warn' : '');
    dis('start', s.clearance === 'pending');
    // refuel
    const rf = s.refuel;
    chip('fuel', rf.state === 'refueling' ? `En cours ${Math.round(rf.progress * 100)} %` : rf.state === 'arriving' ? 'Camion en route' : rf.state === 'leaving' ? 'Terminé' : rf.state === 'done' ? 'Terminé' : 'Aucun', rf.state === 'refueling' || rf.state === 'arriving' ? 'busy' : rf.state === 'done' || rf.state === 'leaving' ? 'ok' : '');
    bar('fuel', rf.progress);
    dis('fuelOn', rf.state === 'refueling' || rf.state === 'arriving');
    dis('fuelOff', !(rf.state === 'refueling' || rf.state === 'arriving'));
    // ASU
    const [at, ac] = link(s.asu, 'Branché', 'Non branché');
    chip('asu', at, ac === 'ok' ? 'ok' : ac);
    dis('asuOn', s.asu === 'connected' || s.asu === 'connecting');
    dis('asuOff', s.asu === 'disconnected' || s.asu === 'disconnecting');

    // plan equipment
    const show = (id: string, on: boolean) => { const e = g.plan.querySelector(`#${id}`) as SVGGElement | null; if (e) { const v = on ? '' : 'none'; if (e.style.display !== v) e.style.display = v; } };
    const bridgeG = g.plan.querySelector('#p-bridge') as SVGGElement | null;
    if (bridgeG) { const tx = `translate(${(-(1 - jb.pos) * 34).toFixed(1)} 0)`; if (bridgeG.getAttribute('transform') !== tx) bridgeG.setAttribute('transform', tx); }
    show('p-cable', s.gpu.cable);
    show('p-fuel', rf.state === 'refueling' || rf.state === 'leaving' || this.ctx.app.sim.get('G:GND_FUEL_TRUCK') > 0);
    show('p-asu', s.asu !== 'disconnected');
    show('p-chocks', s.chocks !== 'out');
    const gpuOn = g.plan.querySelector('#p-gpu rect');
    if (gpuOn) { const c = s.gpu.power ? 'eq on' : 'eq'; if (gpuOn.getAttribute('class') !== c) gpuOn.setAttribute('class', c); }
  }
}
