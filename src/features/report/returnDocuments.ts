/**
 * The return report screen's services: what exists, (re)building evidence + report, and every
 * way of handing them over (share one image, share all, share or print the report, share the
 * signed contract). Everything leaves the app as a staged copy (ARCHITECTURE §6).
 */
import { Directory, File, Paths } from 'expo-file-system';

import { newTempFileUri, resolveFileUri, sha256OfUri, storedFileExists } from '@/data/files';
import {
  getAgencySettings,
  getAnglePairs,
  getArtifact,
  getRental,
  getValidContract,
  listArtifacts,
  listContracts,
  listDamage,
  listPhotos,
  saveArtifact,
} from '@/data/repos';
import type { AnglePair, Damage, GeneratedArtifact, Id, PairKey, Rental } from '@/domain/types';
import {
  buildContractPdfHtml,
  createContractResolver,
  exportFileName,
  MultiShareUnavailableError,
  printPdf,
  renderPdf,
  shareFile,
  shareFiles,
  type ShareItem,
} from '@/documents';

import { generateEvidence, type EvidenceImage } from '../evidence/generateEvidence';
import { planEvidence } from '../evidence/evidencePlan';
import { pairId } from '../evidence/returnPlan';
import { buildEvidencePackPdf, buildReport } from './buildReport';
import { returnDocumentsState, type ReturnDocumentsState } from './reportState';

export interface ReportData {
  rental: Rental;
  pairs: AnglePair[];
  damages: Damage[];
  /** Evidence images in walk-around order, with the damages each one draws. */
  evidence: EvidenceImage[];
  documents: ReturnDocumentsState;
}

function fileOk(a: GeneratedArtifact): boolean {
  return storedFileExists(a.file.path);
}

/** Current state for the report screen; cheap (no image work). */
export async function loadReportData(rentalId: Id): Promise<ReportData> {
  const [rental, pairs, damages, evidenceArtifacts, report] = await Promise.all([
    getRental(rentalId),
    getAnglePairs(rentalId),
    listDamage(rentalId),
    listArtifacts(rentalId, 'evidence_image'),
    getArtifact(rentalId, { kind: 'report_pdf' }),
  ]);
  const plan = planEvidence(pairs, damages);
  const evidence: EvidenceImage[] = [];
  for (const t of plan.targets) {
    const artifact = evidenceArtifacts.find((a) => a.pairKey && pairId(a.pairKey) === pairId(t));
    if (!artifact) continue;
    evidence.push({ angleKey: t.angleKey, slot: t.slot, label: t.label, artifact, damageIds: t.damages.map((d) => d.id) });
  }
  const documents = returnDocumentsState({
    rental,
    report,
    reportFileExists: report ? fileOk(report) : false,
    evidence: evidence.map((e) => e.artifact),
    evidenceFilesExist: evidence.length === plan.targets.length && evidence.every((e) => fileOk(e.artifact)),
  });
  return { rental, pairs, damages, evidence, documents };
}

export type BuildProgress = { step: 'evidence'; index: number; total: number; label: string } | { step: 'report' };

/**
 * Evidence images (only stale ones, or all with `force`), then the report PDF. Safe to re-run
 * after a crash: every artifact is swapped in atomically by the repository.
 */
export async function buildReturnDocuments(
  rentalId: Id,
  options: { force?: boolean; onProgress?: (p: BuildProgress) => void } = {},
): Promise<GeneratedArtifact> {
  const evidence = await generateEvidence(rentalId, {
    force: options.force,
    onProgress: (p) => options.onProgress?.({ step: 'evidence', ...p }),
  });
  options.onProgress?.({ step: 'report' });
  return buildReport(rentalId, evidence.images);
}

// ---------------------------------------------------------------------------------------------
// Handing documents over

function stagingDir(): string {
  const dir = new Directory(Paths.cache, 'exports');
  dir.create({ intermediates: true, idempotent: true });
  return dir.uri;
}

function evidenceItem(reference: string | null, e: PairKey & { artifact: GeneratedArtifact }): ShareItem {
  return {
    uri: resolveFileUri(e.artifact.file.path),
    fileName: exportFileName({ reference, kind: 'evidence', angleKey: e.angleKey, slot: e.slot, extension: 'jpg' }),
    mimeType: 'image/jpeg',
    kind: 'evidence',
  };
}

export async function shareEvidenceImage(rental: Pick<Rental, 'reference'>, e: EvidenceImage): Promise<void> {
  await shareFile(evidenceItem(rental.reference, e), { stagingDir: stagingDir(), title: `${e.label} evidence` });
}

/**
 * All evidence images in one share sheet. Without multi-file sharing (e.g. Expo Go) the images
 * go out as one evidence-pack PDF instead. Returns which way they went.
 */
export async function shareAllEvidence(rental: Pick<Rental, 'id' | 'reference'>, evidence: readonly EvidenceImage[]): Promise<'images' | 'pack'> {
  const title = 'Evidence images';
  try {
    await shareFiles(
      evidence.map((e) => evidenceItem(rental.reference, e)),
      { stagingDir: stagingDir(), title },
    );
    return 'images';
  } catch (error) {
    if (!(error instanceof MultiShareUnavailableError)) throw error;
  }
  const pack = await buildEvidencePackPdf(rental.id, evidence);
  await shareFile(
    {
      uri: pack,
      fileName: exportFileName({ reference: rental.reference, kind: 'evidence_pack', extension: 'pdf' }),
      mimeType: 'application/pdf',
      kind: 'evidence_pack',
    },
    { stagingDir: stagingDir(), title },
  );
  return 'pack';
}

export async function shareReportPdf(rental: Pick<Rental, 'reference'>, report: GeneratedArtifact): Promise<void> {
  await shareFile(
    {
      uri: resolveFileUri(report.file.path),
      fileName: exportFileName({ reference: rental.reference, kind: 'report', extension: 'pdf' }),
      mimeType: 'application/pdf',
      kind: 'report',
    },
    { stagingDir: stagingDir(), title: 'Return report' },
  );
}

export async function printReport(report: GeneratedArtifact): Promise<void> {
  await printPdf(resolveFileUri(report.file.path));
}

/**
 * The valid signed contract as a PDF: the stored one when present (rendered at signing), else
 * rendered now from the frozen contract and stored for next time.
 */
export async function shareSignedContract(rentalId: Id): Promise<void> {
  const all = await listContracts(rentalId);
  const contract = (await getValidContract(rentalId)) ?? all[all.length - 1] ?? null;
  if (!contract) throw new Error('This rental has no signed contract.');
  const rental = await getRental(rentalId);
  const target = { kind: 'contract_pdf' as const, contractId: contract.id };
  let artifact = await getArtifact(rentalId, target);
  if (!artifact || !fileOk(artifact)) {
    const [agency, beforePhotos] = await Promise.all([getAgencySettings(), listPhotos(rentalId, { phase: 'before' })]);
    const byId = new Map(beforePhotos.map((p) => [p.id, p]));
    const html = await buildContractPdfHtml(
      { ...contract, reference: rental.reference ?? '', agencyName: agency.name },
      createContractResolver({
        photoFile: (id) => {
          const p = byId.get(id);
          return p ? { uri: resolveFileUri(p.file.path), width: p.file.width, height: p.file.height } : null;
        },
        signatureUri: storedFileExists(contract.signature.path) ? resolveFileUri(contract.signature.path) : null,
      }),
    );
    const pdf = await renderPdf(html, newTempFileUri('exports', 'pdf'));
    artifact = await saveArtifact(
      rentalId,
      target,
      { tempUri: pdf.uri, byteSize: new File(pdf.uri).size, sha256: await sha256OfUri(pdf.uri), pageCount: pdf.pageCount },
      { mimeType: 'application/pdf', sourceFingerprint: contract.contentSha256 },
    );
  }
  await shareFile(
    {
      uri: resolveFileUri(artifact.file.path),
      fileName: exportFileName({ reference: rental.reference, kind: 'contract', sequence: contract.sequence, extension: 'pdf' }),
      mimeType: 'application/pdf',
      kind: 'contract',
    },
    { stagingDir: stagingDir(), title: 'Signed contract' },
  );
}
