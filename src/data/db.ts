/**
 * Opening the data store (docs/DATA_MODEL.md §6 boot order):
 * 1. recover the data-root pointer (finish/undo an interrupted switch, verify a fresh restore,
 *    delete abandoned staging roots);
 * 2. open <root>/db/carcheck.db with expo-sqlite and apply CONNECTION_PRAGMAS (WAL, FKs on);
 * 3. migrate via PRAGMA user_version (pre-migration copy kept with VACUUM INTO);
 * 4. seed the starter contract template;
 * 5. install the connection for the repositories; deferred housekeeping runs a few seconds later.
 *
 * The app root awaits initializeData() before rendering; getDb() throws until then.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import type { RelPath } from '@/domain/types';

import { clearDataConnection, getDb, setDataConnection, type DataPlatform } from './connection';
import { emitDataChange } from './events';
import {
  cleanupTempFiles,
  createDataRoot,
  dataRootExists,
  dataRootLocation,
  dbFileModifiedAt,
  deleteDataRoot,
  deleteStoredFiles,
  expoFileStore,
  findOrphanFiles,
  getActiveDataRoot,
  listDataRootNames,
  readDataPointer,
  recoverDataPointer,
  setActiveDataRoot,
  sweepDerivedCaches,
  writeDataPointer,
  type DataRootLocation,
} from './files';
import { isOrphanSweepSafe } from './filePaths';
import { CONNECTION_PRAGMAS, DB_FILE_NAME, getSchemaVersion, migrate, SCHEMA_VERSION } from './migrations';
import {
  abandonedRoots,
  chooseRootWithoutPointer,
  dataRootName,
  fallbackPointer,
  isSafetyCopyExpired,
  newPointer,
  pointerForRollback,
  type DataPointer,
} from './pointer';
import { ensureStarterTemplate } from './repos/contracts';
import { listFileRefs } from './repos/storage';
import { createSqlDb, type ClosableSqlDb, type SqlDriver } from './sql';

export { getDb, isDataReady } from './connection';

const HOUSEKEEPING_DELAY_MS = 4000;

export interface BootReport {
  /** Outcome of a restore that was still being verified when the app (re)started. */
  restore: 'none' | 'completed' | 'rolled_back';
  /** First launch: a new empty data root was created. */
  createdRoot: boolean;
  /** The pointer was unusable and the most recent data directory was adopted. */
  adoptedRoot: boolean;
  /** Schema version before this boot's migrations (null when nothing ran). */
  migratedFrom: number | null;
  abandonedRootsDeleted: number;
}

let initPromise: Promise<void> | null = null;
let liveDb: ClosableSqlDb | null = null;
let bootReport: BootReport | null = null;
let housekeepingTimer: ReturnType<typeof setTimeout> | null = null;

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (source) => db.execAsync(source),
    run: async (source, params) => {
      const r = await db.runAsync(source, [...params]);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    get: (source, params) => db.getFirstAsync(source, [...params]),
    all: (source, params) => db.getAllAsync(source, [...params]),
    close: () => db.closeAsync(),
  };
}

/**
 * Opens a database file in `dirPath` (plain filesystem path) behind the serialized adapter.
 * Also used by backup/restore for snapshots and staging databases.
 */
export async function openDatabaseAt(
  dirPath: string,
  options: { name?: string; applyPragmas?: boolean } = {},
): Promise<ClosableSqlDb> {
  const raw = await SQLite.openDatabaseAsync(options.name ?? DB_FILE_NAME, {}, dirPath);
  const db = createSqlDb(expoDriver(raw));
  if (options.applyPragmas !== false) await db.execAsync(CONNECTION_PRAGMAS);
  return db;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Consistent, compacted copy of a database (works in WAL mode). `targetPath` is a plain path
 * that must not exist yet. Must not run inside a transaction.
 */
export async function vacuumInto(db: { execAsync(source: string): Promise<void> }, targetPath: string): Promise<void> {
  await db.execAsync(`VACUUM INTO ${sqlString(targetPath)}`);
}

function expoPlatform(): DataPlatform {
  return {
    newId: () => Crypto.randomUUID(),
    now: () => Date.now(),
    sha256Text: async (text) => (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text)).toLowerCase(),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    files: expoFileStore,
  };
}

/** Quick health check of a root's database (used to confirm a freshly restored root). */
async function verifyRoot(loc: DataRootLocation): Promise<boolean> {
  if (!new File(loc.dbDirUri, DB_FILE_NAME).exists) return false;
  let db: ClosableSqlDb | null = null;
  try {
    db = await openDatabaseAt(loc.dbDirPath, { applyPragmas: false });
    const check = await db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
    const version = await getSchemaVersion(db);
    return check?.quick_check === 'ok' && version >= 1 && version <= SCHEMA_VERSION;
  } catch {
    return false;
  } finally {
    await db?.close().catch(() => undefined);
  }
}

function newRootName(): string {
  return dataRootName(Crypto.randomUUID().replace(/-/g, '').slice(0, 12));
}

function rootCandidates() {
  return listDataRootNames().map((name) => ({ name, dbModifiedAt: dbFileModifiedAt(name, DB_FILE_NAME) }));
}

async function resolveRoot(report: BootReport): Promise<DataPointer> {
  let pointer = recoverDataPointer();
  // A guessed root is never grounds for deleting the others (see fallbackPointer).
  let guessed = false;
  if (!pointer) {
    const candidates = rootCandidates();
    const adopt = chooseRootWithoutPointer(candidates);
    if (adopt) {
      report.adoptedRoot = true;
      guessed = true;
      pointer = fallbackPointer(adopt, candidates, Date.now());
    } else {
      report.createdRoot = true;
      pointer = newPointer(newRootName());
    }
    createDataRoot(pointer.root);
    writeDataPointer(pointer);
  }

  if (pointer.verifyPending || !dataRootExists(pointer.root)) {
    const wasRestore = pointer.verifyPending;
    const healthy = dataRootExists(pointer.root) && (await verifyRoot(dataRootLocation(pointer.root)));
    const back = pointerForRollback(pointer);
    if (healthy) {
      pointer = { ...pointer, verifyPending: false };
      if (wasRestore) report.restore = 'completed';
    } else if (back && dataRootExists(back.root)) {
      pointer = back;
      report.restore = 'rolled_back';
    } else {
      // Nothing to fall back to: adopt the most recent other root if there is one, else start
      // empty rather than refuse to open.
      const failed = pointer.root;
      const candidates = rootCandidates().filter((c) => c.name !== failed);
      const adopt = chooseRootWithoutPointer(candidates);
      if (adopt) {
        report.adoptedRoot = true;
        guessed = true;
        pointer = fallbackPointer(adopt, candidates, Date.now());
      } else {
        pointer = newPointer(pointer.root);
        report.createdRoot = !dataRootExists(pointer.root);
      }
    }
    createDataRoot(pointer.root);
    writeDataPointer(pointer);
  }

  for (const name of guessed ? [] : abandonedRoots(listDataRootNames(), pointer)) {
    try {
      deleteDataRoot(name);
      report.abandonedRootsDeleted += 1;
    } catch (e) {
      console.warn('[data] could not delete abandoned root', name, e);
    }
  }
  return pointer;
}

async function boot(): Promise<void> {
  const report: BootReport = { restore: 'none', createdRoot: false, adoptedRoot: false, migratedFrom: null, abandonedRootsDeleted: 0 };
  const pointer = await resolveRoot(report);
  setActiveDataRoot(pointer.root);
  const loc = createDataRoot(pointer.root);

  const db = await openDatabaseAt(loc.dbDirPath);
  try {
    const result = await migrate(db, {
      beforeUpgrade: async (from) => {
        const dir = new Directory(loc.dbDirUri);
        for (const entry of dir.list()) {
          if (entry instanceof File && /^pre-migrate-v\d+\.db$/.test(entry.name)) entry.delete();
        }
        await vacuumInto(db, `${loc.dbDirPath}/pre-migrate-v${from}.db`);
      },
    });
    if (result.from !== result.to) report.migratedFrom = result.from;
    const platform = expoPlatform();
    await db.transaction((tx) => ensureStarterTemplate(tx, platform.newId(), platform.now()));
    setDataConnection({ db, platform });
  } catch (e) {
    await db.close().catch(() => undefined);
    setActiveDataRoot(null);
    throw e;
  }
  liveDb = db;
  bootReport = report;
  emitDataChange(['all']);
  housekeepingTimer = setTimeout(() => {
    housekeepingTimer = null;
    runHousekeeping().catch((e) => console.warn('[data] housekeeping failed', e));
  }, HOUSEKEEPING_DELAY_MS);
}

/**
 * Opens the data store. Idempotent: concurrent and repeated calls share one boot; after a
 * failure (SchemaTooNewError, MigrationError…) the next call retries.
 */
export function initializeData(): Promise<void> {
  if (!initPromise) {
    initPromise = boot().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

/** What boot did (restore outcome for the INTERRUPTED message, first launch…). */
export function getBootReport(): BootReport | null {
  return bootReport;
}

/** Closes the live database (e.g. before a restore switches the pointer). */
export async function closeData(): Promise<void> {
  if (housekeepingTimer) clearTimeout(housekeepingTimer);
  housekeepingTimer = null;
  await initPromise?.catch(() => undefined);
  const db = liveDb;
  liveDb = null;
  initPromise = null;
  clearDataConnection();
  setActiveDataRoot(null);
  if (db) await db.close();
}

/** Close and boot again (after a restore commit); screens get a data-change event for 'all'. */
export async function reloadData(): Promise<void> {
  await closeData();
  await initializeData();
}

/** Where the live database lives (backup snapshots, restore staging next to it). */
export function getLiveDataRoot(): DataRootLocation {
  return getActiveDataRoot();
}

/** VACUUM INTO of the live database, e.g. the backup snapshot. */
export function snapshotLiveDatabase(targetPath: string): Promise<void> {
  return vacuumInto(getDb(), targetPath);
}

// ---------------------------------------------------------------------------------------------
// Housekeeping (deferred after boot; also Settings > Storage > Clean up)

export interface HousekeepingReport {
  tempDeleted: number;
  orphansDeleted: number;
  /** Orphans were found but not deleted because the DB looks empty or replaced (see isOrphanSweepSafe). */
  orphanSweepSkipped: boolean;
  /** Referenced by the DB but absent on disk: reported, never auto-deleted. */
  missingFiles: RelPath[];
  derivedDeleted: number;
  safetyCopyExpired: boolean;
}

/**
 * Deletes unreferenced files older than 1 h under the files root and stale photo caches.
 * Refuses to delete anything when the DB no longer seems to describe the files root.
 */
export async function sweepOrphans(): Promise<{ deleted: number; skipped: boolean; missing: RelPath[]; derivedDeleted: number }> {
  const db = getDb();
  const refs = await listFileRefs(db);
  const diff = findOrphanFiles(refs.map((r) => r.path));
  const safe = isOrphanSweepSafe(diff, diff.storedCount, refs.length);
  if (!safe) {
    console.warn('[data] orphan sweep skipped:', diff.orphans.length, 'unreferenced of', diff.storedCount, 'stored files');
    return { deleted: 0, skipped: true, missing: diff.missing, derivedDeleted: 0 };
  }
  const deleted = deleteStoredFiles(diff.orphans.map((o) => o.path));
  const photoIds = await db.getAllAsync<{ id: string }>('SELECT id FROM photo');
  const derivedDeleted = sweepDerivedCaches(new Set(photoIds.map((p) => p.id)));
  return { deleted, skipped: false, missing: diff.missing, derivedDeleted };
}

export async function runHousekeeping(): Promise<HousekeepingReport> {
  const now = Date.now();
  const tempDeleted = cleanupTempFiles(now);
  let safetyCopyExpired = false;
  const pointer = readDataPointer();
  if (pointer?.previous && isSafetyCopyExpired(pointer, now)) {
    const previous = pointer.previous;
    writeDataPointer({ ...pointer, previous: null, previousUntil: null });
    deleteDataRoot(previous);
    safetyCopyExpired = true;
  }
  const sweep = await sweepOrphans();
  return {
    tempDeleted,
    orphansDeleted: sweep.deleted,
    orphanSweepSkipped: sweep.skipped,
    missingFiles: sweep.missing,
    derivedDeleted: sweep.derivedDeleted,
    safetyCopyExpired,
  };
}
