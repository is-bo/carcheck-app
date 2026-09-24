import {
  diffFileRefs,
  documentPath,
  exportFileName,
  isExpiredTempEntry,
  isValidRelPath,
  logoPath,
  photoPath,
  signaturePath,
} from '../filePaths';
import {
  abandonedRoots,
  chooseRootWithoutPointer,
  isSafetyCopyExpired,
  newPointer,
  parsePointer,
  pointerForRestore,
  pointerForRollback,
  resolvePointerFiles,
  serializePointer,
} from '../pointer';

describe('data-root pointer', () => {
  const live = newPointer('data-aaaa1111');

  it('round-trips and rejects garbage', () => {
    expect(parsePointer(serializePointer(live))).toEqual(live);
    expect(parsePointer('{"v":1,"root":"../etc"}')).toBeNull();
    expect(parsePointer('{"v":2,"root":"data-aaaa1111"}')).toBeNull();
    expect(parsePointer('{truncated')).toBeNull();
  });

  it('recovers an interrupted switch: a complete next pointer always wins', () => {
    const next = pointerForRestore('data-aaaa1111', 'data-bbbb2222', 1000);
    expect(resolvePointerFiles(null, serializePointer(next))).toEqual({ pointer: next, promoteNext: true, deleteNext: false });
    expect(resolvePointerFiles(serializePointer(live), serializePointer(next)).pointer).toEqual(next);
    expect(resolvePointerFiles(serializePointer(live), '{"v":1,"ro')).toEqual({ pointer: live, promoteNext: false, deleteNext: true });
  });

  it('keeps the previous root as a 14-day safety copy and rolls back to it', () => {
    const restored = pointerForRestore('data-aaaa1111', 'data-bbbb2222', 0);
    expect(restored).toMatchObject({ root: 'data-bbbb2222', previous: 'data-aaaa1111', verifyPending: true });
    expect(isSafetyCopyExpired(restored, 13 * 86_400_000)).toBe(false);
    expect(isSafetyCopyExpired(restored, 14 * 86_400_000)).toBe(true);
    expect(pointerForRollback(restored)).toEqual(newPointer('data-aaaa1111'));
    expect(abandonedRoots(['data-aaaa1111', 'data-bbbb2222', 'data-cccc3333', 'other'], restored)).toEqual(['data-cccc3333']);
  });

  it('adopts the most recently written root when the pointer is lost', () => {
    expect(
      chooseRootWithoutPointer([
        { name: 'data-aaaa1111', dbModifiedAt: 5 },
        { name: 'data-bbbb2222', dbModifiedAt: 9 },
        { name: 'data-cccc3333', dbModifiedAt: null },
      ]),
    ).toBe('data-bbbb2222');
    expect(chooseRootWithoutPointer([])).toBeNull();
  });
});

describe('file paths', () => {
  it('builds id-only relative paths that satisfy the DB check', () => {
    const paths = [
      photoPath('r1', 'p1'),
      signaturePath('r1', 'c1'),
      documentPath({ customerId: 'c9' }, 'd1'),
      documentPath({ rentalId: 'r1' }, 'd2'),
      logoPath('f1'),
    ];
    expect(paths).toEqual(['photos/r1/p1.jpg', 'signatures/r1/c1.png', 'docs/c9/d1.jpg', 'docs/r-r1/d2.jpg', 'agency/logo-f1.png']);
    expect(paths.every(isValidRelPath)).toBe(true);
    expect(() => photoPath('../x', 'p')).toThrow();
    for (const bad of ['/abs/x.jpg', 'file:///x', 'photos/../x', 'x.jpg', 'photos//x', 'photos\\x', 'photos/']) {
      expect(isValidRelPath(bad)).toBe(false);
    }
  });

  it('finds orphans older than an hour and reports missing files', () => {
    const now = 10 * 3_600_000;
    const diff = diffFileRefs(
      [
        { path: 'photos/r/a.jpg', size: 1, modifiedAt: 0 },
        { path: 'photos/r/b.jpg', size: 1, modifiedAt: 0 },
        { path: 'photos/r/fresh.jpg', size: 1, modifiedAt: now - 60_000 },
      ],
      ['photos/r/a.jpg', 'photos/r/gone.jpg'],
      now,
    );
    expect(diff.orphans.map((o) => o.path)).toEqual(['photos/r/b.jpg']);
    expect(diff.missing).toEqual(['photos/r/gone.jpg']);
  });

  it('keeps share copies for 24 h and other temp files for 1 h', () => {
    const h = 3_600_000;
    expect(isExpiredTempEntry('exports', 0, 23 * h)).toBe(false);
    expect(isExpiredTempEntry('exports', 0, 24 * h)).toBe(true);
    expect(isExpiredTempEntry('capture', 0, h)).toBe(true);
    expect(isExpiredTempEntry('backup', 0, h - 1)).toBe(false);
  });

  it('makes friendly export names', () => {
    expect(exportFileName(['R-0142', 'Rear left'], 'jpg')).toBe('CarCheck_R-0142_Rear-left.jpg');
    expect(exportFileName([null, 'report / final'], '.pdf')).toBe('CarCheck_report-final.pdf');
  });
});
