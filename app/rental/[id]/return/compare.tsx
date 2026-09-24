import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, Camera, EllipsisVertical, LayoutList, PencilLine, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import {
  DataError,
  getAnglePairs,
  getPref,
  getRental,
  listDamage,
  markPairReviewed,
  reopenReturn,
  setAngleSkipped,
  setPref,
  setResumeStep,
} from '@/data/repos';
import type { AnglePair, Damage, PairKey, Rental } from '@/domain/types';
import { DamageSheet } from '@/features/damage/DamageSheet';
import { useDamageMarking } from '@/features/damage/useDamageMarking';
import { ActionSheet, type SheetAction } from '@/features/evidence/return/ActionSheet';
import { AngleListSheet, DamageRows, MissingSidePanel, ToggleChip } from '@/features/evidence/return/CompareParts';
import { Filmstrip } from '@/features/evidence/return/Filmstrip';
import { isReturnEditable, useLeaveReturnFlow } from '@/features/evidence/return/flow';
import { LoadError } from '@/features/evidence/return/LoadError';
import { ensurePhotoDerivatives, toComparePhoto, usePhotoUri } from '@/features/evidence/photoFiles';
import { compareSequence, compareStatus, samePair } from '@/features/evidence/returnPlan';
import { pairKeyFromParams, returnRoutes } from '@/features/evidence/returnRoutes';
import { useLiveQuery } from '@/features/evidence/useLiveQuery';
import { saveCapturedPhoto } from '@/features/inspection/captureService';
import { SingleShotCamera } from '@/features/inspection/SingleShotCamera';
import { MarkerEditor, pairMarkers, photoMarkers } from '@/media/annotate';
import { ComparisonView, OpacityControl, useSharedViewport, type CompareMode } from '@/media/compare';
import { dividerHandleHit } from '@/media/compare/viewportMath';
import {
  ActionFooter,
  Button,
  formatPlate,
  formatRelativeDateTime,
  IconButton,
  markerLabel,
  Screen,
  SegmentedControl,
  showToast,
  Text,
  TopBar,
} from '@/ui';
import { duration } from '@/ui/motion';
import { layout, rebate, touch } from '@/ui/theme/tokens';

const MODES = [
  { value: 'sideBySide', label: 'Side by side' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'slider', label: 'Slider' },
] as const satisfies readonly { value: CompareMode; label: string }[];

const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 650;
// Same grab zone as the slider handle (SliderView): swipes starting there belong to the divider.
const HANDLE_HALF_W = touch.sliderHandle / 2 + 8;
const HANDLE_HALF_H = touch.sliderHandle / 2 + 16;
const RAIL_WIDTH = 304;

let existingHintShown = false;

/**
 * Compare (UX §5, mockup e-compare): BEFORE vs AFTER per angle in Side by side, Overlay or
 * Slider, markers attached to their own photo in every mode, "Mark new damage" in place on the
 * AFTER photo, and "Next angle" marking each pair as viewed. Gestures run on the UI thread;
 * swiping switches angles only while the photo is not zoomed.
 */
export default function CompareScreen() {
  const { id, angle, slot } = useLocalSearchParams<{ id: string; angle?: string; slot?: string }>();
  const requested = useMemo(() => pairKeyFromParams(angle, slot), [angle, slot]);
  const leave = useLeaveReturnFlow(id);
  const data = useLiveQuery(id, ['photo', 'inspection', 'damage', 'rental'], async () => {
    const [rental, pairs, damages, mode] = await Promise.all([
      getRental(id),
      getAnglePairs(id),
      listDamage(id),
      getPref<CompareMode>('compareMode'),
    ]);
    return { rental, pairs, damages, mode };
  });

  if (data.status === 'error' && !data.data) return <LoadError tone="rebate" onRetry={data.reload} onClose={leave} />;
  if (!data.data) return <Screen tone="rebate" header={false} />;
  const { rental, pairs, damages, mode } = data.data;
  const sequence = compareSequence(pairs);
  return (
    <CompareBody
      rental={rental}
      sequence={sequence}
      damages={damages}
      initialMode={mode && MODES.some((m) => m.value === mode) ? mode : 'sideBySide'}
      requested={requested}
      onLeave={leave}
    />
  );
}

function initialIndex(sequence: readonly AnglePair[], requested: PairKey | null): number {
  if (requested) {
    const i = sequence.findIndex((p) => samePair(p, requested));
    if (i >= 0) return i;
  }
  const firstOpen = sequence.findIndex((p) => compareStatus(p) === 'unreviewed');
  return firstOpen >= 0 ? firstOpen : 0;
}

/** Writes missing display derivatives for the pair (and warms the next one). */
function usePairReady(pair: AnglePair | null, next: AnglePair | null): boolean {
  const key = pair ? `${pair.before?.id ?? '-'}|${pair.after?.id ?? '-'}` : '';
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const photos = [pair?.before, pair?.after].filter((p): p is NonNullable<typeof p> => !!p);
    (async () => {
      for (const p of photos) await ensurePhotoDerivatives(p).catch(() => undefined);
      if (alive) setReady(key);
      for (const p of [next?.before, next?.after]) if (p) await ensurePhotoDerivatives(p).catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
    // The key summarises both photo ids; `next` only warms the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ready === key;
}

interface CompareBodyProps {
  rental: Rental;
  sequence: AnglePair[];
  damages: Damage[];
  initialMode: CompareMode;
  requested: PairKey | null;
  onLeave: () => void;
}

function CompareBody({ rental, sequence, damages, initialMode, requested, onLeave }: CompareBodyProps) {
  const rentalId = rental.id;
  const editable = isReturnEditable(rental);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  const [index, setIndexState] = useState(() => initialIndex(sequence, requested));
  const current = Math.min(Math.max(index, 0), Math.max(sequence.length - 1, 0));
  const pair = sequence[current] ?? null;
  const [mode, setMode] = useState<CompareMode>(initialMode);
  const [showMarkers, setShowMarkers] = useState(true);
  const [showExisting, setShowExisting] = useState(false);
  const [marking, setMarking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anglesOpen, setAnglesOpen] = useState(false);
  const [closeupFor, setCloseupFor] = useState<Damage | null>(null);
  const [busy, setBusy] = useState(false);

  const viewport = useSharedViewport();
  const opacity = useSharedValue(0.5);
  const divider = useSharedValue(0.5);
  const stageSize = useSharedValue({ width: 0, height: 0 });
  const swipeX = useSharedValue(0);

  const ready = usePairReady(pair, sequence[current + 1] ?? null);
  const dm = useDamageMarking({ rentalId, photo: pair?.after ?? null, editable });

  useEffect(() => {
    if (editable) setResumeStep(rentalId, 'return_compare').catch(() => undefined);
  }, [editable, rentalId]);

  const selectDamage = dm.select;
  const setIndex = useCallback(
    (next: number) => {
      setIndexState(Math.min(Math.max(next, 0), sequence.length - 1));
      setMarking(false);
      selectDamage(null);
    },
    [selectDamage, sequence.length],
  );

  const pickupMarks = useMemo(
    () => (pair ? damages.filter((d) => samePair(d, pair) && d.foundPhase === 'before') : []),
    [damages, pair],
  );
  const rows = useMemo(() => [...dm.damages, ...pickupMarks], [dm.damages, pickupMarks]);

  const before = pair?.before ?? null;
  const after = pair?.after ?? null;
  const beforePhoto = useMemo(
    () => (before ? toComparePhoto(before, formatRelativeDateTime(before.capturedAt)) : null),
    [before],
  );
  const afterPhoto = useMemo(() => (after ? toComparePhoto(after, formatRelativeDateTime(after.capturedAt)) : null), [after]);
  const markers = useMemo(() => {
    if (!before || !after) return null;
    return pairMarkers([...dm.damages, ...pickupMarks], {
      before: { width: before.file.width, height: before.file.height },
      after: { width: after.file.width, height: after.file.height },
      alignment: pair?.afterState?.alignment ?? null,
      showExistingOnAfter: showExisting,
    });
  }, [after, before, dm.damages, pair?.afterState?.alignment, pickupMarks, showExisting]);

  const markingHandlers = useMemo(
    () => (marking ? { selectedId: dm.selectedId, onDrop: dm.drop, onSelect: dm.select, onChange: dm.change } : null),
    [dm.change, dm.drop, dm.select, dm.selectedId, marking],
  );

  const changeMode = useCallback((m: CompareMode) => {
    setMode(m);
    setPref('compareMode', m).catch(() => undefined);
  }, []);

  const toggleExisting = useCallback(() => {
    setShowExisting((on) => {
      if (!on && !existingHintShown) {
        existingHintShown = true;
        showToast('Existing damage on AFTER is approx. — its exact place is on BEFORE.');
      }
      return !on;
    });
  }, []);

  const reopen = useCallback(async () => {
    setBusy(true);
    try {
      await reopenReturn(rentalId);
      showToast('Return reopened. Complete it again to update the report.');
      return true;
    } catch (e) {
      showToast(e instanceof DataError ? e.message : "Couldn't reopen the return. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [rentalId]);

  const startMarking = useCallback(async () => {
    if (!after) return;
    if (!editable && !(await reopen())) return;
    viewport.reset(true);
    setMarking(true);
  }, [after, editable, reopen, viewport]);

  const goNext = useCallback(() => {
    if (!pair) return;
    if (editable && pair.after) markPairReviewed(rentalId, pair).catch(() => undefined);
    if (current < sequence.length - 1) setIndex(current + 1);
    else if (editable) router.push(returnRoutes.details(rentalId));
    else onLeave();
  }, [current, editable, onLeave, pair, rentalId, sequence.length, setIndex]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else onLeave();
  }, [onLeave]);

  const skipAngle = useCallback(() => {
    if (!pair) return;
    setAngleSkipped(rentalId, 'after', pair, { reason: null }).catch((e: unknown) =>
      showToast(e instanceof DataError ? e.message : "Couldn't skip this angle. Try again."),
    );
  }, [pair, rentalId]);

  const closeupThumb = usePhotoUri(dm.selectedCloseup, 'thumb');

  // --- swipe between angles (UI thread; only at fit, never while marking) ---------------------
  const sliderMode = mode === 'slider';
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!marking && sequence.length > 1)
        .maxPointers(1)
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onTouchesDown((e, manager) => {
          if (viewport.zoomed.get()) {
            manager.fail();
            return;
          }
          const t = e.changedTouches[0];
          if (sliderMode && t && dividerHandleHit({ x: t.x, y: t.y }, divider.get(), stageSize.get(), HANDLE_HALF_W, HANDLE_HALF_H)) {
            manager.fail();
          }
        })
        .onUpdate((e) => {
          swipeX.set(e.translationX * 0.3);
        })
        .onEnd((e) => {
          const forward = e.translationX < -SWIPE_DISTANCE || e.velocityX < -SWIPE_VELOCITY;
          const backward = e.translationX > SWIPE_DISTANCE || e.velocityX > SWIPE_VELOCITY;
          if (forward) scheduleOnRN(setIndex, current + 1);
          else if (backward) scheduleOnRN(setIndex, current - 1);
        })
        .onFinalize(() => {
          swipeX.set(withTiming(0, { duration: duration.base, reduceMotion: ReduceMotion.System }));
        }),
    [current, divider, marking, sequence.length, setIndex, sliderMode, stageSize, swipeX, viewport],
  );
  const swipeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: swipeX.get() }] }));

  if (!pair) {
    return <LoadError tone="rebate" title="No photos to compare yet." body="Take the return photos first." onRetry={goBack} onClose={onLeave} />;
  }

  // --- pieces -----------------------------------------------------------------------------------
  const total = sequence.length;
  const title = `${pair.label} · ${current + 1} of ${total}`;
  const subtitle = [rental.customer.fullName, rental.vehicle ? formatPlate(rental.vehicle.plate) : null].filter(Boolean).join(' · ');

  const menuActions: SheetAction[] = [
    { label: 'All angles', icon: LayoutList, onPress: () => setAnglesOpen(true) },
    ...(editable && after && after.frozenAt === null
      ? [{ label: 'Retake return photo', icon: Camera, onPress: () => router.push(returnRoutes.capture(rentalId, pair)) }]
      : []),
    ...(!editable ? [{ label: 'Edit return', detail: 'Reopens the return; the report is rebuilt when you complete it.', icon: PencilLine, onPress: () => void reopen() }] : []),
  ];

  const topBar = (
    <TopBar
      title={title}
      subtitle={subtitle}
      leading="back"
      onLeadingPress={goBack}
      actions={<IconButton icon={EllipsisVertical} accessibilityLabel="More" onPress={() => setMenuOpen(true)} />}
    />
  );

  const modeSwitch = (
    <View style={landscape ? styles.modeRail : styles.modeBar}>
      <SegmentedControl accessibilityLabel="Compare mode" options={MODES} value={mode} onChange={changeMode} />
    </View>
  );

  let stageContent: ReactNode;
  if (before && after && beforePhoto && afterPhoto && markers) {
    stageContent = ready ? (
      <ComparisonView
        mode={mode}
        before={beforePhoto}
        after={afterPhoto}
        markers={markers}
        showMarkers={showMarkers}
        viewport={viewport}
        marking={markingHandlers}
        alignment={pair.afterState?.alignment ?? null}
        opacity={opacity}
        divider={divider}
        showOpacityControl={false}
        onImageError={() => showToast("Couldn't show this photo. Go to another angle and back.")}
      />
    ) : null;
  } else if (after && afterPhoto) {
    stageContent = ready ? (
      <MarkerEditor
        photo={afterPhoto}
        markers={photoMarkers(dm.damages, 'after')}
        selectedId={dm.selectedId}
        editable={marking}
        onDrop={dm.drop}
        onSelect={marking ? dm.select : undefined}
        onChange={dm.change}
        label="AFTER"
        viewport={viewport}
      />
    ) : null;
  } else {
    stageContent = (
      <MissingSidePanel
        pair={pair}
        editable={editable}
        onTakePhoto={() => router.push(returnRoutes.capture(rentalId, pair))}
        onSkip={skipAngle}
      />
    );
  }

  const stage = (
    <View style={styles.stageWrap}>
      <GestureDetector gesture={swipe}>
        <Animated.View
          style={[styles.stage, swipeStyle]}
          onLayout={(e) => stageSize.set({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
          collapsable={false}
        >
          {stageContent}
        </Animated.View>
      </GestureDetector>
      {after && !before ? (
        <Text variant="code" tone="secondary" style={styles.oneSideNote}>
          No pick-up photo for this angle
        </Text>
      ) : null}
      {mode === 'overlay' && before && after ? <OpacityControl value={opacity} /> : null}
    </View>
  );

  const toggles = !marking && after ? (
    <View style={styles.toggles}>
      <ToggleChip label="Markers" on={showMarkers} onPress={() => setShowMarkers((v) => !v)} />
      {before && pickupMarks.length > 0 ? <ToggleChip label="Existing" on={showExisting} onPress={toggleExisting} /> : null}
    </View>
  ) : null;

  const damageRows = (
    <DamageRows damages={rows} onOpen={editable ? (d) => dm.select(d.id) : undefined} maxHeight={landscape ? undefined : 112} />
  );

  const isLast = current === total - 1;
  const nextLabel = isLast ? (editable ? 'Continue' : 'Done') : 'Next angle';
  const actions = marking ? (
    <View style={styles.markingBar}>
      <Text variant="bodyStrong" style={styles.flex}>
        Tap the damage on the AFTER photo
      </Text>
      <Button
        label="Done"
        onPress={() => {
          setMarking(false);
          dm.select(null);
        }}
      />
    </View>
  ) : (
    <View style={landscape ? styles.actionsStack : styles.actionsRow}>
      <Button
        label="Mark new damage"
        icon={Plus}
        onPress={() => void startMarking()}
        disabled={!after}
        loading={busy}
        style={landscape ? undefined : styles.primaryAction}
        fullWidth={landscape}
      />
      <Button
        label={nextLabel}
        variant="secondary"
        icon={ArrowRight}
        iconPosition="trailing"
        onPress={goNext}
        style={landscape ? undefined : styles.flex}
        fullWidth={landscape}
      />
    </View>
  );

  const overlays = (
    <>
      <ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} actions={menuActions} accessibilityLabel="More" />
      <AngleListSheet open={anglesOpen} pairs={sequence} index={current} onSelect={setIndex} onClose={() => setAnglesOpen(false)} />
      <DamageSheet
        visible={dm.selected !== null}
        mode="return"
        initial={dm.selected ?? undefined}
        badgeLabel={dm.selectedLabel}
        onSave={dm.save}
        onDelete={dm.remove}
        onAddCloseup={dm.selected ? () => setCloseupFor(dm.selected) : undefined}
        closeupUri={closeupThumb}
        onClose={() => dm.select(null)}
      />
      <SingleShotCamera
        visible={closeupFor !== null}
        title={closeupFor ? `CLOSE-UP · Damage ${markerLabel(closeupFor.status, closeupFor.number)}` : ''}
        instruction="Fill the frame with the damage"
        onCaptured={(tempUri, meta) => {
          const target = closeupFor;
          if (!target || !pair) return;
          saveCapturedPhoto({ rentalId, phase: 'after', angleKey: pair.angleKey, slot: pair.slot, kind: 'damage_closeup', tempUri, meta })
            .then((photo) => dm.attachCloseup(target.id, photo.id))
            .catch((e: unknown) => showToast(e instanceof DataError ? e.message : "Couldn't save the close-up. Try again."));
        }}
        onClose={() => setCloseupFor(null)}
      />
    </>
  );

  if (landscape) {
    return (
      <Screen tone="rebate" header={false} insets={{ top: false, bottom: false }} overlay={overlays}>
        <View style={styles.landscape}>
          <View style={[styles.flex, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left }]}>{stage}</View>
          <View style={[styles.rail, { paddingTop: insets.top, paddingBottom: insets.bottom + layout.bottomActionInset, paddingRight: insets.right }]}>
            {topBar}
            {modeSwitch}
            {toggles}
            <View style={styles.flex}>{damageRows}</View>
            <View style={styles.railActions}>{actions}</View>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      tone="rebate"
      header={topBar}
      overlay={overlays}
      footer={
        <View>
          {!marking ? (
            <View style={styles.strip}>
              <Filmstrip pairs={sequence} index={current} onSelect={setIndex} />
            </View>
          ) : null}
          <ActionFooter>{actions}</ActionFooter>
        </View>
      }
    >
      {modeSwitch}
      {stage}
      {toggles}
      {damageRows}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  landscape: { flex: 1, flexDirection: 'row' },
  rail: { width: RAIL_WIDTH, borderLeftWidth: 1, borderLeftColor: rebate.divider },
  railActions: { paddingHorizontal: layout.screenGutter, paddingTop: 12 },
  modeBar: { paddingHorizontal: layout.screenGutter, paddingTop: 4, paddingBottom: 12 },
  modeRail: { paddingHorizontal: layout.screenGutter, paddingBottom: 12 },
  stageWrap: { flex: 1, minHeight: 200 },
  stage: { flex: 1, overflow: 'hidden' },
  oneSideNote: { paddingHorizontal: layout.screenGutter, paddingTop: 8 },
  toggles: { flexDirection: 'row', gap: 8, paddingHorizontal: layout.screenGutter, paddingTop: 12 },
  strip: { borderTopWidth: 1, borderTopColor: rebate.divider, marginHorizontal: layout.screenGutter, paddingTop: 6 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionsStack: { gap: 8 },
  primaryAction: { flex: 1.35 },
  markingBar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.buttonHeight },
});

