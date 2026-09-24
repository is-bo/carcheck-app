/** Builders for repository tests: a draft ready to sign, a signed rental, a return in progress. */
import type { CustomerSnapshot, Photo, SignedContractWithState } from '@/domain/types';
import { EXTERIOR_ANGLE_KEYS } from '@/domain/types';

import {
  addPhoto,
  createDraftRental,
  createVehicle,
  prepareContract,
  setRentalCustomer,
  setRentalVehicle,
  signContract,
  startReturn,
  updateAgencySettings,
} from '../../repos';
import type { TestData } from './testData';

export function snapshot(fullName: string, extra: Partial<CustomerSnapshot> = {}): CustomerSnapshot {
  return { fullName, phone: null, address: null, licenceNumber: null, idNumber: null, notes: null, ...extra };
}

export type AnglePhotos = Record<string, Photo>;

export async function capture(t: TestData, rentalId: string, phase: 'before' | 'after'): Promise<AnglePhotos> {
  const photos: AnglePhotos = {};
  for (const key of EXTERIOR_ANGLE_KEYS) {
    photos[key] = await addPhoto({ rentalId, phase, image: t.image(`${phase}-${key}-${Math.random()}`), angleKey: key });
  }
  return photos;
}

export async function readyDraft(t: TestData, plate = 'AB-123-CD') {
  await updateAgencySettings({ name: 'Coastline Rentals' });
  const vehicle = await createVehicle({ plate, make: 'Renault', model: 'Clio' });
  const draft = await createDraftRental();
  await setRentalVehicle(draft.id, vehicle.id);
  await setRentalCustomer(draft.id, { snapshot: snapshot('Jane Smith') });
  const before = await capture(t, draft.id, 'before');
  return { vehicle, rentalId: draft.id, before };
}

export async function sign(t: TestData, rentalId: string): Promise<SignedContractWithState> {
  const prep = await prepareContract(rentalId, { tzOffsetMin: 120 });
  return signContract({
    rentalId,
    templateId: prep.template.id,
    renderedHtml: prep.render.html,
    variables: prep.render.variables,
    signerName: 'Jane Smith',
    signature: t.files.addTemp(`png-signature-${Math.random()}`),
    tzOffsetMin: 120,
  });
}

export async function signedRental(t: TestData, plate?: string) {
  const draft = await readyDraft(t, plate);
  const contract = await sign(t, draft.rentalId);
  return { ...draft, contract };
}

export async function returnInProgress(t: TestData) {
  const signed = await signedRental(t);
  await startReturn(signed.rentalId);
  const after = await capture(t, signed.rentalId, 'after');
  return { ...signed, after };
}

export const ring = (x = 0.5, y = 0.5, r = 0.06) => ({ v: 1 as const, ring: { x, y, r } });
