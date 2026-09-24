import {
  canTransition,
  deriveRentalState,
  homeSection,
  inspectionProgress,
  resumeTarget,
  returnBlockers,
  signBlockers,
  stepBlockers,
  type RentalFacts,
} from '../rentalLifecycle';
import { EXTERIOR_ANGLE_KEYS } from '../types';

const ALL = [...EXTERIOR_ANGLE_KEYS];

function facts(overrides: Partial<RentalFacts> = {}): RentalFacts {
  return {
    status: 'draft',
    hasVehicle: true,
    customerName: 'Jane Smith',
    hasValidContract: false,
    contractCount: 0,
    before: { captured: ALL, skipped: [] },
    after: null,
    returnReopenedAt: null,
    expectedReturnAt: null,
    ...overrides,
  };
}

describe('status machine', () => {
  it('allows only draft -> active -> returned | cancelled', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('active', 'returned')).toBe(true);
    expect(canTransition('active', 'cancelled')).toBe(true);
    expect(canTransition('draft', 'returned')).toBe(false);
    expect(canTransition('returned', 'active')).toBe(false);
    expect(canTransition('cancelled', 'active')).toBe(false);
  });
});

describe('inspection progress', () => {
  it('counts captured and skipped angles; completion needs one photo', () => {
    const p = inspectionProgress({ captured: ['front', 'rear'], skipped: ['left', 'rear'] });
    expect([p.done, p.captured, p.skipped, p.total]).toEqual([3, 2, 1, 8]);
    expect(p.nextMissing).toBe('front_left');
    expect(inspectionProgress({ captured: [], skipped: ALL }).complete).toBe(false);
    expect(inspectionProgress({ captured: ['front'], skipped: ALL.slice(1) }).complete).toBe(true);
    expect(inspectionProgress(null).done).toBe(0);
  });
});

describe('step guards', () => {
  it('requires vehicle, customer name and a complete BEFORE inspection to sign', () => {
    expect(signBlockers(facts())).toEqual([]);
    expect(signBlockers(facts({ hasVehicle: false, customerName: '  ' }))).toEqual(
      expect.arrayContaining(['no_vehicle', 'no_customer_name']),
    );
    expect(signBlockers(facts({ before: { captured: ['front'], skipped: [] } }))).toEqual(['angles_missing']);
    expect(signBlockers(facts({ before: { captured: [], skipped: ALL } }))).toEqual(['no_exterior_photo']);
    expect(signBlockers(facts({ before: { captured: ['front'], skipped: ALL.slice(1) } }))).toEqual([]);
    expect(signBlockers(facts(), { agencyName: '', unknownVariables: ['x'] })).toEqual(['agency_name_missing', 'unknown_variables']);
  });

  it('opens the start flow for drafts and for re-signing after a void only', () => {
    expect(stepBlockers('inspect', facts({ customerName: null }))).toEqual(['no_customer_name']);
    expect(stepBlockers('details', facts({ status: 'active', hasValidContract: true }))).toEqual(['wrong_status']);
    expect(stepBlockers('details', facts({ status: 'active', hasValidContract: false }))).toEqual([]);
    expect(stepBlockers('vehicle', facts({ status: 'returned' }))).toEqual(['wrong_status']);
  });

  it('guards the return', () => {
    const out = facts({ status: 'active', hasValidContract: true });
    expect(returnBlockers('start', out)).toEqual([]);
    expect(returnBlockers('complete', { ...out, after: { captured: [], skipped: [] } })).toEqual(['no_return_photo']);
    expect(returnBlockers('complete', { ...out, after: { captured: ['rear'], skipped: [] } })).toEqual([]);
    expect(returnBlockers('complete', facts({ status: 'returned' }))).toEqual(['wrong_status']);
    expect(returnBlockers('reopen', facts({ status: 'returned' }))).toEqual([]);
    expect(returnBlockers('reopen', facts({ status: 'returned', returnReopenedAt: 1 }))).toEqual(['wrong_status']);
  });
});

describe('derived state and home', () => {
  const now = 1_000_000;
  const endOfToday = now + 1000;

  it('derives needs-signature, return in progress and overdue', () => {
    expect(deriveRentalState(facts({ status: 'active' }), now).needsSignature).toBe(true);
    expect(deriveRentalState(facts({ status: 'active', hasValidContract: true, after: { captured: [], skipped: [] } }), now).returnInProgress).toBe(
      true,
    );
    expect(deriveRentalState(facts({ status: 'active', hasValidContract: true, expectedReturnAt: now - 1 }), now).overdue).toBe(true);
    expect(deriveRentalState(facts({ status: 'returned', expectedReturnAt: now - 1 }), now).overdue).toBe(false);
  });

  it('sorts rentals into home sections', () => {
    const out = facts({ status: 'active', hasValidContract: true });
    expect(homeSection(facts(), now, endOfToday)).toBe('unfinished');
    expect(homeSection(facts({ status: 'active' }), now, endOfToday)).toBe('unfinished');
    expect(homeSection({ ...out, expectedReturnAt: now - 5 }, now, endOfToday)).toBe('due_back');
    expect(homeSection({ ...out, expectedReturnAt: endOfToday }, now, endOfToday)).toBe('due_back');
    expect(homeSection({ ...out, expectedReturnAt: endOfToday + 1 }, now, endOfToday)).toBe('out');
    expect(homeSection(out, now, endOfToday)).toBe('out');
    expect(homeSection(facts({ status: 'returned' }), now, endOfToday)).toBe('returned');
    expect(homeSection(facts({ status: 'returned', returnReopenedAt: 1 }), now, endOfToday)).toBe('unfinished');
    expect(homeSection(facts({ status: 'cancelled' }), now, endOfToday)).toBe('cancelled');
  });

  it('resumes where the employee stopped, never past an unmet requirement', () => {
    expect(resumeTarget(facts({ hasVehicle: false }), 'details')).toBe('vehicle');
    expect(resumeTarget(facts({ customerName: null }), null)).toBe('customer');
    expect(resumeTarget(facts({ before: { captured: ['front'], skipped: [] } }), 'contract')).toBe('capture');
    expect(resumeTarget(facts({ before: { captured: ['front'], skipped: [] } }), 'condition')).toBe('condition');
    expect(resumeTarget(facts(), 'contract')).toBe('contract');
    expect(resumeTarget(facts(), null)).toBe('details');
    expect(resumeTarget(facts({ status: 'active', hasValidContract: true }), null)).toBeNull();
    const returning = facts({ status: 'active', hasValidContract: true, after: { captured: ['front'], skipped: [] } });
    expect(resumeTarget(returning, null)).toBe('return_capture');
    expect(resumeTarget(returning, 'return_details')).toBe('return_details');
    expect(resumeTarget(facts({ status: 'returned', returnReopenedAt: 5 }), null)).toBe('return_compare');
  });
});
