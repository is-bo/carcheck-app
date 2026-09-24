/**
 * Agency logo pick/remove, shared by onboarding and Settings → Agency. The picker writes a temp
 * PNG (cache/capture), and setAgencyLogo imports it into the file store and deletes the old one.
 */
import type { AgencySettings } from '@/domain/types';
import { newTempFileUri } from '@/data/files';
import { setAgencyLogo } from '@/data/repos';
import { importPhotoFromLibrary } from '@/media/photo';

/** Opens the system photo picker. Resolves null when the user cancels. */
export async function pickAgencyLogo(): Promise<AgencySettings | null> {
  const tempUri = newTempFileUri('capture', 'png');
  const processed = await importPhotoFromLibrary({ original: tempUri }, 'logo');
  if (!processed) return null;
  return setAgencyLogo({ tempUri, byteSize: processed.bytes, sha256: processed.sha256 }, 'png');
}

export function removeAgencyLogo(): Promise<AgencySettings> {
  return setAgencyLogo(null);
}
