/**
 * Gallery import for customer ID documents, the vehicle photo and the agency logo.
 *
 * Privacy (BRIEF "no media-store leakage"): the system photo picker (Android 13+ Photo Picker /
 * iOS PHPicker) needs no media permission and hands back a copy in the app cache. That copy is
 * re-encoded into the caller's app-private destination (orientation baked in, EXIF/GPS dropped)
 * and then deleted. Nothing is ever written to the gallery.
 */
import * as ImagePicker from 'expo-image-picker';

import { processPhoto, type PhotoDestinations, type PhotoFormat, type ProcessedPhoto } from './processPhoto';
import { ORIGINAL_TARGET_LONG_EDGE } from './photoMath';

export type ImportPurpose = 'id_doc' | 'vehicle' | 'logo';

const PRESETS: Record<ImportPurpose, { format: PhotoFormat; maxLongEdge: number }> = {
  // Documents keep full resolution so small print stays legible.
  id_doc: { format: 'jpeg', maxLongEdge: ORIGINAL_TARGET_LONG_EDGE },
  vehicle: { format: 'jpeg', maxLongEdge: ORIGINAL_TARGET_LONG_EDGE },
  // PNG keeps transparency; the PDF header uses it at ≤ 600 px.
  logo: { format: 'png', maxLongEdge: 1024 },
};

/**
 * Opens the system photo picker and stores the chosen image at `dest` (see processPhoto).
 * Resolves null when the user cancels. For a logo, pass `.png` destination names.
 */
export async function importPhotoFromLibrary(
  dest: PhotoDestinations,
  purpose: ImportPurpose,
): Promise<ProcessedPhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: false,
    allowsMultipleSelection: false,
    quality: 1,
    exif: false,
    base64: false,
    // Offline app: never pull iCloud originals over the network.
    shouldDownloadFromNetwork: false,
    // iOS: hand back JPEG instead of HEIC.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const preset = PRESETS[purpose];
  return processPhoto(result.assets[0].uri, dest, {
    reencode: true,
    format: preset.format,
    maxLongEdge: preset.maxLongEdge,
  });
}
