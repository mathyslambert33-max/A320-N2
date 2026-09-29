import { describe, expect, it } from 'vitest';
import { setup, power, press } from './helpers';
import { callChannel, CALL_TIMEOUT } from '../../src/cockpit/pedestal/logic/acp';

describe('ACP (audio control panels)', () => {
  it('maps call names to transmission keys', () => {
    expect(callChannel('MECH')).toBe('INT');
    expect(callChannel('att')).toBe('CAB');
    expect(callChannel('VHF1')).toBe('VHF1');
    expect(callChannel('FOO')).toBeNull();
  });

  it('selects one transmission channel per ACP (green bars), toggles off on a second press', async () => {
    const { sim } = await setup('full');
    expect(sim.get('L:ACP1_TX_VHF1')).toBe(1); // VHF 1 selected at power-up
    press(sim, 'ACP1_TX_VHF2');
    expect(sim.get('L:ACP1_TX_VHF2')).toBe(1);
    expect(sim.get('L:ACP1_TX_VHF1')).toBe(0);
    expect(sim.get('S:ACP1_TX')).toBe(2);
    expect(sim.get('L:ACP2_TX_VHF1')).toBe(1); // other ACP unaffected
    press(sim, 'ACP1_TX_VHF2');
    expect(sim.get('L:ACP1_TX_VHF2')).toBe(0);
    expect(sim.get('S:ACP1_TX')).toBe(0);
  });

  it('flashes MECH on every ACP for a ground call until answered or RESET', async () => {
    const { sim } = await setup('full');
    sim.emit('acp:call', { ch: 'MECH' });
    let seen = 0;
    for (let i = 0; i < 40; i++) { sim.run(0.05); seen += sim.get('L:ACP1_TX_INT_CALL'); }
    expect(seen).toBeGreaterThan(5);
    expect(seen).toBeLessThan(35); // flashing
    expect(sim.get('S:ACP2_CALL_INT')).toBe(1);
    expect(sim.get('S:ACP3_CALL_INT')).toBe(1);
    // captain answers with the INT key: selects INT, cancels his call only
    press(sim, 'ACP1_TX_INT');
    expect(sim.get('S:ACP1_CALL_INT')).toBe(0);
    expect(sim.get('L:ACP1_TX_INT')).toBe(1);
    expect(sim.get('S:ACP2_CALL_INT')).toBe(1);
    press(sim, 'ACP2_RESET');
    expect(sim.get('S:ACP2_CALL_INT')).toBe(0);
    // time-out
    sim.emit('acp:call', { ch: 'ATT', acp: 1 });
    sim.run(1);
    expect(sim.get('S:ACP1_CALL_CAB')).toBe(1);
    expect(sim.get('S:ACP2_CALL_CAB')).toBe(0);
    sim.run(CALL_TIMEOUT + 1);
    expect(sim.get('S:ACP1_CALL_CAB')).toBe(0);
  });

  it('publishes reception volumes: knob out (or channel selected for transmission) × volume', async () => {
    const { sim } = await setup('full');
    expect(sim.get('C:ACP1_RX_VHF1_ON')).toBe(1);
    expect(sim.get('S:ACP1_RX_VHF1')).toBeCloseTo(0.6, 3);
    expect(sim.get('L:ACP1_RX_VHF1_LT')).toBeGreaterThan(0);
    expect(sim.get('S:ACP1_RX_VOR1')).toBe(0);
    sim.set('C:ACP1_RX_VOR1_ON', 1);
    sim.set('C:ACP1_RX_VOR1', 0.5);
    sim.run(0.1);
    expect(sim.get('S:ACP1_RX_VOR1')).toBeCloseTo(0.5, 3);
    // HF1 selected for transmission → heard even with the knob in
    press(sim, 'ACP1_TX_HF1');
    expect(sim.get('S:ACP1_RX_HF1')).toBeCloseTo(0.3, 3);
    expect(sim.get('L:ACP1_RX_HF1_LT')).toBe(0);
  });

  it('VOICE light and power: ACP 2 on DC 2 is dead on batteries', async () => {
    const { sim } = await setup('full');
    sim.set('C:ACP1_VOICE', 1);
    sim.run(0.1);
    expect(sim.get('L:ACP1_VOICE_ON')).toBe(1);
    power(sim, 'bat');
    sim.run(0.1);
    expect(sim.get('S:ACP1_POWERED')).toBe(1);
    expect(sim.get('S:ACP2_POWERED')).toBe(0);
    expect(sim.get('L:ACP2_TX_VHF1')).toBe(0);
    power(sim, 'none');
    sim.run(0.1);
    expect(sim.get('L:ACP1_VOICE_ON')).toBe(0);
    expect(sim.get('L:ACP1_TX_VHF1')).toBe(0);
  });

  it('INT/RAD switch state', async () => {
    const { sim } = await setup('full');
    sim.set('C:ACP1_INT_RAD', 0);
    sim.run(0.1);
    expect(sim.get('S:ACP1_INT_RAD')).toBe(-1);
    sim.set('C:ACP1_INT_RAD', 2);
    sim.run(0.1);
    expect(sim.get('S:ACP1_INT_RAD')).toBe(1);
  });
});
