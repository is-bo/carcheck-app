/**
 * Glue between a marking surface (MarkerEditor, or a compare pane) and the damage repository for
 * one canonical angle photo. Every tap persists (UX principle 2): a dropped pin is stored at
 * once as "type not set" and its sheet opens; the sheet then patches it. Deleting offers Undo.
 */
import { useCallback, useMemo, useState } from 'react';

import { addDamage, DataError, deleteDamage, deletePhoto, getPhoto, listDamage, updateDamage } from '@/data/repos';
import { damageLabel } from '@/domain/damage';
import type { Damage, Id, Photo } from '@/domain/types';
import { photoMarkers, type MarkerItem, type MarkerRole } from '@/media/annotate';
import type { Ring } from '@/media/geometry';
import { showToast } from '@/ui';

import { useLiveQuery } from '../inspection/useLiveQuery';
import { changedValues, initialValues, type DamageSheetMode, type DamageSheetValues } from './damageForm';

export interface DamageMarkingOptions {
  rentalId: Id;
  /** The canonical angle photo the rings are drawn on (BEFORE at pick-up, AFTER at return). */
  photo: Photo | null;
  /** False on locked evidence: taps still select so the sheet can show details. */
  editable: boolean;
}

export interface DamageMarking {
  mode: DamageSheetMode;
  /** Marks whose ring is on this photo, letters first, then numbers. */
  damages: Damage[];
  markers: MarkerItem[];
  loading: boolean;
  error: unknown;
  selectedId: Id | null;
  selected: Damage | null;
  /** Close-up linked to the selected mark. */
  selectedCloseup: Photo | null;
  select: (id: Id | null) => void;
  drop: (ring: Ring) => void;
  change: (id: Id, ring: Ring, role: MarkerRole) => void;
  save: (values: DamageSheetValues) => void;
  remove: () => void;
  /** Link a freshly stored close-up (kind 'damage_closeup') to the selected mark. */
  attachCloseup: (damageId: Id, closeupPhotoId: Id) => Promise<void>;
  /** Badge text of the selected mark ("A", "3", "3?"). */
  selectedLabel: string | undefined;
}

function reportError(e: unknown, fallback: string): void {
  showToast(e instanceof DataError && e.code !== 'not_found' ? e.message : fallback);
}

export function useDamageMarking({ rentalId, photo, editable }: DamageMarkingOptions): DamageMarking {
  const phase = photo?.phase ?? 'before';
  const mode: DamageSheetMode = phase === 'before' ? 'pre_existing' : 'return';
  const photoId = photo?.id ?? null;
  const [selectedId, setSelectedId] = useState<Id | null>(null);

  const query = useLiveQuery(
    async () => (photoId ? (await listDamage(rentalId, { photoId })).filter((d) => d.foundPhase === phase) : []),
    [rentalId, photoId, phase],
    ['damage', 'photo'],
  );
  const damages = useMemo(() => query.data ?? [], [query.data]);
  const markers = useMemo(() => photoMarkers(damages, phase), [damages, phase]);
  const selected = damages.find((d) => d.id === selectedId) ?? null;

  const closeupId = selected?.closeupPhotoId ?? null;
  const closeup = useLiveQuery(async () => (closeupId ? getPhoto(closeupId) : null), [closeupId], ['photo']);

  const drop = useCallback(
    (ring: Ring) => {
      if (!photoId || !editable) return;
      addDamage({ photoId, marker: { v: 1, ring }, status: mode === 'return' ? 'new' : undefined }).then(
        (d) => setSelectedId(d.id),
        (e: unknown) => reportError(e, "Couldn't save the mark. Try again."),
      );
    },
    [photoId, editable, mode],
  );

  const change = useCallback(
    (id: Id, ring: Ring, role: MarkerRole) => {
      const d = damages.find((x) => x.id === id);
      if (!d || !editable) return;
      const marker = role === 'primary' ? { ...d.marker, ring } : { ...d.marker, counterpart: ring };
      updateDamage(id, { marker }).catch((e: unknown) => reportError(e, "Couldn't move the mark. Try again."));
    },
    [damages, editable],
  );

  const save = useCallback(
    (values: DamageSheetValues) => {
      if (!selected || !editable) return;
      const before = initialValues(mode, selected);
      const patch = changedValues(before, values);
      if (Object.keys(patch).length === 0) return;
      updateDamage(selected.id, patch).catch((e: unknown) => reportError(e, "Couldn't save the damage details. Try again."));
    },
    [selected, editable, mode],
  );

  const remove = useCallback(() => {
    if (!selected || !photoId || !editable) return;
    const gone = selected;
    const label = damageLabel(gone);
    setSelectedId(null);
    deleteDamage(gone.id).then(
      () =>
        showToast(`Damage ${label} deleted`, {
          action: {
            label: 'Undo',
            onPress: () => {
              addDamage({
                photoId,
                marker: gone.marker,
                status: mode === 'return' ? gone.status : undefined,
                type: gone.type,
                severity: gone.severity,
                locationLabel: gone.locationLabel,
                note: gone.note,
                closeupPhotoId: gone.closeupPhotoId,
              }).catch((e: unknown) => reportError(e, "Couldn't restore the mark."));
            },
          },
        }),
      (e: unknown) => reportError(e, "Couldn't delete the mark. Try again."),
    );
  }, [selected, photoId, editable, mode]);

  const attachCloseup = useCallback(async (damageId: Id, closeupPhotoId: Id) => {
    const previous = (await listDamage(rentalId)).find((d) => d.id === damageId)?.closeupPhotoId ?? null;
    await updateDamage(damageId, { closeupPhotoId });
    // The replaced close-up is referenced by nothing now; drop it unless it is frozen evidence.
    if (previous && previous !== closeupPhotoId) await deletePhoto(previous).catch(() => undefined);
  }, [rentalId]);

  return {
    mode,
    damages,
    markers,
    loading: query.loading,
    error: query.error,
    selectedId: selected ? selectedId : null,
    selected,
    selectedCloseup: closeup.data ?? null,
    select: setSelectedId,
    drop,
    change,
    save,
    remove,
    attachCloseup,
    selectedLabel: selected ? markers.find((m) => m.damageId === selected.id)?.label : undefined,
  };
}
