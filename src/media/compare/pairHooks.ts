import { FilterMode, MipmapMode, type SamplingOptions } from '@shopify/react-native-skia';
import { useEffect, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { PairMarkers } from '../annotate/pairMarkers';
import type { LiveRing, MarkerItem } from '../annotate/types';
import { useMarkerEditing, type MarkerEditing } from '../annotate/useMarkerEditing';
import type { ComparePhoto, MarkingHandlers, PairImages } from './types';
import { useSharedViewport, type SharedViewport } from './useSharedViewport';
import { useSkImage } from './useSkImage';

/** Mipmapped linear sampling: clean downscaling of the 2048 px derivatives at 60 fps. */
export const PHOTO_SAMPLING: SamplingOptions = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

export const NO_MARKERS: PairMarkers = { before: [], after: [] };

/** Use the caller's decoded images, or decode (and later free) them here. */
export function usePairImages(
  before: ComparePhoto,
  after: ComparePhoto,
  images: PairImages | undefined,
  onImageError?: (side: 'before' | 'after', error: Error) => void,
): PairImages {
  const b = useSkImage(images ? null : before.uri, (e) => onImageError?.('before', e));
  const a = useSkImage(images ? null : after.uri, (e) => onImageError?.('after', e));
  return images ?? { before: b, after: a };
}

/** The caller's viewport or an own one; back to fit whenever the pair changes (not on mount). */
export function usePairViewport(viewport: SharedViewport | undefined, before: ComparePhoto, after: ComparePhoto): SharedViewport {
  const own = useSharedViewport();
  const vp = viewport ?? own;
  const key = `${before.uri}|${after.uri}`;
  const prev = useRef(key);
  useEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    vp.reset();
  }, [key, vp]);
  return vp;
}

export function useLive(live: SharedValue<LiveRing | null> | undefined): SharedValue<LiveRing | null> {
  const own = useSharedValue<LiveRing | null>(null);
  return live ?? own;
}

/**
 * Editing state for both photos in "Mark new damage": AFTER takes drops and drags; BEFORE only
 * lets the employee adjust dashed "same area" rings. Null while not marking.
 */
export function usePairMarking(
  markers: PairMarkers,
  marking: MarkingHandlers | null | undefined,
  live: SharedValue<LiveRing | null>,
): { after: MarkerEditing | null; before: MarkerEditing | null } {
  const on = !!marking;
  const beforeCounterparts: MarkerItem[] = markers.before.filter((m) => m.role === 'counterpart');
  const common = {
    selectedId: marking?.selectedId ?? null,
    editable: on,
    onSelect: marking?.onSelect,
    onChange: marking?.onChange,
    live,
  };
  const after = useMarkerEditing({ ...common, markers: markers.after, onDrop: marking?.onDrop });
  const before = useMarkerEditing({ ...common, markers: beforeCounterparts, dropEnabled: false });
  return { after: on ? after : null, before: on ? before : null };
}
