import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSurface } from '../surface';
import { fontFamily, layout } from '../theme/tokens';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  /** Shown after the title in tertiary tabular figures ("Due back 2"). */
  count?: number;
  /** A trailing quiet action ("All history"). */
  action?: ReactNode;
  /** Drop the 22 dp top gap (first section under a search field or top bar). */
  flush?: boolean;
}

/**
 * Sentence-case Label above a list group (No-Eyebrow Rule: never tracked caps). 22 dp above,
 * 6 dp below. On rebate it steps down to secondary grey.
 */
export function SectionHeader({ title, count, action, flush }: SectionHeaderProps) {
  const { tone } = useSurface();
  return (
    <View style={[styles.row, flush && styles.flush]}>
      <View accessible accessibilityRole="header" style={styles.titleGroup}>
        <Text variant={tone === 'rebate' ? 'labelSmall' : 'label'} tone={tone === 'rebate' ? 'secondary' : 'primary'}>
          {title}
        </Text>
        {count != null ? (
          <Text variant="label" tone="tertiary" tabular style={styles.count}>
            {count}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
    paddingTop: layout.sectionGapTop,
    paddingBottom: layout.sectionGapBottom,
    paddingHorizontal: layout.screenGutter,
  },
  flush: { paddingTop: 8 },
  titleGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  count: { fontFamily: fontFamily.medium },
});
