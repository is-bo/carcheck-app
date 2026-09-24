import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, ease } from '../motion';
import { useSurface } from '../surface';
import { icon as iconTokens, lines, radii, touch } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { slopTo48, Touchable } from './Touchable';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  /** null = nothing selected yet (optional severity). */
  value: T | null;
  onChange: (value: T) => void;
  /** Names the group for screen readers ("Compare mode"). */
  accessibilityLabel: string;
  disabled?: boolean;
}

/**
 * 44 dp outlined segments; the selected one is filled with ink (on rebate: on-rebate fill, ink
 * text). The fill slides between segments and carries its own inverted labels, clipped to the
 * fill, so the text never flashes white-on-white mid-move.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  disabled,
}: SegmentedControlProps<T>) {
  const { tone, colors } = useSurface();
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = options.findIndex((o) => o.value === value);
  const segment = options.length > 0 ? width / options.length : 0;
  const x = useSharedValue(0);
  const shown = useSharedValue(index >= 0 ? 1 : 0);

  useEffect(() => {
    if (index < 0 || segment === 0) {
      shown.set(withTiming(0, { duration: duration.fast }));
      return;
    }
    const to = index * segment;
    const wasHidden = shown.get() === 0;
    x.set(reduceMotion || wasHidden ? to : withTiming(to, { duration: duration.base, easing: ease.standard }));
    shown.set(withTiming(1, { duration: wasHidden ? duration.fast : 0 }));
  }, [index, segment, reduceMotion, x, shown]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: x.get() }],
  }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -x.get() }] }));

  const border = tone === 'rebate' ? colors.divider : colors.text;
  const fill = colors.primary;
  const onFill = colors.onPrimary;

  const labelRow = (color: string) =>
    options.map((o) => (
      <View key={o.value} style={[styles.segment, { width: segment }]}>
        {o.icon ? <Icon icon={o.icon} size={iconTokens.sizeSmall} color={color} /> : null}
        <Text variant="button" color={color} numberOfLines={1}>
          {o.label}
        </Text>
      </View>
    ));

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - lines.control * 2)}
      style={[styles.frame, { borderColor: border }, disabled && styles.disabled]}
    >
      {/* Base layer: resting labels and dividers. */}
      <View style={styles.row} pointerEvents="none">
        {labelRow(colors.text)}
        {options.slice(1).map((o, i) => (
          <View
            key={o.value}
            style={[styles.divider, { left: segment * (i + 1) - lines.control / 2, backgroundColor: border }]}
          />
        ))}
      </View>
      {/* Moving fill with inverted labels, clipped to the selected segment. */}
      {segment > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.fill, { width: segment, backgroundColor: fill }, fillStyle]}>
          <Animated.View style={[styles.row, { width }, counterStyle]}>{labelRow(onFill)}</Animated.View>
        </Animated.View>
      ) : null}
      {/* Touch layer. */}
      <View style={[StyleSheet.absoluteFill, styles.row]}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Touchable
              key={o.value}
              disabled={disabled}
              dimmed={false}
              onPress={() => !selected && onChange(o.value)}
              hitSlop={{ ...slopTo48(touch.segmentedHeight, 1), left: 0, right: 0 }}
              focusRadius={radii.sm}
              noPressOpacity
              accessibilityRole="radio"
              accessibilityLabel={o.accessibilityLabel ?? o.label}
              accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
              style={styles.hit}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: touch.segmentedHeight,
    borderWidth: lines.control,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', height: '100%' },
  segment: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  divider: { position: 'absolute', top: 0, bottom: 0, width: lines.control },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  hit: { flex: 1 },
  disabled: { opacity: 0.4 },
});
