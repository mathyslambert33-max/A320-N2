/**
 * End-of-game detection and SOP debrief (owner: ui) — DOM-free.
 *
 * The game ends once both engines run (`S:ENG1_RUNNING` and `S:ENG2_RUNNING`) for a few seconds. The monitor
 * takes a snapshot of the cockpit / ground state when the first engine start begins (first `S:ENGn_STATE`
 * 1 or 2) and records every engine start, then evaluates a debrief of key Airbus SOP items.
 * Service: `sim.services.game`; event `game:complete` (payload GameResult).
 */
import type { Sim, SimSystem } from '../core/sim';

export interface DebriefItem {
  id: string;
  section: 'prep' | 'before' | 'start';
  label: string;
  ok: boolean;
  detail?: string;
}

export interface GameResult {
  /** Sim seconds between the start of the game and completion. */
  elapsedS: number;
  items: DebriefItem[];
  score: number;
  total: number;
  /** ECAM alerts still displayed at completion (text). */
  ecam: string[];
}

/** Variables recorded when the first engine start begins. */
const SNAP_VARS = [
  'C:EXTLT_BEACON', 'S:EXTLT_BEACON_ON', 'C:PARK_BRK', 'C:THR_LEVER1', 'C:THR_LEVER2', 'C:ENG_MODE',
  'C:SIGNS_SEAT_BELTS', 'C:WINDOW_CAPT', 'C:WINDOW_FO',
  'S:ADIRS_IR1_STATE', 'S:ADIRS_IR2_STATE', 'S:ADIRS_IR3_STATE',
  'S:FMGS_INIT_A_DONE', 'S:FMGS_FPLN_DONE', 'S:FMGS_INIT_B_DONE', 'S:FMGS_PERF_TO_DONE',
  'G:DOOR_PAX_L1', 'G:DOOR_PAX_L2', 'G:DOOR_PAX_R1', 'G:DOOR_PAX_R2', 'G:DOOR_CARGO_FWD', 'G:DOOR_CARGO_AFT', 'G:DOOR_CARGO_BULK',
  'G:JETBRIDGE', 'G:GND_EXT_PWR', 'G:GND_GPU_CABLE', 'G:CABIN_READY', 'G:SLIDES_ARMED', 'G:GND_START_CLEARANCE',
  'G:REFUELING', 'G:GND_FUEL_TRUCK', 'G:ENV_QNH', 'S:EFIS1_BARO_HPA', 'S:EFIS1_BARO_STD', 'S:EFIS2_BARO_HPA', 'S:EFIS2_BARO_STD',
] as const;

export type Snapshot = Record<string, number>;

export interface EngineStart {
  n: number;
  /** Sim time since the game start. */
  t: number;
  apuBleed: boolean;
  asu: boolean;
  bleedPress: number;
}

export interface SessionRecord {
  snap: Snapshot | null;
  starts: EngineStart[];
  faults: string[];
  maxAttempt: number;
  aborted: boolean;
  checklists: Record<string, number>; // id → completion time (s since game start)
  walkaround: { done: boolean; beforePower: boolean | null; t: number | null };
  firstStartT: number | null;
  ecam: { text: string; level: number }[];
}

const FAULT_NAMES: Record<number, string> = {
  1: 'IGN FAULT', 2: 'EGT OVERLIMIT', 3: 'STALL', 4: 'HUNG START', 5: 'START VALVE FAULT', 7: 'LOW START AIR',
};

const f = (x: number | undefined) => x ?? 0;

/** Evaluate the debrief items from a session record (pure). */
export function evaluate(rec: SessionRecord): DebriefItem[] {
  const s = rec.snap ?? {};
  const items: DebriefItem[] = [];
  const add = (id: string, section: DebriefItem['section'], label: string, ok: boolean, detail?: string) =>
    items.push({ id, section, label, ok, detail });
  const before = (t: number | undefined) => t !== undefined && (rec.firstStartT === null || t <= rec.firstStartT);

  // ---- Preparation
  const w = rec.walkaround;
  add('walkaround', 'prep', 'Inspection extérieure de sécurité (tour avion)', w.done && before(w.t ?? undefined),
    !w.done ? 'non effectuée' : w.beforePower ? 'effectuée avant la mise sous tension' : 'effectuée après la mise sous tension (à faire avant)');
  const irs = [1, 2, 3].map((n) => f(s[`S:ADIRS_IR${n}_STATE`]));
  const irsOk = irs.every((x) => x === 2);
  add('irs', 'prep', 'IRS 1, 2 et 3 alignées en NAV avant la mise en route', irsOk,
    irsOk ? undefined : irs.map((x, i) => `IR ${i + 1} : ${['OFF', 'en alignement', 'NAV', 'ATT', 'défaut'][x] ?? '?'}`).join(' · '));
  const fm: Array<[string, string]> = [['S:FMGS_INIT_A_DONE', 'INIT A'], ['S:FMGS_FPLN_DONE', 'F-PLN'], ['S:FMGS_INIT_B_DONE', 'INIT B'], ['S:FMGS_PERF_TO_DONE', 'PERF T.O']];
  const missing = fm.filter(([v]) => !f(s[v])).map(([, n]) => n);
  add('fmgs', 'prep', 'FMGS préparé : INIT A, F-PLN, INIT B, PERF T.O', !missing.length, missing.length ? `manquant : ${missing.join(', ')}` : undefined);
  const qnh = f(s['G:ENV_QNH']);
  const baroOk = (n: number) => !f(s[`S:EFIS${n}_BARO_STD`]) && Math.abs(f(s[`S:EFIS${n}_BARO_HPA`]) - qnh) < 0.6;
  add('baro', 'prep', `Calage altimétrique QNH ${qnh} affiché (BARO REF)`, baroOk(1),
    baroOk(1) ? undefined : f(s['S:EFIS1_BARO_STD']) ? 'STD affiché' : `affiché : ${Math.round(f(s['S:EFIS1_BARO_HPA'])) || '—'}`);
  const cp = rec.checklists.cockpit_prep, bs = rec.checklists.before_start;
  const clOk = before(cp) && before(bs);
  add('checklists', 'prep', 'Checklists COCKPIT PREP et BEFORE START effectuées', clOk,
    clOk ? undefined : [!before(cp) ? 'COCKPIT PREP' : '', !before(bs) ? 'BEFORE START' : ''].filter(Boolean).join(' et ') + ' non cochée(s) avant la mise en route');

  // ---- Before start
  const doors = ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2', 'CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK'].filter((d) => f(s[`G:DOOR_${d}`]) > 0.001);
  const bridge = f(s['G:JETBRIDGE']) > 0.001;
  add('doors', 'before', 'Portes et soutes fermées, passerelle retirée', !doors.length && !bridge,
    [bridge ? 'passerelle accostée' : '', doors.length ? `ouvert : ${doors.map((d) => d.replace('PAX_', '').replace('CARGO_', 'soute ')).join(', ')}` : ''].filter(Boolean).join(' · ') || undefined);
  const gpu = f(s['G:GND_EXT_PWR']) > 0 || f(s['G:GND_GPU_CABLE']) > 0;
  add('gpu', 'before', 'GPU débranché avant la mise en route', !gpu);
  const cabin = f(s['G:CABIN_READY']) > 0, slides = f(s['G:SLIDES_ARMED']) > 0;
  add('cabin', 'before', 'Cabine prête et toboggans armés', cabin && slides,
    cabin && slides ? undefined : [cabin ? '' : 'cabine non prête', slides ? '' : 'toboggans désarmés'].filter(Boolean).join(' · '));
  const fuel = f(s['G:REFUELING']) > 0 || f(s['G:GND_FUEL_TRUCK']) > 0;
  add('clearance', 'before', 'Accord du mécanicien pour la mise en route', f(s['G:GND_START_CLEARANCE']) > 0 && !fuel,
    fuel ? 'avitaillement en cours' : f(s['G:GND_START_CLEARANCE']) > 0 ? undefined : 'non demandé ou refusé');
  add('beacon', 'before', 'Feu anticollision (BEACON) allumé avant la mise en route', rec.snap ? f(s['C:EXTLT_BEACON']) === 0 : false);
  add('parkbrk', 'before', 'Frein de parc serré', f(s['C:PARK_BRK']) === 1);
  add('seatbelts', 'before', 'Consigne SEAT BELTS sur ON', rec.snap ? f(s['C:SIGNS_SEAT_BELTS']) === 0 : false);
  add('windows', 'before', 'Fenêtres latérales fermées', f(s['C:WINDOW_CAPT']) < 0.02 && f(s['C:WINDOW_FO']) < 0.02);
  add('thr', 'before', 'Manettes de poussée sur IDLE', Math.abs(f(s['C:THR_LEVER1'])) < 1 && Math.abs(f(s['C:THR_LEVER2'])) < 1);

  // ---- Engine start
  add('engmode', 'start', 'Démarrage automatique : ENG MODE sur IGN/START', f(s['C:ENG_MODE']) === 2,
    f(s['C:ENG_MODE']) === 0 ? 'CRANK sélectionné' : f(s['C:ENG_MODE']) === 1 ? 'NORM sélectionné' : undefined);
  const air = rec.starts.length > 0 && rec.starts.every((x) => x.apuBleed || x.asu);
  add('bleed', 'start', 'Air de démarrage : APU BLEED (ou groupe de démarrage)', air,
    rec.starts.length ? rec.starts.map((x) => `ENG ${x.n} : ${x.apuBleed ? 'APU BLEED' : x.asu ? 'ASU' : 'autre'} (${Math.round(x.bleedPress)} PSI)`).join(' · ') : undefined);
  const first = rec.starts[0]?.n;
  add('order', 'start', 'Moteur 2 démarré en premier', first === 2, first ? `premier démarrage : moteur ${first}` : undefined);
  const clean = !rec.faults.length && !rec.aborted && rec.maxAttempt <= 1;
  add('nofault', 'start', 'Démarrages sans défaut ni interruption', clean,
    clean ? undefined : [...rec.faults, rec.aborted ? 'démarrage interrompu' : '', rec.maxAttempt > 1 ? `${rec.maxAttempt} tentatives` : ''].filter(Boolean).join(' · '));
  const alerts = rec.ecam.filter((e) => e.level >= 2);
  add('ecam', 'start', 'Aucune alerte ECAM à la fin', !alerts.length, alerts.length ? alerts.map((e) => e.text.trim()).join(' · ') : undefined);
  return items;
}

export interface GameService {
  state(): 'running' | 'complete';
  result(): GameResult | null;
  /** Sim seconds since begin(). */
  elapsed(): number;
  /** Start the chronometer (the UI calls it when the player presses "Commencer"). */
  begin(): void;
  /** EFB checklist completion (id: cockpit_prep | before_start | after_start). */
  markChecklist(id: string, complete: boolean): void;
  /** Force completion now (debug / dev scenarios). */
  forceComplete(): void;
  record(): SessionRecord;
  onComplete(fn: (r: GameResult) => void): () => void;
}

export class GameMonitor implements SimSystem {
  readonly name = 'ui.game';
  readonly order = 98;
  private t0 = 0;
  private done: GameResult | null = null;
  private bothFor = 0;
  private prevState = [0, 0, 0];
  private listeners = new Set<(r: GameResult) => void>();
  readonly rec: SessionRecord = {
    snap: null, starts: [], faults: [], maxAttempt: 0, aborted: false, checklists: {},
    walkaround: { done: false, beforePower: null, t: null }, firstStartT: null, ecam: [],
  };
  /** Delay (s) with both engines running before the game ends. */
  delay = 6;

  constructor(private sim: Sim) {}

  elapsed(): number {
    return Math.max(0, this.sim.time - this.t0);
  }

  begin(): void {
    this.t0 = this.sim.time;
  }

  update(dt: number, sim: Sim): void {
    if (this.done) return;
    const t = this.elapsed();
    for (const n of [1, 2]) {
      const st = sim.get(`S:ENG${n}_STATE`);
      const prev = this.prevState[n];
      this.prevState[n] = st;
      if ((st === 1 || st === 2) && prev !== 1 && prev !== 2) {
        if (!this.rec.snap) { this.rec.snap = this.snapshot(sim); this.rec.firstStartT = t; }
        this.rec.starts.push({
          n, t,
          apuBleed: sim.getB('S:APU_BLEED_VALVE') || (sim.getB('C:AIR_APU_BLEED') && sim.getB('S:APU_AVAIL')),
          asu: sim.getB('G:GND_AIR_START_UNIT'),
          bleedPress: Math.max(sim.get('S:BLEED_PRESS_1'), sim.get('S:BLEED_PRESS_2'), sim.get('S:APU_BLEED_PRESS')),
        });
      }
      if (st === 5) this.rec.aborted = true;
      const fault = sim.get(`S:ENG${n}_START_FAULT`);
      if (fault > 0) {
        const txt = `ENG ${n} ${FAULT_NAMES[fault] ?? 'START FAULT'}`;
        if (!this.rec.faults.includes(txt)) this.rec.faults.push(txt);
      }
      this.rec.maxAttempt = Math.max(this.rec.maxAttempt, sim.get(`S:ENG${n}_START_ATTEMPT`));
    }
    const g = sim.services.ground as { status?: () => { walkaround: { state: string; beforePower: boolean | null } } } | undefined;
    const wk = g?.status?.().walkaround;
    if (wk && wk.state === 'done' && !this.rec.walkaround.done) this.rec.walkaround = { done: true, beforePower: wk.beforePower, t };

    if (sim.getB('S:ENG1_RUNNING') && sim.getB('S:ENG2_RUNNING')) {
      this.bothFor += dt;
      if (this.bothFor >= this.delay) this.complete();
    } else this.bothFor = 0;
  }

  private snapshot(sim: Sim): Snapshot {
    const s: Snapshot = {};
    for (const v of SNAP_VARS) s[v] = sim.get(v);
    return s;
  }

  markChecklist(id: string, complete: boolean): void {
    if (complete) {
      if (this.rec.checklists[id] === undefined) this.rec.checklists[id] = this.elapsed();
    } else delete this.rec.checklists[id];
  }

  complete(): void {
    if (this.done) return;
    if (!this.rec.snap) { this.rec.snap = this.snapshot(this.sim); this.rec.firstStartT = this.elapsed(); }
    const ecam = this.sim.services.ecam as { activeWarnings?: () => Array<{ text: string; level: number }> } | undefined;
    try { this.rec.ecam = (ecam?.activeWarnings?.() ?? []).map((w) => ({ text: w.text, level: w.level })); } catch { this.rec.ecam = []; }
    const items = evaluate(this.rec);
    this.done = {
      elapsedS: this.elapsed(),
      items,
      score: items.filter((i) => i.ok).length,
      total: items.length,
      ecam: this.rec.ecam.map((w) => w.text.trim()),
    };
    for (const l of this.listeners) { try { l(this.done); } catch (e) { console.error('[game] listener', e); } }
    this.sim.emit('game:complete', this.done);
  }

  result(): GameResult | null {
    return this.done;
  }

  onComplete(fn: (r: GameResult) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function installGame(sim: Sim): GameService {
  const m = new GameMonitor(sim);
  sim.register(m);
  const svc: GameService = {
    state: () => (m.result() ? 'complete' : 'running'),
    result: () => m.result(),
    elapsed: () => m.elapsed(),
    begin: () => m.begin(),
    markChecklist: (id, c) => m.markChecklist(id, c),
    forceComplete: () => m.complete(),
    record: () => m.rec,
    onComplete: (fn) => m.onComplete(fn),
  };
  sim.services.game = svc;
  return svc;
}

/** "1 h 04 min 12 s" style duration (French). */
export function formatDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min ${String(sec).padStart(2, '0')} s`;
  if (m) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}
