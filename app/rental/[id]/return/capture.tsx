import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DataError, getAnglePairs, getPref, getRental, setAngleSkipped, setPref, setResumeStep } from '@/data/repos';
import type { AnglePair, PairKey, SkipReason } from '@/domain/types';
import { isReturnEditable, useLeaveReturnFlow } from '@/features/evidence/return/flow';
import { AnglePickerSheet, CaptureRail, ShotPreview, SkipSheet } from '@/features/evidence/return/CaptureParts';
import { LoadError } from '@/features/evidence/return/LoadError';
import { usePhotoUri } from '@/features/evidence/photoFiles';
import {
  hasExteriorReturnPhoto,
  isExterior,
  nextCaptureIndex,
  pairId,
  returnCaptureTargets,
  samePair,
  type CaptureTarget,
} from '@/features/evidence/returnPlan';
import { pairKeyFromParams, returnRoutes } from '@/features/evidence/returnRoutes';
import { useLiveQuery } from '@/features/evidence/useLiveQuery';
import { AngleGuide, hasAngleGuide } from '@/features/inspection/AngleGuide';
import { saveCapturedPhoto } from '@/features/inspection/captureService';
import { CaptureCamera } from '@/media/camera';
import { Screen, showToast } from '@/ui';
import { overlay } from '@/ui/theme/tokens';

type Pending = Map<string, 'done' | 'skipped'>;

/**
 * Return capture (UX §3 RETURN): the pick-up walk order with the matching BEFORE photo as a
 * translucent ghost, orientation nudge, auto-advance to the next missing angle after every
 * shot or skip, then Compare.
 */
export default function ReturnCaptureScreen() {
  const { id, angle, slot } = useLocalSearchParams<{ id: string; angle?: string; slot?: string }>();
  const requested = useMemo(() => pairKeyFromParams(angle, slot), [angle, slot]);
  const leave = useLeaveReturnFlow(id);

  const data = useLiveQuery(id, ['photo', 'inspection', 'rental'], async () => {
    const [rental, pairs, ghost] = await Promise.all([getRental(id), getAnglePairs(id), getPref<number>('ghostOpacity')]);
    return { rental, pairs, ghost };
  });

  if (data.status === 'loading') return <Screen tone="rebate" header={false} />;
  if (data.status === 'error' && !data.data) {
    return <LoadError tone="rebate" onRetry={data.reload} onClose={leave} />;
  }
  const { rental, pairs, ghost } = data.data!;
  // A completed return is read-only: its photos are frozen evidence.
  if (!isReturnEditable(rental)) return <Redirect href={returnRoutes.compare(id)} />;
  return (
    <CaptureFlow rentalId={id} pairs={pairs} ghostOpacity={ghost} requested={requested} onLeave={leave} />
  );
}

interface CaptureFlowProps {
  rentalId: string;
  pairs: AnglePair[];
  ghostOpacity: number | null;
  requested: PairKey | null;
  onLeave: () => void;
}

function CaptureFlow({ rentalId, pairs, ghostOpacity, requested, onLeave }: CaptureFlowProps) {
  const [pending, setPending] = useState<Pending>(() => new Map());
  const [currentKey, setCurrentKey] = useState<PairKey | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<PairKey | null>(null);

  useEffect(() => {
    setResumeStep(rentalId, 'return_capture').catch(() => undefined);
  }, [rentalId]);

  // Shots still being written count as taken, so the walk moves on at shutter speed.
  const targets = useMemo(
    () =>
      returnCaptureTargets(pairs).map((t): CaptureTarget => {
        const p = pending.get(pairId(t));
        return p && t.state === 'pending' ? { ...t, state: p } : t;
      }),
    [pairs, pending],
  );

  // Where the walk starts: the requested angle (retake / jump), else the next missing one.
  const startKey = useMemo(() => {
    const req = requested ? targets.find((t) => samePair(t, requested)) : null;
    const start = req ?? targets[nextCaptureIndex(targets, null) ?? 0];
    return start ? { angleKey: start.angleKey, slot: start.slot } : null;
  }, [requested, targets]);
  const activeKey = currentKey ?? startKey;

  const currentIndex = activeKey ? targets.findIndex((t) => samePair(t, activeKey)) : -1;
  const current = currentIndex >= 0 ? targets[currentIndex] : null;
  const exteriorIndex = current && isExterior(current) ? targets.filter(isExterior).findIndex((t) => samePair(t, current)) : -1;
  const canLeave = hasExteriorReturnPhoto(pairs) || targets.some((t) => isExterior(t) && t.state === 'done');

  // Compare is usually underneath (retake, jump): go back to it instead of stacking another one.
  const goCompare = useCallback(() => {
    router.dismissTo(returnRoutes.compare(rentalId));
  }, [rentalId]);

  const advance = useCallback(
    (from: number, list: CaptureTarget[]) => {
      const next = nextCaptureIndex(list, from);
      if (next === null) {
        if (list.some((t) => isExterior(t) && t.state === 'done')) goCompare();
        else showToast('Take at least one outside photo at return.');
        return;
      }
      setCurrentKey({ angleKey: list[next].angleKey, slot: list[next].slot });
    },
    [goCompare],
  );

  const mark = useCallback((key: PairKey, state: 'done' | 'skipped' | null) => {
    setPending((prev) => {
      const next = new Map(prev);
      if (state) next.set(pairId(key), state);
      else next.delete(pairId(key));
      return next;
    });
  }, []);

  const withState = (list: CaptureTarget[], key: PairKey, state: 'done' | 'skipped') =>
    list.map((t) => (samePair(t, key) ? { ...t, state } : t));

  const onCaptured = useCallback(
    async (tempUri: string, meta: { capturedAt: number; tzOffsetMin: number }) => {
      if (!current) return;
      const key = { angleKey: current.angleKey, slot: current.slot };
      const label = current.label.toLowerCase();
      // Retaking moves the new-damage rings onto the new shot (DECISIONS Data §1): ask for a check.
      const hadMarks = current.pair.after !== null && current.pair.newDamageCount + current.pair.uncertainDamageCount > 0;
      mark(key, 'done');
      // A retake returns to where it was asked for (Compare) instead of walking on.
      if (requested && samePair(requested, key) && current.pair.after !== null && router.canGoBack()) router.back();
      else advance(currentIndex, withState(targets, key, 'done'));
      try {
        await saveCapturedPhoto({
          rentalId,
          phase: 'after',
          angleKey: key.angleKey,
          slot: key.slot,
          label: current.pair.group === 'extra' ? current.label : null,
          tempUri,
          meta,
        });
        if (hadMarks) showToast(`Photo retaken. Check the marks on the new ${label} photo still sit on the damage.`);
      } catch (e) {
        mark(key, null);
        showToast(e instanceof DataError ? e.message : `Couldn't save the ${current.label.toLowerCase()} photo. Take it again.`);
      }
    },
    [advance, current, currentIndex, mark, rentalId, requested, targets],
  );

  const skip = useCallback(
    (reason: SkipReason | null) => {
      setSkipOpen(false);
      if (!current) return;
      const key = { angleKey: current.angleKey, slot: current.slot };
      mark(key, 'skipped');
      advance(currentIndex, withState(targets, key, 'skipped'));
      setAngleSkipped(rentalId, 'after', key, { reason }).catch((e: unknown) => {
        mark(key, null);
        showToast(e instanceof DataError ? e.message : "Couldn't skip this angle. Try again.");
      });
    },
    [advance, current, currentIndex, mark, rentalId, targets],
  );

  const onSkipPress = useCallback(() => {
    if (!current) return;
    // Optional shots (dashboard, extras) skip straight away; outside angles ask for a reason.
    if (current.required) setSkipOpen(true);
    else skip(null);
  }, [current, skip]);

  const before = current?.pair.before ?? null;
  const referenceUri = usePhotoUri(before, 'display');
  const reference = before && referenceUri ? { uri: referenceUri, width: before.file.width, height: before.file.height } : null;

  const lastPhoto = useMemo(() => {
    const shots = pairs.map((p) => p.after).filter((p): p is NonNullable<typeof p> => p !== null);
    return shots.sort((a, b) => b.capturedAt - a.capturedAt)[0] ?? null;
  }, [pairs]);
  const lastUri = usePhotoUri(lastPhoto, 'thumb');
  const lastPair = lastPhoto ? pairs.find((p) => samePair(p, lastPhoto)) ?? null : null;
  const previewPair = previewKey ? pairs.find((p) => samePair(p, previewKey)) ?? null : null;
  const previewUri = usePhotoUri(previewPair?.after ?? null, 'display');

  if (!current) return <Screen tone="rebate" header={false} />;

  const title = isExterior(current)
    ? `${current.label.toUpperCase()}  ${exteriorIndex + 1} of 8 · Return`
    : `${current.label.toUpperCase()} · Return`;
  const instruction =
    current.angleKey === 'dashboard'
      ? 'Optional — odometer & fuel'
      : !isExterior(current)
        ? 'Also taken at pick-up'
        : !before
          ? 'No pick-up photo for this angle.'
          : undefined;

  return (
    <View style={styles.fill}>
      <CaptureCamera
        title={title}
        instruction={instruction}
        reference={reference}
        referenceOpacity={ghostOpacity ?? overlay.ghostOpacityDefault}
        onReferenceOpacityChange={(o) => setPref('ghostOpacity', o).catch(() => undefined)}
        preferredOrientation={isExterior(current) ? 'landscape' : undefined}
        renderGuide={hasAngleGuide(current.angleKey) ? (frame) => <AngleGuide angleKey={current.angleKey} frame={frame} /> : undefined}
        onCaptured={onCaptured}
        onClose={onLeave}
        accessory={
          <CaptureRail targets={targets} current={current} onOpenPicker={() => setPickerOpen(true)} onSkip={onSkipPress} />
        }
        lastShot={
          lastPhoto && lastUri && lastPair
            ? { uri: lastUri, label: lastPair.label, onPress: () => setPreviewKey({ angleKey: lastPair.angleKey, slot: lastPair.slot }) }
            : null
        }
      />
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <SkipSheet open={skipOpen} label={current.label} onSkip={skip} onClose={() => setSkipOpen(false)} />
        <AnglePickerSheet
          open={pickerOpen}
          targets={targets}
          current={current}
          onPick={(key) => {
            setPickerOpen(false);
            setCurrentKey({ angleKey: key.angleKey, slot: key.slot });
          }}
          onCompare={
            canLeave
              ? () => {
                  setPickerOpen(false);
                  goCompare();
                }
              : undefined
          }
          onClose={() => setPickerOpen(false)}
        />
      </View>
      <ShotPreview
        uri={previewPair ? previewUri : null}
        label={previewPair?.label ?? ''}
        onRetake={
          previewPair && previewPair.after && previewPair.after.frozenAt === null
            ? () => {
                setCurrentKey({ angleKey: previewPair.angleKey, slot: previewPair.slot });
                setPreviewKey(null);
              }
            : null
        }
        onClose={() => setPreviewKey(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
