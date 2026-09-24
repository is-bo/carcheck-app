import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DependencyList } from 'react';

import { affects, subscribeDataChanges, type DataEntity } from '@/data/repos';

export interface LiveQuery<T> {
  /** Last successful result; kept while a refresh runs, so lists never flash empty. */
  data: T | undefined;
  error: unknown;
  /** True until the first result or error arrives. */
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `load` now and again whenever a repository write touches one of `entities`
 * (src/data/events). Results of superseded runs are dropped.
 */
export function useLiveQuery<T>(load: () => Promise<T>, deps: DependencyList, entities: readonly DataEntity[]): LiveQuery<T> {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({
    data: undefined,
    error: null,
    loading: true,
  });
  const run = useRef(0);
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const id = ++run.current;
    loadRef.current().then(
      (data) => id === run.current && setState({ data, error: null, loading: false }),
      (error: unknown) => id === run.current && setState((s) => ({ data: s.data, error, loading: false })),
    );
  }, []);

  const entityKey = entities.join(',');
  useEffect(() => {
    reload();
    const watched = entityKey.split(',') as DataEntity[];
    const unsubscribe = subscribeDataChanges((event) => {
      if (affects(event, watched)) reload();
    });
    return () => {
      run.current += 1;
      unsubscribe();
    };
    // `deps` are the caller's inputs to `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, entityKey, ...deps]);

  return { ...state, reload };
}
