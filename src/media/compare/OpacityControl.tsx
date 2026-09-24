import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, withTiming, type SharedValue } from 'react-native-reanimated';

import { duration, ease } from '@/ui/motion';
import { elevation, fontScaleCap, palette, rebate, space, touch, type as typeTokens } from '@/ui/theme/tokens';

import { clamp } from '../geometry';
import { useMeasuredSize } from './useMeasuredSize';
import { opacityFromTrack } from './viewportMath';

const THUMB = 28;
/** Sticky 50% while dragging; a wider zone for a quick tap on the centre tick. */
const DRAG_DETENT = 0.03;
const TAP_DETENT = 0.08;
const TIMING = { duration: duration.fast, easing: ease.standard, reduceMotion: ReduceMotion.System };

export interface OpacityControlProps {
  /** AFTER opacity, 0 = BEFORE only, 1 = AFTER only. */
  value: SharedValue<number>;
  beforeLabel?: string;
  afterLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Overlay opacity control for the thumb: full-width track (drag, or tap anywhere to jump; the
 * centre tick snaps to 50%) between "Before" and "After" quick taps for 0% and 100%.
 * Runs entirely on the UI thread; the photo never re-renders React while it moves.
 */
export function OpacityControl({ value, beforeLabel = 'Before', afterLabel = 'After', style }: OpacityControlProps) {
  const { sizeSV: track, onLayout } = useMeasuredSize();

  const snapTo = useCallback(
    (v: number) => {
      value.set(withTiming(v, TIMING));
    },
    [value],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .hitSlop({ top: 12, bottom: 12 })
        .onBegin((e) => {
          value.set(withTiming(opacityFromTrack(e.x, track.get().width, TAP_DETENT), TIMING));
        })
        .onUpdate((e) => {
          value.set(opacityFromTrack(e.x, track.get().width, DRAG_DETENT));
        }),
    [value, track],
  );

  const fill = useAnimatedStyle(() => ({ width: clamp(value.get(), 0, 1) * track.get().width }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: clamp(value.get(), 0, 1) * track.get().width - THUMB / 2 }],
  }));

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      const step = e.nativeEvent.actionName === 'increment' ? 0.1 : e.nativeEvent.actionName === 'decrement' ? -0.1 : 0;
      if (step !== 0) snapTo(clamp(Math.round((value.get() + step) * 10) / 10, 0, 1));
    },
    [snapTo, value],
  );

  return (
    <View style={[styles.row, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${beforeLabel} only`} onPress={() => snapTo(0)} style={styles.end} hitSlop={4}>
        <Text style={styles.endText} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {beforeLabel}
        </Text>
      </Pressable>
      <GestureDetector gesture={pan}>
        <View
          style={styles.trackArea}
          onLayout={onLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${afterLabel} photo opacity`}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          <View style={styles.track} />
          <Animated.View style={[styles.trackFill, fill]} />
          <View style={styles.centreTick} />
          <Animated.View style={[styles.thumb, thumb]} />
        </View>
      </GestureDetector>
      <Pressable accessibilityRole="button" accessibilityLabel={`${afterLabel} only`} onPress={() => snapTo(1)} style={styles.end} hitSlop={4}>
        <Text style={styles.endText} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {afterLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch.min,
    paddingHorizontal: space[2],
    gap: space[3],
    backgroundColor: rebate.background,
  },
  end: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  endText: {
    ...typeTokens.button,
    color: rebate.text,
  },
  trackArea: {
    flex: 1,
    height: touch.min,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    // 60 % of the control outline: visible in sunlight, quieter than the fill.
    backgroundColor: `${rebate.outline}99`,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: rebate.textSecondary,
  },
  centreTick: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1,
    width: 2,
    height: 14,
    backgroundColor: rebate.textSecondary,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: palette.white,
    ...elevation.handle,
  },
});
