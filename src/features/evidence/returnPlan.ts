/**
 * Return flow rules over the BEFORE/AFTER pairs (pure; no React, no IO): the capture order, the
 * compare sequence and the completion guard.
 */
import { DASHBOARD_ANGLE_KEY, EXTERIOR_ANGLE_KEYS, type AnglePair, type PairKey } from '@/domain/types';

export const pairId = (k: PairKey): string => `${k.angleKey}#${k.slot}`;

export const samePair = (a: PairKey, b: PairKey): boolean => a.angleKey === b.angleKey && a.slot === b.slot;

export function isExterior(p: Pick<AnglePair, 'angleKey' | 'slot'>): boolean {
  return p.slot === 1 && (EXTERIOR_ANGLE_KEYS as readonly string[]).includes(p.angleKey);
}

// ---------------------------------------------------------------------------------------------
// Capture

export type CaptureTargetState = 'done' | 'skipped' | 'pending';

export interface CaptureTarget extends PairKey {
  label: string;
  /** The 8 exterior angles; the dashboard and pick-up extras are optional. */
  required: boolean;
  state: CaptureTargetState;
  pair: AnglePair;
}

/**
 * Return capture walks the same order as pick-up: the 8 exterior angles, then the dashboard,
 * then every extra photographed at pick-up (same slot, so the pair stays first-class). Extras
 * taken only at return are not listed; they are added from Compare.
 */
export function returnCaptureTargets(pairs: readonly AnglePair[]): CaptureTarget[] {
  const out: CaptureTarget[] = [];
  const state = (p: AnglePair): CaptureTargetState => (p.after ? 'done' : p.afterState?.skippedAt ? 'skipped' : 'pending');
  for (const key of EXTERIOR_ANGLE_KEYS) {
    const pair = pairs.find((p) => p.angleKey === key && p.slot === 1);
    if (pair) out.push({ angleKey: key, slot: 1, label: pair.label, required: true, state: state(pair), pair });
  }
  const dashboard = pairs.find((p) => p.angleKey === DASHBOARD_ANGLE_KEY && p.slot === 1);
  const dashboardPair: AnglePair = dashboard ?? {
    angleKey: DASHBOARD_ANGLE_KEY,
    slot: 1,
    label: 'Dashboard',
    group: 'dashboard',
    before: null,
    after: null,
    beforeState: null,
    afterState: null,
    existingDamageCount: 0,
    newDamageCount: 0,
    uncertainDamageCount: 0,
  };
  out.push({ angleKey: DASHBOARD_ANGLE_KEY, slot: 1, label: dashboardPair.label, required: false, state: state(dashboardPair), pair: dashboardPair });
  for (const pair of pairs) {
    if (pair.group !== 'extra' || !pair.before) continue;
    out.push({ angleKey: pair.angleKey, slot: pair.slot, label: pair.label, required: false, state: state(pair), pair });
  }
  return out;
}

/**
 * Where capture goes after `fromIndex` (or at open when null): the next pending target after
 * it, else the first pending one anywhere. Null when every target is done or skipped.
 */
export function nextCaptureIndex(targets: readonly CaptureTarget[], fromIndex: number | null): number | null {
  const start = fromIndex === null ? 0 : fromIndex + 1;
  for (let i = start; i < targets.length; i++) if (targets[i].state === 'pending') return i;
  for (let i = 0; i < Math.min(start, targets.length); i++) if (targets[i].state === 'pending') return i;
  return null;
}

/** UX §3: at least one exterior photo is required to leave capture. */
export function hasExteriorReturnPhoto(pairs: readonly AnglePair[]): boolean {
  return pairs.some((p) => isExterior(p) && p.after !== null);
}

// ---------------------------------------------------------------------------------------------
// Compare

/** The 8 exterior angles always, then every other pair photographed in either phase. */
export function compareSequence(pairs: readonly AnglePair[]): AnglePair[] {
  return pairs.filter((p) => isExterior(p) || p.before !== null || p.after !== null);
}

export type CompareAngleStatus =
  /** Both photos present, viewed in Compare. */
  | 'reviewed'
  /** AFTER present, not viewed yet. */
  | 'unreviewed'
  /** Explicitly skipped at return. */
  | 'skipped'
  /** Exterior angle neither photographed at return nor skipped: blocks completion. */
  | 'missing'
  /** Optional angle (dashboard, extra) not photographed at return. */
  | 'optional';

export function compareStatus(p: AnglePair): CompareAngleStatus {
  if (p.after) return p.afterState?.reviewedAt ? 'reviewed' : 'unreviewed';
  if (p.afterState?.skippedAt) return 'skipped';
  return isExterior(p) ? 'missing' : 'optional';
}

export function hasNewDamage(p: Pick<AnglePair, 'newDamageCount' | 'uncertainDamageCount'>): boolean {
  return p.newDamageCount + p.uncertainDamageCount > 0;
}

// ---------------------------------------------------------------------------------------------
// Completion guard

export interface ReturnReadiness {
  /** Pairs with a return photo (what "angles compared" counts). */
  comparable: number;
  reviewed: number;
  /** Outside angles photographed at return but never viewed in Compare. */
  unreviewed: AnglePair[];
  /** Exterior angles neither photographed nor skipped at return. */
  missing: AnglePair[];
  newCount: number;
  uncertainCount: number;
  hasExteriorPhoto: boolean;
  /** Every angle reviewed or explicitly skipped, and at least one exterior photo. */
  canComplete: boolean;
}

export function returnReadiness(pairs: readonly AnglePair[]): ReturnReadiness {
  const seq = compareSequence(pairs);
  const unreviewed: AnglePair[] = [];
  const missing: AnglePair[] = [];
  let comparable = 0;
  let reviewed = 0;
  for (const p of seq) {
    const status = compareStatus(p);
    if (p.after) comparable += 1;
    if (status === 'reviewed') reviewed += 1;
    // Optional shots (dashboard, extras) never hold up completion: only outside angles must be viewed.
    else if (status === 'unreviewed' && isExterior(p)) unreviewed.push(p);
    else if (status === 'missing') missing.push(p);
  }
  const hasExteriorPhoto = hasExteriorReturnPhoto(pairs);
  return {
    comparable,
    reviewed,
    unreviewed,
    missing,
    newCount: pairs.reduce((n, p) => n + p.newDamageCount, 0),
    uncertainCount: pairs.reduce((n, p) => n + p.uncertainDamageCount, 0),
    hasExteriorPhoto,
    canComplete: hasExteriorPhoto && unreviewed.length === 0 && missing.length === 0,
  };
}

/** "3 new · 1 uncertain · 8 of 8 angles compared" (UX §6). */
export function readinessSummary(r: ReturnReadiness): string {
  const parts: string[] = [];
  if (r.newCount > 0) parts.push(`${r.newCount} new`);
  if (r.uncertainCount > 0) parts.push(`${r.uncertainCount} uncertain`);
  if (parts.length === 0) parts.push('No new damage');
  parts.push(`${r.reviewed} of ${r.comparable} ${r.comparable === 1 ? 'angle' : 'angles'} compared`);
  return parts.join(' · ');
}

/** "Rear, Rear right and Left" for guard copy. */
export function listLabels(pairs: readonly Pick<AnglePair, 'label'>[]): string {
  const labels = pairs.map((p) => p.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
