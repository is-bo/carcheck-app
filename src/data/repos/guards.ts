/**
 * Code-level evidence locks. The triggers enforce the same rules; these checks fail first with
 * copy the UI can show as-is.
 */
import { isAfterEditable, isBeforeEditable, type RentalFacts } from '@/domain/rentalLifecycle';
import type { Phase } from '@/domain/types';

import { InvalidStateError, LockedError } from '../errors';

export const LOCK_MESSAGES = {
  signed: 'Pick-up evidence is part of the signed contract. Void & re-sign to change it.',
  closedBefore: 'This rental is closed, so its pick-up evidence can no longer change.',
  returned: 'The return is completed. Use Edit return to change it.',
  cancelled: 'Cancelled rentals cannot change.',
  returnNotStarted: 'The return can only be recorded while the car is out.',
} as const;

export function assertPhaseEditable(facts: RentalFacts, phase: Phase): void {
  if (facts.status === 'cancelled') throw new LockedError(LOCK_MESSAGES.cancelled);
  if (phase === 'before') {
    if (isBeforeEditable(facts.status, facts.hasValidContract)) return;
    throw new LockedError(facts.hasValidContract ? LOCK_MESSAGES.signed : LOCK_MESSAGES.closedBefore);
  }
  if (isAfterEditable(facts.status, facts.returnReopenedAt)) return;
  if (facts.status === 'returned') throw new LockedError(LOCK_MESSAGES.returned);
  throw new InvalidStateError(LOCK_MESSAGES.returnNotStarted);
}

export function isPhaseEditable(facts: RentalFacts, phase: Phase): boolean {
  return phase === 'before'
    ? isBeforeEditable(facts.status, facts.hasValidContract)
    : isAfterEditable(facts.status, facts.returnReopenedAt);
}
