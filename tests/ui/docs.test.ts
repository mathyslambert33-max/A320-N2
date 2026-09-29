/** EFB documents and reference data (checklists, SOP, OFP, loadsheet, perf, weather). */
import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../../src/core/scenario';
import { ChecklistState, normalChecklists } from '../../src/ui/checklists';
import { sopSections } from '../../src/ui/sop';
import { FUEL_PLAN, loadsheetText, navlog, ofpText, perfTo, schedule, weatherDocs, wt } from '../../src/ui/ofp';

describe('normal checklist', () => {
  it('has the Airbus COCKPIT PREP / BEFORE START / AFTER START items in English', () => {
    const cl = normalChecklists('day');
    expect(cl.map((c) => c.title)).toEqual(['COCKPIT PREP', 'BEFORE START', 'AFTER START']);
    const items = cl.flatMap((c) => c.items.map((i) => i.item));
    for (const it of ['GEAR PINS & COVERS', 'FUEL QUANTITY', 'SEAT BELTS', 'ADIRS', 'BARO REF', 'PARKING BRAKE', 'T.O SPEEDS & THRUST', 'WINDOWS', 'BEACON', 'ANTI ICE', 'ECAM STATUS', 'PITCH TRIM', 'RUDDER TRIM']) {
      expect(items).toContain(it);
    }
    expect(cl[0].items.find((i) => i.item === 'BARO REF')!.hint).toBe('QNH 1017');
    expect(normalChecklists('night')[0].items.find((i) => i.item === 'BARO REF')!.hint).toBe('QNH 1019');
    expect(normalChecklists('day', 'lbs')[0].items.find((i) => i.item === 'FUEL QUANTITY')!.resp).toMatch(/LB/);
  });

  it('tracks ticks and completion', () => {
    const lists = normalChecklists('day');
    const s = new ChecklistState(lists);
    const events: Array<[string, boolean]> = [];
    s.onComplete((id, c) => events.push([id, c]));
    for (let i = 0; i < lists[1].items.length; i++) s.toggle('before_start', i);
    expect(s.isComplete('before_start')).toBe(true);
    s.toggle('before_start', 0);
    expect(s.isComplete('before_start')).toBe(false);
    s.reset('before_start');
    expect(s.count('before_start')).toBe(0);
    expect(events).toEqual([['before_start', true], ['before_start', false]]);
  });
});

describe('SOP reference', () => {
  it('covers cold & dark → engines started in order', () => {
    const s = sopSections('day');
    expect(s.map((x) => x.en)).toEqual(['SAFETY EXTERIOR INSPECTION', 'PRELIMINARY COCKPIT PREPARATION', 'COCKPIT PREPARATION', 'BEFORE PUSHBACK OR START', 'ENGINE START', 'AFTER START']);
    const text = JSON.stringify(s);
    expect(text).toMatch(/ENG MASTER 2/);
    expect(text).toMatch(/V1 142, VR 144, V2 148, FLEX TO TEMP 58/);
  });
});

describe('OFP / loadsheet / perf / weather', () => {
  it('fuel plan sums to the block fuel and the navlog matches the FMGS distance', () => {
    const f = FUEL_PLAN;
    expect(f.trip.kg + f.cont.kg + f.altn.kg + f.finres.kg + f.extra.kg + f.taxi.kg).toBe(SCENARIO.weights.blockFuel);
    const nl = navlog();
    expect(nl[0].ident).toBe('LFBD');
    expect(nl[nl.length - 1].ident).toBe('LFPO');
    expect(nl.map((r) => r.ident)).toContain('CNA');
    expect(nl.map((r) => r.ident)).toContain('AMB');
    expect(nl.map((r) => r.ident)).toContain('ODILO');
    const total = nl[nl.length - 1].cum;
    expect(Math.abs(total - SCENARIO.flight.distanceNm)).toBeLessThan(3);
    expect(nl[nl.length - 1].timeMin).toBeCloseTo(55, 0);
    expect(nl[nl.length - 1].efobKg).toBeCloseTo(SCENARIO.weights.blockFuel - SCENARIO.weights.taxiFuel - SCENARIO.weights.tripFuel, 0);
    expect(nl.some((r) => r.fl === '350')).toBe(true);
  });

  it('documents render with the scenario values', () => {
    const ofp = ofpText('day', 'kg');
    expect(ofp).toMatch(/SIM6205/);
    expect(ofp).toMatch(/BLOCK FUEL\s+6200/);
    expect(ofp).toMatch(/STD 1240Z/);
    expect(schedule('night').std).toBe(21 * 60 + 40);
    const lbs = ofpText('day', 'lbs');
    expect(lbs).toMatch(new RegExp(`BLOCK FUEL\\s+${wt(6200, 'lbs')}`));
    const ls = loadsheetText('day', 'kg', true, 156);
    expect(ls).toMatch(/LOADSHEET FINAL/);
    expect(ls).toMatch(/ZERO FUEL WEIGHT ACTUAL\s+57554/);
    expect(ls).toMatch(/TAKE OFF WEIGHT\s+ACTUAL\s+63554/);
    expect(loadsheetText('day', 'kg', false, 40)).toMatch(/PRELIMINARY/);
    const p = perfTo('day');
    expect([p.v1, p.vr, p.v2, p.flex]).toEqual([142, 144, 148, 58]);
    expect(p.headwind).toBeGreaterThan(5);
    const wx = weatherDocs('dusk');
    expect(wx.docs.map((d) => d.station)).toEqual(['LFBD', 'LFPO', 'LFPG']);
    expect(wx.docs[0].metar).toMatch(/Q1018/);
    expect(wx.decoded.join(' ')).toMatch(/QNH 1018/);
  });
});
