import { Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SkipForward } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DataError,
  getRental,
  listInspectionAngles,
  listPhotos,
  listRentals,
  nextFreeSlot,
  setAngleSkipped,
} from '@/data/repos';
import { DASHBOARD_ANGLE_KEY, EXTERIOR_ANGLE_KEYS, type AngleKey, type ExteriorAngleKey, type Photo, type SkipReason } from '@/domain/types';
import { AngleGuide } from '@/features/inspection/AngleGuide';
import { saveCapturedPhoto } from '@/features/inspection/captureService';
import {
  ANGLE_INSTRUCTIONS,
  doneCount,
  initialTarget,
  isExteriorAngle,
  nextTarget,
  orbitStates,
  progressFromViews,
  type CaptureProgressState,
  type CaptureTarget,
} from '@/features/inspection/captureSequence';
import { ensurePhotoDerivatives, photoFileUris } from '@/features/inspection/photoFiles';
import { useExitStartFlow, useResumePoint } from '@/features/inspection/StartFlowScreen';
import { annotateHref, startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import { CaptureCamera, type CapturedMeta, type ReferencePhoto } from '@/media/camera';
import {
  BottomSheet,
  Button,
  CarDiagram,
  Chip,
  exteriorAngleLabels,
  formatFileSize,
  Icon,
  showToast,
  SurfaceProvider,
  Text,
  Touchable,
} from '@/ui';
import { layout, motion, palette, rebate, touch } from '@/ui/theme/tokens';

const LOW_STORAGE = 500e6;
const FULL_STORAGE = 100e6;
const EXTRA_LABELS: Record<string, string> = {
  interior: 'Interior',
  wheel: 'Wheel',
  roof: 'Roof',
  closeup: 'Close-up',
  other: 'Other',
};
const SKIP_REASONS: { value: SkipReason; label: string }[] = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'too_dark', label: 'Too dark' },
  { value: 'other', label: 'Other' },
];

function angleLabel(key: AngleKey): string {
  if (isExteriorAngle(key)) return exteriorAngleLabels[key];
  if (key === DASHBOARD_ANGLE_KEY) return 'Dashboard';
  return EXTRA_LABELS[key] ?? key;
}

function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

interface LastShot {
  photo: Photo;
  uri: string;
  label: string;
}

/**
 * Step 3a (UX §3): BEFORE guided capture. Shutter, freeze, auto-advance to the next missing angle;
 * no per-photo confirm. `?angle=` opens at an angle, `?single=1` returns after one shot (retake
 * from the grid), `?extra=interior` adds an extra shot.
 */
export default function CaptureStep() {
  const params = useLocalSearchParams<{ id: string; angle?: string; single?: string; extra?: string }>();
  const id = params.id;
  const single = params.single === '1' || !!params.extra;
  const extraKey = params.extra && params.extra in EXTRA_LABELS ? params.extra : null;
  const exit = useExitStartFlow();
  useResumePoint(id, 'capture');

  const views = useLiveQuery(() => listInspectionAngles(id, 'before'), [id], ['photo', 'inspection', 'damage']);
  const rental = useLiveQuery(() => getRental(id), [id], []);

  // What is stored, plus shots still being saved and skips still being written.
  const [optimistic, setOptimistic] = useState<CaptureProgressState>({ captured: new Set(), skipped: new Set() });
  const progress = useMemo<CaptureProgressState>(() => {
    const stored = progressFromViews(views.data ?? []);
    return {
      captured: new Set([...stored.captured, ...optimistic.captured]),
      skipped: new Set([...stored.skipped, ...optimistic.skipped].filter((k) => !optimistic.captured.has(k))),
    };
  }, [views.data, optimistic]);

  const [target, setTarget] = useState<CaptureTarget | null>(null);
  if (!target && views.data && !extraKey) setTarget(initialTarget(progressFromViews(views.data), params.angle ?? null));

  const [lastShot, setLastShot] = useState<LastShot | null>(null);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [space] = useState(freeSpace);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  const conditionHref = startHref(id, 'condition');
  const finish = useCallback(() => router.dismissTo(conditionHref), [conditionHref]);
  // Opened with nothing left to do (e.g. Resume after the last shot): never show an empty screen.
  useEffect(() => {
    if (target?.kind === 'finish') finish();
  }, [target, finish]);

  const close = () => {
    if (single) {
      router.back();
      return;
    }
    if (progress.captured.size > 0) finish();
    else exit();
  };

  const goTo = useCallback(
    (next: CaptureTarget) => {
      if (next.kind === 'finish') finish();
      else setTarget(next);
    },
    [finish],
  );

  const currentKey: AngleKey | null = extraKey ?? (target?.kind === 'angle' ? target.angleKey : target?.kind === 'dashboard' ? DASHBOARD_ANGLE_KEY : null);
  const currentView = views.data?.find((v) => v.angleKey === currentKey && v.slot === 1) ?? null;
  const frozen = !extraKey && !!currentView?.photo?.frozenAt;

  // Previous rental of this vehicle: its photo of the angle becomes a 30% ghost for consistent framing.
  const previous = useLiveQuery(
    async () => {
      const vehicleId = rental.data?.vehicleId;
      if (!vehicleId) return new Map<string, Photo>();
      const rentals = await listRentals({ vehicleId, statuses: ['active', 'returned'], limit: 3 });
      const last = rentals.find((r) => r.rental.id !== id);
      if (!last) return new Map<string, Photo>();
      const photos = await listPhotos(last.rental.id, { kind: 'angle' });
      const map = new Map<string, Photo>();
      for (const p of photos) if (p.slot === 1 && (p.phase === 'after' || !map.has(p.angleKey))) map.set(p.angleKey, p);
      return map;
    },
    [rental.data?.vehicleId, id],
    [],
  );
  const [ghost, setGhost] = useState<{ photoId: string; photo: ReferencePhoto } | null>(null);
  const previousPhoto = currentKey && isExteriorAngle(currentKey) ? (previous.data?.get(currentKey) ?? null) : null;
  useEffect(() => {
    if (!previousPhoto) return;
    let alive = true;
    ensurePhotoDerivatives(previousPhoto).then(
      (u) =>
        alive &&
        setGhost({ photoId: previousPhoto.id, photo: { uri: u.display, width: previousPhoto.file.width, height: previousPhoto.file.height } }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [previousPhoto]);
  const reference = previousPhoto && ghost?.photoId === previousPhoto.id ? ghost.photo : null;

  const onCaptured = useCallback(
    (tempUri: string, meta: CapturedMeta) => {
      if (!currentKey) return;
      const key = currentKey;
      const label = angleLabel(key);
      const hadMarks = (views.data?.find((v) => v.angleKey === key && v.slot === 1)?.damageCount ?? 0) > 0;
      const save = async () => {
        if (extraKey) {
          const slot = await nextFreeSlot(id, extraKey);
          return saveCapturedPhoto({ rentalId: id, phase: 'before', angleKey: extraKey, slot, tempUri, meta });
        }
        return saveCapturedPhoto({ rentalId: id, phase: 'before', angleKey: key, tempUri, meta });
      };
      if (!extraKey) setOptimistic((s) => ({ captured: new Set(s.captured).add(key), skipped: s.skipped }));
      save().then(
        (photo) => {
          setLastShot({ photo, uri: photoFileUris(photo).thumb, label });
          if (hadMarks) {
            showToast(`Check the marks on the new ${label.toLowerCase()} photo`, {
              action: { label: 'Check', onPress: () => router.push(annotateHref(id, photo.id)) },
            });
          }
        },
        (e: unknown) => {
          setOptimistic((s) => {
            const captured = new Set(s.captured);
            captured.delete(key);
            return { captured, skipped: s.skipped };
          });
          showToast(e instanceof DataError ? e.message : `Couldn’t save the ${label.toLowerCase()} photo. Take it again.`);
        },
      );

      if (single) {
        router.back();
        return;
      }
      const after: CaptureProgressState = { captured: new Set(progress.captured).add(key), skipped: progress.skipped };
      const next = nextTarget(after, key === DASHBOARD_ANGLE_KEY ? 'dashboard' : (key as ExteriorAngleKey));
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => goTo(next), motion.duration.freezeFrame);
    },
    [currentKey, extraKey, id, views.data, single, progress, goTo],
  );

  const skip = (reason: SkipReason | null) => {
    setSkipping(false);
    if (!currentKey || extraKey) return;
    const key = currentKey;
    setOptimistic((s) => ({ captured: s.captured, skipped: new Set(s.skipped).add(key) }));
    setAngleSkipped(id, 'before', { angleKey: key, slot: 1 }, { reason }).catch((e: unknown) => {
      setOptimistic((s) => {
        const skipped = new Set(s.skipped);
        skipped.delete(key);
        return { captured: s.captured, skipped };
      });
      showToast(e instanceof DataError ? e.message : 'Couldn’t skip this angle. Try again.');
    });
    if (single) {
      router.back();
      return;
    }
    const after: CaptureProgressState = { captured: progress.captured, skipped: new Set(progress.skipped).add(key) };
    goTo(nextTarget(after, key === DASHBOARD_ANGLE_KEY ? 'dashboard' : (key as ExteriorAngleKey)));
  };

  // Dashboard is optional: "Skip" there needs no reason.
  const onSkipPress = () => (currentKey === DASHBOARD_ANGLE_KEY ? skip(null) : setSkipping(true));

  if (!currentKey) return <View style={styles.fill} />;

  const n = isExteriorAngle(currentKey) ? doneCount(progress) : 0;
  const index = isExteriorAngle(currentKey) ? EXTERIOR_ANGLE_KEYS.indexOf(currentKey) + 1 : 0;
  const label = angleLabel(currentKey).toUpperCase();
  const title = extraKey
    ? `${label} · Extra`
    : currentKey === DASHBOARD_ANGLE_KEY
      ? 'DASHBOARD · Optional'
      : `${label}  ${index} of 8 · Before`;
  const instruction = extraKey ? 'Any orientation. Get close enough to show detail.' : ANGLE_INSTRUCTIONS[currentKey as keyof typeof ANGLE_INSTRUCTIONS];
  const storageNotice =
    space !== null && space < FULL_STORAGE
      ? 'Phone storage is full. Free up space to keep taking photos. Photos already taken are safe.'
      : space !== null && space < LOW_STORAGE
        ? `Storage is getting low (${formatFileSize(space)} free)`
        : null;

  const accessory = (
    <SurfaceProvider tone="rebate">
      <View style={styles.accessory}>
        {!extraKey && currentKey !== DASHBOARD_ANGLE_KEY ? (
          <>
            <CarDiagram
              size={84}
              states={orbitStates(progress)}
              current={isExteriorAngle(currentKey) ? currentKey : null}
              onPress={single ? undefined : () => setPicker(true)}
            />
            <Text variant="code" tone="secondary" tabular>
              {n} of 8 done
            </Text>
          </>
        ) : null}
        {!extraKey ? (
          <Touchable onPress={onSkipPress} accessibilityRole="button" accessibilityLabel={`Skip ${angleLabel(currentKey)}`} style={styles.skip}>
            <Icon icon={SkipForward} size={20} color={rebate.text} />
            <Text variant="bodyStrong" color={rebate.text}>
              Skip
            </Text>
          </Touchable>
        ) : null}
      </View>
    </SurfaceProvider>
  );

  return (
    <View style={styles.fill}>
      <CaptureCamera
        title={title}
        instruction={instruction}
        onCaptured={onCaptured}
        onClose={close}
        onError={(e) => console.warn('[capture]', e.message)}
        reference={reference}
        referenceOpacity={0.3}
        preferredOrientation={isExteriorAngle(currentKey) ? 'landscape' : undefined}
        renderGuide={extraKey ? undefined : (frame) => <AngleGuide angleKey={currentKey} frame={frame} />}
        shutterDisabled={frozen || (space !== null && space < FULL_STORAGE)}
        notice={frozen ? 'This photo is part of the signed contract and can’t be replaced.' : storageNotice}
        accessory={accessory}
        lastShot={lastShot ? { uri: lastShot.uri, label: lastShot.label, onPress: () => setPreview(true) } : null}
        texts={{
          referenceLabel: 'LAST TIME',
          referenceA11y: 'Photo from the previous rental. Press and hold to see it full screen.',
          ghostOpacity: 'Previous photo opacity',
          matchReferenceOrientation: 'Turn the phone to match the previous photo',
        }}
      />

      {preview && lastShot ? (
        <LastShotPreview
          shot={lastShot}
          onKeep={() => setPreview(false)}
          onRetake={() => {
            setPreview(false);
            const key = lastShot.photo.angleKey;
            if (isExteriorAngle(key)) setTarget({ kind: 'angle', angleKey: key });
            else if (key === DASHBOARD_ANGLE_KEY) setTarget({ kind: 'dashboard' });
          }}
        />
      ) : null}

      <BottomSheet
        open={skipping}
        onClose={() => setSkipping(false)}
        snapPoints={[236]}
        accessibilityLabel="Skip this angle"
        header={<Text variant="titleL">Skip {angleLabel(currentKey).toLowerCase()}?</Text>}
      >
        <View style={styles.sheetBody}>
          <Text variant="bodySmall" tone="secondary">
            Why? The report shows “Not photographed” with the reason.
          </Text>
          <View style={styles.reasons}>
            {SKIP_REASONS.map((r) => (
              <View key={r.value} style={styles.fill}>
                <Chip label={r.label} selected={false} fill onPress={() => skip(r.value)} />
              </View>
            ))}
          </View>
          <Button label="Skip without a reason" variant="quiet" onPress={() => skip(null)} />
        </View>
      </BottomSheet>

      <BottomSheet
        open={picker}
        onClose={() => setPicker(false)}
        snapPoints={[360]}
        accessibilityLabel="Choose an angle"
        header={<Text variant="titleL">Choose an angle</Text>}
      >
        <View style={styles.picker}>
          <CarDiagram
            size={240}
            states={orbitStates(progress)}
            current={isExteriorAngle(currentKey) ? currentKey : null}
            onSelectAngle={(k) => {
              setPicker(false);
              setTarget({ kind: 'angle', angleKey: k });
            }}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

function LastShotPreview({ shot, onKeep, onRetake }: { shot: LastShot; onKeep: () => void; onRetake: () => void }) {
  const insets = useSafeAreaInsets();
  const uri = photoFileUris(shot.photo).display;
  return (
    <SurfaceProvider tone="rebate">
      <Pressable style={[StyleSheet.absoluteFill, styles.preview]} onPress={onKeep} accessibilityLabel="Close preview" accessibilityRole="button">
        <Image source={{ uri }} style={styles.fill} contentFit="contain" accessibilityLabel={`${shot.label} photo`} />
        <View style={[styles.previewBar, { paddingBottom: insets.bottom + layout.bottomActionInset, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
          <Text variant="code" tone="secondary" style={styles.fill}>
            {shot.label} · Before
          </Text>
          <Button label="Retake" variant="secondary" onPress={onRetake} />
          <Button label="Keep" onPress={onKeep} />
        </View>
      </Pressable>
    </SurfaceProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  accessory: { alignItems: 'center', gap: 4 },
  skip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: touch.min,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  sheetBody: { paddingHorizontal: layout.screenGutter, gap: 12 },
  reasons: { flexDirection: 'row', gap: 8 },
  picker: { alignItems: 'center', paddingTop: 8 },
  preview: { backgroundColor: palette.rebate },
  previewBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, backgroundColor: palette.rebate },
});
