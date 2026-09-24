/**
 * Damage rows -> marker items per photo of a BEFORE/AFTER pair. Each damage draws a solid ring
 * on the photo it was marked on and a dashed "same area" ring on the paired photo: the stored
 * override if the employee adjusted it, otherwise derived live (so it follows drags).
 */
import type { Damage, Phase } from '@/domain/types';

import { deriveCounterpart, type Alignment, type Size } from '../geometry';
import { badgeLabel } from './markerStyle';
import type { MarkerItem } from './types';

export type MarkedDamage = Pick<Damage, 'id' | 'status' | 'number' | 'foundPhase' | 'marker'>;

export interface PairMarkerOptions {
  before: Size;
  after: Size;
  alignment?: Alignment | null;
  /**
   * Also project pick-up (pre-existing) damage onto AFTER as dashed context (UX "Existing"
   * toggle). Off by default: the projection is approximate.
   */
  showExistingOnAfter?: boolean;
}

export interface PairMarkers {
  before: MarkerItem[];
  after: MarkerItem[];
}

function drawRank(m: MarkerItem): number {
  return m.role === 'counterpart' ? 0 : m.status === 'pre_existing' ? 1 : 2;
}

/** Counterparts underneath, then existing, then new/uncertain on top (same order as the export). */
export function sortForDrawing(items: MarkerItem[]): MarkerItem[] {
  return items
    .map((m, i) => ({ m, i }))
    .sort((a, b) => drawRank(a.m) - drawRank(b.m) || a.i - b.i)
    .map((x) => x.m);
}

export function pairMarkers(damages: MarkedDamage[], opts: PairMarkerOptions): PairMarkers {
  const before: MarkerItem[] = [];
  const after: MarkerItem[] = [];
  const alignment = opts.alignment ?? undefined;
  for (const d of damages) {
    const label = badgeLabel(d.status, d.number);
    const onAfter = d.foundPhase === 'after';
    const primary: MarkerItem = { key: d.id, damageId: d.id, status: d.status, role: 'primary', label, ring: d.marker.ring };
    (onAfter ? after : before).push(primary);

    if (!onAfter && !opts.showExistingOnAfter) continue;
    const dir = onAfter ? 'afterToBefore' : 'beforeToAfter';
    const override = d.marker.counterpart;
    const counterpart: MarkerItem = {
      key: `${d.id}:cp`,
      damageId: d.id,
      status: d.status,
      role: 'counterpart',
      label,
      ring: override ?? deriveCounterpart(d.marker.ring, dir, opts.before, opts.after, alignment),
      follow: override ? undefined : { dir, before: opts.before, after: opts.after, alignment },
    };
    (onAfter ? before : after).push(counterpart);
  }
  return { before: sortForDrawing(before), after: sortForDrawing(after) };
}

/** Markers on a single photo (marker editor outside Compare): the damages marked on it. */
export function photoMarkers(damages: MarkedDamage[], phase: Phase): MarkerItem[] {
  return sortForDrawing(
    damages
      .filter((d) => d.foundPhase === phase)
      .map((d) => ({
        key: d.id,
        damageId: d.id,
        status: d.status,
        role: 'primary' as const,
        label: badgeLabel(d.status, d.number),
        ring: d.marker.ring,
      })),
  );
}
