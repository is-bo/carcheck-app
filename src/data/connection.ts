/**
 * The live data connection: database + the few platform services repositories need.
 *
 * Pure module (no Expo imports) so repositories run unchanged in Node tests. The app installs
 * the Expo implementation in initializeData() (db.ts); tests install better-sqlite3 plus an
 * in-memory file store.
 */
import type { Id, RelPath, Sha256Hex } from '@/domain/types';

import { DataNotReadyError } from './errors';
import type { SqlDb } from './sql';

/** File operations on the files root (paths are relative to it). */
export interface FileStorePort {
  /**
   * Copies a finished temp file (file:// URI outside the files root) to `relPath` using the write
   * protocol (tmp name in the target dir, then rename). Never overwrites.
   */
  importFile(sourceUri: string, relPath: RelPath): Promise<void>;
  /** Deletes an imported temp file once its row is committed (only files in the cache). */
  releaseTemp(sourceUri: string): Promise<void>;
  /** Deletes a stored file; missing files are ignored. */
  deleteFile(relPath: RelPath): Promise<void>;
  exists(relPath: RelPath): Promise<boolean>;
  /** SHA-256 of the stored bytes, or null when the file is missing. */
  sha256(relPath: RelPath): Promise<Sha256Hex | null>;
  /** Drops regenerable caches (display / thumbnail) of a photo that no longer exists. */
  deletePhotoDerivatives(photoId: Id): Promise<void>;
}

export interface DataPlatform {
  newId(): Id;
  now(): number;
  /** Lower-case hex SHA-256 of the UTF-8 bytes of `text`. */
  sha256Text(text: string): Promise<Sha256Hex>;
  appVersion: string;
  files: FileStorePort;
}

export interface DataConnection {
  db: SqlDb;
  platform: DataPlatform;
}

let current: DataConnection | null = null;

export function setDataConnection(connection: DataConnection): void {
  current = connection;
}

export function clearDataConnection(): void {
  current = null;
}

export function isDataReady(): boolean {
  return current !== null;
}

/** The live database. Throws DataNotReadyError before initializeData() has finished. */
export function getDb(): SqlDb {
  if (!current) throw new DataNotReadyError();
  return current.db;
}

export function getPlatform(): DataPlatform {
  if (!current) throw new DataNotReadyError();
  return current.platform;
}
