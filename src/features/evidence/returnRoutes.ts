/**
 * Routes of the return flow and the report (UX_FLOWS §1 inventory). Other screens link here:
 * `returnRoutes.entry(id)` starts or resumes a return, `returnRoutes.report(id)` opens the
 * return report of a completed rental.
 */
import type { Href } from 'expo-router';

import type { Id, PairKey } from '@/domain/types';

function angleQuery(key?: PairKey | null): string {
  if (!key) return '';
  return key.slot > 1 ? `?angle=${encodeURIComponent(key.angleKey)}&slot=${key.slot}` : `?angle=${encodeURIComponent(key.angleKey)}`;
}

export const returnRoutes = {
  /** Start or resume: starts the return if needed, then lands on the right step. */
  entry: (rentalId: Id) => `/rental/${rentalId}/return` as Href,
  capture: (rentalId: Id, key?: PairKey | null) => `/rental/${rentalId}/return/capture${angleQuery(key)}` as Href,
  compare: (rentalId: Id, key?: PairKey | null) => `/rental/${rentalId}/return/compare${angleQuery(key)}` as Href,
  details: (rentalId: Id) => `/rental/${rentalId}/return/details` as Href,
  /** Generation progress, then evidence images and the report PDF. */
  report: (rentalId: Id) => `/rental/${rentalId}/report` as Href,
  rental: (rentalId: Id) => `/rental/${rentalId}` as Href,
} as const;

/** `?angle=front_left&slot=2` -> pair key (slot defaults to 1). */
export function pairKeyFromParams(angle: string | string[] | undefined, slot: string | string[] | undefined): PairKey | null {
  const a = Array.isArray(angle) ? angle[0] : angle;
  if (!a) return null;
  const s = Number(Array.isArray(slot) ? slot[0] : slot);
  return { angleKey: a, slot: Number.isInteger(s) && s > 1 ? s : 1 };
}
