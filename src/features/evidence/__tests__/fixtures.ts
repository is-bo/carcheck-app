import type { AnglePair, Damage, DamageStatus, InspectionAngleState, Phase, Photo } from '@/domain/types';

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export function photo(phase: Phase, angleKey: string, over: Partial<Photo> = {}): Photo {
  const id = over.id ?? nextId(`${phase}-${angleKey}`);
  return {
    id,
    rentalId: 'r1',
    inspectionId: `i-${phase}`,
    phase,
    kind: 'angle',
    angleKey,
    slot: 1,
    label: null,
    captureOrder: 1,
    capturedAt: Date.UTC(2026, 2, phase === 'before' ? 12 : 15, 9, 14),
    tzOffsetMin: 60,
    file: { path: `photos/r1/${id}.jpg`, byteSize: 1000, sha256: `sha-${id}`, width: 4032, height: 3024 },
    frozenAt: null,
    createdAt: 0,
    marksCheckNeeded: false,
    ...over,
  };
}

export function angleState(over: Partial<InspectionAngleState> = {}): InspectionAngleState {
  return {
    inspectionId: 'i-after',
    angleKey: 'front',
    slot: 1,
    skippedAt: null,
    skipReason: null,
    reviewedAt: null,
    alignment: null,
    updatedAt: 0,
    ...over,
  };
}

export function pair(angleKey: string, over: Partial<AnglePair> = {}): AnglePair {
  return {
    angleKey,
    slot: 1,
    label: angleKey.replace('_', ' '),
    group: angleKey === 'dashboard' ? 'dashboard' : ['interior', 'wheel', 'roof', 'closeup', 'other'].includes(angleKey) ? 'extra' : 'exterior',
    before: photo('before', angleKey),
    after: photo('after', angleKey),
    beforeState: null,
    afterState: null,
    existingDamageCount: 0,
    newDamageCount: 0,
    uncertainDamageCount: 0,
    ...over,
  };
}

export function damage(angleKey: string, status: DamageStatus, number: number, over: Partial<Damage> = {}): Damage {
  const foundPhase: Phase = over.foundPhase ?? (status === 'pre_existing' ? 'before' : 'after');
  return {
    id: nextId(`d-${angleKey}-${status}`),
    rentalId: 'r1',
    vehicleId: 'v1',
    vehicleDamageId: nextId('vd'),
    angleKey,
    slot: 1,
    foundPhase,
    status,
    number,
    type: 'dent',
    severity: null,
    locationLabel: null,
    note: null,
    beforePhotoId: null,
    afterPhotoId: null,
    closeupPhotoId: null,
    marker: { v: 1, ring: { x: 0.5, y: 0.5, r: 0.06 } },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

export const EXTERIOR = ['front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right'];
