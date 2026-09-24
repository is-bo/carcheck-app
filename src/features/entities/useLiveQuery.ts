/**
 * Read hook for entity screens (AGENT_RULES Wave B: subscribe to @/data/events to refresh
 * lists). Refetches on focus (covers navigating back from a flow) and whenever a write touches
 * one of `watch`'s entities, without flipping back to the loading state once data has loaded.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { affects, subscribeDataChanges, type DataEntity } from '@/data/events';

export interface LiveQueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** `watch` should be a stable (module-level or memoized) array. */
export function useLiveQuery<T>(fetcher: () => Promise<T>, watch: readonly DataEntity[]): LiveQueryState<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({
    data: null,
    loading: true,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  const hasData = useRef(false);
  // Only the newest fetch may land: a slow focus refetch must not overwrite a newer data-event one.
  const ticket = useRef(0);

  // Keep the latest fetcher closure available to `load` without giving `load` itself a new
  // identity every render (it needs to stay stable for useFocusEffect / the subscription below).
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = useCallback(() => {
    const mine = ++ticket.current;
    setState((s) => (hasData.current ? s : { ...s, loading: true }));
    fetcherRef.current().then(
      (data) => {
        if (mine !== ticket.current) return;
        hasData.current = true;
        setState({ data, loading: false, error: null });
      },
      (error: unknown) => {
        if (mine === ticket.current) setState((s) => ({ ...s, loading: false, error }));
      },
    );
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `watch` is a stable literal per call site
  useEffect(() => subscribeDataChanges((event) => affects(event, watch) && load()), [load]);

  return { ...state, reload: load };
}
