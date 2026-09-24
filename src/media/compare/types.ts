import type { SkImage } from '@shopify/react-native-skia';

import type { MarkerRole } from '../annotate/types';
import type { Ring, Size } from '../geometry';

/** One side of a pair as the comparison views need it. */
export interface ComparePhoto {
  /** File URI of the display derivative (2048 px); normalized coordinates are aspect-based. */
  uri: string;
  /** Upright pixel size (the original's, or any size with the same aspect). */
  size: Size;
  /** Edge-code timestamp beside the BEFORE/AFTER tag, e.g. "PICK-UP · 12 MAR 09:14". */
  timeLabel?: string;
}

export type CompareMode = 'sideBySide' | 'overlay' | 'slider';

/** Decoded images, loaded once by ComparisonView so switching modes never re-decodes. */
export interface PairImages {
  before: SkImage | null;
  after: SkImage | null;
}

export interface CompareLabels {
  before: string;
  after: string;
}

export const DEFAULT_COMPARE_LABELS: CompareLabels = { before: 'BEFORE', after: 'AFTER' };

/** "Mark new damage" mode: taps map to AFTER coordinates in every comparison mode. */
export interface MarkingHandlers {
  selectedId?: string | null;
  /** Tap on empty AFTER photo area: a new ring at the default size. */
  onDrop?: (ring: Ring) => void;
  /** Tap on a marker (either photo): the screen opens its sheet. */
  onSelect?: (damageId: string) => void;
  /**
   * Move/resize finished. role 'primary' = the damage ring; 'counterpart' = the employee
   * adjusted the dashed "same area" ring (store it as DamageMarker.counterpart).
   */
  onChange?: (damageId: string, ring: Ring, role: MarkerRole) => void;
}
