/**
 * Relative path conventions of the files root (docs/DATA_MODEL.md §5). Pure: no Expo imports.
 *
 * Every path stored in the DB is relative to the files root, made of ids only, and never reused.
 * files.ts resolves them to URIs; repositories use these builders when they record a file.
 */
import type { Id, RelPath } from '@/domain/types';

export const FILES_TOP_DIRS = ['photos', 'docs', 'signatures', 'generated', 'vehicles', 'agency'] as const;

/** Mirrors the DB CHECK on file columns: "dir/…", no scheme, drive, "..", "\" or "//". */
export function isValidRelPath(path: string): boolean {
  return (
    /^[a-z][^/]*\/.+$/.test(path) &&
    !path.includes('..') &&
    !path.includes(':') &&
    !path.includes('\\') &&
    !path.includes('//') &&
    !path.endsWith('/')
  );
}

export function assertRelPath(path: string): RelPath {
  if (!isValidRelPath(path)) throw new Error(`Not a valid files-root relative path: "${path}"`);
  return path;
}

function segment(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsafe path segment: "${id}"`);
  return id;
}

export function rentalPhotosDir(rentalId: Id): string {
  return `photos/${segment(rentalId)}`;
}

/** Original photo (pick-up or return, angle shot or close-up). */
export function photoPath(rentalId: Id, photoId: Id): RelPath {
  return `${rentalPhotosDir(rentalId)}/${segment(photoId)}.jpg`;
}

export function signaturePath(rentalId: Id, contractId: Id): RelPath {
  return `signatures/${segment(rentalId)}/${segment(contractId)}.png`;
}

export type DocumentOwner = { customerId: Id } | { rentalId: Id };

/** ID / licence photo: under the profile, or under the rental for inline customers. */
export function documentPath(owner: DocumentOwner, docId: Id): RelPath {
  const dir = 'customerId' in owner ? segment(owner.customerId) : `r-${segment(owner.rentalId)}`;
  return `docs/${dir}/${segment(docId)}.jpg`;
}

export function generatedDir(rentalId: Id): string {
  return `generated/${segment(rentalId)}`;
}

/** Composed BEFORE/AFTER evidence image or contact sheet (JPEG). */
export function evidencePath(rentalId: Id, artifactId: Id): RelPath {
  return `${generatedDir(rentalId)}/${segment(artifactId)}.jpg`;
}

export function contractPdfPath(rentalId: Id, artifactId: Id): RelPath {
  return `${generatedDir(rentalId)}/${segment(artifactId)}.pdf`;
}

export function reportPdfPath(rentalId: Id, artifactId: Id): RelPath {
  return `${generatedDir(rentalId)}/${segment(artifactId)}.pdf`;
}

export function vehiclePhotoPath(vehicleId: Id, fileId: Id): RelPath {
  return `vehicles/${segment(vehicleId)}/${segment(fileId)}.jpg`;
}

export type LogoExtension = 'png' | 'jpg';

export function logoPath(fileId: Id, ext: LogoExtension = 'png'): RelPath {
  return `agency/logo-${segment(fileId)}.${ext}`;
}

/** Artifact path by MIME type (JPEG images, PDF documents). */
export function artifactPath(rentalId: Id, artifactId: Id, mimeType: string): RelPath {
  if (mimeType === 'application/pdf') return contractPdfPath(rentalId, artifactId);
  if (mimeType === 'image/jpeg') return evidencePath(rentalId, artifactId);
  throw new Error(`Unsupported artifact type ${mimeType}`);
}

// ---------------------------------------------------------------------------------------------
// Housekeeping decisions (pure; files.ts does the IO)

export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
export const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface StoredFileEntry {
  path: RelPath;
  size: number;
  modifiedAt: number | null;
}

export interface FileRefDiff {
  /** On disk, not referenced by the DB, and old enough to be sure no capture is in flight. */
  orphans: StoredFileEntry[];
  /** Referenced by the DB but absent on disk. Reported only; rows are never auto-deleted. */
  missing: RelPath[];
}

export function diffFileRefs(
  stored: readonly StoredFileEntry[],
  referenced: Iterable<RelPath>,
  now: number,
  minAgeMs: number = ORPHAN_MIN_AGE_MS,
): FileRefDiff {
  const refs = new Set(referenced);
  const onDisk = new Set(stored.map((f) => f.path));
  const orphans = stored.filter(
    (f) => !refs.has(f.path) && f.modifiedAt !== null && now - f.modifiedAt >= minAgeMs,
  );
  const missing = [...refs].filter((p) => !onDisk.has(p)).sort();
  return { orphans, missing };
}

/** Temp entries (exports, capture, backup and restore staging) that housekeeping may delete. */
export function isExpiredTempEntry(
  area: 'exports' | 'capture' | 'backup' | 'restore',
  modifiedAt: number | null,
  now: number,
): boolean {
  if (modifiedAt === null) return true;
  const maxAge = area === 'exports' ? EXPORT_MAX_AGE_MS : TEMP_MAX_AGE_MS;
  return now - modifiedAt >= maxAge;
}

/** "CarCheck_R-0142_rear-left.jpg": friendly names exist only on export copies. */
export function exportFileName(parts: readonly (string | null | undefined)[], ext: string): string {
  const base = ['CarCheck', ...parts]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map((p) => p.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter((p) => p.length > 0)
    .join('_');
  return `${base}.${ext.replace(/^\./, '')}`;
}
