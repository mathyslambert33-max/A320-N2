import { describe, expect, it } from 'vitest';
import { set, power, rig, turn, knob, pb, fmgs, irsAligned } from './helpers';
import { altStep } from '../../src/avionics/pfdnd/logic/fcu';

describe('FCU power-up', () => {
  it('is unpowered in cold & dark and initialises at power-up', async () => {
    const sim = await rig();
    expect(sim.getB('S:FCU_POWERED')).toBe(false);
    power(sim);
    sim.run(1);
    expect(sim.getB('S:FCU_POWERED')).toBe(true);
    expect(sim.get('S:FCU_ALT')).toBe(100);
    expect(sim.getB('S:FCU_SPD_MANAGED')).toBe(true);
    expect(sim.getB('S:FCU_HDG_MANAGED')).toBe(true);
    expect(sim.getB('S:FCU_FD1')).toBe(true);
    expect(sim.getB('S:FCU_FD2')).toBe(true);
    expect(sim.getB('S:EFIS1_BARO_STD')).toBe(true);
    expect(sim.getB('S:EFIS2_BARO_STD')).toBe(true);
    expect(sim.get('L:EFIS1_FD')).toBe(1);
    expect(sim.get('S:FCU_AP1')).toBe(0);
  });

  it('resets its selections after a power interruption', async () => {
    const sim = await rig({ warm: true });
    turn(sim, 'FCU_ALT', 5);
    expect(sim.get('S:FCU_ALT')).toBe(5000);
    pb(sim, 'EFIS1_FD');
    expect(sim.getB('S:FCU_FD1')).toBe(false);
    power(sim, false);
    sim.run(2);
    expect(sim.get('L:EFIS1_FD')).toBe(0);
    power(sim);
    sim.run(1);
    expect(sim.get('S:FCU_ALT')).toBe(100);
    expect(sim.getB('S:FCU_FD1')).toBe(true);
  });

  it('ignores the knobs when unpowered', async () => {
    const sim = await rig();
    turn(sim, 'FCU_ALT', 3);
    power(sim);
    sim.run(1);
    expect(sim.get('S:FCU_ALT')).toBe(100);
  });
});

describe('FCU ALT', () => {
  it('rounds to the selected increment', () => {
    expect(altStep(100, 1, 1000)).toBe(1000);
    expect(altStep(1000, 1, 1000)).toBe(2000);
    expect(altStep(1000, -1, 1000)).toBe(100);
    expect(altStep(1400, 1, 1000)).toBe(2000);
    expect(altStep(100, 1, 100)).toBe(200);
    expect(altStep(49000, 1, 1000)).toBe(49000);
  });

  it('uses the 100/1000 selector', async () => {
    const sim = await rig({ warm: true });
    turn(sim, 'FCU_ALT', 2);
    expect(sim.get('S:FCU_ALT')).toBe(2000);
    sim.set('C:FCU_ALT_INC', 0);
    turn(sim, 'FCU_ALT', 3);
    expect(sim.get('S:FCU_ALT')).toBe(2300);
    turn(sim, 'FCU_ALT', -30);
    expect(sim.get('S:FCU_ALT')).toBe(100);
    sim.set('C:FCU_ALT_INC', 1);
    turn(sim, 'FCU_ALT', 60);
    expect(sim.get('S:FCU_ALT')).toBe(49000);
  });

  it('has no effect on push/pull on ground', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    const events: string[] = [];
    sim.events.onAny((n) => { if (n.startsWith('fg:')) events.push(n); });
    knob(sim, 'FCU_ALT', 'pull');
    knob(sim, 'FCU_ALT', 'push');
    expect(events).toEqual([]);
  });
});

describe('FCU SPD', () => {
  it('pulls to selected speed, rotates and pushes back to managed', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    expect(sim.getB('S:FCU_SPD_DOT')).toBe(true);
    knob(sim, 'FCU_SPD', 'pull');
    expect(sim.getB('S:FCU_SPD_MANAGED')).toBe(false);
    expect(sim.get('S:FCU_SPD')).toBe(100);
    turn(sim, 'FCU_SPD', 42);
    expect(sim.get('S:FCU_SPD')).toBe(142);
    turn(sim, 'FCU_SPD', -100);
    expect(sim.get('S:FCU_SPD')).toBe(100);
    knob(sim, 'FCU_SPD', 'push');
    expect(sim.getB('S:FCU_SPD_MANAGED')).toBe(true);
  });

  it('shows a 10 s preselection when rotated in managed speed', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    set(sim, { 'S:FMGS_V2': 148 });
    sim.run(0.2);
    turn(sim, 'FCU_SPD', 2);
    expect(sim.getB('S:FCU_SPD_PRESET')).toBe(true);
    expect(sim.get('S:FCU_SPD')).toBe(150);
    sim.run(10.5);
    expect(sim.getB('S:FCU_SPD_PRESET')).toBe(false);
    expect(sim.getB('S:FCU_SPD_MANAGED')).toBe(true);
  });

  it('cannot be managed without FMGC', async () => {
    const sim = await rig({ warm: true });
    knob(sim, 'FCU_SPD', 'pull');
    knob(sim, 'FCU_SPD', 'push');
    expect(sim.getB('S:FCU_SPD_MANAGED')).toBe(false);
    expect(sim.getB('S:FCU_SPD_DOT')).toBe(false);
  });

  it('converts to Mach with the SPD/MACH pb', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    set(sim, { 'S:ADIRS_BARO_ALT_STD': 35000 });
    knob(sim, 'FCU_SPD', 'pull');
    turn(sim, 'FCU_SPD', 150); // 250 kt
    pb(sim, 'FCU_SPD_MACH');
    expect(sim.getB('S:FCU_SPD_IS_MACH')).toBe(true);
    expect(sim.get('S:FCU_SPD')).toBeGreaterThan(70);
    expect(sim.get('S:FCU_SPD')).toBeLessThan(80);
    pb(sim, 'FCU_SPD_MACH');
    expect(sim.get('S:FCU_SPD')).toBeGreaterThan(245);
    expect(sim.get('S:FCU_SPD')).toBeLessThan(255);
  });
});

describe('FCU HDG and V/S', () => {
  it('shows dashes with FD engaged and keeps a heading preset on ground', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    sim.run(0.5);
    expect(sim.getB('S:FG_FD1_ENGAGED')).toBe(true);
    expect(sim.getB('S:FCU_HDG_DASHES')).toBe(true);
    turn(sim, 'FCU_HDG', 3);
    expect(sim.getB('S:FCU_HDG_DASHES')).toBe(false);
    expect(sim.get('S:FCU_HDG')).toBe(300);
    sim.run(60);
    expect(sim.getB('S:FCU_HDG_PRESET')).toBe(true);
    expect(sim.getB('S:FCU_HDG_DASHES')).toBe(false);
    knob(sim, 'FCU_HDG', 'push');
    expect(sim.getB('S:FCU_HDG_DASHES')).toBe(true);
    knob(sim, 'FCU_HDG', 'pull');
    expect(sim.getB('S:FCU_HDG_MANAGED')).toBe(false);
    expect(sim.get('S:FCU_HDG')).toBe(297);
  });

  it('wraps the heading through 360', async () => {
    const sim = await rig({ warm: true });
    set(sim, { 'S:FCU_HDG': 358 });
    turn(sim, 'FCU_HDG', 5);
    expect(sim.get('S:FCU_HDG')).toBe(3);
    turn(sim, 'FCU_HDG', -10);
    expect(sim.get('S:FCU_HDG')).toBe(353);
  });

  it('V/S preset returns to dashes after 45 s', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    sim.run(0.5);
    expect(sim.getB('S:FCU_VS_DASHES')).toBe(true);
    turn(sim, 'FCU_VS', 5);
    expect(sim.get('S:FCU_VS')).toBe(500);
    expect(sim.getB('S:FCU_VS_DASHES')).toBe(false);
    sim.run(46);
    expect(sim.getB('S:FCU_VS_DASHES')).toBe(true);
    turn(sim, 'FCU_VS', 70);
    expect(sim.get('S:FCU_VS')).toBe(6000);
  });

  it('FPA steps 0.1 degree in TRK/FPA', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'FCU_HDG_TRK');
    expect(sim.getB('S:FCU_TRK_FPA')).toBe(true);
    turn(sim, 'FCU_VS', -3);
    expect(sim.get('S:FCU_FPA')).toBeCloseTo(-0.3, 5);
  });
});

describe('FCU AP / A-THR / approach pbs on ground', () => {
  it('engages the AP on ground with engines stopped only', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    pb(sim, 'FCU_AP1');
    expect(sim.getB('S:FCU_AP1')).toBe(true);
    expect(sim.get('L:FCU_AP1')).toBe(1);
    pb(sim, 'FCU_AP2');
    expect(sim.getB('S:FCU_AP1')).toBe(false);
    expect(sim.getB('S:FCU_AP2')).toBe(true);
    set(sim, { 'S:ENG1_RUNNING': 1 });
    sim.run(0.2);
    expect(sim.getB('S:FCU_AP2')).toBe(false);
    pb(sim, 'FCU_AP1');
    expect(sim.getB('S:FCU_AP1')).toBe(false);
  });

  it('needs attitude and FMGC for the AP', async () => {
    const sim = await rig({ warm: true, fmgs: true });
    pb(sim, 'FCU_AP1');
    expect(sim.getB('S:FCU_AP1')).toBe(false);
  });

  it('arms the A/THR on ground only with an engine running', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    pb(sim, 'FCU_ATHR');
    expect(sim.get('S:FCU_ATHR')).toBe(0);
    set(sim, { 'S:ENG2_RUNNING': 1 });
    pb(sim, 'FCU_ATHR');
    expect(sim.get('S:FCU_ATHR')).toBe(1);
    expect(sim.get('L:FCU_ATHR')).toBe(1);
    pb(sim, 'FCU_ATHR');
    expect(sim.get('S:FCU_ATHR')).toBe(0);
  });

  it('LOC, APPR and EXPED have no effect on ground', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    pb(sim, 'FCU_LOC');
    pb(sim, 'FCU_APPR');
    pb(sim, 'FCU_EXPED');
    expect(sim.get('L:FCU_LOC') + sim.get('L:FCU_APPR') + sim.get('L:FCU_EXPED')).toBe(0);
  });

  it('toggles METRIC ALT', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'FCU_METRIC_ALT');
    expect(sim.getB('S:FCU_METRIC_ALT')).toBe(true);
  });

  it('the takeover pb disconnects the AP', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    pb(sim, 'FCU_AP1');
    pb(sim, 'SIDESTICK_CAPT_TAKEOVER');
    expect(sim.getB('S:FCU_AP1')).toBe(false);
  });
});

describe('EFIS control panel', () => {
  it('pull = QNH, rotate, push = STD', async () => {
    const sim = await rig({ warm: true });
    knob(sim, 'EFIS1_BARO', 'pull');
    expect(sim.getB('S:EFIS1_BARO_STD')).toBe(false);
    turn(sim, 'EFIS1_BARO', 4);
    expect(sim.get('S:EFIS1_BARO_HPA')).toBe(1017);
    expect(sim.getB('S:EFIS2_BARO_STD')).toBe(true);
    knob(sim, 'EFIS1_BARO', 'push');
    expect(sim.getB('S:EFIS1_BARO_STD')).toBe(true);
    expect(sim.getB('S:EFIS1_BARO_PRESEL')).toBe(false);
    turn(sim, 'EFIS1_BARO', 1);
    expect(sim.getB('S:EFIS1_BARO_PRESEL')).toBe(true);
    expect(sim.get('S:EFIS1_BARO_HPA')).toBe(1018);
    knob(sim, 'EFIS1_BARO', 'pull');
    expect(sim.getB('S:EFIS1_BARO_STD')).toBe(false);
    expect(sim.get('S:EFIS1_BARO_HPA')).toBe(1018);
  });

  it('inHg steps of 0.01 and limits', async () => {
    const sim = await rig({ warm: true });
    knob(sim, 'EFIS1_BARO', 'pull');
    turn(sim, 'EFIS1_BARO', 4); // 1017 hPa
    sim.set('C:EFIS1_BARO_UNIT', 0);
    sim.run(0.1);
    expect(sim.getB('S:EFIS1_BARO_INHG')).toBe(true);
    turn(sim, 'EFIS1_BARO', 1);
    expect(Math.round((sim.get('S:EFIS1_BARO_HPA') / 33.8639) * 100) / 100).toBeCloseTo(30.04, 5);
    turn(sim, 'EFIS1_BARO', 500);
    expect(Math.round((sim.get('S:EFIS1_BARO_HPA') / 33.8639) * 100) / 100).toBeCloseTo(32.48, 5);
    sim.set('C:EFIS1_BARO_UNIT', 1);
    turn(sim, 'EFIS1_BARO', -500);
    expect(sim.get('S:EFIS1_BARO_HPA')).toBe(745);
  });

  it('ND option pushbuttons are exclusive', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'EFIS1_CSTR');
    expect(sim.get('S:EFIS1_OPTION')).toBe(1);
    expect(sim.get('L:EFIS1_CSTR')).toBe(1);
    pb(sim, 'EFIS1_ARPT');
    expect(sim.get('S:EFIS1_OPTION')).toBe(5);
    expect(sim.get('L:EFIS1_CSTR')).toBe(0);
    expect(sim.get('L:EFIS1_ARPT')).toBe(1);
    pb(sim, 'EFIS1_ARPT');
    expect(sim.get('S:EFIS1_OPTION')).toBe(0);
    expect(sim.get('S:EFIS2_OPTION')).toBe(0);
  });

  it('FD and LS pushbuttons', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'EFIS2_FD');
    expect(sim.getB('S:FCU_FD2')).toBe(false);
    expect(sim.get('L:EFIS2_FD')).toBe(0);
    pb(sim, 'EFIS2_LS');
    expect(sim.getB('S:FCU_LS2')).toBe(true);
    expect(sim.get('L:EFIS2_LS')).toBe(1);
  });

  it('ND mode / range selectors and change messages', async () => {
    const sim = await rig({ warm: true });
    expect(sim.get('S:EFIS1_ND_MODE')).toBe(3);
    expect(sim.get('S:EFIS1_ND_RANGE')).toBe(10);
    sim.set('C:EFIS1_ND_MODE', 2);
    sim.run(0.1);
    expect(sim.get('S:EFIS1_ND_MODE')).toBe(2);
    expect(sim.get('S:EFIS1_ND_MSG')).toBe(1);
    sim.run(1.2);
    expect(sim.get('S:EFIS1_ND_MSG')).toBe(0);
    sim.set('C:EFIS1_ND_RANGE', 2);
    sim.run(0.1);
    expect(sim.get('S:EFIS1_ND_RANGE')).toBe(40);
    expect(sim.get('S:EFIS1_ND_MSG')).toBe(2);
  });

  it('ADF/VOR selectors', async () => {
    const sim = await rig({ warm: true });
    expect(sim.get('S:EFIS1_NAV1')).toBe(0);
    sim.set('C:EFIS1_NAV1', 0);
    sim.set('C:EFIS1_NAV2', 2);
    sim.run(0.1);
    expect(sim.get('S:EFIS1_NAV1')).toBe(1);
    expect(sim.get('S:EFIS1_NAV2')).toBe(2);
  });

  it('CHRONO: start, stop, reset', async () => {
    const sim = await rig({ warm: true });
    pb(sim, 'CHRONO_CAPT');
    sim.run(65);
    pb(sim, 'CHRONO_CAPT');
    const t = sim.get('S:EFIS1_CHRONO_S');
    expect(t).toBeGreaterThanOrEqual(65);
    sim.run(10);
    expect(sim.get('S:EFIS1_CHRONO_S')).toBe(t);
    pb(sim, 'CHRONO_CAPT');
    expect(sim.get('S:EFIS1_CHRONO_STATE')).toBe(0);
  });

  it('TERR ON ND pb', async () => {
    const sim = await rig({ warm: true });
    sim.set('C:MAIN_TERR_ON_ND_CAPT', 1);
    sim.run(0.1);
    expect(sim.getB('S:EFIS1_TERR_ON_ND')).toBe(true);
    expect(sim.get('L:MAIN_TERR_ON_ND_CAPT_ON')).toBe(1);
    expect(sim.getB('S:EFIS2_TERR_ON_ND')).toBe(false);
  });
});

describe('FCU with FMGS', () => {
  it('lights the HDG managed dot with a flight plan', async () => {
    const sim = await rig({ warm: true, fmgs: true, irs: true });
    expect(sim.getB('S:FCU_HDG_DOT')).toBe(false);
    set(sim, { 'S:FMGS_FPLN_ACTIVE': 1 });
    sim.run(0.2);
    expect(sim.getB('S:FCU_HDG_DOT')).toBe(true);
    fmgs(sim, false);
    irsAligned(sim, false);
    sim.run(0.2);
    expect(sim.getB('S:FCU_HDG_DOT')).toBe(false);
  });
});
