/**
 * Airbus cockpit clock logic (DOM-free, unit-tested in tests/mainpanel).
 *
 * - UTC: from GPS (`G:TIME_UTC`, seconds since 00:00Z) when the selector is on GPS; INT keeps the
 *   internal clock running with the offset last set; SET lets the crew set it (CHR pb = next field,
 *   DATE pb = +1 on the selected field, fields HH → MM → DD → MO → YY; the field being set flashes).
 * - DATE pb (GPS/INT): toggles the UTC window between time and date (DD MM YY).
 * - CHR: clock CHR pb and the glareshield CHRONO pbs cycle START → STOP → RESET (window blank);
 *   the clock RST pb resets it. Display MIN:SEC (then HH:MM beyond 99:59).
 * - ET: selector RUN (counts) / STP (holds) / RST (resets, window blank). Display HH:MM.
 * - Timekeeping runs on the clock's own supply; the windows show only when powered (DC BAT / DC ESS).
 *
 * Exports (owner mainpanel): S:CLOCK_POWERED, S:CLOCK_UTC_S, S:CLOCK_DAY, S:CLOCK_MONTH, S:CLOCK_YEAR,
 * S:CLOCK_SHOW_DATE, S:CLOCK_SET_FIELD (−1 unless SET), S:CLOCK_CHR_S (−1 blank), S:CLOCK_CHR_RUN,
 * S:CLOCK_ET_S (−1 blank).
 */
import type { Sim, SimSystem } from '../../core/sim';

export const CLOCK_FIELDS = ['HH', 'MM', 'DD', 'MO', 'YY'] as const;

export class ClockLogic {
  chrS = 0;
  chrRun = false;
  chrShown = false;
  etS = 0;
  /** Internal UTC minus GPS UTC (s), used in INT / SET. */
  offset = 0;
  /** Days added to the base date by the SET procedure. */
  private dayShift = 0;
  private monthShift = 0;
  private yearShift = 0;
  showDate = false;
  setField = 0;
  private lastGps = -1;
  private lastUtc = 0;
  /** Base date (UTC) — the day of `G:TIME_UTC` = 0 at scenario start. */
  private base: Date;
  private daysElapsed = 0;

  constructor(date: Date = new Date()) {
    this.base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  /** Attach event listeners and return the sim system to register. */
  attach(sim: Sim): SimSystem {
    const chr = () => {
      if (Math.round(sim.get('C:CLOCK_SRC')) === 2) this.setField = (this.setField + 1) % CLOCK_FIELDS.length;
      else this.chrCycle();
    };
    sim.on('CLOCK_CHR:press', chr);
    // Glareshield CHRONO pbs also drive the clock chronometer.
    sim.on('CHRONO_CAPT:press', () => this.chrCycle());
    sim.on('CHRONO_FO:press', () => this.chrCycle());
    sim.on('CLOCK_RST:press', () => this.chrReset());
    sim.on('CLOCK_DATE:press', () => {
      if (Math.round(sim.get('C:CLOCK_SRC')) === 2) this.increment();
      else this.showDate = !this.showDate;
    });
    return { name: 'mainpanel-clock', order: 95, update: (dt, s) => this.update(dt, s) };
  }

  chrCycle(): void {
    if (!this.chrShown) { this.chrShown = true; this.chrRun = true; this.chrS = 0; }
    else if (this.chrRun) this.chrRun = false;
    else this.chrReset();
  }

  chrReset(): void {
    this.chrShown = false;
    this.chrRun = false;
    this.chrS = 0;
  }

  /** SET mode: +1 on the selected field (hours and minutes wrap without carrying). */
  increment(): void {
    switch (CLOCK_FIELDS[this.setField]) {
      case 'HH': this.offset += Math.floor(this.lastUtc / 3600) === 23 ? -23 * 3600 : 3600; break;
      case 'MM': this.offset += Math.floor((this.lastUtc % 3600) / 60) === 59 ? -59 * 60 : 60; break;
      case 'DD': this.dayShift++; break;
      case 'MO': this.monthShift++; break;
      case 'YY': this.yearShift++; break;
    }
  }

  update(dt: number, sim: Sim): void {
    const gps = sim.get('G:TIME_UTC');
    if (this.lastGps >= 0 && gps + 43200 < this.lastGps) this.daysElapsed++; // midnight roll-over
    this.lastGps = gps;
    const src = Math.round(sim.get('C:CLOCK_SRC'));
    if (src === 0) { this.offset = 0; this.dayShift = 0; this.monthShift = 0; this.yearShift = 0; }
    if (src !== 2) this.setField = 0;
    if (src === 2) this.showDate = false;
    if (this.chrRun) this.chrS += dt;
    const et = Math.round(sim.get('C:CLOCK_ET'));
    if (et === 0) this.etS += dt;
    else if (et === 2) this.etS = 0;

    let utc = gps + this.offset;
    const dayCarry = Math.floor(utc / 86400);
    utc -= dayCarry * 86400;
    this.lastUtc = utc;
    const d = new Date(this.base.getTime() + (this.daysElapsed + dayCarry + this.dayShift) * 86400000);
    d.setUTCMonth(d.getUTCMonth() + this.monthShift);
    d.setUTCFullYear(d.getUTCFullYear() + this.yearShift);

    const powered = sim.getB('S:ELEC_DC_BAT_BUS') || sim.getB('S:ELEC_DC_ESS_BUS');
    sim.set('S:CLOCK_POWERED', powered ? 1 : 0);
    sim.set('S:CLOCK_UTC_S', utc);
    sim.set('S:CLOCK_DAY', d.getUTCDate());
    sim.set('S:CLOCK_MONTH', d.getUTCMonth() + 1);
    sim.set('S:CLOCK_YEAR', d.getUTCFullYear());
    sim.set('S:CLOCK_SHOW_DATE', this.showDate ? 1 : 0);
    sim.set('S:CLOCK_SET_FIELD', src === 2 ? this.setField : -1);
    sim.set('S:CLOCK_CHR_S', this.chrShown ? this.chrS : -1);
    sim.set('S:CLOCK_CHR_RUN', this.chrRun ? 1 : 0);
    sim.set('S:CLOCK_ET_S', et === 2 ? -1 : this.etS);
  }
}

const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** Text shown in the three windows (7-segment strings) — shared by the display and the tests. */
export function clockTexts(sim: Sim, t = 0): { chr: string; utc: string; utcSec: string; et: string } {
  const whole = (v: number) => Math.floor(v + 1e-4); // fixed-step accumulation guard
  const chrS = whole(sim.get('S:CLOCK_CHR_S'));
  let chr = '';
  if (chrS >= 0) {
    const m = Math.floor(chrS / 60);
    chr = m < 100 ? `${p2(m)}:${p2(chrS % 60)}` : `${p2(Math.floor(m / 60) % 100)}:${p2(m % 60)}`;
  }
  const u = whole(sim.get('S:CLOCK_UTC_S')) % 86400;
  let utc = `${p2(u / 3600)}:${p2((u % 3600) / 60)}`;
  let utcSec = p2(u % 60);
  const field = sim.get('S:CLOCK_SET_FIELD');
  const blink = Math.floor(t * 2.5) % 2 === 1;
  if (sim.getB('S:CLOCK_SHOW_DATE') || field >= 2) {
    utc = `${p2(sim.get('S:CLOCK_DAY'))} ${p2(sim.get('S:CLOCK_MONTH'))}`;
    utcSec = p2(sim.get('S:CLOCK_YEAR') % 100);
    if (blink && field === 2) utc = `   ${utc.slice(3)}`;
    if (blink && field === 3) utc = `${utc.slice(0, 2)}   `;
    if (blink && field === 4) utcSec = '  ';
  } else if (blink && field === 0) utc = `  :${utc.slice(3)}`;
  else if (blink && field === 1) utc = `${utc.slice(0, 2)}:  `;
  const etS = whole(sim.get('S:CLOCK_ET_S'));
  const et = etS >= 0 ? `${p2((etS / 3600) % 100)}:${p2((etS % 3600) / 60)}` : '';
  return { chr, utc, utcSec, et };
}
