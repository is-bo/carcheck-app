import type { GeneratedArtifact } from '@/domain/types';

import { damagesForPair, evidenceInputs, obsoleteEvidence, planEvidence } from '../evidencePlan';
import { damage, pair } from './fixtures';

describe('planEvidence', () => {
  it('creates one target per angle with new or uncertain damage', () => {
    const pairs = [pair('front'), pair('left'), pair('rear')];
    const damages = [damage('front', 'new', 1), damage('rear', 'uncertain', 2), damage('left', 'pre_existing', 1)];
    const plan = planEvidence(pairs, damages);
    expect(plan.targets.map((t) => t.angleKey)).toEqual(['front', 'rear']);
    expect(plan.withoutBefore).toEqual([]);
  });

  it('gives angles without damage no evidence image', () => {
    expect(planEvidence([pair('front')], []).targets).toEqual([]);
  });

  it('reports damaged angles that have no pick-up photo', () => {
    const plan = planEvidence([pair('front', { before: null })], [damage('front', 'new', 1)]);
    expect(plan.targets).toEqual([]);
    expect(plan.withoutBefore.map((p) => p.angleKey)).toEqual(['front']);
  });

  it('ignores extras that were not photographed at return', () => {
    expect(planEvidence([pair('front', { after: null })], [damage('front', 'new', 1)]).targets).toEqual([]);
  });

  it('keys by slot, not only angle', () => {
    const pairs = [pair('closeup', { slot: 1 }), pair('closeup', { slot: 2 })];
    const plan = planEvidence(pairs, [damage('closeup', 'new', 1, { slot: 2 })]);
    expect(plan.targets.map((t) => t.slot)).toEqual([2]);
  });
});

describe('damagesForPair', () => {
  it('draws return marks and pick-up marks in caption order', () => {
    const existing = damage('front', 'pre_existing', 1);
    const wasThere = damage('front', 'pre_existing', 2, { foundPhase: 'after' });
    const n2 = damage('front', 'uncertain', 2);
    const n1 = damage('front', 'new', 1);
    const other = damage('rear', 'new', 3);
    const out = damagesForPair({ angleKey: 'front', slot: 1 }, [existing, wasThere, n2, n1, other]);
    expect(out.map((d) => d.id)).toEqual([n1.id, n2.id, existing.id, wasThere.id]);
  });
});

describe('obsoleteEvidence', () => {
  const artifact = (angleKey: string): GeneratedArtifact => ({
    id: `a-${angleKey}`,
    rentalId: 'r1',
    kind: 'evidence_image',
    pairKey: { angleKey, slot: 1 },
    contractId: null,
    file: { path: `generated/r1/a-${angleKey}.jpg`, byteSize: 1, sha256: 'x' },
    mimeType: 'image/jpeg',
    width: 1,
    height: 1,
    pageCount: null,
    sourceFingerprint: 'f',
    generatedAt: 0,
  });

  it('lists evidence of angles that no longer have new damage', () => {
    const out = obsoleteEvidence([artifact('front'), artifact('rear')], [{ angleKey: 'front', slot: 1 }]);
    expect(out.map((a) => a.id)).toEqual(['a-rear']);
  });
});

describe('evidenceInputs', () => {
  it('maps photos, labels and damage captions', () => {
    const p = pair('rear_left', { label: 'Rear left' });
    const d = damage('rear_left', 'new', 1, { type: 'scratch', severity: 'moderate', locationLabel: 'rear door', note: 'deep' });
    const [target] = planEvidence([p], [d]).targets;
    const inputs = evidenceInputs(target, {
      rental: {
        reference: 'R-0142',
        vehicle: { plate: 'AB-123-CD', make: 'Renault', model: 'Clio', year: null, color: null, vin: null },
        returnedAt: Date.UTC(2026, 2, 15, 16, 40),
      },
      agencyName: 'Coastline Rentals',
      displayUri: (photo) => `file:///display/${photo.id}.jpg`,
    });
    expect(inputs.angleLabel).toBe('Rear left');
    expect(inputs.rentalRef).toBe('R-0142');
    expect(inputs.vehicleLabel).toBe('Renault Clio · AB-123-CD');
    expect(inputs.dateLabel).toBe('Returned 15 Mar 2026, 17:40');
    expect(inputs.before.timeLabel).toBe('Pick-up · 12 Mar 2026, 10:14');
    expect(inputs.before.uri).toBe(`file:///display/${p.before!.id}.jpg`);
    expect(inputs.after.size).toEqual({ width: 4032, height: 3024 });
    expect(inputs.after.sha256).toBe(p.after!.file.sha256);
    expect(inputs.damages).toEqual([
      expect.objectContaining({ status: 'new', number: 1, typeLabel: 'Scratch', severityLabel: 'Moderate', locationLabel: 'rear door', note: 'deep' }),
    ]);
  });

  it('labels damage without a type', () => {
    const [target] = planEvidence([pair('front')], [damage('front', 'new', 1, { type: null })]).targets;
    const inputs = evidenceInputs(target, {
      rental: { reference: null, vehicle: null, returnedAt: null },
      agencyName: null,
      displayUri: () => 'x',
    });
    expect(inputs.damages[0].typeLabel).toBe('Damage (type not set)');
    expect(inputs.rentalRef).toBe('');
    expect(inputs.vehicleLabel).toBeNull();
  });
});
