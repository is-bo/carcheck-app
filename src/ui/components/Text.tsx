import { forwardRef } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useSurface } from '../surface';
import { customerType, fontScaleCap, marker, type, type TypeStyle } from '../theme/tokens';

type EmployeeVariant = keyof typeof type;
type CustomerVariant = keyof typeof customerType;
export type TextVariant = EmployeeVariant | `customer.${CustomerVariant}`;

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'accent'
  | 'error'
  | 'inverse'
  /** Damage inks: only for damage captions and glyph labels (Grease Pencil Rule). */
  | 'new'
  | 'uncertain';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Overrides tone. */
  color?: string;
  /** Tabular figures for anything that lines up (times, mileage, counts). */
  tabular?: boolean;
  align?: TextStyle['textAlign'];
}

/** Body text may grow to 2x with the system font size; chrome caps at 1.3x; customer text is never capped. */
const bodyVariants = new Set<EmployeeVariant>(['body', 'bodyStrong', 'bodySmall', 'numeric']);

export function resolveTypeStyle(variant: TextVariant): TypeStyle {
  if (variant.startsWith('customer.')) {
    return customerType[variant.slice('customer.'.length) as CustomerVariant];
  }
  return type[variant as EmployeeVariant];
}

function scaleCap(variant: TextVariant): number | undefined {
  if (variant.startsWith('customer.')) return fontScaleCap.customer;
  return bodyVariants.has(variant as EmployeeVariant) ? fontScaleCap.body : fontScaleCap.chrome;
}

/** Typographic primitive: every string in the app goes through a variant of the token scale. */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', tone = 'primary', color, tabular, align, style, maxFontSizeMultiplier, ...rest },
  ref,
) {
  const { colors } = useSurface();
  const toneColor: Record<TextTone, string> = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    error: colors.error,
    inverse: colors.onPrimary,
    new: marker.new.uiColor,
    uncertain: marker.uncertain.uiColor,
  };
  const t = resolveTypeStyle(variant);
  return (
    <RNText
      ref={ref}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? scaleCap(variant)}
      style={[
        t,
        { color: color ?? toneColor[tone], includeFontPadding: false },
        tabular && { fontVariant: ['tabular-nums'] },
        align && { textAlign: align },
        style,
      ]}
      {...rest}
    />
  );
});
