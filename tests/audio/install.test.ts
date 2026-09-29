import { describe, expect, it } from 'vitest';
import { headlessApp } from '../../src/core/headless';
import install from '../../src/audio/index';
import { panelPosition, sfxSound } from '../../src/audio/oneshots';
import { CLICKS } from '../../src/audio/synth';
import { SELFTEST_STEPS } from '../../src/audio/selftest';

describe('audio module in a headless app', () => {
  it('installs as a no-op service without crashing', async () => {
    const app = headlessApp();
    install(app as any);
    const a = app.services.audio;
    expect(a).toBeTruthy();
    expect(a.context).toBeNull();
    await a.resume();
    a.setMuted(true);
    await a.selfTest();
    // Events emitted by other modules must not throw.
    app.sim.emit('sfx', { kind: 'pb', id: 'ELEC_BAT1', x: 0, y: 2, z: -0.5 });
    app.sim.emit('fwc:sound', { sound: 'SC' });
    app.sim.emit('cabin:chime');
    app.sim.run(1);
  });
});

describe('sfx mapping', () => {
  it('maps every kit kind to an existing sound', () => {
    for (const kind of ['pb', 'pbm', 'sw', 'swm', 'rot', 'rotm', 'pot', 'enc', 'key', 'guard', 'lever', 'detent', 'push', 'pull', 'weird']) {
      const s = sfxSound({ kind, id: 'X' });
      expect(CLICKS[s.key], kind).toBeTruthy();
    }
  });

  it('special controls get their own mechanics', () => {
    expect(sfxSound({ kind: 'sw', id: 'ENG_MASTER1' }).key).toBe('engMaster');
    expect(sfxSound({ kind: 'sw', id: 'PARK_BRK' }).key).toBe('parkBrake');
    expect(sfxSound({ kind: 'detent', id: 'GEAR_LEVER' }).key).toBe('gear');
    expect(sfxSound({ kind: 'detent', id: 'THR_LEVER1' }).key).toBe('detent');
    expect(sfxSound({ kind: 'lever', id: 'WINDOW_CAPT' }).key).toBe('window');
    expect(sfxSound({ kind: 'key', id: 'MCDU1_KEY_A' }).key).toBe('key');
    expect(sfxSound({ kind: 'pbm', id: 'X', up: true }).key).toBe('pbmUp');
  });

  it('fallback positions per panel are inside the flight deck', () => {
    for (const p of ['OVHD_ELEC', 'GLARE_FCU', 'MAIN_CAPT', 'PED_MCDU1', 'PED_THR', 'CONSOLE_FO', undefined]) {
      const [x, y, z] = panelPosition(p);
      expect(Math.abs(x)).toBeLessThan(1.2);
      expect(y).toBeGreaterThan(0.3);
      expect(y).toBeLessThan(2.4);
      expect(z).toBeGreaterThan(-1.3);
      expect(z).toBeLessThan(0.6);
    }
    expect(panelPosition('OVHD_ELEC')[1]).toBeGreaterThan(1.8);
    expect(panelPosition('PED_THR')[1]).toBeLessThan(1.0);
  });

  it('self-test covers every sound family', () => {
    for (const s of ['clicks', 'alerts', 'cabin', 'fans', 'packs', 'ptu', 'apu', 'engine', 'wipers', 'window', 'tug', 'gpu', 'ambience']) {
      expect(SELFTEST_STEPS).toContain(s);
    }
  });
});
