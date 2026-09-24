/**
 * Signed-contract PDF: the frozen HTML with its photo and signature references embedded, printed
 * on-device (expo-print) and stored as the contract's generated artifact. Regenerated only when
 * missing or stale (e.g. the contract was voided since), so sharing is instant after the first
 * render. Generation after signing runs in the background and retries quietly (UX §2.5).
 */
import { Directory, File, Paths } from 'expo-file-system';

import { newTempFileUri, resolveFileUri, sha256OfUri } from '@/data/files';
import { getAgencySettings, getArtifactStatus, getContract, getPhoto, getRental, saveArtifact } from '@/data/repos';
import type { ArtifactTarget, GeneratedArtifact, Id, SignedContractWithState } from '@/domain/types';
import {
  buildContractPdfHtml,
  createContractResolver,
  exportFileName,
  listContractRefs,
  renderPdf,
  shareFile,
} from '@/documents';

/** Bump when the PDF layout changes so stored PDFs are re-rendered on next use. */
export const CONTRACT_PDF_LAYOUT_VERSION = 1;

/** Opaque staleness key of a contract PDF: content hash plus void state. */
export function contractPdfFingerprint(c: Pick<SignedContractWithState, 'id' | 'contentSha256' | 'void'>): string {
  const state = c.void ? `void@${c.void.voidedAt}` : 'valid';
  return `contract-pdf/${CONTRACT_PDF_LAYOUT_VERSION}:${c.id}:${c.contentSha256}:${state}`;
}

/** Delays before each attempt of the background render (ms). */
export const CONTRACT_PDF_RETRY_DELAYS = [0, 3000, 15000] as const;

const inFlight = new Map<Id, Promise<GeneratedArtifact>>();

async function render(contractId: Id): Promise<GeneratedArtifact> {
  const contract = await getContract(contractId);
  const target: ArtifactTarget = { kind: 'contract_pdf', contractId };
  const fingerprint = contractPdfFingerprint(contract);
  const status = await getArtifactStatus(contract.rentalId, target, fingerprint);
  if (status.status === 'fresh' && status.artifact) return status.artifact;

  const [rental, agency] = await Promise.all([getRental(contract.rentalId), getAgencySettings()]);
  const photos = new Map<string, { uri: string; width: number; height: number }>();
  for (const ref of listContractRefs(contract.renderedHtml)) {
    if (ref.kind !== 'photo') continue;
    try {
      const p = await getPhoto(ref.photoId);
      photos.set(ref.photoId, { uri: resolveFileUri(p.file.path), width: p.file.width, height: p.file.height });
    } catch {
      // printed as "Photo unavailable"
    }
  }
  const resolver = createContractResolver({
    photoFile: (id) => photos.get(id) ?? null,
    signatureUri: resolveFileUri(contract.signature.path),
  });
  const html = await buildContractPdfHtml(
    { ...contract, reference: rental.reference ?? '', agencyName: agency.name },
    resolver,
  );
  const pdf = await renderPdf(html, newTempFileUri('capture', 'pdf'));
  const file = new File(pdf.uri);
  return saveArtifact(
    contract.rentalId,
    target,
    { tempUri: pdf.uri, byteSize: file.size ?? 0, sha256: await sha256OfUri(pdf.uri), pageCount: pdf.pageCount },
    { mimeType: 'application/pdf', sourceFingerprint: fingerprint },
  );
}

/** The stored PDF of a contract, rendering it first if it is missing or stale. */
export function ensureContractPdf(contractId: Id): Promise<GeneratedArtifact> {
  let job = inFlight.get(contractId);
  if (!job) {
    job = render(contractId).finally(() => inFlight.delete(contractId));
    inFlight.set(contractId, job);
  }
  return job;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Fire-and-forget render right after signing; retries quietly, never surfaces an error. */
export function generateContractPdfInBackground(contractId: Id): void {
  void (async () => {
    for (const delay of CONTRACT_PDF_RETRY_DELAYS) {
      if (delay > 0) await wait(delay);
      try {
        await ensureContractPdf(contractId);
        return;
      } catch (e) {
        console.warn('[contract] PDF render failed', e);
      }
    }
  })();
}

/** Opens the share sheet with a named copy of the signed contract PDF ("R-0142_contract.pdf"). */
export async function shareContractPdf(contractId: Id): Promise<void> {
  const artifact = await ensureContractPdf(contractId);
  const contract = await getContract(contractId);
  const rental = await getRental(contract.rentalId);
  await shareFile(
    {
      uri: resolveFileUri(artifact.file.path),
      fileName: exportFileName({ reference: rental.reference, kind: 'contract', sequence: contract.sequence, extension: 'pdf' }),
      mimeType: 'application/pdf',
      kind: 'contract',
    },
    { stagingDir: new Directory(Paths.cache, 'exports').uri, title: 'Signed contract' },
  );
}
