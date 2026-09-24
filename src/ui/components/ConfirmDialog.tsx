import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SurfaceProvider } from '../surface';
import { elevation, light, palette, radii } from '../theme/tokens';
import { Button } from './Button';
import { Text } from './Text';

export interface ConfirmDialogProps {
  visible: boolean;
  /** A question that names the consequence ("Discard this draft?"). */
  title: string;
  /** What will be lost, in one or two sentences. */
  message?: string;
  /** Verb naming the destruction ("Discard", "Replace data"). Error-filled. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** A safer alternative offered first ("Back up current data first"). */
  secondaryAction?: { label: string; onPress: () => void };
  /** The destructive action is running: button shows a spinner, dialog can't be dismissed. */
  busy?: boolean;
}

/**
 * Material dialog for destructive or binding confirmations only (UX_FLOWS §12: Discard draft,
 * Void contract, Reset template, Replace data). Everything else autosaves or offers Undo.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
  secondaryAction,
  busy = false,
}: ConfirmDialogProps) {
  const insets = useSafeAreaInsets();
  const stacked = !!secondaryAction;
  const cancel = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={cancel}
    >
      <SurfaceProvider tone="paper">
        <View style={[styles.scrim, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
          <View
            accessibilityViewIsModal
            accessibilityRole="alert"
            onAccessibilityEscape={cancel}
            style={[styles.dialog, elevation.sheet]}
          >
            <Text variant="titleL" accessibilityRole="header">
              {title}
            </Text>
            {message ? (
              <Text variant="body" tone="secondary" style={styles.message}>
                {message}
              </Text>
            ) : null}
            <View style={stacked ? styles.actionsStacked : styles.actionsRow}>
              {stacked ? (
                <>
                  <Button
                    label={confirmLabel}
                    variant="destructiveFilled"
                    onPress={onConfirm}
                    loading={busy}
                    fullWidth
                  />
                  <Button
                    label={secondaryAction.label}
                    variant="secondary"
                    onPress={secondaryAction.onPress}
                    disabled={busy}
                    fullWidth
                  />
                  <Button label={cancelLabel} variant="quiet" onPress={cancel} disabled={busy} fullWidth />
                </>
              ) : (
                <>
                  <Button label={cancelLabel} variant="quiet" onPress={cancel} disabled={busy} />
                  <Button label={confirmLabel} variant="destructiveFilled" onPress={onConfirm} loading={busy} />
                </>
              )}
            </View>
          </View>
        </View>
      </SurfaceProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: light.scrim,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  dialog: {
    backgroundColor: palette.paper,
    borderRadius: radii.sheet,
    padding: 24,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  message: { marginTop: 12 },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 24, marginRight: -8 },
  actionsStacked: { gap: 8, marginTop: 24 },
});
