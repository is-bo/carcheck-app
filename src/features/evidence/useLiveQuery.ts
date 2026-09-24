import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { affects, subscribeDataChanges, type DataEntity } from '@/data/repos';

export type LiveQuery<T> =
  | { status: 'loading'; data: null; error: null; reload: () => void }
  | { status: 'ready'; data: T; error: null; reload: () => void }
  | { status: 'error'; data: T | null; error: unknown; reload: () => void };

/**
 * Runs `load` and re-runs it whenever a repository write touches one of `entities`. Keeps the
 * last good data while a refresh is in flight, so screens never flash back to a loading state.
 * `key` identifies the query (e.g. the rental id); changing it starts over.
 */
export function useLiveQuery<T>(key: string, entities: readonly DataEntity[], load: () => Promise<T>): LiveQuery<T> {
  const [state, setState] = useState<{ key: string; data: T | null; error: unknown; done: boolean }>({
    key,
    data: null,
    error: null,
    done: false,
  });
  const loader = useRef(load);
  useLayoutEffect(() => {
    loader.current = load;
  });
  const run = useRef(0);
  const entityKey = entities.join(',');

  const reload = useCallback(() => {
    const ticket = ++run.current;
    loader.current().then(
      (data) => {
        if (ticket === run.current) setState({ key, data, error: null, done: true });
      },
      (error: unknown) => {
        if (ticket === run.current) setState((s) => ({ key, data: s.key === key ? s.data : null, error, done: true }));
      },
    );
  }, [key]);

  useEffect(() => {
    reload();
    const watched = entityKey.split(',') as DataEntity[];
    const unsubscribe = subscribeDataChanges((event) => {
      if (affects(event, watched)) reload();
    });
    return () => {
      unsubscribe();
      run.current += 1;
    };
  }, [reload, entityKey]);

  const current = state.key === key ? state : { key, data: null, error: null, done: false };
  if (current.error !== null && current.error !== undefined) {
    return { status: 'error', data: current.data, error: current.error, reload };
  }
  if (!current.done) return { status: 'loading', data: null, error: null, reload };
  return { status: 'ready', data: current.data as T, error: null, reload };
}
