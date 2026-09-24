import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ease } from '../motion';
import { useSurface } from '../surface';
import { layout, lines, radii } from '../theme/tokens';

export interface SkeletonRowsProps {
  count?: number;
  /** Rental rows start with a plate-sized block. */
  plate?: boolean;
}

/** List loading: grey-card blocks at real text sizes, never a spinner over content. */
export function SkeletonRows({ count = 3, plate = true }: SkeletonRowsProps) {
  const { colors } = useSurface();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    opacity.set(withRepeat(withTiming(0.55, { duration: 800, easing: ease.standard }), -1, true));
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const block = { backgroundColor: colors.surfaceTint, borderRadius: radii.photo };

  return (
    <Animated.View style={pulse} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.row}>
          <View style={[block, plate ? styles.plate : styles.line1]} />
          <View style={[block, styles.line2]} />
          <View style={[block, styles.line3]} />
          {i < count - 1 ? <View style={[styles.rule, { backgroundColor: colors.divider }]} /> : null}
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: layout.rowPaddingVertical, paddingHorizontal: layout.screenGutter, gap: 6 },
  plate: { width: 92, height: 24 },
  line1: { width: '55%', height: 20 },
  line2: { width: '62%', height: 16 },
  line3: { width: '38%', height: 16 },
  rule: { position: 'absolute', left: layout.screenGutter, right: 0, bottom: 0, height: lines.divider },
});
