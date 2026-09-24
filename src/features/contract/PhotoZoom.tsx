/**
 * Full-screen condition photo for the customer hand-off (UX §2.5 "tap to enlarge with
 * markers"): pinch to zoom, the lettered rings at customer size, and the captions below.
 */
import { X } from 'lucide-react-native';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Id } from '@/domain/types';
import { photoPath } from '@/data/files';
import { MarkerEditor, type MarkerItem } from '@/media/annotate';
import { IconButton, Surface, Text } from '@/ui';
import { layout, palette } from '@/ui/theme/tokens';

import { usePhotoUri } from '../inspection/photoFiles';

export interface PhotoZoomTarget {
  photoId: Id;
  size: { width: number; height: number };
  marks: readonly { label: string; ring: { x: number; y: number; r: number } }[];
  title: string;
  captions: readonly string[];
}

export function PhotoZoom({ rentalId, target, onClose }: { rentalId: Id; target: PhotoZoomTarget | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const uri = usePhotoUri(target ? { id: target.photoId, rentalId, file: { path: photoPath(rentalId, target.photoId) } } : null, 'display');
  const markers: MarkerItem[] = (target?.marks ?? []).map((m) => ({
    key: m.label,
    damageId: m.label,
    status: 'pre_existing',
    role: 'primary',
    label: m.label,
    ring: m.ring,
  }));
  return (
    <Modal
      visible={!!target}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <GestureHandlerRootView style={styles.fill}>
        <Surface tone="rebate" style={[styles.fill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={styles.bar}>
            <IconButton icon={X} accessibilityLabel="Close photo" color={palette.onRebate} onPress={onClose} />
            <Text variant="titleM" numberOfLines={1} style={styles.fill}>
              {target?.title ?? ''}
            </Text>
          </View>
          <View style={styles.fill}>
            {target && uri ? (
              <MarkerEditor photo={{ uri, size: target.size }} markers={markers} editable={false} />
            ) : null}
          </View>
          {target && target.captions.length > 0 ? (
            <ScrollView style={styles.captions} contentContainerStyle={styles.captionsBody}>
              {target.captions.map((c) => (
                <Text key={c} variant="customer.secondary">
                  {c}
                </Text>
              ))}
            </ScrollView>
          ) : null}
        </Surface>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, minHeight: 56 },
  captions: { maxHeight: 160 },
  captionsBody: { paddingHorizontal: layout.customerGutter, paddingVertical: 12, gap: 6 },
});
