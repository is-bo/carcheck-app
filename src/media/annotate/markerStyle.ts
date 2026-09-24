/**
 * Marker visuals shared by the screen layers and the evidence composer, so what the employee
 * marks is what the exported image shows. Shape carries status, colour reinforces it, dashed
 * means "same area on the other photo" (DECISIONS.md, DESIGN.md "Damage markers").
 */
import { marker, palette } from '@/ui/theme/tokens';

import type { BadgeShape } from '../geometry';
import type { DamageStatus, MarkerRole } from './types';

export interface MarkerVisual {
  shape: BadgeShape;
  /** White badge fill with a coloured border and label. */
  hollow: boolean;
  /** Ring and badge border are dashed (counterparts only). */
  dashed: boolean;
  badgeFill: string;
  badgeBorder: string;
  badgeText: string;
  ringCore: string;
  ringHalo: string;
  /** Thin dark stroke under a white halo so the mark still reads on white paint. */
  ringEdge: string | null;
}

const EDGE = 'rgba(0,0,0,0.45)';

type TokenStatus = keyof typeof marker;

function tokenStatus(status: DamageStatus): TokenStatus {
  return status === 'pre_existing' ? 'existing' : status;
}

export function badgeShapeFor(status: DamageStatus): BadgeShape {
  return marker[tokenStatus(status)].badgeShape;
}

export function markerVisual(status: DamageStatus, role: MarkerRole): MarkerVisual {
  const t = marker[tokenStatus(status)];
  if (role === 'primary') {
    return {
      shape: t.badgeShape,
      hollow: t.hollow,
      dashed: false,
      badgeFill: t.badgeFill,
      badgeBorder: t.badgeBorder,
      badgeText: t.badgeText,
      ringCore: t.ringCore,
      ringHalo: t.ringHalo,
      ringEdge: t.ringHalo === palette.white ? EDGE : null,
    };
  }
  // Reference marks: hollow dashed badge in the status ink. Amber text on white is too faint,
  // so uncertain uses its ink form; existing context is the grey dashed ring of DESIGN.md.
  const ink = status === 'uncertain' ? palette.amberInk : status === 'new' ? palette.vermilion : palette.ink;
  return {
    shape: t.badgeShape,
    hollow: true,
    dashed: true,
    badgeFill: palette.white,
    badgeBorder: ink,
    badgeText: ink,
    ringCore: status === 'pre_existing' ? palette.rule : t.ringCore,
    ringHalo: t.ringHalo,
    ringEdge: t.ringHalo === palette.white ? EDGE : null,
  };
}

/** 1 -> "A", 26 -> "Z", 27 -> "AA" (spreadsheet-style, never runs out). */
export function sequenceLetter(n: number): string {
  let i = Math.max(1, Math.floor(n));
  let out = '';
  while (i > 0) {
    const rem = (i - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    i = Math.floor((i - 1) / 26);
  }
  return out;
}

/** Label without status suffix: letters for pre-existing, numbers for new/uncertain (DECISIONS.md). */
export function markerNumberLabel(status: DamageStatus, n: number): string {
  return status === 'pre_existing' ? sequenceLetter(n) : String(n);
}

/** Text inside the badge: "A", "2", "3?" (uncertain carries "?"). */
export function badgeLabel(status: DamageStatus, n: number): string {
  return markerNumberLabel(status, n) + marker[tokenStatus(status)].suffix;
}
