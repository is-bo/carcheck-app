import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { fontFamily, fontScaleCap, overlay, radii, space, type as typeTokens } from '@/ui/theme/tokens';

export interface PhotoTagProps {
  label: string;
  timeLabel?: string;
  align?: 'left' | 'right';
  /** Fades the tag with its layer (overlay mode). */
  opacity?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}

/** BEFORE / AFTER tag on a photo: Barlow 700 caps plus an edge-code timestamp on 78% rebate. */
export function PhotoTag({ label, timeLabel, align = 'left', opacity, style }: PhotoTagProps) {
  const fade = useAnimatedStyle(() => ({ opacity: opacity ? 0.35 + 0.65 * opacity.get() : 1 }));
  return (
    <Animated.View pointerEvents="none" style={[styles.tag, align === 'right' ? styles.right : styles.left, fade, style]}>
      <Text style={styles.label} maxFontSizeMultiplier={fontScaleCap.chrome}>
        {label}
      </Text>
      {timeLabel ? (
        <Text style={styles.time} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {timeLabel}
        </Text>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tag: {
    position: 'absolute',
    top: space[3],
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space[3],
    maxWidth: '70%',
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radii.plate,
    backgroundColor: overlay.tagBackground,
  },
  left: { left: space[3] },
  right: { right: space[3] },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.8,
    color: overlay.tagText,
  },
  time: {
    ...typeTokens.code,
    flexShrink: 1,
    color: overlay.tagTextSecondary,
  },
});
