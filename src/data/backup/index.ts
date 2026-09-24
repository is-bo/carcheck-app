/**
 * Backup & restore for the app (Settings › Backup & restore). docs/DATA_MODEL.md §7.
 *
 * Flow for screens:
 *   createBackup → saveBackupToFolder / shareBackup → discardBackup when the screen closes.
 *   pickBackupFile → prepareRestore (validates everything, live data untouched) → show the
 *   preview and the destructive confirm → commitRestore (or discardRestore).
 * Only one backup or restore runs at a time. Errors are BackupError; describeBackupError() gives
 * the user-facing copy.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { BackupLogEntry } from '@/domain/types';

import { getLastBackupAt, getRecordCounts, getStorageUsage, listBackupLog } from '../repos/storage';
import {
  createBackupWith,
  discardBackupWith,
  estimateBackupWith,
  logBackupWith,
  type BackupEstimate,
  type BackupOptions,
  type BackupResult,
} from './createBackup';
import { BackupError, type BackupOperation } from './errors';
import { expoBackupDeps } from './expo';
import { backupReminder, type BackupReminder } from './manifest';
import {
  commitRestoreWith,
  deleteSafetyCopyWith,
  discardRestoreWith,
  getSafetyCopyWith,
  prepareRestoreWith,
  type RestoreOptions,
  type RestoreOutcome,
  type RestorePreview,
  type SafetyCopyInfo,
} from './restore';

export { BackupError, describeBackupError, isBackupError, type BackupErrorCode, type BackupErrorCopy } from './errors';
export { backupReminder, BACKUP_REMINDER_DAYS, LARGE_BACKUP_BYTES, type BackupReminder } from './manifest';
export type { BackupEstimate, BackupOptions, BackupProgress, BackupResult, BackupStep } from './createBackup';
export type { RestoreOptions, RestoreOutcome, RestorePreview, RestoreProgress, RestoreStep, SafetyCopyInfo } from './restore';

let running: BackupOperation | null = null;

/** Maintenance mode: a second backup/restore (double tap, two screens) is refused. */
async function exclusive<T>(operation: BackupOperation, task: () => Promise<T>): Promise<T> {
  if (running) {
    throw new BackupError('failed', operation, `A ${running} is already running`, {
      details: [`Wait for the ${running} to finish.`],
    });
  }
  running = operation;
  try {
    return await task();
  } finally {
    running = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Status

export interface BackupStatus {
  /** Latest backup made, or the creation time of the latest restored backup if newer. */
  lastBackupAt: number | null;
  lastBackup: BackupLogEntry | null;
  lastRestore: BackupLogEntry | null;
  reminder: BackupReminder;
  counts: Awaited<ReturnType<typeof getRecordCounts>>;
  /** Stored media + database on this phone. */
  bytes: number;
}

export async function getBackupStatus(now: number = Date.now()): Promise<BackupStatus> {
  const [lastBackupAt, log, counts, usage] = await Promise.all([
    getLastBackupAt(),
    listBackupLog(20),
    getRecordCounts(),
    getStorageUsage(),
  ]);
  const hasData = counts.rentals + counts.vehicles + counts.customers > 0;
  return {
    lastBackupAt,
    lastBackup: log.find((e) => e.kind === 'backup') ?? null,
    lastRestore: log.find((e) => e.kind === 'restore') ?? null,
    reminder: backupReminder(lastBackupAt, now, hasData),
    counts,
    bytes: usage.totalBytes + expoBackupDeps().live.liveDbBytes(),
  };
}

// ---------------------------------------------------------------------------------------------
// Backup

export function estimateBackup(): Promise<BackupEstimate> {
  return estimateBackupWith(expoBackupDeps());
}

export function createBackup(opts: BackupOptions = {}): Promise<BackupResult> {
  return exclusive('backup', () => createBackupWith(expoBackupDeps(), opts));
}

const logged = new Set<string>();

async function logOnce(result: BackupResult): Promise<void> {
  if (logged.has(result.uri)) return;
  logged.add(result.uri);
  try {
    await logBackupWith(expoBackupDeps(), result);
  } catch (e) {
    logged.delete(result.uri);
    console.warn('[backup] could not record the backup', e);
  }
}

/** Android SAF folder picker (Downloads, SD card, USB drive…). iOS saves through the share sheet. */
export const canSaveToFolder = Platform.OS === 'android';

function isPickerCancel(e: unknown): boolean {
  const code = String((e as { code?: unknown } | null)?.code ?? '');
  const message = e instanceof Error ? e.message : String(e);
  return /cancel/i.test(code) || /cancel/i.test(message);
}

/** Copies the backup into a folder the user picks. Resolves 'cancelled' when no folder was chosen. */
export async function saveBackupToFolder(result: BackupResult): Promise<'saved' | 'cancelled'> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (e) {
    if (isPickerCancel(e)) return 'cancelled';
    throw new BackupError('failed', 'backup', 'The folder picker could not be opened', { cause: e });
  }
  try {
    // Streams natively into the SAF folder under the backup's own file name.
    await new File(result.uri).copy(folder, { overwrite: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new BackupError(/no space|ENOSPC/i.test(message) ? 'no_space' : 'failed', 'backup', 'Saving to the folder failed', {
      details: ['Choose another folder, or use Share.'],
      cause: e,
    });
  }
  await logOnce(result);
  return 'saved';
}

export async function shareBackup(result: BackupResult): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError('failed', 'backup', 'Sharing is not available on this phone');
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/octet-stream',
    UTI: 'public.data',
    dialogTitle: 'Share backup',
  });
  await logOnce(result);
}

/**
 * Deletes the temp copy. Call when the backup screen closes after Save to folder; after Share
 * the receiving app may still be reading, so leave it to housekeeping (swept after an hour).
 */
export function discardBackup(result: BackupResult): void {
  discardBackupWith(expoBackupDeps(), result);
}

// ---------------------------------------------------------------------------------------------
// Restore

export interface PickedBackupFile {
  /** Local copy in the cache (the document picker copies it). */
  uri: string;
  name: string;
  size: number | null;
}

/** System file picker. Resolves null when the user backs out. */
export async function pickBackupFile(): Promise<PickedBackupFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, size: asset.size ?? null };
}

/** Validates the whole archive in a new data root. The picked copy is consumed either way. */
export function prepareRestore(picked: PickedBackupFile, opts: RestoreOptions = {}): Promise<RestorePreview> {
  return exclusive('restore', async () => {
    try {
      return await prepareRestoreWith(expoBackupDeps(), { archive: picked.uri, fileName: picked.name }, opts);
    } finally {
      const leftover = new File(picked.uri);
      if (leftover.exists) leftover.delete();
    }
  });
}

/**
 * Switches to the restored data and reopens it (every screen gets an 'all' data-change event).
 * Throws `switch_failed` when the previous data had to be put back.
 */
export function commitRestore(preview: RestorePreview): Promise<RestoreOutcome> {
  return exclusive('restore', () => commitRestoreWith(expoBackupDeps(), preview));
}

export function discardRestore(preview: RestorePreview): void {
  discardRestoreWith(expoBackupDeps(), preview);
}

/** Data kept from before the last restore (14 days), e.g. to offer deleting it when space is short. */
export function getSafetyCopy(): SafetyCopyInfo | null {
  return getSafetyCopyWith(expoBackupDeps());
}

export function deleteSafetyCopy(): void {
  deleteSafetyCopyWith(expoBackupDeps());
}
