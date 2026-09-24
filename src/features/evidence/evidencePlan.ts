/**
 * Which angles get a composed BEFORE/AFTER evidence image, and the composer's input for each
 * (pure; the IO lives in generateEvidence.ts). One image per angle with new or uncertain damage;
 * angles without damage get none.
 */
import { DAMAGE_SEVERITY_LABELS, damageTypeLabel } from '@/domain/damage';
import type { Alignment, AnglePair, Damage, GeneratedArtifact, PairKey, Photo, Rental } from '@/domain/types';
import { formatDateTime } from '@/documents/format';
import type { ComposeEvidenceInputs } from '@/media/evidence';

import { pairId, samePair } from './returnPlan';

export interface EvidenceTarget extends PairKey {
  label: string;
  before: Photo;
  after: Photo;
  alignment: Alignment | null;
  /** Drawn damages in caption order: new/uncertain by number, then existing by letter. */
  damages: Damage[];
}

export interface EvidencePlan {
  targets: EvidenceTarget[];
  /** Angles with new damage but no pick-up photo: the damage is listed in the report only. */
  withoutBefore: AnglePair[];
}

const isClaim = (d: Pick<Damage, 'status'>) => d.status === 'new' || d.status === 'uncertain';

function captionOrder(a: Damage, b: Damage): number {
  const rank = (d: Damage) => (isClaim(d) ? 0 : 1);
  return rank(a) - rank(b) || a.number - b.number;
}

/**
 * Damages drawn on one pair's evidence: every return mark on the pair (new, uncertain, and
 * "was there") plus the pick-up marks on its BEFORE photo, for context.
 */
export function damagesForPair(key: PairKey, damages: readonly Damage[]): Damage[] {
  return damages
    .filter((d) => samePair(d, key) && (d.foundPhase === 'after' || d.status === 'pre_existing'))
    .sort(captionOrder);
}

export function planEvidence(pairs: readonly AnglePair[], damages: readonly Damage[]): EvidencePlan {
  const targets: EvidenceTarget[] = [];
  const withoutBefore: AnglePair[] = [];
  for (const pair of pairs) {
    const onPair = damagesForPair(pair, damages);
    if (!onPair.some((d) => isClaim(d) && d.foundPhase === 'after')) continue;
    if (!pair.after) continue;
    if (!pair.before) {
      withoutBefore.push(pair);
      continue;
    }
    targets.push({
      angleKey: pair.angleKey,
      slot: pair.slot,
      label: pair.label,
      before: pair.before,
      after: pair.after,
      alignment: pair.afterState?.alignment ?? null,
      damages: onPair,
    });
  }
  return { targets, withoutBefore };
}

/** Evidence artifacts whose angle no longer has new damage (to delete). */
export function obsoleteEvidence(artifacts: readonly GeneratedArtifact[], targets: readonly PairKey[]): GeneratedArtifact[] {
  const wanted = new Set(targets.map(pairId));
  return artifacts.filter((a) => a.kind === 'evidence_image' && a.pairKey !== null && !wanted.has(pairId(a.pairKey)));
}

export interface EvidenceContext {
  rental: Pick<Rental, 'reference' | 'vehicle' | 'returnedAt'>;
  agencyName: string | null;
  /** File URI of a photo's display derivative (the pixels drawn). */
  displayUri: (photo: Photo) => string;
}

function vehicleLabel(vehicle: Rental['vehicle']): string | null {
  if (!vehicle) return null;
  const model = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  return [model, vehicle.plate].filter(Boolean).join(' · ') || null;
}

export function evidenceInputs(target: EvidenceTarget, ctx: EvidenceContext): ComposeEvidenceInputs {
  const { before, after } = target;
  const returnedAt = ctx.rental.returnedAt ?? after.capturedAt;
  return {
    angleLabel: target.label,
    rentalRef: ctx.rental.reference ?? '',
    vehicleLabel: vehicleLabel(ctx.rental.vehicle),
    dateLabel: `Returned ${formatDateTime(returnedAt, after.tzOffsetMin)}`,
    agencyName: ctx.agencyName,
    before: {
      uri: ctx.displayUri(before),
      size: { width: before.file.width, height: before.file.height },
      sha256: before.file.sha256,
      timeLabel: `Pick-up · ${formatDateTime(before.capturedAt, before.tzOffsetMin)}`,
    },
    after: {
      uri: ctx.displayUri(after),
      size: { width: after.file.width, height: after.file.height },
      sha256: after.file.sha256,
      timeLabel: `Return · ${formatDateTime(after.capturedAt, after.tzOffsetMin)}`,
    },
    damages: target.damages.map((d) => ({
      status: d.status,
      number: d.number,
      foundPhase: d.foundPhase,
      marker: d.marker,
      typeLabel: damageTypeLabel(d.type),
      locationLabel: d.locationLabel,
      severityLabel: d.severity ? DAMAGE_SEVERITY_LABELS[d.severity] : null,
      note: d.note,
    })),
    alignment: target.alignment,
  };
}
