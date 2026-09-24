import {
  beforeRectInAfter,
  clampViewState,
  containFit,
  COUNTERPART_PADDING,
  deriveCounterpart,
  DOUBLE_TAP_ZOOM,
  hitTestMarkers,
  IDENTITY_VIEW,
  imageRectInViewport,
  mapPoint,
  mapRing,
  MAX_ZOOM,
  normRectToRect,
  normToRect,
  normToViewport,
  panBy,
  pinchFrom,
  placeAnchor,
  placeBadge,
  pointsBounds,
  rectToNorm,
  rectToRing,
  ringToRect,
  toggleZoomAt,
  viewportToNorm,
  type Rect,
  type Size,
} from '../geometry';

const LANDSCAPE: Size = { width: 4000, height: 3000 };
const PORTRAIT: Size = { width: 3000, height: 4000 };
const PHONE: Size = { width: 390, height: 600 };

function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

function inside(inner: Rect, outer: Rect, eps = 1e-6) {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  );
}

describe('containFit', () => {
  it('letterboxes wide content and keeps aspect', () => {
    const r = containFit(LANDSCAPE, { width: 1000, height: 1000 });
    expect(r).toEqual({ x: 0, y: 125, width: 1000, height: 750 });
  });

  it('pillarboxes tall content inside an offset box', () => {
    const r = containFit(PORTRAIT, { x: 100, y: 50, width: 1000, height: 600 });
    expect(r.height).toBeCloseTo(600);
    expect(r.width).toBeCloseTo(450);
    expect(r.x).toBeCloseTo(100 + 275);
    expect(r.y).toBeCloseTo(50);
  });
});

describe('normalized <-> rect mapping', () => {
  const rect = { x: 10, y: 20, width: 400, height: 300 };

  it('round-trips points', () => {
    const p = { x: 0.3, y: 0.8 };
    expectPoint(rectToNorm(normToRect(p, rect), rect), p);
  });

  it('maps sub-rects', () => {
    expect(normRectToRect({ x: 0.5, y: 0, width: 0.5, height: 1 }, rect)).toEqual({ x: 210, y: 20, width: 200, height: 300 });
  });

  it('measures ring radius against the short side (circle stays a circle)', () => {
    const land = ringToRect({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0, y: 0, width: 400, height: 300 });
    const port = ringToRect({ x: 0.5, y: 0.5, r: 0.1 }, { x: 0, y: 0, width: 300, height: 400 });
    expect(land.r).toBeCloseTo(30);
    expect(port.r).toBeCloseTo(30);
    const back = rectToRing(land, { x: 0, y: 0, width: 400, height: 300 });
    expect(back.x).toBeCloseTo(0.5);
    expect(back.r).toBeCloseTo(0.1);
  });
});

describe('zoom / pan', () => {
  it('fits the photo at identity view', () => {
    const r = imageRectInViewport(LANDSCAPE, PHONE, IDENTITY_VIEW);
    expect(r.width).toBeCloseTo(390);
    expect(r.height).toBeCloseTo(292.5);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo((600 - 292.5) / 2);
  });

  it('round-trips normalized <-> viewport at any zoom/pan', () => {
    const view = { zoom: 3.2, cx: 0.31, cy: 0.62 };
    const p = { x: 0.27, y: 0.71 };
    expectPoint(viewportToNorm(normToViewport(p, LANDSCAPE, PHONE, view), LANDSCAPE, PHONE, view), p);
  });

  it('shows (cx, cy) at the viewport centre', () => {
    const view = { zoom: 2, cx: 0.4, cy: 0.55 };
    expectPoint(normToViewport({ x: 0.4, y: 0.55 }, LANDSCAPE, PHONE, view), { x: 195, y: 300 });
  });

  it('clamps zoom and keeps the zoomed photo covering the viewport', () => {
    expect(clampViewState({ zoom: 0.5, cx: 0.9, cy: 0.1 }, LANDSCAPE, PHONE)).toEqual(IDENTITY_VIEW);
    expect(clampViewState({ zoom: 50, cx: 0.5, cy: 0.5 }, LANDSCAPE, PHONE).zoom).toBe(MAX_ZOOM);
    const v = clampViewState({ zoom: 4, cx: 5, cy: -5 }, LANDSCAPE, PHONE);
    const r = imageRectInViewport(LANDSCAPE, PHONE, v);
    expect(r.x + r.width).toBeCloseTo(PHONE.width); // pinned to the right edge
    expect(r.y).toBeCloseTo(0); // pinned to the top edge
  });

  it('centres an axis where the zoomed photo is still smaller than the viewport', () => {
    // At zoom 1.5 the landscape photo is 438.75 px tall in a 600 px tall viewport.
    const v = clampViewState({ zoom: 1.5, cx: 0.2, cy: 0.1 }, LANDSCAPE, PHONE);
    expect(v.cy).toBe(0.5);
    expect(v.cx).toBeGreaterThan(0.2);
  });

  it('placeAnchor puts the anchor under the requested point', () => {
    const anchor = { x: 0.6, y: 0.45 };
    const at = { x: 220, y: 310 };
    const v = placeAnchor(3, anchor, at, LANDSCAPE, PHONE);
    expectPoint(normToViewport(anchor, LANDSCAPE, PHONE, v), at);
  });

  it('pinch keeps the photo point under the fingers while they move', () => {
    const start = { zoom: 2, cx: 0.5, cy: 0.5 };
    const startFocal = { x: 200, y: 300 };
    const anchor = viewportToNorm(startFocal, LANDSCAPE, PHONE, start);
    const focal = { x: 190, y: 290 };
    const v = pinchFrom(start, 1.5, startFocal, focal, LANDSCAPE, PHONE);
    expect(v.zoom).toBeCloseTo(3);
    expectPoint(normToViewport(anchor, LANDSCAPE, PHONE, v), focal);
  });

  it('pans by the finger delta', () => {
    const v0 = { zoom: 3, cx: 0.5, cy: 0.5 };
    const p = { x: 0.5, y: 0.5 };
    const before = normToViewport(p, LANDSCAPE, PHONE, v0);
    const v1 = panBy(v0, 30, -20, LANDSCAPE, PHONE);
    const after = normToViewport(p, LANDSCAPE, PHONE, v1);
    expectPoint({ x: after.x - before.x, y: after.y - before.y }, { x: 30, y: -20 });
  });

  it('one shared view state keeps different panels in sync', () => {
    const view = { zoom: 2.5, cx: 0.35, cy: 0.6 };
    const panelA = { width: 390, height: 280 };
    const panelB = { width: 195, height: 560 };
    // Same photo point at the centre of both panels, same zoom relative to each fit.
    expectPoint(viewportToNorm({ x: 195, y: 140 }, LANDSCAPE, panelA, view), { x: 0.35, y: 0.6 });
    expectPoint(viewportToNorm({ x: 97.5, y: 280 }, PORTRAIT, panelB, view), { x: 0.35, y: 0.6 });
  });

  it('double tap zooms in around the tapped point and back out', () => {
    const at = { x: 250, y: 320 };
    const anchor = viewportToNorm(at, LANDSCAPE, PHONE, IDENTITY_VIEW);
    const zoomed = toggleZoomAt(IDENTITY_VIEW, at, LANDSCAPE, PHONE);
    expect(zoomed.zoom).toBe(DOUBLE_TAP_ZOOM);
    expectPoint(normToViewport(anchor, LANDSCAPE, PHONE, zoomed), at);
    expect(toggleZoomAt(zoomed, at, LANDSCAPE, PHONE)).toEqual(IDENTITY_VIEW);
  });
});

describe('BEFORE <-> AFTER correspondence', () => {
  it('is the identity for same-aspect photos without alignment', () => {
    const r = beforeRectInAfter({ width: 2000, height: 1500 }, LANDSCAPE);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
    expect(r.width).toBeCloseTo(1);
    expect(r.height).toBeCloseTo(1);
    expectPoint(mapPoint({ x: 0.2, y: 0.7 }, 'afterToBefore', { width: 2000, height: 1500 }, LANDSCAPE), { x: 0.2, y: 0.7 });
  });

  it('pillarboxes a portrait BEFORE inside a landscape AFTER', () => {
    const r = beforeRectInAfter(PORTRAIT, LANDSCAPE);
    expect(r.height).toBeCloseTo(1);
    expect(r.width).toBeCloseTo(0.5625); // 2250 px of 4000
    expect(r.x).toBeCloseTo((1 - 0.5625) / 2);
  });

  it('applies optional alignment (scale about centre, then offset)', () => {
    const r = beforeRectInAfter(LANDSCAPE, LANDSCAPE, { dx: 0.05, dy: -0.02, scale: 1.1 });
    expect(r.width).toBeCloseTo(1.1);
    expect(r.x).toBeCloseTo(-0.05 + 0.05);
    expect(r.y).toBeCloseTo(-0.05 - 0.02);
  });

  it('round-trips points in both directions', () => {
    const a = { dx: 0.03, dy: 0.01, scale: 0.95 };
    const p = { x: 0.41, y: 0.66 };
    const b = mapPoint(p, 'afterToBefore', PORTRAIT, LANDSCAPE, a);
    expectPoint(mapPoint(b, 'beforeToAfter', PORTRAIT, LANDSCAPE, a), p);
  });

  it('keeps the ring the same physical size across resolution and orientation', () => {
    const ring = { x: 0.5, y: 0.5, r: 0.05 };
    // Same framing at half resolution: identical normalized ring.
    const half = mapRing(ring, 'afterToBefore', { width: 2000, height: 1500 }, LANDSCAPE);
    expect(half.r).toBeCloseTo(0.05);
    // Portrait BEFORE drawn into the landscape AFTER frame: pixel radii must coincide.
    const afterRect = { x: 0, y: 0, width: 800, height: 600 };
    const beforeRect = normRectToRect(beforeRectInAfter(PORTRAIT, LANDSCAPE), afterRect);
    const mapped = mapRing(ring, 'afterToBefore', PORTRAIT, LANDSCAPE);
    expect(ringToRect(mapped, beforeRect).r).toBeCloseTo(ringToRect(ring, afterRect).r);
    expectPoint(
      { x: ringToRect(mapped, beforeRect).cx, y: ringToRect(mapped, beforeRect).cy },
      { x: ringToRect(ring, afterRect).cx, y: ringToRect(ring, afterRect).cy },
    );
    const back = mapRing(mapped, 'beforeToAfter', PORTRAIT, LANDSCAPE);
    expect(back.r).toBeCloseTo(ring.r);
  });

  it('derives a padded counterpart ring', () => {
    const c = deriveCounterpart({ x: 0.3, y: 0.4, r: 0.05 }, 'afterToBefore', LANDSCAPE, LANDSCAPE);
    expect(c.x).toBeCloseTo(0.3);
    expect(c.y).toBeCloseTo(0.4);
    expect(c.r).toBeCloseTo(0.05 * COUNTERPART_PADDING);
  });
});

describe('placeBadge', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 750 };

  it('sits outside the ring, upper-right by default', () => {
    const ring = { cx: 500, cy: 400, r: 60 };
    const p = placeBadge(ring, 20, 5, bounds);
    expect(p.x).toBeGreaterThan(ring.cx);
    expect(p.y).toBeLessThan(ring.cy);
    expect(Math.hypot(p.x - ring.cx, p.y - ring.cy)).toBeCloseTo(60 + 5 + 20);
  });

  it('flips away from the top-right corner and stays inside bounds', () => {
    const ring = { cx: 980, cy: 15, r: 40 };
    const p = placeBadge(ring, 20, 5, bounds);
    expect(p.x).toBeLessThan(ring.cx);
    expect(p.y).toBeGreaterThan(ring.cy);
    expect(inside({ x: p.x - 20, y: p.y - 20, width: 40, height: 40 }, bounds)).toBe(true);
  });

  it('is clamped inside bounds when no diagonal fits', () => {
    const ring = { cx: 50, cy: 50, r: 45 };
    const p = placeBadge(ring, 20, 5, { x: 0, y: 0, width: 100, height: 100 });
    expect(inside({ x: p.x - 20, y: p.y - 20, width: 40, height: 40 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });
});

describe('hitTestMarkers', () => {
  const rect = { x: 0, y: 0, width: 1000, height: 750 };
  // Short side 750: r 0.2 => 150 px, r 0.04 => 30 px.
  const rings = [
    { x: 0.5, y: 0.5, r: 0.2 },
    { x: 0.52, y: 0.52, r: 0.04 },
  ];

  it('prefers the pin of the top-most marker', () => {
    const px = ringToRect(rings[1], rect);
    const pin = placeBadge(px, 20, 4, rect);
    expect(hitTestMarkers(pin, rings, rect, 8, 20, 4)).toEqual({ index: 1, part: 'pin' });
  });

  it('detects ring edges for resizing', () => {
    expect(hitTestMarkers({ x: 500 - 150 - 5, y: 375 }, rings, rect, 10, 20, 4)).toEqual({ index: 0, part: 'edge' });
  });

  it('picks the smallest ring when tapping inside nested rings', () => {
    const px = ringToRect(rings[1], rect);
    expect(hitTestMarkers({ x: px.cx, y: px.cy }, rings, rect, 4, 20, 4)).toEqual({ index: 1, part: 'inside' });
  });

  it('returns null on empty photo area', () => {
    expect(hitTestMarkers({ x: 40, y: 40 }, rings, rect, 10, 20, 4)).toBeNull();
  });
});

describe('pointsBounds', () => {
  it('pads the bounding box and handles empty input', () => {
    expect(pointsBounds([], 4)).toBeNull();
    expect(
      pointsBounds(
        [
          { x: 10, y: 20 },
          { x: 30, y: 5 },
        ],
        2,
      ),
    ).toEqual({ x: 8, y: 3, width: 24, height: 19 });
  });
});
