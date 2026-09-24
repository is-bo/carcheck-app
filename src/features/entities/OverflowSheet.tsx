/**
 * The "⋮" overflow menu (DESIGN.md mentions it repeatedly — rental/vehicle/customer detail —
 * but the kit has no anchored-popover component). A bottom sheet built directly on RN's `Modal`
 * (the kit's own `BottomSheet` is a plain absolutely-positioned view: nested inside a screen's
 * `actions` — i.e. inside the top bar — it gets clipped to that bar instead of covering the
 * screen). `Modal` always renders in its own native layer, so this is safe wherever the trigger
 * icon sits; ConfirmDialog uses the same approach for its centred dialog. Report to the kit owner
 * if other waves need a reusable "action list" sheet.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EllipsisVertical } from 'lucide-react-native';

import { Icon, IconButton, ListRow, SurfaceProvider, Text, type LucideIcon } from '@/ui';
import { elevation, light, palette, radii } from '@/ui/theme/tokens';

export interface OverflowAction {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export interface OverflowButtonProps {
  actions: readonly OverflowAction[];
  accessibilityLabel: string;
}

export function OverflowButton({ actions, accessibilityLabel }: OverflowButtonProps) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const close = () => setOpen(false);

  return (
    <>
      <IconButton icon={EllipsisVertical} accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <SurfaceProvider tone="paper">
          <View style={styles.scrim}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
            <View
              accessibilityViewIsModal
              accessibilityLabel={accessibilityLabel}
              onAccessibilityEscape={close}
              style={[styles.sheet, elevation.sheet, { paddingBottom: insets.bottom + 8 }]}
            >
              <View style={styles.handle} />
              <View style={styles.list}>
                {actions.map((action) => (
                  <ListRow
                    key={action.label}
                    leading={
                      action.icon ? <Icon icon={action.icon} color={action.destructive ? light.error : undefined} /> : undefined
                    }
                    title={
                      <Text variant="body" tone={action.destructive ? 'error' : 'primary'}>
                        {action.label}
                      </Text>
                    }
                    disabled={action.disabled}
                    onPress={() => {
                      close();
                      action.onPress();
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        </SurfaceProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: light.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.paper,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingTop: 10,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: palette.outline, alignSelf: 'center', marginBottom: 6 },
  list: { paddingBottom: 8 },
});
