import { Skia, type SkPath } from '@shopify/react-native-skia';

import { badgeHalfSize, type BadgeShape } from '../geometry';

/** Outline of a status badge centred on (cx, cy); used on screen and in the evidence image. */
export function makeBadgePath(shape: BadgeShape, r: number, cx = 0, cy = 0): SkPath {
  const h = badgeHalfSize(shape, r);
  const path = Skia.Path.Make();
  if (shape === 'circle') {
    path.addCircle(cx, cy, h);
  } else if (shape === 'square') {
    path.addRRect({ rect: { x: cx - h, y: cy - h, width: 2 * h, height: 2 * h }, rx: h * 0.12, ry: h * 0.12 });
  } else {
    path.moveTo(cx, cy - h);
    path.lineTo(cx + h, cy);
    path.lineTo(cx, cy + h);
    path.lineTo(cx - h, cy);
    path.close();
  }
  return path;
}

/** Baseline offset that vertically centres Barlow figures/caps (cap height ~0.7 em). */
export const BADGE_BASELINE_EM = 0.35;
