/**
 * Domain data -> evidence layout input, and the staleness key of a composed evidence image.
 * No Skia here, so it is unit-testable and cheap to call when deciding whether to regenerate.
 */
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import type { DamageStatus, Phase } from '@/domain/types';

import { markerNumberLabel } from '../annotate/markerStyle';
import {
  evidenceFingerprint,
  type EvidenceDamage,
  type EvidenceLayoutInput,
  type EvidenceTexts,
} from '../evidenceLayout';
import { deriveCounterpart, type Alignment, type DamageMarker, type Size } from '../geometry';

/** Identity of the bundled font files used for evidence text (src/media/fonts.ts). Bump when they change. */
export const EVIDENCE_FONT_ID = 'Barlow-v13';
export const EVIDENCE_LONG_EDGE = 2800;
export const EVIDENCE_JPEG_QUALITY = 0.85;

export interface EvidencePhotoSource {
  /** File URI of the pixels to draw: the 2048 px display derivative in practice. */
  uri: string;
  /** Upright size of the stored original (the space the marker rings are normalized to). */
  size: Size;
  /** SHA-256 of the stored original: a retake changes the evidence. */
  sha256: string;
  /** Panel caption, e.g. "Pick-up · 12 Mar 2026, 09:14". */
  timeLabel: string;
}

export interface EvidenceDamageSource {
  status: DamageStatus;
  /** Per-rental sequence number; pre-existing damage is shown as a letter (1 -> A). */
  number: number;
  foundPhase: Phase;
  marker: DamageMarker;
  /** Pre-formatted labels, e.g. "Scratch", "front bumper", "Moderate". */
  typeLabel: string;
  locationLabel?: string | null;
  severityLabel?: string | null;
  note?: string | null;
}

export interface ComposeEvidenceInputs {
  /** Header title, e.g. "Rear left". */
  angleLabel: string;
  /** "R-0142". */
  rentalRef: string;
  /** "Renault Clio · AB-123-CD" (joined after the reference in the header). */
  vehicleLabel?: string | null;
  /** Right-aligned header line, e.g. "Returned 15 Mar 2026, 17:40". */
  dateLabel: string;
  agencyName?: string | null;
  before: EvidencePhotoSource;
  after: EvidencePhotoSource;
  /** The damages of this angle's pair (new/uncertain found at return, existing on BEFORE). */
  damages: EvidenceDamageSource[];
  /** Stored BEFORE->AFTER nudge for this pair; improves the derived "same area" rings. */
  alignment?: Alignment | null;
  texts?: Partial<EvidenceTexts>;
  /** Default EVIDENCE_LONG_EDGE. */
  longEdge?: number;
  /** 0..1, default EVIDENCE_JPEG_QUALITY. */
  jpegQuality?: number;
}

/**
 * One damage row -> the rings to draw. Return marks draw their ring on AFTER and the "same
 * area" on BEFORE (stored override or derived). Pick-up marks draw only on BEFORE: projecting
 * them onto AFTER is approximate, so exports leave it out (IMAGE_PIPELINE §5).
 */
export function toEvidenceDamage(d: EvidenceDamageSource, before: Size, after: Size, alignment?: Alignment | null): EvidenceDamage {
  const base: EvidenceDamage = {
    status: d.status === 'pre_existing' ? 'existing' : d.status,
    number: markerNumberLabel(d.status, d.number),
    typeLabel: d.typeLabel,
    locationLabel: d.locationLabel ?? undefined,
    severityLabel: d.severityLabel ?? undefined,
    note: d.note ?? undefined,
    primary: d.foundPhase,
  };
  if (d.foundPhase === 'before') return { ...base, before: d.marker.ring };
  const counterpart = d.marker.counterpart ?? deriveCounterpart(d.marker.ring, 'afterToBefore', before, after, alignment ?? undefined);
  return { ...base, after: d.marker.ring, before: counterpart };
}

export function toEvidenceLayoutInput(inputs: ComposeEvidenceInputs, footnote?: string): EvidenceLayoutInput {
  const { before, after } = inputs;
  return {
    angleLabel: inputs.angleLabel,
    subtitle: [inputs.rentalRef, inputs.vehicleLabel].filter(Boolean).join(' · '),
    dateLabel: inputs.dateLabel,
    agencyName: inputs.agencyName ?? undefined,
    before: { size: before.size, timeLabel: before.timeLabel },
    after: { size: after.size, timeLabel: after.timeLabel },
    damages: inputs.damages.map((d) => toEvidenceDamage(d, before.size, after.size, inputs.alignment)),
    footnote,
    texts: inputs.texts,
  };
}

function quality(inputs: ComposeEvidenceInputs): number {
  return Math.round((inputs.jpegQuality ?? EVIDENCE_JPEG_QUALITY) * 100);
}

/** Canonical string of everything that changes the pixels (photos, marks, labels, font, size, quality). */
export function composeEvidenceFingerprint(inputs: ComposeEvidenceInputs): string {
  return evidenceFingerprint(toEvidenceLayoutInput(inputs), {
    beforeSha256: inputs.before.sha256,
    afterSha256: inputs.after.sha256,
    fontId: EVIDENCE_FONT_ID,
    longEdge: inputs.longEdge ?? EVIDENCE_LONG_EDGE,
    jpegQuality: quality(inputs),
  });
}

/**
 * SHA-256 (hex) of the fingerprint: store it as GeneratedArtifact.sourceFingerprint. Equal hash
 * => reuse the existing evidence file; different => it is stale and must be recomposed.
 */
export function composeEvidenceInputHash(inputs: ComposeEvidenceInputs): Promise<string> {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, composeEvidenceFingerprint(inputs));
}

/** Provenance line printed at the bottom (quotes the hash, so it is excluded from the fingerprint). */
export function evidenceFootnote(inputs: ComposeEvidenceInputs, inputHash: string): string {
  return `CarCheck · ${inputs.rentalRef} · evidence ${inputHash.slice(0, 8)} · photos ${inputs.before.sha256.slice(0, 8)}/${inputs.after.sha256.slice(0, 8)} · originals unmodified`;
}

export function evidenceJpegQuality(inputs: ComposeEvidenceInputs): number {
  return quality(inputs);
}
