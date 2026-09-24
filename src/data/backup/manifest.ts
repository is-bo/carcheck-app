/**
 * The `.carcheck` archive contract (docs/DATA_MODEL.md §7.1). Pure: no Expo imports.
 *
 * Archive root: manifest.json, carcheck.db (VACUUM INTO snapshot), then the files-root tree
 * (photos/…, docs/…, signatures/…, generated/…, vehicles/…, agency/…). The manifest lists every
 * file the snapshot references with its size and SHA-256, plus a hash of itself so a truncated or
 * edited manifest is caught before anything is unpacked.
 */
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  type BackupCounts,
  type BackupManifest,
  type BackupManifestFile,
  type EpochMs,
  type FileRef,
  type RelPath,
  type Sha256Hex,
} from '@/domain/types';

import { isValidRelPath } from '../filePaths';
import { DB_FILE_NAME, SCHEMA_VERSION } from '../migrations';
import { BackupError } from './errors';
import { sha256Utf8 } from './sha256';

export const MANIFEST_FILE = 'manifest.json';
export const SNAPSHOT_FILE = DB_FILE_NAME;

/** DECISIONS data 5: warn above ~3.5 GB (FAT32 drives and some apps stop at 4 GB). */
export const LARGE_BACKUP_BYTES = 3.5e9;
/** UX_FLOWS §9: remind after more than 7 days without a backup. */
export const BACKUP_REMINDER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** manifest.json as written by this app: BackupManifest plus the device label and a self-hash. */
export interface CarCheckBackupManifest extends BackupManifest {
  /** Phone that made the backup ("Pixel 7 · Android 15"). */
  device: string;
  /** SHA-256 of canonicalJson(manifest without this field). */
  manifestSha256: Sha256Hex;
}

export type ManifestBody = Omit<CarCheckBackupManifest, 'manifestSha256'>;

export interface ManifestInput {
  appVersion: string;
  schemaVersion: number;
  createdAt: EpochMs;
  platform: BackupManifest['platform'];
  device: string;
  agencyName: string;
  counts: BackupCounts;
  db: { size: number; sha256: Sha256Hex };
  files: readonly BackupManifestFile[];
  missingFiles: readonly RelPath[];
  damagedFiles: readonly RelPath[];
}

export interface SupportedVersions {
  formatVersion: number;
  schemaVersion: number;
}

export const SUPPORTED_VERSIONS: SupportedVersions = {
  formatVersion: BACKUP_FORMAT_VERSION,
  schemaVersion: SCHEMA_VERSION,
};

// ---------------------------------------------------------------------------------------------
// Writing

/** JSON with object keys sorted at every level: the preimage of the manifest self-hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function manifestDigest(body: ManifestBody): Sha256Hex {
  return sha256Utf8(canonicalJson(body));
}

export function buildManifest(input: ManifestInput): CarCheckBackupManifest {
  const files = [...input.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const body: ManifestBody = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: input.appVersion,
    schemaVersion: input.schemaVersion,
    createdAt: new Date(input.createdAt).toISOString(),
    platform: input.platform,
    device: input.device,
    agencyName: input.agencyName,
    counts: { ...input.counts },
    totalBytes: input.db.size + files.reduce((sum, f) => sum + f.size, 0),
    db: { path: SNAPSHOT_FILE, size: input.db.size, sha256: input.db.sha256 },
    files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
    missingFiles: [...input.missingFiles].sort(),
    damagedFiles: [...input.damagedFiles].sort(),
  };
  return { ...body, manifestSha256: manifestDigest(body) };
}

export function serializeManifest(manifest: CarCheckBackupManifest): string {
  return JSON.stringify(manifest);
}

/** `CarCheck-backup-2026-09-24-1402.carcheck` in the phone's local time. */
export function backupFileName(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `CarCheck-backup-${date}-${two(at.getHours())}${two(at.getMinutes())}${BACKUP_FILE_EXTENSION}`;
}

export interface ObservedFile {
  size: number;
  sha256: Sha256Hex;
}

export interface FileClassification {
  files: BackupManifestFile[];
  /** Referenced by the snapshot but absent on disk: recorded, not fatal. */
  missingFiles: RelPath[];
  /** On disk but not what the database recorded (size or hash): copied as they are. */
  damagedFiles: RelPath[];
}

/**
 * Sorts the snapshot's file references by what was actually found on disk. The manifest always
 * carries the bytes as they are, so the archive verifies on restore even when a live file had
 * already drifted from its database record.
 */
export function classifyFiles(
  refs: readonly FileRef[],
  observed: ReadonlyMap<RelPath, ObservedFile | null>,
): FileClassification {
  const out: FileClassification = { files: [], missingFiles: [], damagedFiles: [] };
  const seen = new Set<RelPath>();
  for (const ref of refs) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    const found = observed.get(ref.path) ?? null;
    if (!found) {
      out.missingFiles.push(ref.path);
      continue;
    }
    out.files.push({ path: ref.path, size: found.size, sha256: found.sha256 });
    if (found.size !== ref.byteSize || found.sha256 !== ref.sha256) out.damagedFiles.push(ref.path);
  }
  return out;
}

/** Free space a backup needs: the snapshot and the archive (files + a second copy of the DB), +10 %. */
export function requiredBackupBytes(fileBytes: number, dbBytes: number): number {
  return Math.ceil(1.1 * (fileBytes + 2 * dbBytes));
}

/** Free space a restore needs to unpack next to the live data (DATA_MODEL §7.3 step 3). */
export function requiredRestoreBytes(uncompressedBytes: number): number {
  return Math.ceil(1.05 * uncompressedBytes);
}

export interface BackupReminder {
  due: boolean;
  /** Whole days since the last backup; null when there has never been one. */
  daysSince: number | null;
}

/** "Back up your data — last backup 9 days ago" (UX_FLOWS §9). Nothing to remind about on an empty phone. */
export function backupReminder(lastBackupAt: EpochMs | null, now: EpochMs, hasData: boolean): BackupReminder {
  const daysSince = lastBackupAt === null ? null : Math.max(0, Math.floor((now - lastBackupAt) / DAY_MS));
  const due = hasData && (lastBackupAt === null || now - lastBackupAt > BACKUP_REMINDER_DAYS * DAY_MS);
  return { due, daysSince };
}

// ---------------------------------------------------------------------------------------------
// Reading

const HEX64 = /^[0-9a-f]{64}$/;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isHash = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
const COUNT_KEYS: readonly (keyof BackupCounts)[] = ['vehicles', 'customers', 'rentals', 'photos', 'signedContracts', 'files'];

function corrupted(detail: string): BackupError {
  return new BackupError('corrupted', 'restore', `Backup manifest is invalid: ${detail}`, { details: [detail] });
}

/**
 * Parses and validates manifest.json. Throws BackupError:
 * - not_a_backup: not JSON / not our format;
 * - newer_version: format or schema newer than `supported` (readers accept anything ≤ theirs);
 * - corrupted: self-hash mismatch or a malformed field.
 */
export function parseManifest(text: string, supported: SupportedVersions = SUPPORTED_VERSIONS): CarCheckBackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A truncated manifest of ours still names the format near the top.
    if (text.includes(`"${BACKUP_FORMAT}"`)) throw corrupted('manifest.json is truncated');
    throw new BackupError('not_a_backup', 'restore', 'manifest.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BackupError('not_a_backup', 'restore', 'manifest.json is not an object');
  }
  const m = raw as Record<string, unknown>;
  if (m.format !== BACKUP_FORMAT) throw new BackupError('not_a_backup', 'restore', 'Unknown backup format');

  const madeWith = typeof m.appVersion === 'string' ? [`Made with CarCheck ${m.appVersion}`] : [];
  if (!isCount(m.formatVersion) || m.formatVersion < 1) throw corrupted('formatVersion');
  if (m.formatVersion > supported.formatVersion) {
    throw new BackupError('newer_version', 'restore', `Backup format ${m.formatVersion} > ${supported.formatVersion}`, {
      details: madeWith,
    });
  }
  if (!isCount(m.schemaVersion) || m.schemaVersion < 1) throw corrupted('schemaVersion');
  if (m.schemaVersion > supported.schemaVersion) {
    throw new BackupError('newer_version', 'restore', `Schema ${m.schemaVersion} > ${supported.schemaVersion}`, {
      details: madeWith,
    });
  }

  if (!isHash(m.manifestSha256)) throw corrupted('manifestSha256');
  const { manifestSha256, ...body } = m;
  if (manifestDigest(body as unknown as ManifestBody) !== manifestSha256) throw corrupted('manifest checksum mismatch');

  if (typeof m.appVersion !== 'string') throw corrupted('appVersion');
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) throw corrupted('createdAt');
  if (m.platform !== 'android' && m.platform !== 'ios') throw corrupted('platform');
  if (typeof m.agencyName !== 'string') throw corrupted('agencyName');
  if (m.device !== undefined && typeof m.device !== 'string') throw corrupted('device');

  const counts = m.counts as Record<string, unknown> | null;
  if (typeof counts !== 'object' || counts === null || !COUNT_KEYS.every((k) => isCount(counts[k]))) {
    throw corrupted('counts');
  }

  const db = m.db as Record<string, unknown> | null;
  if (typeof db !== 'object' || db === null || db.path !== SNAPSHOT_FILE || !isCount(db.size) || !isHash(db.sha256)) {
    throw corrupted('db');
  }

  if (!Array.isArray(m.files)) throw corrupted('files');
  const paths = new Set<string>();
  let total = db.size;
  for (const f of m.files as unknown[]) {
    const file = f as Record<string, unknown> | null;
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.path !== 'string' ||
      !isValidRelPath(file.path) ||
      !isCount(file.size) ||
      !isHash(file.sha256)
    ) {
      throw corrupted('files entry');
    }
    if (paths.has(file.path)) throw corrupted(`duplicate file ${file.path}`);
    paths.add(file.path);
    total += file.size;
  }
  if (!isCount(m.totalBytes) || m.totalBytes !== total) throw corrupted('totalBytes');

  for (const key of ['missingFiles', 'damagedFiles'] as const) {
    const list = m[key];
    if (!Array.isArray(list) || !list.every((p) => typeof p === 'string' && isValidRelPath(p))) throw corrupted(key);
  }

  return { ...(m as unknown as CarCheckBackupManifest), device: typeof m.device === 'string' ? m.device : '' };
}

export function manifestCreatedAt(manifest: BackupManifest): EpochMs {
  return Date.parse(manifest.createdAt);
}

export interface ArchiveEntry {
  path: string;
  size: number;
  isDirectory: boolean;
}

function entryKey(path: string): string {
  return path.replace(/^\.?\/+/, '');
}

/**
 * Cheap pre-check from the zip's central directory, before anything is unpacked: every file of
 * the manifest (and the snapshot) must be present with the recorded size. Extra entries (orphans
 * that rode along) are fine; they are dropped after unpacking.
 */
export function checkArchiveEntries(manifest: CarCheckBackupManifest, entries: readonly ArchiveEntry[]): void {
  const sizes = new Map<string, number>();
  for (const e of entries) if (!e.isDirectory) sizes.set(entryKey(e.path), e.size);
  const expected: { path: string; size: number }[] = [{ path: SNAPSHOT_FILE, size: manifest.db.size }, ...manifest.files];
  const missing: string[] = [];
  const wrongSize: string[] = [];
  for (const f of expected) {
    const size = sizes.get(f.path);
    if (size === undefined) missing.push(f.path);
    else if (size >= 0 && size !== f.size) wrongSize.push(f.path);
  }
  if (missing.length > 0) {
    throw new BackupError('incomplete', 'restore', `${missing.length} files missing from the archive`, { details: missing });
  }
  if (wrongSize.length > 0) {
    throw new BackupError('corrupted', 'restore', `${wrongSize.length} files have the wrong size`, { details: wrongSize });
  }
}

/** Paths the restored database references that the manifest neither carries nor lists as missing. */
export function unlistedReferences(refs: readonly FileRef[], manifest: CarCheckBackupManifest): RelPath[] {
  const known = new Set<RelPath>([...manifest.files.map((f) => f.path), ...manifest.missingFiles]);
  return [...new Set(refs.map((r) => r.path))].filter((p) => !known.has(p)).sort();
}

export function countsEqual(a: BackupCounts, b: BackupCounts): boolean {
  return COUNT_KEYS.every((k) => a[k] === b[k]);
}
