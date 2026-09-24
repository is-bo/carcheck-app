import type { GeneratedArtifact, Rental } from '@/domain/types';

import { reportFingerprint, returnDocumentsState } from '../reportState';

const rental = (over: Partial<Pick<Rental, 'status' | 'returnReopenedAt' | 'returnRevision' | 'returnCompletedAt'>> = {}) => ({
  id: 'r1',
  status: 'returned' as const,
  returnReopenedAt: null,
  returnRevision: 1,
  returnCompletedAt: 1000,
  ...over,
});

const artifact = (id: string, fingerprint = 'f'): GeneratedArtifact => ({
  id,
  rentalId: 'r1',
  kind: 'evidence_image',
  pairKey: { angleKey: 'front', slot: 1 },
  contractId: null,
  file: { path: `generated/r1/${id}.jpg`, byteSize: 1, sha256: 'x' },
  mimeType: 'image/jpeg',
  width: 1,
  height: 1,
  pageCount: null,
  sourceFingerprint: fingerprint,
  generatedAt: 0,
});

describe('reportFingerprint', () => {
  it('ignores evidence order', () => {
    expect(reportFingerprint(rental(), [artifact('a'), artifact('b')])).toBe(reportFingerprint(rental(), [artifact('b'), artifact('a')]));
  });

  it('changes with a new revision or new evidence files', () => {
    const base = reportFingerprint(rental(), [artifact('a')]);
    expect(reportFingerprint(rental({ returnRevision: 2, returnCompletedAt: 2000 }), [artifact('a')])).not.toBe(base);
    expect(reportFingerprint(rental(), [artifact('c')])).not.toBe(base);
  });
});

describe('returnDocumentsState', () => {
  const evidence = [artifact('a')];
  const report = (fp: string): GeneratedArtifact => ({ ...artifact('rep', fp), kind: 'report_pdf', pairKey: null });

  it('is not_returned while the return is open or reopened', () => {
    const input = { report: null, reportFileExists: false, evidence, evidenceFilesExist: true };
    expect(returnDocumentsState({ ...input, rental: rental({ status: 'active' }) }).phase).toBe('not_returned');
    expect(returnDocumentsState({ ...input, rental: rental({ returnReopenedAt: 5 }) }).phase).toBe('not_returned');
  });

  it('is ready when the report matches the completed return', () => {
    const r = rental();
    const state = returnDocumentsState({
      rental: r,
      report: report(reportFingerprint(r, evidence)),
      reportFileExists: true,
      evidence,
      evidenceFilesExist: true,
    });
    expect(state.phase).toBe('ready');
  });

  it('needs a build when anything is missing or out of date', () => {
    const r = rental();
    const fresh = report(reportFingerprint(r, evidence));
    const base = { rental: r, report: fresh, reportFileExists: true, evidence, evidenceFilesExist: true };
    expect(returnDocumentsState({ ...base, report: null }).phase).toBe('needs_build');
    expect(returnDocumentsState({ ...base, reportFileExists: false }).phase).toBe('needs_build');
    expect(returnDocumentsState({ ...base, evidenceFilesExist: false }).phase).toBe('needs_build');
    expect(returnDocumentsState({ ...base, rental: rental({ returnRevision: 2 }) }).phase).toBe('needs_build');
  });
});
