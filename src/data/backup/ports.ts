/**
 * The IO seams of backup/restore. The orchestration (createBackup.ts, restore.ts) only talks to
 * these, so Node tests run it against a temp directory, better-sqlite3 and a fake zip; the app
 * wires expo-file-system, react-native-zip-archive and expo-sqlite in expo.ts.
 *
 * Locations are opaque strings: file:// URIs in the app, plain paths in Node. `nativePath` gives
 * the plain filesystem path that SQLite (VACUUM INTO) and the zip module need.
 */
import type { BackupCounts, BackupLogEntry, FileRef } from '@/domain/types';

import type { DataPointer } from '../pointer';
import type { ClosableSqlDb } from '../sql';
import type { ArchiveEntry } from './manifest';

export interface FsPort {
  join(dir: string, ...names: string[]): string;
  nativePath(location: string): string;
  exists(location: string): boolean;
  /** Byte size of a file; null when it does not exist. */
  fileSize(location: string): number | null;
  /** Creates a directory with its parents; no-op when it exists. */
  makeDir(location: string): void;
  /** Deletes a file or a whole directory; missing is fine. */
  remove(location: string): void;
  /** Renames within one volume. The target must not exist. */
  move(from: string, to: string): Promise<void>;
  readText(location: string): Promise<string>;
  writeText(location: string, text: string): Promise<void>;
  /** Every file under `dir`, as '/'-separated paths relative to it. */
  listFiles(dir: string): string[];
  /** Total bytes of the files under `dir` (0 when missing). */
  directorySize(dir: string): number;
  /** Lower-case hex SHA-256, streamed in chunks for large files. */
  sha256(location: string): Promise<string>;
  freeBytes(): number;
}

export type ZipFailureKind =
  | 'corrupt'
  | 'unsafe_path'
  | 'cancelled'
  | 'not_found'
  | 'no_space'
  /** The native module is missing (Expo Go). */
  | 'unavailable'
  | 'other';

/** Native zip errors normalised by the adapter. */
export class ZipFailure extends Error {
  readonly kind: ZipFailureKind;
  override readonly cause?: unknown;
  constructor(kind: ZipFailureKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'ZipFailure';
    this.kind = kind;
    this.cause = cause;
  }
}

export interface ZipProgress {
  /** 0..1 as reported by the native module (coarse for zip on Android: per top-level folder). */
  fraction?: number;
  /** Bytes written to the archive so far (zip only; polled from the growing file). */
  bytesWritten?: number;
}

export interface ZipPort {
  /**
   * Stored (uncompressed) zip. Files go to the archive root under their own name; directories
   * contribute their contents with paths relative to the directory. `target` must not exist.
   */
  zip(sources: string[], target: string, opts: { signal?: AbortSignal; onProgress?: (p: ZipProgress) => void }): Promise<void>;
  list(archive: string): Promise<ArchiveEntry[]>;
  unzip(
    archive: string,
    targetDir: string,
    opts: { entries?: string[]; signal?: AbortSignal; onProgress?: (p: ZipProgress) => void },
  ): Promise<void>;
}

export interface RootLocation {
  name: string;
  rootDir: string;
  dbDir: string;
  filesDir: string;
}

/** The live data store (db.ts / files.ts / repos in the app). */
export interface LiveDataPort {
  liveRoot(): RootLocation;
  /** Bytes of the live database files (db + WAL), for the space estimate. */
  liveDbBytes(): number;
  listLiveFileRefs(): Promise<FileRef[]>;
  liveCounts(): Promise<BackupCounts>;
  /** VACUUM INTO `target` (plain path handled by the adapter). */
  snapshotLive(target: string): Promise<void>;
  /** Opens `<dir>/<name>`; `pragmas` applies CONNECTION_PRAGMAS (WAL, FKs on). */
  openDb(dir: string, opts: { name?: string; pragmas: boolean }): Promise<ClosableSqlDb>;
  recordLog(entry: Omit<BackupLogEntry, 'id'>): Promise<void>;
}

/** Data roots and the pointer (files.ts + db.ts in the app). */
export interface RootsPort {
  readPointer(): DataPointer | null;
  writePointer(pointer: DataPointer): void;
  newRootName(): string;
  /** Creates `data-<id>/db` and `data-<id>/files`. */
  createRoot(name: string): RootLocation;
  rootLocation(name: string): RootLocation;
  rootExists(name: string): boolean;
  deleteRoot(name: string): void;
  /** Closes the live database and forgets the connection. */
  closeData(): Promise<void>;
  /** Boots the data store from the pointer (recovery, verification, migrations). */
  reloadData(): Promise<void>;
  /** What the last boot did with a pending restore. */
  lastBootRestore(): 'none' | 'completed' | 'rolled_back' | null;
}

export interface BackupEnv {
  now(): number;
  appVersion: string;
  platform: 'android' | 'ios';
  device: string;
}

export interface BackupDeps {
  fs: FsPort;
  zip: ZipPort;
  live: LiveDataPort;
  roots: RootsPort;
  env: BackupEnv;
  /** Parent directories of per-run staging dirs: `<cache>/backup`, `<cache>/restore`. */
  backupStagingDir: string;
  restoreStagingDir: string;
}
