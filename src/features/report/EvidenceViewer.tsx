/**
 * Full-screen evidence image viewer: pinch / pan / double-tap zoom on the UI thread, and Share
 * image. A modal over the report, so the report keeps its scroll position.
 */
import { Image } from 'expo-image';
import { Share2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, Surface, Text } from '@/ui';
import { duration, ease } from '@/ui/motion';
import { layout } from '@/ui/theme/tokens';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const TIMING = { duration: duration.base, easing: ease.standard, reduceMotion: ReduceMotion.System };

export interface EvidenceViewerProps {
  /** File URI of the evidence JPEG; null = closed. */
  uri: string | null;
  title: string;
  /** Pixel size of the image, for the fitted frame. */
  width: number;
  height: number;
  onShare: () => void;
  sharing?: boolean;
  onClose: () => void;
}

export function EvidenceViewer({ uri, title, width, height, onShare, sharing, onClose }: EvidenceViewerProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={uri !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <GestureHandlerRootView style={styles.fill}>
        <Surface tone="rebate" style={[styles.fill, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
          <View style={styles.bar}>
            <IconButton icon={X} accessibilityLabel="Close" onPress={onClose} />
            <Text variant="titleM" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </View>
          {uri ? <ZoomableImage uri={uri} aspect={width > 0 && height > 0 ? width / height : 1} /> : <View style={styles.fill} />}
          <View style={[styles.actions, { paddingBottom: insets.bottom + layout.bottomActionInset }]}>
            <Button label="Share image" icon={Share2} onPress={onShare} loading={sharing} fullWidth />
          </View>
        </Surface>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ZoomableImage({ uri, aspect }: { uri: string; aspect: number }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const boxSV = useSharedValue({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const size = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    setBox(size);
    boxSV.set(size);
  };

  // Contain-fitted image size inside the box.
  const fitted = useMemo(() => {
    if (box.width === 0 || box.height === 0) return { width: 0, height: 0 };
    return box.width / box.height > aspect
      ? { width: box.height * aspect, height: box.height }
      : { width: box.width, height: box.width / aspect };
  }, [aspect, box]);
  const fittedSV = useSharedValue(fitted);
  useEffect(() => {
    fittedSV.set(fitted);
  }, [fitted, fittedSV]);

  const gesture = useMemo(() => {
    const clampXY = (s: number, x: number, y: number) => {
      'worklet';
      const b = boxSV.get();
      const f = fittedSV.get();
      const mx = Math.max(0, (f.width * s - b.width) / 2);
      const my = Math.max(0, (f.height * s - b.height) / 2);
      return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
    };
    const pinch = Gesture.Pinch()
      .onStart((e) => {
        const b = boxSV.get();
        start.set({ s: scale.get(), x: tx.get(), y: ty.get(), fx: e.focalX - b.width / 2, fy: e.focalY - b.height / 2 });
      })
      .onUpdate((e) => {
        const st = start.get();
        const b = boxSV.get();
        const s = Math.min(MAX_SCALE, Math.max(1, st.s * e.scale));
        const k = s / st.s;
        // Keep the point under the fingers where it was, and follow the fingers as they move.
        const x = st.fx - (st.fx - st.x) * k + (e.focalX - b.width / 2 - st.fx);
        const y = st.fy - (st.fy - st.y) * k + (e.focalY - b.height / 2 - st.fy);
        const c = clampXY(s, x, y);
        scale.set(s);
        tx.set(c.x);
        ty.set(c.y);
      });
    const pan = Gesture.Pan()
      .maxPointers(1)
      .onStart(() => {
        start.set({ s: scale.get(), x: tx.get(), y: ty.get(), fx: 0, fy: 0 });
      })
      .onUpdate((e) => {
        if (scale.get() <= 1) return;
        const st = start.get();
        const c = clampXY(scale.get(), st.x + e.translationX, st.y + e.translationY);
        tx.set(c.x);
        ty.set(c.y);
      });
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e, success) => {
        if (!success) return;
        if (scale.get() > 1.01) {
          scale.set(withTiming(1, TIMING));
          tx.set(withTiming(0, TIMING));
          ty.set(withTiming(0, TIMING));
          return;
        }
        const b = boxSV.get();
        const fx = e.x - b.width / 2;
        const fy = e.y - b.height / 2;
        const c = clampXY(DOUBLE_TAP_SCALE, -fx * (DOUBLE_TAP_SCALE - 1), -fy * (DOUBLE_TAP_SCALE - 1));
        scale.set(withTiming(DOUBLE_TAP_SCALE, TIMING));
        tx.set(withTiming(c.x, TIMING));
        ty.set(withTiming(c.y, TIMING));
      });
    return Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
  }, [boxSV, fittedSV, scale, start, tx, ty]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.stage} onLayout={onLayout} collapsable={false}>
        <Animated.View style={[{ width: fitted.width, height: fitted.height }, style]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Evidence image" />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { height: layout.topBarHeight, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  title: { flex: 1 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  actions: { paddingHorizontal: layout.screenGutter, paddingTop: 12 },
});
