/**
 * Backup deps on the device: expo-file-system (new File/Directory API), react-native-zip-archive
 * (native streamed zip; loaded lazily so Expo Go still runs the rest of the app), expo-sqlite via
 * db.ts, and the pointer IO in files.ts.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { closeData, getBootReport, getLiveDataRoot, openDatabaseAt, reloadData, snapshotLiveDatabase } from '../db';
import {
  createDataRoot,
  dataRootExists,
  dataRootLocation,
  deleteDataRoot,
  readDataPointer,
  uriToPath,
  writeDataPointer,
  type DataRootLocation,
} from '../files';
import { DB_FILE_NAME } from '../migrations';
import { dataRootName } from '../pointer';
import { getRecordCounts, listFileRefs, recordBackupLog } from '../repos/storage';
import type { ArchiveEntry } from './manifest';
import { ZipFailure, type BackupDeps, type FsPort, type LiveDataPort, type RootLocation, type RootsPort, type ZipPort } from './ports';
import { Sha256 } from './sha256';

/** Files up to this size are read whole and hashed natively; larger ones stream through Sha256. */
const DIRECT_HASH_MAX_BYTES = 32 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const ZIP_POLL_MS = 400;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256OfFile(uri: string): Promise<string> {
  const file = new File(uri);
  if (file.size <= DIRECT_HASH_MAX_BYTES) {
    const bytes = await file.bytes();
    return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  }
  const hash = new Sha256();
  const handle = file.open(FileMode.ReadOnly);
  try {
    for (let i = 1; ; i++) {
      const chunk = handle.readBytes(HASH_CHUNK_BYTES);
      if (chunk.length === 0) break;
      hash.update(chunk);
      if (i % 8 === 0) await yieldToUi();
    }
  } finally {
    handle.close();
  }
  return hash.digestHex();
}

function walkFiles(dir: Directory, prefix: string, out: string[]): void {
  for (const entry of dir.list()) {
    const name = entry.name.replace(/\/$/, '');
    if (entry instanceof Directory) walkFiles(entry, `${prefix}${name}/`, out);
    else out.push(`${prefix}${name}`);
  }
}

const expoFs: FsPort = {
  join: (dir, ...names) => new File(dir, ...names).uri,
  nativePath: (location) => uriToPath(location),
  exists: (location) => Paths.info(location).exists,
  fileSize: (location) => {
    const file = new File(location);
    return file.exists ? file.size : null;
  },
  makeDir: (location) => new Directory(location).create({ intermediates: true, idempotent: true }),
  remove: (location) => {
    const info = Paths.info(location);
    if (!info.exists) return;
    if (info.isDirectory) new Directory(location).delete();
    else new File(location).delete();
  },
  move: async (from, to) => {
    await new File(from).move(new File(to));
  },
  readText: (location) => new File(location).text(),
  writeText: async (location, text) => {
    const file = new File(location);
    file.create({ overwrite: true });
    file.write(text);
  },
  listFiles: (dir) => {
    const root = new Directory(dir);
    const out: string[] = [];
    if (root.exists) walkFiles(root, '', out);
    return out;
  },
  directorySize: (dir) => {
    const root = new Directory(dir);
    return root.exists ? (root.size ?? 0) : 0;
  },
  sha256: sha256OfFile,
  freeBytes: () => Paths.availableDiskSpace,
};

// ---------------------------------------------------------------------------------------------
// Zip

type ZipModule = typeof import('react-native-zip-archive');

let zipModule: Promise<ZipModule> | null = null;

function loadZip(): Promise<ZipModule> {
  zipModule ??= import('react-native-zip-archive').catch((e: unknown) => {
    zipModule = null;
    throw new ZipFailure('unavailable', 'Backups need the installed CarCheck app; this build has no zip module.', e);
  });
  return zipModule;
}

function toZipFailure(e: unknown): ZipFailure {
  if (e instanceof ZipFailure) return e;
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case 'ERR_CANCELLED':
      return new ZipFailure('cancelled', message, e);
    case 'ERR_CORRUPT_ARCHIVE':
      return new ZipFailure('corrupt', message, e);
    case 'ERR_UNSAFE_PATH':
      return new ZipFailure('unsafe_path', message, e);
    case 'ERR_FILE_NOT_FOUND':
      return new ZipFailure('not_found', message, e);
  }
  if (/no space|ENOSPC/i.test(message)) return new ZipFailure('no_space', message, e);
  // zip4j reports CRC mismatches and truncated entries as generic unzip failures.
  if (/crc|checksum|end of (entry|stream|file)|truncat|header/i.test(message)) return new ZipFailure('corrupt', message, e);
  return new ZipFailure('other', message, e);
}

async function withProgress<T>(
  mod: ZipModule,
  onProgress: ((fraction: number) => void) | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const sub = onProgress ? mod.subscribe(({ progress }) => onProgress(progress)) : null;
  try {
    return await run();
  } finally {
    sub?.remove();
  }
}

const expoZip: ZipPort = {
  async zip(sources, target, opts) {
    const mod = await loadZip();
    const targetFile = new File(target);
    // Polling the growing archive gives byte progress; the native events are per top-level folder.
    const poll = opts.onProgress
      ? setInterval(() => {
          if (targetFile.exists) opts.onProgress?.({ bytesWritten: targetFile.size });
        }, ZIP_POLL_MS)
      : null;
    try {
      await withProgress(mod, opts.onProgress && ((fraction) => opts.onProgress?.({ fraction })), () =>
        mod.zip(sources.map(uriToPath), uriToPath(target), { compressionLevel: mod.NO_COMPRESSION, signal: opts.signal }),
      );
    } catch (e) {
      throw toZipFailure(e);
    } finally {
      if (poll) clearInterval(poll);
    }
  },

  async list(archive) {
    const mod = await loadZip();
    let entries;
    try {
      entries = await mod.listContents(uriToPath(archive));
    } catch (e) {
      throw toZipFailure(e);
    }
    if (entries.some((e) => e.isEncrypted)) throw new ZipFailure('corrupt', 'The archive is password protected');
    return entries.map((e): ArchiveEntry => ({ path: e.path, size: e.size, isDirectory: e.isDirectory }));
  },

  async unzip(archive, targetDir, opts) {
    const mod = await loadZip();
    try {
      await withProgress(mod, opts.onProgress && ((fraction) => opts.onProgress?.({ fraction })), () =>
        mod.unzip(uriToPath(archive), uriToPath(targetDir), { entries: opts.entries, signal: opts.signal }),
      );
    } catch (e) {
      throw toZipFailure(e);
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Live data and roots

function toRootLocation(loc: DataRootLocation): RootLocation {
  return { name: loc.name, rootDir: loc.rootUri, dbDir: loc.dbDirUri, filesDir: loc.filesDirUri };
}

const expoLive: LiveDataPort = {
  liveRoot: () => toRootLocation(getLiveDataRoot()),
  liveDbBytes: () => {
    const { dbDirUri } = getLiveDataRoot();
    return [DB_FILE_NAME, `${DB_FILE_NAME}-wal`].reduce((sum, name) => {
      const file = new File(dbDirUri, name);
      return sum + (file.exists ? file.size : 0);
    }, 0);
  },
  listLiveFileRefs: () => listFileRefs(),
  liveCounts: () => getRecordCounts(),
  snapshotLive: (target) => snapshotLiveDatabase(uriToPath(target)),
  openDb: (dir, opts) => openDatabaseAt(uriToPath(dir), { name: opts.name, applyPragmas: opts.pragmas }),
  recordLog: async (entry) => {
    await recordBackupLog(entry);
  },
};

const expoRoots: RootsPort = {
  readPointer: readDataPointer,
  writePointer: writeDataPointer,
  newRootName: () => dataRootName(Crypto.randomUUID().replace(/-/g, '').slice(0, 12)),
  createRoot: (name) => toRootLocation(createDataRoot(name)),
  rootLocation: (name) => toRootLocation(dataRootLocation(name)),
  rootExists: dataRootExists,
  deleteRoot: deleteDataRoot,
  closeData,
  reloadData,
  lastBootRestore: () => getBootReport()?.restore ?? null,
};

/** "Galaxy A53 5G · Android 14": shown on the restore confirmation of another phone. */
function deviceLabel(): string {
  const name = Constants.deviceName?.trim();
  if (Platform.OS === 'android') {
    const c = Platform.constants;
    const model = name || [c.Manufacturer, c.Model].filter(Boolean).join(' ');
    return `${model || 'Android phone'} · Android ${c.Release}`;
  }
  if (Platform.OS === 'ios') return `${name || 'iPhone'} · iOS ${Platform.Version}`;
  return name || Platform.OS;
}

let deps: BackupDeps | null = null;

export function expoBackupDeps(): BackupDeps {
  deps ??= {
    fs: expoFs,
    zip: expoZip,
    live: expoLive,
    roots: expoRoots,
    env: {
      now: () => Date.now(),
      appVersion: Constants.expoConfig?.version ?? '0.0.0',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      device: deviceLabel(),
    },
    backupStagingDir: new Directory(Paths.cache, 'backup').uri,
    restoreStagingDir: new Directory(Paths.cache, 'restore').uri,
  };
  return deps;
}
