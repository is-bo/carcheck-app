/** @jest-environment node */
import { STARTER_TEMPLATE_BODY } from '@/domain/contract';
import { contractHashPreimage } from '@/domain/types';

import {
  addDamage,
  getActiveTemplate,
  getRental,
  ImmutableError,
  InvalidStateError,
  listContracts,
  listPhotos,
  listTemplateVersions,
  LockedError,
  prepareContract,
  resetTemplateToDefault,
  retakePhoto,
  deletePhoto,
  saveTemplateVersion,
  setRentalCustomer,
  signContract,
  updateAgencySettings,
  updateRentalDetails,
  verifyContract,
  voidContract,
  ValidationError,
  ConflictError,
} from '../repos';
import { readyDraft, ring, sign, signedRental, snapshot } from './support/scenario';
import { setupTestData, sha256Hex, type TestData } from './support/testData';

let t: TestData;
beforeEach(async () => {
  t = await setupTestData();
});
afterEach(async () => {
  await t.close();
});

describe('contract templates', () => {
  it('seeds the starter template as version 1', async () => {
    const active = await getActiveTemplate();
    expect(active.version).toBe(1);
    expect(active.body).toBe(STARTER_TEMPLATE_BODY);
  });

  it('saves new versions append-only and resets to the starter text as a new version', async () => {
    await saveTemplateVersion({ title: 'Mine', body: '# Hello {{customer.name}}' });
    await saveTemplateVersion({ title: 'Mine', body: '# Hello {{customer.name}}' }); // unchanged: no new version
    const reset = await resetTemplateToDefault();
    expect(reset.version).toBe(3);
    expect((await listTemplateVersions()).map((v) => v.version)).toEqual([3, 2, 1]);
    await expect(t.db.runAsync("UPDATE contract_template SET body = 'x' WHERE version = 1")).rejects.toThrow('CARCHECK_IMMUTABLE');
  });
});

describe('prepare and sign', () => {
  it('assigns the reference at review, once, with the configured prefix', async () => {
    await updateAgencySettings({ rentalRefPrefix: 'x2' });
    const { rentalId } = await readyDraft(t);
    const first = await prepareContract(rentalId);
    const again = await prepareContract(rentalId);
    expect(first.rental.reference).toBe('X2-0001');
    expect(again.rental.reference).toBe('X2-0001');
    expect(first.blockers).toEqual([]);
    expect(first.render.html).toContain('X2-0001');
    expect(first.render.unknownKeys).toEqual([]);
  });

  it('refuses to prepare before every exterior angle is photographed or skipped', async () => {
    const { rentalId, before } = await readyDraft(t);
    await deletePhoto(before.rear.id);
    await expect(prepareContract(rentalId)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('reports unknown template variables as a blocker', async () => {
    const { rentalId } = await readyDraft(t);
    await saveTemplateVersion({ title: 'Broken', body: 'Hello {{customer.nme}}' });
    const prep = await prepareContract(rentalId);
    expect(prep.blockers).toContain('unknown_variables');
    expect(prep.render.html).toContain('[missing: customer.nme]');
    await expect(
      signContract({
        rentalId,
        templateId: prep.template.id,
        renderedHtml: prep.render.html,
        variables: prep.render.variables,
        signerName: 'Jane Smith',
        signature: t.files.addTemp('sig'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('freezes the contract, activates the rental and freezes every pick-up photo', async () => {
    const { rentalId, contract } = await signedRental(t);
    const rental = await getRental(rentalId);
    expect(rental.status).toBe('active');
    expect(rental.activatedAt).toBe(contract.signedAt);
    expect(contract.sequence).toBe(1);
    expect(contract.signature.path).toBe(`signatures/${rentalId}/${contract.id}.png`);
    expect(t.files.stored.has(contract.signature.path)).toBe(true);
    const photos = await listPhotos(rentalId, { phase: 'before' });
    expect(photos.every((p) => p.frozenAt === contract.signedAt)).toBe(true);

    const expected = sha256Hex(
      contractHashPreimage({
        rentalId,
        sequence: 1,
        templateId: contract.templateId,
        templateVersion: contract.templateVersion,
        signerName: 'Jane Smith',
        signedAt: contract.signedAt,
        tzOffsetMin: 120,
        signatureSha256: contract.signature.sha256,
        variablesJson: JSON.stringify(contract.variables),
        renderedHtml: contract.renderedHtml,
      }),
    );
    expect(contract.contentSha256).toBe(expected);
    expect(await verifyContract(contract.id)).toEqual({ ok: true, problems: [] });
  });

  it('refuses HTML that references anything but contract photos and the signature', async () => {
    const { rentalId } = await readyDraft(t);
    const prep = await prepareContract(rentalId);
    await expect(
      signContract({
        rentalId,
        templateId: prep.template.id,
        renderedHtml: `${prep.render.html}<img src="https://example.com/x.png">`,
        variables: prep.render.variables,
        signerName: 'Jane Smith',
        signature: t.files.addTemp('sig'),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect([...t.files.stored.keys()].some((k) => k.startsWith('signatures/'))).toBe(false);
  });
});

describe('signed evidence is immutable', () => {
  it('rejects any update or delete of a signed contract, in code and in SQL', async () => {
    const { contract } = await signedRental(t);
    await expect(t.db.runAsync('UPDATE signed_contract SET signer_name = ? WHERE id = ?', ['Mallory', contract.id])).rejects.toThrow(
      'CARCHECK_IMMUTABLE',
    );
    await expect(t.db.runAsync('DELETE FROM signed_contract WHERE id = ?', [contract.id])).rejects.toThrow('CARCHECK_IMMUTABLE');
    await expect(t.db.runAsync('DELETE FROM rental WHERE id = ?', [contract.rentalId])).rejects.toThrow('CARCHECK_IMMUTABLE');
  });

  it('locks pick-up photos, damage and the snapshot after signing', async () => {
    const { rentalId, before } = await signedRental(t);
    await expect(retakePhoto(before.front.id, t.image())).rejects.toBeInstanceOf(ImmutableError);
    await expect(deletePhoto(before.front.id)).rejects.toBeInstanceOf(ImmutableError);
    await expect(addDamage({ photoId: before.front.id, marker: ring() })).rejects.toBeInstanceOf(LockedError);
    await expect(setRentalCustomer(rentalId, { snapshot: snapshot('Someone Else') })).rejects.toBeInstanceOf(LockedError);
    await expect(updateRentalDetails(rentalId, { startMileage: 99 })).rejects.toBeInstanceOf(LockedError);
    // The trigger is the backstop even if code were bypassed.
    await expect(t.db.runAsync("UPDATE rental SET cust_full_name = 'X' WHERE id = ?", [rentalId])).rejects.toThrow('CARCHECK_LOCKED');
    // Operational due date stays editable.
    await expect(updateRentalDetails(rentalId, { expectedReturnAt: t.clock.now + 86_400_000 })).resolves.toBeDefined();
  });

  it('detects a tampered signature file', async () => {
    const { contract } = await signedRental(t);
    t.files.stored.set(contract.signature.path, 'forged');
    expect(await verifyContract(contract.id)).toEqual({ ok: false, problems: ['The signature image has changed.'] });
  });
});

describe('void and re-sign', () => {
  it('unlocks the snapshot after a void and chains the new contract', async () => {
    const { rentalId, contract } = await signedRental(t);
    await expect(prepareContract(rentalId)).rejects.toBeInstanceOf(LockedError);
    await expect(
      signContract({
        rentalId,
        templateId: contract.templateId,
        renderedHtml: contract.renderedHtml,
        variables: contract.variables,
        signerName: 'Jane Smith',
        signature: t.files.addTemp('second signature'),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const voided = await voidContract(contract.id, 'Wrong licence number');
    expect(voided.void?.reason).toBe('Wrong licence number');
    await expect(voidContract(contract.id)).rejects.toBeInstanceOf(ConflictError);

    await setRentalCustomer(rentalId, { snapshot: snapshot('Jane Smith', { licenceNumber: 'SMITH1' }) });
    const second = await sign(t, rentalId);
    expect(second.sequence).toBe(2);
    expect(second.supersedesId).toBe(contract.id);
    expect(second.variables['customer.licence_number']).toBe('SMITH1');
    expect((await getRental(rentalId)).reference).toBe('R-0001');
    const all = await listContracts(rentalId);
    expect(all.map((c) => [c.sequence, c.void !== null])).toEqual([
      [1, true],
      [2, false],
    ]);
    // The first contract still shows exactly what was signed.
    expect(all[0].renderedHtml).toBe(contract.renderedHtml);
  });
});
