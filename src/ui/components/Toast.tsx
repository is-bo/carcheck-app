import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';

import { duration, ease } from '../motion';
import { SurfaceProvider } from '../surface';
import { layout, palette, radii } from '../theme/tokens';
import { Text } from './Text';
import { Touchable } from './Touchable';

/* ------------------------------------------------------------------ */
/* Imperative API                                                      */
/* ------------------------------------------------------------------ */

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** ms; default 4 s, 8 s with an action (DESIGN.md › Snackbar). */
  duration?: number;
}

interface ToastState {
  id: number;
  message: string;
  action?: ToastAction;
  duration: number;
}

let current: ToastState | null = null;
let nextId = 1;
const toastListeners = new Set<() => void>();
const emitToast = () => toastListeners.forEach((l) => l());

/**
 * Show the snackbar ("Damage 3 deleted · Undo"). A new toast replaces the visible one.
 * Requires <ToastHost /> once at the root (app/_layout.tsx mounts it).
 */
export function showToast(message: string, options: ToastOptions = {}): number {
  current = {
    id: nextId++,
    message,
    action: options.action,
    duration: options.duration ?? (options.action ? 8000 : 4000),
  };
  emitToast();
  return current.id;
}

/** Hide the given toast, or whichever is showing. */
export function hideToast(id?: number): void {
  if (!current || (id != null && current.id !== id)) return;
  current = null;
  emitToast();
}

/* ------------------------------------------------------------------ */
/* Bottom anchors: the snackbar sits above the FAB / primary button    */
/* ------------------------------------------------------------------ */

/** Window-space Y of the top edge of each focused bottom-anchored element. */
const anchors = new Map<string, number>();
const anchorListeners = new Set<() => void>();
const emitAnchors = () => anchorListeners.forEach((l) => l());

function topAnchor(): number | null {
  let min: number | null = null;
  anchors.forEach((y) => {
    if (min == null || y < min) min = y;
  });
  return min;
}

/**
 * Register a bottom-anchored element (FAB, action footer, nav bar) so the snackbar clears it.
 * Spread the result onto the element's outer View. Active only while its screen is focused.
 */
export function useToastAnchor() {
  const id = useId();
  const ref = useRef<View>(null);
  const focused = useRef(false);

  const measure = useCallback(() => {
    if (!focused.current) return;
    ref.current?.measureInWindow((_x, y, _w, h) => {
      if (!focused.current || h === 0) return;
      anchors.set(id, y);
      emitAnchors();
    });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      measure();
      return () => {
        focused.current = false;
        anchors.delete(id);
        emitAnchors();
      };
    }, [id, measure]),
  );

  const onLayout = useCallback((_e: LayoutChangeEvent) => measure(), [measure]);
  return { ref, onLayout, collapsable: false } as const;
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

const subscribeToast = (l: () => void) => {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
};
const subscribeAnchors = (l: () => void) => {
  anchorListeners.add(l);
  return () => anchorListeners.delete(l);
};

/** Mount once, after the navigator. Renders above native modals on iOS. */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToast, () => current);
  const anchorY = useSyncExternalStore(subscribeAnchors, topAnchor);
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [frame, setFrame] = useState<{ y: number; height: number } | null>(null);
  const [shown, setShown] = useState<ToastState | null>(null);
  const hostRef = useRef<View>(null);
  const progress = useSharedValue(0);

  // Keep the last toast rendered while it animates out; adopt a new one during render.
  if (toast && toast !== shown) setShown(toast);

  useEffect(() => {
    const d = reduceMotion ? duration.fast : duration.base;
    if (toast) {
      progress.set(0);
      progress.set(withTiming(1, { duration: d, easing: ease.decelerate }));
      if (Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(
          toast.action ? `${toast.message}. ${toast.action.label} available.` : toast.message,
        );
      }
      const timer = setTimeout(() => hideToast(toast.id), toast.duration);
      return () => clearTimeout(timer);
    }
    progress.set(withTiming(0, { duration: d, easing: ease.accelerate }));
    const timer = setTimeout(() => setShown(null), d);
    return () => clearTimeout(timer);
  }, [toast, progress, reduceMotion]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.get()) * 16 }],
  }));

  const onHostLayout = () => hostRef.current?.measureInWindow((_x, y, _w, height) => setFrame({ y, height }));

  let bottom = insets.bottom + layout.bottomActionInset;
  if (anchorY != null && frame) {
    bottom = Math.max(bottom, frame.y + frame.height - anchorY + 8);
  }

  const body = (
    <View ref={hostRef} onLayout={onHostLayout} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {shown ? (
        <Animated.View
          pointerEvents={toast ? 'box-none' : 'none'}
          style={[styles.wrap, { bottom, left: insets.left + 8, right: insets.right + 8 }, style]}
        >
          <SurfaceProvider tone="rebate">
            <View style={styles.bar} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <Text variant="body" color={palette.white} style={styles.message} numberOfLines={3}>
                {shown.message}
              </Text>
              {shown.action ? (
                <Touchable
                  onPress={() => {
                    shown.action?.onPress();
                    hideToast(shown.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={shown.action.label}
                  style={styles.action}
                >
                  <Text variant="button" color={palette.cyanotypeOnDark}>
                    {shown.action.label}
                  </Text>
                </Touchable>
              ) : null}
            </View>
          </SurfaceProvider>
        </Animated.View>
      ) : null}
    </View>
  );

  return Platform.OS === 'ios' ? <FullWindowOverlay>{body}</FullWindowOverlay> : body;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 560,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.ink,
    borderRadius: radii.md,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
  },
  message: { flex: 1, paddingVertical: 10, paddingRight: 8 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radii.md },
});
