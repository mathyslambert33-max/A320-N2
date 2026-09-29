import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { CONTROLS } from '../../src/core/catalog';

/** Catalog lights this module drives (RMP 1-3, ACP 1-3, ATC FAIL). */
const OWN_PANEL = /^(PED_RMP\d|PED_ACP\d|OVHD_ACP3|PED_ATC)$/;

describe('pedestal module (headless install)', () => {
  it('installs its logic without a DOM and writes every light of the panels it owns', async () => {
    const { sim } = await setup('full');
    sim.run(0.5);
    const lights = CONTROLS.filter((d) => OWN_PANEL.test(d.panel)).flatMap((d) => (d.leg ?? []).map((l) => l.light));
    expect(lights.length).toBeGreaterThan(80);
    const missing = lights.filter((l) => !sim.has(`L:${l}`));
    expect(missing).toEqual([]);
    expect(sim.services.pedestal).toBeTruthy();
  });

  it('is dark at cold & dark (no bus powered)', async () => {
    const { sim } = await setup('none');
    sim.run(0.5);
    const lit = sim.names().filter((n) => n.startsWith('L:') && sim.get(n) > 0);
    expect(lit).toEqual([]);
  });

  it('registers the extra controls (reception knob push/pull, AIDS PRINT, DFDR EVENT) with cold & dark values', async () => {
    const { sim } = await setup('full');
    expect(sim.get('C:ACP1_RX_VHF1_ON')).toBe(1);
    expect(sim.get('C:ACP2_RX_ADF1_ON')).toBe(0);
    expect(CONTROLS.some((d) => d.id === 'AIDS_PRINT')).toBe(true);
    expect(CONTROLS.some((d) => d.id === 'DFDR_EVENT')).toBe(true);
  });
});
