import { Canvas, Image } from '@shopify/react-native-skia';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue } from 'react-native-reanimated';

import { rebate } from '@/ui/theme/tokens';

import { PHOTO_SAMPLING, usePairViewport } from '../compare/pairHooks';
import { PhotoTag } from '../compare/PhotoTag';
import type { ComparePhoto } from '../compare/types';
import { useMeasuredSize } from '../compare/useMeasuredSize';
import { usePhotoGestures } from '../compare/usePhotoGestures';
import type { SharedViewport } from '../compare/useSharedViewport';
import { useSkImage } from '../compare/useSkImage';
import { paneImageRect } from '../compare/viewportMath';
import type { Ring } from '../geometry';
import { Loupe } from './Loupe';
import { MarkerLayer } from './MarkerLayer';
import { intersectRect } from './markerMath';
import type { MarkerItem, MarkerRole } from './types';
import { useMarkerEditing } from './useMarkerEditing';

export interface MarkerEditorProps {
  photo: ComparePhoto;
  /** Markers on this photo (annotate/photoMarkers or one side of pairMarkers), in draw order. */
  markers: MarkerItem[];
  selectedId?: string | null;
  /** false = read-only (signed pick-up photos): taps still select so the sheet can show details. */
  editable?: boolean;
  /** Tap on empty photo area: a new ring at the default size (normalized to this photo). */
  onDrop?: (ring: Ring) => void;
  /** Tap on a marker: open its sheet. */
  onSelect?: (damageId: string) => void;
  /** Move/resize finished (drag badge = move, drag ring edge or pinch the selected ring = resize). */
  onChange?: (damageId: string, ring: Ring, role: MarkerRole) => void;
  /** Tag in the top-left corner, e.g. "BEFORE". */
  label?: string;
  viewport?: SharedViewport;
  onImageError?: (error: Error) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Full-bleed photo for placing and adjusting damage rings. Pinch/pan/double-tap zoom work while
 * editing; a tap drops a ring only when it is a clean single tap (multi-finger touches and pans
 * cancel it), and a press on a badge or ring edge drags instead of panning. A loupe shows the
 * spot under the finger during drags.
 */
export function MarkerEditor({
  photo,
  markers,
  selectedId = null,
  editable = true,
  onDrop,
  onSelect,
  onChange,
  label,
  viewport,
  onImageError,
  style,
}: MarkerEditorProps) {
  const vp = usePairViewport(viewport, photo, photo);
  const image = useSkImage(photo.uri, onImageError);
  const editing = useMarkerEditing({ markers, selectedId, editable, onDrop, onSelect, onChange });
  const { sizeSV, onLayout } = useMeasuredSize();
  const rect = useDerivedValue(() => paneImageRect(vp.view.get(), photo.size, sizeSV.get()));
  const bounds = useDerivedValue(() =>
    intersectRect(rect.get(), { x: 0, y: 0, width: sizeSV.get().width, height: sizeSV.get().height }),
  );
  const gesture = usePhotoGestures({ viewport: vp, pane: sizeSV, image: photo.size, editing });

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.frame, style]} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          {image ? <Image image={image} rect={rect} fit="fill" sampling={PHOTO_SAMPLING} /> : null}
          <MarkerLayer markers={markers} imageRect={rect} bounds={bounds} live={editing.live} selectedId={selectedId} showHandle={editable} />
          {image && editable ? <Loupe image={image} imageRect={rect} drag={editing.drag} pane={sizeSV} /> : null}
        </Canvas>
        {label ? <PhotoTag label={label} timeLabel={photo.timeLabel} /> : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: rebate.background },
});
