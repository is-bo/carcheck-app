/**
 * App-private file store (docs/DATA_MODEL.md §5) on the expo-file-system File/Directory API.
 *
 *   <document>/carcheck/current.json              pointer to the live data root
 *   <document>/carcheck/data-<id>/db/carcheck.db   database
 *   <document>/carcheck/data-<id>/files/…          FILES ROOT: every DB path is relative to it
 *   <cache>/thumbs, display                         regenerable photo derivatives (not backed up)
 *   <cache>/capture, exports, backup, restore       temp; swept by housekeeping
 *
 * Nothing here overwrites a stored file: new files go through the write protocol (tmp name in the
 * target directory, then rename), and deletions come only from repositories (after commit),
 * draft discard and the orphan sweep.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { Id, RelPath, Sha256Hex } from '@/domain/types';

import type { FileStorePort } from './connection';
import {
  assertRelPath,
  diffFileRefs,
  exportFileName,
  isExpiredTempEntry,
  photoPath,
  type FileRefDiff,
  type StoredFileEntry,
} from './filePaths';
import {
  isDataRootName,
  NEXT_POINTER_FILE,
  POINTER_FILE,
  resolvePointerFiles,
  serializePointer,
  type DataPointer,
} from './pointer';

export {
  artifactPath,
  contractPdfPath,
  documentPath,
  evidencePath,
  exportFileName,
  isValidRelPath,
  logoPath,
  photoPath,
  reportPdfPath,
  signaturePath,
  vehiclePhotoPath,
  type DocumentOwner,
  type LogoExtension,
} from './filePaths';

const APP_DIR = 'carcheck';
export const DB_DIR = 'db';
export const FILES_DIR = 'files';

export type TempArea = 'capture' | 'exports' | 'backup' | 'restore';
const TEMP_AREAS: readonly TempArea[] = ['capture', 'exports', 'backup', 'restore'];
/**
 * Cache folders written by native modules, outside our own temp areas: expo-camera shots,
 * image-picker copies and image-manipulator outputs. Normally consumed at once; a failed
 * capture or import can leave full-size (possibly ID document) photos behind.
 */
const LIBRARY_TEMP_DIRS = ['Camera', 'ImagePicker', 'ImageManipulator'] as const;
type DerivedArea = 'thumbs' | 'display';

/** file:///a%20b/c -> /a b/c (SQLite and VACUUM INTO need plain filesystem paths). */
export function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/+$/, '');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256OfUri(uri: string): Promise<Sha256Hex> {
  const bytes = await new File(uri).bytes();
  return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
}

// ---------------------------------------------------------------------------------------------
// Data roots and the pointer

export function appDirectory(): Directory {
  return new Directory(Paths.document, APP_DIR);
}

export interface DataRootLocation {
  name: string;
  rootUri: string;
  dbDirUri: string;
  /** Plain path for expo-sqlite's `directory` argument and VACUUM INTO. */
  dbDirPath: string;
  filesDirUri: string;
}

export function dataRootLocation(name: string): DataRootLocation {
  if (!isDataRootName(name)) throw new Error(`Invalid data root "${name}"`);
  const root = new Directory(appDirectory(), name);
  const dbDir = new Directory(root, DB_DIR);
  return {
    name,
    rootUri: root.uri,
    dbDirUri: dbDir.uri,
    dbDirPath: uriToPath(dbDir.uri),
    filesDirUri: new Directory(root, FILES_DIR).uri,
  };
}

/** Creates `data-<id>/db` and `data-<id>/files` (idempotent). */
export function createDataRoot(name: string): DataRootLocation {
  const loc = dataRootLocation(name);
  new Directory(loc.dbDirUri).create({ intermediates: true, idempotent: true });
  new Directory(loc.filesDirUri).create({ intermediates: true, idempotent: true });
  return loc;
}

export function dataRootExists(name: string): boolean {
  return new Directory(dataRootLocation(name).rootUri).exists;
}

export function listDataRootNames(): string[] {
  const dir = appDirectory();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((e): e is Directory => e instanceof Directory)
    .map((d) => d.name.replace(/\/$/, ''))
    .filter(isDataRootName);
}

/** Last modification of a root's database file; null when it has none. */
export function dbFileModifiedAt(name: string, dbFileName: string): number | null {
  const file = new File(dataRootLocation(name).dbDirUri, dbFileName);
  return file.exists ? (file.lastModified ?? 0) : null;
}

let activeRoot: DataRootLocation | null = null;

export function setActiveDataRoot(name: string | null): void {
  activeRoot = name === null ? null : dataRootLocation(name);
}

/** The live root. Throws before initializeData() has resolved it. */
export function getActiveDataRoot(): DataRootLocation {
  if (!activeRoot) throw new Error('No active data root; call initializeData() first');
  return activeRoot;
}

/** Deletes a whole data root (abandoned staging, expired safety copy). Never the live one. */
export function deleteDataRoot(name: string): void {
  if (activeRoot?.name === name) throw new Error('Refusing to delete the live data root');
  const dir = new Directory(dataRootLocation(name).rootUri);
  if (dir.exists) dir.delete();
}

/** Reads the pointer, finishing or undoing an interrupted switch (DATA_MODEL §7.4). */
export function recoverDataPointer(): DataPointer | null {
  const dir = appDirectory();
  if (!dir.exists) return null;
  const current = new File(dir, POINTER_FILE);
  const next = new File(dir, NEXT_POINTER_FILE);
  const decision = resolvePointerFiles(current.exists ? current.textSync() : null, next.exists ? next.textSync() : null);
  if (decision.promoteNext) {
    if (current.exists) current.delete();
    next.rename(POINTER_FILE);
  } else if (decision.deleteNext) {
    next.delete();
  }
  return decision.pointer;
}

export function readDataPointer(): DataPointer | null {
  return recoverDataPointer();
}

/**
 * Crash-safe switch: write current.next.json completely, delete current.json, rename next to
 * current. Every step is atomic, so boot always finds a complete pointer.
 */
export function writeDataPointer(pointer: DataPointer): void {
  const dir = appDirectory();
  dir.create({ intermediates: true, idempotent: true });
  const next = new File(dir, NEXT_POINTER_FILE);
  next.create({ overwrite: true });
  next.write(serializePointer(pointer));
  const current = new File(dir, POINTER_FILE);
  if (current.exists) current.delete();
  next.rename(POINTER_FILE);
}

// ---------------------------------------------------------------------------------------------
// Files root

function storeFile(rel: RelPath): File {
  assertRelPath(rel);
  return new File(getActiveDataRoot().filesDirUri, ...rel.split('/'));
}

/** Absolute URI of a stored file (for expo-image, Skia, expo-print base64 reads…). */
export function resolveFileUri(rel: RelPath): string {
  return storeFile(rel).uri;
}

export function storedFileExists(rel: RelPath): boolean {
  return storeFile(rel).exists;
}

function cacheArea(area: TempArea | DerivedArea): Directory {
  const dir = new Directory(Paths.cache, area);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * All files of one photo: the stored original (URI + relative path) and the regenerable
 * derivatives in the cache (IMAGE_PIPELINE §1: display 2048 px, thumb 384 px).
 */
export function photoPaths(rentalId: Id, photoId: Id): { original: string; originalRel: RelPath; display: string; thumb: string } {
  const originalRel = photoPath(rentalId, photoId);
  return {
    original: resolveFileUri(originalRel),
    originalRel,
    display: new File(cacheArea('display'), `${photoId}.jpg`).uri,
    thumb: new File(cacheArea('thumbs'), `${photoId}.jpg`).uri,
  };
}

/** A fresh temp file location, e.g. for a capture before it is stored. The file is not created. */
export function newTempFileUri(area: TempArea, ext: string): string {
  return new File(cacheArea(area), `${Crypto.randomUUID()}.${ext.replace(/^\./, '')}`).uri;
}

/**
 * Copies a file into cache/exports/<timestamp>/ under a friendly name for sharing; share sheets
 * read it asynchronously, so it is swept after 24 h rather than deleted right away.
 */
export async function stageExport(sourceUri: string, fileName: string): Promise<string> {
  const dir = new Directory(cacheArea('exports'), String(Date.now()));
  dir.create({ intermediates: true, idempotent: true });
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, '-');
  const target = new File(dir, safeName);
  await new File(sourceUri).copy(target);
  return target.uri;
}

/** stageExport for a stored file with a CarCheck_<parts>.<ext> name. */
export function stageStoredFileForExport(rel: RelPath, nameParts: readonly (string | null | undefined)[], ext: string): Promise<string> {
  return stageExport(resolveFileUri(rel), exportFileName(nameParts, ext));
}

function entryModifiedAt(entry: File | Directory): number | null {
  if (entry instanceof File) return entry.lastModified ?? null;
  return entry.info().modificationTime ?? null;
}

/** Deletes temp entries past their age (exports 24 h, other temp and native-module caches 1 h). Returns the count. */
export function cleanupTempFiles(now: number = Date.now()): number {
  let deleted = 0;
  const areas = [...TEMP_AREAS.map((area) => ({ dir: area, area })), ...LIBRARY_TEMP_DIRS.map((dir) => ({ dir, area: 'capture' as const }))];
  for (const { dir: name, area } of areas) {
    const dir = new Directory(Paths.cache, name);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (!isExpiredTempEntry(area, entryModifiedAt(entry), now)) continue;
      try {
        entry.delete();
        deleted += 1;
      } catch (e) {
        console.warn('[files] temp cleanup failed', entry.uri, e);
      }
    }
  }
  return deleted;
}

/** Every file under the files root, with paths relative to it. */
export function listStoredFiles(): StoredFileEntry[] {
  const out: StoredFileEntry[] = [];
  const walk = (dir: Directory, prefix: string) => {
    for (const entry of dir.list()) {
      const name = entry.name.replace(/\/$/, '');
      if (entry instanceof Directory) walk(entry, `${prefix}${name}/`);
      else out.push({ path: `${prefix}${name}`, size: entry.size, modifiedAt: entry.lastModified ?? null });
    }
  };
  const root = new Directory(getActiveDataRoot().filesDirUri);
  if (root.exists) walk(root, '');
  return out;
}

/** Orphans (on disk, not referenced, older than 1 h) and missing files (referenced, absent). */
export function findOrphanFiles(
  referenced: Iterable<RelPath>,
  now: number = Date.now(),
): FileRefDiff & { storedCount: number } {
  const stored = listStoredFiles();
  return { ...diffFileRefs(stored, referenced, now), storedCount: stored.length };
}

export function deleteStoredFiles(paths: readonly RelPath[]): number {
  let deleted = 0;
  for (const p of paths) {
    const file = storeFile(p);
    if (!file.exists) continue;
    file.delete();
    deleted += 1;
  }
  return deleted;
}

/** Drops thumbnails / display copies whose photo no longer exists. */
export function sweepDerivedCaches(photoIds: ReadonlySet<string>): number {
  let deleted = 0;
  for (const area of ['thumbs', 'display'] as const) {
    const dir = new Directory(Paths.cache, area);
    if (!dir.exists) continue;
    for (const entry of dir.list()) {
      if (!(entry instanceof File) || photoIds.has(entry.name.replace(/\.jpg$/, ''))) continue;
      entry.delete();
      deleted += 1;
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------------------------
// Port used by the repositories

function isCacheUri(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri);
}

export const expoFileStore: FileStorePort = {
  async importFile(sourceUri, rel) {
    const target = storeFile(rel);
    if (target.exists) throw new Error(`File store: ${rel} already exists`);
    const source = new File(sourceUri);
    if (!source.exists) throw new Error(`File store: source ${sourceUri} does not exist`);
    const dir = target.parentDirectory;
    dir.create({ intermediates: true, idempotent: true });
    const tmp = new File(dir, `${target.name}.tmp`);
    if (tmp.exists) tmp.delete();
    // Copy (not move) so a failed DB write can be retried from the untouched temp file.
    await source.copy(tmp);
    tmp.rename(target.name);
  },
  async releaseTemp(sourceUri) {
    if (!isCacheUri(sourceUri)) return;
    const source = new File(sourceUri);
    if (source.exists) source.delete();
  },
  async deleteFile(rel) {
    const file = storeFile(rel);
    if (file.exists) file.delete();
  },
  async exists(rel) {
    return storeFile(rel).exists;
  },
  async sha256(rel) {
    const file = storeFile(rel);
    return file.exists ? sha256OfUri(file.uri) : null;
  },
  async deletePhotoDerivatives(photoId) {
    for (const area of ['thumbs', 'display'] as const) {
      const file = new File(Paths.cache, area, `${photoId}.jpg`);
      if (file.exists) file.delete();
    }
  },
};
