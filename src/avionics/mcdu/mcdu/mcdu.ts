/**
 * One MCDU (keyboard + display controller). Both MCDUs share one FMGS; each has its own page and scratchpad.
 * DOM-free: produces a Screen model which the display code paints.
 *
 * Scratchpad rules (FCOM DSC-22_20 "MCDU"): 22 characters; CLR deletes the last character, or the displayed
 * message, or writes "CLR" when the scratchpad is empty (to delete a field with a LSK); OVFY writes the overfly
 * symbol; +/- toggles the sign; type I messages hide the entry until cleared; type II messages are queued and
 * shown when the scratchpad is empty.
 */
import type { Fmgs } from '../fmgs/fmgs';
import { MSG, type McduMessage, type Result } from './format';
import { COLS, Screen } from './screen';

export type LskKey = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

/** Returned by a LSK handler that did not use the scratchpad (page change prompts). */
export const KEEP = Symbol('keep');
export type Handler = (sp: string) => Result | typeof KEEP;

export const CLR = 'CLR';
export const OVFY = 'Δ';

export interface View {
  s: Screen;
  m: Mcdu;
  f: Fmgs;
  on(key: LskKey, fn: Handler): void;
  /** Show the slew (↑↓) and NEXT/PREV (←→) arrows. */
  arrows(a: { up?: boolean; down?: boolean; lr?: boolean }): void;
}

export interface Page {
  id: string;
  draw(v: View): void;
  up?(): void;
  down?(): void;
  prev?(): void;
  next?(): void;
  /** True if the page belongs to the FMGC (MCDU MENU / subsystems excluded). */
  fmgc?: boolean;
}

export type PageFactory = (m: Mcdu) => Page;

/** Registry of FMGC function-key pages (filled by pages/index.ts to avoid import cycles). */
export const PAGES: Record<string, PageFactory> = {};

/** MCDU self-test duration after power-up (s). */
export const MCDU_BOOT_S = 2.5;

export class Mcdu {
  page!: Page;
  scratch = '';
  msg?: McduMessage;
  brightness = 0.8;
  powered = false;
  /** Seconds since power-up. */
  upT = 0;
  booted = false;
  private autoMenu = false;
  private handlers: Partial<Record<LskKey, Handler>> = {};
  private arrowFlags = { up: false, down: false, lr: false };
  /** Page to display when coming back to the FMGC from the MCDU MENU. */
  private lastFmgcPage?: Page;

  constructor(readonly n: 1 | 2, readonly fmgs: Fmgs) {
    this.page = PAGES.MENU?.(this) ?? { id: 'BLANK', draw() {} };
  }

  /* ---------------------------------------------------------------- navigation */

  show(p: Page | PageFactory): void {
    const page = typeof p === 'function' ? p(this) : p;
    this.page = page;
    if (page.fmgc !== false) this.lastFmgcPage = page;
    this.autoMenu = false;
  }

  go(id: string): void {
    const f = PAGES[id];
    if (f) this.show(f);
  }

  /* ---------------------------------------------------------------- messages */

  showMessage(m: McduMessage): void {
    if (m.type2) this.fmgs.pushMessage(m);
    else this.msg = m;
  }

  /** Text currently displayed in the scratchpad line and its colour. */
  scratchLine(): { text: string; amber: boolean } {
    if (this.msg) return { text: this.msg.text, amber: this.msg.amber };
    if (this.scratch) return { text: this.scratch, amber: false };
    const q = this.fmgs.ready ? this.fmgs.messages[0] : undefined;
    if (q) return { text: q.text, amber: q.amber };
    return { text: '', amber: false };
  }

  /* ---------------------------------------------------------------- power / update */

  update(dt: number, powered: boolean): void {
    if (!powered) {
      if (this.powered) {
        this.powered = false;
        this.booted = false;
        this.scratch = '';
        this.msg = undefined;
      }
      this.upT = 0;
      return;
    }
    if (!this.powered) {
      this.powered = true;
      this.upT = 0;
      this.booted = false;
    }
    this.upT += dt;
    if (!this.booted && this.upT >= MCDU_BOOT_S) {
      this.booted = true;
      if (this.fmgs.ready && this.lastFmgcPage && this.fmgs.active) this.page = this.lastFmgcPage;
      else if (this.fmgs.ready) this.show(PAGES.STATUS);
      else { this.go('MENU'); this.autoMenu = true; }
    }
    // FMGC becomes available while the MCDU MENU is displayed after power-up: FMGC takes the display.
    if (this.booted && this.autoMenu && this.fmgs.ready) this.show(PAGES.STATUS);
    // FMGC lost: back to the MCDU MENU.
    if (this.booted && !this.fmgs.ready && this.page.fmgc !== false) {
      this.go('MENU');
      this.autoMenu = true;
    }
  }

  /* ---------------------------------------------------------------- rendering */

  render(): Screen {
    const s = new Screen();
    this.handlers = {};
    this.arrowFlags = { up: false, down: false, lr: false };
    if (!this.powered || !this.booted) return s;
    const view: View = {
      s, m: this, f: this.fmgs,
      on: (k, fn) => { this.handlers[k] = fn; },
      arrows: (a) => { this.arrowFlags = { up: !!a.up, down: !!a.down, lr: !!a.lr }; },
    };
    this.page.draw(view);
    const a = this.arrowFlags;
    if (a.lr) s.text(0, COLS - 2, '←→', 'w', false);
    if (a.up || a.down) s.text(13, COLS - 2, `${a.up ? '↑' : ' '}${a.down ? '↓' : ' '}`, 'w', false);
    const sp = this.scratchLine();
    if (sp.text) s.text(13, 0, sp.text.slice(0, 22), sp.amber ? 'a' : 'w', false);
    return s;
  }

  /* ---------------------------------------------------------------- keyboard */

  key(k: string): void {
    if (!this.powered) return;
    if (k === 'BRT') { this.brightness = Math.min(1, +(this.brightness + 0.1).toFixed(2)); return; }
    if (k === 'DIM') { this.brightness = Math.max(0.1, +(this.brightness - 0.1).toFixed(2)); return; }
    if (!this.booted) return;

    if (/^[LR][1-6]$/.test(k)) return this.lsk(k as LskKey);
    const ch = charOf(k);
    if (ch !== undefined) return this.type(ch);
    switch (k) {
      case 'CLR': return this.clr();
      case 'OVFY':
        if (this.msg) this.msg = undefined;
        if (!this.scratch) this.scratch = OVFY;
        else this.msg = MSG.NOT_ALLOWED;
        return;
      case 'PLUSMINUS': {
        if (this.msg) this.msg = undefined;
        if (this.scratch === CLR || this.scratch === OVFY) this.scratch = '';
        const last = this.scratch.slice(-1);
        if (last === '-') this.scratch = this.scratch.slice(0, -1) + '+';
        else if (last === '+') this.scratch = this.scratch.slice(0, -1) + '-';
        else if (this.scratch.length < 22) this.scratch += '-';
        return;
      }
      case 'UP': this.page.up?.(); return;
      case 'DOWN': this.page.down?.(); return;
      case 'PREV': this.page.prev?.(); return;
      case 'NEXT': this.page.next?.(); return;
      case 'MENU': this.show(PAGES.MENU); this.msg = MSG.SELECT_DESIRED_SYSTEM; return;
    }
    // FMGC function keys
    if (!this.fmgs.ready) return;
    const map: Record<string, string> = {
      DIR: 'DIR', PROG: 'PROG', PERF: 'PERF', INIT: 'INIT', DATA: 'DATA', FPLN: 'FPLN', RADNAV: 'RADNAV',
      FUEL: 'FUEL', SECFPLN: 'SEC', AIRPORT: 'AIRPORT',
    };
    const id = map[k];
    if (id && PAGES[id]) this.show(PAGES[id]);
    // ATC COMM: no ATSU installed on this aircraft: key inactive.
  }

  private type(ch: string): void {
    if (this.msg) this.msg = undefined;
    if (this.scratch === CLR || this.scratch === OVFY) this.scratch = '';
    if (this.scratch.length >= 22) return;
    this.scratch += ch;
  }

  private clr(): void {
    if (this.msg) { this.msg = undefined; return; }
    if (!this.scratch) {
      const q = this.fmgs.messages[0];
      if (q) { this.fmgs.removeMessage(q); return; }
      this.scratch = CLR;
      return;
    }
    if (this.scratch === CLR || this.scratch === OVFY) { this.scratch = ''; return; }
    this.scratch = this.scratch.slice(0, -1);
  }

  lsk(k: LskKey): void {
    if (this.msg) this.msg = undefined;
    this.render();
    const h = this.handlers[k];
    const sp = this.scratch;
    if (!h) {
      if (sp) this.msg = MSG.NOT_ALLOWED;
      return;
    }
    const r = h(sp);
    if (r === KEEP) return;
    if (r && !r.type2) { this.showMessage(r); return; }
    // type II message raised by an accepted entry: queued, the entry is used
    if (r) this.showMessage(r);
    // entry accepted: scratchpad used
    if (sp) this.scratch = '';
  }

  /** Put text into the scratchpad (LSK copy of a field). */
  copyToScratch(text: string): void {
    this.msg = undefined;
    this.scratch = text.slice(0, 22);
  }

  /** Test helper: type a string on the keyboard. */
  typeString(s: string): void {
    for (const c of s) this.key(keyOf(c));
  }
}

function charOf(k: string): string | undefined {
  if (/^[A-Z0-9]$/.test(k)) return k;
  if (k === 'DOT') return '.';
  if (k === 'SLASH') return '/';
  if (k === 'SP') return ' ';
  return undefined;
}

/** Keyboard key for a character. */
export function keyOf(c: string): string {
  if (c === '.') return 'DOT';
  if (c === '/') return 'SLASH';
  if (c === ' ') return 'SP';
  if (c === '-' || c === '+') return 'PLUSMINUS';
  return c.toUpperCase();
}
