/**
 * Settings → Storage → "Clear temporary exports". `cleanupTempFiles` (@/data/files) already
 * sweeps cache/exports deferred at cold start, but it is age-gated (24 h) so an in-flight share
 * copy is never deleted from under Android. A button the user taps on purpose should reclaim the
 * space immediately instead, so this clears the whole exports cache area now. Backup/restore
 * staging areas are untouched: this only ever removes copies made for sharing or "Save to folder".
 *
 * Known gap: there is no repo-level function for this (DATA_MODEL §8's sketch has no "clear now"
 * entry); this talks to expo-file-system directly, which ARCHITECTURE.md otherwise reserves for
 * src/media and src/export. Narrow and self-contained; worth moving into src/data if another
 * screen needs it.
 */
import { Directory, File, Paths } from 'expo-file-system';

function sizeOf(entry: File | Directory): number {
  if (entry instanceof File) return entry.exists ? entry.size : 0;
  return entry.list().reduce((sum, child) => sum + sizeOf(child), 0);
}

export interface ClearTempExportsResult {
  bytesFreed: number;
}

export function clearTempExports(): ClearTempExportsResult {
  const dir = new Directory(Paths.cache, 'exports');
  if (!dir.exists) return { bytesFreed: 0 };
  const bytesFreed = dir.list().reduce((sum, entry) => sum + sizeOf(entry), 0);
  dir.delete();
  return { bytesFreed };
}
