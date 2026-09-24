/**
 * Storage bookkeeping for Settings > Storage and the backup module: every referenced file,
 * record counts and the backup log. Functions taking `db` also run on a backup snapshot or a
 * restore staging database.
 */
import type { BackupCounts, BackupLogEntry, FileRef, Id } from '@/domain/types';

import { getDb } from '../connection';
import type { SqlExecutor } from '../sql';
import { read, write } from './internal';

/** Rows of v_file_ref: every file the database references, sorted by path. */
export async function listFileRefs(db: SqlExecutor = getDb()): Promise<FileRef[]> {
  const rows = await db.getAllAsync<{ id: string; owner: FileRef['owner']; path: string; byte_size: number; sha256: string }>(
    'SELECT id, owner, path, byte_size, sha256 FROM v_file_ref ORDER BY path',
  );
  return rows.map((r) => ({ id: r.id, owner: r.owner, path: r.path, byteSize: r.byte_size, sha256: r.sha256 }));
}

export async function getRecordCounts(db: SqlExecutor = getDb()): Promise<BackupCounts> {
  const row = await db.getFirstAsync<BackupCounts>(
    `SELECT (SELECT count(*) FROM vehicle) AS vehicles,
            (SELECT count(*) FROM customer) AS customers,
            (SELECT count(*) FROM rental) AS rentals,
            (SELECT count(*) FROM photo) AS photos,
            (SELECT count(*) FROM signed_contract) AS signedContracts,
            (SELECT count(*) FROM v_file_ref) AS files`,
  );
  return row ?? { vehicles: 0, customers: 0, rentals: 0, photos: 0, signedContracts: 0, files: 0 };
}

export interface StorageUsage {
  totalBytes: number;
  byOwner: Partial<Record<FileRef['owner'], { count: number; bytes: number }>>;
}

/** Bytes recorded in the DB per kind of file (the files themselves are not stat'ed). */
export function getStorageUsage(): Promise<StorageUsage> {
  return read(async (db) => {
    const rows = await db.getAllAsync<{ owner: FileRef['owner']; n: number; bytes: number }>(
      'SELECT owner, count(*) AS n, coalesce(sum(byte_size), 0) AS bytes FROM v_file_ref GROUP BY owner',
    );
    const usage: StorageUsage = { totalBytes: 0, byOwner: {} };
    for (const r of rows) {
      usage.byOwner[r.owner] = { count: r.n, bytes: r.bytes };
      usage.totalBytes += r.bytes;
    }
    return usage;
  });
}

interface BackupLogRow {
  id: string;
  kind: BackupLogEntry['kind'];
  at: number;
  file_name: string;
  byte_size: number | null;
  schema_version: number;
  backup_created_at: number;
  counts_json: string | null;
}

function mapBackupLog(r: BackupLogRow): BackupLogEntry {
  return {
    id: r.id,
    kind: r.kind,
    at: r.at,
    fileName: r.file_name,
    byteSize: r.byte_size,
    schemaVersion: r.schema_version,
    backupCreatedAt: r.backup_created_at,
    counts: r.counts_json ? (JSON.parse(r.counts_json) as BackupCounts) : null,
  };
}

export function recordBackupLog(entry: Omit<BackupLogEntry, 'id'>): Promise<BackupLogEntry> {
  return write(['backup'], async ({ tx, newId }) => {
    const id: Id = newId();
    await tx.runAsync(
      'INSERT INTO backup_log (id, kind, at, file_name, byte_size, schema_version, backup_created_at, counts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, entry.kind, entry.at, entry.fileName, entry.byteSize, entry.schemaVersion, entry.backupCreatedAt, entry.counts ? JSON.stringify(entry.counts) : null],
    );
    return { ...entry, id };
  });
}

export function listBackupLog(limit = 20): Promise<BackupLogEntry[]> {
  return read(async (db) =>
    (await db.getAllAsync<BackupLogRow>('SELECT * FROM backup_log ORDER BY at DESC LIMIT ?', [limit])).map(mapBackupLog),
  );
}

/** "Last backup": the latest backup made, or the creation time of the latest restored backup if newer. */
export function getLastBackupAt(): Promise<number | null> {
  return read(async (db) => {
    const row = await db.getFirstAsync<{ t: number | null }>(
      `SELECT max(t) AS t FROM (
         SELECT max(at) AS t FROM backup_log WHERE kind = 'backup'
         UNION ALL SELECT max(backup_created_at) FROM backup_log WHERE kind = 'restore')`,
    );
    return row?.t ?? null;
  });
}
