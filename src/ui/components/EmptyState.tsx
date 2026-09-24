import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSurface } from '../surface';
import { layout } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** What will appear here: one Title M sentence ("No rentals yet."). */
  title: string;
  /** How it gets there: one Body line. */
  body: string;
  /** The relevant action, if the screen doesn't already offer it (FAB). */
  action?: ReactNode;
}

/** Left-aligned, no illustration: a 48 dp outline icon, a sentence, a line, maybe an action. */
export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  const { colors } = useSurface();
  return (
    <View style={styles.wrap}>
      <Icon icon={icon} size={48} color={colors.textTertiary} />
      <Text variant="titleM" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text variant="body" tone="secondary" style={styles.body}>
        {body}
      </Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: layout.screenGutter, paddingTop: 32, paddingBottom: 24, maxWidth: 480 },
  title: { marginTop: 16 },
  body: { marginTop: 6 },
  action: { marginTop: 20 },
});
