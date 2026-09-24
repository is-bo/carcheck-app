import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { rebate, space } from '@/ui/theme/tokens';

import type { Alignment } from '../geometry';
import { ModeSwitch } from './ModeSwitch';
import { OverlayView } from './OverlayView';
import { NO_MARKERS, useLive, usePairImages, usePairViewport } from './pairHooks';
import { SideBySideView, type CompareViewBaseProps } from './SideBySideView';
import { SliderView } from './SliderView';
import type { CompareMode } from './types';
import type { SideBySideArrangement } from './viewportMath';

export interface ComparisonViewProps extends Omit<CompareViewBaseProps, 'images' | 'live'> {
  mode: CompareMode;
  /**
   * When given, an inline Side by side | Overlay | Slider switch is rendered above the photo.
   * Screens that render the kit's SegmentedControl simply pass `mode` and omit this.
   */
  onModeChange?: (mode: CompareMode) => void;
  alignment?: Alignment | null;
  /** Overlay opacity (kept across angles when the screen owns it). */
  opacity?: SharedValue<number>;
  /** Slider divider position (kept across angles when the screen owns it). */
  divider?: SharedValue<number>;
  arrangement?: 'auto' | SideBySideArrangement;
  showOpacityControl?: boolean;
}

/**
 * The comparison stage: decodes the pair once, keeps zoom/pan, marker drags and the live
 * "same area" ring shared across modes, and renders the chosen mode. Markers stay attached to
 * their own photo in every mode; "Mark new damage" taps map to AFTER in every mode.
 */
export function ComparisonView({
  mode,
  onModeChange,
  before,
  after,
  markers = NO_MARKERS,
  viewport,
  onImageError,
  style,
  ...rest
}: ComparisonViewProps) {
  const vp = usePairViewport(viewport, before, after);
  const live = useLive(undefined);
  const images = usePairImages(before, after, undefined, onImageError);
  const common = { ...rest, before, after, markers, viewport: vp, live, images };

  return (
    <View style={[styles.root, style]}>
      {onModeChange ? <ModeSwitch mode={mode} onChange={onModeChange} style={styles.switch} /> : null}
      <View style={styles.stage}>
        {mode === 'sideBySide' ? (
          <SideBySideView {...common} />
        ) : mode === 'overlay' ? (
          <OverlayView {...common} />
        ) : (
          <SliderView {...common} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: rebate.background },
  switch: { marginHorizontal: space[5], marginVertical: space[3] },
  stage: { flex: 1 },
});
