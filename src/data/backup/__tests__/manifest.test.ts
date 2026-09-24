/** @jest-environment node */
import { BACKUP_FORMAT_VERSION, type FileRef } from '@/domain/types';

import { SCHEMA_VERSION } from '../../migrations';
import { BackupError, describeBackupError } from '../errors';
import {
  backupFileName,
  backupReminder,
  buildManifest,
  canonicalJson,
  checkArchiveEntries,
  classifyFiles,
  manifestDigest,
  parseManifest,
  requiredBackupBytes,
  requiredRestoreBytes,
  serializeManifest,
  unlistedReferences,
  type CarCheckBackupManifest,
  type ManifestInput,
} from '../manifest';
import { sha256Utf8 } from '../sha256';

const H = (s: string) => sha256Utf8(s);
const DAY = 86_400_000;

function input(overrides: Partial<ManifestInput> = {}): ManifestInput {
  return {
    appVersion: '1.0.0',
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.UTC(2026, 8, 24, 14, 2, 11, 402),
    platform: 'android',
    device: 'Pixel 7 · Android 15',
    agencyName: 'Coastline Rentals',
    counts: { vehicles: 2, customers: 1, rentals: 1, photos: 2, signedContracts: 1, files: 3 },
    db: { size: 4096, sha256: H('db') },
    files: [
      { path: 'photos/r1/p2.jpg', size: 20, sha256: H('p2') },
      { path: 'photos/r1/p1.jpg', size: 10, sha256: H('p1') },
    ],
    missingFiles: ['signatures/r1/c1.png'],
    damagedFiles: [],
    ...overrides,
  };
}

function expectError(fn: () => unknown, code: BackupError['code']): BackupError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BackupError);
    expect((e as BackupError).code).toBe(code);
    return e as BackupError;
  }
  throw new Error(`expected ${code}`);
}

/** Rewrites a field and re-signs, as a newer app (or a careful forger) would. */
function resign(m: CarCheckBackupManifest, patch: Record<string, unknown>): string {
  const { manifestSha256: _old, ...body } = { ...m, ...patch } as CarCheckBackupManifest;
  return JSON.stringify({ ...body, manifestSha256: manifestDigest(body) });
}

describe('manifest building', () => {
  it('sorts files, totals bytes and signs itself', () => {
    const m = buildManifest(input());
    expect(m).toMatchObject({
      format: 'carcheck-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: '2026-09-24T14:02:11.402Z',
      device: 'Pixel 7 · Android 15',
      totalBytes: 4096 + 30,
      db: { path: 'carcheck.db', size: 4096 },
    });
    expect(m.files.map((f) => f.path)).toEqual(['photos/r1/p1.jpg', 'photos/r1/p2.jpg']);
    const { manifestSha256, ...body } = m;
    expect(manifestSha256).toBe(sha256Utf8(canonicalJson(body)));
  });

  it('canonical JSON ignores key order and undefined fields', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }], e: 'x' })).toBe('{"a":[{"d":2}],"b":1,"e":"x"}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('round-trips through JSON', () => {
    const m = buildManifest(input());
    expect(parseManifest(serializeManifest(m))).toEqual(m);
  });

  it('names the file after the local creation minute', () => {
    expect(backupFileName(new Date(2026, 8, 4, 9, 5))).toBe('CarCheck-backup-2026-09-04-0905.carcheck');
  });
});

describe('manifest validation and version gating', () => {
  const m = buildManifest(input());

  it('rejects files that are not CarCheck backups', () => {
    expectError(() => parseManifest('PK\u0003\u0004 binary'), 'not_a_backup');
    expectError(() => parseManifest('[]'), 'not_a_backup');
    expectError(() => parseManifest(JSON.stringify({ ...m, format: 'other-app' })), 'not_a_backup');
  });

  it('calls a truncated manifest of ours corrupted, not foreign', () => {
    expectError(() => parseManifest(serializeManifest(m).slice(0, 120)), 'corrupted');
  });

  it('detects any edit through the self-hash', () => {
    const edited = JSON.parse(serializeManifest(m)) as CarCheckBackupManifest;
    edited.files[0].sha256 = H('tampered');
    expectError(() => parseManifest(JSON.stringify(edited)), 'corrupted');
    expectError(() => parseManifest(JSON.stringify({ ...m, agencyName: 'Other' })), 'corrupted');
  });

  it('refuses a newer backup format or schema with the version it was made with', () => {
    const format = expectError(() => parseManifest(resign(m, { formatVersion: BACKUP_FORMAT_VERSION + 1 })), 'newer_version');
    expect(format.details).toEqual(['Made with CarCheck 1.0.0']);
    expectError(() => parseManifest(resign(m, { schemaVersion: SCHEMA_VERSION + 1 })), 'newer_version');
    // Gating happens before the hash: a newer format may sign differently.
    expectError(() => parseManifest(JSON.stringify({ ...m, schemaVersion: SCHEMA_VERSION + 1 })), 'newer_version');
  });

  it('accepts older schemas (the restore migrates them) up to what the reader supports', () => {
    const older = parseManifest(resign(m, { schemaVersion: 1 }), { formatVersion: 1, schemaVersion: 3 });
    expect(older.schemaVersion).toBe(1);
    expectError(() => parseManifest(resign(m, { schemaVersion: 4 }), { formatVersion: 1, schemaVersion: 3 }), 'newer_version');
  });

  it('rejects malformed but correctly signed manifests', () => {
    expectError(() => parseManifest(resign(m, { files: [{ path: '../etc/passwd', size: 1, sha256: H('x') }] })), 'corrupted');
    expectError(() => parseManifest(resign(m, { files: [...m.files, m.files[0]], totalBytes: m.totalBytes + 10 })), 'corrupted');
    expectError(() => parseManifest(resign(m, { totalBytes: 1 })), 'corrupted');
    expectError(() => parseManifest(resign(m, { db: { ...m.db, path: 'other.db' } })), 'corrupted');
    expectError(() => parseManifest(resign(m, { counts: { ...m.counts, rentals: -1 } })), 'corrupted');
    expectError(() => parseManifest(resign(m, { createdAt: 'yesterday' })), 'corrupted');
  });
});

describe('archive checks', () => {
  const m = buildManifest(input());
  const entries = [
    { path: 'manifest.json', size: 900, isDirectory: false },
    { path: 'carcheck.db', size: 4096, isDirectory: false },
    { path: 'photos/', size: 0, isDirectory: true },
    { path: 'photos/r1/p1.jpg', size: 10, isDirectory: false },
    { path: 'photos/r1/p2.jpg', size: 20, isDirectory: false },
    { path: 'photos/r1/orphan.jpg', size: 5, isDirectory: false },
  ];

  it('accepts a complete archive, extra entries included', () => {
    expect(() => checkArchiveEntries(m, entries)).not.toThrow();
  });

  it('lists entries missing from a cut-off archive', () => {
    const e = expectError(() => checkArchiveEntries(m, entries.filter((x) => x.path !== 'photos/r1/p2.jpg')), 'incomplete');
    expect(e.details).toEqual(['photos/r1/p2.jpg']);
    expectError(() => checkArchiveEntries(m, entries.filter((x) => x.path !== 'carcheck.db')), 'incomplete');
  });

  it('flags entries whose size differs from the manifest', () => {
    const resized = entries.map((x) => (x.path === 'photos/r1/p1.jpg' ? { ...x, size: 11 } : x));
    expect(expectError(() => checkArchiveEntries(m, resized), 'corrupted').details).toEqual(['photos/r1/p1.jpg']);
  });

  it('finds database references the manifest does not carry', () => {
    const refs: FileRef[] = [
      { id: 'a', owner: 'photo', path: 'photos/r1/p1.jpg', byteSize: 10, sha256: H('p1') },
      { id: 'b', owner: 'signature', path: 'signatures/r1/c1.png', byteSize: 3, sha256: H('s') },
      { id: 'c', owner: 'artifact', path: 'generated/r1/a1.pdf', byteSize: 3, sha256: H('a') },
    ];
    expect(unlistedReferences(refs, m)).toEqual(['generated/r1/a1.pdf']);
  });
});

describe('file classification at backup time', () => {
  const ref = (path: string, byteSize: number, content: string): FileRef => ({ id: path, owner: 'photo', path, byteSize, sha256: H(content) });

  it('keeps actual bytes, records missing and drifted files', () => {
    const refs = [ref('photos/r/ok.jpg', 2, 'ok'), ref('photos/r/gone.jpg', 4, 'gone'), ref('photos/r/rot.jpg', 3, 'rot'), ref('photos/r/ok.jpg', 2, 'ok')];
    const observed = new Map([
      ['photos/r/ok.jpg', { size: 2, sha256: H('ok') }],
      ['photos/r/gone.jpg', null],
      ['photos/r/rot.jpg', { size: 3, sha256: H('bit-rot') }],
    ]);
    expect(classifyFiles(refs, observed)).toEqual({
      files: [
        { path: 'photos/r/ok.jpg', size: 2, sha256: H('ok') },
        { path: 'photos/r/rot.jpg', size: 3, sha256: H('bit-rot') },
      ],
      missingFiles: ['photos/r/gone.jpg'],
      damagedFiles: ['photos/r/rot.jpg'],
    });
  });
});

describe('space and reminders', () => {
  it('needs room for the snapshot and the archive', () => {
    expect(requiredBackupBytes(1000, 100)).toBe(1320);
    expect(requiredRestoreBytes(1000)).toBe(1050);
  });

  it('reminds after more than 7 days, never on an empty phone', () => {
    const now = Date.UTC(2026, 8, 24);
    expect(backupReminder(null, now, true)).toEqual({ due: true, daysSince: null });
    expect(backupReminder(null, now, false)).toEqual({ due: false, daysSince: null });
    expect(backupReminder(now - 7 * DAY, now, true)).toEqual({ due: false, daysSince: 7 });
    expect(backupReminder(now - 9 * DAY, now, true)).toEqual({ due: true, daysSince: 9 });
  });
});

describe('error copy', () => {
  const bytes = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

  it('says nothing changed for every restore failure', () => {
    for (const code of ['not_a_backup', 'corrupted', 'incomplete', 'newer_version', 'no_space', 'upgrade_failed', 'switch_failed'] as const) {
      expect(describeBackupError(new BackupError(code, 'restore', 'x'), bytes).message).toContain('Nothing on this phone was changed.');
    }
  });

  it('gives the numbers when space is short and caps long detail lists', () => {
    const e = new BackupError('no_space', 'restore', 'x', { neededBytes: 2.3e9, freeBytes: 1.1e9 });
    expect(describeBackupError(e, bytes).message).toBe('The restore needs 2.3 GB; 1.1 GB is free. Nothing on this phone was changed.');
    const many = new BackupError('incomplete', 'restore', 'x', { details: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    const copy = describeBackupError(many, bytes);
    expect(copy.message).toMatch(/^7 files are missing/);
    expect(copy.details).toEqual(['a', 'b', 'c', 'd', 'e', 'and 2 more']);
  });

  it('has its own copy for backup failures', () => {
    const e = new BackupError('no_space', 'backup', 'x', { neededBytes: 2e9, freeBytes: 1e9 });
    expect(describeBackupError(e, bytes)).toMatchObject({ title: 'Not enough space for the backup' });
    expect(describeBackupError(new Error('disk'), bytes).details).toEqual(['disk']);
  });
});
