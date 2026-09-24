/**
 * Restore (docs/DATA_MODEL.md §7.3–7.4): validate everything in a new data root, then switch the
 * pointer. Pure orchestration over BackupDeps.
 *
 * prepare (live data untouched; any failure deletes the staging):
 *   1. the picked copy moves to <cache>/restore/<run>/in.carcheck;
 *   2. zip directory + manifest.json only → NOT_A_BACKUP / NEWER_VERSION / INCOMPLETE early;
 *   3. free space for the unpacked size;
 *   4. unzip into a new root data-<id>/files, snapshot → db/, manifest → root;
 *   5. size + SHA-256 of every file and of the snapshot;
 *   6. staged DB: user_version, integrity_check + foreign_key_check, counts, every file
 *      reference present; older schema migrated forward with the app's runner, checked again;
 *      unreferenced files dropped.
 * commit (after the destructive confirm):
 *   close live DB → pointer {root: new, previous: old, verifyPending} → boot. Boot verifies the
 *   new root and falls back to `previous` on its own; if booting throws, the old pointer is
 *   written back here and the old data reopened. The old root stays as the 14-day safety copy.
 */
import { contractHtmlProblems } from '@/domain/contract';
import type { BackupCounts, RelPath } from '@/domain/types';

import { checkIntegrity, getSchemaVersion, migrate, SCHEMA_VERSION } from '../migrations';
import { pointerForRestore, type DataPointer } from '../pointer';
import { getRecordCounts, listFileRefs } from '../repos/storage';
import type { SqlExecutor } from '../sql';
import { asBackupError, BackupError, cancelled, throwIfAborted } from './errors';
import {
  checkArchiveEntries,
  countsEqual,
  manifestCreatedAt,
  MANIFEST_FILE,
  parseManifest,
  requiredRestoreBytes,
  SNAPSHOT_FILE,
  unlistedReferences,
  type CarCheckBackupManifest,
} from './manifest';
import { ZipFailure, type BackupDeps } from './ports';

export type RestoreStep = 'open' | 'unpack' | 'files' | 'records';

export interface RestoreProgress {
  step: RestoreStep;
  /** Bytes for `unpack`, files for `files`, 0/1 otherwise. */
  done: number;
  total: number;
}

export interface RestoreOptions {
  signal?: AbortSignal;
  onProgress?: (p: RestoreProgress) => void;
}

export interface RestorePreview {
  stagingDir: string;
  /** The fully checked new data root (data-<id>), not yet live. */
  rootName: string;
  fileName: string;
  archiveBytes: number;
  backup: {
    createdAt: number;
    appVersion: string;
    device: string;
    platform: 'android' | 'ios';
    agencyName: string;
    counts: BackupCounts;
    totalBytes: number;
    schemaVersion: number;
    /** Already missing / damaged on the phone that made the backup (warnings, not errors). */
    missingFiles: RelPath[];
    damagedFiles: RelPath[];
  };
  /** Schema version the restored records were upgraded from; null when already current. */
  upgradedFrom: number | null;
  /** What is on this phone now, for "size vs current data". */
  current: { counts: BackupCounts; bytes: number };
}

export interface RestoreOutcome {
  counts: BackupCounts;
}

function entryKey(path: string): string {
  return path.replace(/^\.?\/+/, '');
}

/** Native unzip failures on a file that already passed the manifest check mean damage. */
function mapUnzipError(e: unknown): BackupError {
  if (e instanceof ZipFailure) {
    if (e.kind === 'cancelled') return cancelled('restore');
    if (e.kind === 'no_space') return new BackupError('no_space', 'restore', e.message, { cause: e });
    if (e.kind === 'corrupt' || e.kind === 'unsafe_path') {
      return new BackupError('corrupted', 'restore', e.message, { cause: e });
    }
  }
  return asBackupError(e, 'restore');
}

/** Signed contracts are printed in a WebView, so a backup may only carry HTML the renderer could have written. */
async function unsafeContracts(db: SqlExecutor): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string; rendered_html: string }>('SELECT id, rendered_html FROM signed_contract');
  return rows.flatMap((r) => {
    const problems = contractHtmlProblems(r.rendered_html);
    return problems.length > 0 ? [`contract ${r.id}: ${problems.slice(0, 3).join(', ')}`] : [];
  });
}

function notABackup(message: string, cause?: unknown): BackupError {
  return new BackupError('not_a_backup', 'restore', message, { cause });
}

export async function prepareRestoreWith(
  deps: BackupDeps,
  input: { archive: string; fileName: string },
  opts: RestoreOptions = {},
): Promise<RestorePreview> {
  const { fs, zip, live, roots, env } = deps;
  const { signal } = opts;
  const report = (step: RestoreStep, done: number, total: number) => opts.onProgress?.({ step, done, total });

  const run = env.now();
  let stagingDir = fs.join(deps.restoreStagingDir, String(run));
  for (let n = 1; fs.exists(stagingDir); n++) stagingDir = fs.join(deps.restoreStagingDir, `${run}-${n}`);
  fs.makeDir(stagingDir);
  let rootName: string | null = null;

  try {
    report('open', 0, 1);
    const archive = fs.join(stagingDir, 'in.carcheck');
    await fs.move(input.archive, archive);
    const archiveBytes = fs.fileSize(archive) ?? 0;

    // Is it ours, and can this app read it?
    let entries;
    try {
      entries = await zip.list(archive);
    } catch (e) {
      if (e instanceof ZipFailure && (e.kind === 'unavailable' || e.kind === 'cancelled')) throw mapUnzipError(e);
      throw notABackup('The file is not a readable zip archive', e);
    }
    if (!entries.some((e) => !e.isDirectory && entryKey(e.path) === MANIFEST_FILE)) {
      throw notABackup('The archive has no manifest.json');
    }
    const probe = fs.join(stagingDir, 'probe');
    fs.makeDir(probe);
    try {
      await zip.unzip(archive, probe, { entries: [MANIFEST_FILE], signal });
    } catch (e) {
      throw mapUnzipError(e);
    }
    const manifest: CarCheckBackupManifest = parseManifest(await fs.readText(fs.join(probe, MANIFEST_FILE)));
    checkArchiveEntries(manifest, entries);
    throwIfAborted(signal, 'restore');
    report('open', 1, 1);

    const unpacked = entries.reduce((sum, e) => sum + (e.isDirectory || e.size < 0 ? 0 : e.size), 0);
    const neededBytes = requiredRestoreBytes(unpacked);
    const freeBytes = fs.freeBytes();
    if (freeBytes < neededBytes) {
      throw new BackupError('no_space', 'restore', 'Not enough free space to unpack the backup', { neededBytes, freeBytes });
    }

    // Unpack into a brand-new root next to the live one.
    rootName = roots.newRootName();
    const root = roots.createRoot(rootName);
    let unpackedSoFar = 0;
    report('unpack', 0, unpacked);
    try {
      await zip.unzip(archive, root.filesDir, {
        signal,
        onProgress: (p) => {
          const bytes = Math.min(unpacked, (p.fraction ?? 0) * unpacked);
          if (bytes <= unpackedSoFar) return;
          unpackedSoFar = bytes;
          report('unpack', bytes, unpacked);
        },
      });
    } catch (e) {
      throw mapUnzipError(e);
    }
    report('unpack', unpacked, unpacked);
    // The archive is no longer needed; give its space back before the checks.
    fs.remove(archive);
    fs.remove(probe);

    const stagedDb = fs.join(root.dbDir, SNAPSHOT_FILE);
    const stagedSnapshot = fs.join(root.filesDir, SNAPSHOT_FILE);
    if (!fs.exists(stagedSnapshot)) {
      throw new BackupError('incomplete', 'restore', 'carcheck.db is missing', { details: [SNAPSHOT_FILE] });
    }
    await fs.move(stagedSnapshot, stagedDb);
    await fs.move(fs.join(root.filesDir, MANIFEST_FILE), fs.join(root.rootDir, MANIFEST_FILE));

    // Checking photos n / N: every byte against the manifest.
    const total = manifest.files.length + 1;
    const missing: string[] = [];
    const damaged: string[] = [];
    report('files', 0, total);
    if (fs.fileSize(stagedDb) !== manifest.db.size || (await fs.sha256(stagedDb)) !== manifest.db.sha256) {
      damaged.push(SNAPSHOT_FILE);
    }
    report('files', 1, total);
    for (let i = 0; i < manifest.files.length; i++) {
      throwIfAborted(signal, 'restore');
      const f = manifest.files[i];
      const location = fs.join(root.filesDir, ...f.path.split('/'));
      const size = fs.fileSize(location);
      if (size === null) missing.push(f.path);
      else if (size !== f.size || (await fs.sha256(location)) !== f.sha256) damaged.push(f.path);
      report('files', i + 2, total);
    }
    if (damaged.length > 0) {
      throw new BackupError('corrupted', 'restore', `${damaged.length} files are damaged`, { details: [...damaged, ...missing] });
    }
    if (missing.length > 0) {
      throw new BackupError('incomplete', 'restore', `${missing.length} files are missing`, { details: missing });
    }

    // Checking records
    report('records', 0, 1);
    let referenced: Set<RelPath>;
    let upgradedFrom: number | null = null;
    const db = await live.openDb(root.dbDir, { name: SNAPSHOT_FILE, pragmas: true });
    try {
      const version = await getSchemaVersion(db);
      if (version !== manifest.schemaVersion) {
        throw new BackupError('corrupted', 'restore', `Database is v${version}, manifest says v${manifest.schemaVersion}`);
      }
      const integrity = await checkIntegrity(db);
      if (!integrity.ok) throw new BackupError('corrupted', 'restore', 'Database integrity check failed', { details: integrity.problems });
      if (!countsEqual(await getRecordCounts(db), manifest.counts)) {
        throw new BackupError('corrupted', 'restore', 'Record counts differ from the manifest');
      }
      const unsafe = await unsafeContracts(db);
      if (unsafe.length > 0) {
        throw new BackupError('corrupted', 'restore', `${unsafe.length} signed contracts contain content CarCheck never writes`, { details: unsafe });
      }
      const unlisted = unlistedReferences(await listFileRefs(db), manifest);
      if (unlisted.length > 0) {
        throw new BackupError('incomplete', 'restore', `${unlisted.length} referenced files are not in the backup`, { details: unlisted });
      }
      if (version < SCHEMA_VERSION) {
        try {
          await migrate(db);
        } catch (e) {
          throw new BackupError('upgrade_failed', 'restore', e instanceof Error ? e.message : String(e), { cause: e });
        }
        const after = await checkIntegrity(db);
        if (!after.ok) throw new BackupError('upgrade_failed', 'restore', 'Integrity check failed after upgrading', { details: after.problems });
        upgradedFrom = version;
      }
      referenced = new Set((await listFileRefs(db)).map((r) => r.path));
    } finally {
      await db.close();
    }
    // Orphans and half-written temp files that rode along in the archive.
    for (const path of fs.listFiles(root.filesDir)) {
      if (!referenced.has(path)) fs.remove(fs.join(root.filesDir, ...path.split('/')));
    }
    throwIfAborted(signal, 'restore');
    report('records', 1, 1);

    const liveRefs = await live.listLiveFileRefs();
    const current = {
      counts: await live.liveCounts(),
      bytes: live.liveDbBytes() + liveRefs.reduce((sum, r) => sum + r.byteSize, 0),
    };

    return {
      stagingDir,
      rootName,
      fileName: input.fileName,
      archiveBytes,
      backup: {
        createdAt: manifestCreatedAt(manifest),
        appVersion: manifest.appVersion,
        device: manifest.device,
        platform: manifest.platform,
        agencyName: manifest.agencyName,
        counts: manifest.counts,
        totalBytes: manifest.totalBytes,
        schemaVersion: manifest.schemaVersion,
        missingFiles: manifest.missingFiles,
        damagedFiles: manifest.damagedFiles,
      },
      upgradedFrom,
      current,
    };
  } catch (e) {
    cleanupStaging(deps, stagingDir, rootName);
    throw signal?.aborted ? cancelled('restore') : asBackupError(e, 'restore');
  }
}

function cleanupStaging(deps: BackupDeps, stagingDir: string, rootName: string | null): void {
  try {
    const pointer = deps.roots.readPointer();
    if (rootName && rootName !== pointer?.root && rootName !== pointer?.previous) deps.roots.deleteRoot(rootName);
  } catch (e) {
    // Boot deletes roots named by neither `root` nor `previous`.
    console.warn('[restore] could not delete staging root', rootName, e);
  }
  try {
    deps.fs.remove(stagingDir);
  } catch (e) {
    console.warn('[restore] could not delete staging dir', stagingDir, e);
  }
}

/** Cancel after a successful prepare: drop the staged root and temp files. */
export function discardRestoreWith(deps: BackupDeps, preview: RestorePreview): void {
  cleanupStaging(deps, preview.stagingDir, preview.rootName);
}

function switchFailed(message: string, cause?: unknown, details: string[] = []): BackupError {
  return new BackupError('switch_failed', 'restore', message, { cause, details });
}

/** The pointer we fall back to: the old one, minus a safety copy that no longer exists. */
function rollbackPointer(deps: BackupDeps, before: DataPointer): DataPointer {
  const keepPrevious = before.previous !== null && deps.roots.rootExists(before.previous);
  return {
    ...before,
    previous: keepPrevious ? before.previous : null,
    previousUntil: keepPrevious ? before.previousUntil : null,
    verifyPending: false,
  };
}

/**
 * Makes the staged root live. Throws `switch_failed` when the old data had to be put back (the
 * error copy says nothing changed); on success the restore is logged in the new database.
 */
export async function commitRestoreWith(deps: BackupDeps, preview: RestorePreview): Promise<RestoreOutcome> {
  const { roots, live, env } = deps;
  if (!roots.rootExists(preview.rootName)) {
    throw new BackupError('failed', 'restore', 'The checked backup is no longer on this phone. Choose the file again.');
  }
  const before = roots.readPointer();
  const liveName = live.liveRoot().name;
  if (!before || before.root !== liveName || before.root === preview.rootName) {
    throw new BackupError('failed', 'restore', 'The data pointer does not match the open data');
  }

  try {
    await roots.closeData();
  } catch (e) {
    await roots.reloadData().catch(() => undefined);
    throw switchFailed('Could not close the current data', e);
  }

  try {
    roots.writePointer(pointerForRestore(before.root, preview.rootName, env.now()));
    await roots.reloadData();
  } catch (e) {
    try {
      await roots.closeData().catch(() => undefined);
      roots.writePointer(rollbackPointer(deps, before));
      await roots.reloadData();
    } catch (again) {
      // The pointer names the old root; the next launch reopens it.
      throw switchFailed('Could not reopen the previous data', again, ['Close CarCheck and open it again.']);
    }
    throw switchFailed(e instanceof Error ? e.message : String(e), e);
  }

  if (roots.lastBootRestore() !== 'completed') {
    // Boot found the restored root unhealthy and already switched back to the previous one.
    throw switchFailed('The restored data failed its first check');
  }

  try {
    await live.recordLog({
      kind: 'restore',
      at: env.now(),
      fileName: preview.fileName,
      byteSize: preview.archiveBytes,
      schemaVersion: preview.backup.schemaVersion,
      backupCreatedAt: preview.backup.createdAt,
      counts: preview.backup.counts,
    });
  } catch (e) {
    console.warn('[restore] could not log the restore', e);
  }
  try {
    deps.fs.remove(preview.stagingDir);
  } catch (e) {
    console.warn('[restore] could not delete restore temp', e);
  }
  return { counts: preview.backup.counts };
}

export interface SafetyCopyInfo {
  rootName: string;
  /** When housekeeping deletes it. */
  until: number | null;
  bytes: number;
}

/** The data kept from before the last restore (DATA_MODEL §7.3 "Automatic safety copy"). */
export function getSafetyCopyWith(deps: BackupDeps): SafetyCopyInfo | null {
  const pointer = deps.roots.readPointer();
  if (!pointer?.previous || !deps.roots.rootExists(pointer.previous)) return null;
  const loc = deps.roots.rootLocation(pointer.previous);
  return { rootName: pointer.previous, until: pointer.previousUntil, bytes: deps.fs.directorySize(loc.rootDir) };
}

/** Frees the safety copy's space: forget it in the pointer first, then delete the directory. */
export function deleteSafetyCopyWith(deps: BackupDeps): void {
  const pointer = deps.roots.readPointer();
  if (!pointer?.previous) return;
  const previous = pointer.previous;
  deps.roots.writePointer({ ...pointer, previous: null, previousUntil: null });
  deps.roots.deleteRoot(previous);
}
