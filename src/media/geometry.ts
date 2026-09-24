/**
 * Coordinate model shared by capture, marking, comparison modes and evidence composition.
 *
 * NORMALIZED space: (0,0) = top-left, (1,1) = bottom-right of the ORIGINAL upright photo;
 * x is relative to photo width, y to photo height. Ring radii are relative to the photo's
 * SHORT side, so a ring stays a circle under every uniform scale (screen, zoom, export).
 *
 * Every function is pure and marked 'worklet' so gesture handlers can call it on the UI thread
 * (in Jest / on the JS thread the directive is an inert string statement).
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A damage marker ring in normalized photo coordinates; `r` is a fraction of the photo's short side. */
export interface Ring {
  x: number;
  y: number;
  r: number;
}

/** A ring in pixel space (screen or output canvas). */
export interface PxRing {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Marker geometry persisted as JSON on a damage row. The photo ids live in DB columns; this
 * blob only holds geometry, never pixels.
 */
export interface DamageMarker {
  v: 1;
  /** Ring on the photo the damage was marked on (AFTER for new/uncertain, BEFORE for existing). */
  ring: Ring;
  /** Employee-adjusted ring on the paired photo. Absent = derive with deriveCounterpart(). */
  counterpart?: Ring;
}

export const MARKER_SCHEMA_VERSION = 1;
/** Radius of a freshly dropped ring, as a fraction of the photo's short side. */
export const DEFAULT_RING_RADIUS = 0.06;
export const MIN_RING_RADIUS = 0.015;
export const MAX_RING_RADIUS = 0.5;
/** Derived rings on the paired photo are slightly larger so they frame the spot instead of covering it. */
export const COUNTERPART_PADDING = 1.15;

/**
 * Zoom/pan of one photo inside a viewport, independent of viewport and photo resolution:
 * `zoom` is relative to contain-fit (1 = whole photo visible) and (cx, cy) is the normalized
 * photo point at the viewport centre. Two panels sharing one ViewState stay in sync even when
 * the panels or the photos differ in size or orientation.
 */
export interface ViewState {
  zoom: number;
  cx: number;
  cy: number;
}

export const IDENTITY_VIEW: ViewState = { zoom: 1, cx: 0.5, cy: 0.5 };
export const MAX_ZOOM = 6;
export const DOUBLE_TAP_ZOOM = 2.5;

/**
 * Optional BEFORE->AFTER alignment for overlay/slider (nudge UI is deferred; the field is
 * optional everywhere). The BEFORE photo is contain-fitted into the AFTER frame, scaled by
 * `scale` about its centre, then offset by (dx, dy) in AFTER-normalized units.
 */
export interface Alignment {
  dx: number;
  dy: number;
  scale: number;
}

export const IDENTITY_ALIGNMENT: Alignment = { dx: 0, dy: 0, scale: 1 };

// ---------------------------------------------------------------------------------------------
// Rect mapping

export function clamp(v: number, min: number, max: number): number {
  'worklet';
  return v < min ? min : v > max ? max : v;
}

/** Largest rect with `content`'s aspect ratio inside `box`, centred. */
export function containFit(content: Size, box: Size & Partial<Point>): Rect {
  'worklet';
  const s = Math.min(box.width / content.width, box.height / content.height);
  const width = content.width * s;
  const height = content.height * s;
  return {
    x: (box.x ?? 0) + (box.width - width) / 2,
    y: (box.y ?? 0) + (box.height - height) / 2,
    width,
    height,
  };
}

/** Normalized photo point -> position inside the rect the whole photo occupies (any pixel space). */
export function normToRect(p: Point, rect: Rect): Point {
  'worklet';
  return { x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height };
}

/** Inverse of normToRect. May fall outside 0..1 when q is outside the photo. */
export function rectToNorm(q: Point, rect: Rect): Point {
  'worklet';
  return { x: (q.x - rect.x) / rect.width, y: (q.y - rect.y) / rect.height };
}

/** Normalized sub-rect -> pixel rect inside `rect` (e.g. the BEFORE layer inside the AFTER rect). */
export function normRectToRect(n: Rect, rect: Rect): Rect {
  'worklet';
  return {
    x: rect.x + n.x * rect.width,
    y: rect.y + n.y * rect.height,
    width: n.width * rect.width,
    height: n.height * rect.height,
  };
}

/** Normalized ring -> pixel ring inside the rect the whole photo occupies. */
export function ringToRect(ring: Ring, rect: Rect): PxRing {
  'worklet';
  return {
    cx: rect.x + ring.x * rect.width,
    cy: rect.y + ring.y * rect.height,
    r: ring.r * Math.min(rect.width, rect.height),
  };
}

/** Pixel ring -> normalized ring (inverse of ringToRect), e.g. after a drag/resize gesture. */
export function rectToRing(px: PxRing, rect: Rect): Ring {
  'worklet';
  return {
    x: (px.cx - rect.x) / rect.width,
    y: (px.cy - rect.y) / rect.height,
    r: px.r / Math.min(rect.width, rect.height),
  };
}

// ---------------------------------------------------------------------------------------------
// Zoom / pan inside a viewport (contain-fit at zoom 1)

/** Rect of the whole photo in viewport coordinates for a view state. */
export function imageRectInViewport(image: Size, viewport: Size, view: ViewState): Rect {
  'worklet';
  const s = Math.min(viewport.width / image.width, viewport.height / image.height) * view.zoom;
  const width = image.width * s;
  const height = image.height * s;
  return {
    x: viewport.width / 2 - view.cx * width,
    y: viewport.height / 2 - view.cy * height,
    width,
    height,
  };
}

export function normToViewport(p: Point, image: Size, viewport: Size, view: ViewState): Point {
  'worklet';
  return normToRect(p, imageRectInViewport(image, viewport, view));
}

export function viewportToNorm(q: Point, image: Size, viewport: Size, view: ViewState): Point {
  'worklet';
  return rectToNorm(q, imageRectInViewport(image, viewport, view));
}

/**
 * Clamp zoom to [1, maxZoom]; on each axis keep the photo covering the viewport when it is
 * larger than the viewport, and centre it when it is smaller.
 */
export function clampViewState(view: ViewState, image: Size, viewport: Size, maxZoom: number = MAX_ZOOM): ViewState {
  'worklet';
  const zoom = clamp(view.zoom, 1, maxZoom);
  const s = Math.min(viewport.width / image.width, viewport.height / image.height) * zoom;
  const w = image.width * s;
  const h = image.height * s;
  const halfX = viewport.width / 2 / w;
  const halfY = viewport.height / 2 / h;
  return {
    zoom,
    cx: w <= viewport.width ? 0.5 : clamp(view.cx, halfX, 1 - halfX),
    cy: h <= viewport.height ? 0.5 : clamp(view.cy, halfY, 1 - halfY),
  };
}

/**
 * View state at `zoom` that puts normalized photo point `anchor` under viewport point `at`
 * (then clamped). Pan, pinch and double-tap are all expressed through this one primitive.
 */
export function placeAnchor(
  zoom: number,
  anchor: Point,
  at: Point,
  image: Size,
  viewport: Size,
  maxZoom: number = MAX_ZOOM,
): ViewState {
  'worklet';
  const z = clamp(zoom, 1, maxZoom);
  const s = Math.min(viewport.width / image.width, viewport.height / image.height) * z;
  const cx = anchor.x - (at.x - viewport.width / 2) / (image.width * s);
  const cy = anchor.y - (at.y - viewport.height / 2) / (image.height * s);
  return clampViewState({ zoom: z, cx, cy }, image, viewport, maxZoom);
}

/** Pan by a screen-space finger delta. */
export function panBy(view: ViewState, dx: number, dy: number, image: Size, viewport: Size): ViewState {
  'worklet';
  const r = imageRectInViewport(image, viewport, view);
  return clampViewState({ zoom: view.zoom, cx: view.cx - dx / r.width, cy: view.cy - dy / r.height }, image, viewport);
}

/**
 * Combined pinch + pan measured from gesture start: the photo point that was under
 * `startFocal` follows the current `focal`, at `start.zoom * scale`.
 */
export function pinchFrom(
  start: ViewState,
  scale: number,
  startFocal: Point,
  focal: Point,
  image: Size,
  viewport: Size,
  maxZoom: number = MAX_ZOOM,
): ViewState {
  'worklet';
  const anchor = viewportToNorm(startFocal, image, viewport, start);
  return placeAnchor(start.zoom * scale, anchor, focal, image, viewport, maxZoom);
}

/** Double tap: zoom to DOUBLE_TAP_ZOOM keeping the tapped point under the finger, or back to fit. */
export function toggleZoomAt(view: ViewState, at: Point, image: Size, viewport: Size): ViewState {
  'worklet';
  if (view.zoom > 1.01) return IDENTITY_VIEW;
  return placeAnchor(DOUBLE_TAP_ZOOM, viewportToNorm(at, image, viewport, view), at, image, viewport);
}

// ---------------------------------------------------------------------------------------------
// BEFORE <-> AFTER correspondence

/**
 * Rect (in AFTER-normalized coordinates) where the BEFORE photo is drawn in overlay/slider
 * modes. Equal aspect + no alignment gives exactly {0, 0, 1, 1}; a portrait BEFORE under a
 * landscape AFTER is pillarboxed inside the AFTER frame.
 */
export function beforeRectInAfter(before: Size, after: Size, alignment?: Alignment): Rect {
  'worklet';
  const a = alignment ?? IDENTITY_ALIGNMENT;
  const base = containFit(before, after);
  const bw = base.width / after.width;
  const bh = base.height / after.height;
  const w = bw * a.scale;
  const h = bh * a.scale;
  return {
    x: base.x / after.width + (bw - w) / 2 + a.dx,
    y: base.y / after.height + (bh - h) / 2 + a.dy,
    width: w,
    height: h,
  };
}

export type MapDirection = 'afterToBefore' | 'beforeToAfter';

/** Map a normalized point between the paired photos. */
export function mapPoint(p: Point, dir: MapDirection, before: Size, after: Size, alignment?: Alignment): Point {
  'worklet';
  const r = beforeRectInAfter(before, after, alignment);
  return dir === 'afterToBefore' ? rectToNorm(p, r) : normToRect(p, r);
}

/** Map a ring between the paired photos, preserving its physical size on the car. */
export function mapRing(ring: Ring, dir: MapDirection, before: Size, after: Size, alignment?: Alignment): Ring {
  'worklet';
  const rect = beforeRectInAfter(before, after, alignment);
  const c = dir === 'afterToBefore' ? rectToNorm(ring, rect) : normToRect(ring, rect);
  // BEFORE pixels per AFTER pixel when BEFORE is drawn into the AFTER frame.
  const f = before.width / (rect.width * after.width);
  const minA = Math.min(after.width, after.height);
  const minB = Math.min(before.width, before.height);
  const r = dir === 'afterToBefore' ? (ring.r * minA * f) / minB : (ring.r * minB) / f / minA;
  return { x: c.x, y: c.y, r };
}

/**
 * Default "same area" ring on the paired photo: same spot through the (optional) alignment,
 * padded so it frames rather than covers. Used unless the employee stored an override.
 */
export function deriveCounterpart(
  ring: Ring,
  dir: MapDirection,
  before: Size,
  after: Size,
  alignment?: Alignment,
): Ring {
  'worklet';
  const m = mapRing(ring, dir, before, after, alignment);
  return { x: m.x, y: m.y, r: m.r * COUNTERPART_PADDING };
}

// ---------------------------------------------------------------------------------------------
// Marker placement and hit testing (pixel space)

function circleInside(cx: number, cy: number, r: number, b: Rect): boolean {
  'worklet';
  return cx - r >= b.x && cy - r >= b.y && cx + r <= b.x + b.width && cy + r <= b.y + b.height;
}

/**
 * Centre of the number pin for a pixel ring: outside the ring on a diagonal (upper-right
 * first, then upper-left, lower-right, lower-left) so the pin never covers the damage, and
 * always fully inside `bounds` (normally the photo rect) so it is never clipped.
 */
export function placeBadge(ring: PxRing, radius: number, gap: number, bounds: Rect): Point {
  'worklet';
  const d = Math.SQRT1_2 * (ring.r + gap + radius);
  const candidates = [
    [d, -d],
    [-d, -d],
    [d, d],
    [-d, d],
  ];
  for (let i = 0; i < candidates.length; i++) {
    const x = ring.cx + candidates[i][0];
    const y = ring.cy + candidates[i][1];
    if (circleInside(x, y, radius, bounds)) return { x, y };
  }
  return {
    x: clamp(ring.cx + d, bounds.x + radius, Math.max(bounds.x + radius, bounds.x + bounds.width - radius)),
    y: clamp(ring.cy - d, bounds.y + radius, Math.max(bounds.y + radius, bounds.y + bounds.height - radius)),
  };
}

/** Badge shape encodes damage status (DECISIONS.md): square = pre-existing, circle = new, diamond = uncertain. */
export type BadgeShape = 'circle' | 'square' | 'diamond';

/**
 * Half-size of a badge drawn for nominal radius `r`: the circle's radius, the square's
 * half-side, the diamond's half-diagonal. Tuned so the three shapes read as the same weight.
 */
export function badgeHalfSize(shape: BadgeShape, r: number): number {
  'worklet';
  return shape === 'square' ? r * 0.86 : shape === 'diamond' ? r * 1.2 : r;
}

/** Radius of the circle enclosing the badge: pass it to placeBadge so every shape stays inside bounds. */
export function badgeExtent(shape: BadgeShape, r: number): number {
  'worklet';
  return shape === 'square' ? r * 0.86 * Math.SQRT2 : shape === 'diamond' ? r * 1.2 : r;
}

export type MarkerPart = 'pin' | 'edge' | 'inside';

export interface MarkerHit {
  index: number;
  part: MarkerPart;
}

/**
 * What is under point `p` (same pixel space as `rect`, the photo rect): a pin (move), a ring
 * edge (resize) or a ring interior (select/move). Pins beat edges beat interiors; among pins
 * and edges the top-most (last) marker wins; among interiors the smallest ring wins so nested
 * rings stay reachable.
 */
export function hitTestMarkers(
  p: Point,
  rings: Ring[],
  rect: Rect,
  tolerancePx: number,
  pinRadiusPx: number,
  pinGapPx: number,
): MarkerHit | null {
  'worklet';
  for (let i = rings.length - 1; i >= 0; i--) {
    const px = ringToRect(rings[i], rect);
    const pin = placeBadge(px, pinRadiusPx, pinGapPx, rect);
    if (Math.hypot(p.x - pin.x, p.y - pin.y) <= pinRadiusPx + tolerancePx) return { index: i, part: 'pin' };
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const px = ringToRect(rings[i], rect);
    if (Math.abs(Math.hypot(p.x - px.cx, p.y - px.cy) - px.r) <= tolerancePx) return { index: i, part: 'edge' };
  }
  let best = -1;
  let bestR = Infinity;
  for (let i = 0; i < rings.length; i++) {
    const px = ringToRect(rings[i], rect);
    if (Math.hypot(p.x - px.cx, p.y - px.cy) < px.r && px.r < bestR) {
      best = i;
      bestR = px.r;
    }
  }
  return best >= 0 ? { index: best, part: 'inside' } : null;
}

/** Bounding box of points grown by `pad` (signature trimming: pad = half stroke + margin). */
export function pointsBounds(points: Point[], pad: number): Rect | null {
  'worklet';
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}
