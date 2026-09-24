/** @jest-environment node */
import { damageLabel } from '@/domain/damage';

import {
  addDamage,
  completeReturn,
  confirmKnownDamage,
  createDraftRental,
  deleteDamage,
  getDamage,
  listDamage,
  listKnownDamage,
  listKnownDamageForRental,
  LockedError,
  resolveKnownDamage,
  setRentalCustomer,
  setRentalVehicle,
  startReturn,
  updateDamage,
  ValidationError,
} from '../repos';
import { capture, readyDraft, returnInProgress, ring, sign, snapshot } from './support/scenario';
import { setupTestData, type TestData } from './support/testData';

let t: TestData;
beforeEach(async () => {
  t = await setupTestData();
});
afterEach(async () => {
  await t.close();
});

const labels = async (rentalId: string) =>
  (await listDamage(rentalId)).map((d) => `${d.status}:${damageLabel(d)}`);

describe('damage numbering', () => {
  it('letters pick-up damage A, B, C and compacts after a delete', async () => {
    const { rentalId, before } = await readyDraft(t);
    const a = await addDamage({ photoId: before.front.id, marker: ring(0.2, 0.2), type: 'scratch' });
    const b = await addDamage({ photoId: before.front.id, marker: ring(0.6, 0.6) });
    await addDamage({ photoId: before.rear.id, marker: ring() });
    expect([a.status, a.foundPhase, a.beforePhotoId, a.afterPhotoId]).toEqual(['pre_existing', 'before', before.front.id, null]);
    expect(await labels(rentalId)).toEqual(['pre_existing:A', 'pre_existing:B', 'pre_existing:C']);
    await deleteDamage(b.id);
    expect(await labels(rentalId)).toEqual(['pre_existing:A', 'pre_existing:B']);
  });

  it('refuses a non pre-existing status at pick-up', async () => {
    const { before } = await readyDraft(t);
    await expect(addDamage({ photoId: before.front.id, marker: ring(), status: 'new' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('shares one sequence between new and uncertain, and moves "Was there" to the letters', async () => {
    const { rentalId, before, after } = await returnInProgress(t);
    const n1 = await addDamage({ photoId: after.front.id, marker: ring() });
    const n2 = await addDamage({ photoId: after.left.id, marker: ring(), status: 'uncertain' });
    const n3 = await addDamage({ photoId: after.rear.id, marker: ring() });
    expect(n1.beforePhotoId).toBe(before.front.id);
    expect(n1.afterPhotoId).toBe(after.front.id);
    expect(await labels(rentalId)).toEqual(['new:1', 'uncertain:2', 'new:3']);

    // Flipping new <-> uncertain never renumbers.
    expect((await updateDamage(n1.id, { status: 'uncertain' })).number).toBe(1);
    // "Was there": takes the next letter, the number sequence closes the gap.
    const wasThere = await updateDamage(n2.id, { status: 'pre_existing' });
    expect(damageLabel(wasThere)).toBe('A');
    expect(await labels(rentalId)).toEqual(['pre_existing:A', 'uncertain:1', 'new:2']);
    expect((await getDamage(n3.id)).number).toBe(2);
  });

  it('keeps locked pick-up letters while return marks compact around them', async () => {
    const draft = await readyDraft(t);
    await addDamage({ photoId: draft.before.front.id, marker: ring() });
    await addDamage({ photoId: draft.before.rear.id, marker: ring() });
    await sign(t, draft.rentalId);
    await startReturn(draft.rentalId);
    const after = await capture(t, draft.rentalId, 'after');
    const c = await addDamage({ photoId: after.left.id, marker: ring(), status: 'pre_existing' });
    const d = await addDamage({ photoId: after.right.id, marker: ring(), status: 'pre_existing' });
    expect([damageLabel(c), damageLabel(d)]).toEqual(['C', 'D']);
    await deleteDamage(c.id);
    expect(await labels(draft.rentalId)).toEqual(['pre_existing:A', 'pre_existing:B', 'pre_existing:C']);
    // Pick-up marks are part of the signed contract.
    const pickUp = (await listDamage(draft.rentalId, { phase: 'before' }))[0];
    await expect(deleteDamage(pickUp.id)).rejects.toBeInstanceOf(LockedError);
    await expect(updateDamage(pickUp.id, { note: 'x' })).rejects.toBeInstanceOf(LockedError);
  });

  it('locks return marks when the return is completed', async () => {
    const { rentalId, after } = await returnInProgress(t);
    const mark = await addDamage({ photoId: after.front.id, marker: ring() });
    await completeReturn(rentalId, { returnMileage: 100 });
    await expect(updateDamage(mark.id, { type: 'dent' })).rejects.toBeInstanceOf(LockedError);
    await expect(t.db.runAsync('DELETE FROM damage WHERE id = ?', [mark.id])).rejects.toThrow('CARCHECK_LOCKED');
  });
});

describe('known damage carry-over', () => {
  it('offers the previous rental damage and records "Still there" under the same identity', async () => {
    const first = await readyDraft(t);
    const scratch = await addDamage({ photoId: first.before.front.id, marker: ring(0.3, 0.3), type: 'scratch', note: 'bumper' });
    await sign(t, first.rentalId);
    await startReturn(first.rentalId);
    await capture(t, first.rentalId, 'after');
    await completeReturn(first.rentalId);

    const known = await listKnownDamage(first.vehicle.id);
    expect(known).toHaveLength(1);
    expect(known[0].latest.id).toBe(scratch.id);
    expect(known[0].latestPhoto.id).toBe(first.before.front.id);

    const next = await createDraftRental();
    await setRentalVehicle(next.id, first.vehicle.id);
    await setRentalCustomer(next.id, { snapshot: snapshot('Ann Lee') });
    const before = await capture(t, next.id, 'before');
    const carried = await confirmKnownDamage(next.id, known[0].vehicleDamage.id, before.front.id, ring(0.31, 0.3));
    expect([carried.vehicleDamageId, carried.type, carried.note, damageLabel(carried)]).toEqual([
      scratch.vehicleDamageId,
      'scratch',
      'bumper',
      'A',
    ]);
    const forRental = await listKnownDamageForRental(next.id);
    expect(forRental[0].observationInRental?.id).toBe(carried.id);
    expect(forRental[0].latest.id).toBe(scratch.id);

    await resolveKnownDamage(known[0].vehicleDamage.id, 'repaired', { rentalId: next.id });
    expect(await listKnownDamage(first.vehicle.id)).toEqual([]);
  });
});
