/**
 * The final damage report PDF (UX §6, IMAGE_PIPELINE §8): gathers the rental, its damage, the
 * composed evidence images, the return photos and the signed contract(s), embeds every image
 * as a downscaled data URI (one at a time), renders the HTML with @/documents and stores the
 * PDF as the rental's report artifact. Also the evidence-pack fallback for "Share all images".
 */
import { File } from 'expo-file-system';

import { newTempFileUri, resolveFileUri, sha256OfUri, storedFileExists } from '@/data/files';
import {
  getAgencySettings,
  getAnglePairs,
  getPhoto,
  getRental,
  listContracts,
  listDamage,
  listPhotos,
  saveArtifact,
} from '@/data/repos';
import type { AgencySettings, AnglePair, Damage, GeneratedArtifact, Id, Photo } from '@/domain/types';
import {
  buildDamageReportHtml,
  buildEvidencePackHtml,
  createContractResolver,
  EMBED_PRESETS,
  embedImage,
  fitLongEdge,
  renderPdf,
  resolveContract,
  type DocAgency,
  type DocDamage,
  type DocEvidenceImage,
  type DocPhotoThumb,
  type ResolvedContract,
} from '@/documents';

import type { EvidenceImage } from '../evidence/generateEvidence';
import { ensurePhotoDerivatives } from '../evidence/photoFiles';
import { compareSequence, pairId } from '../evidence/returnPlan';
import { reportFingerprint } from './reportState';

export type ReportStep = { kind: 'embedding'; done: number; total: number } | { kind: 'rendering' };

const deviceOffset = () => -new Date().getTimezoneOffset();

async function embedOrNull(uri: string | null, preset: (typeof EMBED_PRESETS)[keyof typeof EMBED_PRESETS], size?: { width: number; height: number }) {
  if (!uri) return null;
  try {
    return await embedImage(uri, preset, size);
  } catch {
    // A missing or unreadable file prints a placeholder instead of failing the whole report.
    return null;
  }
}

async function docAgency(agency: AgencySettings): Promise<DocAgency> {
  const logoPath = agency.logo?.path ?? null;
  return {
    name: agency.name,
    address: agency.address,
    phone: agency.phone,
    email: agency.email,
    registrationNumber: agency.registrationNumber,
    reportFooter: agency.reportFooter,
    logo: logoPath && storedFileExists(logoPath) ? await embedOrNull(resolveFileUri(logoPath), EMBED_PRESETS.logo) : null,
  };
}

function labelOf(pairs: readonly AnglePair[], d: Pick<Damage, 'angleKey' | 'slot'>): string {
  return pairs.find((p) => pairId(p) === pairId(d))?.label ?? d.angleKey;
}

async function docDamages(damages: readonly Damage[], pairs: readonly AnglePair[], tick: () => void): Promise<DocDamage[]> {
  const out: DocDamage[] = [];
  for (const d of damages) {
    let closeup: string | null = null;
    if (d.closeupPhotoId) {
      const photo = await getPhoto(d.closeupPhotoId).catch(() => null);
      if (photo) closeup = await embedOrNull(resolveFileUri(photo.file.path), EMBED_PRESETS.thumbnail, photo.file);
      tick();
    }
    out.push({
      id: d.id,
      status: d.status,
      number: d.number,
      type: d.type,
      severity: d.severity,
      locationLabel: d.locationLabel,
      note: d.note,
      foundPhase: d.foundPhase,
      angleKey: d.angleKey,
      slot: d.slot,
      angleLabel: labelOf(pairs, d),
      closeup,
    });
  }
  return out;
}

async function docEvidence(images: readonly EvidenceImage[], tick: () => void): Promise<DocEvidenceImage[]> {
  const out: DocEvidenceImage[] = [];
  for (const e of images) {
    const size = { width: e.artifact.width ?? 0, height: e.artifact.height ?? 0 };
    const known = size.width > 0 && size.height > 0;
    const image = await embedOrNull(resolveFileUri(e.artifact.file.path), EMBED_PRESETS.evidence, known ? size : undefined);
    tick();
    if (!image) continue;
    const printed = (known && fitLongEdge(size, EMBED_PRESETS.evidence.maxEdge)) || size;
    out.push({
      angleKey: e.angleKey,
      slot: e.slot,
      angleLabel: e.label,
      image,
      width: printed.width,
      height: printed.height,
      damageIds: e.damageIds,
    });
  }
  return out;
}

async function thumbSource(photo: Photo): Promise<{ uri: string; size?: { width: number; height: number } }> {
  try {
    // The 2048 px derivative decodes ~8x faster than the 12 MP original.
    return { uri: (await ensurePhotoDerivatives(photo)).display };
  } catch {
    return { uri: resolveFileUri(photo.file.path), size: photo.file };
  }
}

async function docPhotoThumbs(pairs: readonly AnglePair[], phase: 'before' | 'after', tick: () => void): Promise<DocPhotoThumb[]> {
  const out: DocPhotoThumb[] = [];
  for (const p of compareSequence(pairs)) {
    const photo = phase === 'after' ? p.after : p.before;
    const state = phase === 'after' ? p.afterState : p.beforeState;
    let image: string | null = null;
    if (photo) {
      const src = await thumbSource(photo);
      image = await embedOrNull(src.uri, EMBED_PRESETS.thumbnail, src.size);
      tick();
    }
    out.push({
      angleKey: p.angleKey,
      slot: p.slot,
      angleLabel: p.label,
      image,
      capturedAt: photo?.capturedAt ?? null,
      tzOffsetMin: photo?.tzOffsetMin ?? null,
      skipReason: photo ? null : (state?.skipReason ?? null),
    });
  }
  return out;
}

async function resolvedContracts(rentalId: Id): Promise<ResolvedContract[]> {
  const contracts = await listContracts(rentalId);
  if (contracts.length === 0) return [];
  const beforePhotos = await listPhotos(rentalId, { phase: 'before' });
  const byId = new Map(beforePhotos.map((p) => [p.id, p]));
  const out: ResolvedContract[] = [];
  for (const c of contracts) {
    const resolver = createContractResolver({
      photoFile: (photoId) => {
        const p = byId.get(photoId);
        return p ? { uri: resolveFileUri(p.file.path), width: p.file.width, height: p.file.height } : null;
      },
      signatureUri: storedFileExists(c.signature.path) ? resolveFileUri(c.signature.path) : null,
    });
    // Voided contracts are listed with their signature only; the valid one is embedded in full.
    out.push(await resolveContract(c, resolver, { signatureOnly: c.void !== null }));
  }
  return out;
}

function countJobs(pairs: readonly AnglePair[], damages: readonly Damage[], evidence: readonly EvidenceImage[]): number {
  const closeups = damages.filter((d) => d.closeupPhotoId).length;
  const thumbs = compareSequence(pairs).filter((p) => p.after).length;
  return closeups + evidence.length + thumbs;
}

/**
 * Builds and stores the report PDF for a completed return. `evidence` comes from
 * generateEvidence() of the same run, so the report embeds exactly those images.
 */
export async function buildReport(
  rentalId: Id,
  evidence: readonly EvidenceImage[],
  onStep?: (step: ReportStep) => void,
): Promise<GeneratedArtifact> {
  const [rental, agencySettings, pairs, damages] = await Promise.all([
    getRental(rentalId),
    getAgencySettings(),
    getAnglePairs(rentalId),
    listDamage(rentalId),
  ]);
  const total = countJobs(pairs, damages, evidence);
  let done = 0;
  const tick = () => {
    done += 1;
    onStep?.({ kind: 'embedding', done, total });
  };
  onStep?.({ kind: 'embedding', done, total });

  const agency = await docAgency(agencySettings);
  const docDamage = await docDamages(damages, pairs, tick);
  const docEvidenceImages = await docEvidence(evidence, tick);
  const returnPhotos = await docPhotoThumbs(pairs, 'after', tick);
  const contracts = await resolvedContracts(rentalId);

  onStep?.({ kind: 'rendering' });
  const html = buildDamageReportHtml({
    agency,
    rental,
    damages: docDamage,
    evidence: docEvidenceImages,
    returnPhotos,
    contracts,
    generatedAt: Date.now(),
    tzOffsetMin: deviceOffset(),
  });
  const pdf = await renderPdf(html, newTempFileUri('exports', 'pdf'));
  return saveArtifact(
    rental.id,
    { kind: 'report_pdf' },
    { tempUri: pdf.uri, byteSize: new File(pdf.uri).size, sha256: await sha256OfUri(pdf.uri), pageCount: pdf.pageCount },
    { mimeType: 'application/pdf', sourceFingerprint: reportFingerprint(rental, evidence.map((e) => e.artifact)) },
  );
}

/**
 * "Share all images" fallback when multi-file sharing is unavailable: one evidence image per
 * page. Written to a temp file for sharing; it is not stored as an artifact.
 */
export async function buildEvidencePackPdf(rentalId: Id, evidence: readonly EvidenceImage[]): Promise<string> {
  const [rental, agencySettings, pairs, damages] = await Promise.all([
    getRental(rentalId),
    getAgencySettings(),
    getAnglePairs(rentalId),
    listDamage(rentalId),
  ]);
  const drawn = new Set(evidence.flatMap((e) => e.damageIds));
  const noop = () => undefined;
  const html = buildEvidencePackHtml({
    agency: await docAgency(agencySettings),
    rental,
    damages: await docDamages(
      damages.filter((d) => drawn.has(d.id)),
      pairs,
      noop,
    ),
    evidence: await docEvidence(evidence, noop),
    generatedAt: Date.now(),
    tzOffsetMin: deviceOffset(),
  });
  return (await renderPdf(html, newTempFileUri('exports', 'pdf'))).uri;
}
