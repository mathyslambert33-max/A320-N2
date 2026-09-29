import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/core/sim';
import { ClockLogic, clockTexts } from '../../src/cockpit/mainpanel/clock-logic';
import { accuAngle, brakeAngleL, brakeAngleR } from '../../src/cockpit/mainpanel/instruments';

function setup(utc = 6 * 3600 + 25 * 60 + 12) {
  const sim = new Sim();
  sim.set('G:TIME_UTC', utc);
  sim.set('C:CLOCK_SRC', 0);
  sim.set('C:CLOCK_ET', 2);
  sim.set('S:ELEC_DC_BAT_BUS', 1);
  const logic = new ClockLogic(new Date(Date.UTC(2026, 8, 28, 15)));
  sim.register(logic.attach(sim));
  // core clock: advance G:TIME_UTC like scenario.ts does
  sim.register({ name: 'utc', order: 0, update: (dt, s) => s.set('G:TIME_UTC', (s.get('G:TIME_UTC') + dt) % 86400) });
  sim.run(0.1);
  return { sim, logic };
}

describe('mainpanel clock', () => {
  it('shows GPS UTC, blank CHR and ET at reset, powered from DC BAT', () => {
    const { sim } = setup();
    const t = clockTexts(sim);
    expect(t.utc).toBe('06:25');
    expect(t.utcSec).toBe('12');
    expect(t.chr).toBe('');
    expect(t.et).toBe('');
    expect(sim.get('S:CLOCK_POWERED')).toBe(1);
    sim.set('S:ELEC_DC_BAT_BUS', 0);
    sim.run(0.1);
    expect(sim.get('S:CLOCK_POWERED')).toBe(0);
  });

  it('CHR pb: start → stop → reset; CHRONO pbs drive it too; RST resets', () => {
    const { sim } = setup();
    sim.emit('CLOCK_CHR:press');
    sim.run(75);
    expect(clockTexts(sim).chr).toBe('01:15');
    sim.emit('CHRONO_CAPT:press'); // stop
    sim.run(10);
    expect(clockTexts(sim).chr).toBe('01:15');
    expect(sim.get('S:CLOCK_CHR_RUN')).toBe(0);
    sim.emit('CHRONO_FO:press'); // reset
    sim.run(0.1);
    expect(clockTexts(sim).chr).toBe('');
    sim.emit('CLOCK_CHR:press');
    sim.run(5);
    sim.emit('CLOCK_RST:press');
    sim.run(0.1);
    expect(sim.get('S:CLOCK_CHR_S')).toBe(-1);
  });

  it('ET: RUN counts HH:MM, STP holds, RST blanks', () => {
    const { sim } = setup();
    sim.set('C:CLOCK_ET', 0);
    sim.run(3725);
    expect(clockTexts(sim).et).toBe('01:02');
    sim.set('C:CLOCK_ET', 1);
    sim.run(600);
    expect(clockTexts(sim).et).toBe('01:02');
    sim.set('C:CLOCK_ET', 2);
    sim.run(0.1);
    expect(clockTexts(sim).et).toBe('');
  });

  it('DATE pb toggles the date; midnight rolls the date over', () => {
    const { sim } = setup(86400 - 5);
    sim.emit('CLOCK_DATE:press');
    sim.run(0.1);
    expect(clockTexts(sim).utc).toBe('28 09');
    expect(clockTexts(sim).utcSec).toBe('26');
    sim.run(10);
    expect(clockTexts(sim).utc).toBe('29 09');
    sim.emit('CLOCK_DATE:press');
    sim.run(0.1);
    expect(clockTexts(sim).utc).toBe('00:00');
  });

  it('SET: CHR selects the field, DATE increments it; INT keeps the offset, GPS resyncs', () => {
    const { sim } = setup(10 * 3600 + 59 * 60);
    sim.set('C:CLOCK_SRC', 2);
    sim.run(0.1);
    expect(sim.get('S:CLOCK_SET_FIELD')).toBe(0);
    sim.emit('CLOCK_DATE:press'); // HH +1
    sim.run(0.1);
    expect(clockTexts(sim, 0).utc).toBe('11:59');
    sim.emit('CLOCK_CHR:press'); // → MM
    sim.emit('CLOCK_DATE:press'); // 59 → 00 without carry
    sim.run(0.1);
    expect(clockTexts(sim, 0).utc).toBe('11:00');
    sim.set('C:CLOCK_SRC', 1);
    sim.run(60);
    expect(clockTexts(sim).utc).toBe('11:01');
    sim.set('C:CLOCK_SRC', 0);
    sim.run(0.1);
    expect(clockTexts(sim).utc).toBe('11:00');
  });

  it('triple indicator needle angles', () => {
    expect(accuAngle(0)).toBe(-60);
    expect(accuAngle(3000)).toBe(30);
    expect(brakeAngleL(0)).toBe(150);
    expect(brakeAngleL(4000)).toBe(30);
    expect(brakeAngleR(2000)).toBe(-90);
  });
});
