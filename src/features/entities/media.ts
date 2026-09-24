/**
 * Turns camera/library output into a `CapturedImage` the repos accept (setVehiclePhoto,
 * addCustomerDocument): a processed cache file plus its final size/hash. Repos own the actual
 * import into app storage (write protocol), so this stops at a ready-to-hand-off temp file.
 */
import { newTempFileUri } from '@/data/files';
import type { CapturedImage } from '@/domain/types';
import type { CapturedMeta } from '@/media/camera';
import { importPhotoFromLibrary, processPhoto, type ImportPurpose } from '@/media/photo';

/** After CaptureCamera's `onCaptured(tempUri, meta)`. */
export async function capturedImageFromCamera(tempUri: string, meta: CapturedMeta): Promise<CapturedImage> {
  const dest = newTempFileUri('capture', 'jpg');
  const processed = await processPhoto(tempUri, { original: dest });
  return {
    tempUri: dest,
    byteSize: processed.bytes,
    sha256: processed.sha256,
    width: processed.width,
    height: processed.height,
    capturedAt: meta.capturedAt,
    tzOffsetMin: meta.tzOffsetMin,
  };
}

/** Opens the system photo picker; null when the user cancels. */
export async function capturedImageFromLibrary(purpose: ImportPurpose): Promise<CapturedImage | null> {
  const dest = newTempFileUri('capture', purpose === 'logo' ? 'png' : 'jpg');
  const processed = await importPhotoFromLibrary({ original: dest }, purpose);
  if (!processed) return null;
  const now = Date.now();
  return {
    tempUri: dest,
    byteSize: processed.bytes,
    sha256: processed.sha256,
    width: processed.width,
    height: processed.height,
    capturedAt: now,
    tzOffsetMin: -new Date(now).getTimezoneOffset(),
  };
}
