/**
 * "Data changed" signal emitted after every committed repository write. Screens re-run their
 * queries when an entity they show changes; `all` is emitted after a restore or reload.
 */

export type DataEntity =
  | 'settings'
  | 'vehicle'
  | 'customer'
  | 'rental'
  | 'inspection'
  | 'photo'
  | 'damage'
  | 'contract'
  | 'template'
  | 'artifact'
  | 'backup'
  | 'all';

export interface DataChangeEvent {
  entities: readonly DataEntity[];
}

type Listener = (event: DataChangeEvent) => void;

const listeners = new Set<Listener>();

/** Returns the unsubscribe function. */
export function subscribeDataChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitDataChange(entities: readonly DataEntity[]): void {
  const event: DataChangeEvent = { entities };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (e) {
      console.warn('[data] change listener failed', e);
    }
  }
}

/** True when `event` concerns any of `entities`. */
export function affects(event: DataChangeEvent, entities: readonly DataEntity[]): boolean {
  return event.entities.includes('all') || event.entities.some((e) => entities.includes(e));
}
