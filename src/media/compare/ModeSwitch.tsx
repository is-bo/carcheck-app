import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { fontScaleCap, lines, radii, rebate, touch, type as typeTokens } from '@/ui/theme/tokens';

import type { CompareMode } from './types';

export const COMPARE_MODE_LABELS: Record<CompareMode, string> = {
  sideBySide: 'Side by side',
  overlay: 'Overlay',
  slider: 'Slider',
};

const MODES: CompareMode[] = ['sideBySide', 'overlay', 'slider'];

export interface ModeSwitchProps {
  mode: CompareMode;
  onChange: (mode: CompareMode) => void;
  style?: StyleProp<ViewStyle>;
}

/** Segmented Side by side | Overlay | Slider on rebate (DESIGN.md segmented control, inverted). */
export function ModeSwitch({ mode, onChange, style }: ModeSwitchProps) {
  return (
    <View style={[styles.group, style]} accessibilityRole="tablist">
      {MODES.map((m, i) => {
        const selected = m === mode;
        return (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(m)}
            style={[styles.segment, i > 0 && styles.divided, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome}>
              {COMPARE_MODE_LABELS[m]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    height: touch.segmentedHeight,
    borderWidth: lines.control,
    borderColor: rebate.outline,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  divided: {
    borderLeftWidth: lines.control,
    borderLeftColor: rebate.outline,
  },
  selected: {
    backgroundColor: rebate.primary,
  },
  label: {
    ...typeTokens.button,
    color: rebate.text,
  },
  selectedLabel: {
    color: rebate.onPrimary,
  },
});
