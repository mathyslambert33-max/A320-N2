import { describe, expect, it } from 'vitest';
import { setup, power, press, xpdrKeys } from './helpers';
import { ENTRY_TIMEOUT, IDENT_TIME, validCode } from '../../src/cockpit/pedestal/logic/xpdr';

describe('ATC transponder / TCAS panel', () => {
  it('validates octal codes', () => {
    expect(validCode(2000)).toBe(true);
    expect(validCode(7777)).toBe(true);
    expect(validCode(1238)).toBe(false);
    expect(validCode(12345)).toBe(false);
  });

  it('keeps the previous code until the 4th digit is entered', async () => {
    const { sim, ped } = await setup('full');
    expect(sim.get('S:XPDR_CODE')).toBe(2000);
    xpdrKeys(sim, ['4', '5', '2']);
    expect(ped.xpdr.windowText()).toBe('452 ');
    expect(sim.get('S:XPDR_CODE')).toBe(2000);
    expect(sim.get('S:XPDR_ENTRY')).toBe(1);
    xpdrKeys(sim, ['1']);
    expect(sim.get('S:XPDR_CODE')).toBe(4521);
    expect(ped.xpdr.windowText()).toBe('4521');
    // 8 / 9 do not exist on the keyboard
    xpdrKeys(sim, ['8']);
    expect(ped.xpdr.windowText()).toBe('4521');
  });

  it('CLR erases the last digit, or blanks the window; an unfinished entry is abandoned', async () => {
    const { sim, ped } = await setup('full');
    xpdrKeys(sim, ['7', '0']);
    xpdrKeys(sim, ['CLR']);
    expect(ped.xpdr.windowText()).toBe('7   ');
    xpdrKeys(sim, ['CLR', 'CLR']);
    expect(ped.xpdr.windowText()).toBe('    ');
    sim.run(ENTRY_TIMEOUT + 1);
    expect(ped.xpdr.windowText()).toBe('2000');
    expect(sim.get('S:XPDR_ENTRY')).toBe(0);
  });

  it('ignores the keyboard without power', async () => {
    const { sim } = await setup('bat');
    xpdrKeys(sim, ['7', '7', '0', '0']);
    expect(sim.get('S:XPDR_CODE')).toBe(2000);
    expect(sim.get('S:XPDR_PANEL_POWERED')).toBe(0);
  });

  it('modes: STBY silent, AUTO = mode S only on ground, ON replies; IDENT for 18 s', async () => {
    const { sim } = await setup('full');
    sim.set('G:AC_ON_GROUND', 1);
    sim.run(0.1);
    expect(sim.get('S:XPDR_MODE')).toBe(0);
    expect(sim.get('S:XPDR_REPLY')).toBe(0);
    press(sim, 'XPDR_IDENT');
    expect(sim.get('S:XPDR_IDENT')).toBe(0); // no IDENT in STBY
    sim.set('C:XPDR_MODE', 1);
    sim.run(0.1);
    expect(sim.get('S:XPDR_REPLY')).toBe(1);
    sim.set('G:AC_ON_GROUND', 0);
    sim.run(0.1);
    expect(sim.get('S:XPDR_REPLY')).toBe(2);
    press(sim, 'XPDR_IDENT');
    expect(sim.get('S:XPDR_IDENT')).toBe(1);
    sim.run(IDENT_TIME + 0.5);
    expect(sim.get('S:XPDR_IDENT')).toBe(0);
  });

  it('ATC FAIL when the selected transponder is lost (not in STBY); SYS 2 on AC 2', async () => {
    const { sim } = await setup('full');
    sim.set('C:XPDR_MODE', 2);
    sim.run(0.1);
    expect(sim.get('L:XPDR_FAIL')).toBe(0);
    sim.set('S:ELEC_AC_ESS_SHED', 0);
    sim.set('S:ELEC_AC_ESS_BUS', 0);
    sim.run(0.1);
    expect(sim.get('S:XPDR_SYS')).toBe(1);
    expect(sim.get('L:XPDR_FAIL')).toBe(1);
    sim.set('C:XPDR_SYS', 1); // select XPDR 2
    sim.run(0.1);
    expect(sim.get('S:XPDR_SYS')).toBe(2);
    expect(sim.get('L:XPDR_FAIL')).toBe(0);
    sim.emit('xpdr:fail', { sys: 2 });
    sim.run(0.1);
    expect(sim.get('L:XPDR_FAIL')).toBe(1);
    sim.set('C:XPDR_MODE', 0);
    sim.run(0.1);
    expect(sim.get('L:XPDR_FAIL')).toBe(0);
  });

  it('TCAS operates only with the transponder replying and altitude reporting ON', async () => {
    const { sim } = await setup('full');
    sim.set('G:AC_ON_GROUND', 0);
    sim.set('C:TCAS_MODE', 2);
    sim.run(0.1);
    expect(sim.get('S:TCAS_MODE')).toBe(2);
    expect(sim.get('S:TCAS_STATE')).toBe(0); // XPDR in STBY
    sim.set('C:XPDR_MODE', 1);
    sim.run(0.1);
    expect(sim.get('S:TCAS_STATE')).toBe(2);
    sim.set('C:XPDR_ALT_RPTG', 1); // OFF
    sim.run(0.1);
    expect(sim.get('S:TCAS_STATE')).toBe(0);
    expect(sim.get('S:XPDR_ALT_RPTG')).toBe(0);
    power(sim, 'bat');
    sim.run(0.1);
    expect(sim.get('S:TCAS_POWERED')).toBe(0);
  });
});
