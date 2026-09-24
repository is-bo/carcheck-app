import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Building2, Camera } from 'lucide-react-native';

import { Button, Icon, Text, Touchable, useSurface } from '@/ui';
import { radii, space } from '@/ui/theme/tokens';

export interface LogoPickerProps {
  /** Absolute file URI of the current logo, or null. */
  uri: string | null;
  onPick: () => void;
  onRemove?: () => void;
  busy?: boolean;
  size?: number;
}

/**
 * Square logo tile with a camera badge (tap to add/change) plus explicit Change/Remove buttons,
 * shared by onboarding and Settings → Agency. Falls back to an ink monogram tile (DESIGN.md
 * §Customer hand-off) rather than a photo placeholder when no logo has been set.
 */
export function LogoPicker({ uri, onPick, onRemove, busy, size = 88 }: LogoPickerProps) {
  const { colors } = useSurface();
  return (
    <View style={styles.row}>
      <Touchable
        onPress={onPick}
        disabled={busy}
        noPressOpacity
        focusRadius={radii.md}
        accessibilityRole="button"
        accessibilityLabel={uri ? 'Change agency logo' : 'Add agency logo'}
        style={[styles.tile, { width: size, height: size, backgroundColor: colors.surfaceTint }]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
        ) : (
          <Icon icon={Building2} size={28} color={colors.textTertiary} />
        )}
        <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          <Icon icon={Camera} size={14} color={colors.onPrimary} />
        </View>
      </Touchable>
      <View style={styles.info}>
        <Text variant="label">Logo</Text>
        <Text variant="bodySmall" tone="secondary" style={styles.hint}>
          Shown on the customer hand-off screen and on printed documents.
        </Text>
        <View style={styles.actions}>
          <Button label={uri ? 'Change' : 'Add logo'} variant="secondary" size="small" onPress={onPick} loading={busy} />
          {uri && onRemove ? (
            <Button label="Remove" variant="quiet" size="small" onPress={onRemove} disabled={busy} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[5], alignItems: 'flex-start' },
  tile: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0, paddingTop: space[1] },
  hint: { marginTop: 2 },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
});
