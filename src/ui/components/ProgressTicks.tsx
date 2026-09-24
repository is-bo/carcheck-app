import { StyleSheet, View } from 'react-native';

import { useSurface } from '../surface';

export interface ProgressTicksProps {
  done: number;
  total?: number;
  /** Spoken form, e.g. "Inspection 5 of 8". Defaults to "5 of 8 done". */
  accessibilityLabel?: string;
}

/** The 8-tick capture progress on Unfinished rows: 10×4 dp ticks, ink when done. */
export function ProgressTicks({ done, total = 8, accessibilityLabel }: ProgressTicksProps) {
  const { colors } = useSurface();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? `${done} of ${total} done`}
      accessibilityValue={{ min: 0, max: total, now: done }}
      style={styles.row}
    >
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.tick, { backgroundColor: i < done ? colors.text : colors.divider }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
  tick: { width: 10, height: 4 },
});
