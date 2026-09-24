import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSurface } from '../surface';
import { layout, lines } from '../theme/tokens';
import { useToastAnchor } from './Toast';

export interface ActionFooterProps {
  children: ReactNode;
  /** 1 dp rule above, for when content scrolls underneath. */
  rule?: boolean;
  /** Buttons side by side (Clear | Confirm signature) instead of stacked. */
  row?: boolean;
  /** Keyboard is up: drop the gesture-bar inset, the keyboard already covers it. */
  compact?: boolean;
  /** Customer hand-off uses the 20 dp customer gutter. */
  gutter?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The bottom-anchored primary action area of a flow screen: full-width buttons 16 dp above the
 * bottom inset, in thumb reach. The snackbar positions itself above it.
 */
export function ActionFooter({ children, rule, row, compact, gutter = layout.screenGutter, style }: ActionFooterProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useSurface();
  const anchor = useToastAnchor();
  return (
    <View
      {...anchor}
      style={[
        styles.footer,
        {
          paddingHorizontal: gutter,
          paddingBottom: (compact ? 0 : insets.bottom) + layout.bottomActionInset,
          backgroundColor: colors.background,
        },
        rule && { borderTopWidth: lines.divider, borderTopColor: colors.divider },
        style,
      ]}
    >
      <View style={row ? styles.row : styles.stack}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingTop: 12 },
  stack: { gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
});
