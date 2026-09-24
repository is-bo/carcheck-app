import { router, useLocalSearchParams } from 'expo-router';
import { Car, Check, CircleAlert, Plus, Undo2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';

import {
  ConflictError,
  createVehicle,
  DataError,
  discardDraft,
  findVehiclesByPlate,
  getRental,
  listVehicles,
  setRentalVehicle,
} from '@/data/repos';
import type { Id, VehicleListItem } from '@/domain/types';
import { returnRoutes } from '@/features/evidence/returnRoutes';
import { StartFlowScreen, useExitStartFlow } from '@/features/inspection/StartFlowScreen';
import { startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import {
  BottomSheet,
  Button,
  Chip,
  EmptyState,
  formatPlate,
  formatRelativeDateTime,
  Icon,
  ListRow,
  normalizePlate,
  PlateFrame,
  SectionHeader,
  showToast,
  SkeletonRows,
  Text,
  TextField,
} from '@/ui';
import { layout, light } from '@/ui/theme/tokens';

function describe(v: VehicleListItem['vehicle']): string {
  const name = [v.make, v.model].filter(Boolean).join(' ');
  return [name, v.color].filter(Boolean).join(' · ') || 'No make or model yet';
}

function outLine(item: VehicleListItem): string | null {
  if (!item.out) return null;
  const who = item.out.customerName ? ` · ${item.out.customerName}` : '';
  const due = item.out.expectedReturnAt ? ` · due ${formatRelativeDateTime(item.out.expectedReturnAt)}` : '';
  return `Out${who}${due}`;
}

/** Step 1 (UX §2.1): one tap on an available vehicle selects it and advances. */
export default function VehicleStep() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<Id | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [outItem, setOutItem] = useState<VehicleListItem | null>(null);
  /** Switching car on a draft that already has pick-up photos: keep them or delete them? */
  const [switchTo, setSwitchTo] = useState<Id | null>(null);
  const exit = useExitStartFlow();

  const rental = useLiveQuery(() => getRental(id), [id], ['rental']);
  const all = useLiveQuery(() => listVehicles(), [], ['vehicle', 'rental']);
  const q = search.trim();
  const results = useMemo(() => {
    const items = all.data ?? [];
    if (!q) return items;
    const key = normalizePlate(q);
    const lower = q.toLowerCase();
    return items.filter(
      (i) =>
        normalizePlate(i.vehicle.plate).includes(key) ||
        (i.vehicle.make ?? '').toLowerCase().includes(lower) ||
        (i.vehicle.model ?? '').toLowerCase().includes(lower),
    );
  }, [all.data, q]);
  const exact = !!q && (all.data ?? []).some((i) => normalizePlate(i.vehicle.plate) === normalizePlate(q));
  const selectedId = rental.data?.vehicleId ?? null;

  const choose = async (vehicleId: Id, beforePhotos?: 'keep' | 'delete') => {
    if (busyId) return;
    setBusyId(vehicleId);
    try {
      await setRentalVehicle(id, vehicleId, { beforePhotos });
      setSwitchTo(null);
      if (beforePhotos === 'delete') showToast('Pick-up photos deleted');
      router.push(startHref(id, 'customer'));
    } catch (e) {
      if (e instanceof ConflictError && e.reason === 'has_photos') setSwitchTo(vehicleId);
      else showToast(e instanceof DataError ? e.message : 'Couldn’t choose this vehicle. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  /** The other car's return opens from Home; a draft with no car yet is not worth keeping. */
  const openOtherReturn = async (otherRentalId: Id) => {
    if (!rental.data?.vehicleId) {
      try {
        await discardDraft(id);
      } catch {
        // Kept as an unfinished draft; nothing is lost.
      }
      exit({ toast: null, to: returnRoutes.entry(otherRentalId) });
    } else {
      exit({ to: returnRoutes.entry(otherRentalId) });
    }
  };

  const header = (
    <View>
      <View style={styles.search}>
        <TextField
          variant="search"
          value={search}
          onChangeText={setSearch}
          placeholder="Plate, make or model"
          accessibilityLabel="Search vehicles"
          autoCapitalize="characters"
          returnKeyType="search"
        />
      </View>
      {!exact && all.data ? (
        <ListRow
          leading={<Icon icon={Plus} color={light.accent} />}
          title={
            <Text variant="bodyStrong" tone="accent">
              {q ? `Add “${formatPlate(q)}” as new vehicle` : 'Add a new vehicle'}
            </Text>
          }
          onPress={() => setCreateOpen(true)}
          divider={false}
        />
      ) : null}
      {results.length > 0 ? <SectionHeader title={q ? 'Matches' : 'All vehicles'} count={q ? results.length : undefined} /> : null}
    </View>
  );

  let body;
  if (all.loading) {
    body = (
      <View>
        {header}
        <SkeletonRows count={4} />
      </View>
    );
  } else if (all.error && !all.data) {
    body = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn’t load your vehicles."
        body="Your data is safe. Try again."
        action={<Button label="Try again" onPress={all.reload} />}
      />
    );
  } else {
    body = (
      <FlatList
        data={results}
        keyExtractor={(i) => i.vehicle.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        ListEmptyComponent={
          (all.data ?? []).length === 0 ? (
            <EmptyState icon={Car} title="No cars yet." body="Add the first one now: only the plate is needed." />
          ) : (
            <EmptyState icon={Car} title={`No vehicle matches “${q}”.`} body="Check the plate, or add it as a new vehicle." />
          )
        }
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const out = outLine(item);
          const selected = item.vehicle.id === selectedId;
          return (
            <ListRow
              title={<PlateFrame plate={item.vehicle.plate} />}
              subtitle={describe(item.vehicle)}
              meta={out ?? undefined}
              onPress={item.out ? () => setOutItem(item) : () => choose(item.vehicle.id)}
              onLongPress={item.out ? () => setOutItem(item) : undefined}
              trailing={
                busyId === item.vehicle.id ? (
                  <Text variant="labelSmall" tone="secondary">
                    Choosing…
                  </Text>
                ) : selected ? (
                  <Icon icon={Check} />
                ) : null
              }
              divider={index < results.length - 1}
              accessibilityLabel={`${formatPlate(item.vehicle.plate)}, ${describe(item.vehicle)}${out ? `, ${out}` : ''}${selected ? ', selected' : ''}`}
              accessibilityHint={item.out ? 'Not available. Opens its return.' : 'Uses this vehicle and continues'}
            />
          );
        }}
      />
    );
  }

  return (
    <StartFlowScreen
      rentalId={id}
      route="vehicle"
      insets={{ bottom: false }}
      overlay={
        <>
          <QuickCreateSheet
            open={createOpen}
            initialPlate={q}
            known={all.data ?? []}
            onClose={() => setCreateOpen(false)}
            onUse={(vehicleId) => {
              setCreateOpen(false);
              void choose(vehicleId);
            }}
          />
          <BottomSheet
            open={!!outItem}
            onClose={() => setOutItem(null)}
            snapPoints={[240]}
            accessibilityLabel="Vehicle out"
            header={outItem ? <PlateFrame plate={outItem.vehicle.plate} /> : null}
          >
            <View style={styles.outBody}>
              <Text variant="body" tone="secondary">
                {outItem ? outLine(outItem) : ''}. It can’t start a new rental until it is returned.
              </Text>
              <Button
                label="Start its return"
                icon={Undo2}
                variant="secondary"
                fullWidth
                onPress={() => {
                  const rid = outItem?.out?.rentalId;
                  setOutItem(null);
                  if (rid) void openOtherReturn(rid);
                }}
              />
            </View>
          </BottomSheet>
          <BottomSheet
            open={!!switchTo}
            onClose={() => setSwitchTo(null)}
            snapPoints={[340]}
            accessibilityLabel="Change vehicle"
            header={<Text variant="titleL">Change the vehicle?</Text>}
          >
            <View style={styles.outBody}>
              <Text variant="body" tone="secondary">
                This rental already has pick-up photos. Are they of this car?
              </Text>
              <Button
                label="Same car, keep photos"
                variant="secondary"
                fullWidth
                loading={!!switchTo && busyId === switchTo}
                onPress={() => switchTo && void choose(switchTo, 'keep')}
              />
              <Button
                label="Different car, delete photos"
                variant="destructive"
                fullWidth
                onPress={() => switchTo && void choose(switchTo, 'delete')}
              />
            </View>
          </BottomSheet>
        </>
      }
    >
      {body}
    </StartFlowScreen>
  );
}

// ---------------------------------------------------------------------------------------------

interface QuickCreateProps {
  open: boolean;
  initialPlate: string;
  known: readonly VehicleListItem[];
  onClose: () => void;
  onUse: (vehicleId: Id) => void;
}

/** "Save & use" (UX §2.1): plate required; make, model, colour, year optional. */
function QuickCreateSheet({ open, initialPlate, known, onClose, onUse }: QuickCreateProps) {
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [year, setYear] = useState('');
  const [errors, setErrors] = useState<{ plate?: string; year?: string }>({});
  const [duplicate, setDuplicate] = useState<Id | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  // Fresh form on every open, plate prefilled from the search.
  if (open && !wasOpen) {
    setWasOpen(true);
    setPlate(formatPlate(initialPlate));
    setMake('');
    setModel('');
    setColor('');
    setYear('');
    setErrors({});
    setDuplicate(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const m = make.trim().toLowerCase();
    const mo = model.trim().toLowerCase();
    const out: { make: string | null; model: string | null; label: string }[] = [];
    for (const { vehicle } of known) {
      if (!vehicle.model && !vehicle.make) continue;
      const label = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
      if (seen.has(label.toLowerCase())) continue;
      if (m && !(vehicle.make ?? '').toLowerCase().startsWith(m)) continue;
      if (mo && !(vehicle.model ?? '').toLowerCase().startsWith(mo)) continue;
      if (label.toLowerCase() === `${m} ${mo}`.trim()) continue;
      seen.add(label.toLowerCase());
      out.push({ make: vehicle.make, model: vehicle.model, label });
      if (out.length === 4) break;
    }
    return out;
  }, [known, make, model]);

  const save = async () => {
    const p = plate.trim();
    const y = year.trim() ? Number(year.trim()) : null;
    const next: typeof errors = {};
    if (!p) next.plate = 'Enter the plate.';
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > 2100)) next.year = 'Enter a year like 2021.';
    setErrors(next);
    if (next.plate || next.year) return;
    setSaving(true);
    try {
      const same = await findVehiclesByPlate(p);
      const usable = same.find((v) => v.archivedAt === null);
      if (usable) {
        setDuplicate(usable.id);
        setErrors({ plate: `${formatPlate(usable.plate)} is already in your vehicles.` });
        return;
      }
      const v = await createVehicle({ plate: p, make, model, color, year: y });
      onUse(v.id);
    } catch (e) {
      showToast(e instanceof DataError ? e.message : 'Couldn’t save the vehicle. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[520]}
      accessibilityLabel="New vehicle"
      header={<Text variant="titleL">New vehicle</Text>}
      footer={
        duplicate ? (
          <View style={styles.footerRow}>
            <Button label="Use existing" variant="secondary" onPress={() => onUse(duplicate)} style={styles.flex} />
          </View>
        ) : (
          <Button label="Save & use" onPress={save} loading={saving} fullWidth />
        )
      }
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <TextField
          label="Plate"
          variant="plate"
          value={plate}
          onChangeText={(t) => {
            setPlate(t);
            if (errors.plate) setErrors((e) => ({ ...e, plate: undefined }));
            setDuplicate(null);
          }}
          error={errors.plate}
          autoFocus={!initialPlate}
          returnKeyType="next"
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Make" optional value={make} onChangeText={setMake} autoCapitalize="words" />
          </View>
          <View style={styles.flex}>
            <TextField label="Model" optional value={model} onChangeText={setModel} autoCapitalize="words" />
          </View>
        </View>
        {suggestions.length > 0 ? (
          <View style={styles.suggestions} accessibilityLabel="Models you already have">
            {suggestions.map((s) => (
              <Chip
                key={s.label}
                label={s.label}
                selected={false}
                onPress={() => {
                  setMake(s.make ?? '');
                  setModel(s.model ?? '');
                }}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Colour" optional value={color} onChangeText={setColor} autoCapitalize="words" />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Year"
              optional
              variant="numeric"
              value={year}
              onChangeText={(t) => setYear(t.replace(/[^0-9]/g, '').slice(0, 4))}
              error={errors.year}
            />
          </View>
        </View>
        <Text variant="bodySmall" tone="secondary">
          VIN, photo and notes can be added later in the vehicle’s details.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 4 },
  list: { paddingBottom: 32 },
  outBody: { paddingHorizontal: layout.screenGutter, gap: 16, paddingTop: 8 },
  form: { paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 8, gap: 16 },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -4 },
  footerRow: { flexDirection: 'row', gap: 12 },
});
