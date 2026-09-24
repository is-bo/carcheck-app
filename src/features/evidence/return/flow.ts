import { router, useNavigation } from 'expo-router';
import { useCallback } from 'react';

import { getRentalFacts, InvalidStateError, startReturn } from '@/data/repos';
import { isAfterEditable } from '@/domain/rentalLifecycle';
import type { Id, Rental } from '@/domain/types';

import { returnRoutes } from '../returnRoutes';

/**
 * Entering the return flow. An active rental gets its return inspection (idempotent: a return
 * in progress is resumed); a completed return opens read-only, a reopened one editable.
 */
export async function enterReturnFlow(rentalId: Id): Promise<{ editable: boolean }> {
  const facts = await getRentalFacts(rentalId);
  if (facts.status === 'active') {
    await startReturn(rentalId);
    return { editable: true };
  }
  if (facts.status === 'returned') return { editable: facts.returnReopenedAt !== null };
  throw new InvalidStateError(
    facts.status === 'draft' ? 'This rental has not started yet, so there is nothing to return.' : 'Cancelled rentals cannot be returned.',
  );
}

export function isReturnEditable(rental: Pick<Rental, 'status' | 'returnReopenedAt'>): boolean {
  return isAfterEditable(rental.status, rental.returnReopenedAt);
}

/**
 * Leaves the whole return flow (✕): everything is already saved. Pops the flow off the root
 * stack, or lands on the rental when the flow was opened directly.
 */
export function useLeaveReturnFlow(rentalId: Id): () => void {
  const navigation = useNavigation();
  return useCallback(() => {
    const flow = navigation.getParent();
    if (flow?.canGoBack()) flow.goBack();
    else router.replace(returnRoutes.rental(rentalId));
  }, [navigation, rentalId]);
}
