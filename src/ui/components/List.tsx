import { Children, createContext, isValidElement, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { useSurface } from '../surface';
import { icon as iconTokens, layout, lines, palette } from '../theme/tokens';
import { Icon } from './Icon';
import { SectionHeader } from './SectionHeader';
import { Text } from './Text';
import { Touchable } from './Touchable';

interface RowPosition {
  last: boolean;
  band: boolean;
}

const RowPositionContext = createContext<RowPosition>({ last: false, band: false });

export interface ListSectionProps {
  title?: string;
  count?: number;
  action?: ReactNode;
  /** Grey-card band behind the rows (the Unfinished group). Grouping by tone, never by card. */
  band?: boolean;
  /** First section directly under a search field. */
  flush?: boolean;
  children: ReactNode;
}

/** A sentence-case header over full-bleed rows separated by 1 dp rules inset 16 dp. */
export function ListSection({ title, count, action, band = false, flush, children }: ListSectionProps) {
  const { colors } = useSurface();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View>
      {title ? <SectionHeader title={title} count={count} action={action} flush={flush} /> : null}
      <View style={band && { backgroundColor: colors.surfaceTint }}>
        {rows.map((row, i) => (
          <RowPositionContext.Provider key={row.key ?? i} value={{ last: i === rows.length - 1, band }}>
            {row}
          </RowPositionContext.Provider>
        ))}
      </View>
    </View>
  );
}

export interface ListRowProps {
  /** First line. A string renders as Body; pass a PlateFrame for vehicle rows. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Third line (status / due). */
  meta?: ReactNode;
  /** Leading glyph or thumbnail. */
  leading?: ReactNode;
  /** Inline action (a small Button) or value text. */
  trailing?: ReactNode;
  /** Show a chevron: the row navigates somewhere. */
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Spoken summary when the row's lines don't read well in sequence. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Hide the bottom rule (ListSection manages this for its last row). */
  divider?: boolean;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  chevron,
  onPress,
  onLongPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  divider,
  testID,
}: ListRowProps) {
  const { tone, colors } = useSurface();
  const pos = useContext(RowPositionContext);
  const showDivider = divider ?? !pos.last;
  const ruleColor = pos.band ? (tone === 'rebate' ? colors.divider : palette.paper3) : colors.divider;

  const line = (node: ReactNode, variant: 'body' | 'bodySmall', t: 'primary' | 'secondary') =>
    typeof node === 'string' || typeof node === 'number' ? (
      <Text variant={variant} tone={t} numberOfLines={variant === 'body' ? 2 : 1}>
        {node}
      </Text>
    ) : (
      node
    );

  const content = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.main}>
        {line(title, 'body', 'primary')}
        {subtitle != null ? <View style={styles.second}>{line(subtitle, 'bodySmall', 'secondary')}</View> : null}
        {meta != null ? <View style={styles.third}>{line(meta, 'bodySmall', 'secondary')}</View> : null}
      </View>
      {trailing}
      {chevron ? <Icon icon={ChevronRight} size={iconTokens.sizeSmall} color={colors.textSecondary} /> : null}
      {showDivider ? <View pointerEvents="none" style={[styles.rule, { backgroundColor: ruleColor }]} /> : null}
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <View
        testID={testID}
        style={styles.row}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </View>
    );
  }

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      noPressOpacity
      focusRadius={0}
      pressedStyle={{ backgroundColor: pos.band ? palette.paper3 : colors.surfacePressed }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={styles.row}
    >
      {content}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: layout.rowPaddingVertical,
    paddingHorizontal: layout.screenGutter,
  },
  leading: { alignSelf: 'center' },
  main: { flex: 1, minWidth: 0 },
  second: { marginTop: 5 },
  third: { marginTop: 1 },
  rule: {
    position: 'absolute',
    left: layout.screenGutter,
    right: 0,
    bottom: 0,
    height: lines.divider,
  },
});
