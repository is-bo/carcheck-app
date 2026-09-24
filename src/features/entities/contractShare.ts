/**
 * Sharing an already-generated document (vehicle detail's Documents list: contract and report
 * PDFs of past rentals). Rental detail's own "Share PDF" uses `shareContractPdf` from
 * `@/features/contract/contractPdf` instead, which renders the contract PDF on demand if it
 * isn't there yet; vehicle documents are historical, so their artifacts are expected to exist.
 */
import { Directory, Paths } from 'expo-file-system';

import { resolveFileUri } from '@/data/files';
import type { GeneratedArtifact } from '@/domain/types';
import { exportFileName, mimeTypeFor, shareFile, type ExportKind } from '@/documents';

const ARTIFACT_EXPORT_KIND: Record<GeneratedArtifact['kind'], ExportKind> = {
  contract_pdf: 'contract',
  report_pdf: 'report',
  evidence_image: 'evidence',
  contact_sheet: 'contact_sheet',
};

export async function shareGeneratedArtifact(artifact: GeneratedArtifact, reference: string | null): Promise<void> {
  const kind = ARTIFACT_EXPORT_KIND[artifact.kind];
  const extension = artifact.mimeType === 'application/pdf' ? 'pdf' : 'jpg';
  await shareFile(
    {
      uri: resolveFileUri(artifact.file.path),
      fileName: exportFileName({ reference, kind, extension }),
      mimeType: mimeTypeFor(extension),
      kind,
    },
    { stagingDir: new Directory(Paths.cache, 'exports').uri, title: 'Share document' },
  );
}
