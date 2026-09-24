/**
 * BackupDeps for Node tests: a real temp directory as the file system, better-sqlite3 databases,
 * a fake zip (a JSON file of base64 entries, so tests can tamper with single entries) and a fake
 * boot that follows db.ts: verify a pending restore, fall back to `previous`, delete abandoned
 * roots. Node modules are loaded through jest.requireActual with local typings so Node's types
 * stay out of the app's type program.
 */
import type { BackupCounts } from '@/domain/types';

import { clearDataConnection, setDataConnection } from '../../../connection';
import { CONNECTION_PRAGMAS, SCHEMA_VERSION } from '../../../migrations';
import { abandonedRoots, isDataRootName, newPointer, pointerForRollback, type DataPointer } from '../../../pointer';
import { getRecordCounts, listFileRefs, recordBackupLog } from '../../../repos/storage';
import type { ClosableSqlDb } from '../../../sql';
import { openNodeDatabase, type TestData } from '../../../__tests__/support/testData';
import type { ArchiveEntry } from '../../manifest';
import { ZipFailure, type BackupDeps, type FsPort, type RootLocation, type RootsPort, type ZipPort } from '../../ports';

interface Dirent {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  mkdtempSync(prefix: string): string;
  existsSync(path: string): boolean;
  statSync(path: string): { size: number; isDirectory(): boolean };
  rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  renameSync(from: string, to: string): void;
  readFileSync(path: string, encoding: 'utf8'): string;
  readFileSync(path: string): Uint8Array;
  writeFileSync(path: string, data: string | Uint8Array): void;
  readdirSync(path: string, opts: { withFileTypes: true }): Dirent[];
}
interface NodePath {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  resolve(...parts: string[]): string;
  sep: string;
}
interface NodeBuffer {
  from(data: Uint8Array): { toString(encoding: 'base64'): string };
  from(data: string, encoding: 'base64'): Uint8Array;
}
interface NodeCrypto {
  createHash(alg: 'sha256'): { update(data: Uint8Array): { digest(enc: 'hex'): string } };
}

export const nodeFs = () => jest.requireActual<NodeFs>('fs');
const nodePath = () => jest.requireActual<NodePath>('path');
const nodeOs = () => jest.requireActual<{ tmpdir(): string }>('os');
const NodeBufferCtor = () => jest.requireActual<{ Buffer: NodeBuffer }>('buffer').Buffer;
const nodeCrypto = () => jest.requireActual<NodeCrypto>('crypto');

export function makeTempDir(): string {
  const path = nodePath();
  return nodeFs().mkdtempSync(path.join(nodeOs().tmpdir(), 'carcheck-backup-'));
}

function walk(dir: string, prefix: string, out: string[]): void {
  for (const e of nodeFs().readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath().join(dir, e.name);
    if (e.isDirectory()) walk(full, `${prefix}${e.name}/`, out);
    else out.push(`${prefix}${e.name}`);
  }
}

export function createNodeFs(opts: { freeBytes: () => number }): FsPort {
  const fs = nodeFs();
  const path = nodePath();
  return {
    join: (dir, ...names) => path.join(dir, ...names),
    nativePath: (location) => location,
    exists: (location) => fs.existsSync(location),
    fileSize: (location) => (fs.existsSync(location) && !fs.statSync(location).isDirectory() ? fs.statSync(location).size : null),
    makeDir: (location) => fs.mkdirSync(location, { recursive: true }),
    remove: (location) => fs.rmSync(location, { recursive: true, force: true }),
    move: async (from, to) => {
      if (fs.existsSync(to)) throw new Error(`move: ${to} exists`);
      fs.renameSync(from, to);
    },
    readText: async (location) => fs.readFileSync(location, 'utf8'),
    writeText: async (location, text) => fs.writeFileSync(location, text),
    listFiles: (dir) => {
      const out: string[] = [];
      if (fs.existsSync(dir)) walk(dir, '', out);
      return out;
    },
    directorySize: (dir) => {
      const out: string[] = [];
      if (fs.existsSync(dir)) walk(dir, '', out);
      return out.reduce((sum, rel) => sum + fs.statSync(path.join(dir, ...rel.split('/'))).size, 0);
    },
    sha256: async (location) => nodeCrypto().createHash('sha256').update(fs.readFileSync(location)).digest('hex'),
    freeBytes: opts.freeBytes,
  };
}

// ---------------------------------------------------------------------------------------------
// Fake zip: { magic, entries: { "<path>": "<base64>" } }

const MAGIC = 'FAKE-ZIP-1';

export interface FakeArchive {
  magic: string;
  entries: Record<string, string>;
}

export function readArchive(file: string): FakeArchive {
  return JSON.parse(nodeFs().readFileSync(file, 'utf8')) as FakeArchive;
}

export function writeArchive(file: string, archive: FakeArchive): void {
  nodeFs().writeFileSync(file, JSON.stringify(archive));
}

export const decodeEntry = (b64: string): Uint8Array => NodeBufferCtor().from(b64, 'base64');
export const encodeEntry = (bytes: Uint8Array): string => NodeBufferCtor().from(bytes).toString('base64');

export function createFakeZip(): ZipPort & { calls: string[] } {
  const fs = nodeFs();
  const path = nodePath();
  const calls: string[] = [];
  const load = (archive: string): FakeArchive => {
    let parsed: FakeArchive;
    try {
      parsed = readArchive(archive);
    } catch (e) {
      throw new ZipFailure('corrupt', 'not a zip file', e);
    }
    if (parsed?.magic !== MAGIC) throw new ZipFailure('corrupt', 'not a zip file');
    return parsed;
  };
  return {
    calls,
    async zip(sources, target, opts) {
      calls.push('zip');
      if (fs.existsSync(target)) throw new ZipFailure('other', 'target exists');
      const entries: Record<string, string> = {};
      for (const [i, source] of sources.entries()) {
        if (opts.signal?.aborted) throw new ZipFailure('cancelled', 'Operation cancelled');
        if (!fs.existsSync(source)) throw new ZipFailure('not_found', `${source} missing`);
        if (fs.statSync(source).isDirectory()) {
          const files: string[] = [];
          walk(source, '', files);
          for (const rel of files) entries[rel] = encodeEntry(fs.readFileSync(path.join(source, ...rel.split('/'))));
        } else {
          entries[path.basename(source)] = encodeEntry(fs.readFileSync(source));
        }
        opts.onProgress?.({ fraction: (i + 1) / sources.length });
      }
      writeArchive(target, { magic: MAGIC, entries });
    },
    async list(archive) {
      calls.push('list');
      const { entries } = load(archive);
      return Object.entries(entries).map(([p, b64]): ArchiveEntry => ({ path: p, size: decodeEntry(b64).length, isDirectory: false }));
    },
    async unzip(archive, targetDir, opts) {
      calls.push('unzip');
      const { entries } = load(archive);
      const names = Object.keys(entries).filter((n) => !opts.entries || opts.entries.includes(n));
      for (const [i, name] of names.entries()) {
        if (opts.signal?.aborted) throw new ZipFailure('cancelled', 'Operation cancelled');
        const dest = path.resolve(targetDir, ...name.split('/'));
        if (!dest.startsWith(path.resolve(targetDir) + path.sep)) throw new ZipFailure('unsafe_path', `unsafe entry ${name}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, decodeEntry(entries[name]));
        opts.onProgress?.({ fraction: (i + 1) / names.length });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Roots, pointer and a fake boot

export interface NodeHarness {
  deps: BackupDeps;
  appDir: string;
  cacheDir: string;
  pointer(): DataPointer | null;
  /** Makes the boot's health check of this root fail (rollback path). */
  failVerify: Set<string>;
  /** Makes the boot throw after resolving the pointer to this root (reload failure path). */
  failBoot: Set<string>;
  bootCount(): number;
  liveRootName(): string;
  location(name: string): RootLocation;
  free: { bytes: number };
  close(): Promise<void>;
}

export const INITIAL_ROOT = 'data-live00000001';

/**
 * `t` supplies the initial live database (in memory) and its stored files, which are written
 * under the initial root's files dir so the backup can read them.
 */
export function createNodeHarness(t: TestData): NodeHarness {
  const fs = nodeFs();
  const path = nodePath();
  const base = makeTempDir();
  const appDir = path.join(base, 'carcheck');
  const cacheDir = path.join(base, 'cache');
  fs.mkdirSync(appDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const free = { bytes: 50e9 };
  const failVerify = new Set<string>();
  const failBoot = new Set<string>();

  const location = (name: string): RootLocation => {
    const rootDir = path.join(appDir, name);
    return { name, rootDir, dbDir: path.join(rootDir, 'db'), filesDir: path.join(rootDir, 'files') };
  };
  const createRoot = (name: string) => {
    const loc = location(name);
    fs.mkdirSync(loc.dbDir, { recursive: true });
    fs.mkdirSync(loc.filesDir, { recursive: true });
    return loc;
  };

  let pointer: DataPointer | null = newPointer(INITIAL_ROOT);
  let live: { name: string; db: ClosableSqlDb } | null = { name: INITIAL_ROOT, db: t.db };
  let boots = 0;
  let lastRestore: 'none' | 'completed' | 'rolled_back' | null = null;
  const opened: ClosableSqlDb[] = [];

  const initial = createRoot(INITIAL_ROOT);
  for (const [rel, content] of t.files.stored) {
    const target = path.join(initial.filesDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }

  const dbFile = (name: string) => path.join(location(name).dbDir, 'carcheck.db');

  const healthy = (name: string): boolean => {
    if (failVerify.has(name) || !fs.existsSync(dbFile(name))) return false;
    const { raw } = openNodeDatabase(dbFile(name));
    try {
      const check = raw.prepare('PRAGMA quick_check').get() as { quick_check: string };
      const version = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      return check.quick_check === 'ok' && version >= 1 && version <= SCHEMA_VERSION;
    } finally {
      raw.close();
    }
  };

  const roots: RootsPort = {
    readPointer: () => pointer,
    writePointer: (p) => {
      pointer = { ...p };
    },
    newRootName: () => `data-${Math.random().toString(36).slice(2, 14).padEnd(8, '0')}`,
    createRoot,
    rootLocation: location,
    rootExists: (name) => fs.existsSync(location(name).rootDir),
    deleteRoot: (name) => {
      if (live?.name === name) throw new Error('Refusing to delete the live data root');
      fs.rmSync(location(name).rootDir, { recursive: true, force: true });
    },
    closeData: async () => {
      clearDataConnection();
      // The initial in-memory database is reused by a rollback boot; restored ones close like db.ts does.
      if (live && live.db !== t.db) await live.db.close();
      live = null;
    },
    reloadData: async () => {
      boots += 1;
      lastRestore = 'none';
      let p = pointer;
      if (!p) throw new Error('no pointer');
      if (p.verifyPending) {
        if (healthy(p.root)) {
          p = { ...p, verifyPending: false };
          lastRestore = 'completed';
        } else {
          p = pointerForRollback(p) ?? newPointer(p.root);
          lastRestore = 'rolled_back';
        }
        pointer = p;
      }
      const dirs = fs.existsSync(appDir) ? fs.readdirSync(appDir, { withFileTypes: true }).map((d) => d.name).filter(isDataRootName) : [];
      for (const name of abandonedRoots(dirs, p)) fs.rmSync(location(name).rootDir, { recursive: true, force: true });
      if (failBoot.has(p.root)) throw new Error(`boot of ${p.root} failed`);
      let db: ClosableSqlDb;
      if (p.root === INITIAL_ROOT) db = t.db;
      else {
        db = openNodeDatabase(dbFile(p.root)).db;
        await db.execAsync(CONNECTION_PRAGMAS);
        opened.push(db);
      }
      live = { name: p.root, db };
      setDataConnection({ db, platform: t.platform });
    },
    lastBootRestore: () => lastRestore,
  };

  const deps: BackupDeps = {
    fs: createNodeFs({ freeBytes: () => free.bytes }),
    zip: createFakeZip(),
    live: {
      liveRoot: () => {
        if (!live) throw new Error('data store closed');
        return location(live.name);
      },
      liveDbBytes: () => 4096,
      listLiveFileRefs: () => listFileRefs(),
      liveCounts: (): Promise<BackupCounts> => getRecordCounts(),
      snapshotLive: async (target) => {
        if (!live) throw new Error('data store closed');
        await live.db.execAsync(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      },
      openDb: async (dir, opts) => {
        const db = openNodeDatabase(path.join(dir, opts.name ?? 'carcheck.db')).db;
        if (opts.pragmas) await db.execAsync(CONNECTION_PRAGMAS);
        return db;
      },
      recordLog: async (entry) => {
        await recordBackupLog(entry);
      },
    },
    roots,
    env: { now: () => t.clock.advance(1000), appVersion: '1.2.3', platform: 'android', device: 'Test Phone · Android 15' },
    backupStagingDir: path.join(cacheDir, 'backup'),
    restoreStagingDir: path.join(cacheDir, 'restore'),
  };

  return {
    deps,
    appDir,
    cacheDir,
    pointer: () => pointer,
    failVerify,
    failBoot,
    bootCount: () => boots,
    liveRootName: () => live?.name ?? '(closed)',
    location,
    free,
    async close() {
      for (const db of opened) await db.close().catch(() => undefined);
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Copies a finished archive to a fresh "picked" location, as the document picker would. */
export function pickCopy(h: NodeHarness, archive: string, name = 'picked.carcheck'): string {
  const fs = nodeFs();
  const path = nodePath();
  const dir = path.join(h.cacheDir, 'DocumentPicker');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(target, fs.readFileSync(archive));
  return target;
}
