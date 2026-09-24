import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, X } from 'lucide-react-native';

import { useSurface } from '../surface';
import { layout } from '../theme/tokens';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { Touchable } from './Touchable';

/** Start flow step titles (UX_FLOWS §2). The return flow passes its own. */
export const START_STEPS = ['Vehicle', 'Customer', 'Inspect', 'Details', 'Sign'] as const;
export const RETURN_STEPS = ['Inspect', 'Compare', 'Details', 'Report'] as const;

export interface StepHeaderProps {
  /** 1-based current step. */
  step: number;
  steps: readonly string[];
  /** ✕ just leaves: the draft is already saved, so no dialog. */
  onClose: () => void;
  /** Opens the step list sheet (jump back to completed steps). */
  onTitlePress?: () => void;
  /** Screen supplies the top inset; pass true when used outside Screen. */
  insetTop?: boolean;
}

/**
 * Flow top bar: ✕, "3 of 5 · Inspect" (Title M) and a segmented progress bar underneath:
 * 4 dp segments with 2 dp gaps, ink when done, cyanotype when current, rule when pending.
 */
export function StepHeader({ step, steps, onClose, onTitlePress, insetTop }: StepHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useSurface();
  const total = steps.length;
  const current = Math.min(Math.max(step, 1), total);
  const name = steps[current - 1] ?? '';
  const titleText = `${current} of ${total} · ${name}`;

  const title = (
    <View style={styles.titleInner}>
      <Text variant="titleM" tabular numberOfLines={1}>
        {titleText}
      </Text>
      {onTitlePress ? <Icon icon={ChevronDown} size={20} color={colors.textSecondary} /> : null}
    </View>
  );

  return (
    <View style={{ paddingTop: insetTop ? insets.top : 0, paddingLeft: insets.left, paddingRight: insets.right }}>
      <View style={styles.bar}>
        <IconButton icon={X} accessibilityLabel="Close" accessibilityHint="Your progress is saved" onPress={onClose} />
        {onTitlePress ? (
          <Touchable
            onPress={onTitlePress}
            noPressOpacity
            pressedStyle={{ backgroundColor: colors.surfacePressed }}
            accessibilityRole="button"
            accessibilityLabel={`Step ${current} of ${total}, ${name}`}
            accessibilityHint="Shows all steps"
            style={styles.titleButton}
          >
            {title}
          </Touchable>
        ) : (
          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`Step ${current} of ${total}, ${name}`}
            style={styles.titleButton}
          >
            {title}
          </View>
        )}
      </View>
      <View
        style={styles.segments}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Progress"
        accessibilityValue={{ min: 1, max: total, now: current }}
      >
        {steps.map((s, i) => (
          <View
            key={s}
            style={[
              styles.segment,
              { backgroundColor: i + 1 < current ? colors.text : i + 1 === current ? colors.accent : colors.divider },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: layout.topBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 16,
    gap: 4,
  },
  titleButton: { flexShrink: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 6 },
  titleInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  segments: { flexDirection: 'row', gap: 2, paddingHorizontal: layout.screenGutter, paddingBottom: 8 },
  segment: { flex: 1, height: 4 },
});
