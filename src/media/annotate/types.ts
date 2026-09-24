import type { DamageStatus } from '@/domain/types';

import type { Alignment, MapDirection, Ring, Size } from '../geometry';

export type { DamageStatus };

/** primary = the damage on the photo it was marked on; counterpart = "same area" on the paired photo. */
export type MarkerRole = 'primary' | 'counterpart';

/** How a derived counterpart follows its primary ring while that ring is being dragged. */
export interface CounterpartFollow {
  dir: MapDirection;
  before: Size;
  after: Size;
  alignment?: Alignment;
}

/** One marker drawn on one photo, in normalized coordinates of that photo. */
export interface MarkerItem {
  /** Unique within a layer. */
  key: string;
  damageId: string;
  status: DamageStatus;
  role: MarkerRole;
  /** Badge text including the status suffix ("A", "2", "3?"); see markerStyle.badgeLabel. */
  label: string;
  ring: Ring;
  /** Set on derived counterparts (no stored override) so they track live drags of the primary. */
  follow?: CounterpartFollow;
}

/** A ring being dragged/resized right now (UI thread); layers draw it instead of the stored ring. */
export interface LiveRing {
  damageId: string;
  role: MarkerRole;
  ring: Ring;
}
