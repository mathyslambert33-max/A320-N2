import { describe, expect, it } from 'vitest';
import { avionicsNormal, closeDoors, engineRunning, rig, set } from './helpers';

describe('memos in a typical cold & dark → ready for taxi sequence', () => {
  it('shows the right memos at each step', async () => {
    const r = await rig((sim) => {
      closeDoors(sim);
      avionicsNormal(sim);
      // IRS aligning, position not yet entered
      for (const n of [1, 2, 3]) set(sim, { [`S:ADIRS_IR${n}_STATE`]: 1, [`S:ADIRS_IR${n}_ALIGN_REMAIN`]: 560 });
      set(sim, { 'S:ADIRS_POS_ENTERED': 0 });
    });
    const { sim } = r;
    sim.run(1);
    expect(r.left()).toContain('IRS IN ALIGN > 7 MN');
    expect(r.right()).toContain('PARK BRK');

    // alignment progressing
    for (const n of [1, 2, 3]) sim.set(`S:ADIRS_IR${n}_ALIGN_REMAIN`, 250);
    sim.run(0.5);
    expect(r.left()).toContain('IRS IN ALIGN 5 MN');

    // IRS aligned, seat belts / no smoking
    for (const n of [1, 2, 3]) set(sim, { [`S:ADIRS_IR${n}_STATE`]: 2, [`S:ADIRS_IR${n}_ALIGN_REMAIN`]: 0 });
    set(sim, { 'S:ADIRS_POS_ENTERED': 1, 'C:SIGNS_SEAT_BELTS': 0, 'C:SIGNS_NO_SMOKING': 0 });
    sim.run(0.5);
    expect(r.left()).toEqual(expect.arrayContaining(['SEAT BELTS', 'NO SMOKING']));
    expect(r.left().some((l) => l.startsWith('IRS'))).toBe(false);

    // APU started, APU BLEED on
    set(sim, { 'C:APU_MASTER': 1, 'S:APU_AVAIL': 1, 'S:APU_N': 100, 'C:AIR_APU_BLEED': 1, 'S:APU_BLEED_VALVE': 1 });
    sim.run(0.5);
    // APU AVAIL is replaced by APU BLEED while the APU bleed valve is open
    expect(r.right()).toContain('APU BLEED');
    expect(r.right()).not.toContain('APU AVAIL');

    // engine start: ENG MODE IGN/START
    sim.set('C:ENG_MODE', 2);
    sim.run(0.5);
    expect(r.right()).toContain('IGNITION');
    engineRunning(sim, 2);
    sim.run(40);
    engineRunning(sim, 1);
    sim.run(5);
    sim.set('C:ENG_MODE', 1);
    set(sim, { 'C:AIR_APU_BLEED': 0, 'S:APU_BLEED_VALVE': 0 });
    sim.run(1);
    expect(r.right()).not.toContain('IGNITION');
    expect(r.right()).toContain('APU AVAIL');
    expect(r.ecam.flightPhase()).toBe(2);

    // T.O memo 2 minutes after the 2nd engine start
    expect(sim.get('S:FWC_TO_MEMO')).toBe(0);
    sim.run(120);
    expect(sim.get('S:FWC_TO_MEMO')).toBe(1);
    const left = r.left();
    expect(left[0]).toBe('T.O AUTO BRK.....MAX');
    expect(left).toEqual(expect.arrayContaining(['SIGNS ON', 'CABIN......CHECK', 'SPLRS........ARM', 'FLAPS........T.O', 'T.O CONFIG..TEST']));

    // items completed turn green and change wording
    set(sim, { 'S:AUTOBRK_MODE': 3, 'C:SPDBRK_ARM': 1, 'G:CABIN_READY': 1, 'C:FLAPS_LEVER': 1, 'S:FCTL_SLATS': 18, 'S:FCTL_FLAPS': 10, 'S:FCTL_FLAPS_CONF': 1.5 });
    sim.run(1);
    expect(r.left()).toEqual(expect.arrayContaining(['T.O AUTO BRK MAX', 'SIGNS ON', 'CABIN READY', 'SPLRS ARM', 'FLAPS T.O']));
    // parking brake released for taxi
    sim.set('C:PARK_BRK', 0);
    sim.run(0.5);
    expect(r.right()).not.toContain('PARK BRK');
  });
});
