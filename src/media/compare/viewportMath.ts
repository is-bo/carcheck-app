/**
 * Pure helpers for the comparison views ('worklet' so derived values and gestures run them on
 * the UI thread). Built on geometry.ts; no React, no Skia.
 */
import {
  beforeRectInAfter,
  clamp,
  clampViewState,
  containFit,
  imageRectInViewport,
  normRectToRect,
  type Alignment,
  type Point,
  type Rect,
  type Size,
  type ViewState,
} from '../geometry';

/** Zoom above this counts as zoomed (pan enabled, swipe belongs to the photo, not the angle switcher). */
export const ZOOMED_EPSILON = 1.001;

/** Rect of the photo in a pane for the shared view state, clamped for this pane's own geometry. */
export function paneImageRect(view: ViewState, image: Size, pane: Size): Rect {
  'worklet';
  if (pane.width <= 0 || pane.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  return imageRectInViewport(image, pane, clampViewState(view, image, pane));
}

/** BEFORE rect in overlay/slider modes: contain-fitted in the AFTER frame, then the optional nudge. */
export function overlayBeforeRect(before: Size, after: Size, afterRect: Rect, alignment?: Alignment | null): Rect {
  'worklet';
  return normRectToRect(beforeRectInAfter(before, after, alignment ?? undefined), afterRect);
}

export type SideBySideArrangement = 'stacked' | 'sideBySide';

/**
 * Stacked or left|right for the side-by-side mode: whichever shows the smaller of the two
 * photos larger. Landscape photos on a portrait phone stack; on a landscape screen they sit
 * side by side (UX_FLOWS §5), and mixed orientations get the more legible choice.
 */
export function chooseSideBySide(container: Size, before: Size, after: Size, gap: number): SideBySideArrangement {
  if (container.width <= 0 || container.height <= 0) return 'stacked';
  const area = (s: Size, box: Size) => {
    const r = containFit(s, box);
    return r.width * r.height;
  };
  const stackedBox = { width: container.width, height: (container.height - gap) / 2 };
  const sideBox = { width: (container.width - gap) / 2, height: container.height };
  const stacked = Math.min(area(before, stackedBox), area(after, stackedBox));
  const side = Math.min(area(before, sideBox), area(after, sideBox));
  return side > stacked ? 'sideBySide' : 'stacked';
}

/** Overlay opacity from a finger on the track, with a small sticky detent at 50%. */
export function opacityFromTrack(x: number, trackWidth: number, detent: number): number {
  'worklet';
  if (trackWidth <= 0) return 0;
  const v = clamp(x / trackWidth, 0, 1);
  return Math.abs(v - 0.5) <= detent ? 0.5 : v;
}

/** Slider divider as a viewport fraction; kept off the very edge so the handle stays grabbable. */
export function dividerFromX(x: number, width: number, handleRadius: number): number {
  'worklet';
  if (width <= 0) return 0.5;
  const m = Math.min(0.5, handleRadius / width);
  return clamp(x / width, m, 1 - m);
}

/** True when `p` starts on the divider handle (a generous box around the drawn circle). */
export function dividerHandleHit(p: Point, divider: number, pane: Size, halfWidth: number, halfHeight: number): boolean {
  'worklet';
  const x = divider * pane.width;
  const y = pane.height / 2;
  return Math.abs(p.x - x) <= halfWidth && Math.abs(p.y - y) <= halfHeight;
}

/** Left (BEFORE) and right (AFTER) halves of the pane at the divider. */
export function splitAtDivider(divider: number, pane: Size): { left: Rect; right: Rect } {
  'worklet';
  const x = clamp(divider, 0, 1) * pane.width;
  return {
    left: { x: 0, y: 0, width: x, height: pane.height },
    right: { x, y: 0, width: pane.width - x, height: pane.height },
  };
}
