import { StyleSheet, View } from 'react-native';

import { BottomSheet, Icon, ListRow, Text, type LucideIcon } from '@/ui';
import { useSurface } from '@/ui/surface';

export interface SheetAction {
  label: string;
  /** Second line, e.g. why an action is unavailable. */
  detail?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  onPress: () => void;
}

export interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: readonly SheetAction[];
  accessibilityLabel: string;
}

const ROW = 64;

/**
 * The ⋮ menu: a paper bottom sheet of action rows. Render it through Screen's `overlay` (it
 * fills its parent). Picking a row closes the sheet first.
 */
export function ActionSheet({ open, onClose, title, actions, accessibilityLabel }: ActionSheetProps) {
  const height = Math.min(actions.length * ROW + (title ? 64 : 32), 480);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[height]}
      accessibilityLabel={accessibilityLabel}
      header={title ? <Text variant="titleM">{title}</Text> : undefined}
    >
      <View style={styles.list}>
        {actions.map((a) => (
          <ActionRow key={a.label} action={a} onClose={onClose} />
        ))}
      </View>
    </BottomSheet>
  );
}

function ActionRow({ action, onClose }: { action: SheetAction; onClose: () => void }) {
  const { colors } = useSurface();
  return (
    <ListRow
      leading={action.icon ? <Icon icon={action.icon} color={colors.textSecondary} /> : undefined}
      title={action.label}
      subtitle={action.detail}
      disabled={action.disabled}
      onPress={() => {
        onClose();
        action.onPress();
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 8 },
});
