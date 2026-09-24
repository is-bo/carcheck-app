import { Canvas, Circle, Group, Image, Path, Rect, Shadow, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { palette, rebate, touch } from '@/ui/theme/tokens';

import { Loupe } from '../annotate/Loupe';
import { MarkerLayer } from '../annotate/MarkerLayer';
import { intersectRect } from '../annotate/markerMath';
import type { Alignment } from '../geometry';
import { NO_MARKERS, PHOTO_SAMPLING, useLive, usePairImages, usePairMarking, usePairViewport } from './pairHooks';
import { PhotoTag } from './PhotoTag';
import type { CompareViewBaseProps } from './SideBySideView';
import { DEFAULT_COMPARE_LABELS } from './types';
import { useMeasuredSize } from './useMeasuredSize';
import { usePhotoGestures } from './usePhotoGestures';
import { dividerFromX, dividerHandleHit, overlayBeforeRect, paneImageRect, splitAtDivider } from './viewportMath';

const HANDLE_R = touch.sliderHandle / 2;
/** Grab area around the handle: wider and taller than the drawn circle for a sure thumb hit. */
const GRAB_HALF_W = HANDLE_R + 8;
const GRAB_HALF_H = HANDLE_R + 16;

export interface SliderViewProps extends CompareViewBaseProps {
  /** Divider position as a fraction of the view width (BEFORE left of it). Default 0.5. */
  divider?: SharedValue<number>;
  alignment?: Alignment | null;
}

function chevrons() {
  const p = Skia.Path.Make();
  p.moveTo(-5, -6);
  p.lineTo(-11, 0);
  p.lineTo(-5, 6);
  p.moveTo(5, -6);
  p.lineTo(11, 0);
  p.lineTo(5, 6);
  return p;
}

/**
 * BEFORE left, AFTER right of a draggable divider (Skia clip). Only the handle moves the
 * divider; everywhere else one finger pans when zoomed and pinch zooms both layers together.
 */
export function SliderView({
  before,
  after,
  images,
  markers = NO_MARKERS,
  showMarkers = true,
  viewport,
  live,
  marking,
  labels = DEFAULT_COMPARE_LABELS,
  divider,
  alignment,
  onImageError,
  style,
}: SliderViewProps) {
  const vp = usePairViewport(viewport, before, after);
  const liveSV = useLive(live);
  const imgs = usePairImages(before, after, images, onImageError);
  const editing = usePairMarking(markers, marking, liveSV);
  const ownDivider = useSharedValue(0.5);
  const d = divider ?? ownDivider;
  const { sizeSV, onLayout } = useMeasuredSize();
  const markersOn = showMarkers || !!marking;
  const marked = !!marking;
  const selectedId = marking?.selectedId ?? null;
  const chevronPath = useMemo(() => chevrons(), []);

  const rectA = useDerivedValue(() => paneImageRect(vp.view.get(), after.size, sizeSV.get()));
  const rectB = useDerivedValue(() => overlayBeforeRect(before.size, after.size, rectA.get(), alignment));
  const full = useDerivedValue(() => ({ x: 0, y: 0, width: sizeSV.get().width, height: sizeSV.get().height }));
  const boundsA = useDerivedValue(() => intersectRect(rectA.get(), full.get()));
  const boundsB = useDerivedValue(() => intersectRect(rectB.get(), full.get()));
  const split = useDerivedValue(() => splitAtDivider(d.get(), sizeSV.get()));
  const leftClip = useDerivedValue(() => split.get().left);
  const rightClip = useDerivedValue(() => split.get().right);
  // While marking, AFTER markers are never clipped: a pin dropped left of the divider must show.
  const afterMarkerClip = useDerivedValue(() => (marked ? full.get() : split.get().right));
  const hx = useDerivedValue(() => d.get() * sizeSV.get().width);
  const hy = useDerivedValue(() => sizeSV.get().height / 2);
  const lineEdge = useDerivedValue(() => ({ x: hx.get() - 2, y: 0, width: 4, height: sizeSV.get().height }));
  const line = useDerivedValue(() => ({ x: hx.get() - 1, y: 0, width: 2, height: sizeSV.get().height }));
  const handleTransform = useDerivedValue(() => [{ translateX: hx.get() }, { translateY: hy.get() }]);

  const dividerPan = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .maxPointers(1)
        .onTouchesDown((e, manager) => {
          const t = e.changedTouches[0];
          if (t && dividerHandleHit({ x: t.x, y: t.y }, d.get(), sizeSV.get(), GRAB_HALF_W, GRAB_HALF_H)) manager.activate();
          else manager.fail();
        })
        .onUpdate((e) => {
          d.set(dividerFromX(e.x, sizeSV.get().width, HANDLE_R));
        }),
    [d, sizeSV],
  );
  const gesture = usePhotoGestures({ viewport: vp, pane: sizeSV, image: after.size, editing: editing.after, priority: dividerPan });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.frame, style]} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          {imgs.before ? <Image image={imgs.before} rect={rectB} fit="fill" sampling={PHOTO_SAMPLING} /> : null}
          {imgs.after ? (
            <Group clip={rightClip}>
              <Image image={imgs.after} rect={rectA} fit="fill" sampling={PHOTO_SAMPLING} />
            </Group>
          ) : null}
          {markersOn ? (
            <Group clip={leftClip}>
              <MarkerLayer markers={markers.before} imageRect={rectB} bounds={boundsB} live={liveSV} selectedId={selectedId} />
            </Group>
          ) : null}
          {markersOn ? (
            <Group clip={afterMarkerClip}>
              <MarkerLayer markers={markers.after} imageRect={rectA} bounds={boundsA} live={liveSV} selectedId={selectedId} showHandle={marked} />
            </Group>
          ) : null}
          <Rect rect={lineEdge} color="rgba(0,0,0,0.35)" />
          <Rect rect={line} color={palette.white} />
          <Group transform={handleTransform}>
            <Circle cx={0} cy={0} r={HANDLE_R} color={palette.white}>
              <Shadow dx={0} dy={2} blur={6} color="rgba(0,0,0,0.4)" />
            </Circle>
            <Path path={chevronPath} style="stroke" strokeWidth={2.5} strokeCap="round" strokeJoin="round" color={palette.ink} />
          </Group>
          {editing.after && imgs.after ? <Loupe image={imgs.after} imageRect={rectA} drag={editing.after.drag} pane={sizeSV} /> : null}
        </Canvas>
        <PhotoTag label={labels.before} timeLabel={before.timeLabel} style={styles.half} />
        <PhotoTag label={labels.after} timeLabel={after.timeLabel} align="right" style={styles.half} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: rebate.background },
  half: { maxWidth: '48%' },
});
