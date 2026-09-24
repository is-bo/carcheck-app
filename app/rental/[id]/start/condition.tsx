import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, History, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  confirmKnownDamage,
  DataError,
  deleteDamage,
  getRentalFacts,
  listDamage,
  listInspectionAngles,
  listKnownDamageForRental,
  resolveKnownDamage,
} from '@/data/repos';
import { damageLabel, damageTypeLabel } from '@/domain/damage';
import { inspectionProgress, isBeforeEditable } from '@/domain/rentalLifecycle';
import type { Damage, Id, InspectionAngleView, KnownDamageItem, SkipReason } from '@/domain/types';
import { MarkedPhoto } from '@/features/damage/MarkedPhoto';
import { usePhotoUri } from '@/features/inspection/photoFiles';
import { StartFlowScreen } from '@/features/inspection/StartFlowScreen';
import { annotateHref, startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import {
  ActionFooter,
  Banner,
  BottomSheet,
  Button,
  EmptyState,
  formatDate,
  ListRow,
  ListSection,
  markerLabel,
  PhotoTile,
  plural,
  showToast,
  Text,
} from '@/ui';
import { layout, light, radii } from '@/ui/theme/tokens';

const SKIP_WORD: Record<SkipReason, string> = { blocked: 'Blocked', too_dark: 'Too dark', other: 'Other' };
const EXTRAS = [
  { key: 'interior', label: 'Interior' },
  { key: 'wheel', label: 'Wheel' },
  { key: 'roof', label: 'Roof' },
  { key: 'closeup', label: 'Close-up' },
  { key: 'other', label: 'Other' },
] as const;

const pairId = (k: { angleKey: string; slot: number }) => `${k.angleKey}#${k.slot}`;

/** Step 3b (UX §2.3): the angle grid, existing-damage marking and the known-damage carry-over. */
export default function ConditionStep() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [knownOpen, setKnownOpen] = useState(false);

  const views = useLiveQuery(() => listInspectionAngles(id, 'before'), [id], ['photo', 'inspection', 'damage']);
  const damage = useLiveQuery(() => listDamage(id, { phase: 'before' }), [id], ['damage', 'photo']);
  const known = useLiveQuery(() => listKnownDamageForRental(id), [id], ['damage', 'vehicle', 'rental']);
  const facts = useLiveQuery(() => getRentalFacts(id), [id], ['rental', 'photo', 'inspection', 'contract']);

  const marksByPair = useMemo(() => {
    const map = new Map<string, Damage[]>();
    for (const d of damage.data ?? []) {
      const list = map.get(pairId(d)) ?? [];
      list.push(d);
      map.set(pairId(d), list);
    }
    return map;
  }, [damage.data]);

  const progress = inspectionProgress(facts.data?.before ?? null);
  const editable = facts.data ? isBeforeEditable(facts.data.status, facts.data.hasValidContract) : true;
  const pendingKnown = (known.data ?? []).filter((k) => !k.observationInRental && !k.vehicleDamage.resolvedAt);
  const existingCount = damage.data?.length ?? 0;

  const openTile = (v: InspectionAngleView) => {
    if (v.photo) router.push(annotateHref(id, v.photo.id));
    else if (v.state?.skippedAt) router.push(startHref(id, 'capture', { angle: v.angleKey, single: '1' }));
    else router.push(startHref(id, 'capture', { angle: v.angleKey }));
  };

  // All angles skipped: capture reopens on a skipped angle (initialTarget) for the one required photo.
  const needsOnePhoto = progress.missing.length === 0 && !progress.hasExteriorPhoto;
  const footer = !facts.data ? null : progress.missing.length > 0 || !progress.hasExteriorPhoto ? (
    <ActionFooter rule>
      <Text variant="bodySmall" tone="secondary">
        {needsOnePhoto
          ? 'Take at least one outside photo of the car.'
          : plural(progress.missing.length, '{n} angle still to photograph or skip.', '{n} angles still to photograph or skip.')}
      </Text>
      <Button
        label={needsOnePhoto ? 'Take a photo' : 'Continue photos'}
        onPress={() => router.push(startHref(id, 'capture'))}
        fullWidth
      />
    </ActionFooter>
  ) : (
    <ActionFooter rule>
      <Button label="Next" onPress={() => router.push(startHref(id, 'details'))} fullWidth />
    </ActionFooter>
  );

  let body;
  if (views.error && !views.data) {
    body = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn’t load the photos."
        body="They are safe on this phone. Try again."
        action={<Button label="Try again" onPress={views.reload} />}
      />
    );
  } else {
    const tiles = views.data ?? [];
    const rows: InspectionAngleView[][] = [];
    for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
    body = (
      <ScrollView contentContainerStyle={styles.scroll}>
        {pendingKnown.length > 0 && editable ? (
          <Banner
            icon={History}
            message={`This car has ${plural(pendingKnown.length, '{n} known damage', '{n} known damages')}. Check they’re still there.`}
            action={<Button label="Check" variant="quiet" onPress={() => setKnownOpen(true)} />}
          />
        ) : null}
        <View style={styles.intro}>
          <Text variant="body" tone="secondary">
            {editable
              ? 'Tap a photo to mark damage. No marks means no damage.'
              : 'Pick-up photos are part of the signed contract.'}
          </Text>
          {existingCount > 0 ? (
            <Text variant="label" tabular>
              {plural(existingCount, '{n} existing damage marked', '{n} existing damages marked')}
            </Text>
          ) : null}
        </View>
        <View style={styles.grid}>
          {views.loading && !views.data
            ? [0, 1, 2].map((r) => (
                <View key={r} style={styles.row}>
                  <View style={[styles.cell, styles.placeholder]} />
                  <View style={[styles.cell, styles.placeholder]} />
                </View>
              ))
            : rows.map((row) => (
                <View key={row.map(pairId).join('|')} style={styles.row}>
                  {row.map((v) => (
                    <View key={pairId(v)} style={styles.cell}>
                      <ConditionTile view={v} marks={marksByPair.get(pairId(v)) ?? []} onPress={() => openTile(v)} />
                    </View>
                  ))}
                  {row.length === 1 ? <View style={styles.cell} /> : null}
                </View>
              ))}
        </View>
        {editable ? (
          <View style={styles.add}>
            <Button label="Add photo" icon={Plus} variant="quiet" onPress={() => setExtrasOpen(true)} />
            <Text variant="bodySmall" tone="secondary" style={styles.addHint}>
              Interior, wheels, roof or a close-up.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <StartFlowScreen
      rentalId={id}
      route="condition"
      insets={{ bottom: false }}
      footer={footer}
      overlay={
        <>
          <BottomSheet
            open={extrasOpen}
            onClose={() => setExtrasOpen(false)}
            snapPoints={[380]}
            accessibilityLabel="Add a photo"
            header={<Text variant="titleL">Add a photo</Text>}
          >
            <ListSection>
              {EXTRAS.map((e) => (
                <ListRow
                  key={e.key}
                  title={e.label}
                  chevron
                  onPress={() => {
                    setExtrasOpen(false);
                    router.push(startHref(id, 'capture', { extra: e.key }));
                  }}
                />
              ))}
            </ListSection>
          </BottomSheet>
          <KnownDamageSheet
            open={knownOpen}
            onClose={() => setKnownOpen(false)}
            rentalId={id}
            items={known.data ?? []}
            views={views.data ?? []}
          />
        </>
      }
    >
      {body}
    </StartFlowScreen>
  );
}

function ConditionTile({ view, marks, onPress }: { view: InspectionAngleView; marks: Damage[]; onPress: () => void }) {
  const uri = usePhotoUri(view.photo, 'thumb');
  const skipped = !view.photo && !!view.state?.skippedAt;
  return (
    <PhotoTile
      label={view.label}
      state={view.photo ? (marks.length > 0 ? 'damaged' : 'captured') : skipped ? 'skipped' : 'empty'}
      source={uri}
      marks={marks.map((d) => ({ status: d.status, label: markerLabel(d.status, d.number) }))}
      skipReason={skipped && view.state?.skipReason ? SKIP_WORD[view.state.skipReason] : null}
      onPress={onPress}
      accessibilityHint={view.photo ? 'Opens the photo to mark damage' : skipped ? 'Take this photo after all' : 'Take this photo'}
    />
  );
}

// ---------------------------------------------------------------------------------------------

interface KnownDamageSheetProps {
  open: boolean;
  onClose: () => void;
  rentalId: Id;
  items: readonly KnownDamageItem[];
  views: readonly InspectionAngleView[];
}

/** "Still there" / "Repaired / gone" per known damage; "Confirm all" for the common case (UX §2.3). */
function KnownDamageSheet({ open, onClose, rentalId, items, views }: KnownDamageSheetProps) {
  const [busy, setBusy] = useState(false);
  const photoFor = (item: KnownDamageItem) =>
    views.find((v) => v.angleKey === item.latest.angleKey && v.slot === item.latest.slot)?.photo ?? null;
  const pending = items.filter((k) => !k.observationInRental && !k.vehicleDamage.resolvedAt);

  const stillThere = async (item: KnownDamageItem) => {
    const photo = photoFor(item);
    if (!photo) return;
    await confirmKnownDamage(rentalId, item.vehicleDamage.id, photo.id, { v: 1, ring: item.latest.marker.ring });
  };
  const run = async (job: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await job();
    } catch (e) {
      showToast(e instanceof DataError ? e.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const confirmAll = () =>
    run(async () => {
      for (const item of pending) if (photoFor(item)) await stillThere(item);
      onClose();
    }, 'Couldn’t confirm all of them. Try again.');

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={['85%']}
      accessibilityLabel="Known damage"
      header={
        <View>
          <Text variant="titleL">Known damage</Text>
          <Text variant="subtitle" tone="secondary">
            Recorded on earlier rentals of this car
          </Text>
        </View>
      }
      footer={
        pending.some((p) => photoFor(p)) ? (
          <Button label="Confirm all still there" onPress={confirmAll} loading={busy} fullWidth />
        ) : (
          <Button label="Done" onPress={onClose} fullWidth />
        )
      }
    >
      <ScrollView contentContainerStyle={styles.knownList}>
        {items.map((item) => {
          const photo = photoFor(item);
          const mine = item.observationInRental ?? null;
          const gone = !!item.vehicleDamage.resolvedAt;
          const shown = photo ?? item.latestPhoto;
          const angle = views.find((v) => v.angleKey === item.latest.angleKey && v.slot === item.latest.slot)?.label ?? item.latest.angleKey;
          return (
            <View key={item.vehicleDamage.id} style={styles.knownItem}>
              <View style={styles.knownPhoto}>
                <MarkedPhoto
                  photo={shown}
                  size={{ width: shown.file.width, height: shown.file.height }}
                  variant="thumb"
                  badgeSize={22}
                  marks={[
                    {
                      key: item.vehicleDamage.id,
                      status: 'pre_existing',
                      label: mine ? damageLabel(mine) : '',
                      ring: item.latest.marker.ring,
                      reference: !mine,
                    },
                  ]}
                />
              </View>
              <View style={styles.knownText}>
                <Text variant="bodyStrong">{damageTypeLabel(item.latest.type)}</Text>
                <Text variant="bodySmall" tone="secondary">
                  {angle} · first seen {formatDate(item.firstFoundAt)}
                </Text>
                {mine ? (
                  <View style={styles.knownState}>
                    <Text variant="labelSmall">Still there · Existing {damageLabel(mine)}</Text>
                    <Button
                      label="Undo"
                      variant="quiet"
                      size="small"
                      disabled={busy}
                      onPress={() => run(() => deleteDamage(mine.id), 'Couldn’t undo. Try again.')}
                    />
                  </View>
                ) : gone ? (
                  <View style={styles.knownState}>
                    <Text variant="labelSmall">Marked repaired / gone</Text>
                    <Button
                      label="Undo"
                      variant="quiet"
                      size="small"
                      disabled={busy}
                      onPress={() => run(() => resolveKnownDamage(item.vehicleDamage.id, null), 'Couldn’t undo. Try again.')}
                    />
                  </View>
                ) : (
                  <View style={styles.knownActions}>
                    <Button
                      label="Still there"
                      variant="secondary"
                      size="small"
                      disabled={busy || !photo}
                      onPress={() => run(() => stillThere(item), 'Couldn’t confirm it. Try again.')}
                    />
                    <Button
                      label="Repaired / gone"
                      variant="quiet"
                      size="small"
                      disabled={busy}
                      onPress={() =>
                        run(() => resolveKnownDamage(item.vehicleDamage.id, 'not_found', { rentalId }), 'Couldn’t save that. Try again.')
                      }
                    />
                  </View>
                )}
                {!photo && !mine && !gone ? (
                  <Text variant="bodySmall" tone="secondary">
                    Take the {angle.toLowerCase()} photo first.
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 24 },
  intro: { paddingHorizontal: layout.screenGutter, paddingTop: 12, paddingBottom: 4, gap: 4 },
  grid: { paddingHorizontal: layout.screenGutter, paddingTop: 12, gap: 20 },
  row: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1, minWidth: 0 },
  placeholder: { aspectRatio: 4 / 3, borderRadius: radii.photo, backgroundColor: light.surfaceTint },
  add: { paddingHorizontal: layout.screenGutter - 12, paddingTop: 16 },
  addHint: { paddingHorizontal: 12 },
  knownList: { paddingHorizontal: layout.screenGutter, paddingBottom: 8, gap: 16 },
  knownItem: { flexDirection: 'row', gap: 12 },
  knownPhoto: { width: 128 },
  knownText: { flex: 1, gap: 2 },
  knownState: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginLeft: 0 },
  knownActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 6 },
});
