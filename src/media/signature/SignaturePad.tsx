/**
 * Customer finger-signature pad (DESIGN.md "Customer hand-off mode", IMAGE_PIPELINE §7).
 *
 * Touches are sampled on the UI thread (RNGH Pan) and drawn with Skia, so ink follows the finger
 * without React renders. The pad is only the signing surface: the screen places Clear / Confirm and
 * drives them through the imperative handle (clear, undo, isEmpty, isValid, exportSignature).
 */
import {
  Canvas,
  ImageFormat,
  PaintStyle,
  Path,
  Skia,
  StrokeCap,
  StrokeJoin,
  usePathValue,
} from '@shopify/react-native-skia';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { customerType, icon, layout, lines, palette, radii } from '@/ui/theme/tokens';

import {
  clampToPad,
  isMeaningfulSignature,
  MIN_POINT_DISTANCE,
  planSignatureExport,
  refitStrokes,
  serializeStrokes,
  shouldAppendPoint,
  SIGNATURE_STROKE_WIDTH,
  traceStrokes,
  type SignatureStroke,
} from './strokes';
import { toHex } from '../photo/photoMath';

export interface SignaturePadState {
  isEmpty: boolean;
  /** Enough ink to count as a signature (enables Confirm). */
  isValid: boolean;
  strokeCount: number;
}

export interface SignatureExport {
  /** The destination passed to exportSignature. */
  uri: string;
  /** PNG size in pixels (trimmed to the ink, transparent background). */
  width: number;
  height: number;
  /** Pixels per dp (3, or 2 for very wide signatures). */
  scale: number;
  bytes: number;
  /** Lower-case hex SHA-256 of the PNG bytes. */
  sha256: string;
  /** Raw strokes (store with the signed contract), see serializeStrokes. */
  strokesJson: string;
}

export interface SignaturePadHandle {
  clear(): void;
  undo(): void;
  isEmpty(): boolean;
  isValid(): boolean;
  getStrokes(): SignatureStroke[];
  /**
   * Writes the signature as a trimmed transparent PNG to `destUri` (absolute file URI, typically a
   * staging path; overwritten if present). Rejects with SignatureTooSmallError without enough ink.
   */
  exportSignature(destUri: string): Promise<SignatureExport>;
}

export class SignatureTooSmallError extends Error {
  constructor() {
    super('The signature is too small or empty.');
    this.name = 'SignatureTooSmallError';
  }
}

export interface SignaturePadProps {
  /** Printed under the line. */
  signerName?: string;
  /** Printed under the line, pre-formatted by the caller (e.g. "24 Sep 2026"). */
  dateLabel?: string;
  /** Shown above the line until the first touch. */
  prompt?: string;
  strokeWidth?: number;
  color?: string;
  onChange?: (state: SignaturePadState) => void;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<SignaturePadHandle>;
}

const BASELINE_FROM_BOTTOM = 76;

/** Where the signing line sits in a pad of this height (dp from the top). */
function baselineFor(height: number): number {
  'worklet';
  return Math.max(height * 0.55, height - BASELINE_FROM_BOTTOM);
}
const INSET = 24;
const EMPTY_STATE: SignaturePadState = { isEmpty: true, isValid: false, strokeCount: 0 };

export function SignaturePad({
  signerName,
  dateLabel,
  prompt = 'Sign above the line',
  strokeWidth = SIGNATURE_STROKE_WIDTH,
  color = palette.ink,
  onChange,
  style,
  ref,
}: SignaturePadProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const padSize = useSharedValue({ width: 0, height: 0 });
  // UI thread is the source of truth; the JS mirror is refreshed after every change.
  const strokes = useSharedValue<SignatureStroke[]>([]);
  const current = useSharedValue<SignatureStroke>([]);
  const t0 = useSharedValue(-1);
  const mirror = useRef<SignatureStroke[]>([]);
  const sizeRef = useRef(size);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const sync = useCallback((all: SignatureStroke[]) => {
    mirror.current = all;
    onChangeRef.current?.(
      all.length === 0 ? EMPTY_STATE : { isEmpty: false, isValid: isMeaningfulSignature(all), strokeCount: all.length },
    );
  }, []);

  // Gesture callbacks are worklets run on the UI thread per touch, never during render; the React
  // Compiler rules cannot see that through the builder chain.
  /* eslint-disable react-hooks/purity, react-hooks/refs */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          'worklet';
          const now = Date.now();
          if (t0.get() < 0) t0.set(now);
          const p = clampToPad(e.x, e.y, padSize.get());
          current.set([{ x: p.x, y: p.y, t: now - t0.get() }]);
        })
        .onUpdate((e) => {
          'worklet';
          const p = clampToPad(e.x, e.y, padSize.get());
          const pts = current.get();
          if (!shouldAppendPoint(pts[pts.length - 1], p.x, p.y, MIN_POINT_DISTANCE)) return;
          const t = Date.now() - t0.get();
          current.modify((v) => {
            'worklet';
            v.push({ x: p.x, y: p.y, t });
            return v;
          });
        })
        .onFinalize(() => {
          'worklet';
          const done = current.get();
          if (done.length === 0) return;
          current.set([]);
          strokes.modify((v) => {
            'worklet';
            v.push(done);
            return v;
          });
          scheduleOnRN(sync, strokes.get());
        }),
    [current, padSize, strokes, sync, t0],
  );
  /* eslint-enable react-hooks/purity, react-hooks/refs */

  const inkPath = usePathValue((b) => {
    'worklet';
    traceStrokes(strokes.get(), b);
  });
  const livePath = usePathValue((b) => {
    'worklet';
    traceStrokes([current.get()], b);
  });
  const promptStyle = useAnimatedStyle(() => ({
    opacity: strokes.get().length === 0 && current.get().length === 0 ? 1 : 0,
  }));

  useImperativeHandle(
    ref,
    (): SignaturePadHandle => ({
      clear() {
        scheduleOnUI(() => {
          'worklet';
          strokes.set([]);
          current.set([]);
          scheduleOnRN(sync, []);
        });
      },
      undo() {
        scheduleOnUI(() => {
          'worklet';
          strokes.modify((v) => {
            'worklet';
            v.pop();
            return v;
          });
          scheduleOnRN(sync, strokes.get());
        });
      },
      isEmpty: () => mirror.current.length === 0,
      isValid: () => isMeaningfulSignature(mirror.current),
      getStrokes: () => mirror.current.map((s) => s.slice()),
      exportSignature: (destUri) => renderSignaturePng(mirror.current, destUri, strokeWidth, color, sizeRef.current),
    }),
    [color, current, strokeWidth, strokes, sync],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const prev = sizeRef.current;
      sizeRef.current = { width, height };
      padSize.set({ width, height });
      setSize({ width, height });
      if (prev.width === 0 || (prev.width === width && prev.height === height)) return;
      // The phone turned (or the layout changed): carry the ink over, undistorted (refitStrokes).
      const from = { ...prev, baseline: baselineFor(prev.height) };
      const to = { width, height, baseline: baselineFor(height) };
      const margin = strokeWidth / 2 + 4;
      scheduleOnUI(() => {
        'worklet';
        const done = strokes.get();
        const live = current.get();
        if (done.length === 0 && live.length === 0) return;
        const moved = refitStrokes(live.length > 0 ? [...done, live] : done, from, to, margin);
        if (live.length > 0) current.set(moved.pop() ?? []);
        strokes.set(moved);
        scheduleOnRN(sync, moved);
      });
    },
    [current, padSize, strokeWidth, strokes, sync],
  );

  const baselineY = baselineFor(size.height);

  return (
    <GestureDetector gesture={pan}>
      <View
        style={[styles.pad, style]}
        onLayout={onLayout}
        accessible
        accessibilityLabel={prompt}
        accessibilityHint="Draw your signature with your finger."
      >
        {size.height > 0 && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[styles.prompt, { bottom: size.height - baselineY + 40 }, promptStyle]}
            >
              <Text style={styles.promptText}>{prompt}</Text>
            </Animated.View>
            <View pointerEvents="none" style={[styles.cross, { top: baselineY - icon.size - 6 }]}>
              <X size={icon.size} color={palette.ink} strokeWidth={icon.stroke} absoluteStrokeWidth />
            </View>
            <View pointerEvents="none" style={[styles.baseline, { top: baselineY }]} />
            <View pointerEvents="none" style={[styles.under, { top: baselineY + 8 }]}>
              {signerName ? (
                <Text style={styles.name} numberOfLines={1}>
                  {signerName}
                </Text>
              ) : null}
              {dateLabel ? (
                <Text style={styles.date} numberOfLines={1}>
                  {dateLabel}
                </Text>
              ) : null}
            </View>
          </>
        )}
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path
            path={inkPath}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            strokeJoin="round"
            color={color}
          />
          <Path
            path={livePath}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            strokeJoin="round"
            color={color}
          />
        </Canvas>
      </View>
    </GestureDetector>
  );
}

async function renderSignaturePng(
  strokes: SignatureStroke[],
  destUri: string,
  strokeWidth: number,
  color: string,
  pad: { width: number; height: number },
): Promise<SignatureExport> {
  if (!isMeaningfulSignature(strokes)) throw new SignatureTooSmallError();
  const plan = planSignatureExport(strokes, strokeWidth);
  if (!plan) throw new SignatureTooSmallError();

  // CPU raster surface: deterministic, independent of screen density and GPU.
  const surface = Skia.Surface.Make(plan.pixelWidth, plan.pixelHeight);
  if (!surface) throw new Error(`Could not create a ${plan.pixelWidth}x${plan.pixelHeight} signature surface`);
  const builder = Skia.PathBuilder.Make();
  traceStrokes(strokes, builder);
  const path = builder.build();
  const paint = Skia.Paint();
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    paint.setAntiAlias(true);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(strokeWidth);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setColor(Skia.Color(color));
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.scale(plan.scale, plan.scale);
    canvas.translate(-plan.bounds.x, -plan.bounds.y);
    canvas.drawPath(path, paint);
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      // Copy into a plain ArrayBuffer-backed array (what File.write and Crypto.digest expect).
      bytes = new Uint8Array(image.encodeToBytes(ImageFormat.PNG));
    } finally {
      image.dispose();
    }
  } finally {
    paint.dispose();
    path.dispose();
    builder.dispose();
    surface.dispose();
  }
  if (bytes.byteLength === 0) throw new Error('Signature PNG encoding failed');

  const file = new File(destUri);
  const dir = file.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true });
  file.write(bytes);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return {
    uri: file.uri,
    width: plan.pixelWidth,
    height: plan.pixelHeight,
    scale: plan.scale,
    bytes: bytes.byteLength,
    sha256: toHex(digest),
    strokesJson: serializeStrokes(strokes, pad, strokeWidth),
  };
}

const styles = StyleSheet.create({
  pad: {
    flex: 1,
    backgroundColor: palette.paper2,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  prompt: {
    position: 'absolute',
    left: layout.customerGutter,
    right: layout.customerGutter,
  },
  promptText: {
    textAlign: 'center',
    color: palette.ink2,
    ...customerType.secondary,
  },
  cross: {
    position: 'absolute',
    left: INSET,
  },
  baseline: {
    position: 'absolute',
    left: INSET,
    right: INSET,
    height: lines.sectionRule,
    backgroundColor: palette.ink,
  },
  under: {
    position: 'absolute',
    left: INSET,
    right: INSET,
  },
  name: {
    color: palette.ink,
    ...customerType.secondary,
  },
  date: {
    color: palette.ink2,
    ...customerType.fine,
  },
});
