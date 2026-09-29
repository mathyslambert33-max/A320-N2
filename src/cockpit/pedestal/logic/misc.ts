/**
 * Small pedestal functions (DOM-free): RUD TRIM position window text, WX radar / PWS panel state, cockpit printer.
 */
import type { Sim } from '../../../core/sim';
import { printerPowered, rudTrimIndPowered, wxrPowered } from './power';

/**
 * RUD TRIM window text: direction letter + value with one decimal, e.g. "L 0.0", "R 1.2", "L20.0".
 * `last` keeps the letter shown at exactly zero (the indicator keeps the last side).
 */
export function rudTrimText(deg: number, last: 'L' | 'R' = 'L'): { text: string; side: 'L' | 'R' } {
  const v = Math.round(Math.min(20, Math.abs(deg)) * 10) / 10;
  const side: 'L' | 'R' = v === 0 ? last : deg > 0 ? 'R' : 'L';
  const num = v.toFixed(1);
  return { text: `${side}${num.padStart(4, ' ')}`, side };
}

/** WX radar tilt knob (0..1, 0.5 = 0°) → antenna tilt in degrees (−15 DN … +15 UP). */
export const wxrTilt = (pot: number) => Math.round((Math.max(0, Math.min(1, pot)) - 0.5) * 30 * 10) / 10;

/** Paper printed per second while FEED is held (m), and by a TEST print. */
export const PRINTER_FEED_RATE = 0.025;
export const PRINTER_TEST_LENGTH = 0.07;
export const PRINTER_MAX_PAPER = 0.16;

export class PedMisc {
  private rudSide: 'L' | 'R' = 'L';
  /** Paper sticking out of the printer (m). */
  paper = 0;
  private testRemain = 0;
  private testPrinted = 0;

  constructor(private readonly sim: Sim) {
    sim.on('PRINTER_TEST:press', () => {
      if (printerPowered(this.sim) && this.testRemain <= 0) { this.testRemain = PRINTER_TEST_LENGTH; this.testPrinted = 0; }
    });
    sim.on('printer:tear', () => { this.paper = 0; this.sim.set('S:PRINTER_PAPER', 0); });
  }

  rudTrim(): { text: string; valid: boolean } {
    const s = this.sim;
    const valid = s.has('S:FCTL_FAC1_ON') || s.has('S:FCTL_FAC2_ON') ? s.getB('S:FCTL_FAC1_ON') || s.getB('S:FCTL_FAC2_ON') : true;
    const r = rudTrimText(s.get('S:FCTL_RUD_TRIM'), this.rudSide);
    this.rudSide = r.side;
    return { text: r.text, valid };
  }

  update(dt: number): void {
    const s = this.sim;
    // RUD TRIM indicator
    const rp = rudTrimIndPowered(s);
    const rt = this.rudTrim();
    s.set('S:RUD_TRIM_IND_POWERED', rp ? 1 : 0);
    s.set('S:RUD_TRIM_IND_VALID', rp && rt.valid ? 1 : 0);
    // WX radar: SYS 1 / OFF / 2 (catalog pos ['1','OFF','2'])
    const selPos = Math.round(s.get('C:WXR_SYS'));
    const sys = selPos === 0 ? 1 : selPos === 2 ? 2 : 0;
    const wxOn = sys !== 0 && wxrPowered(s, sys as 1 | 2);
    s.set('S:WXR_SYS', sys);
    s.set('S:WXR_ON', wxOn ? 1 : 0);
    s.set('S:WXR_MODE', Math.max(0, Math.min(3, Math.round(s.get('C:WXR_MODE')))));
    s.set('S:WXR_GAIN', Math.round(Math.max(0, Math.min(1, s.get('C:WXR_GAIN'))) * 100) / 100);
    s.set('S:WXR_TILT', wxrTilt(s.get('C:WXR_TILT')));
    s.set('S:WXR_GCS', wxOn && s.get('C:WXR_GCS') < 0.5 ? 1 : 0);
    // PWS (AUTO/OFF): the predictive windshear function scans automatically below 1500 ft even with the radar OFF
    // when the transceiver is powered (FCOM DSC-34-SURV-20).
    const pwsAuto = s.get('C:WXR_PWS') < 0.5;
    s.set('S:WXR_PWS', pwsAuto && wxrPowered(s, 0) ? 1 : 0);
    // Printer
    const pp = printerPowered(s);
    s.set('S:PRINTER_POWERED', pp ? 1 : 0);
    let feed = 0;
    if (pp && s.get('C:PRINTER_FEED') > 0.5) feed = PRINTER_FEED_RATE * dt;
    if (pp && this.testRemain > 0) {
      const d = Math.min(this.testRemain, PRINTER_FEED_RATE * 0.6 * dt);
      this.testRemain -= d;
      this.testPrinted += d;
      feed += d;
    }
    if (!pp) this.testRemain = 0;
    if (feed > 0) this.paper = Math.min(PRINTER_MAX_PAPER, this.paper + feed);
    s.set('S:PRINTER_PAPER', Math.round(this.paper * 1e4) / 1e4);
    s.set('S:PRINTER_BUSY', this.testRemain > 0 || feed > 0 ? 1 : 0);
  }
}
