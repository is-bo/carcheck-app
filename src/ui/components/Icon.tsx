import type { LucideIcon } from 'lucide-react-native';

import { useSurface } from '../surface';
import { icon as iconTokens } from '../theme/tokens';

export type { LucideIcon };

export interface IconProps {
  icon: LucideIcon;
  /** 24 default, 20 in dense rows and buttons, 16 inline with text, 28 on camera rails. */
  size?: number;
  color?: string;
}

/** Lucide at DESIGN.md weight: 2 dp absolute stroke at every size. Decorative (hidden from a11y). */
export function Icon({ icon: Glyph, size = iconTokens.size, color }: IconProps) {
  const { colors } = useSurface();
  return (
    <Glyph
      size={size}
      color={color ?? colors.text}
      strokeWidth={iconTokens.stroke}
      absoluteStrokeWidth
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
