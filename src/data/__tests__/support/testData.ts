/**
 * Node test harness: the real migrations and repositories on better-sqlite3, plus an in-memory
 * file store. Loaded through jest.requireActual with local typings so Node's types never enter
 * the app's type program.
 */
import type { CapturedImage, RelPath } from '@/domain/types';

import { clearDataConnection, setDataConnection, type DataPlatform, type FileStorePort } from '../../connection';
import { CONNECTION_PRAGMAS, migrate } from '../../migrations';
import { ensureStarterTemplate } from '../../repos/contracts';
import { createSqlDb, type ClosableSqlDb, type SqlDriver } from '../../sql';

interface BetterStatement {
  reader: boolean;
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface BetterDatabase {
  prepare(source: string): BetterStatement;
  exec(source: string): void;
  close(): void;
}
type BetterSqlite = new (filename: string) => BetterDatabase;

interface NodeCrypto {
  createHash(alg: 'sha256'): { update(data: string, enc: 'utf8'): { digest(enc: 'hex'): string } };
  randomUUID(): string;
}

const nodeCrypto = () => jest.requireActual<NodeCrypto>('crypto');

export function sha256Hex(text: string): string {
  return nodeCrypto().createHash('sha256').update(text, 'utf8').digest('hex');
}

export function openNodeDatabase(filename = ':memory:'): { db: ClosableSqlDb; raw: BetterDatabase } {
  const Database = jest.requireActual<BetterSqlite>('better-sqlite3');
  const raw = new Database(filename);
  const driver: SqlDriver = {
    exec: async (source) => {
      raw.exec(source);
    },
    run: async (source, params) => {
      const stmt = raw.prepare(source);
      if (stmt.reader) {
        stmt.all(...params);
        return { changes: 0, lastInsertRowId: 0 };
      }
      const r = stmt.run(...params);
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    get: async <T>(source: string, params: readonly unknown[]) => (raw.prepare(source).get(...params) as T | undefined) ?? null,
    all: async <T>(source: string, params: readonly unknown[]) => raw.prepare(source).all(...params) as T[],
    close: async () => raw.close(),
  };
  return { db: createSqlDb(driver), raw };
}

/** In-memory stand-in for the expo file store: temp files and stored files are strings. */
export class MemoryFileStore implements FileStorePort {
  readonly temp = new Map<string, string>();
  readonly stored = new Map<RelPath, string>();
  readonly droppedDerivatives: string[] = [];
  private seq = 0;

  addTemp(content: string): { tempUri: string; byteSize: number; sha256: string } {
    this.seq += 1;
    const tempUri = `file:///cache/capture/tmp-${this.seq}.bin`;
    this.temp.set(tempUri, content);
    return { tempUri, byteSize: Math.max(1, content.length), sha256: sha256Hex(content) };
  }

  async importFile(sourceUri: string, relPath: RelPath): Promise<void> {
    if (this.stored.has(relPath)) throw new Error(`${relPath} already exists`);
    const content = this.temp.get(sourceUri);
    if (content === undefined) throw new Error(`missing temp ${sourceUri}`);
    this.stored.set(relPath, content);
  }

  async releaseTemp(sourceUri: string): Promise<void> {
    this.temp.delete(sourceUri);
  }

  async deleteFile(relPath: RelPath): Promise<void> {
    this.stored.delete(relPath);
  }

  async exists(relPath: RelPath): Promise<boolean> {
    return this.stored.has(relPath);
  }

  async sha256(relPath: RelPath): Promise<string | null> {
    const content = this.stored.get(relPath);
    return content === undefined ? null : sha256Hex(content);
  }

  async deletePhotoDerivatives(photoId: string): Promise<void> {
    this.droppedDerivatives.push(photoId);
  }
}

export interface TestClock {
  now: number;
  advance(ms: number): number;
}

export interface TestData {
  db: ClosableSqlDb;
  raw: BetterDatabase;
  files: MemoryFileStore;
  clock: TestClock;
  platform: DataPlatform;
  image(content?: string, overrides?: Partial<CapturedImage>): CapturedImage;
  close(): Promise<void>;
}

export const T0 = Date.UTC(2026, 8, 24, 8, 0, 0);

export async function setupTestData(): Promise<TestData> {
  const { db, raw } = openNodeDatabase();
  await db.execAsync(CONNECTION_PRAGMAS);
  await migrate(db);
  const files = new MemoryFileStore();
  const clock: TestClock = {
    now: T0,
    advance(ms) {
      this.now += ms;
      return this.now;
    },
  };
  const platform: DataPlatform = {
    newId: () => nodeCrypto().randomUUID(),
    // Each call moves time forward a little so ordering by timestamps is deterministic.
    now: () => clock.advance(1),
    sha256Text: async (text) => sha256Hex(text),
    appVersion: 'test',
    files,
  };
  await db.transaction((tx) => ensureStarterTemplate(tx, platform.newId(), clock.now));
  setDataConnection({ db, platform });
  let n = 0;
  return {
    db,
    raw,
    files,
    clock,
    platform,
    image(content, overrides = {}) {
      n += 1;
      const temp = files.addTemp(content ?? `jpeg-bytes-${n}`);
      return { ...temp, width: 4032, height: 3024, capturedAt: clock.now, tzOffsetMin: 120, ...overrides };
    },
    async close() {
      clearDataConnection();
      await db.close();
    },
  };
}
