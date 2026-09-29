/**
 * Radio Management Panels 1-3 (FCOM DSC-23-10-20), DOM-free.
 *
 * - Each RMP tunes any VHF / HF transceiver: the transceiver key selects it (green light), the ACTIVE window
 *   shows the transceiver's active frequency, the STBY/CRS window this RMP's standby memory for it. The dual
 *   selector sets the standby (outer = MHz, inner = kHz channels, 8.33 kHz channel names on VHF); the
 *   transfer key swaps active and standby.
 * - SEL (white) on both RMPs when a transceiver normally associated with one RMP is tuned by another one
 *   (VHF1/HF1 ↔ RMP 1, VHF2/HF2 ↔ RMP 2, VHF3 ↔ RMP 3).
 * - VHF 3 is in DATA mode (ACARS) at power-up: ACTIVE window "dAtA".
 * - NAV (guarded) = back-up radio navigation mode (minimal: lights, displays the navaid tuned by the FMGS).
 * - ON/OFF switch (catalog pos ['ON','OFF'], C = 0 means ON). RMP 1 DC ESS, RMP 2 DC 2, RMP 3 DC 1.
 *
 * Frequencies are stored in kHz (integers): VHF 121800 = 121.800 MHz, HF 8891 = 8.891 MHz. DATA = −1.
 */
import type { Sim } from '../../../core/sim';
import { annPower, rmpPowered } from './power';

export type RadioId = 'VHF1' | 'VHF2' | 'VHF3' | 'HF1' | 'HF2';
export const RADIOS: RadioId[] = ['VHF1', 'VHF2', 'VHF3', 'HF1', 'HF2'];
export type NavSel = 'VOR' | 'ILS' | 'MLS' | 'ADF';
export const NAV_SELS: NavSel[] = ['VOR', 'ILS', 'MLS', 'ADF'];
export const DATA = -1;

/** 8.33 kHz channel names within each 100 kHz block (25 kHz channels are 00, 25, 50, 75). */
const VHF_SUFFIX = [0, 5, 10, 15, 25, 30, 35, 40, 50, 55, 60, 65, 75, 80, 85, 90];
const VHF_CHANNELS: number[] = [];
for (let h = 0; h < 10; h++) for (const s of VHF_SUFFIX) VHF_CHANNELS.push(h * 100 + s);

export const isHf = (r: RadioId) => r === 'HF1' || r === 'HF2';

/** Normally associated RMP of each transceiver. */
export const OWNER: Record<RadioId, 1 | 2 | 3> = { VHF1: 1, VHF2: 2, VHF3: 3, HF1: 1, HF2: 2 };

/** Step the MHz part (outer knob), wrapping within the band. */
export function stepMhz(r: RadioId, khz: number, steps: number): number {
  if (khz === DATA) khz = isHf(r) ? 2000 : 118000;
  const lo = isHf(r) ? 2 : 118, hi = isHf(r) ? 29 : 136;
  const n = hi - lo + 1;
  const mhz = Math.floor(khz / 1000);
  const frac = khz - mhz * 1000;
  const m = ((((mhz - lo + steps) % n) + n) % n) + lo;
  return m * 1000 + frac;
}

/** Step the kHz part (inner knob), wrapping within the MHz (8.33 channel names on VHF, 1 kHz on HF). */
export function stepKhz(r: RadioId, khz: number, steps: number): number {
  if (khz === DATA) khz = isHf(r) ? 2000 : 118000;
  const mhz = Math.floor(khz / 1000);
  const frac = khz - mhz * 1000;
  if (isHf(r)) return mhz * 1000 + ((((frac + steps) % 1000) + 1000) % 1000);
  let i = VHF_CHANNELS.indexOf(frac);
  if (i < 0) i = VHF_CHANNELS.findIndex((c) => c >= frac);
  if (i < 0) i = 0;
  const N = VHF_CHANNELS.length;
  return mhz * 1000 + VHF_CHANNELS[(((i + steps) % N) + N) % N];
}

/** Text for a 7-segment window: 'VHF 121.800', 'HF  8.891', DATA 'dAtA'. Width 7 chars incl. the point. */
export function formatFreq(r: RadioId, khz: number): string {
  if (khz === DATA) return ' dAtA  ';
  const mhz = Math.floor(khz / 1000);
  const frac = String(khz - mhz * 1000).padStart(3, '0');
  return `${String(mhz).padStart(3, ' ')}.${frac}`;
}

export interface RmpUnit {
  n: 1 | 2 | 3;
  sel: RadioId;
  stby: Record<RadioId, number>;
  nav: boolean;
  navSel: NavSel;
  bfo: boolean;
  am: boolean;
  powered: boolean;
  on: boolean;
}

export class RmpModel {
  /** Active frequency of each transceiver (shared by all RMPs). */
  readonly act: Record<RadioId, number> = { VHF1: 121800, VHF2: 131130, VHF3: DATA, HF1: 8891, HF2: 5649 };
  readonly units: RmpUnit[];

  constructor(private readonly sim: Sim) {
    const mk = (n: 1 | 2 | 3, sel: RadioId): RmpUnit => ({
      n, sel, nav: false, navSel: 'VOR', bfo: false, am: false, powered: false, on: false,
      stby: { VHF1: 121975, VHF2: 121500, VHF3: 131725, HF1: 8879, HF2: 5616 },
    });
    this.units = [mk(1, 'VHF1'), mk(2, 'VHF2'), mk(3, 'VHF3')];
    for (const u of this.units) this.wire(u);
  }

  private usable(u: RmpUnit): boolean {
    return u.powered && u.on;
  }

  private wire(u: RmpUnit): void {
    const s = this.sim;
    const p = `RMP${u.n}`;
    s.on(`${p}_XFER:press`, () => this.xfer(u));
    const knob = (part: 'mhz' | 'khz', dir: 1 | -1) => (pl?: { steps?: number }) => this.turn(u, part, dir * Math.max(1, Math.round(pl?.steps ?? 1)));
    s.on(`${p}_OUTER:inc`, knob('mhz', 1));
    s.on(`${p}_OUTER:dec`, knob('mhz', -1));
    s.on(`${p}_INNER:inc`, knob('khz', 1));
    s.on(`${p}_INNER:dec`, knob('khz', -1));
    for (const r of RADIOS) s.on(`${p}_${r}:press`, () => this.select(u, r));
    s.on(`${p}_AM:press`, () => { if (this.usable(u) && isHf(u.sel)) u.am = !u.am; });
    s.on(`${p}_NAV:press`, () => { if (this.usable(u)) u.nav = !u.nav; });
    for (const k of ['VOR', 'ILS', 'MLS', 'ADF'] as NavSel[]) s.on(`${p}_${k}:press`, () => { if (this.usable(u) && u.nav) { u.navSel = k; if (k !== 'ADF') u.bfo = false; } });
    s.on(`${p}_BFO:press`, () => { if (this.usable(u) && u.nav && u.navSel === 'ADF') u.bfo = !u.bfo; });
  }

  select(u: RmpUnit, r: RadioId): void {
    if (!this.usable(u)) return;
    u.sel = r;
    if (!isHf(r)) u.am = false;
  }

  xfer(u: RmpUnit): void {
    if (!this.usable(u) || u.nav) return;
    const r = u.sel;
    const a = this.act[r];
    this.act[r] = u.stby[r];
    u.stby[r] = a;
  }

  turn(u: RmpUnit, part: 'mhz' | 'khz', steps: number): void {
    if (!this.usable(u) || u.nav) return;
    const r = u.sel;
    u.stby[r] = part === 'mhz' ? stepMhz(r, u.stby[r], steps) : stepKhz(r, u.stby[r], steps);
  }

  /** SEL light: this RMP tunes a foreign transceiver, or another RMP tunes one of ours. */
  selLight(u: RmpUnit): boolean {
    if (!this.usable(u)) return false;
    if (OWNER[u.sel] !== u.n) return true;
    return this.units.some((o) => o !== u && this.usable(o) && OWNER[o.sel] === u.n);
  }

  /** Window texts (7 characters each). */
  texts(u: RmpUnit): { act: string; stby: string } {
    if (u.nav) {
      const s = this.sim;
      const side = u.n === 2 ? 2 : 1;
      if (u.navSel === 'ADF') {
        const f = s.get(`S:NAV_ADF${side}_FREQ`);
        return { act: f > 0 ? `${f.toFixed(1).padStart(6, ' ')} ` : '       ', stby: '       ' };
      }
      const f = u.navSel === 'ILS' ? s.get('S:NAV_ILS_FREQ') : u.navSel === 'MLS' ? 0 : s.get(`S:NAV_VOR${side}_FREQ`);
      const crs = u.navSel === 'ILS' ? s.get('S:NAV_ILS_CRS') : s.get(`S:NAV_VOR${side}_CRS`);
      return {
        act: f > 0 ? `${f.toFixed(2).padStart(6, ' ')} ` : '       ',
        stby: f > 0 ? `C-${String(Math.round(crs) % 360).padStart(3, '0')}  ` : '       ',
      };
    }
    return { act: formatFreq(u.sel, this.act[u.sel]), stby: formatFreq(u.sel, u.stby[u.sel]) };
  }

  update(): void {
    const s = this.sim;
    const ann = annPower(s);
    for (const u of this.units) {
      const n = u.n;
      u.powered = rmpPowered(s, n);
      u.on = s.get(`C:RMP${n}_ON`) < 0.5;
      const ok = this.usable(u);
      const lit = ok && ann;
      const com = lit && !u.nav;
      s.set(`L:RMP${n}_VHF1`, com && u.sel === 'VHF1' ? 1 : 0);
      s.set(`L:RMP${n}_VHF2`, com && u.sel === 'VHF2' ? 1 : 0);
      s.set(`L:RMP${n}_VHF3`, com && u.sel === 'VHF3' ? 1 : 0);
      s.set(`L:RMP${n}_HF1`, com && u.sel === 'HF1' ? 1 : 0);
      s.set(`L:RMP${n}_HF2`, com && u.sel === 'HF2' ? 1 : 0);
      s.set(`L:RMP${n}_AM`, com && isHf(u.sel) && u.am ? 1 : 0);
      s.set(`L:RMP${n}_NAV`, lit && u.nav ? 1 : 0);
      const nav = lit && u.nav;
      s.set(`L:RMP${n}_VOR`, nav && u.navSel === 'VOR' ? 1 : 0);
      s.set(`L:RMP${n}_ILS`, nav && u.navSel === 'ILS' ? 1 : 0);
      s.set(`L:RMP${n}_MLS`, nav && u.navSel === 'MLS' ? 1 : 0);
      s.set(`L:RMP${n}_ADF`, nav && u.navSel === 'ADF' ? 1 : 0);
      s.set(`L:RMP${n}_BFO`, nav && u.navSel === 'ADF' && u.bfo ? 1 : 0);
      s.set(`L:RMP${n}_SEL`, lit && this.selLight(u) ? 1 : 0);
      s.set(`S:RMP${n}_POWERED`, u.powered ? 1 : 0);
      s.set(`S:RMP${n}_ON`, ok ? 1 : 0);
      s.set(`S:RMP${n}_SEL_RADIO`, RADIOS.indexOf(u.sel) + 1);
      s.set(`S:RMP${n}_NAV`, ok && u.nav ? 1 : 0);
      s.set(`S:RMP${n}_NAV_SEL`, ok && u.nav ? NAV_SELS.indexOf(u.navSel) + 1 : 0);
      const mhz = (k: number) => (k === DATA ? -1 : k / 1000);
      s.set(`S:RMP${n}_ACT`, ok ? mhz(this.act[u.sel]) : 0);
      s.set(`S:RMP${n}_STBY`, ok ? mhz(u.stby[u.sel]) : 0);
    }
    for (const r of RADIOS) {
      const a = this.act[r];
      s.set(`S:RADIO_${r}_ACT`, a === DATA ? 0 : a / 1000);
      const owner = this.units[OWNER[r] - 1];
      s.set(`S:RADIO_${r}_STBY`, owner.stby[r] === DATA ? 0 : owner.stby[r] / 1000);
    }
    s.set('S:RADIO_VHF3_DATA', this.act.VHF3 === DATA ? 1 : 0);
  }
}
