import { router, useLocalSearchParams } from 'expo-router';
import {
  ArrowRight,
  Camera,
  ChevronRight,
  EllipsisVertical,
  Eye,
  EyeOff,
  History,
  LayoutList,
  PencilLine,
  Plus,
  Smartphone,
  TriangleAlert,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import {
  confirmMarksChecked,
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
  Banner,
  BottomSheet,
  Button,
  ConfirmDialog,
  formatPlate,
  formatRelativeDateTime,
  IconButton,
  ListRow,
  markerLabel,
  plural,
  RETURN_STEPS,
  Screen,
  SegmentedControl,
  showToast,
  Text,
  TopBar,
} from '@/ui';
import { duration } from '@/ui/motion';
import { layout, overlay, rebate, touch } from '@/ui/theme/tokens';

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
/** Below this height a side-by-side pane is too small to judge damage in portrait. */
const SMALL_PANE = 160;

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
  const [reopenAsk, setReopenAsk] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);
  const [stageHeight, setStageHeight] = useState(0);

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
    // The hold-to-see-BEFORE gesture is invisible: say it once, the first time Overlay opens.
    if (m === 'overlay') {
      getPref<boolean>('overlayHoldHintShown')
        .then((shown) => {
          if (shown) return;
          showToast('Hold the photo to see BEFORE');
          return setPref('overlayHoldHintShown', true);
        })
        .catch(() => undefined);
    }
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

  // Reopening invalidates a report that may already be shared: always confirmed (UX M7).
  const reopen = useCallback(async () => {
    setBusy(true);
    try {
      await reopenReturn(rentalId);
      setReopenAsk(false);
      showToast('Return reopened. Complete it again to update the report.');
    } catch (e) {
      showToast(e instanceof DataError ? e.message : "Couldn't reopen the return. Try again.");
    } finally {
      setBusy(false);
    }
  }, [rentalId]);

  const startMarking = useCallback(() => {
    if (!after || !editable) return;
    viewport.reset(true);
    setMarking(true);
  }, [after, editable, viewport]);

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

  const confirmMarks = useCallback(() => {
    if (!after) return;
    confirmMarksChecked(after.id)
      .then(() => showToast('Marks checked'))
      .catch((e: unknown) => showToast(e instanceof DataError ? e.message : "Couldn't save that. Try again."));
  }, [after]);

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
  // The return's stepper (Inspect, Compare, Details, Report) shows here too, not only on Details.
  const subtitle = [
    editable ? `Return 2 of ${RETURN_STEPS.length}` : null,
    rental.customer.fullName,
    rental.vehicle ? formatPlate(rental.vehicle.plate) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const menuActions: SheetAction[] = [
    { label: 'All angles', icon: LayoutList, onPress: () => setAnglesOpen(true) },
    ...(editable && after && after.frozenAt === null
      ? [{ label: 'Retake return photo', icon: Camera, onPress: () => router.push(returnRoutes.capture(rentalId, pair)) }]
      : []),
    ...(!editable ? [{ label: 'Edit return', detail: 'Reopens the return; the report is rebuilt when you complete it.', icon: PencilLine, onPress: () => setReopenAsk(true) }] : []),
  ];

  const canToggleExisting = !!before && pickupMarks.length > 0;
  const topBar = (
    <TopBar
      title={title}
      // Landscape: the plate is on the photo tag; the rail needs the height.
      subtitle={landscape ? undefined : subtitle}
      leading="back"
      onLeadingPress={goBack}
      actions={
        <>
          {!landscape && !marking && after ? (
            <>
              <IconButton
                icon={showMarkers ? Eye : EyeOff}
                accessibilityLabel="Markers"
                accessibilityHint={showMarkers ? 'Hides the damage marks' : 'Shows the damage marks'}
                selected={showMarkers}
                onPress={() => setShowMarkers((v) => !v)}
              />
              {canToggleExisting ? (
                <IconButton
                  icon={History}
                  accessibilityLabel="Existing damage on AFTER"
                  selected={showExisting}
                  onPress={toggleExisting}
                />
              ) : null}
            </>
          ) : null}
          <IconButton icon={EllipsisVertical} accessibilityLabel="More" onPress={() => setMenuOpen(true)} />
        </>
      }
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
          onLayout={(e) => {
            stageSize.set({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
            setStageHeight(e.nativeEvent.layout.height);
          }}
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
      {!landscape && mode === 'sideBySide' && before && after && stageHeight > 0 && stageHeight / 2 < SMALL_PANE ? (
        <View style={styles.sidewaysTag} pointerEvents="none">
          <Smartphone size={14} color={rebate.textSecondary} style={styles.sidewaysIcon} />
          <Text variant="code" tone="secondary">
            Turn sideways for bigger photos
          </Text>
        </View>
      ) : null}
      {mode === 'overlay' && before && after ? <OpacityControl value={opacity} /> : null}
    </View>
  );

  const toggles = !marking && after ? (
    <View style={styles.toggles}>
      <ToggleChip label="Markers" on={showMarkers} onPress={() => setShowMarkers((v) => !v)} />
      {canToggleExisting ? <ToggleChip label="Existing" on={showExisting} onPress={toggleExisting} /> : null}
    </View>
  ) : null;

  // After a retake the marks moved over unchanged: ask once per photo (review M2, DECISIONS Data §1).
  const marksCheck =
    editable && !marking && after?.marksCheckNeeded ? (
      <Banner
        icon={TriangleAlert}
        message="This photo was retaken. Check each mark still sits on the damage; move it if not."
        action={<Button label="Marks look right" variant="quiet" onPress={confirmMarks} />}
      />
    ) : null;

  const openRow = editable ? (d: Damage) => dm.select(d.id) : undefined;
  // Portrait keeps the stage big: one summary row, the list opens in a sheet.
  const marksSummary =
    rows.length > 0 && !marking ? (
      <ListRow
        title={plural(rows.length, '{n} mark', '{n} marks')}
        subtitle={rows.map((d) => `${d.foundPhase === 'before' ? 'Existing' : d.status === 'uncertain' ? 'Uncertain' : 'New'} ${markerLabel(d.status, d.number)}`).join(', ')}
        trailing={<ChevronRight size={20} color={rebate.textSecondary} />}
        onPress={() => setMarksOpen(true)}
        divider={false}
      />
    ) : null;

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
      {editable ? (
        <Button
          label="Mark damage"
          icon={Plus}
          onPress={startMarking}
          disabled={!after}
          style={landscape ? undefined : styles.primaryAction}
          fullWidth={landscape}
        />
      ) : (
        <Button
          label="Edit return"
          variant="secondary"
          icon={PencilLine}
          onPress={() => setReopenAsk(true)}
          style={landscape ? undefined : styles.primaryAction}
          fullWidth={landscape}
        />
      )}
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
      <BottomSheet
        open={marksOpen}
        onClose={() => setMarksOpen(false)}
        snapPoints={['50%']}
        accessibilityLabel="Marks on this angle"
      >
        <DamageRows
          damages={rows}
          onOpen={
            openRow
              ? (d) => {
                  setMarksOpen(false);
                  openRow(d);
                }
              : undefined
          }
        />
      </BottomSheet>
      <ConfirmDialog
        visible={reopenAsk}
        title="Reopen this return?"
        message="The report is rebuilt when you complete it again. Anything already shared stays as it was."
        confirmLabel="Reopen"
        busy={busy}
        onCancel={() => setReopenAsk(false)}
        onConfirm={() => void reopen()}
      />
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
            <ScrollView style={styles.flex}>
              {marksCheck}
              {toggles}
              <DamageRows damages={rows} onOpen={openRow} />
            </ScrollView>
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
      {marksCheck}
      {marksSummary}
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
  sidewaysTag: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: overlay.tagBackground,
  },
  sidewaysIcon: { marginTop: -1 },
  toggles: { flexDirection: 'row', gap: 8, paddingHorizontal: layout.screenGutter, paddingTop: 12 },
  strip: { borderTopWidth: 1, borderTopColor: rebate.divider, marginHorizontal: layout.screenGutter, paddingTop: 6 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionsStack: { gap: 8 },
  primaryAction: { flex: 1.35 },
  markingBar: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.buttonHeight },
});

