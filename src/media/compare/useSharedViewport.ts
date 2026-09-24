import { useCallback, useMemo } from 'react';
import {
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { ease, duration } from '@/ui/motion';

import { IDENTITY_VIEW, type ViewState } from '../geometry';
import { ZOOMED_EPSILON } from './viewportMath';

/**
 * Zoom/pan shared by every pane and mode of one comparison (geometry.ts ViewState: zoom relative
 * to contain-fit plus the normalized photo point at the viewport centre). Each pane clamps it
 * for its own geometry at render time, so one value keeps side-by-side panes in sync even when
 * the photos differ in size or orientation. Gestures write it on the UI thread.
 */
export interface SharedViewport {
  view: SharedValue<ViewState>;
  /** True while zoomed in: horizontal swipes then pan the photo instead of switching angles. */
  zoomed: DerivedValue<boolean>;
  /** Back to fit (e.g. on angle change). */
  reset: (animated?: boolean) => void;
}

/** Animated transition of the shared view (double tap, reset); honours Reduce Motion. */
export function animateView(target: ViewState): ViewState {
  'worklet';
  // ViewState is an interface; withTiming wants a plain record of numbers.
  const plain: { zoom: number; cx: number; cy: number } = { zoom: target.zoom, cx: target.cx, cy: target.cy };
  return withTiming(plain, { duration: duration.base, easing: ease.standard, reduceMotion: ReduceMotion.System });
}

export function useSharedViewport(initial: ViewState = IDENTITY_VIEW): SharedViewport {
  const view = useSharedValue<ViewState>(initial);
  const zoomed = useDerivedValue(() => view.get().zoom > ZOOMED_EPSILON);
  const reset = useCallback(
    (animated = false) => {
      view.set(animated ? animateView(IDENTITY_VIEW) : IDENTITY_VIEW);
    },
    [view],
  );
  return useMemo(() => ({ view, zoomed, reset }), [view, zoomed, reset]);
}
