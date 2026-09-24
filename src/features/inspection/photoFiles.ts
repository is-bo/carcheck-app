/**
 * Where a stored photo's pixels are on disk, and its cache derivatives (display 2048 px, thumb
 * 384 px). Derivatives are not backed up, so they are regenerated on first use after a restore
 * or a cache purge.
 */
import { File } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';

import { photoPaths, resolveFileUri } from '@/data/files';
import type { Photo } from '@/domain/types';
import { writeDerivatives } from '@/media/photo';

export type PhotoVariant = 'display' | 'thumb';
export interface PhotoRef {
  id: Photo['id'];
  rentalId: Photo['rentalId'];
  file: { path: string };
}

export interface PhotoFileUris {
  original: string;
  display: string;
  thumb: string;
}

export function photoFileUris(photo: PhotoRef): PhotoFileUris {
  const paths = photoPaths(photo.rentalId, photo.id);
  return { original: resolveFileUri(photo.file.path), display: paths.display, thumb: paths.thumb };
}

function exists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

const pending = new Map<string, Promise<PhotoFileUris>>();

/** Resolves once both derivatives exist (writing them from the original if needed). */
export function ensurePhotoDerivatives(photo: PhotoRef): Promise<PhotoFileUris> {
  const uris = photoFileUris(photo);
  if (exists(uris.display) && exists(uris.thumb)) return Promise.resolve(uris);
  let job = pending.get(photo.id);
  if (!job) {
    job = writeDerivatives(uris.original, { display: uris.display, thumb: uris.thumb })
      .then(() => uris)
      .finally(() => pending.delete(photo.id));
    pending.set(photo.id, job);
  }
  return job;
}

/**
 * File URI of a photo derivative for expo-image / Skia. Null while a missing derivative is
 * being written; falls back to the original if it cannot be written.
 */
export function usePhotoUri(photo: PhotoRef | null | undefined, variant: PhotoVariant = 'display'): string | null {
  const id = photo?.id ?? null;
  const rentalId = photo?.rentalId ?? null;
  const path = photo?.file.path ?? null;
  const uris = useMemo(
    () => (id && rentalId && path ? photoFileUris({ id, rentalId, file: { path } }) : null),
    [id, rentalId, path],
  );
  const [resolved, setResolved] = useState<{ id: string; uri: string } | null>(null);
  const ready = uris !== null && exists(uris[variant]);

  useEffect(() => {
    if (!uris || !id || ready) return;
    let alive = true;
    ensurePhotoDerivatives({ id, rentalId: rentalId!, file: { path: path! } }).then(
      (u) => alive && setResolved({ id, uri: u[variant] }),
      () => alive && setResolved({ id, uri: uris.original }),
    );
    return () => {
      alive = false;
    };
  }, [uris, id, rentalId, path, ready, variant]);

  if (!uris) return null;
  if (ready) return uris[variant];
  return resolved && resolved.id === id ? resolved.uri : null;
}
