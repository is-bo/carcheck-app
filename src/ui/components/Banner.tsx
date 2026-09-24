import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSurface } from '../surface';
import { layout } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';

export interface BannerProps {
  icon: LucideIcon;
  /** One sentence. */
  message: string;
  /** Optional quiet Button ("Back up", "Check"). */
  action?: ReactNode;
}

/**
 * Inline grey-card band: low storage, known-damage carry-over, "Back up your data".
 * Warnings use ink and an icon, never red (Grease Pencil Rule).
 */
export function Banner({ icon, message, action }: BannerProps) {
  const { colors } = useSurface();
  return (
    <View style={[styles.band, { backgroundColor: colors.surfaceTint }]} accessibilityRole="summary">
      <Icon icon={icon} color={colors.textSecondary} />
      <View style={styles.body}>
        <Text variant="body">{message}</Text>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: layout.screenGutter,
  },
  body: { flex: 1 },
  // Quiet buttons carry 12 dp side padding; pull back so the label aligns with the sentence.
  action: { marginLeft: -12, marginTop: 2, marginBottom: -8 },
});
