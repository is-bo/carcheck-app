/**
 * The data-root pointer (docs/DATA_MODEL.md §5, §7.4). Pure decisions; files.ts does the IO.
 *
 * `<document>/carcheck/current.json` names the live root directory `data-<id>`. A restore writes
 * a complete new root and then switches the pointer; the old root stays as `previous` (safety
 * copy) until `previousUntil`.
 */

export interface DataPointer {
  v: 1;
  root: string;
  previous: string | null;
  previousUntil: number | null;
  /** Set by a restore commit; boot verifies the new root and rolls back to `previous` on failure. */
  verifyPending: boolean;
}

export const POINTER_FILE = 'current.json';
export const NEXT_POINTER_FILE = 'current.next.json';
export const SAFETY_COPY_DAYS = 14;

const ROOT_NAME = /^data-[a-z0-9-]{4,64}$/;

export function isDataRootName(name: string): boolean {
  return ROOT_NAME.test(name);
}

export function dataRootName(id: string): string {
  const name = `data-${id.toLowerCase()}`;
  if (!isDataRootName(name)) throw new Error(`Invalid data root id "${id}"`);
  return name;
}

export function newPointer(root: string): DataPointer {
  return { v: 1, root, previous: null, previousUntil: null, verifyPending: false };
}

export function parsePointer(text: string | null | undefined): DataPointer | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.root !== 'string' || !isDataRootName(o.root)) return null;
  const previous = typeof o.previous === 'string' && isDataRootName(o.previous) ? o.previous : null;
  const previousUntil = typeof o.previousUntil === 'number' && previous ? o.previousUntil : null;
  return { v: 1, root: o.root, previous, previousUntil, verifyPending: o.verifyPending === true };
}

export function serializePointer(p: DataPointer): string {
  return JSON.stringify({
    v: 1,
    root: p.root,
    previous: p.previous,
    previousUntil: p.previousUntil,
    verifyPending: p.verifyPending,
  });
}

export interface PointerFilesDecision {
  pointer: DataPointer | null;
  /** Rename current.next.json -> current.json (after deleting current.json if present). */
  promoteNext: boolean;
  /** current.next.json is garbage: delete it. */
  deleteNext: boolean;
}

/**
 * Crash recovery of the three-step switch (write next, delete current, rename next):
 * a parseable `next` always wins; an unparsable `next` is dropped.
 */
export function resolvePointerFiles(currentText: string | null, nextText: string | null): PointerFilesDecision {
  const next = parsePointer(nextText);
  if (next) return { pointer: next, promoteNext: true, deleteNext: false };
  return { pointer: parsePointer(currentText), promoteNext: false, deleteNext: nextText !== null };
}

export interface RootCandidate {
  name: string;
  /** Modification time of its database file; null when it has no database. */
  dbModifiedAt: number | null;
}

/**
 * No usable pointer but data directories exist (should never happen with the switch protocol):
 * adopt the root whose database changed last rather than silently starting empty.
 */
export function chooseRootWithoutPointer(candidates: readonly RootCandidate[]): string | null {
  let best: RootCandidate | null = null;
  for (const c of candidates) {
    if (!isDataRootName(c.name) || c.dbModifiedAt === null) continue;
    if (!best || (best.dbModifiedAt ?? 0) < c.dbModifiedAt) best = c;
  }
  return best?.name ?? null;
}

/** data-* directories named by neither `root` nor `previous` (abandoned restore staging). */
export function abandonedRoots(dirNames: readonly string[], pointer: DataPointer): string[] {
  return dirNames.filter((n) => isDataRootName(n) && n !== pointer.root && n !== pointer.previous);
}

export function isSafetyCopyExpired(pointer: DataPointer, now: number): boolean {
  return pointer.previous !== null && pointer.previousUntil !== null && pointer.previousUntil <= now;
}

/** Pointer after a successful restore commit: new root live, old root kept as safety copy. */
export function pointerForRestore(currentRoot: string, newRoot: string, now: number): DataPointer {
  return {
    v: 1,
    root: newRoot,
    previous: currentRoot,
    previousUntil: now + SAFETY_COPY_DAYS * 24 * 60 * 60 * 1000,
    verifyPending: true,
  };
}

/** Pointer after a failed verification: back to the previous root, no safety copy. */
export function pointerForRollback(p: DataPointer): DataPointer | null {
  return p.previous ? newPointer(p.previous) : null;
}
