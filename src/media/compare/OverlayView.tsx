import { Canvas, Group, Image } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { rebate } from '@/ui/theme/tokens';

import { Loupe } from '../annotate/Loupe';
import { MarkerLayer } from '../annotate/MarkerLayer';
import { intersectRect } from '../annotate/markerMath';
import type { Alignment } from '../geometry';
import { OpacityControl } from './OpacityControl';
import { NO_MARKERS, PHOTO_SAMPLING, useLive, usePairImages, usePairMarking, usePairViewport } from './pairHooks';
import { PhotoTag } from './PhotoTag';
import type { CompareViewBaseProps } from './SideBySideView';
import { DEFAULT_COMPARE_LABELS } from './types';
import { useMeasuredSize } from './useMeasuredSize';
import { usePhotoGestures } from './usePhotoGestures';
import { overlayBeforeRect, paneImageRect } from './viewportMath';

export interface OverlayViewProps extends CompareViewBaseProps {
  /** AFTER opacity 0..1 (0 = BEFORE only). Pass one to keep the level across angles; default 0.5. */
  opacity?: SharedValue<number>;
  /** Optional BEFORE->AFTER nudge (stored per pair); identity when absent. */
  alignment?: Alignment | null;
  /** Render the Before/After opacity control under the photo. Default true. */
  showOpacityControl?: boolean;
}

/**
 * AFTER drawn over BEFORE in one frame. Press and hold the photo to blink to BEFORE. Each
 * marker layer fades with its photo, so a marker only shows where its photo shows; while
 * marking, AFTER markers stay fully visible.
 */
export function OverlayView({
  before,
  after,
  images,
  markers = NO_MARKERS,
  showMarkers = true,
  viewport,
  live,
  marking,
  labels = DEFAULT_COMPARE_LABELS,
  opacity,
  alignment,
  showOpacityControl = true,
  onImageError,
  style,
}: OverlayViewProps) {
  const vp = usePairViewport(viewport, before, after);
  const liveSV = useLive(live);
  const imgs = usePairImages(before, after, images, onImageError);
  const editing = usePairMarking(markers, marking, liveSV);
  const ownOpacity = useSharedValue(0.5);
  const o = opacity ?? ownOpacity;
  const { sizeSV, onLayout } = useMeasuredSize();
  const markersOn = showMarkers || !!marking;
  const marked = !!marking;

  const rectA = useDerivedValue(() => paneImageRect(vp.view.get(), after.size, sizeSV.get()));
  const rectB = useDerivedValue(() => overlayBeforeRect(before.size, after.size, rectA.get(), alignment));
  const boundsA = useDerivedValue(() => intersectRect(rectA.get(), { x: 0, y: 0, width: sizeSV.get().width, height: sizeSV.get().height }));
  const boundsB = useDerivedValue(() => intersectRect(rectB.get(), { x: 0, y: 0, width: sizeSV.get().width, height: sizeSV.get().height }));
  const beforeOpacity = useDerivedValue(() => 1 - o.get());
  const afterMarkerOpacity = useDerivedValue(() => (marked ? 1 : o.get()));

  const gesture = usePhotoGestures({ viewport: vp, pane: sizeSV, image: after.size, editing: editing.after, holdToPeek: o });
  const selectedId = marking?.selectedId ?? null;

  return (
    <View style={[styles.root, style]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.frame} onLayout={onLayout} collapsable={false}>
          <Canvas style={StyleSheet.absoluteFill}>
            {imgs.before ? <Image image={imgs.before} rect={rectB} fit="fill" sampling={PHOTO_SAMPLING} /> : null}
            {imgs.after ? (
              <Group opacity={o}>
                <Image image={imgs.after} rect={rectA} fit="fill" sampling={PHOTO_SAMPLING} />
              </Group>
            ) : null}
            {markersOn ? (
              <Group opacity={beforeOpacity}>
                <MarkerLayer markers={markers.before} imageRect={rectB} bounds={boundsB} live={liveSV} selectedId={selectedId} />
              </Group>
            ) : null}
            {markersOn ? (
              <Group opacity={afterMarkerOpacity}>
                <MarkerLayer markers={markers.after} imageRect={rectA} bounds={boundsA} live={liveSV} selectedId={selectedId} showHandle={marked} />
              </Group>
            ) : null}
            {editing.after && imgs.after ? <Loupe image={imgs.after} imageRect={rectA} drag={editing.after.drag} pane={sizeSV} /> : null}
          </Canvas>
          <PhotoTag label={labels.before} timeLabel={before.timeLabel} opacity={beforeOpacity} style={styles.half} />
          <PhotoTag label={labels.after} timeLabel={after.timeLabel} align="right" opacity={o} style={styles.half} />
        </View>
      </GestureDetector>
      {showOpacityControl ? <OpacityControl value={o} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: rebate.background },
  frame: { flex: 1, overflow: 'hidden' },
  half: { maxWidth: '48%' },
});
