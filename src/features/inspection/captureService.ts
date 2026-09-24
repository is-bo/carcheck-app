/**
 * Camera shot -> stored evidence. Runs the image pipeline (processPhoto: upright original,
 * SHA-256, derivatives) into temp files, records the photo through the inspections repository
 * (write protocol), then adopts the derivatives under the photo's id.
 *
 * Retake (DECISIONS Data §1): when the pair key already has an unfrozen canonical photo, the new
 * shot replaces it; damage marks carry over with their normalized rings and the old file is
 * deleted after commit. Frozen photos throw ImmutableError.
 */
import { File } from 'expo-file-system';

import { newTempFileUri, type DocumentOwner } from '@/data/files';
import { addCustomerDocument, addPhoto, listPhotos, retakePhoto } from '@/data/repos';
import type { CapturedImage, CustomerDocument, CustomerDocumentKind, Id, Phase, Photo, PhotoKind } from '@/domain/types';
import { importPhotoFromLibrary, processPhoto, type ProcessedPhoto } from '@/media/photo';

import { photoFileUris } from './photoFiles';

/** What the camera reports with each shot (CaptureCamera's CapturedMeta fits). */
export interface ShotMeta {
  capturedAt: number;
  /** Minutes east of UTC at capture. */
  tzOffsetMin: number;
}

export interface SaveCapturedPhotoInput {
  rentalId: Id;
  phase: Phase;
  angleKey: string;
  /** The camera's JPEG in the cache directory; deleted once stored. */
  tempUri: string;
  meta: ShotMeta;
  /** Default 1. Repeated extras use nextFreeSlot(). */
  slot?: number;
  /** Default 'angle' (the canonical shot of the pair key, retaken in place). */
  kind?: PhotoKind;
  label?: string | null;
}

interface Staged {
  original: string;
  display: string;
  thumb: string;
}

function stage(): Staged {
  return {
    original: newTempFileUri('capture', 'jpg'),
    display: newTempFileUri('capture', 'jpg'),
    thumb: newTempFileUri('capture', 'jpg'),
  };
}

function deleteQuietly(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // temp leftovers are swept at the next cold start
  }
}

/** Derivatives were written before the photo had an id; move them to their cache names. */
function adoptDerivatives(photo: Photo, staged: Staged): void {
  const target = photoFileUris(photo);
  for (const variant of ['display', 'thumb'] as const) {
    try {
      const from = new File(staged[variant]);
      if (from.exists) from.moveSync(new File(target[variant]), { overwrite: true });
    } catch {
      // regenerated on first display (ensurePhotoDerivatives)
      deleteQuietly(staged[variant]);
    }
  }
}

function toCapturedImage(uri: string, p: ProcessedPhoto, meta: ShotMeta): CapturedImage {
  return {
    tempUri: uri,
    byteSize: p.bytes,
    sha256: p.sha256,
    width: p.width,
    height: p.height,
    capturedAt: meta.capturedAt,
    tzOffsetMin: meta.tzOffsetMin,
  };
}

// Shots are stored strictly in shutter order: capture_order follows it, and a retake can never
// race the first save of the same angle.
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Stores one shot; returns the saved (or replacing) photo record. */
export function saveCapturedPhoto(input: SaveCapturedPhotoInput): Promise<Photo> {
  return serial(async () => {
    const kind = input.kind ?? 'angle';
    const slot = input.slot ?? 1;
    const staged = stage();
    const processed = await processPhoto(input.tempUri, staged);
    const image = toCapturedImage(staged.original, processed, input.meta);
    let photo: Photo;
    try {
      const existing =
        kind === 'angle'
          ? (await listPhotos(input.rentalId, { phase: input.phase, kind: 'angle' })).find(
              (p) => p.angleKey === input.angleKey && p.slot === slot,
            )
          : undefined;
      photo = existing
        ? await retakePhoto(existing.id, image)
        : await addPhoto({ rentalId: input.rentalId, phase: input.phase, image, angleKey: input.angleKey, slot, kind, label: input.label });
    } catch (e) {
      Object.values(staged).forEach(deleteQuietly);
      throw e;
    }
    adoptDerivatives(photo, staged);
    return photo;
  });
}

function nowMeta(): ShotMeta {
  const at = Date.now();
  return { capturedAt: at, tzOffsetMin: -new Date(at).getTimezoneOffset() };
}

/** Customer licence / ID photo from the camera. Owner = profile, or the rental for inline customers. */
export function saveDocumentShot(
  owner: DocumentOwner,
  kind: CustomerDocumentKind,
  tempUri: string,
  meta: ShotMeta = nowMeta(),
): Promise<CustomerDocument> {
  return serial(async () => {
    const original = newTempFileUri('capture', 'jpg');
    const processed = await processPhoto(tempUri, { original });
    try {
      return await addCustomerDocument(owner, toCapturedImage(original, processed, meta), kind);
    } catch (e) {
      deleteQuietly(original);
      throw e;
    }
  });
}

/** Customer document from the system photo picker. Resolves null when the picker is cancelled. */
export async function importDocumentFromLibrary(owner: DocumentOwner, kind: CustomerDocumentKind): Promise<CustomerDocument | null> {
  const original = newTempFileUri('capture', 'jpg');
  const processed = await importPhotoFromLibrary({ original }, 'id_doc');
  if (!processed) return null;
  try {
    return await addCustomerDocument(owner, toCapturedImage(original, processed, nowMeta()), kind);
  } catch (e) {
    deleteQuietly(original);
    throw e;
  }
}
