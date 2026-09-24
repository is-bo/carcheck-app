/**
 * Captured/imported image -> stored original + display/thumb derivatives + SHA-256
 * (IMAGE_PIPELINE §1). Callers own paths: they pass absolute file URIs (from their file store)
 * and write the DB row from the result.
 *
 * Hashing: expo-crypto has no incremental digest, so the stored original is read into the JS heap
 * once (≤ ~6 MB at 4032 px q0.9) and hashed natively in one call. Hermes would be far slower at a
 * chunked JS SHA-256, and the same buffer doubles as the EXIF check, so this is the cheaper option.
 * Peak native memory is one decoded original (~48 MB at 12 MP); jobs run one at a time.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import {
  ImageManipulator,
  SaveFormat,
  type ImageManipulatorContext,
  type ImageRef,
} from 'expo-image-manipulator';

import type { Size } from '../geometry';
import {
  DISPLAY_JPEG_QUALITY,
  DISPLAY_LONG_EDGE,
  fitLongEdge,
  isJpeg,
  jpegExifOrientation,
  ORIGINAL_JPEG_QUALITY,
  ORIGINAL_MAX_LONG_EDGE,
  ORIGINAL_TARGET_LONG_EDGE,
  sameSize,
  THUMB_JPEG_QUALITY,
  THUMB_LONG_EDGE,
  toHex,
} from './photoMath';

export type PhotoFormat = 'jpeg' | 'png';

export interface PhotoDestinations {
  /** Absolute file URI of the stored original. Must not exist: evidence is never overwritten. */
  original: string;
  /** Absolute file URI of the display derivative (2048 px long edge). Overwritten if present. */
  display?: string;
  /** Absolute file URI of the thumbnail derivative (384 px long edge). Overwritten if present. */
  thumb?: string;
}

export interface ProcessPhotoOptions {
  /**
   * Re-encode the original even when the bytes could be kept. Imports use it to bake EXIF
   * orientation into the pixels and drop metadata such as GPS.
   */
  reencode?: boolean;
  /** Format of every output. 'png' (logos) keeps transparency and forces a re-encode. Default 'jpeg'. */
  format?: PhotoFormat;
  /** Long edge of a re-encoded original. Default 4032. */
  maxLongEdge?: number;
}

export interface ProcessedPhoto {
  /** Upright pixel size of the stored original (no EXIF rotation left in the file). */
  width: number;
  height: number;
  /** Size of the display derivative (the size it has when generated, even if not requested). */
  displayWidth: number;
  displayHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  /** Lower-case hex SHA-256 of the original exactly as stored. */
  sha256: string;
  /** Byte size of the original as stored. */
  bytes: number;
  mime: 'image/jpeg' | 'image/png';
  /** False when the camera bytes were kept as they are. */
  reencoded: boolean;
}

/**
 * Stores `tempUri` (camera or picker output in cache) as the original at `dest.original`, writes
 * the requested derivatives and hashes the original. Camera JPEGs that are upright, EXIF-rotation
 * free and ≤ 4096 px are copied byte for byte; anything else is re-encoded once.
 *
 * The temp file is deleted only on success, so a failed call can be retried. On failure every
 * output written by this call is removed.
 */
export function processPhoto(
  tempUri: string,
  dest: PhotoDestinations,
  options: ProcessPhotoOptions = {},
): Promise<ProcessedPhoto> {
  return serial(() => runProcessPhoto(tempUri, dest, options));
}

/**
 * Regenerates derivatives from a stored original (they are not backed up, e.g. after a restore or
 * "Free up space"). Returns the sizes written.
 */
export function writeDerivatives(
  originalUri: string,
  dest: Omit<PhotoDestinations, 'original'>,
  format: PhotoFormat = 'jpeg',
): Promise<{ display: Size; thumb: Size }> {
  return serial(async () => {
    const written: File[] = [];
    try {
      const source = await render(ImageManipulator.manipulate(originalUri));
      return await renderDerivatives(source, { width: source.width, height: source.height }, dest, format, written);
    } catch (e) {
      written.forEach(safeDelete);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------------------------

async function runProcessPhoto(
  tempUri: string,
  dest: PhotoDestinations,
  options: ProcessPhotoOptions,
): Promise<ProcessedPhoto> {
  const format = options.format ?? 'jpeg';
  const temp = new File(tempUri);
  const original = new File(dest.original);
  if (original.exists) throw new Error(`processPhoto: destination already exists: ${dest.original}`);
  ensureParentDir(original);

  const written: File[] = [];
  // The decoded bitmap this call currently owns; ownership passes to renderDerivatives.
  let owned: ImageRef | null = null;
  try {
    const tempBytes = await temp.bytes();
    owned = await render(ImageManipulator.manipulate(tempUri));
    // The decoder applies EXIF orientation, so this is the upright size.
    const upright = { width: owned.width, height: owned.height };
    const jpeg = isJpeg(tempBytes);
    const rotation = jpeg ? jpegExifOrientation(tempBytes) : null;
    const reencode =
      options.reencode === true ||
      format !== 'jpeg' ||
      !jpeg ||
      (rotation !== null && rotation !== 1) ||
      Math.max(upright.width, upright.height) > ORIGINAL_MAX_LONG_EDGE;

    let stored: Size = upright;
    let storedBytes: Uint8Array<ArrayBuffer>;
    if (reencode) {
      const target = fitLongEdge(upright, options.maxLongEdge ?? ORIGINAL_TARGET_LONG_EDGE);
      if (!sameSize(target, upright)) {
        const scaled = await render(ImageManipulator.manipulate(owned).resize(target));
        owned.release();
        owned = scaled;
      }
      const saved = await owned.saveAsync({ compress: ORIGINAL_JPEG_QUALITY, format: saveFormat(format) });
      const savedFile = new File(saved.uri);
      storedBytes = await savedFile.bytes();
      await savedFile.move(original);
      written.push(original);
      stored = { width: saved.width, height: saved.height };
    } else {
      storedBytes = tempBytes;
      await temp.copy(original);
      written.push(original);
    }

    const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, storedBytes);
    const source = owned;
    owned = null;
    const derived = await renderDerivatives(source, stored, dest, format, written);
    safeDelete(temp);
    return {
      width: stored.width,
      height: stored.height,
      displayWidth: derived.display.width,
      displayHeight: derived.display.height,
      thumbWidth: derived.thumb.width,
      thumbHeight: derived.thumb.height,
      sha256: toHex(digest),
      bytes: storedBytes.byteLength,
      mime: format === 'png' ? 'image/png' : 'image/jpeg',
      reencoded: reencode,
    };
  } catch (e) {
    owned?.release();
    written.forEach(safeDelete);
    throw e;
  }
}

/** Writes display then thumb (thumb is scaled from the display bitmap). Releases `source`. */
async function renderDerivatives(
  source: ImageRef,
  sourceSize: Size,
  dest: Omit<PhotoDestinations, 'original'>,
  format: PhotoFormat,
  written: File[],
): Promise<{ display: Size; thumb: Size }> {
  const displaySize = fitLongEdge(sourceSize, DISPLAY_LONG_EDGE);
  const thumbSize = fitLongEdge(displaySize, THUMB_LONG_EDGE);
  if (!dest.display && !dest.thumb) {
    source.release();
    return { display: displaySize, thumb: thumbSize };
  }

  let display: ImageRef | null = null;
  try {
    display = await resized(source, sourceSize, displaySize);
    if (display !== source) source.release();
    if (dest.display) {
      await saveTo(display, dest.display, DISPLAY_JPEG_QUALITY, format, written);
    }
    if (dest.thumb) {
      const thumb = await resized(display, displaySize, thumbSize);
      try {
        await saveTo(thumb, dest.thumb, THUMB_JPEG_QUALITY, format, written);
      } finally {
        if (thumb !== display) thumb.release();
      }
    }
    return { display: displaySize, thumb: thumbSize };
  } finally {
    if (display && display !== source) display.release();
    else source.release();
  }
}

async function resized(image: ImageRef, from: Size, to: Size): Promise<ImageRef> {
  if (sameSize(from, to)) return image;
  return render(ImageManipulator.manipulate(image).resize(to));
}

async function saveTo(image: ImageRef, uri: string, quality: number, format: PhotoFormat, written: File[]) {
  const saved = await image.saveAsync({ compress: quality, format: saveFormat(format) });
  const target = new File(uri);
  ensureParentDir(target);
  await new File(saved.uri).move(target, { overwrite: true });
  written.push(target);
}

async function render(ctx: ImageManipulatorContext): Promise<ImageRef> {
  try {
    return await ctx.renderAsync();
  } finally {
    ctx.release();
  }
}

function saveFormat(format: PhotoFormat): SaveFormat {
  return format === 'png' ? SaveFormat.PNG : SaveFormat.JPEG;
}

function ensureParentDir(file: File): void {
  const dir = file.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true });
}

function safeDelete(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best effort: leftovers in cache are swept at cold start, orphans in the store by sweepOrphans.
  }
}

// One job at a time: each holds a full-resolution decode, and the capture flow keeps shooting while
// earlier shots are still being processed.
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}
