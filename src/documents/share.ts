/**
 * Sharing documents and images through the OS share sheet.
 *
 * Every share sends a COPY staged under a caller-provided staging directory (cache/exports,
 * owned by src/data/files.ts): stored files are never exposed, react-native-share's
 * FileProvider only serves cache/, and receivers get human-readable names. Copies are not
 * deleted when the sheet closes (receivers read asynchronously); call cleanupStaging() at
 * startup to remove batches older than 24 h.
 */
import { Directory, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { isStagingExpired, STAGING_MAX_AGE_MS, stagingBatchName, uniqueFileNames, type ExportKind } from './naming';

export interface ShareItem {
  /** Source file (file:// URI). It is copied, never shared directly. */
  uri: string;
  /** Name the receiver sees, from exportFileName(). */
  fileName: string;
  mimeType: string;
  kind: ExportKind;
}

export interface ShareOptions {
  /** Directory URI for staged copies, e.g. `<cache>/exports`. Created if missing. */
  stagingDir: string;
  /** Share-sheet title (Android chooser title / iOS subject). */
  title?: string;
  /** Required to share items of kind 'original' (the explicit raw-photo export). */
  allowOriginals?: boolean;
}

export class SharingUnavailableError extends Error {
  constructor() {
    super('Sharing is not available on this device.');
    this.name = 'SharingUnavailableError';
  }
}

/** react-native-share is missing (e.g. Expo Go): fall back to the evidence-pack PDF. */
export class MultiShareUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Sharing several files at once is not available in this build.');
    this.name = 'MultiShareUnavailableError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const UTI: Record<string, string> = {
  'application/pdf': 'com.adobe.pdf',
  'image/jpeg': 'public.jpeg',
  'image/png': 'public.png',
  'application/zip': 'public.zip-archive',
};

function assertShareable(items: ShareItem[], opts: ShareOptions): void {
  if (items.length === 0) throw new Error('Nothing to share.');
  if (!opts.allowOriginals && items.some((i) => i.kind === 'original')) {
    throw new Error('Original photos can only be shared through the explicit export action.');
  }
}

/** Copies items into a fresh `<stagingDir>/<epochMs>-<rand>/` batch; returns the staged URIs. */
export async function stageFiles(items: ShareItem[], opts: ShareOptions): Promise<string[]> {
  assertShareable(items, opts);
  const batch = new Directory(opts.stagingDir, stagingBatchName(Date.now(), Math.random().toString(36).slice(2)));
  batch.create({ intermediates: true, idempotent: true });
  const names = uniqueFileNames(items.map((i) => i.fileName));
  const staged: string[] = [];
  try {
    for (let i = 0; i < items.length; i++) {
      const source = new File(items[i].uri);
      if (!source.exists) throw new Error(`File to share is missing: ${names[i]}`);
      const target = new File(batch, names[i]);
      await source.copy(target);
      staged.push(target.uri);
    }
  } catch (error) {
    try {
      batch.delete();
    } catch {
      // swept later by cleanupStaging
    }
    throw error;
  }
  return staged;
}

/** Shares one file (PDF or image) with expo-sharing. */
export async function shareFile(item: ShareItem, opts: ShareOptions): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new SharingUnavailableError();
  const [uri] = await stageFiles([item], opts);
  await Sharing.shareAsync(uri, { mimeType: item.mimeType, UTI: UTI[item.mimeType], dialogTitle: opts.title });
}

type RNShareModule = typeof import('react-native-share').default;

async function loadMultiShare(): Promise<RNShareModule> {
  try {
    // Lazy: the native module is absent in Expo Go and must not break the rest of the app.
    const mod = await import('react-native-share');
    if (!mod.default?.open) throw new Error('react-native-share has no open()');
    return mod.default;
  } catch (error) {
    throw new MultiShareUnavailableError(error);
  }
}

/**
 * Shares several files in one sheet (react-native-share, ACTION_SEND_MULTIPLE). A single item
 * goes through shareFile(). Resolves 'dismissed' when the user closed the sheet.
 */
export async function shareFiles(items: ShareItem[], opts: ShareOptions): Promise<'shared' | 'dismissed'> {
  assertShareable(items, opts);
  if (items.length === 1) {
    await shareFile(items[0], opts);
    return 'shared';
  }
  const share = await loadMultiShare();
  const urls = await stageFiles(items, opts);
  const mimeTypes = new Set(items.map((i) => i.mimeType));
  const type = mimeTypes.size === 1 ? items[0].mimeType : mimeTypes.has('application/pdf') ? '*/*' : 'image/*';
  const result = await share.open({
    urls,
    type,
    filenames: urls.map((u) => decodeURIComponent(u.slice(u.lastIndexOf('/') + 1))),
    title: opts.title,
    subject: opts.title,
    failOnCancel: false,
  });
  return result.dismissedAction ? 'dismissed' : 'shared';
}

/**
 * Deletes staged batches older than `maxAgeMs` (default 24 h). Safe to run on every cold start;
 * errors on single entries are skipped so one locked file never blocks the sweep.
 */
export function cleanupStaging(
  stagingDir: string,
  opts: { now?: number; maxAgeMs?: number } = {},
): { deleted: number } {
  const dir = new Directory(stagingDir);
  if (!dir.exists) return { deleted: 0 };
  const now = opts.now ?? Date.now();
  let deleted = 0;
  for (const entry of dir.list()) {
    try {
      const mtime = entry instanceof File ? entry.modificationTime : (entry.info().modificationTime ?? null);
      if (isStagingExpired({ name: entry.name, modificationTime: mtime }, now, opts.maxAgeMs ?? STAGING_MAX_AGE_MS)) {
        entry.delete();
        deleted++;
      }
    } catch {
      // try again next start
    }
  }
  return { deleted };
}
