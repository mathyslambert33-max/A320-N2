/**
 * DMC system-display page selection (FCOM DSC-31 "SD page calling").
 *
 * Automatic (flight phase) mode:
 *   - ENG page during engine start: ENG MODE selector on CRANK, or IGN/START while one engine is not
 *     running (remains 10 s after the start),
 *   - APU page when the APU MASTER SW is ON, until 10 s after APU AVAIL,
 *   - phase 1 / 10: DOOR/OXY; phase 2: WHEEL (F/CTL for 20 s when a sidestick or the rudder is moved),
 *   - phases 3, 4, 5: ENG; phase 6: ENG until 1500 ft and T.O power / flaps retracted, then CRUISE,
 *     WHEEL below 16000 ft with the gear down; phases 7, 8, 9: WHEEL.
 * A warning / caution calls its own page (FWC request), overriding the automatic mode.
 * A system page pb selects the page manually; pressing it again returns to the automatic mode.
 * STS shows the STATUS page ("NORMAL" for 3 s when there is no status message).
 * ALL held: all pages are shown successively at 1 s intervals.
 */
import type { Fwc } from './fwc';
import { SdPage, PAGE_KEYS } from './types';
import { ConfirmNode, Monostable } from './util';

type Mode = 'AUTO' | 'MANUAL' | 'WARNING' | 'STATUS';

export class SdPageLogic {
  page: SdPage = SdPage.DOOR;
  autoPage: SdPage = SdPage.DOOR;
  mode: Mode = 'AUTO';
  selected: SdPage = SdPage.NONE;
  /** STATUS page "NORMAL" (no status message) remaining time. */
  stsNormal = 0;

  private engStart = new ConfirmNode(10, false);
  private apuAvail10 = new ConfirmNode(10, true);
  private ctlMoved = new Monostable(20, true, true);
  private cruise = new ConfirmNode(60, true);
  private prevRequest: SdPage = SdPage.NONE;
  private allHeld = false;
  private allTimer = 0;
  private first = true;

  update(fwc: Fwc, dt: number): SdPage {
    const a = fwc.a;
    const ph = fwc.phase;

    // ------------------------------------------------ automatic page
    const oneEngNotRunning = !a.eng[0].running || !a.eng[1].running;
    // spawned with the APU already running: its start is long over
    if (this.first) { this.first = false; if (a.apuAvail) this.apuAvail10.reset(true); }
    const engStart = this.engStart.write(a.engModeSel === 0 || (a.engModeSel === 2 && oneEngNotRunning), dt);
    const apuPage = a.apuMaster && !this.apuAvail10.write(a.apuAvail, dt);
    this.ctlMoved.write(a.sidestickMoved || a.rudderMoved, dt);
    const toPowerOrFlaps = a.toPower() || a.flapsLever !== 0;
    const cruiseOk = this.cruise.write(ph === 6 && !toPowerOrFlaps && a.radioAlt > 1500, dt);
    const gearDown = a.sim.has('S:GEAR_N_POS') ? a.sim.get('S:GEAR_N_POS') > 0.95 : a.onGround;
    let auto: SdPage;
    if (engStart) auto = SdPage.ENG;
    else if (apuPage) auto = SdPage.APU;
    else if (ph === 1 || ph === 10) auto = SdPage.DOOR;
    else if (ph === 2) auto = this.ctlMoved.read() ? SdPage.FCTL : SdPage.WHEEL;
    else if (ph >= 3 && ph <= 5) auto = SdPage.ENG;
    else if (ph === 6) auto = gearDown && a.baroAlt < 16000 ? SdPage.WHEEL : cruiseOk ? SdPage.CRUISE : SdPage.ENG;
    else auto = SdPage.WHEEL;
    this.autoPage = auto;

    // ------------------------------------------------ ALL key: step every second while held
    if (this.allHeld) {
      this.allTimer += dt;
      if (this.allTimer >= 1) { this.allTimer -= 1; this.stepAll(); }
    }

    // ------------------------------------------------ warning request override
    const req = fwc.sdRequest;
    if (req !== this.prevRequest) {
      if (req !== SdPage.NONE) { this.selected = req; this.mode = 'WARNING'; }
      else if (this.mode === 'WARNING') { this.selected = SdPage.NONE; this.mode = 'AUTO'; }
      this.prevRequest = req;
    }

    // the last warning was cleared by CLR: STATUS page if there is a status message
    if (fwc.consumeClearedAll()) {
      const st = fwc.status;
      if (st.left.length + st.inop.length + st.cancelled.length > 0) { this.mode = 'STATUS'; this.selected = SdPage.STS; }
      else if (this.mode === 'WARNING') { this.mode = 'AUTO'; this.selected = SdPage.NONE; }
    }

    if (this.stsNormal > 0) {
      this.stsNormal -= dt;
      if (this.stsNormal <= 0 && this.selected === SdPage.STS) { this.mode = 'AUTO'; this.selected = SdPage.NONE; }
    }

    this.page = this.mode === 'AUTO' ? auto : this.selected;
    return this.page;
  }

  /** A system page key was pressed. */
  pressPage(p: SdPage): void {
    if (this.mode === 'MANUAL' && this.selected === p) {
      this.mode = 'AUTO';
      this.selected = SdPage.NONE;
    } else {
      this.mode = 'MANUAL';
      this.selected = p;
    }
  }

  pressSts(fwc: Fwc): void {
    if (this.selected === SdPage.STS && this.mode !== 'AUTO') {
      this.mode = 'AUTO';
      this.selected = SdPage.NONE;
      this.stsNormal = 0;
      return;
    }
    this.mode = 'STATUS';
    this.selected = SdPage.STS;
    const st = fwc.status;
    this.stsNormal = st.left.length + st.inop.length + st.cancelled.length === 0 ? 3 : 0;
  }

  /** CLR with no warning to clear while the STATUS page is displayed → back to the automatic page. */
  clearStatus(): boolean {
    if (this.selected === SdPage.STS && this.mode !== 'AUTO') {
      this.mode = 'AUTO';
      this.selected = SdPage.NONE;
      this.stsNormal = 0;
      return true;
    }
    return false;
  }

  setAllHeld(held: boolean): void {
    if (held && !this.allHeld) { this.stepAll(); this.allTimer = 0; }
    this.allHeld = held;
  }

  private stepAll(): void {
    const order = PAGE_KEYS.map(([p]) => p);
    const cur = this.mode === 'AUTO' ? SdPage.NONE : this.selected;
    const i = order.indexOf(cur);
    this.selected = i < 0 ? SdPage.ENG : order[(i + 1) % order.length];
    this.mode = 'MANUAL';
  }

  /** Page key lit (page displayed by manual selection or called by a failure). */
  keyLit(p: SdPage): boolean {
    return (this.mode === 'MANUAL' || this.mode === 'WARNING') && this.selected === p;
  }

  statusDisplayed(): boolean {
    return this.page === SdPage.STS;
  }
}
