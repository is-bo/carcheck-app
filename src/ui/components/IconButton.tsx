import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useSurface } from '../surface';
import { icon as iconTokens, touch } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Touchable } from './Touchable';

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone has no name for a screen reader. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** 'large' = 28 dp glyph for camera rails. */
  size?: 'default' | 'large';
  color?: string;
  /** Toggle buttons (Guide, list view) report their state. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 48 dp round target. Pressed state is a circle, the one place a control may be round. */
export function IconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  onLongPress,
  disabled,
  size = 'default',
  color,
  selected,
  style,
  testID,
}: IconButtonProps) {
  const { colors } = useSurface();
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      rippleRadius={touch.iconButton / 2}
      noPressOpacity
      focusRadius={touch.iconButton / 2}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, checked: selected }}
      pressedStyle={{ backgroundColor: colors.surfacePressed }}
      style={[styles.base, selected && { backgroundColor: colors.surfacePressed }, style]}
    >
      <Icon icon={icon} size={size === 'large' ? iconTokens.sizeLarge : iconTokens.size} color={color ?? colors.text} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: touch.iconButton,
    height: touch.iconButton,
    borderRadius: touch.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
