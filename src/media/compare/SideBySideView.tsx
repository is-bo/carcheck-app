import { Canvas, Image, type SkImage } from '@shopify/react-native-skia';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { rebate } from '@/ui/theme/tokens';

import { Loupe } from '../annotate/Loupe';
import { MarkerLayer } from '../annotate/MarkerLayer';
import { intersectRect } from '../annotate/markerMath';
import type { PairMarkers } from '../annotate/pairMarkers';
import type { LiveRing, MarkerItem } from '../annotate/types';
import type { MarkerEditing } from '../annotate/useMarkerEditing';
import { NO_MARKERS, PHOTO_SAMPLING, useLive, usePairImages, usePairMarking, usePairViewport } from './pairHooks';
import { PhotoTag } from './PhotoTag';
import { DEFAULT_COMPARE_LABELS, type CompareLabels, type ComparePhoto, type MarkingHandlers, type PairImages } from './types';
import { useMeasuredSize } from './useMeasuredSize';
import { usePhotoGestures } from './usePhotoGestures';
import type { SharedViewport } from './useSharedViewport';
import { chooseSideBySide, paneImageRect, type SideBySideArrangement } from './viewportMath';

const GAP = 2;

export interface CompareViewBaseProps {
  before: ComparePhoto;
  after: ComparePhoto;
  /** Already decoded images (ComparisonView passes them so mode switches never re-decode). */
  images?: PairImages;
  /** From annotate/pairMarkers: BEFORE markers on BEFORE, AFTER markers on AFTER. */
  markers?: PairMarkers;
  /** Markers toggle (forced on while marking). Default true. */
  showMarkers?: boolean;
  /** Shared zoom/pan; pass one to keep it across modes or to reset it on angle change. */
  viewport?: SharedViewport;
  /** Shared live ring so counterparts follow drags across views. */
  live?: SharedValue<LiveRing | null>;
  /** "Mark new damage" handlers; null/undefined = view only. */
  marking?: MarkingHandlers | null;
  labels?: CompareLabels;
  onImageError?: (side: 'before' | 'after', error: Error) => void;
  style?: StyleProp<ViewStyle>;
}

export interface SideBySideViewProps extends CompareViewBaseProps {
  /** 'auto' (default): stacked or left|right, whichever shows the photos larger. */
  arrangement?: 'auto' | SideBySideArrangement;
}

/** BEFORE | AFTER panes with synchronized zoom/pan; BEFORE is always first (top or left). */
export function SideBySideView({
  before,
  after,
  images,
  markers = NO_MARKERS,
  showMarkers = true,
  viewport,
  live,
  marking,
  labels = DEFAULT_COMPARE_LABELS,
  arrangement = 'auto',
  onImageError,
  style,
}: SideBySideViewProps) {
  const vp = usePairViewport(viewport, before, after);
  const liveSV = useLive(live);
  const imgs = usePairImages(before, after, images, onImageError);
  const editing = usePairMarking(markers, marking, liveSV);
  const { size, onLayout } = useMeasuredSize();
  const arranged = arrangement === 'auto' ? chooseSideBySide(size, before.size, after.size, GAP) : arrangement;
  const markersOn = showMarkers || !!marking;
  const selectedId = marking?.selectedId ?? null;

  return (
    <View style={[styles.root, arranged === 'sideBySide' ? styles.row : styles.column, style]} onLayout={onLayout}>
      <ComparePane
        photo={before}
        image={imgs.before}
        label={labels.before}
        markers={markers.before}
        showMarkers={markersOn}
        viewport={vp}
        live={liveSV}
        editing={editing.before}
        selectedId={selectedId}
      />
      <ComparePane
        photo={after}
        image={imgs.after}
        label={labels.after}
        markers={markers.after}
        showMarkers={markersOn}
        viewport={vp}
        live={liveSV}
        editing={editing.after}
        selectedId={selectedId}
      />
    </View>
  );
}

interface ComparePaneProps {
  photo: ComparePhoto;
  image: SkImage | null;
  label: string;
  markers: MarkerItem[];
  showMarkers: boolean;
  viewport: SharedViewport;
  live: SharedValue<LiveRing | null>;
  editing: MarkerEditing | null;
  selectedId: string | null;
}

function ComparePane({ photo, image, label, markers, showMarkers, viewport, live, editing, selectedId }: ComparePaneProps) {
  const { sizeSV, onLayout } = useMeasuredSize();
  const rect = useDerivedValue(() => paneImageRect(viewport.view.get(), photo.size, sizeSV.get()));
  const bounds = useDerivedValue(() =>
    intersectRect(rect.get(), { x: 0, y: 0, width: sizeSV.get().width, height: sizeSV.get().height }),
  );
  const gesture = usePhotoGestures({ viewport, pane: sizeSV, image: photo.size, editing });

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.pane} onLayout={onLayout} collapsable={false}>
        <Canvas style={StyleSheet.absoluteFill}>
          {image ? <Image image={image} rect={rect} fit="fill" sampling={PHOTO_SAMPLING} /> : null}
          {showMarkers ? (
            <MarkerLayer markers={markers} imageRect={rect} bounds={bounds} live={live} selectedId={selectedId} showHandle={!!editing} />
          ) : null}
          {editing && image ? <Loupe image={image} imageRect={rect} drag={editing.drag} pane={sizeSV} /> : null}
        </Canvas>
        <PhotoTag label={label} timeLabel={photo.timeLabel} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: GAP, backgroundColor: rebate.divider },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  pane: { flex: 1, overflow: 'hidden', backgroundColor: rebate.background },
});
