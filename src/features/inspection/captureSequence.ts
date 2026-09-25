/**
 * Guided capture order (UX §3): the 8 exterior angles in one walk around the car, auto-advancing
 * to the next missing angle after every shot or skip, then the optional dashboard, then done.
 * Pure: the capture screen feeds it what is stored plus what is still being saved.
 */
import { DASHBOARD_ANGLE_KEY, EXTERIOR_ANGLE_KEYS, type AngleKey, type ExteriorAngleKey, type InspectionAngleView } from '@/domain/types';

export interface CaptureProgressState {
  /** Pair keys (slot 1) with a photo, stored or still saving. */
  captured: ReadonlySet<AngleKey>;
  /** Pair keys (slot 1) explicitly skipped. */
  skipped: ReadonlySet<AngleKey>;
}

export type CaptureTarget =
  | { kind: 'angle'; angleKey: ExteriorAngleKey }
  | { kind: 'dashboard' }
  | { kind: 'finish' };

const isDone = (s: CaptureProgressState, k: AngleKey) => s.captured.has(k) || s.skipped.has(k);

export function isExteriorAngle(key: string): key is ExteriorAngleKey {
  return (EXTERIOR_ANGLE_KEYS as readonly string[]).includes(key);
}

/** Exterior angles neither photographed nor skipped, in walk order. */
export function missingAngles(s: CaptureProgressState): ExteriorAngleKey[] {
  return EXTERIOR_ANGLE_KEYS.filter((k) => !isDone(s, k));
}

export function dashboardHandled(s: CaptureProgressState): boolean {
  return isDone(s, DASHBOARD_ANGLE_KEY);
}

function afterExterior(s: CaptureProgressState): CaptureTarget {
  return dashboardHandled(s) ? { kind: 'finish' } : { kind: 'dashboard' };
}

/**
 * Where capture opens: the requested angle (jump from the diagram, retake from Condition),
 * otherwise the next missing angle, otherwise the dashboard prompt.
 */
export function initialTarget(s: CaptureProgressState, requested?: AngleKey | null): CaptureTarget {
  if (requested && isExteriorAngle(requested)) return { kind: 'angle', angleKey: requested };
  if (requested === DASHBOARD_ANGLE_KEY) return { kind: 'dashboard' };
  const next = missingAngles(s)[0];
  if (next) return { kind: 'angle', angleKey: next };
  // Every angle skipped: capture must still end with one outside photo, so open a skipped one.
  const skipped = firstSkippedExterior(s);
  if (skipped && !hasExteriorPhoto(s)) return { kind: 'angle', angleKey: skipped };
  return afterExterior(s);
}

export function hasExteriorPhoto(s: CaptureProgressState): boolean {
  return EXTERIOR_ANGLE_KEYS.some((k) => s.captured.has(k));
}

/** The first skipped exterior angle in walk order (to reopen when no outside photo exists). */
export function firstSkippedExterior(s: CaptureProgressState): ExteriorAngleKey | null {
  return EXTERIOR_ANGLE_KEYS.find((k) => s.skipped.has(k) && !s.captured.has(k)) ?? null;
}

/**
 * After a shot or skip at `current`: the next missing angle further along the walk (wrapping,
 * for employees who started at the rear), then the dashboard, then finish.
 */
export function nextTarget(s: CaptureProgressState, current: ExteriorAngleKey | 'dashboard'): CaptureTarget {
  if (current === 'dashboard') {
    const missing = missingAngles(s)[0];
    return missing ? { kind: 'angle', angleKey: missing } : { kind: 'finish' };
  }
  const start = EXTERIOR_ANGLE_KEYS.indexOf(current);
  for (let i = 1; i <= EXTERIOR_ANGLE_KEYS.length; i++) {
    const k = EXTERIOR_ANGLE_KEYS[(start + i) % EXTERIOR_ANGLE_KEYS.length];
    if (!isDone(s, k)) return { kind: 'angle', angleKey: k };
  }
  return afterExterior(s);
}

/** Progress state from the stored inspection angles (slot 1 only). */
export function progressFromViews(views: readonly InspectionAngleView[]): CaptureProgressState {
  const captured = new Set<AngleKey>();
  const skipped = new Set<AngleKey>();
  for (const v of views) {
    if (v.slot !== 1) continue;
    if (v.photo) captured.add(v.angleKey);
    else if (v.state?.skippedAt) skipped.add(v.angleKey);
  }
  return { captured, skipped };
}

export function withCaptured(s: CaptureProgressState, key: AngleKey): CaptureProgressState {
  const skipped = new Set(s.skipped);
  skipped.delete(key);
  return { captured: new Set(s.captured).add(key), skipped };
}

export function withSkipped(s: CaptureProgressState, key: AngleKey): CaptureProgressState {
  return { captured: s.captured, skipped: new Set(s.skipped).add(key) };
}

/** Diagram states for CarDiagram. */
export function orbitStates(s: CaptureProgressState): Partial<Record<ExteriorAngleKey, 'done' | 'skipped'>> {
  const out: Partial<Record<ExteriorAngleKey, 'done' | 'skipped'>> = {};
  for (const k of EXTERIOR_ANGLE_KEYS) {
    if (s.captured.has(k)) out[k] = 'done';
    else if (s.skipped.has(k)) out[k] = 'skipped';
  }
  return out;
}

/** Required angles done (captured or skipped), for "2 of 8 done". */
export function doneCount(s: CaptureProgressState): number {
  return EXTERIOR_ANGLE_KEYS.filter((k) => isDone(s, k)).length;
}

/** One line under the title tag, per angle (the vehicle's own left/right). */
export const ANGLE_INSTRUCTIONS: Record<ExteriorAngleKey | typeof DASHBOARD_ANGLE_KEY, string> = {
  front: 'Stand in front of the car, centred on the plate. Fit it inside the outline.',
  front_left: 'Stand at the front-left corner so the front and the left side both show.',
  left: 'Stand level with the middle of the car and fit it inside the outline.',
  rear_left: 'Stand at the rear-left corner so the rear and the left side both show.',
  rear: 'Stand behind the car, centred on the plate. Fit it inside the outline.',
  rear_right: 'Stand at the rear-right corner so the rear and the right side both show.',
  right: 'Stand level with the middle of the car and fit it inside the outline.',
  front_right: 'Stand at the front-right corner so the front and the right side both show.',
  dashboard: 'Odometer and fuel gauge. Turn the ignition on so they light up.',
};
