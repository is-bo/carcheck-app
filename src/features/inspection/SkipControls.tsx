/**
 * Skipping an angle, the same at pick-up and return (UX §3): the white Skip control on the
 * capture rail, and a sheet where one tap on a reason skips (or "Skip without a reason").
 */
import { SkipForward } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { SkipReason } from '@/domain/types';
import { BottomSheet, Button, Chip, Icon, Text, Touchable } from '@/ui';
import { layout, rebate, touch } from '@/ui/theme/tokens';

const SKIP_REASONS: readonly { value: SkipReason; label: string }[] = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'too_dark', label: 'Too dark' },
  { value: 'other', label: 'Other' },
];

export function SkipControl({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      dimmed={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Skip ${label}`}
      style={styles.skip}
    >
      <Icon icon={SkipForward} size={20} color={rebate.text} />
      <Text variant="bodyStrong" color={rebate.text}>
        Skip
      </Text>
    </Touchable>
  );
}

export interface SkipSheetProps {
  open: boolean;
  /** Angle name ("Front left"). */
  label: string;
  onSkip: (reason: SkipReason | null) => void;
  onClose: () => void;
}

export function SkipSheet({ open, label, onSkip, onClose }: SkipSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[236]}
      accessibilityLabel={`Skip ${label}`}
      header={<Text variant="titleL">Skip {label.toLowerCase()}?</Text>}
    >
      <View style={styles.body}>
        <Text variant="bodySmall" tone="secondary">
          Why? The report shows “Not photographed” with the reason.
        </Text>
        <View style={styles.reasons}>
          {SKIP_REASONS.map((r) => (
            <View key={r.value} style={styles.fill}>
              <Chip label={r.label} selected={false} fill onPress={() => onSkip(r.value)} />
            </View>
          ))}
        </View>
        <Button label="Skip without a reason" variant="quiet" onPress={() => onSkip(null)} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  skip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: touch.min,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  body: { paddingHorizontal: layout.screenGutter, gap: 12 },
  reasons: { flexDirection: 'row', gap: 8 },
});
