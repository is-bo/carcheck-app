/**
 * Backup / restore failures with the user-facing copy (UX_FLOWS §9, DATA_MODEL §7.4). Every
 * restore error raised before the pointer switch means the live data was never touched, and the
 * copy says so.
 */

export type BackupErrorCode =
  /** Not a zip, no manifest.json, or a manifest of another format. */
  | 'not_a_backup'
  /** Checksums, sizes, manifest self-hash or the database structure don't match. */
  | 'corrupted'
  /** Files listed in the manifest (or referenced by the database) are absent from the archive. */
  | 'incomplete'
  /** Backup format or database schema newer than this app understands. */
  | 'newer_version'
  | 'no_space'
  /** Migrating the restored database to this app's schema failed. */
  | 'upgrade_failed'
  /** The pointer switch or the first open of the restored data failed; the old data is back. */
  | 'switch_failed'
  | 'cancelled'
  /** Anything else (IO error, native module missing…). */
  | 'failed';

export type BackupOperation = 'backup' | 'restore';

export interface BackupErrorInit {
  details?: readonly string[];
  neededBytes?: number;
  freeBytes?: number;
  cause?: unknown;
}

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  readonly operation: BackupOperation;
  /** Damaged / missing file paths or integrity problems, for the error screen. */
  readonly details: readonly string[];
  readonly neededBytes?: number;
  readonly freeBytes?: number;
  override readonly cause?: unknown;

  constructor(code: BackupErrorCode, operation: BackupOperation, message: string, init: BackupErrorInit = {}) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.operation = operation;
    this.details = init.details ?? [];
    this.neededBytes = init.neededBytes;
    this.freeBytes = init.freeBytes;
    this.cause = init.cause;
  }
}

export function isBackupError(e: unknown, code?: BackupErrorCode): e is BackupError {
  return e instanceof BackupError && (code === undefined || e.code === code);
}

export function cancelled(operation: BackupOperation): BackupError {
  return new BackupError('cancelled', operation, `${operation} cancelled`);
}

/** Throws the operation's `cancelled` error once the signal has fired. */
export function throwIfAborted(signal: AbortSignal | undefined, operation: BackupOperation): void {
  if (signal?.aborted) throw cancelled(operation);
}

/** Wraps unexpected failures; BackupErrors pass through unchanged. */
export function asBackupError(e: unknown, operation: BackupOperation): BackupError {
  if (e instanceof BackupError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new BackupError('failed', operation, message, { cause: e });
}

export interface BackupErrorCopy {
  title: string;
  message: string;
  /** At most `maxDetails` entries plus "and N more". */
  details: string[];
}

const NOTHING_CHANGED = 'Nothing on this phone was changed.';

/**
 * Title + sentence for an error screen. `formatBytes` comes from the UI layer (locale-aware
 * "1.2 GB") so this module stays free of UI imports.
 */
export function describeBackupError(
  error: unknown,
  formatBytes: (bytes: number) => string,
  maxDetails = 5,
): BackupErrorCopy {
  const e = error instanceof BackupError ? error : asBackupError(error, 'restore');
  const details = e.details.slice(0, maxDetails);
  if (e.details.length > maxDetails) details.push(`and ${e.details.length - maxDetails} more`);
  const hasNumbers = e.neededBytes !== undefined && e.freeBytes !== undefined;
  const space = (subject: string) =>
    hasNumbers
      ? `${subject} needs ${formatBytes(e.neededBytes ?? 0)}; ${formatBytes(e.freeBytes ?? 0)} is free.`
      : 'Free up some space on this phone and try again.';

  if (e.operation === 'backup') {
    switch (e.code) {
      case 'no_space':
        return {
          title: 'Not enough space for the backup',
          message: `${space('The backup')} Your data wasn't changed.`,
          details,
        };
      case 'cancelled':
        return { title: 'Backup cancelled', message: "No backup file was made. Your data wasn't changed.", details };
      default:
        return {
          title: 'The backup couldn’t be made',
          message: "Your data wasn't changed. Try again; if it keeps failing, restart the phone first.",
          details: details.length > 0 ? details : [e.message],
        };
    }
  }

  switch (e.code) {
    case 'not_a_backup':
      return { title: 'This isn’t a CarCheck backup file', message: `Choose a file ending in .carcheck. ${NOTHING_CHANGED}`, details };
    case 'corrupted':
      return {
        title: 'This backup file is damaged',
        message: `Some of its contents don't match what was saved. ${NOTHING_CHANGED}`,
        details,
      };
    case 'incomplete':
      return {
        title: 'This backup file is incomplete',
        message: `${countLine(e.details.length)} missing, often because the copy was cut off. ${NOTHING_CHANGED}`,
        details,
      };
    case 'newer_version':
      return {
        title: 'This backup is from a newer CarCheck',
        message: `Update the app, then try again. ${NOTHING_CHANGED}`,
        details,
      };
    case 'no_space':
      return { title: 'Not enough space', message: `${space('The restore')} ${NOTHING_CHANGED}`, details };
    case 'upgrade_failed':
      return {
        title: 'This backup couldn’t be updated',
        message: `Its records couldn't be converted for this version of CarCheck. ${NOTHING_CHANGED}`,
        details,
      };
    case 'switch_failed':
      return {
        title: 'The restore couldn’t be finished',
        message: `CarCheck went back to the data you had before. ${NOTHING_CHANGED}`,
        details,
      };
    case 'cancelled':
      return { title: 'Restore cancelled', message: NOTHING_CHANGED, details };
    default:
      return {
        title: 'The backup couldn’t be read',
        message: `${NOTHING_CHANGED} Try again; if it keeps failing, copy the file to the phone again.`,
        details: details.length > 0 ? details : [e.message],
      };
  }
}

function countLine(n: number): string {
  if (n === 0) return 'Some files are';
  return n === 1 ? '1 file is' : `${n} files are`;
}
