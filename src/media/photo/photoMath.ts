/**
 * Pure helpers for the photo pipeline (IMAGE_PIPELINE §1): target sizes, JPEG header checks,
 * hex encoding. No Expo imports, so they run in Jest.
 */
import type { Size } from '../geometry';

/** Originals above this long edge (the device ignored `pictureSize`) are re-encoded once. */
export const ORIGINAL_MAX_LONG_EDGE = 4096;
/** Long edge of a re-encoded original (camera oversize, library imports). */
export const ORIGINAL_TARGET_LONG_EDGE = 4032;
export const ORIGINAL_JPEG_QUALITY = 0.9;
/** Compare / evidence source derivative. */
export const DISPLAY_LONG_EDGE = 2048;
export const DISPLAY_JPEG_QUALITY = 0.85;
/** List / grid thumbnail derivative. */
export const THUMB_LONG_EDGE = 384;
export const THUMB_JPEG_QUALITY = 0.7;

/**
 * Size after fitting the long edge into `maxLongEdge`, keeping aspect; never upscales. Both edges
 * are rounded and passed to the resizer explicitly, so the result is identical on every platform.
 */
export function fitLongEdge(size: Size, maxLongEdge: number): Size {
  const long = Math.max(size.width, size.height);
  if (long <= maxLongEdge) return { width: size.width, height: size.height };
  const s = maxLongEdge / long;
  return {
    width: Math.max(1, Math.round(size.width * s)),
    height: Math.max(1, Math.round(size.height * s)),
  };
}

export function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height;
}

/** JPEG files start with SOI (FF D8) followed by a marker. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * EXIF orientation tag (1..8) of a JPEG, or null when the file has no EXIF block or no tag.
 * Only the APP segments before the first scan are read. A stored original must be upright with no
 * rotation tag, because markers are normalized to the upright pixels; any value other than 1 means
 * the bytes need re-encoding.
 */
export function jpegExifOrientation(bytes: Uint8Array): number | null {
  if (!isJpeg(bytes)) return null;
  const n = bytes.length;
  let off = 2;
  while (off + 4 <= n) {
    if (bytes[off] !== 0xff) return null;
    const marker = bytes[off + 1];
    if (marker === 0xff) {
      off += 1; // fill byte
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // start of scan / end of image
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2; // standalone markers have no length
      continue;
    }
    const len = (bytes[off + 2] << 8) | bytes[off + 3];
    if (len < 2) return null;
    const seg = off + 4;
    if (marker === 0xe1 && isExifHeader(bytes, seg)) {
      return readTiffOrientation(bytes, seg + 6, Math.min(n, off + 2 + len));
    }
    off += 2 + len;
  }
  return null;
}

function isExifHeader(b: Uint8Array, at: number): boolean {
  // "Exif\0\0"
  return (
    at + 6 <= b.length &&
    b[at] === 0x45 && b[at + 1] === 0x78 && b[at + 2] === 0x69 && b[at + 3] === 0x66 &&
    b[at + 4] === 0 && b[at + 5] === 0
  );
}

function readTiffOrientation(b: Uint8Array, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  let little: boolean;
  if (b[tiff] === 0x49 && b[tiff + 1] === 0x49) little = true;
  else if (b[tiff] === 0x4d && b[tiff + 1] === 0x4d) little = false;
  else return null;
  const u16 = (at: number) => (little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
  const u32 = (at: number) =>
    little
      ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
      : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** Lower-case hex of a digest (types.ts `Sha256Hex`). */
export function toHex(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
