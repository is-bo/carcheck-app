import { ScrollView, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { useSurface } from '../surface';
import { fontFamily, lines, palette, radii, touch } from '../theme/tokens';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** radio (single-select group) or checkbox (multi-select). */
  role?: 'radio' | 'checkbox';
  disabled?: boolean;
  /** Stretch to fill a grid cell. */
  fill?: boolean;
  accessibilityLabel?: string;
}

/**
 * Rectangular 48 dp tile with a 1.5 dp outline, like a form's tick grid (never a pill).
 * Selected: ink fill, white 600 label with a leading check.
 */
export function Chip({ label, selected, onPress, role = 'radio', disabled, fill, accessibilityLabel }: ChipProps) {
  const { colors } = useSurface();
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      noPressOpacity
      focusRadius={radii.sm}
      pressedStyle={!selected && { backgroundColor: colors.surfacePressed }}
      rippleColor={selected ? 'rgba(255,255,255,0.2)' : undefined}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, selected, disabled: !!disabled }}
      style={[
        styles.chip,
        fill && styles.fillChip,
        selected
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: palette.white, borderColor: colors.outline },
      ]}
    >
      {selected ? <Icon icon={Check} size={16} color={colors.onPrimary} /> : null}
      <Text
        variant={selected ? 'button' : 'bodySmall'}
        color={selected ? colors.onPrimary : colors.text}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
        style={!selected && styles.restingLabel}
      >
        {label}
      </Text>
    </Touchable>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

interface ChipGroupBase<T extends string> {
  options: readonly ChipOption<T>[];
  /** 'grid' = rows of `columns` equal tiles (damage types); 'row' = one scrolling line (date chips). */
  layout?: 'grid' | 'row';
  columns?: number;
  /** Names the group for screen readers ("Damage type"). */
  accessibilityLabel: string;
  disabled?: boolean;
}

interface SingleProps<T extends string> extends ChipGroupBase<T> {
  mode?: 'single';
  value: T | null;
  onChange: (value: T | null) => void;
  /** Tapping the selected chip clears it. Default true. */
  allowDeselect?: boolean;
}

interface MultiProps<T extends string> extends ChipGroupBase<T> {
  mode: 'multi';
  value: readonly T[];
  onChange: (value: T[]) => void;
}

export type ChipGroupProps<T extends string> = SingleProps<T> | MultiProps<T>;

export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { options, layout = 'grid', columns = 4, accessibilityLabel, disabled } = props;

  const isSelected = (v: T) => (props.mode === 'multi' ? props.value.includes(v) : props.value === v);
  const toggle = (v: T) => {
    if (props.mode === 'multi') {
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else if (props.value === v) {
      if (props.allowDeselect !== false) props.onChange(null);
    } else {
      props.onChange(v);
    }
  };

  const chip = (o: ChipOption<T>, fill: boolean) => (
    <Chip
      key={o.value}
      label={o.label}
      selected={isSelected(o.value)}
      onPress={() => toggle(o.value)}
      role={props.mode === 'multi' ? 'checkbox' : 'radio'}
      disabled={disabled}
      fill={fill}
    />
  );

  const groupRole = props.mode === 'multi' ? undefined : 'radiogroup';

  if (layout === 'row') {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole={groupRole}
        accessibilityLabel={accessibilityLabel}
        contentContainerStyle={styles.rowLayout}
      >
        {options.map((o) => chip(o, false))}
      </ScrollView>
    );
  }

  const rows: ChipOption<T>[][] = [];
  for (let i = 0; i < options.length; i += columns) rows.push(options.slice(i, i + columns));
  return (
    <View accessibilityRole={groupRole} accessibilityLabel={accessibilityLabel} style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.gridRow}>
          {row.map((o) => chip(o, true))}
          {Array.from({ length: columns - row.length }, (_, k) => (
            <View key={`pad${k}`} style={styles.fill} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touch.chipHeight,
    borderWidth: lines.control,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
  },
  fill: { flex: 1, minWidth: 0 },
  fillChip: { flex: 1, minWidth: 0, paddingHorizontal: 4, gap: 3 },
  restingLabel: { fontFamily: fontFamily.medium },
  grid: { gap: 8 },
  gridRow: { flexDirection: 'row', gap: 8 },
  rowLayout: { gap: 8, paddingHorizontal: 16 },
});
