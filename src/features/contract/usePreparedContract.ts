import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { getAgencySettings, prepareContract, type ContractPreparation } from '@/data/repos';
import type { AgencySettings, Id } from '@/domain/types';

import { useLiveQuery, type LiveQuery } from '../inspection/useLiveQuery';

export interface PreparedContract {
  prep: ContractPreparation;
  agency: AgencySettings;
}

/**
 * The contract as it would be signed now (prepareContract: assigns the reference and pick-up
 * time on first use). Re-rendered when the template or agency settings change and whenever the
 * screen regains focus (e.g. back from "Fix"). Not subscribed to rental changes: preparing
 * writes the rental, which would loop.
 */
export function usePreparedContract(rentalId: Id, options: { refreshOnFocus?: boolean } = {}): LiveQuery<PreparedContract> {
  const query = useLiveQuery(
    async () => {
      const prep = await prepareContract(rentalId);
      return { prep, agency: await getAgencySettings() };
    },
    [rentalId],
    ['settings', 'template'],
  );
  const { reload } = query;
  const refresh = options.refreshOnFocus ?? true;
  const first = useCallback(() => {
    if (refresh) reload();
  }, [refresh, reload]);
  useFocusEffect(first);
  return query;
}
