/**
 * Composes the per-angle BEFORE/AFTER evidence images of a rental and records them as
 * artifacts (IMAGE_PIPELINE §5-6). Strictly sequential: one composition holds a ~30 MB canvas
 * plus two decoded 2048 px photos, which is the budget of a low-end phone.
 *
 * An image is recomposed only when its input hash (photos, marks, labels, font, layout
 * version) differs from the stored artifact's fingerprint or its file is missing.
 */
import { newTempFileUri, sha256OfUri } from '@/data/files';
import {
  deleteArtifact,
  getAgencySettings,
  getAnglePairs,
  getArtifactStatus,
  getRental,
  listArtifacts,
  listDamage,
  saveArtifact,
} from '@/data/repos';
import type { GeneratedArtifact, Id, PairKey, Photo } from '@/domain/types';
import { composeEvidence, composeEvidenceInputHash } from '@/media/evidence';

import { evidenceInputs, obsoleteEvidence, planEvidence, type EvidenceTarget } from './evidencePlan';
import { ensurePhotoDerivatives, photoFileUris } from './photoFiles';

export interface EvidenceProgress {
  /** 1-based index of the image being built. */
  index: number;
  total: number;
  label: string;
}

export interface GenerateEvidenceOptions {
  /** Recompose even when the stored image is fresh ("Regenerate evidence"). */
  force?: boolean;
  /** Called before each image that has to be composed (not for fresh ones). */
  onProgress?: (p: EvidenceProgress) => void;
}

export interface EvidenceImage extends PairKey {
  label: string;
  artifact: GeneratedArtifact;
  /** Damage ids drawn on the image, in caption order. */
  damageIds: Id[];
}

export interface GenerateEvidenceResult {
  /** One per damaged angle, in walk-around order. */
  images: EvidenceImage[];
  /** How many were (re)composed in this run. */
  composed: number;
  /** Angles with new damage but no pick-up photo (no image possible; listed in the report). */
  withoutBefore: { angleKey: string; slot: number; label: string }[];
}

export async function generateEvidence(rentalId: Id, options: GenerateEvidenceOptions = {}): Promise<GenerateEvidenceResult> {
  const [rental, agency, pairs, damages, existing] = await Promise.all([
    getRental(rentalId),
    getAgencySettings(),
    getAnglePairs(rentalId),
    listDamage(rentalId),
    listArtifacts(rentalId, 'evidence_image'),
  ]);
  const plan = planEvidence(pairs, damages);
  const ctx = { rental, agencyName: agency.name || null, displayUri: (p: Photo) => photoFileUris(p).display };

  // Decide first (hashing is cheap), then compose only what is stale.
  const work: { target: EvidenceTarget; hash: string; artifact: GeneratedArtifact | null; fresh: boolean }[] = [];
  for (const target of plan.targets) {
    const hash = await composeEvidenceInputHash(evidenceInputs(target, ctx));
    const status = await getArtifactStatus(rentalId, { kind: 'evidence_image', pairKey: target }, hash);
    work.push({ target, hash, artifact: status.artifact, fresh: status.status === 'fresh' && !options.force });
  }

  const stale = work.filter((w) => !w.fresh);
  const images: EvidenceImage[] = [];
  let composed = 0;
  for (const w of work) {
    let artifact = w.artifact;
    if (!w.fresh) {
      composed += 1;
      options.onProgress?.({ index: composed, total: stale.length, label: w.target.label });
      artifact = await composeOne(rentalId, w.target, w.hash, ctx);
    }
    if (!artifact) continue;
    images.push({
      angleKey: w.target.angleKey,
      slot: w.target.slot,
      label: w.target.label,
      artifact,
      damageIds: w.target.damages.map((d) => d.id),
    });
  }

  for (const old of obsoleteEvidence(existing, plan.targets)) {
    if (old.pairKey) await deleteArtifact(rentalId, { kind: 'evidence_image', pairKey: old.pairKey });
  }

  return {
    images,
    composed,
    withoutBefore: plan.withoutBefore.map((p) => ({ angleKey: p.angleKey, slot: p.slot, label: p.label })),
  };
}

async function composeOne(
  rentalId: Id,
  target: EvidenceTarget,
  hash: string,
  ctx: Parameters<typeof evidenceInputs>[1],
): Promise<GeneratedArtifact> {
  await ensurePhotoDerivatives(target.before);
  await ensurePhotoDerivatives(target.after);
  const inputs = evidenceInputs(target, ctx);
  const temp = newTempFileUri('capture', 'jpg');
  const result = await composeEvidence(inputs, temp);
  return saveArtifact(
    rentalId,
    { kind: 'evidence_image', pairKey: { angleKey: target.angleKey, slot: target.slot } },
    {
      tempUri: result.uri,
      byteSize: result.byteSize,
      sha256: await sha256OfUri(result.uri),
      width: result.width,
      height: result.height,
    },
    { mimeType: 'image/jpeg', sourceFingerprint: hash },
  );
}
