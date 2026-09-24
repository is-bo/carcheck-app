import { deriveCounterpart, type Size } from '../../geometry';
import { badgeLabel, badgeShapeFor, markerVisual, sequenceLetter } from '../markerStyle';
import { pairMarkers, photoMarkers, type MarkedDamage } from '../pairMarkers';

const B: Size = { width: 4032, height: 3024 };
const A: Size = { width: 3024, height: 4032 };

const newDent: MarkedDamage = {
  id: 'n1',
  status: 'new',
  number: 1,
  foundPhase: 'after',
  marker: { v: 1, ring: { x: 0.6, y: 0.4, r: 0.05 } },
};
const unsure: MarkedDamage = {
  id: 'u2',
  status: 'uncertain',
  number: 2,
  foundPhase: 'after',
  marker: { v: 1, ring: { x: 0.2, y: 0.7, r: 0.04 }, counterpart: { x: 0.25, y: 0.66, r: 0.06 } },
};
const scuff: MarkedDamage = {
  id: 'e1',
  status: 'pre_existing',
  number: 1,
  foundPhase: 'before',
  marker: { v: 1, ring: { x: 0.8, y: 0.8, r: 0.03 } },
};
const wasThere: MarkedDamage = { ...scuff, id: 'e2', number: 2, foundPhase: 'after' };

describe('pairMarkers', () => {
  it('puts each damage on the photo it was marked on, with a dashed counterpart on the other', () => {
    const { before, after } = pairMarkers([newDent, scuff], { before: B, after: A });
    expect(after.map((m) => `${m.key}/${m.role}`)).toEqual(['n1/primary']);
    expect(before.map((m) => `${m.key}/${m.role}`)).toEqual(['n1:cp/counterpart', 'e1/primary']);
    const cp = before.find((m) => m.role === 'counterpart')!;
    expect(cp.ring).toEqual(deriveCounterpart(newDent.marker.ring, 'afterToBefore', B, A));
    expect(cp.follow).toEqual({ dir: 'afterToBefore', before: B, after: A, alignment: undefined });
    expect(cp.label).toBe('1');
  });

  it('uses a stored counterpart override and does not make it follow drags', () => {
    const { before } = pairMarkers([unsure], { before: B, after: A });
    expect(before[0].ring).toEqual(unsure.marker.counterpart);
    expect(before[0].follow).toBeUndefined();
    expect(before[0].label).toBe('2?');
  });

  it('projects pick-up damage onto AFTER only when asked', () => {
    expect(pairMarkers([scuff], { before: B, after: A }).after).toHaveLength(0);
    const on = pairMarkers([scuff], { before: B, after: A, showExistingOnAfter: true }).after;
    expect(on).toHaveLength(1);
    expect(on[0].role).toBe('counterpart');
    expect(on[0].label).toBe('A');
  });

  it('treats "Was there" found at return as a solid ring on AFTER', () => {
    const { before, after } = pairMarkers([wasThere], { before: B, after: A });
    expect(after[0].role).toBe('primary');
    expect(after[0].label).toBe('B');
    expect(before[0].role).toBe('counterpart');
  });

  it('applies the alignment to derived counterparts', () => {
    const alignment = { dx: 0.05, dy: -0.02, scale: 1.1 };
    const { before } = pairMarkers([newDent], { before: B, after: A, alignment });
    expect(before[0].ring).toEqual(deriveCounterpart(newDent.marker.ring, 'afterToBefore', B, A, alignment));
  });

  it('orders counterparts under existing under new/uncertain', () => {
    const { before } = pairMarkers([scuff, newDent, unsure], { before: B, after: A });
    expect(before.map((m) => m.key)).toEqual(['n1:cp', 'u2:cp', 'e1']);
  });
});

describe('photoMarkers', () => {
  it('returns only the damages marked on that phase', () => {
    expect(photoMarkers([newDent, scuff], 'before').map((m) => m.key)).toEqual(['e1']);
    expect(photoMarkers([newDent, scuff], 'after').map((m) => m.key)).toEqual(['n1']);
  });
});

describe('markerStyle', () => {
  it('labels pre-existing damage with letters and uncertain with "?"', () => {
    expect([1, 2, 26, 27, 52, 53, 702, 703].map(sequenceLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(badgeLabel('pre_existing', 3)).toBe('C');
    expect(badgeLabel('new', 3)).toBe('3');
    expect(badgeLabel('uncertain', 4)).toBe('4?');
  });

  it('encodes status by shape and "same area" by dashes only', () => {
    expect(badgeShapeFor('pre_existing')).toBe('square');
    expect(badgeShapeFor('new')).toBe('circle');
    expect(badgeShapeFor('uncertain')).toBe('diamond');
    for (const s of ['pre_existing', 'new', 'uncertain'] as const) {
      expect(markerVisual(s, 'primary').dashed).toBe(false);
      const cp = markerVisual(s, 'counterpart');
      expect(cp.dashed).toBe(true);
      expect(cp.hollow).toBe(true);
      expect(cp.shape).toBe(badgeShapeFor(s));
    }
    expect(markerVisual('pre_existing', 'primary').hollow).toBe(true);
    expect(markerVisual('new', 'primary').hollow).toBe(false);
  });
});
