import { StyleSheet, View } from 'react-native';

import { SurfaceProvider } from '../surface';
import { elevation, layout, palette, radii, touch } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { useToastAnchor } from './Toast';
import { Touchable } from './Touchable';

export interface FabProps {
  icon: LucideIcon;
  /** A verb ("New rental"). The extended FAB always shows its label. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
}

/**
 * Extended FAB: the one primary action on a tab root, bottom-right, 16 dp above the nav bar.
 * Place it as the last child of a tab screen; it positions itself.
 */
export function Fab({ icon, label, onPress, disabled, accessibilityHint }: FabProps) {
  const anchor = useToastAnchor();
  return (
    <View {...anchor} style={[styles.shadow, elevation.fab]} pointerEvents="box-none">
      <SurfaceProvider tone="paper">
        <Touchable
          onPress={onPress}
          disabled={disabled}
          rippleColor="rgba(255,255,255,0.22)"
          focusRadius={radii.fab}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled: !!disabled }}
          style={styles.fab}
        >
          <Icon icon={icon} color={palette.white} />
          <Text variant="buttonLarge" color={palette.white}>
            {label}
          </Text>
        </Touchable>
      </SurfaceProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    right: layout.screenGutter,
    bottom: layout.bottomActionInset,
    borderRadius: radii.fab,
    backgroundColor: palette.ink,
  },
  fab: {
    height: touch.fabHeight,
    borderRadius: radii.fab,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 18,
    paddingRight: 22,
    overflow: 'hidden',
  },
});
