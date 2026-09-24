import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { CircleAlert, Search, X } from 'lucide-react-native';

import { useSurface } from '../surface';
import { fontScaleCap, icon as iconTokens, lines, radii, type } from '../theme/tokens';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export type TextFieldVariant = 'text' | 'numeric' | 'plate' | 'search' | 'mileage';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'editable'> {
  /** Field label above the input (Label style). Search fields may omit it. */
  label?: string;
  /** Appends a quiet "(optional)" to the label. */
  optional?: boolean;
  /** Helper line below; replaced by the error when there is one. */
  hint?: string;
  /** Error sentence. Adds a 1.5 dp error border and an icon. */
  error?: string | null;
  variant?: TextFieldVariant;
  /** Suffix inside the field ("km"). Used by mileage. */
  unit?: string;
  disabled?: boolean;
}

/**
 * Grey-card field, no border at rest; 1.5 dp cyanotype border on focus, error border on error.
 * Variants set keyboard, capitalisation and type (plate tracking, numeric-large mileage).
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    optional,
    hint,
    error,
    variant = 'text',
    unit,
    disabled,
    multiline,
    onFocus,
    onBlur,
    value,
    onChangeText,
    ...rest
  },
  ref,
) {
  const { colors } = useSurface();
  const [focused, setFocused] = useState(false);

  const inputType =
    variant === 'mileage'
      ? type.numericLarge
      : variant === 'plate'
        ? type.plate
        : variant === 'numeric'
          ? type.numeric
          : type.body;
  const variantProps: Partial<TextInputProps> =
    variant === 'numeric' || variant === 'mileage'
      ? { keyboardType: 'number-pad', inputMode: 'numeric' }
      : variant === 'plate'
        ? { autoCapitalize: 'characters', autoCorrect: false, spellCheck: false, autoComplete: 'off' }
        : variant === 'search'
          ? { returnKeyType: 'search', autoCorrect: false, inputMode: 'search' }
          : {};

  const borderColor = error ? colors.error : focused ? colors.accent : 'transparent';
  const describedHint = error ?? hint;

  return (
    <View style={disabled && styles.disabled}>
      {label ? (
        <Text variant="label" style={styles.label}>
          {label}
          {optional ? (
            <Text variant="label" tone="tertiary" style={styles.optional}>
              {' '}
              (optional)
            </Text>
          ) : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.surfaceTint,
            borderColor,
            minHeight: variant === 'mileage' ? 64 : 48,
            alignItems: multiline ? 'flex-start' : 'center',
          },
        ]}
      >
        {variant === 'search' ? (
          <View style={styles.leadingIcon}>
            <Icon icon={Search} size={iconTokens.sizeSmall} color={colors.textSecondary} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          {...variantProps}
          {...rest}
          value={value}
          onChangeText={onChangeText}
          multiline={multiline}
          editable={!disabled}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          maxFontSizeMultiplier={fontScaleCap.body}
          accessibilityLabel={rest.accessibilityLabel ?? label ?? rest.placeholder}
          accessibilityHint={describedHint ?? undefined}
          accessibilityState={{ disabled: !!disabled }}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            inputType,
            { color: colors.text },
            multiline && styles.multiline,
            variant === 'search' && styles.inputSearch,
          ]}
        />
        {unit ? (
          <Text variant={variant === 'mileage' ? 'titleM' : 'body'} tone="secondary" style={styles.unit}>
            {unit}
          </Text>
        ) : null}
        {variant === 'search' && value ? (
          <IconButton icon={X} accessibilityLabel="Clear search" onPress={() => onChangeText?.('')} />
        ) : null}
        {error ? (
          <View style={styles.trailingIcon}>
            <Icon icon={CircleAlert} size={iconTokens.sizeSmall} color={colors.error} />
          </View>
        ) : null}
      </View>
      {describedHint ? (
        <Text
          variant="bodySmall"
          tone={error ? 'error' : 'secondary'}
          style={styles.hint}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {describedHint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { marginBottom: 6 },
  optional: { fontFamily: type.caption.fontFamily },
  box: {
    flexDirection: 'row',
    borderRadius: radii.md,
    borderWidth: lines.control,
    paddingHorizontal: 12.5,
  },
  input: { flex: 1, paddingVertical: 10, paddingHorizontal: 0, includeFontPadding: false },
  inputSearch: { paddingLeft: 0 },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  leadingIcon: { marginRight: 10 },
  trailingIcon: { marginLeft: 8 },
  unit: { marginLeft: 8 },
  hint: { marginTop: 6 },
  disabled: { opacity: 0.4 },
});
