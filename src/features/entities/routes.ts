/**
 * Cross-agent routes this wave links to but does not own (AGENT_RULES §2/§7). Where a sibling
 * feature already publishes its own route builders, we import those directly instead of
 * hardcoding strings, so a path rename on their side can't silently break these screens:
 *  - start flow + rental detail's own href: `@/features/inspection/startFlow`
 *  - return flow + report: `@/features/evidence/returnRoutes`
 * `contractViewer`/`voidContract` have no such module yet (their screens don't exist on disk),
 * so they are coded against the UX_FLOWS §1 inventory paths and flagged in this wave's report.
 */
import type { Href } from 'expo-router';

import type { Id } from '@/domain/types';
import { returnRoutes } from '@/features/evidence/returnRoutes';
import { annotateHref, rentalHref, startEntryHref } from '@/features/inspection/startFlow';

export const crossAgent = {
  /** Settings agent: first-launch agency setup. Rentals home redirects here when unconfigured. */
  onboarding: '/onboarding' as Href,
  /** Start-flow agent: creates a draft and replaces itself with the first step. */
  rentalNew: '/rental/new' as Href,
  /** Start-flow agent's resume entry: lands on the draft's current step, or re-sign after a void. */
  startEntry: startEntryHref,
  /** This wave's own rental detail route, as the start-flow agent's helper spells it. */
  rental: rentalHref,
  /** Marker editor over a BEFORE (or extra) photo. */
  annotate: annotateHref,
  /** Return-flow agent's own entry: starts or resumes the return, landing on the right step. */
  returnEntry: returnRoutes.entry,
  /** Return-flow agent: generation progress -> evidence images and report PDF. */
  report: returnRoutes.report,
  /** Not yet built (UX_FLOWS §1 inventory route; no route builder exists for it yet). */
  contractViewer: (rentalId: Id) => `/rental/${rentalId}/contract` as Href,
  /** Not yet built (UX_FLOWS §1 inventory route; no route builder exists for it yet). */
  voidContract: (rentalId: Id) => `/rental/${rentalId}/void` as Href,
} as const;
