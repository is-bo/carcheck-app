import { Circle, DashPathEffect, Group, Path, Text, type SkFont } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { markerGeometry, palette, rebate, type as typeTokens } from '@/ui/theme/tokens';

import type { Rect } from '../geometry';
import { advanceWidth, useSkiaFont } from '../fonts';
import { BADGE_BASELINE_EM, makeBadgePath } from './badgePath';
import {
  badgeCentre,
  resizeHandlePoint,
  resolveRing,
  SCREEN_MARKER_METRICS,
  screenRing,
  type ScreenMarkerMetrics,
} from './markerMath';
import { markerVisual } from './markerStyle';
import type { LiveRing, MarkerItem } from './types';

const DASH = [...markerGeometry.referenceDash];
const BADGE_DASH = [4, 3];
const EDGE_COLOR = 'rgba(0,0,0,0.45)';
const HANDLE_RADIUS = 7;

export interface MarkerLayerProps {
  /** Markers on this photo, in draw order (pairMarkers/photoMarkers already sort them). */
  markers: MarkerItem[];
  /** Where the whole photo is drawn in canvas coordinates (moves with zoom/pan). */
  imageRect: SharedValue<Rect>;
  /** Badges stay inside this rect (normally the visible part of the photo). */
  bounds: SharedValue<Rect>;
  /** Ring being dragged right now; drawn instead of the stored ring (and followed by counterparts). */
  live?: SharedValue<LiveRing | null>;
  selectedId?: string | null;
  /** Show the resize knob on the selected marker (editing surfaces). */
  showHandle?: boolean;
  metrics?: ScreenMarkerMetrics;
}

/**
 * Skia marker drawing for a photo on screen (place inside a <Canvas>). Rings follow the photo
 * through zoom/pan on the UI thread; strokes and badges keep a constant dp size (DESIGN.md).
 * All rings are drawn before all badges so a badge is never hidden under another ring.
 */
export function MarkerLayer({ markers, imageRect, bounds, live, selectedId = null, showHandle = false, metrics = SCREEN_MARKER_METRICS }: MarkerLayerProps) {
  const noLive = useSharedValue<LiveRing | null>(null);
  const liveSV = live ?? noLive;
  const font = useSkiaFont('semibold', typeTokens.markerNumber.fontSize);
  return (
    <Group>
      {markers.map((m) => (
        <MarkerRing key={m.key} item={m} imageRect={imageRect} live={liveSV} metrics={metrics} />
      ))}
      {markers.map((m) => (
        <MarkerBadge
          key={m.key}
          item={m}
          imageRect={imageRect}
          bounds={bounds}
          live={liveSV}
          metrics={metrics}
          font={font}
          selected={m.damageId === selectedId}
          showHandle={showHandle}
        />
      ))}
    </Group>
  );
}

interface GlyphProps {
  item: MarkerItem;
  imageRect: SharedValue<Rect>;
  live: SharedValue<LiveRing | null>;
  metrics: ScreenMarkerMetrics;
}

function MarkerRing({ item, imageRect, live, metrics }: GlyphProps) {
  const v = markerVisual(item.status, item.role);
  const px = useDerivedValue(() => screenRing(resolveRing(item, live.get()), imageRect.get(), metrics.minRingRadius));
  const cx = useDerivedValue(() => px.get().cx);
  const cy = useDerivedValue(() => px.get().cy);
  const r = useDerivedValue(() => px.get().r);
  const dash = v.dashed ? <DashPathEffect intervals={DASH} /> : null;
  return (
    <Group>
      {v.ringEdge ? (
        <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={metrics.ringHalo + 2} color={v.ringEdge} strokeCap={v.dashed ? 'round' : 'butt'}>
          {dash}
        </Circle>
      ) : null}
      <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={metrics.ringHalo} color={v.ringHalo} strokeCap={v.dashed ? 'round' : 'butt'}>
        {dash}
      </Circle>
      <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={metrics.ringCore} color={v.ringCore}>
        {dash}
      </Circle>
    </Group>
  );
}

interface BadgeProps extends GlyphProps {
  bounds: SharedValue<Rect>;
  font: SkFont | null;
  selected: boolean;
  showHandle: boolean;
}

function MarkerBadge({ item, imageRect, bounds, live, metrics, font, selected, showHandle }: BadgeProps) {
  const v = markerVisual(item.status, item.role);
  const r = metrics.badgeRadius;
  const shape = useMemo(() => makeBadgePath(v.shape, r), [v.shape, r]);
  const focus = useMemo(() => makeBadgePath(v.shape, r + 4), [v.shape, r]);
  const textW = font ? advanceWidth(font, item.label) : 0;
  const baseline = font ? font.getSize() * BADGE_BASELINE_EM : 0;

  const geo = useDerivedValue(() => {
    const px = screenRing(resolveRing(item, live.get()), imageRect.get(), metrics.minRingRadius);
    const b = badgeCentre(px, v.shape, metrics, bounds.get());
    return { px, b, h: resizeHandlePoint(px, b) };
  });
  const transform = useDerivedValue(() => [{ translateX: geo.get().b.x }, { translateY: geo.get().b.y }]);
  const hx = useDerivedValue(() => geo.get().h.x);
  const hy = useDerivedValue(() => geo.get().h.y);

  return (
    <Group>
      {selected && showHandle ? (
        <Group>
          <Circle cx={hx} cy={hy} r={HANDLE_RADIUS + 1.5} color={palette.ink} />
          <Circle cx={hx} cy={hy} r={HANDLE_RADIUS} color={palette.white} />
        </Group>
      ) : null}
      <Group transform={transform}>
        {selected ? <Path path={focus} style="stroke" strokeWidth={2} color={rebate.focusRing} /> : null}
        {v.ringEdge ? <Path path={shape} style="stroke" strokeWidth={metrics.badgeBorder + 2} color={EDGE_COLOR} /> : null}
        <Path path={shape} color={v.badgeFill} />
        <Path path={shape} style="stroke" strokeWidth={metrics.badgeBorder} color={v.badgeBorder}>
          {v.dashed ? <DashPathEffect intervals={BADGE_DASH} /> : null}
        </Path>
        {font ? <Text x={-textW / 2} y={baseline} text={item.label} font={font} color={v.badgeText} /> : null}
      </Group>
    </Group>
  );
}
