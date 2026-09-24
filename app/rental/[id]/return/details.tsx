import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { CircleCheck, TriangleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  completeReturn,
  DataError,
  getAnglePairs,
  getRental,
  markPairReviewed,
  setAngleSkipped,
  setResumeStep,
  updateReturnDetails,
} from '@/data/repos';
import type { AnglePair, Rental } from '@/domain/types';
import { ActionSheet } from '@/features/evidence/return/ActionSheet';
import { isReturnEditable, useLeaveReturnFlow } from '@/features/evidence/return/flow';
import { LoadError } from '@/features/evidence/return/LoadError';
import { usePhotoUri } from '@/features/evidence/photoFiles';
import { listLabels, readinessSummary, returnReadiness, type ReturnReadiness } from '@/features/evidence/returnPlan';
import { returnRoutes } from '@/features/evidence/returnRoutes';
import { useLiveQuery } from '@/features/evidence/useLiveQuery';
import {
  BottomSheet,
  Button,
  formatMileage,
  Icon,
  KeyboardAwareForm,
  RETURN_STEPS,
  Screen,
  SegmentedControl,
  showToast,
  StepHeader,
  Text,
  TextField,
  Touchable,
} from '@/ui';
import { layout, radii } from '@/ui/theme/tokens';

const FUEL = [
  { value: '0', label: 'E', accessibilityLabel: 'Empty' },
  { value: '2', label: '¼', accessibilityLabel: 'Quarter' },
  { value: '4', label: '½', accessibilityLabel: 'Half' },
  { value: '6', label: '¾', accessibilityLabel: 'Three quarters' },
  { value: '8', label: 'F', accessibilityLabel: 'Full' },
] as const;

const SAVE_DELAY = 600;

/** Return details (UX §6): mileage in, fuel, notes, the summary line and Complete return. */
export default function ReturnDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leave = useLeaveReturnFlow(id);
  const data = useLiveQuery(id, ['photo', 'inspection', 'damage', 'rental'], async () => {
    const [rental, pairs] = await Promise.all([getRental(id), getAnglePairs(id)]);
    return { rental, pairs };
  });

  if (data.status === 'error' && !data.data) return <LoadError onRetry={data.reload} onClose={leave} />;
  if (!data.data) return <Screen header={<StepHeader step={3} steps={RETURN_STEPS} onClose={leave} />} />;
  if (!isReturnEditable(data.data.rental)) return <Redirect href={returnRoutes.report(id)} />;
  return <DetailsForm rental={data.data.rental} pairs={data.data.pairs} onLeave={leave} />;
}

function parseMileage(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

type Guard = { kind: 'missing' | 'unreviewed' | 'no_photo'; readiness: ReturnReadiness } | null;

function DetailsForm({ rental, pairs, onLeave }: { rental: Rental; pairs: AnglePair[]; onLeave: () => void }) {
  const rentalId = rental.id;
  const [mileage, setMileage] = useState(rental.returnMileage !== null ? String(rental.returnMileage) : '');
  const [fuel, setFuel] = useState<number | null>(rental.returnFuelEighths);
  const [notes, setNotes] = useState(rental.returnNotes ?? '');
  // The sheet keeps its last content while it animates out.
  const [guard, setGuardContent] = useState<Guard>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const setGuard = useCallback((g: Guard) => {
    if (g) setGuardContent(g);
    setGuardOpen(g !== null);
  }, []);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ mileage, fuel, notes });
  useLayoutEffect(() => {
    latest.current = { mileage, fuel, notes };
  });

  useEffect(() => {
    setResumeStep(rentalId, 'return_details').catch(() => undefined);
  }, [rentalId]);

  const readiness = useMemo(() => returnReadiness(pairs), [pairs]);
  const dashboard = pairs.find((p) => p.angleKey === 'dashboard' && p.slot === 1)?.after ?? null;
  const dashboardUri = usePhotoUri(dashboard, 'thumb');
  const unit = rental.distanceUnit;
  const mileageValue = parseMileage(mileage);
  const belowStart = mileageValue !== null && rental.startMileage !== null && mileageValue < rental.startMileage;

  const persist = useCallback(async () => {
    if (pendingSave.current) clearTimeout(pendingSave.current);
    pendingSave.current = null;
    const v = latest.current;
    await updateReturnDetails(rentalId, {
      returnMileage: parseMileage(v.mileage),
      returnFuelEighths: v.fuel,
      returnNotes: v.notes,
    });
  }, [rentalId]);

  // Autosave: every field persists shortly after the last keystroke, and on leaving.
  const schedule = useCallback(() => {
    if (pendingSave.current) clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => {
      persist().catch((e: unknown) => showToast(e instanceof DataError ? e.message : "Couldn't save the return details."));
    }, SAVE_DELAY);
  }, [persist]);

  useEffect(
    () => () => {
      if (pendingSave.current) persist().catch(() => undefined);
    },
    [persist],
  );

  const complete = useCallback(async () => {
    setCompleting(true);
    try {
      await persist();
      await completeReturn(rentalId, {});
      router.replace(returnRoutes.report(rentalId));
    } catch (e) {
      showToast(e instanceof DataError ? e.message : "Couldn't complete the return. Try again.");
      setCompleting(false);
    }
  }, [persist, rentalId]);

  const onComplete = useCallback(() => {
    const r = returnReadiness(pairs);
    if (!r.hasExteriorPhoto) setGuard({ kind: 'no_photo', readiness: r });
    else if (r.missing.length > 0) setGuard({ kind: 'missing', readiness: r });
    else if (r.unreviewed.length > 0) setGuard({ kind: 'unreviewed', readiness: r });
    else void complete();
  }, [complete, pairs, setGuard]);

  const resolveGuard = useCallback(async () => {
    if (!guard || !guardOpen) return;
    const r = guard.readiness;
    setGuard(null);
    try {
      if (guard.kind === 'missing') {
        for (const p of r.missing) await setAngleSkipped(rentalId, 'after', p, { reason: null });
        if (r.unreviewed.length > 0) {
          setGuard({ kind: 'unreviewed', readiness: { ...r, missing: [] } });
          return;
        }
      } else if (guard.kind === 'unreviewed') {
        for (const p of r.unreviewed) await markPairReviewed(rentalId, p);
      }
      await complete();
    } catch (e) {
      showToast(e instanceof DataError ? e.message : "Couldn't update the angles. Try again.");
    }
  }, [complete, guard, guardOpen, rentalId, setGuard]);

  const summaryOk = readiness.canComplete;
  const guardCopy = guard ? guardText(guard) : null;

  return (
    <Screen
      header={<StepHeader step={3} steps={RETURN_STEPS} onClose={onLeave} onTitlePress={() => setStepsOpen(true)} />}
      insets={{ bottom: false }}
      overlay={
        <>
          <ActionSheet
            open={stepsOpen}
            onClose={() => setStepsOpen(false)}
            title="Return steps"
            accessibilityLabel="Return steps"
            actions={[
              { label: '1  Inspect', detail: 'Return photos', onPress: () => router.push(returnRoutes.capture(rentalId)) },
              { label: '2  Compare', detail: 'Before and after, new damage', onPress: () => router.push(returnRoutes.compare(rentalId)) },
            ]}
          />
          <BottomSheet
            open={guardOpen}
            onClose={() => setGuard(null)}
            snapPoints={[340]}
            accessibilityLabel={guardCopy?.title ?? 'Before completing'}
            header={<Text variant="titleL">{guardCopy?.title}</Text>}
            footer={
              guard ? (
                <View style={styles.guardActions}>
                  <Button
                    label={guardCopy?.primary ?? ''}
                    fullWidth
                    onPress={() => {
                      const r = guard.readiness;
                      setGuard(null);
                      const target = guard.kind === 'unreviewed' ? r.unreviewed[0] : r.missing[0];
                      router.push(
                        guard.kind === 'unreviewed' ? returnRoutes.compare(rentalId, target) : returnRoutes.capture(rentalId, target ?? null),
                      );
                    }}
                  />
                  {guardCopy?.secondary ? (
                    <Button label={guardCopy.secondary} variant="secondary" fullWidth onPress={() => void resolveGuard()} />
                  ) : null}
                </View>
              ) : undefined
            }
          >
            <View style={styles.guardBody}>
              <Text variant="body" tone="secondary">
                {guardCopy?.body}
              </Text>
            </View>
          </BottomSheet>
        </>
      }
    >
      <KeyboardAwareForm
        footer={<Button label="Complete return" fullWidth onPress={onComplete} loading={completing} />}
      >
        <View style={styles.mileageRow}>
          <View style={styles.flex}>
            <TextField
              label="Return mileage"
              variant="mileage"
              unit={unit}
              value={mileage}
              onChangeText={(t) => {
                setMileage(t.replace(/[^\d]/g, ''));
                schedule();
              }}
              onBlur={() => void persist().catch(() => undefined)}
              // Lower than the start is unusual but never blocks: a hint, not an error.
              hint={
                belowStart
                  ? `Lower than the start (${formatMileage(rental.startMileage, unit)}). Check the odometer.`
                  : rental.startMileage !== null
                    ? `Start: ${formatMileage(rental.startMileage, unit)}`
                    : undefined
              }
              returnKeyType="done"
            />
          </View>
          {dashboard && dashboardUri ? (
            <Touchable
              onPress={() => router.push(returnRoutes.compare(rentalId, { angleKey: 'dashboard', slot: 1 }))}
              accessibilityRole="imagebutton"
              accessibilityLabel="Dashboard photo from the return. Opens it in Compare."
              style={styles.dashboard}
            >
              <Image source={{ uri: dashboardUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Touchable>
          ) : null}
        </View>

        <View>
          <Text variant="label" style={styles.fieldLabel}>
            Fuel{' '}
            <Text variant="label" tone="tertiary">
              (optional)
            </Text>
          </Text>
          <SegmentedControl
            accessibilityLabel="Fuel at return"
            options={FUEL}
            value={fuel === null ? null : (String(Math.round(fuel / 2) * 2) as (typeof FUEL)[number]['value'])}
            onChange={(v) => {
              setFuel(Number(v));
              schedule();
            }}
          />
        </View>

        <TextField
          label="Notes"
          optional
          multiline
          value={notes}
          placeholder="Anything the report should mention"
          onChangeText={(t) => {
            setNotes(t);
            schedule();
          }}
          onBlur={() => void persist().catch(() => undefined)}
        />

        <Touchable
          onPress={
            summaryOk
              ? undefined
              : () => {
                  const target = readiness.missing[0] ?? readiness.unreviewed[0];
                  router.push(
                    readiness.missing.length > 0 ? returnRoutes.capture(rentalId, target) : returnRoutes.compare(rentalId, target),
                  );
                }
          }
          disabled={summaryOk}
          dimmed={false}
          accessibilityRole={summaryOk ? 'text' : 'link'}
          style={styles.summary}
        >
          <Icon icon={summaryOk ? CircleCheck : TriangleAlert} size={20} />
          <View style={styles.flex}>
            <Text variant="bodyStrong" tabular>
              {readinessSummary(readiness)}
            </Text>
            {!summaryOk ? (
              <Text variant="bodySmall" tone="accent">
                {readiness.missing.length > 0
                  ? `${readiness.missing.length} not photographed · Take photos`
                  : `${readiness.unreviewed.length} not compared · Compare now`}
              </Text>
            ) : null}
          </View>
        </Touchable>
      </KeyboardAwareForm>
    </Screen>
  );
}

function guardText(guard: NonNullable<Guard>): { title: string; body: string; primary: string; secondary?: string } {
  const r = guard.readiness;
  switch (guard.kind) {
    case 'no_photo':
      return {
        title: 'No outside photo yet',
        body: 'Take at least one outside photo of the car at return. The report compares it with pick-up.',
        primary: 'Take photos',
      };
    case 'missing':
      return {
        title: r.missing.length === 1 ? '1 angle not photographed' : `${r.missing.length} angles not photographed`,
        body: `${listLabels(r.missing)} ${r.missing.length === 1 ? 'has' : 'have'} no return photo. Photograph ${r.missing.length === 1 ? 'it' : 'them'}, or skip ${r.missing.length === 1 ? 'it' : 'them'}: the report then says "Not photographed".`,
        primary: 'Take photos',
        secondary: r.missing.length === 1 ? 'Skip it' : 'Skip them',
      };
    case 'unreviewed':
      return {
        title: r.unreviewed.length === 1 ? '1 angle not compared' : `${r.unreviewed.length} angles not compared`,
        body: `${listLabels(r.unreviewed)} ${r.unreviewed.length === 1 ? 'was' : 'were'} not compared with pick-up yet.`,
        primary: 'Compare now',
        secondary: 'They look the same',
      };
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mileageRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dashboard: {
    width: 88,
    height: 66,
    marginTop: 26,
    borderRadius: radii.photo,
    overflow: 'hidden',
  },
  fieldLabel: { marginBottom: 8 },
  summary: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, minHeight: 48 },
  guardBody: { paddingHorizontal: layout.screenGutter, paddingTop: 4 },
  guardActions: { gap: 8 },
});
