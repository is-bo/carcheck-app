import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { hapticMarkerDrop } from '@/ui/haptics';

import type { Ring } from '../geometry';
import type { HitItem } from './markerMath';
import { badgeShapeFor } from './markerStyle';
import type { LiveRing, MarkerItem, MarkerRole } from './types';

export interface EditableItem extends HitItem {
  damageId: string;
  role: MarkerRole;
}

/** Finger and magnified point while a marker is dragged (drives the loupe). */
export interface DragInfo {
  x: number;
  y: number;
  focusX: number;
  focusY: number;
}

/**
 * Editing state read by the gesture worklets. Props are mirrored into shared values so the
 * gestures stay stable (no re-attach on every render) and every decision runs on the UI thread.
 */
export interface MarkerEditing {
  items: SharedValue<EditableItem[]>;
  selectedId: SharedValue<string | null>;
  /** Move/resize allowed (false = read-only: taps still select). */
  canEdit: SharedValue<boolean>;
  /** Taps on empty photo area drop a new ring. */
  canDrop: SharedValue<boolean>;
  live: SharedValue<LiveRing | null>;
  drag: SharedValue<DragInfo | null>;
  onDrop: (ring: Ring) => void;
  onSelect: (damageId: string) => void;
  onChange: (damageId: string, ring: Ring, role: MarkerRole) => void;
}

export interface MarkerEditingOptions {
  /** Markers the finger can grab on this surface, in draw order (top-most last). */
  markers: MarkerItem[];
  selectedId?: string | null;
  editable?: boolean;
  /** Default true; false for surfaces that only adjust existing rings (BEFORE pane in Compare). */
  dropEnabled?: boolean;
  onDrop?: (ring: Ring) => void;
  onSelect?: (damageId: string) => void;
  onChange?: (damageId: string, ring: Ring, role: MarkerRole) => void;
  /** Share one live ring between surfaces so derived counterparts follow drags on the other photo. */
  live?: SharedValue<LiveRing | null>;
}

function ringsKey(markers: MarkerItem[]): string {
  return markers.map((m) => `${m.key}:${m.ring.x},${m.ring.y},${m.ring.r}`).join('|');
}

export function useMarkerEditing(opts: MarkerEditingOptions): MarkerEditing {
  const { markers, selectedId = null, editable = true, dropEnabled = true } = opts;
  const items = useSharedValue<EditableItem[]>([]);
  const selected = useSharedValue<string | null>(selectedId);
  const canEdit = useSharedValue(editable);
  const canDrop = useSharedValue(editable && dropEnabled);
  const ownLive = useSharedValue<LiveRing | null>(null);
  const live = opts.live ?? ownLive;
  const drag = useSharedValue<DragInfo | null>(null);

  const handlers = useRef(opts);
  useLayoutEffect(() => {
    handlers.current = opts;
  });

  const key = ringsKey(markers);
  useEffect(() => {
    items.set(markers.map((m) => ({ damageId: m.damageId, role: m.role, ring: m.ring, shape: badgeShapeFor(m.status) })));
    // The stored rings changed (the edit was saved): stop drawing the live copy.
    live.set(null);
    // Only the ring content matters; `markers` identity may change on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, items, live]);

  useEffect(() => {
    selected.set(selectedId);
  }, [selectedId, selected]);

  useEffect(() => {
    canEdit.set(editable);
    canDrop.set(editable && dropEnabled);
    if (!editable) live.set(null);
  }, [editable, dropEnabled, canEdit, canDrop, live]);

  const onDrop = useCallback((ring: Ring) => {
    hapticMarkerDrop();
    handlers.current.onDrop?.(ring);
  }, []);
  const onSelect = useCallback((id: string) => handlers.current.onSelect?.(id), []);
  const onChange = useCallback((id: string, ring: Ring, role: MarkerRole) => handlers.current.onChange?.(id, ring, role), []);

  return useMemo(
    () => ({ items, selectedId: selected, canEdit, canDrop, live, drag, onDrop, onSelect, onChange }),
    [items, selected, canEdit, canDrop, live, drag, onDrop, onSelect, onChange],
  );
}
