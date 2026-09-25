/** @jest-environment node */
import {
  addDamage,
  addPhoto,
  completeReturn,
  ConflictError,
  confirmMarksChecked,
  createDraftRental,
  deleteDamage,
  deletePhoto,
  getPhoto,
  ImmutableError,
  getAnglePairs,
  getRentalFacts,
  listDamage,
  listInspectionAngles,
  listPhotos,
  markPairReviewed,
  nextFreeSlot,
  retakePhoto,
  setAngleSkipped,
  setPairAlignment,
  InvalidStateError,
} from '../repos';
import { inspectionProgress } from '@/domain/rentalLifecycle';
import { readyDraft, returnInProgress, ring } from './support/scenario';
import { setupTestData, type TestData } from './support/testData';

let t: TestData;
beforeEach(async () => {
  t = await setupTestData();
});
afterEach(async () => {
  await t.close();
});

describe('photos', () => {
  it('stores the file under photos/<rental>/<photo>.jpg and refuses a second canonical shot', async () => {
    const { rentalId, before } = await readyDraft(t);
    expect(before.front.file.path).toBe(`photos/${rentalId}/${before.front.id}.jpg`);
    expect(t.files.stored.has(before.front.file.path)).toBe(true);
    expect(before.front.captureOrder).toBe(1);
    await expect(addPhoto({ rentalId, phase: 'before', image: t.image(), angleKey: 'front' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('cannot take AFTER photos on a draft', async () => {
    const draft = await createDraftRental();
    await expect(addPhoto({ rentalId: draft.id, phase: 'after', image: t.image(), angleKey: 'front' })).rejects.toBeInstanceOf(
      InvalidStateError,
    );
  });

  it('retake replaces the photo, keeps the marks and deletes the old file after commit', async () => {
    const { rentalId, before } = await readyDraft(t);
    const mark = await addDamage({ photoId: before.left.id, marker: ring(0.4, 0.4) });
    const retaken = await retakePhoto(before.left.id, t.image('retaken'));
    expect(retaken.id).not.toBe(before.left.id);
    expect([retaken.angleKey, retaken.slot, retaken.captureOrder]).toEqual(['left', 1, 9]);
    const [moved] = await listDamage(rentalId);
    expect(moved.id).toBe(mark.id);
    expect(moved.beforePhotoId).toBe(retaken.id);
    expect(moved.marker.ring).toEqual({ x: 0.4, y: 0.4, r: 0.06 });
    // Pick-up retakes prompt in the start flow instead; only return photos carry the flag.
    expect(retaken.marksCheckNeeded).toBe(false);
    expect(t.files.stored.has(before.left.file.path)).toBe(false);
    expect(t.files.stored.get(retaken.file.path)).toBe('retaken');
    expect(t.files.droppedDerivatives).toContain(before.left.id);
    expect((await listPhotos(rentalId, { phase: 'before' })).length).toBe(8);
  });

  it('flags a retaken return photo with marks until the employee confirms them (review M2)', async () => {
    const { rentalId, after } = await returnInProgress(t);
    await addDamage({ photoId: after.front.id, marker: ring(0.3, 0.3), status: 'new' });
    const unmarked = await retakePhoto(after.rear.id, t.image('rear again'));
    expect(unmarked.marksCheckNeeded).toBe(false);
    const retaken = await retakePhoto(after.front.id, t.image('front again'));
    expect(retaken.marksCheckNeeded).toBe(true);
    expect((await getAnglePairs(rentalId)).find((p) => p.angleKey === 'front')?.after?.marksCheckNeeded).toBe(true);
    // A second retake keeps asking; confirming clears it.
    const again = await retakePhoto(retaken.id, t.image('front third'));
    expect(again.marksCheckNeeded).toBe(true);
    await confirmMarksChecked(again.id);
    expect((await getPhoto(again.id)).marksCheckNeeded).toBe(false);
  });

  it('ends the marks check when the marks are gone, and freezes with the return', async () => {
    const { rentalId, after } = await returnInProgress(t);
    const mark = await addDamage({ photoId: after.left.id, marker: ring(), status: 'new' });
    const retaken = await retakePhoto(after.left.id, t.image('left again'));
    expect(retaken.marksCheckNeeded).toBe(true);
    await deleteDamage(mark.id);
    expect((await getPhoto(retaken.id)).marksCheckNeeded).toBe(false);

    await addDamage({ photoId: retaken.id, marker: ring(), status: 'new' });
    const flagged = await retakePhoto(retaken.id, t.image('left once more'));
    await completeReturn(rentalId, {});
    // Completing anyway is allowed (a warning, not a lock); afterwards the photo is evidence.
    await expect(confirmMarksChecked(flagged.id)).rejects.toBeInstanceOf(ImmutableError);
  });

  it('deleting a photo removes its marks and renumbers the rest', async () => {
    const { rentalId, before } = await readyDraft(t);
    await addDamage({ photoId: before.front.id, marker: ring() });
    await addDamage({ photoId: before.rear.id, marker: ring() });
    await deletePhoto(before.front.id);
    const left = await listDamage(rentalId);
    expect(left.map((d) => [d.angleKey, d.number])).toEqual([['rear', 1]]);
  });
});

describe('skips and progress', () => {
  it('counts skipped angles as done and clears the skip when a photo arrives', async () => {
    const draft = await createDraftRental();
    await addPhoto({ rentalId: draft.id, phase: 'before', image: t.image(), angleKey: 'front' });
    await setAngleSkipped(draft.id, 'before', { angleKey: 'rear', slot: 1 }, { reason: 'blocked' });
    await expect(setAngleSkipped(draft.id, 'before', { angleKey: 'front', slot: 1 }, { reason: null })).rejects.toBeInstanceOf(
      ConflictError,
    );
    let progress = inspectionProgress((await getRentalFacts(draft.id)).before);
    expect([progress.done, progress.captured, progress.skipped]).toEqual([2, 1, 1]);
    await addPhoto({ rentalId: draft.id, phase: 'before', image: t.image(), angleKey: 'rear' });
    progress = inspectionProgress((await getRentalFacts(draft.id)).before);
    expect([progress.done, progress.captured, progress.skipped]).toEqual([2, 2, 0]);
    const views = await listInspectionAngles(draft.id, 'before');
    expect(views.slice(0, 9).map((v) => v.angleKey)).toEqual([
      'front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right', 'dashboard',
    ]);
    expect(views.find((v) => v.angleKey === 'rear')?.state?.skippedAt).toBeNull();
  });
});

describe('pairing', () => {
  it('pairs BEFORE and AFTER by angle and slot; unpaired extras keep one side', async () => {
    const { rentalId, before, after } = await returnInProgress(t);
    const pairs0 = await getAnglePairs(rentalId);
    expect(pairs0.map((p) => p.angleKey)).toEqual([
      'front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right',
    ]);
    const slot = await nextFreeSlot(rentalId, 'closeup');
    expect(slot).toBe(1);
    await addPhoto({ rentalId, phase: 'after', image: t.image(), angleKey: 'closeup', slot, label: 'Close-up 1' });
    const mark = await addDamage({ photoId: after.rear.id, marker: ring(), status: 'uncertain' });
    await markPairReviewed(rentalId, { angleKey: 'rear', slot: 1 });
    await setPairAlignment(rentalId, { angleKey: 'rear', slot: 1 }, { dx: 0.01, dy: -0.02, scale: 1.03 });

    const pairs = await getAnglePairs(rentalId);
    const rear = pairs.find((p) => p.angleKey === 'rear')!;
    expect(rear.before?.id).toBe(before.rear.id);
    expect(rear.after?.id).toBe(after.rear.id);
    expect(rear.uncertainDamageCount).toBe(1);
    expect(rear.afterState?.reviewedAt).not.toBeNull();
    expect(rear.afterState?.alignment).toEqual({ dx: 0.01, dy: -0.02, scale: 1.03 });
    const closeup = pairs[pairs.length - 1];
    expect([closeup.angleKey, closeup.before, closeup.after?.label]).toEqual(['closeup', null, 'Close-up 1']);
    expect(mark.beforePhotoId).toBe(before.rear.id);
  });
});
