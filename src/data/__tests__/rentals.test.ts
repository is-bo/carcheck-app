/** @jest-environment node */
import {
  addCustomerDocument,
  addPhoto,
  archiveVehicle,
  cancelRental,
  completeReturn,
  ConflictError,
  createDraftRental,
  createVehicle,
  discardDraft,
  getArtifactStatus,
  getCustomerDetail,
  getHome,
  getRental,
  getVehicle,
  getVehicleDetail,
  InvalidStateError,
  listPhotos,
  listVehicles,
  LockedError,
  removeCustomer,
  removeVehicle,
  reopenReturn,
  saveArtifact,
  searchRentals,
  setRentalCustomer,
  setRentalVehicle,
  startReturn,
  subscribeDataChanges,
  updateCustomer,
  updateRentalDetails,
  updateVehicle,
  voidContract,
  pickRentalCustomer,
  listCustomerDocuments,
} from '../repos';
import { capture, readyDraft, returnInProgress, sign, signedRental, snapshot } from './support/scenario';
import { setupTestData, type TestData } from './support/testData';

let t: TestData;
beforeEach(async () => {
  t = await setupTestData();
});
afterEach(async () => {
  await t.close();
});

describe('vehicles', () => {
  it('deletes an unused vehicle, archives a used one and refuses while it is out', async () => {
    const unused = await createVehicle({ plate: ' zz 11 ', make: '' });
    expect([unused.plate, unused.make]).toEqual(['zz 11', null]);
    expect(await removeVehicle(unused.id)).toBe('deleted');

    const { vehicle, rentalId } = await signedRental(t);
    await expect(removeVehicle(vehicle.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(archiveVehicle(vehicle.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await listVehicles())[0].out?.rentalId).toBe(rentalId);

    await startReturn(rentalId);
    await capture(t, rentalId, 'after');
    await completeReturn(rentalId, { returnMileage: 1200 });
    expect(await removeVehicle(vehicle.id)).toBe('archived');
    expect((await getVehicle(vehicle.id)).mileage).toBe(1200);
    expect(await listVehicles()).toEqual([]);
    expect((await listVehicles({ includeArchived: true }))[0].vehicle.id).toBe(vehicle.id);
    const detail = await getVehicleDetail(vehicle.id);
    expect(detail.history.map((h) => h.rental.id)).toEqual([rentalId]);
  });

  it('refreshes the snapshot of drafts only, never of signed rentals', async () => {
    const { vehicle, rentalId } = await signedRental(t);
    const other = await createVehicle({ plate: 'KL-555-AA' });
    const draft = await createDraftRental();
    await setRentalVehicle(draft.id, other.id);
    await updateVehicle(other.id, { model: 'Yaris' });
    await updateVehicle(vehicle.id, { model: 'Megane' });
    expect((await getRental(draft.id)).vehicle?.model).toBe('Yaris');
    expect((await getRental(rentalId)).vehicle?.model).toBe('Clio');
  });

  it('will not put a vehicle that is out on a second rental', async () => {
    const { vehicle } = await signedRental(t);
    const draft = await createDraftRental();
    await expect(setRentalVehicle(draft.id, vehicle.id)).rejects.toMatchObject({ reason: 'vehicle_out' });
  });
});

describe('customers', () => {
  it('keeps an inline customer on the rental only, or saves it as a profile with its documents', async () => {
    const draft = await createDraftRental();
    const licence = await addCustomerDocument({ rentalId: draft.id }, t.image('licence'), 'licence');
    expect(licence.file.path).toBe(`docs/r-${draft.id}/${licence.id}.jpg`);

    let rental = await setRentalCustomer(draft.id, { snapshot: snapshot('Walk In') });
    expect([rental.customerId, rental.customer.fullName]).toEqual([null, 'Walk In']);

    rental = await setRentalCustomer(draft.id, { snapshot: snapshot('Jane Smith', { phone: '+44 1' }), saveAsProfile: true });
    expect(rental.customerId).not.toBeNull();
    const profile = await getCustomerDetail(rental.customerId!);
    expect(profile.customer.phone).toBe('+44 1');
    expect(profile.documents.map((d) => d.id)).toEqual([licence.id]);
    expect(await listCustomerDocuments({ rentalId: draft.id })).toEqual([]);

    // Discarding the draft must not take the profile's documents with it.
    await discardDraft(draft.id);
    expect(t.files.stored.has(licence.file.path)).toBe(true);
    expect(await removeCustomer(rental.customerId!)).toBe('deleted');
    expect(t.files.stored.has(licence.file.path)).toBe(false);
  });

  it('profile edits refresh drafts but never a signed snapshot', async () => {
    const { rentalId } = await readyDraft(t);
    const created = await setRentalCustomer(rentalId, { snapshot: snapshot('Jane Smith'), saveAsProfile: true });
    const customerId = created.customerId!;
    await sign(t, rentalId);
    const other = await createDraftRental();
    await pickRentalCustomer(other.id, customerId);
    await updateCustomer(customerId, { phone: '+33 6' });
    expect((await getRental(other.id)).customer.phone).toBe('+33 6');
    expect((await getRental(rentalId)).customer.phone).toBeNull();
    expect(await removeCustomer(customerId)).toBe('archived');
  });
});

describe('rental lifecycle', () => {
  it('discards a draft with its files but refuses once signed', async () => {
    const { rentalId, before } = await readyDraft(t);
    await discardDraft(rentalId);
    await expect(getRental(rentalId)).rejects.toMatchObject({ code: 'not_found' });
    expect(t.files.stored.has(before.front.file.path)).toBe(false);

    const signed = await signedRental(t, 'XY-987-ZZ');
    await expect(discardDraft(signed.rentalId)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('completes, locks, reopens and re-completes a return', async () => {
    const { rentalId } = await returnInProgress(t);
    let rental = await completeReturn(rentalId, { returnMileage: 500, returnFuelEighths: 4 });
    expect([rental.status, rental.returnRevision, rental.returnFuelEighths]).toEqual(['returned', 1, 4]);
    expect((await listPhotos(rentalId, { phase: 'after' })).every((p) => p.frozenAt !== null)).toBe(true);
    await expect(addPhoto({ rentalId, phase: 'after', image: t.image(), angleKey: 'dashboard' })).rejects.toBeInstanceOf(LockedError);

    rental = await reopenReturn(rentalId);
    expect(rental.returnReopenedAt).not.toBeNull();
    await addPhoto({ rentalId, phase: 'after', image: t.image(), angleKey: 'dashboard' });
    rental = await completeReturn(rentalId);
    expect([rental.returnRevision, rental.returnReopenedAt, rental.returnMileage]).toEqual([2, null, 500]);
  });

  it('cannot complete a return without an AFTER photo', async () => {
    const { rentalId } = await signedRental(t);
    await startReturn(rentalId);
    await expect(completeReturn(rentalId)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('cancels an active rental and freezes its photos', async () => {
    const { rentalId } = await signedRental(t);
    const rental = await cancelRental(rentalId, 'Customer changed plans');
    expect([rental.status, rental.cancelReason]).toEqual(['cancelled', 'Customer changed plans']);
    expect((await listPhotos(rentalId)).every((p) => p.frozenAt !== null)).toBe(true);
    await expect(updateRentalDetails(rentalId, { expectedReturnAt: null })).rejects.toBeInstanceOf(LockedError);
  });

  it('groups home into unfinished, due back, out and returned', async () => {
    const draft = await createDraftRental();
    const dueToday = await signedRental(t, 'AA-1');
    const outLater = await signedRental(t, 'BB-2');
    const voided = await signedRental(t, 'CC-3');
    const returned = await returnInProgress(t);
    await completeReturn(returned.rentalId);
    await voidContract(voided.contract.id);
    const now = t.clock.now;
    await updateRentalDetails(dueToday.rentalId, { expectedReturnAt: now + 60_000 });
    await updateRentalDetails(outLater.rentalId, { expectedReturnAt: now + 3 * 86_400_000 });

    const home = await getHome({ now, endOfToday: now + 3_600_000 });
    expect(home.unfinished.map((i) => i.rental.id).sort()).toEqual([draft.id, voided.rentalId].sort());
    expect(home.unfinished.find((i) => i.rental.id === voided.rentalId)?.derived.needsSignature).toBe(true);
    expect(home.dueBack.map((i) => i.rental.id)).toEqual([dueToday.rentalId]);
    expect(home.out.map((i) => i.rental.id)).toEqual([outLater.rentalId]);
    expect(home.returned.map((i) => i.rental.id)).toEqual([returned.rentalId]);
    expect(home.dueBack[0].beforeProgress).toEqual({ done: 8, total: 8 });
  });

  it('finds rentals by plate, customer name and reference', async () => {
    const { rentalId } = await signedRental(t, 'AB-123-CD');
    for (const q of ['ab123', 'jane', 'R-0001', '0001']) {
      expect((await searchRentals(q)).map((r) => r.rental.id)).toEqual([rentalId]);
    }
    expect(await searchRentals('nobody')).toEqual([]);
  });

  it('emits a data-change event after each committed write', async () => {
    const events: string[][] = [];
    const off = subscribeDataChanges((e) => events.push([...e.entities]));
    await createDraftRental();
    off();
    await createDraftRental();
    expect(events).toEqual([['rental']]);
  });
});

describe('artifacts', () => {
  it('tracks staleness by fingerprint and replaces the file on regeneration', async () => {
    const { rentalId } = await returnInProgress(t);
    const target = { kind: 'evidence_image' as const, pairKey: { angleKey: 'rear', slot: 1 } };
    expect((await getArtifactStatus(rentalId, target, 'fp1')).status).toBe('missing');
    const first = await saveArtifact(rentalId, target, t.files.addTemp('evidence v1'), { mimeType: 'image/jpeg', sourceFingerprint: 'fp1' });
    expect(first.file.path).toBe(`generated/${rentalId}/${first.id}.jpg`);
    expect((await getArtifactStatus(rentalId, target, 'fp1')).status).toBe('fresh');
    expect((await getArtifactStatus(rentalId, target, 'fp2')).status).toBe('stale');
    const second = await saveArtifact(rentalId, target, t.files.addTemp('evidence v2'), { mimeType: 'image/jpeg', sourceFingerprint: 'fp2' });
    expect(t.files.stored.has(first.file.path)).toBe(false);
    expect(t.files.stored.get(second.file.path)).toBe('evidence v2');
    expect((await getArtifactStatus(rentalId, target, 'fp2')).artifact?.id).toBe(second.id);
  });
});
