import { beforeRectInAfter, IDENTITY_VIEW, normRectToRect, type Size } from '../../geometry';
import {
  chooseSideBySide,
  dividerFromX,
  dividerHandleHit,
  opacityFromTrack,
  overlayBeforeRect,
  paneImageRect,
  splitAtDivider,
} from '../viewportMath';

const LANDSCAPE: Size = { width: 4000, height: 3000 };
const PORTRAIT: Size = { width: 3000, height: 4000 };

describe('paneImageRect', () => {
  it('contain-fits at zoom 1 and centres', () => {
    const r = paneImageRect(IDENTITY_VIEW, LANDSCAPE, { width: 400, height: 600 });
    expect(r.width).toBeCloseTo(400);
    expect(r.height).toBeCloseTo(300);
    expect(r.y).toBeCloseTo(150);
  });

  it('clamps a shared view for each pane geometry, so a pan never shows past the photo', () => {
    const view = { zoom: 3, cx: 0.99, cy: 0.5 };
    const pane = { width: 400, height: 300 };
    const r = paneImageRect(view, LANDSCAPE, pane);
    expect(r.x + r.width).toBeCloseTo(pane.width);
    const portrait = paneImageRect(view, PORTRAIT, pane);
    expect(portrait.x + portrait.width).toBeGreaterThanOrEqual(pane.width - 1e-6);
  });

  it('returns an empty rect before the pane is measured', () => {
    expect(paneImageRect(IDENTITY_VIEW, LANDSCAPE, { width: 0, height: 0 }).width).toBe(0);
  });
});

describe('overlayBeforeRect', () => {
  it('matches the AFTER rect for an equal-aspect pair and applies the nudge', () => {
    const afterRect = { x: 10, y: 20, width: 400, height: 300 };
    expect(overlayBeforeRect(LANDSCAPE, LANDSCAPE, afterRect)).toEqual(afterRect);
    const a = { dx: 0.1, dy: 0, scale: 1 };
    expect(overlayBeforeRect(LANDSCAPE, LANDSCAPE, afterRect, a)).toEqual(normRectToRect(beforeRectInAfter(LANDSCAPE, LANDSCAPE, a), afterRect));
    expect(overlayBeforeRect(LANDSCAPE, LANDSCAPE, afterRect, a).x).toBeCloseTo(50);
  });
});

describe('chooseSideBySide', () => {
  it('stacks landscape photos on a portrait phone and puts them left|right in landscape', () => {
    expect(chooseSideBySide({ width: 390, height: 640 }, LANDSCAPE, LANDSCAPE, 2)).toBe('stacked');
    expect(chooseSideBySide({ width: 800, height: 360 }, LANDSCAPE, LANDSCAPE, 2)).toBe('sideBySide');
  });

  it('puts portrait photos side by side when that shows them larger', () => {
    expect(chooseSideBySide({ width: 800, height: 360 }, PORTRAIT, PORTRAIT, 2)).toBe('sideBySide');
    expect(chooseSideBySide({ width: 700, height: 800 }, PORTRAIT, PORTRAIT, 2)).toBe('sideBySide');
    // A narrow portrait phone still stacks portrait photos.
    expect(chooseSideBySide({ width: 390, height: 640 }, PORTRAIT, PORTRAIT, 2)).toBe('stacked');
  });
});

describe('opacity and divider controls', () => {
  it('maps the finger to 0..1 with a sticky 50% detent', () => {
    expect(opacityFromTrack(-20, 200, 0.03)).toBe(0);
    expect(opacityFromTrack(250, 200, 0.03)).toBe(1);
    expect(opacityFromTrack(104, 200, 0.03)).toBe(0.5);
    expect(opacityFromTrack(150, 200, 0.03)).toBeCloseTo(0.75);
    expect(opacityFromTrack(10, 0, 0.03)).toBe(0);
  });

  it('keeps the divider handle on screen', () => {
    expect(dividerFromX(0, 400, 24)).toBeCloseTo(24 / 400);
    expect(dividerFromX(400, 400, 24)).toBeCloseTo(1 - 24 / 400);
    expect(dividerFromX(200, 400, 24)).toBe(0.5);
  });

  it('grabs the divider only on its handle', () => {
    const pane = { width: 400, height: 600 };
    expect(dividerHandleHit({ x: 210, y: 310 }, 0.5, pane, 28, 36)).toBe(true);
    expect(dividerHandleHit({ x: 200, y: 100 }, 0.5, pane, 28, 36)).toBe(false);
    expect(dividerHandleHit({ x: 260, y: 300 }, 0.5, pane, 28, 36)).toBe(false);
  });

  it('splits the pane at the divider', () => {
    const { left, right } = splitAtDivider(0.25, { width: 400, height: 300 });
    expect(left).toEqual({ x: 0, y: 0, width: 100, height: 300 });
    expect(right).toEqual({ x: 100, y: 0, width: 300, height: 300 });
  });
});
