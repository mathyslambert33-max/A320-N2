/**
 * ATC transponders 1/2 + TCAS control panel (FCOM DSC-34-SURV-30/40), DOM-free.
 *
 * - Code entry with the keyboard (0-7): digits appear from the left; the new code becomes active when the fourth
 *   digit is entered — until then the previous code is still transmitted. CLR erases the last digit entered (or,
 *   with no entry in progress, blanks the window to start a new code). An unfinished entry is abandoned after
 *   ENTRY_TIMEOUT s (the window shows the active code again).
 * - Mode selector STBY / AUTO / ON: STBY both transponders powered but silent; ON the selected one replies to
 *   modes A/C/S; AUTO = ON in flight, mode S only (squitter / selective replies) on ground.
 * - SYS 1/2 selects the operating transponder (XPDR 1 AC ESS SHED, XPDR 2 AC 2). ALT RPTG ON/OFF.
 * - IDENT: SPI pulse for 18 s (not in STBY). ATC FAIL (amber): selected transponder failed / unpowered while not
 *   in STBY (panel supplied).
 * - TCAS: STBY / TA / TA-RA selector and THRT / ALL / ABV / BLW traffic selector; the TCAS needs the transponder
 *   operating with altitude reporting (otherwise TCAS STBY).
 */
import type { Sim } from '../../../core/sim';
import { annPower, atcPanelPowered, tcasPowered, xpdrPowered } from './power';

export const ENTRY_TIMEOUT = 10;
export const IDENT_TIME = 18;

/** Parse a transponder code given as octal digits in a decimal number (e.g. 7000) — returns null if invalid. */
export function validCode(code: number): boolean {
  if (!Number.isInteger(code) || code < 0 || code > 7777) return false;
  return /^[0-7]{1,4}$/.test(String(code));
}

export class XpdrModel {
  /** Active code (octal digits as decimal, e.g. 2000). */
  code = 2000;
  /** Digits typed for a new code (null = no entry in progress). */
  entry: string | null = null;
  private entryT = 0;
  private identT = 0;
  private failed: [boolean, boolean] = [false, false];
  panelPowered = false;

  constructor(private readonly sim: Sim) {
    sim.on('XPDR_KEY', (p?: { key?: string } | string) => this.key(typeof p === 'string' ? p : p?.key ?? ''));
    sim.on('XPDR_IDENT:press', () => this.ident());
    sim.on('xpdr:fail', (p?: { sys?: number; on?: boolean }) => {
      const i = p?.sys === 2 ? 1 : 0;
      this.failed[i] = p?.on !== false;
    });
    sim.on('xpdr:code', (p?: { code?: number } | number) => {
      const c = typeof p === 'number' ? p : p?.code;
      if (c !== undefined && validCode(c)) { this.code = c; this.entry = null; }
    });
  }

  init(): void {
    const c = this.sim.has('S:XPDR_CODE') ? this.sim.get('S:XPDR_CODE') : this.code;
    if (validCode(c)) this.code = c;
  }

  get sys(): 1 | 2 {
    return Math.round(this.sim.get('C:XPDR_SYS')) === 1 ? 2 : 1;
  }

  /** Mode selector 0 STBY, 1 AUTO, 2 ON. */
  get modeSel(): number {
    return Math.max(0, Math.min(2, Math.round(this.sim.get('C:XPDR_MODE'))));
  }

  key(k: string): void {
    if (!this.panelPowered) return;
    const key = k.toUpperCase();
    if (key === 'CLR') {
      if (this.entry && this.entry.length) this.entry = this.entry.slice(0, -1);
      else this.entry = '';
      this.entryT = 0;
      return;
    }
    if (!/^[0-7]$/.test(key)) return;
    const e = (this.entry ?? '') + key;
    if (e.length >= 4) {
      this.code = Number(e.slice(0, 4));
      this.entry = null;
    } else {
      this.entry = e;
      this.entryT = 0;
    }
  }

  ident(): void {
    if (!this.panelPowered || this.modeSel === 0 || !xpdrPowered(this.sim, this.sys)) return;
    this.identT = IDENT_TIME;
  }

  /** Text of the 4-digit code window (blanks for digits not yet entered). */
  windowText(): string {
    if (this.entry !== null) return this.entry.padEnd(4, ' ');
    return String(this.code).padStart(4, '0');
  }

  update(dt: number): void {
    const s = this.sim;
    this.panelPowered = atcPanelPowered(s);
    if (this.entry !== null) {
      this.entryT += dt;
      if (this.entryT > ENTRY_TIMEOUT || !this.panelPowered) this.entry = null;
    }
    const sys = this.sys;
    const mode = this.modeSel;
    const pw = xpdrPowered(s, sys);
    const ok = pw && !this.failed[sys - 1];
    const onGround = s.has('G:AC_ON_GROUND') ? s.getB('G:AC_ON_GROUND') : true;
    // replies: 0 none, 1 mode S only (AUTO on ground), 2 all modes
    const reply = !ok || mode === 0 ? 0 : mode === 1 && onGround ? 1 : 2;
    const altRptg = s.get('C:XPDR_ALT_RPTG') < 0.5; // pos ['ON','OFF']
    if (this.identT > 0) this.identT = reply ? Math.max(0, this.identT - dt) : 0;
    const fail = this.panelPowered && mode !== 0 && !ok;
    s.set('L:XPDR_FAIL', annPower(s) && fail ? 1 : 0);
    s.set('S:XPDR_CODE', this.code);
    s.set('S:XPDR_ENTRY', this.entry !== null ? 1 : 0);
    s.set('S:XPDR_MODE', mode);
    s.set('S:XPDR_SYS', sys);
    s.set('S:XPDR_POWERED', pw ? 1 : 0);
    s.set('S:XPDR_PANEL_POWERED', this.panelPowered ? 1 : 0);
    s.set('S:XPDR_REPLY', reply);
    s.set('S:XPDR_ALT_RPTG', reply && altRptg ? 1 : 0);
    s.set('S:XPDR_IDENT', this.identT > 0 ? 1 : 0);
    s.set('S:XPDR_FAIL', fail ? 1 : 0);
    // TCAS
    const tcasSel = Math.max(0, Math.min(2, Math.round(s.get('C:TCAS_MODE'))));
    const tcasOk = tcasPowered(s) && reply > 0 && altRptg;
    s.set('S:TCAS_MODE', tcasSel);
    s.set('S:TCAS_STATE', tcasOk ? tcasSel : 0);
    s.set('S:TCAS_POWERED', tcasPowered(s) ? 1 : 0);
    s.set('S:TCAS_TRAFFIC', Math.max(0, Math.min(3, Math.round(s.get('C:TCAS_TRAFFIC')))));
  }
}
