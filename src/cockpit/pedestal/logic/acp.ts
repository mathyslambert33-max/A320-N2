/**
 * Audio Control Panels 1-3 (FCOM DSC-23-30, audio management unit), DOM-free.
 *
 * Per ACP (1 captain / 2 F/O on the pedestal, 3 third occupant on the overhead):
 * - Transmission keys VHF 1/2/3, HF 1/2, INT, CAB, PA (momentary keys): pressing a key selects that channel for
 *   transmission (three green bars), deselects the previous one, and automatically selects its reception.
 *   Pressing the selected key again deselects it. Only one transmission channel per ACP.
 * - Incoming calls: CALL (radios, SELCAL), MECH (INT key: ground mechanic calling the flight deck), ATT (CAB key:
 *   cabin attendant calling) flash amber on every ACP until the crew presses that transmission key or RESET
 *   (or after 60 s). Raised by the event `acp:call` {ch, on?, acp?} (ch = VHF1…PA, or MECH / ATT aliases).
 * - Reception knobs: volume (catalog pot `C:ACPn_RX_<ch>`) + push/pull selection (knob out = reception ON,
 *   integral light): extra control `C:ACPn_RX_<ch>_ON` registered by this module (1 = out).
 * - INT/RAD switch: INT (latched) = interphone hot mike, RAD (spring-loaded) = radio push-to-talk.
 * - VOICE pb: filters the navaid identification (green ON light). RESET pb: cancels the calls.
 * Power: ACP 1 DC ESS, ACP 2 DC 2, ACP 3 DC 1 (AMU channels). Lights need the annunciator supply as well.
 */
import type { Sim } from '../../../core/sim';
import { registerControls, type ControlDef } from '../../../core/catalog';
import { acpPowered, annPower, flash } from './power';

export type TxCh = 'VHF1' | 'VHF2' | 'VHF3' | 'HF1' | 'HF2' | 'INT' | 'CAB' | 'PA';
export const TX: TxCh[] = ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'INT', 'CAB', 'PA'];
export type RxCh = TxCh | 'VOR1' | 'VOR2' | 'MKR' | 'ILS' | 'ADF1' | 'ADF2';
export const RX: RxCh[] = ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2', 'INT', 'CAB', 'PA', 'VOR1', 'VOR2', 'MKR', 'ILS', 'ADF1', 'ADF2'];
export const ACPS = [1, 2, 3] as const;
export type AcpN = (typeof ACPS)[number];

/** Seconds after which an unanswered call stops flashing. */
export const CALL_TIMEOUT = 60;
/** Brightness of a reception knob light (kit legend scale, 1 = annunciator BRT). */
export const RX_LIGHT = 0.35;

/** Reception knobs pulled out at cold & dark (the previous crew left VHF 1 and the interphone selected). */
const RX_DEFAULT_ON: RxCh[] = ['VHF1', 'INT'];

let registered = false;
/** Extra controls: reception knob push/pull state (1 = knob out = reception selected). */
export function registerAcpControls(): void {
  if (registered) return;
  registered = true;
  const list: ControlDef[] = [];
  for (const n of ACPS) {
    for (const k of RX) {
      list.push({
        id: `ACP${n}_RX_${k}_ON`, panel: n === 3 ? 'OVHD_ACP3' : `PED_ACP${n}`, kind: 'pb', name: `${k} reception (knob out)`,
        pos: ['IN (OFF)', 'OUT (ON)'], init: RX_DEFAULT_ON.includes(k) ? 1 : 0, fr: `Écoute ${k} (bouton tiré = écoute)`,
      });
    }
  }
  registerControls(list);
}

/** Map an incoming-call channel name to the transmission key that shows it. */
export function callChannel(ch: string): TxCh | null {
  const c = ch.toUpperCase().replace(/\s+/g, '');
  if (c === 'MECH' || c === 'INT') return 'INT';
  if (c === 'ATT' || c === 'CAB' || c === 'CABIN') return 'CAB';
  return (TX as string[]).includes(c) ? (c as TxCh) : null;
}

export interface AcpUnit {
  n: AcpN;
  tx: TxCh | null;
  /** Remaining time of each active call (s). */
  calls: Map<TxCh, number>;
  powered: boolean;
}

export class AcpModel {
  readonly units: AcpUnit[];

  constructor(private readonly sim: Sim) {
    registerAcpControls();
    this.units = ACPS.map((n) => ({ n, tx: 'VHF1' as TxCh | null, calls: new Map<TxCh, number>(), powered: false }));
    for (const u of this.units) this.wire(u);
    sim.on('acp:call', (p?: { ch?: string; on?: boolean; acp?: number | number[] } | string) => {
      const ch = typeof p === 'string' ? p : p?.ch;
      if (!ch) return;
      const on = typeof p === 'string' ? true : p?.on !== false;
      const which = typeof p === 'string' || p?.acp === undefined ? undefined : Array.isArray(p.acp) ? p.acp : [p.acp];
      this.call(ch, on, which);
    });
  }

  /** Default reception selections (knobs out) — set once so saved states / scenarios can override. */
  init(): void {
    for (const n of ACPS) for (const k of RX) this.sim.init(`C:ACP${n}_RX_${k}_ON`, RX_DEFAULT_ON.includes(k) ? 1 : 0);
  }

  private wire(u: AcpUnit): void {
    const s = this.sim;
    for (const k of TX) s.on(`ACP${u.n}_TX_${k}:press`, () => this.pressTx(u, k));
    s.on(`ACP${u.n}_RESET:press`, () => { if (u.powered) u.calls.clear(); });
  }

  pressTx(u: AcpUnit, k: TxCh): void {
    if (!u.powered) return;
    if (u.calls.has(k)) {
      // answering a call: selects the channel (and cancels the call on this ACP)
      u.calls.delete(k);
      u.tx = k;
    } else u.tx = u.tx === k ? null : k;
  }

  /** Start (or cancel) an incoming call on every ACP (or on the listed ones). */
  call(ch: string, on = true, which?: number[]): void {
    const k = callChannel(ch);
    if (!k) return;
    for (const u of this.units) {
      if (which && !which.includes(u.n)) continue;
      if (on) u.calls.set(k, CALL_TIMEOUT);
      else u.calls.delete(k);
    }
    if (on) this.sim.emit('acp:call_start', { ch: k });
  }

  update(dt: number): void {
    const s = this.sim;
    const ann = annPower(s);
    const fl = flash(s, 1.25);
    for (const u of this.units) {
      const n = u.n;
      u.powered = acpPowered(s, n);
      for (const [k, t] of u.calls) {
        const r = t - dt;
        if (r <= 0) u.calls.delete(k);
        else u.calls.set(k, r);
      }
      const lit = u.powered && ann;
      for (const k of TX) {
        s.set(`L:ACP${n}_TX_${k}`, lit && u.tx === k ? 1 : 0);
        s.set(`L:ACP${n}_TX_${k}_CALL`, lit && u.calls.has(k) && fl ? 1 : 0);
        s.set(`S:ACP${n}_CALL_${k}`, u.powered && u.calls.has(k) ? 1 : 0);
      }
      const voice = s.get(`C:ACP${n}_VOICE`) > 0.5;
      s.set(`L:ACP${n}_VOICE_ON`, lit && voice ? 1 : 0);
      s.set(`S:ACP${n}_POWERED`, u.powered ? 1 : 0);
      s.set(`S:ACP${n}_TX`, u.powered && u.tx ? TX.indexOf(u.tx) + 1 : 0);
      s.set(`S:ACP${n}_VOICE`, u.powered && voice ? 1 : 0);
      const ir = Math.round(s.get(`C:ACP${n}_INT_RAD`));
      s.set(`S:ACP${n}_INT_RAD`, u.powered ? (ir === 0 ? -1 : ir === 2 ? 1 : 0) : 0);
      for (const k of RX) {
        const knobOut = s.get(`C:ACP${n}_RX_${k}_ON`) > 0.5;
        const out = knobOut || u.tx === k;
        const vol = Math.max(0, Math.min(1, s.get(`C:ACP${n}_RX_${k}`)));
        s.set(`S:ACP${n}_RX_${k}`, u.powered && out ? Math.round(vol * 1000) / 1000 : 0);
        // integral light of the reception knob (lit when pulled out, ACP powered)
        s.set(`L:ACP${n}_RX_${k}_LT`, u.powered && knobOut ? RX_LIGHT : 0);
      }
    }
  }
}
