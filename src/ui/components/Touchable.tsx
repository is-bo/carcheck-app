import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useSurface } from '../surface';

export interface TouchableProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  /** Extra style while pressed, on both platforms (e.g. a pressed-row fill). */
  pressedStyle?: StyleProp<ViewStyle>;
  /** Android ripple colour; defaults to an ink or paper wash for the surface. */
  rippleColor?: string;
  /** Round ripple that may exceed the bounds (icon buttons). */
  rippleRadius?: number;
  /** Skip the iOS 0.7 opacity (when pressedStyle already carries the feedback). */
  noPressOpacity?: boolean;
  /** Corner radius of the focus ring (outer), matching the control's own radius. */
  focusRadius?: number;
  /** Draw at 40% opacity. Defaults to `disabled`; a loading button is disabled but not dimmed. */
  dimmed?: boolean;
  children?: ReactNode | ((state: PressableStateCallbackType) => ReactNode);
}

/**
 * The single press primitive (DESIGN.md › Components): ripple on Android, opacity 0.7 on iOS,
 * a 2 dp cyanotype focus ring with 2 dp offset for keyboard / D-pad focus, 40% when disabled.
 */
export function Touchable({
  style,
  pressedStyle,
  rippleColor,
  rippleRadius,
  noPressOpacity,
  focusRadius = 6,
  disabled,
  dimmed = !!disabled,
  children,
  onFocus,
  onBlur,
  ...rest
}: TouchableProps) {
  const { tone, colors } = useSurface();
  const [focused, setFocused] = useState(false);
  const ripple = rippleColor ?? (tone === 'rebate' ? 'rgba(244,245,245,0.16)' : 'rgba(19,21,23,0.10)');

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      android_ripple={
        disabled
          ? undefined
          : { color: ripple, borderless: rippleRadius != null, radius: rippleRadius, foreground: true }
      }
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed && pressedStyle,
        state.pressed && Platform.OS === 'ios' && !noPressOpacity && styles.pressedIos,
        dimmed && styles.disabled,
      ]}
    >
      {(state) => (
        <>
          {typeof children === 'function' ? children(state) : children}
          {focused ? (
            <View
              pointerEvents="none"
              style={[styles.focusRing, { borderColor: colors.focusRing, borderRadius: focusRadius + 4 }]}
            />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/** hitSlop that grows a control of `size` dp to the 48 dp touch minimum. */
export function slopTo48(height: number, width = height) {
  const v = Math.max(0, Math.ceil((48 - height) / 2));
  const h = Math.max(0, Math.ceil((48 - width) / 2));
  return { top: v, bottom: v, left: h, right: h };
}

const styles = StyleSheet.create({
  pressedIos: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  focusRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
  },
});
