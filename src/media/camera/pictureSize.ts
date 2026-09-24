/**
 * Still-size choice for expo-camera (IMAGE_PIPELINE §1). Pure: no Expo imports.
 *
 * Without an explicit `pictureSize`, CameraX uses HIGHEST_AVAILABLE, i.e. 50/108/200 MP files on
 * modern Android phones. Android lists sizes as "WxH" (sensor orientation, e.g. "4032x3024");
 * iOS lists session presets ("Photo", "High", "3840x2160", ...), where "Photo" is full-res 4:3.
 */
import type { Size } from '../geometry';

/** Stills above this long edge are too big for storage/backup; processPhoto re-encodes them. */
export const MAX_CAPTURE_LONG_EDGE = 4096;
/** Below this long edge a larger 4:3 size (downscaled after capture) beats a small native one. */
export const MIN_PREFERRED_LONG_EDGE = 3000;
export const IOS_PHOTO_PRESET = 'Photo';

const FOUR_THREE = 4 / 3;
const RATIO_TOLERANCE = 0.01;

/** "4032x3024" -> { width: 4032, height: 3024 }; presets and malformed strings -> null. */
export function parsePictureSize(value: string): Size | null {
  const m = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function isFourThree(size: Size): boolean {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  return Math.abs(long / short - FOUR_THREE) <= FOUR_THREE * RATIO_TOLERANCE;
}

/**
 * Picks the `pictureSize` prop from `getAvailablePictureSizesAsync()`:
 * the largest 4:3 size with long edge <= maxLongEdge (typically 4032x3024, ~12 MP). If that is
 * small (< MIN_PREFERRED_LONG_EDGE) or missing, the smallest larger 4:3 size wins instead.
 * Without any parseable 4:3 size, the iOS "Photo" preset if listed, else undefined (camera default).
 */
export function selectPictureSize(
  available: readonly string[],
  maxLongEdge: number = MAX_CAPTURE_LONG_EDGE,
): string | undefined {
  let bestUnder: { value: string; area: number; long: number } | null = null;
  let smallestOver: { value: string; area: number } | null = null;

  for (const value of available) {
    const size = parsePictureSize(value);
    if (!size || !isFourThree(size)) continue;
    const long = Math.max(size.width, size.height);
    const area = size.width * size.height;
    if (long <= maxLongEdge) {
      if (!bestUnder || area > bestUnder.area) bestUnder = { value, area, long };
    } else if (!smallestOver || area < smallestOver.area) {
      smallestOver = { value, area };
    }
  }

  if (bestUnder && (bestUnder.long >= MIN_PREFERRED_LONG_EDGE || !smallestOver)) return bestUnder.value;
  if (smallestOver) return smallestOver.value;
  return available.includes(IOS_PHOTO_PRESET) ? IOS_PHOTO_PRESET : undefined;
}
