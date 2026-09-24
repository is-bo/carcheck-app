/**
 * PDF rendering, printing and image embedding (device side of the document builders).
 *
 * expo-print renders HTML in a WebView; images must be base64 data URIs. Images are prepared
 * strictly one at a time: a decoded 12 MP photo is ~48 MB, so parallel work risks OOM on
 * low-end phones.
 */
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import type { ContractRefResolver } from './contract';
import { A4_HEIGHT_PT, A4_WIDTH_PT, PAGE_MARGIN_MM } from './html/styles';
import { EMBED_PRESETS, fitLongEdge, type EmbedPreset } from './sizing';
import type { DataUri } from './types';

const MM_TO_PT = 72 / 25.4;
// Android takes margins from CSS @page; iOS ignores @page and needs them as options.
const IOS_MARGINS =
  Platform.OS === 'ios'
    ? {
        top: PAGE_MARGIN_MM * MM_TO_PT,
        right: PAGE_MARGIN_MM * MM_TO_PT,
        bottom: (PAGE_MARGIN_MM + 2) * MM_TO_PT,
        left: PAGE_MARGIN_MM * MM_TO_PT,
      }
    : undefined;

export interface RenderedPdf {
  uri: string;
  pageCount: number;
}

/**
 * Renders HTML to an A4 PDF and moves it to `destUri` (a file:// URI in app storage).
 * Never overwrites: an existing destination is an error, so stored documents stay immutable.
 */
export async function renderPdf(html: string, destUri: string): Promise<RenderedPdf> {
  const dest = new File(destUri);
  if (dest.exists) throw new Error(`renderPdf: ${dest.name} already exists`);
  const result = await Print.printToFileAsync({ html, width: A4_WIDTH_PT, height: A4_HEIGHT_PT, margins: IOS_MARGINS });
  const printed = new File(result.uri);
  try {
    dest.parentDirectory.create({ intermediates: true, idempotent: true });
    await printed.move(dest);
  } catch (error) {
    if (printed.exists) printed.delete();
    throw error;
  }
  return { uri: dest.uri, pageCount: result.numberOfPages };
}

/** System print dialog for HTML. Prefer printPdf() for documents that were already shared. */
export async function printHtml(html: string): Promise<void> {
  await Print.printAsync({ html, width: A4_WIDTH_PT, height: A4_HEIGHT_PT, margins: IOS_MARGINS });
}

/** Prints an existing PDF, so what prints is exactly what was shared. */
export async function printPdf(pdfUri: string): Promise<void> {
  await Print.printAsync({ uri: pdfUri });
}

/** Reads a small file (signature PNG) as a data URI without re-encoding. */
export async function fileToDataUri(uri: string, mimeType: string): Promise<DataUri> {
  return `data:${mimeType};base64,${await new File(uri).base64()}`;
}

/**
 * Downscales an image to the preset's long edge and returns it as a base64 data URI.
 * Pass the known upright `size` (from the DB) to avoid decoding twice.
 */
export async function embedImage(
  uri: string,
  preset: EmbedPreset = EMBED_PRESETS.evidence,
  size?: { width: number; height: number },
): Promise<DataUri> {
  const refs: { release(): void }[] = [];
  try {
    let context = ImageManipulator.manipulate(uri);
    refs.push(context);
    const target = size ? fitLongEdge(size, preset.maxEdge) : null;
    if (target) context = context.resize(target);
    let image: ImageRef = await context.renderAsync();
    refs.push(image);

    const late = size ? null : fitLongEdge(image, preset.maxEdge);
    if (late) {
      const resized = ImageManipulator.manipulate(image).resize(late);
      refs.push(resized);
      image = await resized.renderAsync();
      refs.push(image);
    }

    const saved = await image.saveAsync({
      base64: true,
      compress: preset.quality,
      format: preset.format === 'png' ? SaveFormat.PNG : SaveFormat.JPEG,
    });
    deleteQuietly(saved.uri);
    if (!saved.base64) throw new Error('embedImage: no base64 output');
    return `data:image/${preset.format};base64,${saved.base64}`;
  } finally {
    for (const ref of refs.reverse()) {
      try {
        ref.release();
      } catch {
        // already released by the native side
      }
    }
  }
}

function deleteQuietly(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // a leftover cache file is harmless
  }
}

export interface EmbedJob {
  uri: string | null;
  preset?: EmbedPreset;
  size?: { width: number; height: number };
}

/**
 * Embeds images sequentially. A missing or unreadable image yields null (the document prints a
 * placeholder) instead of failing the whole report.
 */
export async function embedImages(
  jobs: EmbedJob[],
  onProgress?: (done: number, total: number) => void,
): Promise<(DataUri | null)[]> {
  const out: (DataUri | null)[] = [];
  for (const job of jobs) {
    let result: DataUri | null = null;
    if (job.uri) {
      try {
        result = await embedImage(job.uri, job.preset, job.size);
      } catch {
        result = null;
      }
    }
    out.push(result);
    onProgress?.(out.length, jobs.length);
  }
  return out;
}

/**
 * Resolver for buildContractPdfHtml / resolveContract. `photoFile` maps a photo id to its
 * absolute file URI and upright size (null if unknown); the signature is embedded as-is (PNG).
 */
export function createContractResolver(sources: {
  photoFile: (photoId: string) => { uri: string; width: number; height: number } | null;
  signatureUri: string | null;
}): ContractRefResolver {
  return async (ref) => {
    if (ref.kind === 'signature') {
      return sources.signatureUri ? fileToDataUri(sources.signatureUri, 'image/png') : null;
    }
    const photo = sources.photoFile(ref.photoId);
    return photo ? embedImage(photo.uri, EMBED_PRESETS.contractPhoto, photo) : null;
  };
}
