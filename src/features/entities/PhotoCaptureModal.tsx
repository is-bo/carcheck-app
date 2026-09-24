/**
 * Full-screen single shot for a vehicle photo or a customer document, built on the shared
 * CaptureCamera (ARCHITECTURE §7 camera seam). A plain RN Modal, not a route: these screens own
 * one photo at a time and have no stepper or reference ghost to coordinate with a flow.
 */
import { Modal, StyleSheet, View } from 'react-native';

import type { CapturedImage } from '@/domain/types';
import { CaptureCamera, type CaptureCameraTexts } from '@/media/camera';

import { capturedImageFromCamera } from './media';

export interface PhotoCaptureModalProps {
  visible: boolean;
  title?: string;
  instruction?: string;
  texts?: Partial<CaptureCameraTexts>;
  onCaptured: (image: CapturedImage) => void;
  onClose: () => void;
}

export function PhotoCaptureModal({ visible, title, instruction, texts, onCaptured, onClose }: PhotoCaptureModalProps) {
  if (!visible) return null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fill}>
        <CaptureCamera
          title={title}
          instruction={instruction}
          texts={texts}
          onClose={onClose}
          onCaptured={async (tempUri, meta) => {
            const image = await capturedImageFromCamera(tempUri, meta);
            onCaptured(image);
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
