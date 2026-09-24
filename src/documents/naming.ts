/**
 * Human-friendly names for exported copies and the layout of the share staging directory.
 * Stored files keep opaque ids; only the copies handed to other apps get these names.
 */
import type { AngleKey, Phase } from '@/domain/types';

export type ExportKind =
  | 'evidence'
  | 'report'
  | 'evidence_pack'
  | 'contract'
  | 'contact_sheet'
  /** A raw photo. Only ever produced by the explicit "Export original photos" action. */
  | 'original';

export interface ExportNameParts {
  reference: string | null;
  kind: ExportKind;
  angleKey?: AngleKey;
  slot?: number;
  phase?: Phase;
  /** Contract sequence; > 1 adds "-2" etc. */
  sequence?: number;
  extension: 'jpg' | 'png' | 'pdf' | 'zip';
}

const MIME: Record<ExportNameParts['extension'], string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  zip: 'application/zip',
};

export function mimeTypeFor(extension: ExportNameParts['extension']): string {
  return MIME[extension];
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^A-Za-z0-9-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function angleSlug(angleKey: AngleKey | undefined, slot: number | undefined): string | null {
  if (!angleKey) return null;
  const base = slug(angleKey).toLowerCase();
  if (!base) return null;
  return slot && slot > 1 ? `${base}-${slot}` : base;
}

/**
 * `R-0142_front-left_evidence.jpg`, `R-0142_damage-report.pdf`, `R-0142_contract-2.pdf`,
 * `R-0142_rear_after_original.jpg`. Falls back to "CarCheck" when there is no reference yet.
 */
export function exportFileName(p: ExportNameParts): string {
  const ref = (p.reference && slug(p.reference)) || 'CarCheck';
  const angle = angleSlug(p.angleKey, p.slot);
  const parts: (string | null)[] = [ref];
  switch (p.kind) {
    case 'evidence':
      parts.push(angle, 'evidence');
      break;
    case 'report':
      parts.push('damage-report');
      break;
    case 'evidence_pack':
      parts.push('evidence-pack');
      break;
    case 'contract':
      parts.push(p.sequence && p.sequence > 1 ? `contract-${p.sequence}` : 'contract');
      break;
    case 'contact_sheet':
      parts.push(p.phase === 'before' ? 'pick-up-photos' : 'return-photos');
      break;
    case 'original':
      parts.push(angle, p.phase ?? null, 'original');
      break;
  }
  return `${parts.filter((x): x is string => !!x).join('_')}.${p.extension}`;
}

/** Makes names unique within one batch: "a.jpg", "a.jpg" -> "a.jpg", "a-2.jpg". */
export function uniqueFileNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Share copies live in `<staging>/<epochMs>-<random>/`, so age is readable from the name. */
export function stagingBatchName(now: number, random: string): string {
  return `${now}-${random.replace(/[^a-z0-9]/gi, '').slice(0, 8) || '0'}`;
}

export function stagingBatchTime(name: string): number | null {
  const m = /^(\d{10,})-/.exec(name);
  return m ? Number(m[1]) : null;
}

export const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** A staged entry is expired when older than `maxAgeMs`; unknown age falls back to mtime. */
export function isStagingExpired(
  entry: { name: string; modificationTime: number | null },
  now: number,
  maxAgeMs = STAGING_MAX_AGE_MS,
): boolean {
  const created = stagingBatchTime(entry.name) ?? entry.modificationTime;
  if (created === null) return false;
  return now - created > maxAgeMs;
}
