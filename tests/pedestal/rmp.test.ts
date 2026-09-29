import { describe, expect, it } from 'vitest';
import { setup, power, press } from './helpers';
import { formatFreq, stepKhz, stepMhz, DATA } from '../../src/cockpit/pedestal/logic/rmp';

describe('RMP model', () => {
  it('formats and steps frequencies (8.33 kHz channel names, wrap within the band)', () => {
    expect(formatFreq('VHF1', 121800)).toBe('121.800');
    expect(formatFreq('HF1', 8891)).toBe('  8.891');
    expect(formatFreq('VHF3', DATA)).toContain('dAtA');
    expect(stepKhz('VHF1', 121800, 1)).toBe(121805);
    expect(stepKhz('VHF1', 121990, 1)).toBe(121000); // wraps inside the MHz
    expect(stepKhz('VHF1', 121000, -1)).toBe(121990);
    expect(stepMhz('VHF1', 136975, 1)).toBe(118975);
    expect(stepMhz('VHF1', 118000, -1)).toBe(136000);
    expect(stepMhz('HF1', 29500, 1)).toBe(2500);
  });

  it('is off (no lights, no windows) until the ON/OFF switch is ON and its bus powered', async () => {
    const { sim } = await setup('full');
    expect(sim.get('C:RMP1_ON')).toBe(1); // cold & dark: OFF
    expect(sim.get('S:RMP1_ON')).toBe(0);
    expect(sim.get('L:RMP1_VHF1')).toBe(0);
    sim.set('C:RMP1_ON', 0);
    sim.run(0.1);
    expect(sim.get('S:RMP1_ON')).toBe(1);
    expect(sim.get('L:RMP1_VHF1')).toBe(1);
    expect(sim.get('S:RMP1_ACT')).toBeCloseTo(121.8, 3);
    // RMP 2 on DC 2: batteries only → dead
    sim.set('C:RMP2_ON', 0);
    power(sim, 'bat');
    sim.run(0.1);
    expect(sim.get('S:RMP1_ON')).toBe(1); // DC ESS
    expect(sim.get('S:RMP2_ON')).toBe(0);
    expect(sim.get('L:RMP2_VHF2')).toBe(0);
  });

  it('tunes the standby frequency with the dual knob and swaps with the transfer key', async () => {
    const { sim, ped } = await setup('full');
    sim.set('C:RMP1_ON', 0);
    sim.run(0.1);
    sim.emit('RMP1_OUTER:inc', { steps: 1 }); // 121.975 → 122.975
    sim.emit('RMP1_INNER:dec', { steps: 1 }); // → 122.965
    sim.run(0.1);
    expect(sim.get('S:RMP1_STBY')).toBeCloseTo(122.965, 3);
    press(sim, 'RMP1_XFER');
    expect(sim.get('S:RADIO_VHF1_ACT')).toBeCloseTo(122.965, 3);
    expect(sim.get('S:RMP1_STBY')).toBeCloseTo(121.8, 3);
    expect(ped.rmp.texts(ped.rmp.units[0]).act).toBe('122.965');
  });

  it('lights SEL on both RMPs when an RMP tunes a transceiver of another RMP', async () => {
    const { sim } = await setup('full');
    sim.set('C:RMP1_ON', 0);
    sim.set('C:RMP2_ON', 0);
    sim.run(0.1);
    expect(sim.get('L:RMP1_SEL')).toBe(0);
    press(sim, 'RMP1_VHF2');
    expect(sim.get('L:RMP1_VHF2')).toBe(1);
    expect(sim.get('L:RMP1_VHF1')).toBe(0);
    expect(sim.get('L:RMP1_SEL')).toBe(1);
    expect(sim.get('L:RMP2_SEL')).toBe(1);
    press(sim, 'RMP1_VHF1');
    expect(sim.get('L:RMP1_SEL')).toBe(0);
    expect(sim.get('L:RMP2_SEL')).toBe(0);
  });

  it('VHF 3 is in DATA mode; HF keys enable AM; NAV back-up selects the navaids', async () => {
    const { sim, ped } = await setup('full');
    sim.set('C:RMP3_ON', 0);
    sim.run(0.1);
    expect(sim.get('S:RADIO_VHF3_DATA')).toBe(1);
    expect(ped.rmp.texts(ped.rmp.units[2]).act).toContain('dAtA');
    press(sim, 'RMP3_HF1');
    press(sim, 'RMP3_AM');
    expect(sim.get('L:RMP3_AM')).toBe(1);
    press(sim, 'RMP3_NAV');
    expect(sim.get('L:RMP3_NAV')).toBe(1);
    expect(sim.get('L:RMP3_HF1')).toBe(0);
    press(sim, 'RMP3_ADF');
    press(sim, 'RMP3_BFO');
    expect(sim.get('L:RMP3_ADF')).toBe(1);
    expect(sim.get('L:RMP3_BFO')).toBe(1);
    press(sim, 'RMP3_ILS');
    expect(sim.get('L:RMP3_BFO')).toBe(0);
    expect(sim.get('S:RMP3_NAV_SEL')).toBe(2);
  });

  it('annunciator lights need the annunciator supply', async () => {
    const { sim } = await setup('full');
    sim.set('C:RMP1_ON', 0);
    sim.set('S:ANN_POWER', 0);
    sim.run(0.1);
    expect(sim.get('S:RMP1_ON')).toBe(1);
    expect(sim.get('L:RMP1_VHF1')).toBe(0);
  });
});
