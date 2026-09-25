import type { DamageReportInput, DocAgency, DocDamage, DocRental, FrozenContract } from '../types';

export const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
export const PNG = 'data:image/png;base64,iVBORw0KGgo=';

// 24 Sep 2026 15:05:32 UTC
export const T0 = Date.UTC(2026, 8, 24, 15, 5, 32);
export const TZ = 120;

export const agency: DocAgency = {
  name: 'Coastline <Rentals> & Co',
  address: '1 Harbour Rd',
  phone: '+30 210 000',
  email: null,
  registrationNumber: 'GR-123',
  reportFooter: 'Thank you for renting with us.',
  logo: PNG,
};

export const rental: DocRental = {
  reference: 'R-0142',
  customer: {
    fullName: 'Jane "JJ" Smith',
    phone: '+44 7700 900',
    address: null,
    licenceNumber: 'SMITH901',
    idNumber: null,
    notes: null,
  },
  vehicle: { plate: 'AB-123-CD', make: 'Renault', model: 'Clio', year: 2021, color: 'White', vin: null },
  distanceUnit: 'km',
  startedAt: T0,
  expectedReturnAt: T0 + 2 * 86_400_000,
  startMileage: 12_000,
  startFuelEighths: 8,
  returnedAt: T0 + 2 * 86_400_000,
  returnMileage: 12_345,
  returnFuelEighths: 4,
  returnNotes: null,
  returnRevision: 1,
};

export function damage(p: Partial<DocDamage> & Pick<DocDamage, 'id' | 'status' | 'number'>): DocDamage {
  return {
    type: 'dent',
    severity: null,
    locationLabel: null,
    note: null,
    foundPhase: p.status === 'pre_existing' ? 'before' : 'after',
    angleKey: 'front_left',
    slot: 1,
    angleLabel: 'Front left',
    closeup: null,
    ...p,
  };
}

export const FROZEN_HTML =
  '<h1>Rental agreement</h1>\n<p>I, <strong>Jane &quot;JJ&quot; Smith</strong>, accept the vehicle.</p>\n' +
  '<ul><li>Existing A · Scratch <img src="carcheck-photo:p-1" alt="Front left"></li></ul>\n' +
  '<svg viewBox="0 0 4 3" aria-label="Rear"><image href="carcheck-photo:p-2" width="4" height="3"/><circle cx="1" cy="1" r=".2"/><text>A</text></svg>\n' +
  '<p>Text mentioning carcheck-photo:p-9 stays text.</p>';

export function contract(p: Partial<FrozenContract> = {}): FrozenContract {
  return {
    id: 'c-1',
    rentalId: 'r-1',
    sequence: 1,
    templateVersion: 3,
    renderedHtml: FROZEN_HTML,
    signerName: 'Jane "JJ" Smith',
    signedAt: T0,
    tzOffsetMin: TZ,
    contentSha256: '3F9A1C2B77D0E41D' + '0'.repeat(48),
    void: null,
    ...p,
  };
}

export function reportInput(p: Partial<DamageReportInput> = {}): DamageReportInput {
  return {
    agency,
    rental,
    damages: [],
    evidence: [],
    returnPhotos: [],
    pickupPhotos: [],
    contracts: [],
    generatedAt: T0 + 3 * 86_400_000,
    tzOffsetMin: TZ,
    ...p,
  };
}
