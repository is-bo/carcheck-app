/**
 * Rebate-rail controls for CaptureCamera (DESIGN.md "Camera & comparison chrome"): rail buttons,
 * the 80 dp shutter, the BEFORE ghost opacity slider, photo tags and registration marks.
 */
import { useMemo, type ComponentType, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { fontScaleCap, icon, lines, overlay, palette, radii, rebate, touch, type as typeTokens } from '@/ui/theme/tokens';

import type { Size } from '../geometry';

type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number; absoluteStrokeWidth?: boolean }>;

export function RailButton({
  Icon,
  label,
  onPress,
  active = false,
  disabled = false,
  accessibilityLabel,
}: {
  Icon: IconComponent;
  label?: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected: active }}
      android_ripple={{ color: rebate.surfacePressed, borderless: true, radius: touch.iconButton / 2 + 8 }}
      style={({ pressed }) => [
        styles.railButton,
        active && styles.railButtonActive,
        pressed && styles.pressedIos,
        disabled && styles.disabled,
      ]}
    >
      <Icon size={icon.sizeLarge} color={rebate.text} strokeWidth={icon.stroke} absoluteStrokeWidth />
      {label ? (
        <Text style={styles.railLabel} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function Shutter({
  onPress,
  busy,
  disabled,
  accessibilityLabel,
}: {
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={[styles.shutter, disabled && !busy && styles.disabled]}
    >
      {({ pressed }) => (
        <View style={[styles.shutterDisc, pressed && styles.shutterDiscPressed]}>
          {busy ? <ActivityIndicator size="small" color={palette.ink} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Photo tag: 78% rebate plate over the frame (title, nudge, notices). */
export function PhotoTag({
  children,
  Icon,
  style,
}: {
  children: ReactNode;
  Icon?: IconComponent;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.tag, style]} pointerEvents="none">
      {Icon ? <Icon size={icon.sizeInline} color={overlay.tagText} strokeWidth={icon.stroke} absoluteStrokeWidth /> : null}
      <View style={styles.tagText}>{children}</View>
    </View>
  );
}

export function TagTitle({ children }: { children: string }) {
  return (
    <Text style={styles.tagTitle} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome}>
      {children}
    </Text>
  );
}

export function TagLine({ children }: { children: string }) {
  return (
    <Text style={styles.tagLine} numberOfLines={2} maxFontSizeMultiplier={fontScaleCap.chrome}>
      {children}
    </Text>
  );
}

/** Corner registration marks and centre cross: white over a rebate halo, legible on any scene. */
export function RegistrationMarks({ frame }: { frame: Size }) {
  const inset = 12;
  const arm = 18;
  const cross = 9;
  const { width: w, height: h } = frame;
  const cx = w / 2;
  const cy = h / 2;
  const d = [
    `M${inset} ${inset + arm}V${inset}H${inset + arm}`,
    `M${w - inset - arm} ${inset}H${w - inset}V${inset + arm}`,
    `M${w - inset} ${h - inset - arm}V${h - inset}H${w - inset - arm}`,
    `M${inset + arm} ${h - inset}H${inset}V${h - inset - arm}`,
    `M${cx - cross} ${cy}H${cx + cross}M${cx} ${cy - cross}V${cy + cross}`,
  ].join('');
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <SvgPath d={d} stroke={overlay.guideHalo} strokeOpacity={0.55} strokeWidth={3.5} fill="none" strokeLinecap="square" />
      <SvgPath d={d} stroke={overlay.guideStroke} strokeWidth={1.5} fill="none" strokeLinecap="square" />
    </Svg>
  );
}

const SLIDER_HANDLE = 24;
const SLIDER_PAD = 14;

/**
 * BEFORE ghost opacity slider. `level` is written on the UI thread, so dragging never re-renders
 * the camera; `onCommit` gets the final level when the finger lifts.
 */
export function GhostSlider({
  level,
  max,
  vertical,
  length,
  value,
  onCommit,
  accessibilityLabel,
}: {
  level: SharedValue<number>;
  max: number;
  vertical: boolean;
  /** Track length in dp. */
  length: number;
  /** Last committed level (for accessibility). */
  value: number;
  onCommit: (level: number) => void;
  accessibilityLabel: string;
}) {
  const pan = useMemo(() => {
    const toLevel = (x: number, y: number) => {
      'worklet';
      const pos = vertical ? y : x;
      const t = Math.min(1, Math.max(0, (pos - SLIDER_PAD) / length));
      return (vertical ? 1 - t : t) * max;
    };
    return Gesture.Pan()
      .minDistance(0)
      .onBegin((e) => {
        'worklet';
        level.set(toLevel(e.x, e.y));
      })
      .onUpdate((e) => {
        'worklet';
        level.set(toLevel(e.x, e.y));
      })
      .onFinalize(() => {
        'worklet';
        scheduleOnRN(onCommit, level.get());
      });
  }, [length, level, max, onCommit, vertical]);

  const handleStyle = useAnimatedStyle(() => {
    const f = max > 0 ? level.get() / max : 0;
    const offset = (vertical ? 1 - f : f) * length + SLIDER_PAD - SLIDER_HANDLE / 2;
    return { transform: vertical ? [{ translateY: offset }] : [{ translateX: offset }] };
  });
  const fillStyle = useAnimatedStyle(() => {
    const f = max > 0 ? level.get() / max : 0;
    return vertical ? { height: f * length } : { width: f * length };
  });

  const step = (dir: 1 | -1) => onCommit(Math.min(max, Math.max(0, Math.round((value + dir * 0.1) * 10) / 10)));
  const box = vertical
    ? { width: touch.sliderHandle, height: length + 2 * SLIDER_PAD }
    : { width: length + 2 * SLIDER_PAD, height: touch.sliderHandle };

  return (
    <GestureDetector gesture={pan}>
      <View
        style={box}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: 0, max: Math.round(max * 100), now: Math.round(value * 100), text: `${Math.round(value * 100)}%` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View
          style={
            vertical
              ? [styles.trackV, { top: SLIDER_PAD, height: length }]
              : [styles.trackH, { left: SLIDER_PAD, width: length }]
          }
        >
          <Animated.View style={[vertical ? styles.fillV : styles.fillH, fillStyle]} />
        </View>
        <Animated.View style={[styles.handle, vertical ? styles.handleV : styles.handleH, handleStyle]} />
      </View>
    </GestureDetector>
  );
}

const TRACK = 4;

const styles = StyleSheet.create({
  railButton: {
    minWidth: touch.iconButton,
    minHeight: touch.iconButton + 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  railButtonActive: {
    backgroundColor: rebate.surfacePressed,
  },
  railLabel: {
    ...typeTokens.caption,
    color: rebate.textSecondary,
  },
  pressedIos: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  shutter: {
    width: touch.shutter,
    height: touch.shutter,
    borderRadius: touch.shutter / 2,
    borderWidth: 4,
    borderColor: rebate.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDisc: {
    width: touch.shutter - 16,
    height: touch.shutter - 16,
    borderRadius: (touch.shutter - 16) / 2,
    backgroundColor: rebate.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDiscPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.plate,
    backgroundColor: overlay.tagBackground,
  },
  tagText: {
    flexShrink: 1,
    alignItems: 'center',
  },
  tagTitle: {
    ...typeTokens.labelSmall,
    color: overlay.tagText,
    textAlign: 'center',
  },
  tagLine: {
    ...typeTokens.caption,
    color: overlay.tagTextSecondary,
    textAlign: 'center',
  },
  trackV: {
    position: 'absolute',
    left: (touch.sliderHandle - TRACK) / 2,
    width: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: rebate.divider,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  trackH: {
    position: 'absolute',
    top: (touch.sliderHandle - TRACK) / 2,
    height: TRACK,
    borderRadius: TRACK / 2,
    backgroundColor: rebate.divider,
    overflow: 'hidden',
  },
  fillV: {
    width: TRACK,
    backgroundColor: rebate.text,
  },
  fillH: {
    height: TRACK,
    backgroundColor: rebate.text,
  },
  handle: {
    position: 'absolute',
    width: SLIDER_HANDLE,
    height: SLIDER_HANDLE,
    borderRadius: SLIDER_HANDLE / 2,
    backgroundColor: rebate.text,
    borderWidth: lines.control,
    borderColor: palette.rebate,
  },
  handleV: {
    top: 0,
    left: (touch.sliderHandle - SLIDER_HANDLE) / 2,
  },
  handleH: {
    left: 0,
    top: (touch.sliderHandle - SLIDER_HANDLE) / 2,
  },
});
