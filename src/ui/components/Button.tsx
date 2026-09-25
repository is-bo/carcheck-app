import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useSurface } from '../surface';
import { icon as iconTokens, lines, palette, radii, touch } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { slopTo48, Touchable } from './Touchable';

export type ButtonVariant =
  /** Ink fill. The one primary action per screen. Inverts on rebate. */
  | 'primary'
  /** Cyanotype fill. Only the customer's binding actions (Sign agreement, Confirm signature). */
  | 'accent'
  /** 1.5 dp ink outline. */
  | 'secondary'
  /** Cyanotype wash (Resume). */
  | 'tonal'
  /** Cyanotype text, usually with a leading icon (+ Note). */
  | 'quiet'
  /** Error-red outline with the trash icon. */
  | 'destructive'
  /** Error fill: only the confirming button of a destructive dialog. */
  | 'destructiveFilled';

export type ButtonSize = 'large' | 'small' | 'customer';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'leading' | 'trailing';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const heights: Record<ButtonSize, number> = {
  large: touch.buttonHeight,
  small: touch.buttonHeightSmall,
  customer: touch.buttonHeightCustomer,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  iconPosition = 'leading',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { tone, colors } = useSurface();
  const onRebate = tone === 'rebate';

  const look: { bg: string; fg: string; border?: string; ripple: string } = (() => {
    switch (variant) {
      case 'primary':
        return {
          bg: colors.primary,
          fg: colors.onPrimary,
          ripple: onRebate ? 'rgba(19,21,23,0.16)' : 'rgba(255,255,255,0.22)',
        };
      case 'accent':
        return { bg: colors.accent, fg: colors.onAccent, ripple: 'rgba(255,255,255,0.22)' };
      case 'secondary':
        return {
          bg: 'transparent',
          fg: colors.text,
          border: onRebate ? palette.onRebate2 : colors.text,
          ripple: onRebate ? 'rgba(244,245,245,0.16)' : 'rgba(19,21,23,0.10)',
        };
      case 'tonal':
        return { bg: colors.accentWash, fg: colors.accent, ripple: 'rgba(31,78,150,0.16)' };
      case 'quiet':
        return { bg: 'transparent', fg: colors.accent, ripple: 'rgba(31,78,150,0.12)' };
      case 'destructive':
        return { bg: 'transparent', fg: colors.error, border: colors.error, ripple: 'rgba(180,35,24,0.12)' };
      case 'destructiveFilled':
        return { bg: colors.error, fg: palette.white, ripple: 'rgba(255,255,255,0.22)' };
    }
  })();

  const height = heights[size];
  const iconSize = size === 'customer' ? iconTokens.size : iconTokens.sizeSmall;
  const glyph = loading ? (
    <ActivityIndicator size={16} color={look.fg} />
  ) : icon ? (
    <Icon icon={icon} size={iconSize} color={look.fg} />
  ) : null;
  const inactive = disabled || loading;

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      dimmed={disabled}
      rippleColor={look.ripple}
      hitSlop={slopTo48(height)}
      focusRadius={radii.md}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        styles.base,
        {
          minHeight: height,
          paddingVertical: size === 'customer' ? 8 : 0,
          paddingHorizontal: variant === 'quiet' ? 12 : size === 'small' ? 14 : 20,
          backgroundColor: look.bg,
          borderColor: look.border ?? 'transparent',
          borderWidth: look.border ? lines.control : 0,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      <View style={styles.content}>
        {iconPosition === 'leading' ? glyph : null}
        <Text
          // Customer type is never capped (large system font): wrap to two lines instead of "Confirm sig…".
          numberOfLines={size === 'customer' ? 2 : 1}
          style={size === 'customer' ? styles.customerLabel : undefined}
          variant={size === 'customer' ? 'customer.button' : size === 'small' ? 'button' : 'buttonLarge'}
          color={look.fg}
        >
          {label}
        </Text>
        {iconPosition === 'trailing' ? glyph : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customerLabel: { textAlign: 'center', flexShrink: 1 },
});
