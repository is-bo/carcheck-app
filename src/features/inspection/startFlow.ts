/**
 * START flow map (UX §2): five steps over seven routes, and where Resume lands. Pure.
 *
 *   1 Vehicle  -> start/vehicle
 *   2 Customer -> start/customer
 *   3 Inspect  -> start/capture (camera) -> start/condition (grid, marking)
 *   4 Details  -> start/details
 *   5 Sign     -> start/contract (employee review) -> start/sign (customer hand-off)
 */
import type { Href } from 'expo-router';

import { START_STEPS, type StartStep } from '@/domain/rentalLifecycle';
import type { Id, ResumeStep } from '@/domain/types';

export type StartRoute = 'vehicle' | 'customer' | 'capture' | 'condition' | 'details' | 'contract' | 'sign';

export const START_ROUTE_STEP: Record<StartRoute, StartStep> = {
  vehicle: 'vehicle',
  customer: 'customer',
  capture: 'inspect',
  condition: 'inspect',
  details: 'details',
  contract: 'sign',
  sign: 'sign',
};

/** 1-based step number for the stepper ("3 of 5"). */
export function stepNumber(route: StartRoute): number {
  return START_STEPS.indexOf(START_ROUTE_STEP[route]) + 1;
}

/** What Resume stores for each route. An unsigned hand-off resumes at the employee review (UX §10). */
export function resumeStepFor(route: StartRoute): ResumeStep {
  return route === 'sign' ? 'contract' : route;
}

/** Route for a stored resume step (start steps only; return steps map to null). */
export function routeForResume(step: ResumeStep | null): StartRoute | null {
  switch (step) {
    case 'vehicle':
    case 'customer':
    case 'capture':
    case 'condition':
    case 'details':
    case 'contract':
      return step;
    case 'sign':
      return 'contract';
    default:
      return null;
  }
}

/** Jump target of a step in the step sheet. Inspect opens the grid once something was captured. */
export function routeForStep(step: StartStep, hasBeforePhotos: boolean): StartRoute {
  switch (step) {
    case 'vehicle':
    case 'customer':
    case 'details':
      return step;
    case 'inspect':
      return hasBeforePhotos ? 'condition' : 'capture';
    case 'sign':
      return 'contract';
  }
}

export function startHref(rentalId: Id, route: StartRoute, params?: Record<string, string | number | undefined>): Href {
  const query = Object.entries(params ?? {})
    .filter((e): e is [string, string | number] => e[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `/rental/${rentalId}/start/${route}${query ? `?${query}` : ''}` as Href;
}

/** Entry for Resume buttons elsewhere: resolves the right step (start/index). */
export function startEntryHref(rentalId: Id): Href {
  return `/rental/${rentalId}/start` as Href;
}

export function annotateHref(rentalId: Id, photoId: Id): Href {
  return `/rental/${rentalId}/annotate/${photoId}` as Href;
}

/** Root-stack route name of app/rental/[id]/index.tsx (to recognise it under a flow). */
export const RENTAL_DETAIL_ROUTE = 'rental/[id]/index';

export function rentalHref(rentalId: Id): Href {
  return `/rental/${rentalId}` as Href;
}
