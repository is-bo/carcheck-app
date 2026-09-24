/**
 * One photo, then back to where you were: damage close-ups and customer documents. Presented as
 * a full-screen modal over the current screen, so the sheet or form underneath keeps its state.
 */
import { Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CaptureCamera, type CapturedMeta, type UiOrientation } from '@/media/camera';
import { rebate } from '@/ui/theme/tokens';

export interface SingleShotCameraProps {
  visible: boolean;
  /** Tag at the top of the frame, e.g. "CLOSE-UP · Damage 2". */
  title: string;
  instruction?: string;
  preferredOrientation?: UiOrientation;
  /** The shot; the camera closes right after. Store it with saveCapturedPhoto / saveDocumentShot. */
  onCaptured: (tempUri: string, meta: CapturedMeta) => void;
  onClose: () => void;
  onError?: (error: Error) => void;
}

export function SingleShotCamera({
  visible,
  title,
  instruction,
  preferredOrientation,
  onCaptured,
  onClose,
  onError,
}: SingleShotCameraProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <GestureHandlerRootView style={styles.root}>
        {visible ? (
          <CaptureCamera
            title={title}
            instruction={instruction}
            preferredOrientation={preferredOrientation}
            onCaptured={(uri, meta) => {
              onCaptured(uri, meta);
              onClose();
            }}
            onClose={onClose}
            onError={onError}
          />
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: rebate.background },
});
