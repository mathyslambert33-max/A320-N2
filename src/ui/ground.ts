/**
 * Ground services at LFBD stand 14 (owner: ui) — DOM-free, runs in vitest and in the headless app.
 *
 * Owns the ground `G:` variables (see docs/vars/ui.md): GPU (`G:GND_EXT_PWR`, `G:GND_GPU_CABLE`), jet bridge
 * (`G:JETBRIDGE` 0..1), doors (`G:DOOR_PAX_L1/L2/R1/R2`, `G:DOOR_CARGO_FWD/AFT/BULK` 0..1), chocks
 * (`G:GND_CHOCKS`), boarding (`G:BOARDING`, `G:BOARDING_PAX`), cargo loading (`G:CARGO_LOADING`), slides
 * (`G:SLIDES_ARMED`), cabin ready (`G:CABIN_READY`), refuelling (`G:REFUELING`, `G:GND_FUEL_TRUCK`), air start
 * unit (`G:GND_AIR_START_UNIT`) and the mechanic's start clearance (`G:GND_START_CLEARANCE`).
 *
 * Requests come from the EFB through `sim.services.ground` and are answered by the ground crew / cabin crew
 * with French messages (`ground:message` event + `messages()` log). Operations take realistic times, measured in
 * sim time (they stop while the sim is paused). Values written by somebody else (tests, dev scenarios) are
 * adopted: a variable is only rewritten while this module animates it or when its own state changes.
 */
import type { Sim, SimSystem } from '../core/sim';
import { SCENARIO } from '../core/scenario';
import type { GroundPace } from './prefs';

export type DoorId = 'PAX_L1' | 'PAX_L2' | 'PAX_R1' | 'PAX_R2' | 'CARGO_FWD' | 'CARGO_AFT' | 'CARGO_BULK';
export const DOOR_IDS: readonly DoorId[] = ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2', 'CARGO_FWD', 'CARGO_AFT', 'CARGO_BULK'];
export const PAX_DOORS: readonly DoorId[] = ['PAX_L1', 'PAX_L2', 'PAX_R1', 'PAX_R2'];
export const DOOR_NAMES: Record<DoorId, string> = {
  PAX_L1: 'porte L1', PAX_L2: 'porte L2', PAX_R1: 'porte R1', PAX_R2: 'porte R2',
  CARGO_FWD: 'soute AV', CARGO_AFT: 'soute AR', CARGO_BULK: 'soute vrac',
};

export type Speaker = 'mech' | 'purser' | 'ramp' | 'bridge' | 'fuel' | 'agent' | 'fo';
export const SPEAKERS: Record<Speaker, string> = {
  mech: 'Mécanicien',
  purser: 'Chef de cabine',
  ramp: 'Agent de piste',
  bridge: 'Opérateur passerelle',
  fuel: 'Avitailleur',
  agent: "Agent d'escale",
  fo: 'Copilote',
};

export interface GroundMessage {
  id: number;
  /** Sim time (s). */
  t: number;
  /** UTC time of day (s), from G:TIME_UTC. */
  utc: number;
  from: Speaker;
  text: string;
  level: 'info' | 'ok' | 'warn';
  /** A crew call to the cockpit (the UI sounds the call buzzer). */
  call?: boolean;
}

export interface GroundResult {
  ok: boolean;
  msg: string;
}

type Link = 'connected' | 'disconnected' | 'connecting' | 'disconnecting';

export interface MoverStatus { pos: number; target: number; moving: boolean }

export interface GroundStatus {
  pace: GroundPace;
  gpu: { state: Link; cable: boolean; power: boolean };
  jetbridge: MoverStatus;
  doors: Record<DoorId, MoverStatus>;
  chocks: 'in' | 'out' | 'removing' | 'placing';
  boarding: { state: 'waiting' | 'boarding' | 'complete'; pax: number; total: number; progress: number };
  loading: { state: 'loading' | 'paused' | 'complete'; progress: number; kg: number };
  slides: 'armed' | 'disarmed' | 'arming' | 'disarming';
  cabinReady: boolean;
  refuel: { state: 'idle' | 'arriving' | 'refueling' | 'leaving' | 'done'; progress: number };
  asu: Link;
  walkaround: { state: 'todo' | 'doing' | 'done'; beforePower: boolean | null };
  clearance: 'none' | 'pending' | 'granted' | 'denied';
  loadsheetFinal: boolean;
  enginesTurning: boolean;
}

/** Durations in seconds: [real pace, fast pace]. Mechanical motions (doors, bridge travel) are not scaled. */
const DUR = {
  greeting: [5, 5],
  gpuCable: [30, 9],
  gpuStart: [42, 13],
  gpuStop: [4, 3],
  gpuUnplug: [24, 9],
  chocks: [15, 6],
  bridgeDelay: [8, 4],
  paxDoorDelay: [5, 2],
  cargoDelay: [12, 4],
  loadingStart: [20, 8],
  loading: [540, 150],
  cargoAutoClose: [25, 8],
  boarding: [660, 180],
  slides: [22, 8],
  cabinSecure: [90, 25],
  fuelTruck: [75, 15],
  refuel: [240, 60],
  fuelLeave: [25, 10],
  asuConnect: [50, 15],
  asuDisconnect: [25, 10],
  walkaround: [150, 30],
  clearanceReply: [5, 3],
  chocksAtClearance: [12, 5],
} satisfies Record<string, [number, number]>;

/** Travel times (s) for a full 0↔1 motion. */
const TRAVEL = { paxDoor: 7, cargoDoor: 18, bulkDoor: 6, bridgeRetract: 40, bridgeDock: 55 };

interface Mover {
  v: string;
  pos: number;
  target: number;
  rate: number;
  delay: number;
  written: number;
  done: (() => void) | null;
}

interface Task { at: number; fn: () => void; tag: string }

const ENG_TURNING_STATES = new Set([1, 2, 3, 4]);
const PAX_TOTAL: number = SCENARIO.weights.pax;
const CARGO_KG: number = SCENARIO.weights.cargo;

export class GroundServices implements SimSystem {
  readonly name = 'ui.ground';
  readonly order = 5;
  private sim: Sim;
  private t = 0;
  private paceV: GroundPace = 'real';
  private tasks: Task[] = [];
  private log: GroundMessage[] = [];
  private listeners = new Set<(m: GroundMessage) => void>();
  private nextId = 1;
  private written = new Map<string, number>();
  private movers = new Map<string, Mover>();
  private initialised = false;

  private gpuV: Link = 'connected';
  private asu: Link = 'disconnected';
  private chocksV: GroundStatus['chocks'] = 'in';
  private slidesV: GroundStatus['slides'] = 'disarmed';
  private boardingState: GroundStatus['boarding']['state'] = 'waiting';
  private boardingProg = 0;
  private boardingHalfSaid = false;
  private loadingState: GroundStatus['loading']['state'] = 'loading';
  private loadingProg = 0;
  private loadingStarted = false;
  private cabinReady = false;
  private cabinTimer = 0;
  private refuelState: GroundStatus['refuel']['state'] = 'idle';
  private refuelProg = 0;
  private walk: GroundStatus['walkaround'] = { state: 'todo', beforePower: null };
  private clearanceV: GroundStatus['clearance'] = 'none';
  private engPrev = [0, 0, 0];
  private runPrev = [0, 0, 0];
  private bothRunningSaid = false;
  private lastCallReply = -100;

  constructor(sim: Sim, opts: { pace?: GroundPace } = {}) {
    this.sim = sim;
    if (opts.pace) this.paceV = opts.pace;
    for (const d of DOOR_IDS) this.movers.set(`G:DOOR_${d}`, this.mover(`G:DOOR_${d}`));
    this.movers.set('G:JETBRIDGE', this.mover('G:JETBRIDGE'));
    // Crew calls from the overhead CALLS panel.
    sim.on('calls:mech', () => this.callReply('mech', 'Oui commandant, je vous écoute.'));
    for (const id of ['CALLS_FWD', 'CALLS_ALL']) sim.on(`${id}:press`, () => this.callReply('purser', 'Oui commandant ?'));
  }

  /* ------------------------------------------------------------------ helpers */

  private d(k: keyof typeof DUR): number {
    return DUR[k][this.paceV === 'fast' ? 1 : 0];
  }

  private mover(v: string): Mover {
    const x = this.sim.get(v);
    return { v, pos: x, target: x, rate: 0.1, delay: 0, written: x, done: null };
  }

  private put(v: string, x: number): void {
    this.sim.set(v, x);
    this.written.set(v, x);
  }

  /** The variable was changed by somebody else since we last wrote it. */
  private externallyChanged(v: string): boolean {
    const w = this.written.get(v);
    return w !== undefined && this.sim.get(v) !== w;
  }

  private later(delay: number, tag: string, fn: () => void): void {
    this.tasks.push({ at: this.t + delay, fn, tag });
  }

  private cancel(tag: string): void {
    this.tasks = this.tasks.filter((k) => k.tag !== tag);
  }

  private pending(tag: string): boolean {
    return this.tasks.some((k) => k.tag === tag);
  }

  private say(from: Speaker, text: string, level: GroundMessage['level'] = 'info', call = false): string {
    const m: GroundMessage = { id: this.nextId++, t: this.t, utc: this.sim.get('G:TIME_UTC'), from, text, level, call };
    this.log.push(m);
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
    for (const l of this.listeners) { try { l(m); } catch (e) { console.error('[ground] listener', e); } }
    this.sim.emit('ground:message', m);
    return text;
  }

  private ok(from: Speaker, text: string): GroundResult {
    return { ok: true, msg: this.say(from, text) };
  }

  private refuse(from: Speaker, text: string): GroundResult {
    return { ok: false, msg: this.say(from, text, 'warn') };
  }

  private info(text: string): GroundResult {
    return { ok: false, msg: text };
  }

  private move(v: string, target: number, travel: number, delay: number, done: (() => void) | null): void {
    const m = this.movers.get(v)!;
    m.target = target;
    m.rate = 1 / travel;
    m.delay = delay;
    m.done = done;
  }

  private doorPos(d: DoorId): number {
    return this.movers.get(`G:DOOR_${d}`)!.pos;
  }

  private doorMoving(d: DoorId): boolean {
    const m = this.movers.get(`G:DOOR_${d}`)!;
    return m.pos !== m.target;
  }

  private doorClosed(d: DoorId): boolean {
    return this.doorPos(d) <= 0 && !this.doorMoving(d);
  }

  private bridge(): Mover {
    return this.movers.get('G:JETBRIDGE')!;
  }

  private enginesTurning(): boolean {
    const s = this.sim;
    for (const n of [1, 2]) {
      if (s.getB(`S:ENG${n}_RUNNING`) || ENG_TURNING_STATES.has(s.get(`S:ENG${n}_STATE`)) || s.get(`S:ENG${n}_N2`) > 5) return true;
    }
    return false;
  }

  private batteriesOn(): boolean {
    return this.sim.getB('C:ELEC_BAT1') || this.sim.getB('C:ELEC_BAT2');
  }

  private openDoorsList(): DoorId[] {
    return DOOR_IDS.filter((d) => this.doorPos(d) > 0.001 || this.movers.get(`G:DOOR_${d}`)!.target > 0);
  }

  private listFr(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
  }

  private callReply(from: Speaker, text: string): void {
    if (this.t - this.lastCallReply < 6) return;
    this.lastCallReply = this.t;
    this.later(1.5, 'call', () => this.say(from, text));
  }

  /* ------------------------------------------------------------------ public API */

  pace(): GroundPace { return this.paceV; }

  setPace(p: GroundPace): void { this.paceV = p; }

  messages(): readonly GroundMessage[] { return this.log; }

  onMessage(fn: (m: GroundMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** GPU (ground power unit) connection. */
  gpu(connect: boolean): GroundResult {
    if (connect) {
      if (this.gpuV === 'connected') return this.info('Le GPU est déjà branché.');
      if (this.gpuV === 'connecting') return this.info('Branchement du GPU en cours.');
      this.cancel('gpu');
      this.gpuV = 'connecting';
      this.later(this.d('gpuCable'), 'gpu', () => this.put('G:GND_GPU_CABLE', 1));
      this.later(this.d('gpuStart'), 'gpu', () => {
        this.gpuV = 'connected';
        this.put('G:GND_EXT_PWR', 1);
        this.clearanceLost();
        this.say('mech', 'GPU branché et démarré, vous avez EXT PWR AVAIL.', 'ok');
      });
      return this.ok('mech', 'Bien reçu, je branche le GPU.');
    }
    if (this.gpuV === 'disconnected') return this.info('Le GPU est déjà débranché.');
    if (this.gpuV === 'disconnecting') return this.info('Débranchement du GPU en cours.');
    if (this.sim.getB('S:ELEC_EXT_PWR_ON')) {
      return this.refuse('mech', "Négatif, l'avion est encore alimenté par le GPU. Coupez EXT PWR et je débranche.");
    }
    this.cancel('gpu');
    this.gpuV = 'disconnecting';
    this.later(this.d('gpuStop'), 'gpu', () => this.put('G:GND_EXT_PWR', 0));
    this.later(this.d('gpuUnplug'), 'gpu', () => {
      this.gpuV = 'disconnected';
      this.put('G:GND_EXT_PWR', 0);
      this.put('G:GND_GPU_CABLE', 0);
      this.say('mech', 'GPU coupé et débranché, câble rangé.', 'ok');
    });
    return this.ok('mech', 'Bien reçu, je coupe le GPU et je débranche.');
  }

  /** Jet bridge at door L1: dock (true) or retract (false). */
  jetbridge(dock: boolean): GroundResult {
    const b = this.bridge();
    if (dock) {
      if (b.pos >= 1 && b.target >= 1) return this.info('La passerelle est déjà accostée.');
      if (b.target >= 1) return this.info('Accostage de la passerelle en cours.');
      if (this.enginesTurning()) return this.refuse('bridge', 'Moteurs en marche : accostage de la passerelle impossible.');
      this.move('G:JETBRIDGE', 1, TRAVEL.bridgeDock, this.d('bridgeDelay'), () => this.say('bridge', 'Passerelle accostée à la porte L1.', 'ok'));
      return this.ok('bridge', 'Bien reçu, accostage de la passerelle à la porte L1.');
    }
    if (b.pos <= 0 && b.target <= 0) return this.info('La passerelle est déjà retirée.');
    if (b.target <= 0) return this.info('Retrait de la passerelle en cours.');
    if (!this.doorClosed('PAX_L1')) {
      return this.refuse('bridge', 'La porte L1 est encore ouverte : je ne peux pas retirer la passerelle. Faites fermer la porte d’abord.');
    }
    this.move('G:JETBRIDGE', 0, TRAVEL.bridgeRetract, this.d('bridgeDelay'), () => this.say('bridge', 'Passerelle retirée, zone dégagée.', 'ok'));
    return this.ok('bridge', 'Bien reçu, retrait de la passerelle.');
  }

  /** Open (true) or close (false) a door. */
  door(id: DoorId, open: boolean): GroundResult {
    if (!DOOR_IDS.includes(id)) return this.info(`Porte inconnue : ${id}`);
    const v = `G:DOOR_${id}`;
    const m = this.movers.get(v)!;
    const name = DOOR_NAMES[id];
    const Name = name.charAt(0).toUpperCase() + name.slice(1);
    const pax = PAX_DOORS.includes(id);
    const bulk = id === 'CARGO_BULK';
    if (open) {
      if (m.target >= 1) return this.info(m.pos >= 1 ? `La ${name} est déjà ouverte.` : `Ouverture de la ${name} en cours.`);
      if (pax) {
        if (this.slidesV !== 'disarmed') return this.refuse('purser', `Les toboggans sont armés : je n'ouvre pas la ${name}. Demandez d'abord le désarmement.`);
        if (this.enginesTurning()) return this.refuse('purser', `Moteurs en marche : pas d'ouverture de la ${name}.`);
        if (id === 'PAX_L1' && (this.bridge().pos < 1 || this.bridge().target < 1)) {
          return this.refuse('purser', "Il n'y a pas de passerelle à la porte L1, je ne l'ouvre pas.");
        }
        this.cabinReset();
        this.move(v, 1, TRAVEL.paxDoor, this.d('paxDoorDelay'), () => this.say('purser', `${Name} ouverte.`));
        return this.ok('purser', `J'ouvre la ${name}.`);
      }
      if (this.enginesTurning()) return this.refuse('ramp', 'Moteurs en marche : personne ne s’approche des soutes.');
      this.move(v, 1, bulk ? TRAVEL.bulkDoor : TRAVEL.cargoDoor, this.d('cargoDelay'), () => this.say('ramp', `${Name} ouverte.`));
      this.clearanceLost();
      return this.ok('ramp', `J'ouvre la ${name}.`);
    }
    if (m.target <= 0) return this.info(m.pos <= 0 ? `La ${name} est déjà fermée.` : `Fermeture de la ${name} en cours.`);
    if (id === 'PAX_L1' && this.boardingState === 'boarding') {
      return this.refuse('purser', `Embarquement en cours (${this.boardingPax()}/${PAX_TOTAL}) : on ne ferme pas la porte L1 maintenant.`);
    }
    if ((id === 'CARGO_FWD' || id === 'CARGO_AFT') && this.loadingState !== 'complete') {
      return this.refuse('ramp', `Chargement des soutes en cours (${Math.round(this.loadingProg * 100)} %) : je fermerai dès qu'il sera terminé.`);
    }
    if (pax) {
      this.move(v, 0, TRAVEL.paxDoor, this.d('paxDoorDelay'), () => this.say('purser', `${Name} fermée et verrouillée.`, 'ok'));
      return this.ok('purser', `Je ferme la ${name}.`);
    }
    this.move(v, 0, bulk ? TRAVEL.bulkDoor : TRAVEL.cargoDoor, this.d('cargoDelay'), () => this.say('ramp', `${Name} fermée et verrouillée.`, 'ok'));
    return this.ok('ramp', `Je ferme la ${name}.`);
  }

  /** Place (true) or remove (false) the wheel chocks. */
  chocks(inPlace: boolean): GroundResult {
    if (inPlace) {
      if (this.chocksV === 'in' || this.chocksV === 'placing') return this.info('Les cales sont en place.');
      this.cancel('chocks');
      this.chocksV = 'placing';
      this.later(this.d('chocks'), 'chocks', () => {
        this.chocksV = 'in';
        this.put('G:GND_CHOCKS', 1);
        this.clearanceLost();
        this.say('mech', 'Cales en place.', 'ok');
      });
      return this.ok('mech', 'Je mets les cales.');
    }
    if (this.chocksV === 'out' || this.chocksV === 'removing') return this.info('Les cales sont déjà retirées.');
    if (this.sim.get('C:PARK_BRK') < 0.5) {
      return this.refuse('mech', "Le frein de parc n'est pas serré : je laisse les cales. Serrez le frein de parc.");
    }
    this.removeChocks(() => this.say('mech', 'Parc freiné, cales retirées.', 'ok'), this.d('chocks'));
    return this.ok('mech', 'Parc freiné ? Bien reçu, je retire les cales.');
  }

  private removeChocks(done: () => void, delay: number): void {
    this.cancel('chocks');
    this.chocksV = 'removing';
    this.later(delay, 'chocks', () => {
      this.chocksV = 'out';
      this.put('G:GND_CHOCKS', 0);
      done();
    });
  }

  /** Authorise passenger boarding. */
  boarding(): GroundResult {
    if (this.boardingState === 'boarding') return this.info(`Embarquement en cours : ${this.boardingPax()}/${PAX_TOTAL}.`);
    if (this.boardingState === 'complete') return this.info('Embarquement terminé.');
    if (this.doorPos('PAX_L1') < 1 || this.bridge().pos < 1) {
      return this.refuse('purser', "Pour embarquer, il faut la passerelle accostée et la porte L1 ouverte.");
    }
    this.boardingState = 'boarding';
    this.put('G:BOARDING', 0);
    this.put('G:BOARDING_PAX', 0);
    return this.ok('purser', "Bien reçu commandant, je préviens l'escale : l'embarquement commence.");
  }

  /** Arm (true) or disarm (false) the door slides. */
  slides(arm: boolean): GroundResult {
    if (arm) {
      if (this.slidesV === 'armed' || this.slidesV === 'arming') return this.info('Les toboggans sont armés.');
      const open = PAX_DOORS.filter((d) => !this.doorClosed(d)).map((d) => d.slice(4));
      if (open.length) return this.refuse('purser', `Toutes les portes passagers doivent être fermées pour armer les toboggans (ouverte : ${this.listFr(open)}).`);
      this.cancel('slides');
      this.slidesV = 'arming';
      this.later(this.d('slides'), 'slides', () => {
        this.slidesV = 'armed';
        this.put('G:SLIDES_ARMED', 1);
        this.say('purser', 'Toboggans armés, cross-check effectué.', 'ok', true);
      });
      return this.ok('purser', 'PNC, armement des toboggans, cross-check !');
    }
    if (this.slidesV === 'disarmed' || this.slidesV === 'disarming') return this.info('Les toboggans sont désarmés.');
    this.cancel('slides');
    this.slidesV = 'disarming';
    this.later(this.d('slides'), 'slides', () => {
      this.slidesV = 'disarmed';
      this.put('G:SLIDES_ARMED', 0);
      this.say('purser', 'Toboggans désarmés, cross-check effectué.', 'ok', true);
    });
    return this.ok('purser', 'PNC, désarmement des toboggans, cross-check !');
  }

  /** Start (true) or interrupt (false) a refuelling session (the requested block fuel is already on board). */
  refuel(start: boolean): GroundResult {
    if (start) {
      if (this.refuelState === 'arriving' || this.refuelState === 'refueling') return this.info('Avitaillement en cours.');
      if (this.enginesTurning()) return this.refuse('fuel', "Pas d'avitaillement moteurs en marche.");
      this.cancel('refuel');
      this.refuelState = 'arriving';
      this.refuelProg = 0;
      this.later(this.d('fuelTruck'), 'refuel', () => {
        this.put('G:GND_FUEL_TRUCK', 1);
        this.put('G:REFUELING', 1);
        this.refuelState = 'refueling';
        this.clearanceLost();
        this.say('fuel', 'Camion en place, flexible branché : début de l’avitaillement.');
      });
      const fob = SCENARIO.weights.blockFuel;
      return this.ok('fuel', `Bien reçu, j'arrive pour compléter à ${fob.toLocaleString('fr-FR')} kg.`);
    }
    if (this.refuelState !== 'arriving' && this.refuelState !== 'refueling') return this.info("Pas d'avitaillement en cours.");
    this.cancel('refuel');
    this.endRefuel('Avitaillement interrompu à votre demande, flexible débranché.');
    return { ok: true, msg: 'Interruption de l’avitaillement demandée.' };
  }

  private endRefuel(text: string): void {
    this.put('G:REFUELING', 0);
    const truck = this.sim.get('G:GND_FUEL_TRUCK') > 0;
    this.refuelState = truck ? 'leaving' : 'idle';
    this.say('fuel', text, 'ok');
    if (truck) {
      this.later(this.d('fuelLeave'), 'refuel', () => {
        this.put('G:GND_FUEL_TRUCK', 0);
        this.refuelState = 'done';
      });
    }
  }

  /** Air start unit (HP ground air cart). */
  airStartUnit(connect: boolean): GroundResult {
    if (connect) {
      if (this.asu === 'connected' || this.asu === 'connecting') return this.info('Groupe de démarrage déjà branché.');
      this.cancel('asu');
      this.asu = 'connecting';
      this.later(this.d('asuConnect'), 'asu', () => {
        this.asu = 'connected';
        this.put('G:GND_AIR_START_UNIT', 1);
        this.say('mech', 'Groupe de démarrage (ASU) branché, pression d’air disponible.', 'ok');
      });
      return this.ok('mech', 'Bien reçu, j’amène le groupe de démarrage.');
    }
    if (this.asu === 'disconnected' || this.asu === 'disconnecting') return this.info('Pas de groupe de démarrage branché.');
    this.cancel('asu');
    this.asu = 'disconnecting';
    this.put('G:GND_AIR_START_UNIT', 0);
    this.later(this.d('asuDisconnect'), 'asu', () => {
      this.asu = 'disconnected';
      this.say('mech', 'Groupe de démarrage débranché et dégagé.', 'ok');
    });
    return this.ok('mech', 'Je coupe et je débranche le groupe de démarrage.');
  }

  /** Safety exterior inspection (walk-around) — the report comes back as a message. */
  walkaround(): GroundResult {
    if (this.walk.state === 'doing') return this.info('Tour avion en cours.');
    this.walk = { state: 'doing', beforePower: !this.batteriesOn() };
    this.cancel('walk');
    this.later(this.d('walkaround'), 'walk', () => {
      this.walk = { ...this.walk, state: 'done' };
      this.say('fo', this.walkReport(), 'ok');
    });
    return this.ok('fo', "Je descends faire le tour de sécurité de l'avion.");
  }

  private walkReport(): string {
    const parts: string[] = ['Tour de sécurité terminé :'];
    parts.push(this.sim.get('G:GND_CHOCKS') > 0 ? 'cales en place' : 'cales retirées');
    parts.push(this.gpuV === 'connected' ? 'GPU branché' : this.gpuV === 'disconnected' ? 'pas de GPU' : 'GPU en cours de manœuvre');
    const b = this.bridge().pos;
    parts.push(b >= 1 ? 'passerelle accostée à L1' : b <= 0 ? 'passerelle retirée' : 'passerelle en mouvement');
    const open = this.openDoorsList().map((d) => DOOR_NAMES[d]);
    parts.push(open.length ? `ouvert : ${this.listFr(open)}` : 'toutes portes et soutes fermées');
    if (this.loadingState !== 'complete') parts.push('chargement des soutes en cours');
    if (this.sim.get('G:GND_FUEL_TRUCK') > 0) parts.push('avitailleur en place');
    parts.push('trains, trappes, sondes et pneus RAS, zone des moteurs et des gouvernes dégagée.');
    return parts.join(', ').replace('terminé :,', 'terminé :');
  }

  /** Ask the mechanic (headset) for the engine start clearance. */
  startClearance(): GroundResult {
    if (this.clearanceV === 'pending') return this.info('Demande en cours auprès du mécanicien.');
    this.clearanceV = 'pending';
    this.cancel('clearance');
    this.later(this.d('clearanceReply'), 'clearance', () => this.evaluateClearance());
    return { ok: true, msg: 'Sol, du poste : prêts pour la mise en route ?' };
  }

  private evaluateClearance(): void {
    const deny = (text: string) => {
      this.clearanceV = 'denied';
      this.put('G:GND_START_CLEARANCE', 0);
      this.say('mech', text, 'warn');
    };
    if (this.gpuV !== 'disconnected' || this.sim.get('G:GND_GPU_CABLE') > 0) return deny('Négatif, le GPU est encore branché.');
    if (this.bridge().pos > 0 || this.bridge().target > 0) return deny('Négatif, la passerelle est encore accostée.');
    const open = this.openDoorsList().map((d) => DOOR_NAMES[d]);
    if (open.length) return deny(`Négatif, ${open.length > 1 ? 'encore ouvertes' : 'encore ouverte'} : ${this.listFr(open)}.`);
    if (this.refuelState === 'arriving' || this.refuelState === 'refueling' || this.sim.get('G:GND_FUEL_TRUCK') > 0) {
      return deny("Négatif, l'avitailleur est encore là.");
    }
    const grant = (text: string) => {
      this.clearanceV = 'granted';
      this.put('G:GND_START_CLEARANCE', 1);
      this.say('mech', text, 'ok', true);
    };
    const asu = this.asu === 'connected' ? ' Groupe de démarrage branché.' : '';
    if (this.chocksV === 'removing') {
      this.later(3, 'clearance', () => this.evaluateClearance());
      return;
    }
    if (this.chocksV === 'in' || this.chocksV === 'placing') {
      if (this.sim.get('C:PARK_BRK') < 0.5) return deny("Le frein de parc n'est pas serré : je garde les cales. Rappelez-moi quand il sera serré.");
      this.say('mech', 'Parc freiné ? Bien reçu, je retire les cales.');
      this.removeChocks(() => grant(`Parc freiné, cales retirées, zone dégagée : prêt pour la mise en route.${asu}`), this.d('chocksAtClearance'));
      return;
    }
    grant(`Zone dégagée, prêt pour la mise en route.${asu}`);
  }

  private clearanceLost(): void {
    if (this.clearanceV === 'granted') {
      this.clearanceV = 'none';
      this.put('G:GND_START_CLEARANCE', 0);
    }
  }

  private cabinReset(): void {
    this.cabinTimer = 0;
    if (this.cabinReady) {
      this.cabinReady = false;
      this.put('G:CABIN_READY', 0);
    }
  }

  private boardingPax(): number {
    return Math.round(this.boardingProg * PAX_TOTAL);
  }

  status(): GroundStatus {
    const mv = (v: string): MoverStatus => {
      const m = this.movers.get(v)!;
      return { pos: m.pos, target: m.target, moving: m.pos !== m.target };
    };
    const doors = {} as Record<DoorId, MoverStatus>;
    for (const d of DOOR_IDS) doors[d] = mv(`G:DOOR_${d}`);
    return {
      pace: this.paceV,
      gpu: { state: this.gpuV, cable: this.sim.get('G:GND_GPU_CABLE') > 0, power: this.sim.get('G:GND_EXT_PWR') > 0 },
      jetbridge: mv('G:JETBRIDGE'),
      doors,
      chocks: this.chocksV,
      boarding: { state: this.boardingState, pax: this.boardingPax(), total: PAX_TOTAL, progress: this.boardingProg },
      loading: { state: this.loadingState, progress: this.loadingProg, kg: Math.round(this.loadingProg * CARGO_KG) },
      slides: this.slidesV,
      cabinReady: this.cabinReady,
      refuel: { state: this.refuelState, progress: this.refuelProg },
      asu: this.asu,
      walkaround: { ...this.walk },
      clearance: this.clearanceV,
      loadsheetFinal: this.boardingState === 'complete' && this.loadingState === 'complete',
      enginesTurning: this.enginesTurning(),
    };
  }

  /** Debug / dev scenarios: jump to a state instantly. */
  readonly debug = {
    finishBoarding: () => { if (this.boardingState !== 'complete') { this.boardingState = 'boarding'; this.boardingProg = 1; } },
    finishLoading: () => { this.loadingStarted = true; this.loadingProg = 1; },
    /** Everything ready for the engine start (doors closed, bridge and GPU away, chocks out, slides armed, cabin ready). */
    gateReady: () => {
      this.tasks = [];
      this.boardingState = 'complete'; this.boardingProg = 1;
      this.put('G:BOARDING', 1); this.put('G:BOARDING_PAX', PAX_TOTAL);
      this.loadingStarted = true; this.loadingState = 'complete'; this.loadingProg = 1; this.put('G:CARGO_LOADING', 0);
      for (const [v, m] of this.movers) { m.pos = m.target = 0; m.done = null; m.delay = 0; this.put(v, 0); m.written = 0; }
      this.gpuV = 'disconnected'; this.put('G:GND_EXT_PWR', 0); this.put('G:GND_GPU_CABLE', 0);
      this.chocksV = 'out'; this.put('G:GND_CHOCKS', 0);
      this.slidesV = 'armed'; this.put('G:SLIDES_ARMED', 1);
      this.cabinReady = true; this.put('G:CABIN_READY', 1);
      this.clearanceV = 'granted'; this.put('G:GND_START_CLEARANCE', 1);
      this.walk = { state: 'done', beforePower: true };
    },
  };

  /* ------------------------------------------------------------------ system */

  init(sim: Sim): void {
    this.sim = sim;
    for (const [v, m] of this.movers) {
      const x = sim.get(v);
      m.pos = m.target = m.written = x;
    }
    const b = (v: string) => sim.get(v) > 0;
    this.gpuV = b('G:GND_EXT_PWR') ? 'connected' : 'disconnected';
    this.put('G:GND_GPU_CABLE', this.gpuV === 'connected' ? 1 : 0);
    this.written.set('G:GND_EXT_PWR', sim.get('G:GND_EXT_PWR'));
    this.chocksV = b('G:GND_CHOCKS') ? 'in' : 'out';
    this.written.set('G:GND_CHOCKS', sim.get('G:GND_CHOCKS'));
    this.asu = b('G:GND_AIR_START_UNIT') ? 'connected' : 'disconnected';
    this.written.set('G:GND_AIR_START_UNIT', sim.get('G:GND_AIR_START_UNIT'));
    this.slidesV = b('G:SLIDES_ARMED') ? 'armed' : 'disarmed';
    this.put('G:SLIDES_ARMED', this.slidesV === 'armed' ? 1 : 0);
    this.cabinReady = b('G:CABIN_READY');
    this.put('G:CABIN_READY', this.cabinReady ? 1 : 0);
    this.put('G:REFUELING', b('G:REFUELING') ? 1 : 0);
    this.put('G:GND_FUEL_TRUCK', b('G:REFUELING') ? 1 : 0);
    if (b('G:REFUELING')) this.refuelState = 'refueling';
    this.put('G:BOARDING', 0);
    this.put('G:BOARDING_PAX', 0);
    this.put('G:CARGO_LOADING', 0);
    this.put('G:GND_START_CLEARANCE', 0);
    // Opening lines once the game runs.
    this.later(this.d('greeting'), 'greet', () => {
      if (this.boardingState === 'waiting') {
        this.say('purser', "Bonjour commandant ! La cabine est prête pour l'embarquement, j'attends votre accord (EFB › Services sol).", 'info', true);
      }
    });
    this.later(this.d('greeting') + 9, 'greet', () => {
      const chocks = sim.get('G:GND_CHOCKS') > 0 ? 'cales en place' : 'cales retirées';
      const gpu = this.gpuV === 'connected' ? ', GPU branché' : '';
      this.say('mech', `Bonjour commandant ! ${chocks.charAt(0).toUpperCase() + chocks.slice(1)}${gpu}. Je reste au casque sous le nez de l'avion.`);
    });
    this.initialised = true;
  }

  update(dt: number, sim: Sim): void {
    if (!this.initialised) this.init(sim);
    this.t += dt;
    this.adoptExternal(sim);

    // scheduled tasks
    if (this.tasks.length) {
      const due = this.tasks.filter((k) => k.at <= this.t);
      if (due.length) {
        this.tasks = this.tasks.filter((k) => k.at > this.t);
        for (const k of due) { try { k.fn(); } catch (e) { console.error('[ground] task', e); } }
      }
    }

    // movers (doors, jet bridge)
    for (const [v, m] of this.movers) {
      if (m.pos === m.target) continue;
      if (m.delay > 0) { m.delay -= dt; continue; }
      const step = m.rate * dt;
      m.pos = Math.abs(m.target - m.pos) <= step + 1e-4 ? m.target : m.pos + Math.sign(m.target - m.pos) * step;
      const x = Math.round(m.pos * 10000) / 10000;
      sim.set(v, x);
      m.written = x;
      if (m.pos === m.target && m.done) { const f = m.done; m.done = null; f(); }
    }
    if (this.bridge().pos > 0 || this.openDoorsList().length) this.clearanceLost();

    this.updateLoading(dt, sim);
    this.updateBoarding(dt);
    this.updateCabin(dt);
    this.updateRefuel(dt);
    this.watchEngines(sim);
  }

  private adoptExternal(sim: Sim): void {
    for (const [v, m] of this.movers) {
      const x = sim.get(v);
      if (x !== m.written) { m.pos = m.target = m.written = x; m.done = null; m.delay = 0; }
    }
    if (this.externallyChanged('G:GND_EXT_PWR')) {
      this.cancel('gpu');
      const on = sim.get('G:GND_EXT_PWR') > 0;
      this.gpuV = on ? 'connected' : 'disconnected';
      this.written.set('G:GND_EXT_PWR', sim.get('G:GND_EXT_PWR'));
      this.put('G:GND_GPU_CABLE', on ? 1 : 0);
    }
    if (this.externallyChanged('G:GND_CHOCKS')) {
      this.cancel('chocks');
      this.chocksV = sim.get('G:GND_CHOCKS') > 0 ? 'in' : 'out';
      this.written.set('G:GND_CHOCKS', sim.get('G:GND_CHOCKS'));
    }
    if (this.externallyChanged('G:GND_AIR_START_UNIT')) {
      this.cancel('asu');
      this.asu = sim.get('G:GND_AIR_START_UNIT') > 0 ? 'connected' : 'disconnected';
      this.written.set('G:GND_AIR_START_UNIT', sim.get('G:GND_AIR_START_UNIT'));
    }
    if (this.externallyChanged('G:SLIDES_ARMED')) {
      this.cancel('slides');
      this.slidesV = sim.get('G:SLIDES_ARMED') > 0 ? 'armed' : 'disarmed';
      this.written.set('G:SLIDES_ARMED', sim.get('G:SLIDES_ARMED'));
    }
    if (this.externallyChanged('G:CABIN_READY')) {
      this.cabinReady = sim.get('G:CABIN_READY') > 0;
      this.written.set('G:CABIN_READY', sim.get('G:CABIN_READY'));
    }
    if (this.externallyChanged('G:REFUELING')) {
      this.cancel('refuel');
      const on = sim.get('G:REFUELING') > 0;
      this.refuelState = on ? 'refueling' : 'idle';
      this.written.set('G:REFUELING', sim.get('G:REFUELING'));
      this.put('G:GND_FUEL_TRUCK', on ? 1 : 0);
    }
  }

  private updateLoading(dt: number, sim: Sim): void {
    if (this.loadingState === 'complete') return;
    if (!this.loadingStarted) {
      if (this.t < this.d('loadingStart')) return;
      this.loadingStarted = true;
      this.say('ramp', 'Chargement des bagages et du fret en cours dans les soutes AV et AR.');
    }
    const open = this.doorPos('CARGO_FWD') >= 1 && this.doorPos('CARGO_AFT') >= 1;
    this.loadingState = open || this.loadingProg >= 1 ? 'loading' : 'paused';
    if (this.loadingState === 'loading' && this.loadingProg < 1) this.loadingProg = Math.min(1, this.loadingProg + dt / this.d('loading'));
    this.put('G:CARGO_LOADING', this.loadingState === 'loading' ? 1 : 0);
    if (this.loadingProg >= 1) {
      this.loadingState = 'complete';
      this.put('G:CARGO_LOADING', 0);
      this.say('ramp', `Chargement terminé : ${CARGO_KG.toLocaleString('fr-FR')} kg en soutes, arrimé. Je ferme les soutes.`, 'ok');
      const close = (d: DoorId, delay: number, last: boolean) => this.later(delay, 'cargo', () => {
        const m = this.movers.get(`G:DOOR_${d}`)!;
        if (m.target <= 0 || sim.getB('S:ENG1_RUNNING') || sim.getB('S:ENG2_RUNNING')) return;
        this.move(`G:DOOR_${d}`, 0, TRAVEL.cargoDoor, 0, last
          ? () => { if (this.doorClosed('CARGO_FWD') && this.doorClosed('CARGO_AFT')) this.say('ramp', 'Soutes AV et AR fermées et verrouillées.', 'ok'); }
          : null);
      });
      close('CARGO_FWD', this.d('cargoAutoClose'), false);
      close('CARGO_AFT', this.d('cargoAutoClose') + TRAVEL.cargoDoor + 4, true);
      this.loadsheetIfReady();
    }
  }

  private updateBoarding(dt: number): void {
    if (this.boardingState !== 'boarding') return;
    // Passengers only flow while the bridge is docked and L1 open.
    if (this.doorPos('PAX_L1') >= 1 && this.bridge().pos >= 1 && this.boardingProg < 1) {
      this.boardingProg = Math.min(1, this.boardingProg + dt / this.d('boarding'));
    }
    const pax = this.boardingPax();
    this.put('G:BOARDING', Math.round(this.boardingProg * 1000) / 1000);
    this.put('G:BOARDING_PAX', pax);
    if (!this.boardingHalfSaid && this.boardingProg >= 0.5) {
      this.boardingHalfSaid = true;
      this.say('purser', `Embarquement à mi-parcours : ${pax} passagers à bord.`);
    }
    if (this.boardingProg >= 1) {
      this.boardingState = 'complete';
      this.say('purser', `Embarquement terminé, ${PAX_TOTAL} passagers à bord. On ferme les portes à votre demande.`, 'ok', true);
      this.loadsheetIfReady();
    }
  }

  private loadsheetIfReady(): void {
    if (this.boardingState === 'complete' && this.loadingState === 'complete') {
      this.later(4, 'loadsheet', () => this.say('agent', 'Devis de masse définitif (LOADSHEET FINAL) transmis sur l’EFB. Bon vol !', 'ok'));
    }
  }

  private updateCabin(dt: number): void {
    const secure = this.boardingState === 'complete' && PAX_DOORS.every((d) => this.doorClosed(d));
    if (!secure) {
      this.cabinTimer = 0;
      if (this.cabinReady && this.boardingState === 'complete') this.cabinReset();
      return;
    }
    if (this.cabinReady) return;
    this.cabinTimer += dt;
    if (this.cabinTimer >= this.d('cabinSecure')) {
      this.cabinReady = true;
      this.put('G:CABIN_READY', 1);
      this.say('purser', 'Commandant, cabine prête : passagers assis, bagages rangés, démonstration de sécurité faite.', 'ok', true);
    }
  }

  private updateRefuel(dt: number): void {
    if (this.refuelState !== 'refueling') return;
    this.refuelProg = Math.min(1, this.refuelProg + dt / this.d('refuel'));
    if (this.refuelProg >= 1) {
      const fob = Math.round(this.sim.get('S:FUEL_FOB_KG') || SCENARIO.weights.blockFuel);
      this.endRefuel(`Avitaillement terminé : ${fob.toLocaleString('fr-FR')} kg à bord, quantité demandée atteinte. Bon de carburant signé.`);
    }
  }

  private watchEngines(sim: Sim): void {
    for (const n of [1, 2]) {
      const st = sim.get(`S:ENG${n}_STATE`);
      const prev = this.engPrev[n];
      this.engPrev[n] = st;
      if ((st === 1 || st === 2) && prev !== 1 && prev !== 2) this.onStartBegin(n);
      const run = sim.get(`S:ENG${n}_RUNNING`);
      if (run && !this.runPrev[n] && st === 3) this.say('mech', `Moteur ${n} démarré, pas de fuite, RAS.`);
      this.runPrev[n] = run;
    }
    const both = sim.getB('S:ENG1_RUNNING') && sim.getB('S:ENG2_RUNNING');
    if (both && !this.bothRunningSaid) {
      this.bothRunningSaid = true;
      this.later(4, 'eng', () => this.say('mech', 'Deux moteurs démarrés, RAS. Je me déconnecte, bon vol !', 'ok'));
    }
  }

  private onStartBegin(n: number): void {
    const probs: string[] = [];
    if (this.bridge().pos > 0) this.say('bridge', `STOP ! Moteur ${n} en rotation avec la passerelle accostée !`, 'warn');
    if (this.sim.get('G:GND_GPU_CABLE') > 0 || this.sim.get('G:GND_EXT_PWR') > 0) probs.push('le GPU est encore branché');
    const open = this.openDoorsList().map((d) => DOOR_NAMES[d]);
    if (open.length) probs.push(`${this.listFr(open)} ${open.length > 1 ? 'encore ouvertes' : 'encore ouverte'}`);
    if (this.sim.get('G:GND_FUEL_TRUCK') > 0 || this.refuelState === 'refueling') {
      this.say('fuel', 'STOP ! Démarrage moteur pendant l’avitaillement !', 'warn');
    }
    if (probs.length) this.say('mech', `Attention, démarrage du moteur ${n} alors que ${this.listFr(probs)} !`, 'warn');
    else if (this.clearanceV !== 'granted') this.say('mech', `Moteur ${n} en rotation… vous ne m'avez pas demandé l'autorisation de mise en route !`, 'warn');
    else this.say('mech', `Rotation moteur ${n}, je surveille.`);
  }
}

/** Service published at `sim.services.ground` (and `app.services.ground`). */
export interface GroundService {
  gpu(connect: boolean): GroundResult;
  /** Alias of gpu() (name used in docs/SIMVARS.md). */
  connectGpu(connect: boolean): GroundResult;
  jetbridge(dock: boolean): GroundResult;
  door(id: DoorId, open: boolean): GroundResult;
  chocks(inPlace: boolean): GroundResult;
  boarding(): GroundResult;
  slides(arm: boolean): GroundResult;
  refuel(start: boolean): GroundResult;
  airStartUnit(connect: boolean): GroundResult;
  walkaround(): GroundResult;
  startClearance(): GroundResult;
  status(): GroundStatus;
  messages(): readonly GroundMessage[];
  onMessage(fn: (m: GroundMessage) => void): () => void;
  pace(): GroundPace;
  setPace(p: GroundPace): void;
  debug: GroundServices['debug'];
  model: GroundServices;
}

export function installGround(sim: Sim, opts: { pace?: GroundPace } = {}): GroundService {
  const g = new GroundServices(sim, opts);
  sim.register(g);
  const svc: GroundService = {
    gpu: (c) => g.gpu(c),
    connectGpu: (c) => g.gpu(c),
    jetbridge: (d) => g.jetbridge(d),
    door: (id, o) => g.door(id, o),
    chocks: (i) => g.chocks(i),
    boarding: () => g.boarding(),
    slides: (a) => g.slides(a),
    refuel: (s) => g.refuel(s),
    airStartUnit: (c) => g.airStartUnit(c),
    walkaround: () => g.walkaround(),
    startClearance: () => g.startClearance(),
    status: () => g.status(),
    messages: () => g.messages(),
    onMessage: (fn) => g.onMessage(fn),
    pace: () => g.pace(),
    setPace: (p) => g.setPace(p),
    debug: g.debug,
    model: g,
  };
  sim.services.ground = svc;
  return svc;
}
