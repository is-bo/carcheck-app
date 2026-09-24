/**
 * Create backup (docs/DATA_MODEL.md §7.2, UX_FLOWS §9: Saving records → Copying photos →
 * Checking backup). Pure orchestration over BackupDeps; the live data is only read.
 *
 * 1. Space check: the snapshot plus the archive must fit.
 * 2. VACUUM INTO a staging dir: a consistent, compacted copy even while the app keeps running.
 * 3. File list and counts come from the snapshot, so the manifest matches the DB exactly.
 * 4. Every referenced file is hashed as it is on disk (chunked for large files).
 * 5. manifest.json + snapshot + files root → stored zip `<name>.partial` (native, streamed).
 * 6. Read back: entry sizes from the central directory, and manifest.json extracted and compared.
 * 7. Rename to CarCheck-backup-….carcheck; the staging dir then holds only that file.
 * Cancel or any error deletes the staging dir.
 */
import type { BackupCounts, FileRef, RelPath } from '@/domain/types';

import { getSchemaVersion } from '../migrations';
import { getRecordCounts, listFileRefs } from '../repos/storage';
import { asBackupError, BackupError, cancelled, isBackupError, throwIfAborted } from './errors';
import {
  backupFileName,
  buildManifest,
  checkArchiveEntries,
  classifyFiles,
  LARGE_BACKUP_BYTES,
  MANIFEST_FILE,
  requiredBackupBytes,
  serializeManifest,
  SNAPSHOT_FILE,
  type ObservedFile,
} from './manifest';
import { ZipFailure, type BackupDeps } from './ports';

export type BackupStep = 'records' | 'files' | 'archive' | 'verify';

export interface BackupProgress {
  step: BackupStep;
  /** Files for `files`, bytes for `archive`, 0/1 otherwise. */
  done: number;
  total: number;
}

export interface BackupOptions {
  signal?: AbortSignal;
  onProgress?: (p: BackupProgress) => void;
}

export interface BackupEstimate {
  fileCount: number;
  /** Media + documents + database: roughly the size of the backup file. */
  bytes: number;
  neededBytes: number;
  freeBytes: number;
  enoughSpace: boolean;
  large: boolean;
}

export interface BackupResult {
  /** The finished archive (inside `stagingDir`). */
  uri: string;
  fileName: string;
  byteSize: number;
  createdAt: number;
  schemaVersion: number;
  counts: BackupCounts;
  missingFiles: RelPath[];
  damagedFiles: RelPath[];
  /** Over ~3.5 GB: some drives and apps can't take it (DECISIONS data 5). */
  large: boolean;
  stagingDir: string;
}

function uniqueByPath(refs: readonly FileRef[]): FileRef[] {
  const seen = new Set<RelPath>();
  return refs.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

export async function estimateBackupWith(deps: BackupDeps): Promise<BackupEstimate> {
  const refs = uniqueByPath(await deps.live.listLiveFileRefs());
  const fileBytes = refs.reduce((sum, r) => sum + r.byteSize, 0);
  const dbBytes = deps.live.liveDbBytes();
  const neededBytes = requiredBackupBytes(fileBytes, dbBytes);
  const freeBytes = deps.fs.freeBytes();
  const bytes = fileBytes + dbBytes;
  return { fileCount: refs.length, bytes, neededBytes, freeBytes, enoughSpace: freeBytes >= neededBytes, large: bytes > LARGE_BACKUP_BYTES };
}

function mapZipError(e: unknown): BackupError {
  if (e instanceof ZipFailure && e.kind === 'cancelled') return cancelled('backup');
  if (e instanceof ZipFailure && e.kind === 'no_space') {
    return new BackupError('no_space', 'backup', e.message, { cause: e });
  }
  return asBackupError(e, 'backup');
}

export async function createBackupWith(deps: BackupDeps, opts: BackupOptions = {}): Promise<BackupResult> {
  const { fs, zip, live, env } = deps;
  const { signal } = opts;
  const report = (step: BackupStep, done: number, total: number) => opts.onProgress?.({ step, done, total });

  throwIfAborted(signal, 'backup');
  report('records', 0, 1);
  const estimate = await estimateBackupWith(deps);
  if (!estimate.enoughSpace) {
    throw new BackupError('no_space', 'backup', 'Not enough free space for the backup', {
      neededBytes: estimate.neededBytes,
      freeBytes: estimate.freeBytes,
    });
  }

  const createdAt = env.now();
  let stagingDir = fs.join(deps.backupStagingDir, String(createdAt));
  for (let n = 1; fs.exists(stagingDir); n++) stagingDir = fs.join(deps.backupStagingDir, `${createdAt}-${n}`);
  fs.makeDir(stagingDir);

  try {
    // Saving records
    const snapshot = fs.join(stagingDir, SNAPSHOT_FILE);
    await live.snapshotLive(snapshot);
    throwIfAborted(signal, 'backup');
    // Read without CONNECTION_PRAGMAS: switching the copy to WAL would rewrite its header after hashing.
    const snap = await live.openDb(stagingDir, { name: SNAPSHOT_FILE, pragmas: false });
    let refs: FileRef[];
    let counts: BackupCounts;
    let schemaVersion: number;
    let agencyName: string;
    try {
      refs = uniqueByPath(await listFileRefs(snap));
      counts = await getRecordCounts(snap);
      schemaVersion = await getSchemaVersion(snap);
      agencyName = (await snap.getFirstAsync<{ name: string }>('SELECT name FROM agency_settings WHERE id = 1'))?.name ?? '';
    } finally {
      await snap.close();
    }
    report('records', 1, 1);

    // Checking photos n / N
    const root = live.liveRoot();
    const observed = new Map<RelPath, ObservedFile | null>();
    report('files', 0, refs.length);
    for (let i = 0; i < refs.length; i++) {
      throwIfAborted(signal, 'backup');
      const location = fs.join(root.filesDir, ...refs[i].path.split('/'));
      const size = fs.fileSize(location);
      observed.set(refs[i].path, size === null ? null : { size, sha256: await fs.sha256(location) });
      report('files', i + 1, refs.length);
    }
    const classified = classifyFiles(refs, observed);

    const dbSize = fs.fileSize(snapshot);
    if (dbSize === null) throw new BackupError('failed', 'backup', 'The database snapshot is missing');
    const manifest = buildManifest({
      appVersion: env.appVersion,
      schemaVersion,
      createdAt,
      platform: env.platform,
      device: env.device,
      agencyName,
      counts,
      db: { size: dbSize, sha256: await fs.sha256(snapshot) },
      ...classified,
    });
    const manifestText = serializeManifest(manifest);
    const manifestPath = fs.join(stagingDir, MANIFEST_FILE);
    await fs.writeText(manifestPath, manifestText);
    throwIfAborted(signal, 'backup');

    // Copying photos (bytes)
    const fileName = backupFileName(new Date(createdAt));
    const partial = fs.join(stagingDir, `${fileName}.partial`);
    const expected = manifest.totalBytes + manifestText.length;
    let written = 0;
    report('archive', 0, expected);
    try {
      await zip.zip([manifestPath, snapshot, root.filesDir], partial, {
        signal,
        onProgress: (p) => {
          const bytes = Math.max(p.bytesWritten ?? 0, (p.fraction ?? 0) * expected);
          if (bytes <= written) return;
          written = Math.min(bytes, expected);
          report('archive', written, expected);
        },
      });
    } catch (e) {
      throw mapZipError(e);
    }
    throwIfAborted(signal, 'backup');
    report('archive', expected, expected);

    // Checking backup
    report('verify', 0, 1);
    const entries = await zip.list(partial).catch((e: unknown) => {
      throw new BackupError('failed', 'backup', 'The backup file could not be read back', { cause: e });
    });
    try {
      checkArchiveEntries(manifest, entries);
    } catch (e) {
      const details = isBackupError(e) ? e.details : [];
      throw new BackupError('failed', 'backup', 'The backup file is incomplete', { details, cause: e });
    }
    const probe = fs.join(stagingDir, 'probe');
    fs.makeDir(probe);
    try {
      await zip.unzip(partial, probe, { entries: [MANIFEST_FILE], signal });
    } catch (e) {
      throw mapZipError(e);
    }
    if ((await fs.readText(fs.join(probe, MANIFEST_FILE))) !== manifestText) {
      throw new BackupError('failed', 'backup', 'The backup file does not read back correctly');
    }
    fs.remove(probe);
    throwIfAborted(signal, 'backup');

    const finalLocation = fs.join(stagingDir, fileName);
    await fs.move(partial, finalLocation);
    fs.remove(manifestPath);
    fs.remove(snapshot);
    const byteSize = fs.fileSize(finalLocation) ?? 0;
    report('verify', 1, 1);

    return {
      uri: finalLocation,
      fileName,
      byteSize,
      createdAt,
      schemaVersion,
      counts,
      missingFiles: classified.missingFiles,
      damagedFiles: classified.damagedFiles,
      large: byteSize > LARGE_BACKUP_BYTES,
      stagingDir,
    };
  } catch (e) {
    try {
      fs.remove(stagingDir);
    } catch (cleanup) {
      console.warn('[backup] staging cleanup failed', cleanup);
    }
    throw signal?.aborted ? cancelled('backup') : asBackupError(e, 'backup');
  }
}

/**
 * "Last backup" counts a backup once it has left the app (saved to a folder or shared), since
 * the temp copy in the cache is swept and protects nothing on its own.
 */
export function logBackupWith(deps: BackupDeps, result: BackupResult): Promise<void> {
  return deps.live.recordLog({
    kind: 'backup',
    at: result.createdAt,
    fileName: result.fileName,
    byteSize: result.byteSize,
    schemaVersion: result.schemaVersion,
    backupCreatedAt: result.createdAt,
    counts: result.counts,
  });
}

/** Deletes a finished backup's temp copy (after it was saved, or when it is abandoned). */
export function discardBackupWith(deps: BackupDeps, result: BackupResult): void {
  deps.fs.remove(result.stagingDir);
}
