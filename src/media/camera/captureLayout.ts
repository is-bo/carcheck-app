/**
 * Screen layout of the capture UI (DESIGN.md "Camera & comparison chrome"). Pure: no RN imports.
 *
 * The preview is sized to exactly the captured aspect (4:3 landscape, 3:4 portrait) so the frame
 * the employee sees equals the photo, which the BEFORE ghost relies on. Controls sit on solid
 * rebate rails beside the frame (landscape) or bars above/below it (portrait), never over it.
 */
import type { Rect, Size } from '../geometry';

export type UiOrientation = 'landscape' | 'portrait';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CaptureLayout {
  orientation: UiOrientation;
  /** The 4:3 (landscape) or 3:4 (portrait) preview rect. */
  frame: Rect;
  /** Left rail (landscape) or top bar (portrait). */
  lead: Rect;
  /** Right rail (landscape) or bottom bar (portrait); includes the ghost slider strip when present. */
  trail: Rect;
}

/** Minimum rail/bar sizes in dp. The 80 dp shutter needs the trail rail/bar. */
export const CAPTURE_CHROME = {
  leadRail: 88,
  trailRail: 112,
  topBar: 64,
  bottomBar: 168,
  /** Extra room for the ghost opacity slider (vertical strip in landscape, row in portrait). */
  slider: 56,
} as const;

/** Photo orientation convention (IMAGE_PIPELINE §2): landscape iff width > height. */
export function orientationOf(size: Size): UiOrientation {
  return size.width > size.height ? 'landscape' : 'portrait';
}

export function computeCaptureLayout(container: Size, insets: Insets, withSlider: boolean): CaptureLayout {
  const orientation = orientationOf(container);
  const innerW = Math.max(0, container.width - insets.left - insets.right);
  const innerH = Math.max(0, container.height - insets.top - insets.bottom);
  const slider = withSlider ? CAPTURE_CHROME.slider : 0;

  if (orientation === 'landscape') {
    const railsMin = CAPTURE_CHROME.leadRail + CAPTURE_CHROME.trailRail + slider;
    let frameH = innerH;
    let frameW = (frameH * 4) / 3;
    const maxW = Math.max(0, innerW - railsMin);
    if (frameW > maxW) {
      frameW = maxW;
      frameH = (frameW * 3) / 4;
    }
    const extra = innerW - railsMin - frameW;
    const leadW = CAPTURE_CHROME.leadRail + extra / 2;
    const trailW = CAPTURE_CHROME.trailRail + slider + extra / 2;
    const frame = { x: insets.left + leadW, y: insets.top + (innerH - frameH) / 2, width: frameW, height: frameH };
    return {
      orientation,
      frame,
      lead: { x: insets.left, y: insets.top, width: leadW, height: innerH },
      trail: { x: frame.x + frameW, y: insets.top, width: trailW, height: innerH },
    };
  }

  const barsMin = CAPTURE_CHROME.topBar + CAPTURE_CHROME.bottomBar + slider;
  let frameW = innerW;
  let frameH = (frameW * 4) / 3;
  const maxH = Math.max(0, innerH - barsMin);
  if (frameH > maxH) {
    frameH = maxH;
    frameW = (frameH * 3) / 4;
  }
  const frame = {
    x: insets.left + (innerW - frameW) / 2,
    y: insets.top + CAPTURE_CHROME.topBar,
    width: frameW,
    height: frameH,
  };
  return {
    orientation,
    frame,
    lead: { x: insets.left, y: insets.top, width: innerW, height: CAPTURE_CHROME.topBar },
    // Spare height goes to the bottom bar: the shutter stays low, in thumb reach.
    trail: { x: insets.left, y: frame.y + frameH, width: innerW, height: innerH - CAPTURE_CHROME.topBar - frameH },
  };
}
