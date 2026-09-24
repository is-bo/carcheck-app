import type { Rental, RentalListItem, VehicleListItem } from '@/domain/types';

import { dueBackMeta, rentalSubtitle, unfinishedMeta, vehicleModelLine, vehicleStatusLine } from '../display';

function rental(overrides: Partial<Rental> = {}): Rental {
  return {
    id: 'r1',
    reference: null,
    status: 'draft',
    vehicleId: null,
    customerId: null,
    customer: { fullName: null, phone: null, address: null, licenceNumber: null, idNumber: null, notes: null },
    vehicle: null,
    distanceUnit: 'km',
    startedAt: null,
    expectedReturnAt: null,
    startMileage: null,
    startFuelEighths: null,
    specialTerms: null,
    activatedAt: null,
    returnedAt: null,
    returnMileage: null,
    returnFuelEighths: null,
    returnNotes: null,
    returnRevision: 0,
    returnCompletedAt: null,
    returnReopenedAt: null,
    cancelledAt: null,
    cancelReason: null,
    resumeStep: 'vehicle',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function item(overrides: Partial<RentalListItem> = {}): RentalListItem {
  return {
    rental: rental(),
    derived: { needsSignature: false, returnInProgress: false, overdue: false },
    hasValidContract: false,
    contractCount: 0,
    beforeProgress: { done: 0, total: 8 },
    afterProgress: null,
    existingDamageCount: 0,
    newDamageCount: 0,
    uncertainDamageCount: 0,
    ...overrides,
  };
}

describe('rentalSubtitle / vehicleModelLine', () => {
  it('degrades gracefully before vehicle and customer are chosen', () => {
    expect(vehicleModelLine(rental())).toBeNull();
    expect(rentalSubtitle(rental())).toBe('New rental');
    expect(rentalSubtitle(rental({ customer: { ...rental().customer, fullName: 'J. Smith' } }))).toBe('J. Smith');
    const withVehicle = rental({
      vehicle: { plate: 'AB-123-CD', make: 'Renault', model: 'Clio', year: null, color: null, vin: null },
    });
    expect(vehicleModelLine(withVehicle)).toBe('Renault Clio');
    expect(rentalSubtitle(withVehicle)).toBe('Renault Clio');
    expect(
      rentalSubtitle({ ...withVehicle, customer: { ...withVehicle.customer, fullName: 'J. Smith' } }),
    ).toBe('Renault Clio · J. Smith');
  });
});

describe('unfinishedMeta', () => {
  it('shows inspection progress while capturing, and a step label otherwise', () => {
    expect(unfinishedMeta(item({ rental: rental({ resumeStep: 'capture' }), beforeProgress: { done: 3, total: 8 } })).text).toBe(
      'Inspection 3 of 8',
    );
    expect(unfinishedMeta(item({ rental: rental({ resumeStep: 'customer' }) })).text).toBe('Add the customer');
    expect(
      unfinishedMeta(item({ rental: rental({ status: 'active', resumeStep: 'details' }), derived: { needsSignature: true, returnInProgress: false, overdue: false } }))
        .text,
    ).toBe('Needs signature');
  });
});

describe('dueBackMeta', () => {
  it('reads "Overdue - was due <time>" only when actually overdue', () => {
    const due = Date.UTC(2026, 8, 24, 10, 0);
    const overdue = dueBackMeta(item({ rental: rental({ expectedReturnAt: due }), derived: { needsSignature: false, returnInProgress: false, overdue: true } }), due + 1000);
    expect(overdue.overdue).toBe(true);
    expect(overdue.text).toContain('Overdue');
    const upcoming = dueBackMeta(item({ rental: rental({ expectedReturnAt: due }) }), due - 1000);
    expect(upcoming.overdue).toBe(false);
  });
});

describe('vehicleStatusLine', () => {
  it('reports Available or Out with who and when', () => {
    const available: VehicleListItem = {
      vehicle: { id: 'v1', plate: 'AB-123', make: null, model: null, year: null, color: null, vin: null, mileage: null, photo: null, notes: null, createdAt: 0, updatedAt: 0, archivedAt: null },
      out: null,
      lastRentalAt: null,
    };
    expect(vehicleStatusLine(available)).toBe('Available');
    const out: VehicleListItem = { ...available, out: { rentalId: 'r1', reference: 'R-0001', customerName: 'A. Chen', expectedReturnAt: null } };
    expect(vehicleStatusLine(out)).toBe('Out · A. Chen');
  });
});
