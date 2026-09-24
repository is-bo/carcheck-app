/**
 * The app's only camera (ARCHITECTURE §7 camera seam): swapping expo-camera for another library
 * touches this module only. Prop-driven, no DB access: the screen supplies titles, the BEFORE
 * reference and slots, and receives `onCaptured(tempUri, meta)` for every shot.
 *
 * Capture settings follow IMAGE_PIPELINE §1: 4:3, explicit ~12 MP `pictureSize`, JPEG q0.9,
 * exif:false (upright pixels), no shutter sound. The preview is laid out at exactly the photo
 * aspect, so the frame, the ghost overlay and the stored photo agree.
 */
import { CameraView, useCameraPermissions, type CameraMountError } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Camera, Eye, EyeOff, Flashlight, Focus, Smartphone, X, Zap, ZapOff } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fontScaleCap,
  icon,
  layout as layoutTokens,
  motion,
  overlay,
  radii,
  rebate,
  touch,
  type as typeTokens,
} from '@/ui/theme/tokens';

import { containFit, type Rect, type Size } from '../geometry';
import { computeCaptureLayout, orientationOf, type CaptureLayout, type UiOrientation } from './captureLayout';
import { GhostSlider, PhotoTag, RailButton, RegistrationMarks, Shutter, TagLine, TagTitle } from './CaptureChrome';
import { selectPictureSize } from './pictureSize';

export type CaptureFlash = 'auto' | 'on' | 'off' | 'torch';

export interface CapturedMeta {
  /** Upright pixel size reported by the camera (processPhoto re-reads it from the file). */
  width: number;
  height: number;
  orientation: UiOrientation;
  /** Epoch ms at shutter press ("device time" in reports). */
  capturedAt: number;
  /** Device UTC offset at capture, minutes east of UTC (e.g. 120 for CEST). */
  tzOffsetMin: number;
  flash: CaptureFlash;
}

export interface ReferencePhoto {
  /** File URI of the BEFORE display derivative (or the previous rental's photo). */
  uri: string;
  /** Upright pixel size, used for contain-fit and the orientation nudge. */
  width: number;
  height: number;
}

export interface CaptureCameraTexts {
  permissionTitle: string;
  permissionBody: string;
  permissionDeniedBody: string;
  allowCamera: string;
  openSettings: string;
  close: string;
  shutter: string;
  flash: Record<CaptureFlash, string>;
  flashA11y: string;
  guide: string;
  ghost: string;
  ghostOpacity: string;
  referenceLabel: string;
  referenceA11y: string;
  lastShotA11y: string;
  matchReferenceOrientation: string;
  rotateToLandscape: string;
  rotateToPortrait: string;
  cameraUnavailable: string;
  tryAgain: string;
  captureFailed: string;
}

export const DEFAULT_CAPTURE_TEXTS: CaptureCameraTexts = {
  permissionTitle: 'CarCheck needs the camera to photograph the car.',
  permissionBody: 'Photos stay on this phone. Your draft is saved.',
  permissionDeniedBody: 'Camera access is turned off for CarCheck. Turn it on in Settings, then come back. Your draft is saved.',
  allowCamera: 'Allow camera',
  openSettings: 'Open settings',
  close: 'Close camera',
  shutter: 'Take photo',
  flash: { auto: 'Auto', on: 'On', off: 'Off', torch: 'Torch' },
  flashA11y: 'Flash',
  guide: 'Guide',
  ghost: 'Ghost',
  ghostOpacity: 'Pick-up photo opacity',
  referenceLabel: 'BEFORE',
  referenceA11y: 'Pick-up photo. Press and hold to see it full screen.',
  lastShotA11y: 'Last photo. Opens the preview.',
  matchReferenceOrientation: 'Turn the phone to match the pick-up photo',
  rotateToLandscape: 'Turn your phone sideways',
  rotateToPortrait: 'Hold your phone upright',
  cameraUnavailable: "Couldn't start the camera. Close other camera apps and try again.",
  tryAgain: 'Try again',
  captureFailed: "Couldn't take the photo. Try again.",
};

export interface CaptureCameraProps {
  /**
   * Every shot. `tempUri` is the camera's JPEG in the cache directory: move it into the file store
   * right away (media/photo processPhoto). May return a promise; the camera does not wait for it.
   */
  onCaptured: (tempUri: string, meta: CapturedMeta) => void | Promise<void>;
  onClose?: () => void;
  /** Capture failures, mount failures and rejections from onCaptured. */
  onError?: (error: Error) => void;
  /** Tag at the top centre of the frame, e.g. "LEFT  3 of 8 · Before". */
  title?: string;
  /** One line under the title. */
  instruction?: string;
  /** BEFORE photo drawn as a translucent ghost over the preview (return capture). */
  reference?: ReferencePhoto | null;
  /** Initial ghost opacity, 0..0.8. Default 0.4 (use 0.3 for a previous rental's photo). */
  referenceOpacity?: number;
  onReferenceOpacityChange?: (opacity: number) => void;
  /** Initial ghost visibility. Default true. */
  referenceVisible?: boolean;
  /** Without a reference: nudge (never block) when the phone is held the other way. */
  preferredOrientation?: UiOrientation;
  /** Framing guide (e.g. the angle silhouette) drawn inside the frame when no ghost is shown. */
  renderGuide?: (frame: Size) => ReactNode;
  /** Initial flash mode. Default 'auto'. */
  flash?: CaptureFlash;
  onFlashChange?: (flash: CaptureFlash) => void;
  /** e.g. storage full. The shutter shows disabled; pair it with a `notice`. */
  shutterDisabled?: boolean;
  /** One-line notice tag at the bottom of the frame (e.g. "Storage is getting low (320 MB free)"). */
  notice?: string | null;
  /** Slot for the angle orbit / Skip: left rail (landscape) or bottom-left (portrait). */
  accessory?: ReactNode;
  lastShot?: { uri: string; label?: string; onPress: () => void } | null;
  texts?: Partial<CaptureCameraTexts>;
}

/** Chosen still size, per app session (undefined = not probed yet, null = camera default). */
let sessionPictureSize: string | null | undefined;

const CAPTURE_QUALITY = 0.9;
const FLASH_ORDER: CaptureFlash[] = ['auto', 'on', 'off', 'torch'];
const FLASH_ICON = { auto: Zap, on: Zap, off: ZapOff, torch: Flashlight } as const;
/** Longest the freeze-frame waits for the still to decode before giving up. */
const FREEZE_FALLBACK_MS = 1200;
const MESSAGE_MS = 3500;

export function CaptureCamera(props: CaptureCameraProps) {
  const texts = useMemo(() => ({ ...DEFAULT_CAPTURE_TEXTS, ...props.texts }), [props.texts]);
  const [permission, requestPermission, getPermission] = useCameraPermissions();

  // Coming back from system Settings must pick up a newly granted permission.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission().catch(() => {});
    });
    return () => sub.remove();
  }, [getPermission]);

  return (
    <View style={styles.root}>
      {permission?.granted ? (
        <CaptureBody {...props} texts={texts} />
      ) : permission ? (
        <PermissionScreen
          texts={texts}
          canAsk={permission.canAskAgain}
          onAllow={() => requestPermission().catch(() => {})}
          onClose={props.onClose}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

function PermissionScreen({
  texts,
  canAsk,
  onAllow,
  onClose,
}: {
  texts: CaptureCameraTexts;
  canAsk: boolean;
  onAllow: () => void;
  onClose?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.permission,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 },
      ]}
    >
      <StatusBar style="light" />
      {onClose ? <RailButton Icon={X} onPress={onClose} accessibilityLabel={texts.close} /> : <View />}
      <View style={styles.permissionBody}>
        <Camera size={48} color={rebate.textSecondary} strokeWidth={icon.stroke} absoluteStrokeWidth />
        <Text style={styles.permissionTitle} maxFontSizeMultiplier={fontScaleCap.body}>
          {texts.permissionTitle}
        </Text>
        <Text style={styles.permissionText} maxFontSizeMultiplier={fontScaleCap.body}>
          {canAsk ? texts.permissionBody : texts.permissionDeniedBody}
        </Text>
      </View>
      <Pressable
        onPress={canAsk ? onAllow : () => Linking.openSettings().catch(() => {})}
        accessibilityRole="button"
        android_ripple={{ color: rebate.surfacePressed }}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressedIos]}
      >
        <Text style={styles.primaryButtonText} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {canAsk ? texts.allowCamera : texts.openSettings}
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

type Phase = 'idle' | 'capturing' | 'frozen';

function CaptureBody(props: CaptureCameraProps & { texts: CaptureCameraTexts }) {
  const {
    texts,
    reference,
    title,
    instruction,
    renderGuide,
    preferredOrientation,
    shutterDisabled = false,
    notice,
    accessory,
    lastShot,
    onClose,
  } = props;
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const cameraRef = useRef<CameraView>(null);
  const [container, setContainer] = useState<Size | null>(null);

  // Latest callbacks without re-creating handlers.
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  const [cameraKey, setCameraKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>(sessionPictureSize ?? undefined);
  const [flash, setFlash] = useState<CaptureFlash>(props.flash ?? 'auto');
  const [overlayOn, setOverlayOn] = useState(props.referenceVisible ?? true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [frozenUri, setFrozenUri] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const busy = useRef(false);
  const shotId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const initialLevel = clampLevel(props.referenceOpacity ?? overlay.ghostOpacityDefault);
  const [committedLevel, setCommittedLevel] = useState(initialLevel);
  const ghostLevel = useSharedValue(initialLevel);
  const ghostOn = useSharedValue(overlayOn ? 1 : 0);
  const edgeFlash = useSharedValue(0);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const report = useCallback(
    (e: unknown, userMessage?: string) => {
      const error = e instanceof Error ? e : new Error(String(e));
      cb.current.onError?.(error);
      if (userMessage) {
        setMessage(userMessage);
        later(() => setMessage((m) => (m === userMessage ? null : m)), MESSAGE_MS);
      }
    },
    [later],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer((c) => (c && c.width === width && c.height === height ? c : { width, height }));
  }, []);

  const layout: CaptureLayout | null = useMemo(
    () => (container ? computeCaptureLayout(container, insets, !!reference) : null),
    [container, insets, reference],
  );

  // --- camera lifecycle -----------------------------------------------------------------------

  const onCameraReady = useCallback(async () => {
    setMountError(null);
    if (sessionPictureSize === undefined) {
      try {
        const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
        // An empty list means the camera was not bound yet: probe again on the next ready.
        if (sizes.length > 0) {
          sessionPictureSize = selectPictureSize(sizes) ?? null;
          // Android rebinds CameraX for the new size; shots taken meanwhile fail and are reported.
          if (sessionPictureSize) setPictureSize(sessionPictureSize);
        }
      } catch (e) {
        sessionPictureSize = null;
        report(e);
      }
    }
    setReady(true);
  }, [report]);

  const onMountError = useCallback(
    (e: CameraMountError) => {
      setReady(false);
      setMountError(texts.cameraUnavailable);
      report(new Error(e.message));
    },
    [report, texts.cameraUnavailable],
  );

  const retryMount = useCallback(() => {
    setMountError(null);
    setReady(false);
    setCameraKey((k) => k + 1);
  }, []);

  // --- shutter --------------------------------------------------------------------------------

  const endFreeze = useCallback((shot: number) => {
    if (shot !== shotId.current) return;
    shotId.current += 1;
    setFrozenUri(null);
    setPhase('idle');
    busy.current = false;
  }, []);

  const onFrozenDisplayed = useCallback(() => {
    const shot = shotId.current;
    later(() => endFreeze(shot), motion.duration.freezeFrame);
  }, [endFreeze, later]);

  const onFrozenError = useCallback(() => endFreeze(shotId.current), [endFreeze]);

  const takePicture = useCallback(async () => {
    const camera = cameraRef.current;
    if (busy.current || !ready || shutterDisabled || !camera) return;
    busy.current = true;
    setPhase('capturing');
    Haptics.selectionAsync().catch(() => {});
    if (!reducedMotion) {
      edgeFlash.set(
        withSequence(
          withTiming(1, { duration: 0 }),
          withTiming(0, { duration: motion.duration.fast, easing: Easing.bezier(...motion.easing.accelerate) }),
        ),
      );
    }
    const capturedAt = Date.now();
    const shotFlash = flash;
    try {
      const picture = await camera.takePictureAsync({ quality: CAPTURE_QUALITY, exif: false, shutterSound: false });
      if (!picture?.uri) throw new Error('The camera returned no photo');
      const meta: CapturedMeta = {
        width: picture.width,
        height: picture.height,
        orientation: orientationOf(picture),
        capturedAt,
        tzOffsetMin: -new Date(capturedAt).getTimezoneOffset(),
        flash: shotFlash,
      };
      const shot = shotId.current;
      setFrozenUri(picture.uri);
      setPhase('frozen');
      later(() => endFreeze(shot), FREEZE_FALLBACK_MS);
      Promise.resolve()
        .then(() => cb.current.onCaptured(picture.uri, meta))
        .catch((e: unknown) => report(e));
    } catch (e) {
      busy.current = false;
      setPhase('idle');
      report(e, texts.captureFailed);
    }
  }, [edgeFlash, endFreeze, flash, later, ready, reducedMotion, report, shutterDisabled, texts.captureFailed]);

  // --- toggles --------------------------------------------------------------------------------

  const cycleFlash = useCallback(() => {
    const next = FLASH_ORDER[(FLASH_ORDER.indexOf(flash) + 1) % FLASH_ORDER.length];
    setFlash(next);
    cb.current.onFlashChange?.(next);
  }, [flash]);

  const toggleOverlay = useCallback(() => {
    const next = !overlayOn;
    setOverlayOn(next);
    ghostOn.set(next ? 1 : 0);
  }, [ghostOn, overlayOn]);

  const commitLevel = useCallback(
    (level: number) => {
      const l = clampLevel(level);
      ghostLevel.set(l);
      setCommittedLevel(l);
      cb.current.onReferenceOpacityChange?.(l);
    },
    [ghostLevel],
  );

  const ghostStyle = useAnimatedStyle(() => ({ opacity: ghostLevel.get() * ghostOn.get() }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: edgeFlash.get() }));

  if (!layout) return <View style={styles.fill} onLayout={onLayout} />;

  const { frame, orientation } = layout;
  const landscape = orientation === 'landscape';
  const frameSize = { width: frame.width, height: frame.height };
  const referenceOrientation = reference ? orientationOf(reference) : null;
  const nudge =
    referenceOrientation && referenceOrientation !== orientation
      ? texts.matchReferenceOrientation
      : !reference && preferredOrientation && preferredOrientation !== orientation
        ? preferredOrientation === 'landscape'
          ? texts.rotateToLandscape
          : texts.rotateToPortrait
        : null;
  const ghostRect: Rect | null = reference ? containFit(reference, frameSize) : null;
  const showGuide = !reference && !!renderGuide && overlayOn;
  const flashLabel = texts.flash[flash];
  const FlashIcon = FLASH_ICON[flash];

  const closeButton = onClose ? <RailButton Icon={X} onPress={onClose} accessibilityLabel={texts.close} /> : null;
  const referenceThumb = reference ? (
    <Pressable
      onPressIn={() => setPeek(true)}
      onPressOut={() => setPeek(false)}
      accessibilityRole="imagebutton"
      accessibilityLabel={texts.referenceA11y}
      style={styles.referenceThumb}
    >
      <Image source={{ uri: reference.uri }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory" />
      <Text style={styles.thumbCode} maxFontSizeMultiplier={fontScaleCap.chrome}>
        {texts.referenceLabel}
      </Text>
    </Pressable>
  ) : null;
  const overlayToggle = reference ? (
    <RailButton
      Icon={overlayOn ? Eye : EyeOff}
      label={texts.ghost}
      active={overlayOn}
      onPress={toggleOverlay}
      accessibilityLabel={texts.ghost}
    />
  ) : renderGuide ? (
    <RailButton Icon={Focus} label={texts.guide} active={overlayOn} onPress={toggleOverlay} accessibilityLabel={texts.guide} />
  ) : null;
  const flashButton = (
    <RailButton Icon={FlashIcon} label={flashLabel} onPress={cycleFlash} accessibilityLabel={`${texts.flashA11y}: ${flashLabel}`} />
  );
  const shutter = (
    <Shutter
      onPress={takePicture}
      busy={phase === 'capturing'}
      disabled={shutterDisabled || !ready}
      accessibilityLabel={texts.shutter}
    />
  );
  const lastShotThumb = lastShot ? (
    <Pressable
      onPress={lastShot.onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={texts.lastShotA11y}
      style={styles.lastShot}
    >
      <Image source={{ uri: lastShot.uri }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory" />
      {lastShot.label ? (
        <Text style={styles.thumbCode} numberOfLines={1} maxFontSizeMultiplier={fontScaleCap.chrome}>
          {lastShot.label}
        </Text>
      ) : null}
    </Pressable>
  ) : (
    <View style={styles.lastShot} />
  );
  const slider =
    reference && overlayOn ? (
      <GhostSlider
        level={ghostLevel}
        max={overlay.ghostOpacityMax}
        vertical={landscape}
        length={landscape ? Math.max(80, layout.trail.height - 2 * 32) : Math.max(80, layout.trail.width - 2 * layoutTokens.screenGutter - 28)}
        value={committedLevel}
        onCommit={commitLevel}
        accessibilityLabel={texts.ghostOpacity}
      />
    ) : null;

  return (
    <View style={styles.fill} onLayout={onLayout}>
      <StatusBar style="light" hidden={landscape} />

      {/* Frame: exactly the captured aspect. Only tags, marks, the guide and the ghost sit on it. */}
      <View style={[styles.frame, rectStyle(frame)]}>
        <CameraView
          key={cameraKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          ratio="4:3"
          pictureSize={pictureSize}
          flash={flash === 'torch' ? 'off' : flash}
          enableTorch={flash === 'torch'}
          animateShutter={false}
          responsiveOrientationWhenOrientationLocked
          onCameraReady={onCameraReady}
          onMountError={onMountError}
        />
        {ghostRect && reference ? (
          <Animated.View pointerEvents="none" style={[rectStyle(ghostRect), ghostStyle]}>
            <Image source={{ uri: reference.uri }} style={StyleSheet.absoluteFill} contentFit="fill" cachePolicy="memory" />
          </Animated.View>
        ) : null}
        {showGuide ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {renderGuide!(frameSize)}
          </View>
        ) : null}
        <RegistrationMarks frame={frameSize} />
        {frozenUri ? (
          <Image
            source={{ uri: frozenUri }}
            style={[StyleSheet.absoluteFill, styles.frozen]}
            contentFit="contain"
            cachePolicy="none"
            onDisplay={onFrozenDisplayed}
            onError={onFrozenError}
          />
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.edgeFlash, edgeStyle]} />
        {title || instruction ? (
          <View style={styles.topTags} pointerEvents="none">
            <PhotoTag>
              {title ? <TagTitle>{title}</TagTitle> : null}
              {instruction ? <TagLine>{instruction}</TagLine> : null}
            </PhotoTag>
          </View>
        ) : null}
        <View style={styles.bottomTags} pointerEvents="none">
          {nudge ? (
            <PhotoTag Icon={Smartphone}>
              <TagTitle>{nudge}</TagTitle>
            </PhotoTag>
          ) : null}
          {message ? (
            <PhotoTag>
              <TagLine>{message}</TagLine>
            </PhotoTag>
          ) : null}
          {notice ? (
            <PhotoTag>
              <TagLine>{notice}</TagLine>
            </PhotoTag>
          ) : null}
        </View>
        {mountError ? (
          <View style={styles.mountError}>
            <Text style={styles.mountErrorText} maxFontSizeMultiplier={fontScaleCap.body}>
              {mountError}
            </Text>
            <Pressable
              onPress={retryMount}
              accessibilityRole="button"
              android_ripple={{ color: rebate.surfacePressed }}
              style={({ pressed }) => [styles.primaryButton, styles.retryButton, pressed && styles.pressedIos]}
            >
              <Text style={styles.primaryButtonText} maxFontSizeMultiplier={fontScaleCap.chrome}>
                {texts.tryAgain}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {landscape ? (
        <>
          <View style={[styles.railV, rectStyle(layout.lead)]}>
            {closeButton}
            {referenceThumb}
            <View style={styles.fill} />
            {accessory}
          </View>
          <View style={[styles.trailL, rectStyle(layout.trail)]}>
            {reference ? <View style={styles.sliderColumn}>{slider}</View> : null}
            <View style={styles.railV}>
              {flashButton}
              {overlayToggle}
              <View style={styles.fill} />
              {shutter}
              <View style={styles.fill} />
              {lastShotThumb}
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={[styles.topBar, rectStyle(layout.lead)]}>
            {closeButton}
            {referenceThumb}
            <View style={styles.fill} />
            {overlayToggle}
            {flashButton}
          </View>
          <View style={[styles.bottomBar, rectStyle(layout.trail)]}>
            {reference ? <View style={styles.sliderRow}>{slider}</View> : null}
            <View style={styles.shutterRow}>
              <View style={styles.sideSlotStart}>{accessory}</View>
              {shutter}
              <View style={styles.sideSlotEnd}>{lastShotThumb}</View>
            </View>
          </View>
        </>
      )}

      {peek && reference ? (
        <View style={styles.peek} pointerEvents="none">
          <Image source={{ uri: reference.uri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory" />
          <View style={[styles.peekTag, { top: insets.top + 12 }]}>
            <PhotoTag>
              <TagTitle>{texts.referenceLabel}</TagTitle>
            </PhotoTag>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function clampLevel(level: number): number {
  return Math.min(overlay.ghostOpacityMax, Math.max(0, level));
}

function rectStyle(r: Rect) {
  return { position: 'absolute' as const, left: r.x, top: r.y, width: r.width, height: r.height };
}

const ABS_FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;
const THUMB_W = 56;
const THUMB_H = 42;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: rebate.background,
  },
  fill: {
    flex: 1,
  },
  frame: {
    overflow: 'hidden',
    backgroundColor: rebate.background,
  },
  frozen: {
    backgroundColor: rebate.background,
  },
  edgeFlash: {
    borderWidth: 3,
    borderColor: rebate.text,
  },
  topTags: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bottomTags: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  mountError: {
    ...ABS_FILL,
    backgroundColor: rebate.background,
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: layoutTokens.screenGutter,
    gap: 16,
  },
  mountErrorText: {
    ...typeTokens.body,
    color: rebate.text,
  },
  railV: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  trailL: {
    flexDirection: 'row',
  },
  sliderColumn: {
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
  },
  bottomBar: {
    paddingHorizontal: layoutTokens.screenGutter,
  },
  sliderRow: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideSlotStart: {
    flex: 1,
    alignItems: 'flex-start',
  },
  sideSlotEnd: {
    flex: 1,
    alignItems: 'flex-end',
  },
  referenceThumb: {
    width: THUMB_W,
    minHeight: touch.min,
    alignItems: 'center',
    gap: 2,
  },
  lastShot: {
    width: THUMB_W,
    minHeight: THUMB_H,
    alignItems: 'center',
    gap: 2,
  },
  thumbImage: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: radii.photo,
    backgroundColor: rebate.surfaceTint,
  },
  thumbCode: {
    ...typeTokens.code,
    color: rebate.textSecondary,
  },
  peek: {
    ...ABS_FILL,
    backgroundColor: rebate.background,
  },
  peekTag: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  permission: {
    flex: 1,
    justifyContent: 'space-between',
  },
  permissionBody: {
    gap: 12,
    maxWidth: 520,
  },
  permissionTitle: {
    ...typeTokens.titleL,
    color: rebate.text,
  },
  permissionText: {
    ...typeTokens.body,
    color: rebate.textSecondary,
  },
  primaryButton: {
    height: touch.buttonHeight,
    borderRadius: radii.md,
    backgroundColor: rebate.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    alignSelf: 'stretch',
  },
  primaryButtonText: {
    ...typeTokens.buttonLarge,
    color: rebate.onPrimary,
  },
  pressedIos: {
    opacity: 0.7,
  },
});
