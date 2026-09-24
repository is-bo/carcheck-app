import { exportFileName, isStagingExpired, stagingBatchName, stagingBatchTime, uniqueFileNames } from '../naming';

describe('exportFileName', () => {
  it('builds readable names from the rental reference', () => {
    expect(exportFileName({ reference: 'R-0142', kind: 'evidence', angleKey: 'front_left', extension: 'jpg' })).toBe(
      'R-0142_front-left_evidence.jpg',
    );
    expect(exportFileName({ reference: 'R-0142', kind: 'report', extension: 'pdf' })).toBe('R-0142_damage-report.pdf');
    expect(exportFileName({ reference: 'R-0142', kind: 'contract', sequence: 2, extension: 'pdf' })).toBe(
      'R-0142_contract-2.pdf',
    );
    expect(exportFileName({ reference: 'R-0142', kind: 'evidence_pack', extension: 'pdf' })).toBe(
      'R-0142_evidence-pack.pdf',
    );
    expect(
      exportFileName({ reference: 'R-0142', kind: 'original', angleKey: 'closeup', slot: 2, phase: 'after', extension: 'jpg' }),
    ).toBe('R-0142_closeup-2_after_original.jpg');
  });

  it('strips unsafe characters and falls back without a reference', () => {
    expect(exportFileName({ reference: '../R/01 42', kind: 'report', extension: 'pdf' })).toBe('R01-42_damage-report.pdf');
    expect(exportFileName({ reference: null, kind: 'contract', extension: 'pdf' })).toBe('CarCheck_contract.pdf');
  });
});

describe('uniqueFileNames', () => {
  it('suffixes duplicates case-insensitively', () => {
    expect(uniqueFileNames(['a.jpg', 'A.jpg', 'a.jpg', 'b'])).toEqual(['a.jpg', 'A-2.jpg', 'a-3.jpg', 'b']);
  });
});

describe('staging batches', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 1_790_000_000_000;

  it('encodes creation time in the batch name', () => {
    const name = stagingBatchName(now, 'x1y2-z3!');
    expect(name).toBe(`${now}-x1y2z3`);
    expect(stagingBatchTime(name)).toBe(now);
    expect(stagingBatchTime('notes.txt')).toBeNull();
  });

  it('expires after 24 h, using mtime when the name has no time', () => {
    expect(isStagingExpired({ name: stagingBatchName(now - day - 1, 'a'), modificationTime: null }, now)).toBe(true);
    expect(isStagingExpired({ name: stagingBatchName(now - day + 1000, 'a'), modificationTime: null }, now)).toBe(false);
    expect(isStagingExpired({ name: 'stray.pdf', modificationTime: now - 2 * day }, now)).toBe(true);
    expect(isStagingExpired({ name: 'stray.pdf', modificationTime: null }, now)).toBe(false);
  });
});
