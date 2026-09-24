import { badgeExtent, DEFAULT_RING_RADIUS, deriveCounterpart, MAX_RING_RADIUS, MIN_RING_RADIUS, type Rect } from '../../geometry';
import {
  badgeCentre,
  dropRing,
  hitTestScreenMarkers,
  intersectRect,
  loupeCentre,
  moveRing,
  resizeHandlePoint,
  resizeRing,
  resolveRing,
  scaleRing,
  SCREEN_MARKER_METRICS as M,
  screenRing,
} from '../markerMath';
import type { MarkerItem } from '../types';

const RECT: Rect = { x: 10, y: 20, width: 400, height: 300 };

function inside(p: { x: number; y: number }, extent: number, r: Rect) {
  return p.x - extent >= r.x - 1e-6 && p.y - extent >= r.y - 1e-6 && p.x + extent <= r.x + r.width + 1e-6 && p.y + extent <= r.y + r.height + 1e-6;
}

describe('screenRing / badgeCentre', () => {
  it('keeps tiny rings at the minimum screen radius', () => {
    const px = screenRing({ x: 0.5, y: 0.5, r: 0.001 }, RECT, M.minRingRadius);
    expect(px.r).toBe(M.minRingRadius);
    expect(px.cx).toBeCloseTo(210);
    expect(px.cy).toBeCloseTo(170);
  });

  it('never puts the badge over the ring centre and keeps every shape inside the bounds', () => {
    for (const shape of ['circle', 'square', 'diamond'] as const) {
      for (const ring of [
        { x: 0.5, y: 0.5, r: 0.05 },
        { x: 0.99, y: 0.01, r: 0.05 },
        { x: 0.01, y: 0.99, r: 0.02 },
      ]) {
        const px = screenRing(ring, RECT, M.minRingRadius);
        const b = badgeCentre(px, shape, M, RECT);
        expect(Math.hypot(b.x - px.cx, b.y - px.cy)).toBeGreaterThan(px.r);
        expect(inside(b, badgeExtent(shape, M.badgeRadius), RECT)).toBe(true);
      }
    }
  });

  it('puts the resize handle on the ring, opposite the badge', () => {
    const px = { cx: 100, cy: 100, r: 30 };
    const h = resizeHandlePoint(px, { x: 140, y: 60 });
    expect(Math.hypot(h.x - px.cx, h.y - px.cy)).toBeCloseTo(30);
    expect(h.x).toBeLessThan(px.cx);
    expect(h.y).toBeGreaterThan(px.cy);
  });
});

describe('hitTestScreenMarkers', () => {
  const big = { ring: { x: 0.5, y: 0.5, r: 0.3 }, shape: 'circle' as const };
  const small = { ring: { x: 0.5, y: 0.5, r: 0.05 }, shape: 'square' as const };

  it('finds the badge first, where it is drawn', () => {
    const px = screenRing(small.ring, RECT, M.minRingRadius);
    const b = badgeCentre(px, 'square', M, RECT);
    expect(hitTestScreenMarkers(b, [big, small], RECT, RECT, M)).toEqual({ index: 1, part: 'pin' });
  });

  it('treats the band around the ring as the resize edge', () => {
    const px = screenRing(big.ring, RECT, M.minRingRadius);
    const onEdge = { x: px.cx - px.r - 10, y: px.cy };
    expect(hitTestScreenMarkers(onEdge, [big], RECT, RECT, M)).toEqual({ index: 0, part: 'edge' });
    const farOutside = { x: px.cx - px.r - M.hitSlop, y: px.cy };
    expect(hitTestScreenMarkers(farOutside, [big], RECT, RECT, M)).toBeNull();
  });

  it('keeps the interior of a ring movable and prefers the smallest nested ring', () => {
    const px = screenRing(big.ring, RECT, M.minRingRadius);
    // Inside the big ring, well away from its edge band and from the small ring's badge.
    const p = { x: px.cx, y: px.cy + px.r * 0.3 };
    expect(hitTestScreenMarkers(p, [big], RECT, RECT, M)).toEqual({ index: 0, part: 'inside' });
    const centre = { x: px.cx, y: px.cy };
    const hit = hitTestScreenMarkers(centre, [big, small], RECT, RECT, M);
    expect(hit?.index).toBe(1);
  });

  it('returns null on empty photo area', () => {
    expect(hitTestScreenMarkers({ x: 20, y: 30 }, [small], RECT, RECT, M)).toBeNull();
  });
});

describe('ring edits', () => {
  it('moves by a screen delta and keeps the centre on the photo', () => {
    expect(moveRing({ x: 0.5, y: 0.5, r: 0.1 }, 40, -30, RECT)).toEqual({ x: 0.6, y: 0.4, r: 0.1 });
    const out = moveRing({ x: 0.95, y: 0.05, r: 0.1 }, 400, -400, RECT);
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
  });

  it('resizes relative to where the edge drag started, clamped', () => {
    const start = { x: 0.5, y: 0.5, r: 0.1 };
    const grown = resizeRing(start, 30, 60, RECT);
    expect(grown.r).toBeCloseTo(0.1 + 30 / 300);
    expect(resizeRing(start, 30, -1000, RECT).r).toBe(MIN_RING_RADIUS);
    expect(resizeRing(start, 30, 5000, RECT).r).toBe(MAX_RING_RADIUS);
  });

  it('scales with a pinch, clamped', () => {
    expect(scaleRing({ x: 0.2, y: 0.3, r: 0.1 }, 1.5).r).toBeCloseTo(0.15);
    expect(scaleRing({ x: 0.2, y: 0.3, r: 0.1 }, 100).r).toBe(MAX_RING_RADIUS);
  });

  it('drops a default ring only on the photo', () => {
    expect(dropRing({ x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7, r: DEFAULT_RING_RADIUS });
    expect(dropRing({ x: -0.01, y: 0.5 })).toBeNull();
    expect(dropRing({ x: 0.5, y: 1.2 })).toBeNull();
  });
});

describe('resolveRing', () => {
  const before = { width: 4000, height: 3000 };
  const after = { width: 3000, height: 4000 };
  const primary: MarkerItem = { key: 'd1', damageId: 'd1', status: 'new', role: 'primary', label: '1', ring: { x: 0.5, y: 0.5, r: 0.1 } };
  const counterpart: MarkerItem = {
    ...primary,
    key: 'd1:cp',
    role: 'counterpart',
    ring: { x: 0.5, y: 0.5, r: 0.2 },
    follow: { dir: 'afterToBefore', before, after },
  };

  it('uses the stored ring when nothing is being dragged', () => {
    expect(resolveRing(primary, null)).toBe(primary.ring);
    expect(resolveRing(primary, { damageId: 'other', role: 'primary', ring: { x: 0, y: 0, r: 0.1 } })).toBe(primary.ring);
  });

  it('draws the live ring and makes derived counterparts follow it', () => {
    const live = { damageId: 'd1', role: 'primary' as const, ring: { x: 0.3, y: 0.6, r: 0.08 } };
    expect(resolveRing(primary, live)).toBe(live.ring);
    expect(resolveRing(counterpart, live)).toEqual(deriveCounterpart(live.ring, 'afterToBefore', before, after));
  });

  it('keeps a stored counterpart override in place while the primary moves', () => {
    const pinned = { ...counterpart, follow: undefined };
    const live = { damageId: 'd1', role: 'primary' as const, ring: { x: 0.3, y: 0.6, r: 0.08 } };
    expect(resolveRing(pinned, live)).toBe(pinned.ring);
  });
});

describe('geometry helpers', () => {
  it('intersects rects and clamps empty overlaps to zero size', () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    const none = intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 });
    expect(none.width).toBe(0);
    expect(none.height).toBe(0);
  });

  it('offsets the loupe up-left, mirrors it near edges and keeps it on screen', () => {
    const pane = { width: 400, height: 600 };
    const off = { x: -72, y: -88 };
    expect(loupeCentre({ x: 300, y: 300 }, pane, 104, off)).toEqual({ x: 228, y: 212 });
    const nearLeft = loupeCentre({ x: 30, y: 300 }, pane, 104, off);
    expect(nearLeft.x).toBe(102);
    const nearTop = loupeCentre({ x: 300, y: 20 }, pane, 104, off);
    expect(nearTop.y).toBe(108);
  });
});
