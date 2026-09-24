/**
 * When the return documents must be (re)built (pure). A completed return reuses what it has
 * (DATA_MODEL §9): the report is rebuilt only when it is missing, the return was completed
 * again (revision), the evidence set changed, or the employee asked for it.
 */
import type { GeneratedArtifact, Rental } from '@/domain/types';

export const REPORT_FINGERPRINT_VERSION = 1;

/** Opaque staleness key stored with the report PDF. */
export function reportFingerprint(
  rental: Pick<Rental, 'id' | 'returnRevision' | 'returnCompletedAt'>,
  evidence: readonly Pick<GeneratedArtifact, 'id'>[],
): string {
  const ids = evidence.map((e) => e.id).sort();
  return [`report/${REPORT_FINGERPRINT_VERSION}`, rental.id, `rev=${rental.returnRevision}`, `done=${rental.returnCompletedAt ?? 0}`, `ev=${ids.join(',')}`].join('|');
}

export type ReturnDocumentsPhase =
  /** The return is not completed (or is reopened): nothing to build yet. */
  | 'not_returned'
  /** Report and evidence exist and match the completed return. */
  | 'ready'
  /** Something is missing or out of date. */
  | 'needs_build';

export interface ReturnDocumentsState {
  phase: ReturnDocumentsPhase;
  report: GeneratedArtifact | null;
}

export function isReturnCompleted(rental: Pick<Rental, 'status' | 'returnReopenedAt'>): boolean {
  return rental.status === 'returned' && rental.returnReopenedAt === null;
}

/**
 * `reportFileExists` / `evidenceFilesExist`: whether the stored files are on disk (a restore
 * with damaged media can leave rows without files).
 */
export function returnDocumentsState(input: {
  rental: Pick<Rental, 'id' | 'status' | 'returnReopenedAt' | 'returnRevision' | 'returnCompletedAt'>;
  report: GeneratedArtifact | null;
  reportFileExists: boolean;
  evidence: readonly GeneratedArtifact[];
  evidenceFilesExist: boolean;
}): ReturnDocumentsState {
  const { rental, report } = input;
  if (!isReturnCompleted(rental)) return { phase: 'not_returned', report };
  if (!report || !input.reportFileExists || !input.evidenceFilesExist) return { phase: 'needs_build', report };
  const fresh = report.sourceFingerprint === reportFingerprint(rental, input.evidence);
  return { phase: fresh ? 'ready' : 'needs_build', report };
}
