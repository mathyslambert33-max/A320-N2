/**
 * Airbus A320 NORMAL CHECKLIST (challenge / response), the sections relevant to the game — English, like the
 * paper checklist on the aircraft. `hint` gives the flight's expected value (shown in small type in the EFB);
 * the checklist is ticked by the player, there is no automatic detection. DOM-free.
 */
import { SCENARIO, weatherFor } from '../core/scenario';
import type { TimeOfDay } from '../core/settings';

export interface ChecklistItem {
  item: string;
  resp: string;
  /** Expected value for this flight (OFP / loadsheet / weather). */
  hint?: string;
}

export interface Checklist {
  id: 'cockpit_prep' | 'before_start' | 'after_start';
  title: string;
  items: ChecklistItem[];
}

const nf = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

export function normalChecklists(tod: TimeOfDay, unit: 'kg' | 'lbs' = 'kg'): Checklist[] {
  const w = weatherFor(tod);
  const t = SCENARIO.takeoff;
  const fuel = unit === 'kg' ? SCENARIO.weights.blockFuel : Math.round((SCENARIO.weights.blockFuel * 2.20462) / 10) * 10;
  const u = unit === 'kg' ? 'KG' : 'LB';
  return [
    {
      id: 'cockpit_prep',
      title: 'COCKPIT PREP',
      items: [
        { item: 'GEAR PINS & COVERS', resp: 'REMOVED' },
        { item: 'FUEL QUANTITY', resp: `___ ${u}`, hint: `${nf(fuel)} ${u}` },
        { item: 'SEAT BELTS', resp: 'ON' },
        { item: 'ADIRS', resp: 'NAV' },
        { item: 'BARO REF', resp: '___ (BOTH)', hint: `QNH ${w.qnh}` },
      ],
    },
    {
      id: 'before_start',
      title: 'BEFORE START',
      items: [
        { item: 'PARKING BRAKE', resp: '___', hint: 'ON' },
        { item: 'T.O SPEEDS & THRUST', resp: '___ (BOTH)', hint: `V1 ${t.v1} · VR ${t.vr} · V2 ${t.v2} · FLX ${t.flex}` },
        { item: 'WINDOWS', resp: 'CLOSED (BOTH)' },
        { item: 'BEACON', resp: 'ON' },
      ],
    },
    {
      id: 'after_start',
      title: 'AFTER START',
      items: [
        { item: 'ANTI ICE', resp: '___', hint: 'OFF' },
        { item: 'ECAM STATUS', resp: 'CHECKED' },
        { item: 'PITCH TRIM', resp: '___', hint: `${t.thsFor.toFixed(1)} UP` },
        { item: 'RUDDER TRIM', resp: 'ZERO' },
      ],
    },
  ];
}

/** Session state of the EFB checklists (ticks), shared by the EFB tab and the debrief. */
export class ChecklistState {
  private ticks = new Map<string, Set<number>>();
  private listeners = new Set<(id: string, complete: boolean) => void>();

  constructor(private readonly lists: Checklist[]) {}

  isTicked(id: string, i: number): boolean {
    return this.ticks.get(id)?.has(i) ?? false;
  }

  toggle(id: string, i: number): void {
    let s = this.ticks.get(id);
    if (!s) this.ticks.set(id, (s = new Set()));
    const wasComplete = this.isComplete(id);
    if (s.has(i)) s.delete(i); else s.add(i);
    const complete = this.isComplete(id);
    if (complete !== wasComplete) for (const l of this.listeners) l(id, complete);
  }

  reset(id: string): void {
    const was = this.isComplete(id);
    this.ticks.delete(id);
    if (was) for (const l of this.listeners) l(id, false);
  }

  count(id: string): number {
    return this.ticks.get(id)?.size ?? 0;
  }

  isComplete(id: string): boolean {
    const cl = this.lists.find((c) => c.id === id);
    return !!cl && this.count(id) >= cl.items.length;
  }

  onComplete(fn: (id: string, complete: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
