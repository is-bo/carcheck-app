/**
 * Screen-space marker math for the live layers and the editor. Pure and 'worklet' so gesture
 * handlers and derived values run it on the UI thread; render and hit testing share these
 * functions, so a badge is grabbed exactly where it is drawn.
 */
import { markerGeometry } from '@/ui/theme/tokens';

import {
  badgeExtent,
  clamp,
  DEFAULT_RING_RADIUS,
  deriveCounterpart,
  MAX_RING_RADIUS,
  MIN_RING_RADIUS,
  placeBadge,
  ringToRect,
  type BadgeShape,
  type MarkerPart,
  type Point,
  type PxRing,
  type Rect,
  type Ring,
  type Size,
} from '../geometry';
import type { LiveRing, MarkerItem } from './types';

export interface ScreenMarkerMetrics {
  /** Nominal badge radius in dp (DESIGN: 26 dp badge). */
  badgeRadius: number;
  /** Gap between the ring stroke and the badge. */
  badgeGap: number;
  /** Rings never draw smaller than this, so tiny marks stay visible and grabbable. */
  minRingRadius: number;
  /** Full touch target (dp) around badges and ring edges. */
  hitSlop: number;
  ringCore: number;
  ringHalo: number;
  badgeBorder: number;
}

export const SCREEN_MARKER_METRICS: ScreenMarkerMetrics = {
  badgeRadius: markerGeometry.badgeSize / 2,
  badgeGap: markerGeometry.ringHalo / 2 + 1,
  minRingRadius: markerGeometry.ringMinRadius,
  hitSlop: markerGeometry.hitSlop,
  ringCore: markerGeometry.ringCore,
  ringHalo: markerGeometry.ringHalo,
  badgeBorder: markerGeometry.badgeBorder,
};

export function intersectRect(a: Rect, b: Rect): Rect {
  'worklet';
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bt = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, r - x), height: Math.max(0, bt - y) };
}

/** Normalized ring -> pixel ring, never smaller than `minR`. */
export function screenRing(ring: Ring, rect: Rect, minR: number): PxRing {
  'worklet';
  const px = ringToRect(ring, rect);
  return { cx: px.cx, cy: px.cy, r: Math.max(px.r, minR) };
}

/** Badge centre for a pixel ring: outside the ring on a diagonal, fully inside `bounds` (border included). */
export function badgeCentre(px: PxRing, shape: BadgeShape, m: ScreenMarkerMetrics, bounds: Rect): Point {
  'worklet';
  const k = m.badgeBorder / 2 + 1;
  const inner = { x: bounds.x + k, y: bounds.y + k, width: bounds.width - 2 * k, height: bounds.height - 2 * k };
  return placeBadge(px, badgeExtent(shape, m.badgeRadius), m.badgeGap, inner);
}

/** Resize-handle position: on the ring, opposite the badge, so the two never collide. */
export function resizeHandlePoint(px: PxRing, badge: Point): Point {
  'worklet';
  const dx = px.cx - badge.x;
  const dy = px.cy - badge.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: px.cx - px.r, y: px.cy };
  return { x: px.cx + (dx / len) * px.r, y: px.cy + (dy / len) * px.r };
}

export interface HitItem {
  ring: Ring;
  shape: BadgeShape;
}

export interface ScreenHit {
  index: number;
  part: MarkerPart;
}

/**
 * What is under `p` (screen px): a badge (move), a ring edge (resize) or a ring interior
 * (select/move). Badges beat edges beat interiors; the top-most (last) wins for badges and
 * edges, the smallest ring for interiors. The edge band reaches half the hit slop outside the
 * ring but at most half the radius inside, so the interior of a small ring still moves it.
 */
export function hitTestScreenMarkers(
  p: Point,
  items: HitItem[],
  rect: Rect,
  bounds: Rect,
  m: ScreenMarkerMetrics,
): ScreenHit | null {
  'worklet';
  const slop = m.hitSlop / 2;
  for (let i = items.length - 1; i >= 0; i--) {
    const px = screenRing(items[i].ring, rect, m.minRingRadius);
    const b = badgeCentre(px, items[i].shape, m, bounds);
    const reach = Math.max(slop, badgeExtent(items[i].shape, m.badgeRadius));
    if (Math.hypot(p.x - b.x, p.y - b.y) <= reach) return { index: i, part: 'pin' };
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const px = screenRing(items[i].ring, rect, m.minRingRadius);
    const d = Math.hypot(p.x - px.cx, p.y - px.cy) - px.r;
    if (d <= slop && d >= -Math.min(slop, px.r * 0.5)) return { index: i, part: 'edge' };
  }
  let best = -1;
  let bestR = Infinity;
  for (let i = 0; i < items.length; i++) {
    const px = screenRing(items[i].ring, rect, m.minRingRadius);
    if (Math.hypot(p.x - px.cx, p.y - px.cy) < px.r && px.r < bestR) {
      best = i;
      bestR = px.r;
    }
  }
  return best >= 0 ? { index: best, part: 'inside' } : null;
}

/** Move a ring by a screen delta; the centre stays on the photo. */
export function moveRing(start: Ring, dx: number, dy: number, rect: Rect): Ring {
  'worklet';
  return {
    x: clamp(start.x + dx / rect.width, 0, 1),
    y: clamp(start.y + dy / rect.height, 0, 1),
    r: start.r,
  };
}

/** Resize by dragging the edge: the radius changes by how far the finger moved from/toward the centre. */
export function resizeRing(start: Ring, startDist: number, dist: number, rect: Rect): Ring {
  'worklet';
  const r = start.r + (dist - startDist) / Math.min(rect.width, rect.height);
  return { x: start.x, y: start.y, r: clamp(r, MIN_RING_RADIUS, MAX_RING_RADIUS) };
}

/** Resize by pinching a selected ring. */
export function scaleRing(start: Ring, scale: number): Ring {
  'worklet';
  return { x: start.x, y: start.y, r: clamp(start.r * scale, MIN_RING_RADIUS, MAX_RING_RADIUS) };
}

/** Fresh ring for a tap at normalized point `p`, or null when the tap is outside the photo. */
export function dropRing(p: Point): Ring | null {
  'worklet';
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  return { x: p.x, y: p.y, r: DEFAULT_RING_RADIUS };
}

/** The ring a layer should draw for `item` given the ring being dragged right now (if any). */
export function resolveRing(item: MarkerItem, live: LiveRing | null): Ring {
  'worklet';
  if (live !== null && live.damageId === item.damageId) {
    if (live.role === item.role) return live.ring;
    if (item.follow && live.role === 'primary') {
      const f = item.follow;
      return deriveCounterpart(live.ring, f.dir, f.before, f.after, f.alignment);
    }
  }
  return item.ring;
}

/**
 * Loupe centre for a finger at `p`: offset up-left (DESIGN), mirrored to the right near the
 * left edge and below the finger near the top, always fully inside the pane.
 */
export function loupeCentre(p: Point, pane: Size, diameter: number, offset: Point): Point {
  'worklet';
  const r = diameter / 2;
  let x = p.x + offset.x;
  let y = p.y + offset.y;
  if (x - r < 0) x = p.x - offset.x;
  if (y - r < 0) y = p.y - offset.y;
  return {
    x: clamp(x, r, Math.max(r, pane.width - r)),
    y: clamp(y, r, Math.max(r, pane.height - r)),
  };
}
