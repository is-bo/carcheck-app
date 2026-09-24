/**
 * Loads `load()` once, then again whenever a repository write touches one of `entities`
 * (@/data/events) or `reload()` is called. ARCHITECTURE.md sketches a shared `useQuery`; settings
 * screens are simple enough that one small hook per screen covers it without a query cache.
 * Reloads refresh `data` in place without flipping `loading` back on, so a background refresh
 * (a focus event, another screen's write) never flashes the skeleton state again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { affects, subscribeDataChanges, type DataEntity } from '@/data/repos';

export interface LiveQueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

export function useLiveQuery<T>(load: () => Promise<T>, entities: readonly DataEntity[]): LiveQueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const entityKey = entities.join(',');

  useEffect(() => {
    let alive = true;
    loadRef
      .current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  useEffect(
    () => subscribeDataChanges((event) => affects(event, entities) && reload()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entityKey is entities' stable identity
    [entityKey, reload],
  );

  return { data, loading, error, reload };
}
