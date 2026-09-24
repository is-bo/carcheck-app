/** @jest-environment node */
import { getRecordCounts, listBackupLog, listFileRefs } from '../../repos';
import { signedRental } from '../../__tests__/support/scenario';
import { setupTestData, type TestData } from '../../__tests__/support/testData';
import { createBackupWith, discardBackupWith, estimateBackupWith, logBackupWith, type BackupProgress, type BackupResult } from '../createBackup';
import { BackupError } from '../errors';
import { buildManifest, MANIFEST_FILE, parseManifest, serializeManifest, SNAPSHOT_FILE } from '../manifest';
import {
  commitRestoreWith,
  deleteSafetyCopyWith,
  discardRestoreWith,
  getSafetyCopyWith,
  prepareRestoreWith,
  type RestorePreview,
  type RestoreProgress,
} from '../restore';
import {
  createNodeHarness,
  decodeEntry,
  encodeEntry,
  INITIAL_ROOT,
  nodeFs,
  pickCopy,
  readArchive,
  writeArchive,
  type NodeHarness,
} from './support/nodeBackupDeps';

let t: TestData;
let h: NodeHarness;

beforeEach(async () => {
  t = await setupTestData();
  await signedRental(t);
  h = createNodeHarness(t);
});

afterEach(async () => {
  await h.close();
  await t.close();
});

async function expectBackupError(p: Promise<unknown>, code: BackupError['code']): Promise<BackupError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BackupError);
    expect((e as BackupError).code).toBe(code);
    return e as BackupError;
  }
  throw new Error(`expected ${code}`);
}

const dirEntries = (dir: string) => (nodeFs().existsSync(dir) ? nodeFs().readdirSync(dir, { withFileTypes: true }).map((d) => d.name) : []);
const dataRoots = () => dirEntries(h.appDir).sort();

async function backup(progress?: BackupProgress[]): Promise<BackupResult> {
  return createBackupWith(h.deps, { onProgress: (p) => progress?.push(p) });
}

async function prepare(archive: string, progress?: RestoreProgress[]): Promise<RestorePreview> {
  return prepareRestoreWith(h.deps, { archive: pickCopy(h, archive), fileName: 'picked.carcheck' }, { onProgress: (p) => progress?.push(p) });
}

/** Rewrites one archive entry (and optionally the manifest) to simulate damage in transit. */
function tamper(archive: string, edit: (entries: Record<string, string>) => void): string {
  const copy = `${archive}.tampered`;
  const parsed = readArchive(archive);
  edit(parsed.entries);
  writeArchive(copy, parsed);
  return copy;
}

describe('createBackup', () => {
  it('writes one verified archive with the snapshot, the manifest and every referenced file', async () => {
    const progress: BackupProgress[] = [];
    const result = await backup(progress);

    expect(result.fileName).toMatch(/^CarCheck-backup-\d{4}-\d{2}-\d{2}-\d{4}\.carcheck$/);
    expect(dirEntries(result.stagingDir)).toEqual([result.fileName]);
    expect(result.counts).toEqual(await getRecordCounts());
    expect(result.missingFiles).toEqual([]);
    expect(result.damagedFiles).toEqual([]);

    const { entries } = readArchive(result.uri);
    const manifest = parseManifest(new TextDecoder().decode(decodeEntry(entries[MANIFEST_FILE])));
    const refs = await listFileRefs();
    expect(manifest.files.map((f) => f.path)).toEqual(refs.map((r) => r.path).sort());
    for (const ref of refs) {
      expect(entries[ref.path]).toBeDefined();
      expect(manifest.files.find((f) => f.path === ref.path)?.sha256).toBe(ref.sha256);
    }
    expect(entries[SNAPSHOT_FILE]).toBeDefined();
    expect(manifest).toMatchObject({ appVersion: '1.2.3', device: 'Test Phone · Android 15', agencyName: 'Coastline Rentals' });

    expect(progress.map((p) => p.step).filter((s, i, a) => a.indexOf(s) === i)).toEqual(['records', 'files', 'archive', 'verify']);
    const files = progress.filter((p) => p.step === 'files');
    expect(files[files.length - 1]).toEqual({ step: 'files', done: refs.length, total: refs.length });
  });

  it('records a drifted live file as damaged but keeps its real bytes', async () => {
    const [ref] = await listFileRefs();
    const target = `${h.location(INITIAL_ROOT).filesDir}/${ref.path}`;
    nodeFs().writeFileSync(target, 'bit-rotted content');
    const result = await backup();
    expect(result.damagedFiles).toEqual([ref.path]);
    // Still restorable: the manifest describes what was actually archived.
    await expect(prepare(result.uri)).resolves.toMatchObject({ backup: { damagedFiles: [ref.path] } });
  });

  it('checks free space before writing anything', async () => {
    h.free.bytes = 10;
    const error = await expectBackupError(backup(), 'no_space');
    expect(error.neededBytes).toBeGreaterThan(0);
    expect(error.freeBytes).toBe(10);
    expect(dirEntries(h.deps.backupStagingDir)).toEqual([]);
    expect((await estimateBackupWith(h.deps)).enoughSpace).toBe(false);
  });

  it('cancels cleanly and leaves no partial file', async () => {
    const controller = new AbortController();
    const run = createBackupWith(h.deps, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.step === 'files' && p.done === 2) controller.abort();
      },
    });
    await expectBackupError(run, 'cancelled');
    expect(dirEntries(h.deps.backupStagingDir)).toEqual([]);
  });

  it('logs the backup only when asked (after Save or Share) and discards the temp copy', async () => {
    const result = await backup();
    expect(await listBackupLog()).toEqual([]);
    await logBackupWith(h.deps, result);
    expect(await listBackupLog()).toMatchObject([{ kind: 'backup', fileName: result.fileName, byteSize: result.byteSize }]);
    discardBackupWith(h.deps, result);
    expect(nodeFs().existsSync(result.stagingDir)).toBe(false);
  });
});

describe('prepareRestore', () => {
  it('validates the whole archive in a new root without touching live data', async () => {
    const result = await backup();
    const liveBefore = await getRecordCounts();
    // An orphan rides along in the archive and must not survive the restore.
    const withOrphan = tamper(result.uri, (e) => {
      e['photos/leftover/orphan.jpg.tmp'] = encodeEntry(new TextEncoder().encode('half-written'));
    });
    const progress: RestoreProgress[] = [];
    const preview = await prepare(withOrphan, progress);

    expect(preview.backup).toMatchObject({ counts: result.counts, appVersion: '1.2.3', device: 'Test Phone · Android 15' });
    expect(preview.current.counts).toEqual(liveBefore);
    expect(preview.upgradedFrom).toBeNull();
    expect(h.pointer()).toMatchObject({ root: INITIAL_ROOT, previous: null });
    expect(dataRoots()).toEqual([INITIAL_ROOT, preview.rootName].sort());

    const staged = h.location(preview.rootName);
    expect(nodeFs().existsSync(`${staged.dbDir}/${SNAPSHOT_FILE}`)).toBe(true);
    expect(nodeFs().existsSync(`${staged.rootDir}/${MANIFEST_FILE}`)).toBe(true);
    expect(nodeFs().existsSync(`${staged.filesDir}/photos/leftover/orphan.jpg.tmp`)).toBe(false);
    expect(progress.map((p) => p.step).filter((s, i, a) => a.indexOf(s) === i)).toEqual(['open', 'unpack', 'files', 'records']);

    discardRestoreWith(h.deps, preview);
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
    expect(dirEntries(h.deps.restoreStagingDir)).toEqual([]);
  });

  it('refuses a file that is not a backup', async () => {
    const junk = `${h.cacheDir}/junk.carcheck`;
    nodeFs().writeFileSync(junk, 'PK this is a holiday photo');
    await expectBackupError(prepare(junk), 'not_a_backup');
    const noManifest = tamper((await backup()).uri, (e) => {
      delete e[MANIFEST_FILE];
    });
    await expectBackupError(prepare(noManifest), 'not_a_backup');
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
  });

  it('refuses a backup from a newer app version', async () => {
    const result = await backup();
    const newer = tamper(result.uri, (e) => {
      const m = parseManifest(new TextDecoder().decode(decodeEntry(e[MANIFEST_FILE])));
      const { manifestSha256: _sig, ...body } = { ...m, schemaVersion: m.schemaVersion + 1 };
      e[MANIFEST_FILE] = encodeEntry(new TextEncoder().encode(JSON.stringify({ ...body, manifestSha256: 'f'.repeat(64) })));
    });
    await expectBackupError(prepare(newer), 'newer_version');
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
  });

  it('blocks a restore when any file is damaged and lists it (same size, different bytes)', async () => {
    const result = await backup();
    const [ref] = await listFileRefs();
    const damaged = tamper(result.uri, (e) => {
      const bytes = decodeEntry(e[ref.path]);
      bytes[0] ^= 0xff;
      e[ref.path] = encodeEntry(bytes);
    });
    const error = await expectBackupError(prepare(damaged), 'corrupted');
    expect(error.details).toEqual([ref.path]);
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
    expect(dirEntries(h.deps.restoreStagingDir)).toEqual([]);
  });

  it('blocks a restore when files are missing from the archive', async () => {
    const result = await backup();
    const refs = await listFileRefs();
    const cut = tamper(result.uri, (e) => {
      delete e[refs[0].path];
      delete e[refs[1].path];
    });
    const error = await expectBackupError(prepare(cut), 'incomplete');
    expect(error.details).toEqual([refs[0].path, refs[1].path].sort());
  });

  it('catches a damaged database snapshot', async () => {
    const damaged = tamper((await backup()).uri, (e) => {
      const bytes = decodeEntry(e[SNAPSHOT_FILE]);
      bytes[bytes.length - 1] ^= 0x01;
      e[SNAPSHOT_FILE] = encodeEntry(bytes);
    });
    expect((await expectBackupError(prepare(damaged), 'corrupted')).details).toContain(SNAPSHOT_FILE);
  });

  it('catches a manifest that disagrees with the database (a signed but inconsistent manifest)', async () => {
    const result = await backup();
    const [ref] = await listFileRefs();
    const inconsistent = tamper(result.uri, (e) => {
      const m = parseManifest(new TextDecoder().decode(decodeEntry(e[MANIFEST_FILE])));
      const forged = buildManifest({
        ...m,
        createdAt: Date.parse(m.createdAt),
        files: m.files.filter((f) => f.path !== ref.path),
      });
      e[MANIFEST_FILE] = encodeEntry(new TextEncoder().encode(serializeManifest(forged)));
    });
    expect((await expectBackupError(prepare(inconsistent), 'incomplete')).details).toEqual([ref.path]);
  });

  it('refuses when the unpacked backup would not fit', async () => {
    const result = await backup();
    h.free.bytes = 100;
    const error = await expectBackupError(prepare(result.uri), 'no_space');
    expect(error.neededBytes).toBeGreaterThan(100);
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
  });

  it('can be cancelled while checking', async () => {
    const result = await backup();
    const controller = new AbortController();
    const run = prepareRestoreWith(
      h.deps,
      { archive: pickCopy(h, result.uri), fileName: 'x.carcheck' },
      { signal: controller.signal, onProgress: (p) => p.step === 'files' && p.done === 3 && controller.abort() },
    );
    await expectBackupError(run, 'cancelled');
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
  });
});

describe('commitRestore: pointer switch and rollback', () => {
  it('switches to the restored root, keeps the old one as a 14-day safety copy and logs the restore', async () => {
    const result = await backup();
    const preview = await prepare(result.uri);
    const before = t.clock.now;
    const outcome = await commitRestoreWith(h.deps, preview);
    const after = t.clock.now;

    expect(outcome.counts).toEqual(result.counts);
    const pointer = h.pointer();
    expect(pointer).toMatchObject({ root: preview.rootName, previous: INITIAL_ROOT, verifyPending: false });
    const fourteenDays = 14 * 86_400_000;
    expect(pointer?.previousUntil).toBeGreaterThan(before + fourteenDays);
    expect(pointer?.previousUntil).toBeLessThanOrEqual(after + fourteenDays);
    expect(h.liveRootName()).toBe(preview.rootName);
    expect(await getRecordCounts()).toEqual(result.counts);
    expect(await listBackupLog()).toMatchObject([{ kind: 'restore', fileName: 'picked.carcheck', backupCreatedAt: result.createdAt }]);
    expect(dirEntries(h.deps.restoreStagingDir)).toEqual([]);

    const copy = getSafetyCopyWith(h.deps);
    expect(copy).toMatchObject({ rootName: INITIAL_ROOT });
    expect(copy?.bytes).toBeGreaterThan(0);
  });

  it('restoring again replaces the older safety copy', async () => {
    const result = await backup();
    const first = await prepare(result.uri);
    await commitRestoreWith(h.deps, first);
    const second = await prepare(result.uri);
    await commitRestoreWith(h.deps, second);
    expect(h.pointer()).toMatchObject({ root: second.rootName, previous: first.rootName });
    expect(dataRoots()).toEqual([first.rootName, second.rootName].sort());
    deleteSafetyCopyWith(h.deps);
    expect(h.pointer()).toMatchObject({ root: second.rootName, previous: null, previousUntil: null });
    expect(dataRoots()).toEqual([second.rootName]);
    expect(getSafetyCopyWith(h.deps)).toBeNull();
  });

  it('rolls back when the restored root fails its first check at boot', async () => {
    const liveCounts = await getRecordCounts();
    const preview = await prepare((await backup()).uri);
    h.failVerify.add(preview.rootName);
    await expectBackupError(commitRestoreWith(h.deps, preview), 'switch_failed');
    expect(h.pointer()).toMatchObject({ root: INITIAL_ROOT, previous: null, verifyPending: false });
    expect(h.liveRootName()).toBe(INITIAL_ROOT);
    expect(await getRecordCounts()).toEqual(liveCounts);
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
  });

  it('writes the old pointer back and reopens the old data when booting the new root throws', async () => {
    const preview = await prepare((await backup()).uri);
    h.failBoot.add(preview.rootName);
    const error = await expectBackupError(commitRestoreWith(h.deps, preview), 'switch_failed');
    expect(error.details).toEqual([]);
    expect(h.pointer()).toMatchObject({ root: INITIAL_ROOT, previous: null, verifyPending: false });
    expect(h.liveRootName()).toBe(INITIAL_ROOT);
    expect(h.bootCount()).toBe(2);
    // The failed root is no longer named by the pointer; the next boot's sweep (here: the rollback boot) removed it.
    expect(dataRoots()).toEqual([INITIAL_ROOT]);
    expect(await getRecordCounts()).toMatchObject({ rentals: 1 });
  });

  it('reports when even the old data cannot be reopened', async () => {
    const preview = await prepare((await backup()).uri);
    h.failBoot.add(preview.rootName);
    h.failBoot.add(INITIAL_ROOT);
    const error = await expectBackupError(commitRestoreWith(h.deps, preview), 'switch_failed');
    expect(error.details).toEqual(['Close CarCheck and open it again.']);
    // The pointer still names the old data, so the next launch opens it.
    expect(h.pointer()).toMatchObject({ root: INITIAL_ROOT });
  });

  it('refuses to commit a preview whose staging is gone', async () => {
    const preview = await prepare((await backup()).uri);
    discardRestoreWith(h.deps, preview);
    await expectBackupError(commitRestoreWith(h.deps, preview), 'failed');
    expect(h.pointer()).toMatchObject({ root: INITIAL_ROOT });
    expect(h.bootCount()).toBe(0);
  });

  it('never deletes the live root when a committed preview is discarded late', async () => {
    const preview = await prepare((await backup()).uri);
    await commitRestoreWith(h.deps, preview);
    discardRestoreWith(h.deps, preview);
    expect(dataRoots()).toContain(preview.rootName);
  });
});

describe('restoring an older schema', () => {
  it('migrates the staged database forward before the confirm', async () => {
    const result = await backup();
    let restore: typeof import('../restore') | undefined;
    jest.isolateModules(() => {
      jest.doMock('../../migrations', () => {
        const actual = jest.requireActual<typeof import('../../migrations')>('../../migrations');
        return {
          ...actual,
          SCHEMA_VERSION: 2,
          migrate: async (db: Parameters<typeof actual.migrate>[0]) => {
            const from = await actual.getSchemaVersion(db);
            await actual.migrate(db);
            if (from < 2) await db.execAsync('BEGIN; CREATE TABLE upgrade_probe (x INTEGER); PRAGMA user_version = 2; COMMIT;');
            return { from, to: 2 };
          },
        };
      });
      restore = jest.requireActual<typeof import('../restore')>('../restore');
    });
    const preview = await restore!.prepareRestoreWith(h.deps, { archive: pickCopy(h, result.uri), fileName: 'old.carcheck' });
    expect(preview.upgradedFrom).toBe(1);
    const db = await h.deps.live.openDb(h.location(preview.rootName).dbDir, { pragmas: false });
    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')).toEqual({ user_version: 2 });
    await db.close();
    discardRestoreWith(h.deps, preview);
  });
});
