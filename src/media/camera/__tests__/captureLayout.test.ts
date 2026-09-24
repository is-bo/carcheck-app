import { CAPTURE_CHROME, computeCaptureLayout, orientationOf } from '../captureLayout';
import type { Rect } from '../../geometry';

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

function right(r: Rect) {
  return r.x + r.width;
}
function bottom(r: Rect) {
  return r.y + r.height;
}

describe('orientationOf', () => {
  it('is landscape only when strictly wider than tall', () => {
    expect(orientationOf({ width: 4032, height: 3024 })).toBe('landscape');
    expect(orientationOf({ width: 3024, height: 4032 })).toBe('portrait');
    expect(orientationOf({ width: 100, height: 100 })).toBe('portrait');
  });
});

describe('computeCaptureLayout — landscape phone', () => {
  const screen = { width: 844, height: 390 };
  const insets = { top: 0, right: 34, bottom: 21, left: 47 };

  it('sizes the frame to exactly 4:3 and fills the usable height', () => {
    const l = computeCaptureLayout(screen, insets, false);
    expect(l.orientation).toBe('landscape');
    expect(l.frame.width / l.frame.height).toBeCloseTo(4 / 3, 9);
    expect(l.frame.height).toBeCloseTo(390 - 21, 9);
  });

  it('places rails beside the frame, inside the safe area, without overlap', () => {
    const l = computeCaptureLayout(screen, insets, true);
    expect(l.lead.x).toBe(insets.left);
    expect(right(l.lead)).toBeCloseTo(l.frame.x, 9);
    expect(l.trail.x).toBeCloseTo(right(l.frame), 9);
    expect(right(l.trail)).toBeCloseTo(screen.width - insets.right, 9);
    expect(l.lead.width).toBeGreaterThanOrEqual(CAPTURE_CHROME.leadRail);
    expect(l.trail.width).toBeGreaterThanOrEqual(CAPTURE_CHROME.trailRail + CAPTURE_CHROME.slider);
  });

  it('shrinks the frame when the rails would not fit', () => {
    const l = computeCaptureLayout({ width: 600, height: 400 }, NO_INSETS, true);
    const rails = CAPTURE_CHROME.leadRail + CAPTURE_CHROME.trailRail + CAPTURE_CHROME.slider;
    expect(l.frame.width).toBeCloseTo(600 - rails, 9);
    expect(l.frame.width / l.frame.height).toBeCloseTo(4 / 3, 9);
    expect(l.frame.y).toBeGreaterThan(0); // centred vertically
    expect(bottom(l.frame)).toBeLessThanOrEqual(400);
  });
});

describe('computeCaptureLayout — portrait phone', () => {
  const screen = { width: 390, height: 844 };
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };

  it('sizes the frame to exactly 3:4 at full width under the top bar', () => {
    const l = computeCaptureLayout(screen, insets, false);
    expect(l.orientation).toBe('portrait');
    expect(l.frame.width).toBeCloseTo(390, 9);
    expect(l.frame.height / l.frame.width).toBeCloseTo(4 / 3, 9);
    expect(l.frame.y).toBe(insets.top + CAPTURE_CHROME.topBar);
    expect(l.lead).toEqual({ x: 0, y: insets.top, width: 390, height: CAPTURE_CHROME.topBar });
  });

  it('gives the rest of the height to the bottom bar, ending at the safe area', () => {
    const l = computeCaptureLayout(screen, insets, true);
    expect(l.trail.y).toBeCloseTo(bottom(l.frame), 9);
    expect(bottom(l.trail)).toBeCloseTo(screen.height - insets.bottom, 9);
    expect(l.trail.height).toBeGreaterThanOrEqual(CAPTURE_CHROME.bottomBar + CAPTURE_CHROME.slider);
  });

  it('narrows and centres the frame on short screens', () => {
    const l = computeCaptureLayout({ width: 400, height: 700 }, NO_INSETS, true);
    const bars = CAPTURE_CHROME.topBar + CAPTURE_CHROME.bottomBar + CAPTURE_CHROME.slider;
    expect(l.frame.height).toBeCloseTo(700 - bars, 9);
    expect(l.frame.height / l.frame.width).toBeCloseTo(4 / 3, 9);
    expect(l.frame.x + l.frame.width / 2).toBeCloseTo(200, 9);
  });
});
