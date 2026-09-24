/**
 * Photo pixels for the return flow. Derivatives (display 2048 px, thumb 384 px) come from the
 * shared inspection helpers; this adds the comparison view's input.
 */
import type { Photo } from '@/domain/types';
import type { ComparePhoto } from '@/media/compare';

import { photoFileUris } from '../inspection/photoFiles';

export { ensurePhotoDerivatives, photoFileUris, usePhotoUri } from '../inspection/photoFiles';

/** The comparison view's input for one stored photo (display derivative, original's size). */
export function toComparePhoto(photo: Photo, timeLabel?: string): ComparePhoto {
  return {
    uri: photoFileUris(photo).display,
    size: { width: photo.file.width, height: photo.file.height },
    timeLabel,
  };
}
