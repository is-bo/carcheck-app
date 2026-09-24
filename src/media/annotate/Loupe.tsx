import { Circle, Group, Image, Line, Rect as SkRectShape, type SkImage } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { markerGeometry, palette } from '@/ui/theme/tokens';

import type { Rect, Size } from '../geometry';
import { loupeCentre } from './markerMath';
import type { DragInfo } from './useMarkerEditing';

const R = markerGeometry.loupeDiameter / 2;
const ZOOM = markerGeometry.loupeMagnification;
const CROSS = 9;

export interface LoupeProps {
  image: SkImage;
  /** Where the whole photo is drawn in canvas coordinates. */
  imageRect: SharedValue<Rect>;
  drag: SharedValue<DragInfo | null>;
  pane: SharedValue<Size>;
}

/**
 * Magnifier shown while a marker is dragged (DESIGN.md: 104 dp at 2.4x, offset up-left of the
 * finger, mirrored near edges), so the finger never hides the spot being marked.
 */
export function Loupe({ image, imageRect, drag, pane }: LoupeProps) {
  const c = useDerivedValue(() => {
    const d = drag.get();
    if (d === null) return { x: -2 * R, y: -2 * R };
    return loupeCentre({ x: d.x, y: d.y }, pane.get(), 2 * R, markerGeometry.loupeOffset);
  });
  const opacity = useDerivedValue(() => (drag.get() === null ? 0 : 1));
  const cx = useDerivedValue(() => c.get().x);
  const cy = useDerivedValue(() => c.get().y);
  const clip = useDerivedValue(() => ({
    rect: { x: c.get().x - R, y: c.get().y - R, width: 2 * R, height: 2 * R },
    rx: R,
    ry: R,
  }));
  const backdrop = useDerivedValue(() => ({ x: c.get().x - R, y: c.get().y - R, width: 2 * R, height: 2 * R }));
  const transform = useDerivedValue(() => {
    const d = drag.get();
    const fx = d === null ? 0 : d.focusX;
    const fy = d === null ? 0 : d.focusY;
    return [{ translateX: c.get().x }, { translateY: c.get().y }, { scale: ZOOM }, { translateX: -fx }, { translateY: -fy }];
  });
  const h1 = useDerivedValue(() => ({ x: c.get().x - CROSS, y: c.get().y }));
  const h2 = useDerivedValue(() => ({ x: c.get().x + CROSS, y: c.get().y }));
  const v1 = useDerivedValue(() => ({ x: c.get().x, y: c.get().y - CROSS }));
  const v2 = useDerivedValue(() => ({ x: c.get().x, y: c.get().y + CROSS }));

  return (
    <Group opacity={opacity}>
      <Circle cx={cx} cy={cy} r={R + 3} color="rgba(0,0,0,0.4)" />
      <Group clip={clip}>
        <SkRectShape rect={backdrop} color={palette.rebate} />
        <Group transform={transform}>
          <Image image={image} rect={imageRect} fit="fill" />
        </Group>
      </Group>
      <Circle cx={cx} cy={cy} r={R} style="stroke" strokeWidth={2} color={palette.white} />
      <Line p1={h1} p2={h2} strokeWidth={3} color={palette.ink} />
      <Line p1={v1} p2={v2} strokeWidth={3} color={palette.ink} />
      <Line p1={h1} p2={h2} strokeWidth={1.5} color={palette.white} />
      <Line p1={v1} p2={v2} strokeWidth={1.5} color={palette.white} />
    </Group>
  );
}
