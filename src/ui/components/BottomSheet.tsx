import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { duration, ease } from '../motion';
import { SurfaceProvider } from '../surface';
import { elevation, layout, light, motion, palette, radii } from '../theme/tokens';

export type SnapPoint = number | `${number}%`;

export interface BottomSheetProps {
  open: boolean;
  /** Called after a swipe-down, backdrop tap or system Back. Set `open` false in response. */
  onClose: () => void;
  /** Heights, low to high: dp or % of the screen. Default half height. */
  snapPoints?: readonly SnapPoint[];
  initialSnapIndex?: number;
  /** Header row (status badge, Title L, trash). Also a drag zone. */
  header?: ReactNode;
  /** Primary action pinned to the bottom. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Tap outside closes. Default true. */
  dismissOnBackdrop?: boolean;
  /**
   * 'none': no scrim, and touches above the sheet reach the screen (the damage sheet keeps
   * its ring visible and draggable). Default 'scrim'.
   */
  backdrop?: 'scrim' | 'none';
  /** Names the sheet for screen readers ("Damage 3"). */
  accessibilityLabel: string;
}

const DISMISS_VELOCITY = 900;

/**
 * Paper sheet, even over rebate screens. Drag the handle or header to move between snap points
 * or swipe down to dismiss; springs never overshoot; Reduce Motion gets a short fade instead.
 * Render it through Screen's `overlay` so it covers the top bar too. Content should be compact
 * (the half-height quick sheet); drags that start on a scrollable child scroll the child.
 */
export function BottomSheet({
  open,
  onClose,
  snapPoints = ['50%'],
  initialSnapIndex = 0,
  header,
  footer,
  children,
  dismissOnBackdrop = true,
  backdrop = 'scrim',
  accessibilityLabel,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [containerH, setContainerH] = useState(0);
  const containerRef = useRef<View>(null);

  const heights = snapPoints.map((p) => (typeof p === 'number' ? p : (parseFloat(p) / 100) * containerH));
  const maxH = Math.min(Math.max(...heights, 0), Math.max(containerH - insets.top - 8, 0));

  // translateY: 0 = fully open at maxH; maxH = hidden below the edge.
  const y = useSharedValue(10000);
  const start = useSharedValue(0);
  const lift = useSharedValue(0);
  const offsets = heights.map((h) => Math.max(0, maxH - Math.min(h, maxH)));

  const animateTo = useCallback(
    (to: number, velocity = 0) => {
      'worklet';
      y.set(
        reduceMotion ? withTiming(to, { duration: duration.fast }) : withSpring(to, { ...motion.spring, velocity }),
      );
    },
    [reduceMotion, y],
  );

  // Mount as soon as it opens (render-time adjustment); unmount after the exit animation.
  if (open && !mounted) setMounted(true);

  // Enter once measured; exit, then unmount.
  useEffect(() => {
    if (!mounted || containerH === 0) return;
    if (open) {
      if (y.get() >= maxH) y.set(maxH);
      animateTo(offsets[Math.min(initialSnapIndex, offsets.length - 1)] ?? 0);
    } else {
      y.set(
        withTiming(maxH, { duration: reduceMotion ? duration.fast : duration.slow, easing: ease.accelerate }, (f) => {
          if (f) scheduleOnRN(setMounted, false);
        }),
      );
    }
    // offsets derive from maxH/containerH; re-run only on open changes or first measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, containerH]);

  // System Back closes the sheet first.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  // Keep the sheet above the keyboard: lift by how much the keyboard overlaps our container.
  useEffect(() => {
    if (!mounted) return;
    const onShow = (e: KeyboardEvent) => {
      containerRef.current?.measureInWindow((_x, cy, _w, ch) => {
        const overlap = Math.max(0, cy + ch - e.endCoordinates.screenY);
        lift.set(withTiming(Math.max(0, overlap - insets.bottom), { duration: e.duration || duration.base }));
      });
    };
    const onHide = (e: KeyboardEvent) => {
      lift.set(withTiming(0, { duration: e?.duration || duration.base }));
    };
    const s = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    const h = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide);
    return () => {
      s.remove();
      h.remove();
    };
  }, [mounted, lift, insets.bottom]);

  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      start.set(y.get());
    })
    .onUpdate((e) => {
      const next = start.get() + e.translationY;
      // Resist dragging above the highest snap point instead of overshooting.
      y.set(next < 0 ? next / 4 : next);
    })
    .onEnd((e) => {
      const lowest = offsets.length ? Math.max(...offsets) : maxH;
      if (e.velocityY > DISMISS_VELOCITY || y.get() > lowest + (maxH - lowest) / 2) {
        scheduleOnRN(onClose);
        return;
      }
      // Nearest snap point, biased by fling direction.
      const projected = y.get() + e.velocityY * 0.12;
      let best = 0;
      for (let i = 1; i < offsets.length; i++) {
        if (Math.abs(offsets[i] - projected) < Math.abs(offsets[best] - projected)) best = i;
      }
      animateTo(offsets[best], e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.get() - lift.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: maxH > 0 ? interpolate(y.get(), [0, maxH], [1, 0], 'clamp') : 0,
  }));

  const onContainerLayout = (e: LayoutChangeEvent) => setContainerH(e.nativeEvent.layout.height);

  if (!mounted) return null;

  return (
    <View ref={containerRef} style={StyleSheet.absoluteFill} onLayout={onContainerLayout} pointerEvents="box-none">
      {backdrop === 'scrim' ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: light.scrim }, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={dismissOnBackdrop ? onClose : undefined}
            accessibilityRole="button"
            accessibilityLabel="Close"
            importantForAccessibility={dismissOnBackdrop ? 'yes' : 'no'}
          />
        </Animated.View>
      ) : null}
      <SurfaceProvider tone="paper">
        <Animated.View
          accessibilityViewIsModal={backdrop === 'scrim'}
          accessibilityLabel={accessibilityLabel}
          onAccessibilityEscape={onClose}
          style={[
            styles.sheet,
            elevation.sheet,
            { height: maxH + insets.bottom, paddingBottom: insets.bottom },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View>
              <View style={styles.handleHit} accessible={false}>
                <View style={styles.handle} />
              </View>
              {header ? <View style={styles.header}>{header}</View> : null}
            </View>
          </GestureDetector>
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </SurfaceProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.paper,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    maxWidth: 640,
    alignSelf: 'center',
    width: '100%',
  },
  handleHit: { height: 20, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: palette.outline },
  header: { paddingLeft: layout.screenGutter, paddingRight: 4, paddingBottom: 4 },
  body: { flex: 1, minHeight: 0 },
  footer: { paddingHorizontal: layout.screenGutter, paddingTop: 12, paddingBottom: layout.bottomActionInset },
});
