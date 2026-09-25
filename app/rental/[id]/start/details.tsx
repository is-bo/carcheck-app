import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DataError, getRental, getVehicle, listInspectionAngles, updateRentalDetails, type RentalDetailsPatch } from '@/data/repos';
import { DASHBOARD_ANGLE_KEY } from '@/domain/types';
import {
  FUEL_OPTIONS,
  fuelSegment,
  parseMileage,
  presetOf,
  atHour,
  RETURN_PRESETS,
  RETURN_TIMES,
  returnAtPreset,
  shiftDays,
  shiftTime,
  type FuelValue,
} from '@/features/inspection/detailsForm';
import { usePhotoUri } from '@/features/inspection/photoFiles';
import { StartFlowScreen } from '@/features/inspection/StartFlowScreen';
import { startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import {
  BottomSheet,
  Button,
  Chip,
  formatDateLong,
  formatMileage,
  formatRelativeDateTime,
  formatTime,
  Icon,
  IconButton,
  KeyboardAwareForm,
  SegmentedControl,
  showToast,
  Text,
  TextField,
  Touchable,
} from '@/ui';
import { light, palette, radii } from '@/ui/theme/tokens';

const AUTOSAVE_MS = 700;

/** Step 4 (UX §2.4): mileage (prefilled), fuel, expected return, special terms. All but mileage optional. */
export default function DetailsStep() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rental = useLiveQuery(() => getRental(id), [id], []);
  const vehicle = useLiveQuery(async () => (rental.data?.vehicleId ? getVehicle(rental.data.vehicleId) : null), [rental.data?.vehicleId], []);
  const dashboard = useLiveQuery(
    async () => (await listInspectionAngles(id, 'before')).find((v) => v.angleKey === DASHBOARD_ANGLE_KEY)?.photo ?? null,
    [id],
    ['photo'],
  );
  const dashUri = usePhotoUri(dashboard.data, 'thumb');
  const dashFull = usePhotoUri(dashboard.data, 'display');

  const [loaded, setLoaded] = useState(false);
  const [mileage, setMileage] = useState('');
  const [prefilled, setPrefilled] = useState(false);
  const [mileageError, setMileageError] = useState<string | null>(null);
  const [fuel, setFuel] = useState<FuelValue | null>(null);
  const [returnAt, setReturnAt] = useState<number | null>(null);
  const [terms, setTerms] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const insets = useSafeAreaInsets();

  // First load (render-time adjustment): stored values, mileage prefilled from the last return.
  const vehicleReady = !!rental.data && (!rental.data.vehicleId || vehicle.data?.id === rental.data.vehicleId || !!vehicle.error);
  if (!loaded && rental.data && vehicleReady) {
    const r = rental.data;
    const last = vehicle.data?.mileage ?? null;
    setMileage(r.startMileage !== null ? String(r.startMileage) : last !== null ? String(last) : '');
    setPrefilled(r.startMileage === null && last !== null);
    setFuel(fuelSegment(r.startFuelEighths));
    setReturnAt(r.expectedReturnAt);
    setTerms(r.specialTerms ?? '');
    setTermsOpen(!!r.specialTerms);
    setLoaded(true);
  }

  const patch = (): RentalDetailsPatch | null => {
    const m = parseMileage(mileage);
    if (m === 'invalid') return null;
    return { startMileage: m, startFuelEighths: fuel === null ? null : Number(fuel), expectedReturnAt: returnAt, specialTerms: terms };
  };

  // Autosave: every change is written shortly after the last edit.
  const edited = useRef(false);
  const pending = useRef(false);
  const save = () => {
    pending.current = false;
    const p = patch();
    if (p) updateRentalDetails(id, p).catch(() => undefined);
  };
  useEffect(() => {
    if (!loaded || !edited.current) return;
    pending.current = true;
    const t = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // save() reads exactly these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mileage, fuel, returnAt, terms, id]);
  // Leaving the step (Back, step sheet, ✕) inside the autosave delay still saves the last edit.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(
    () => () => {
      if (pending.current) saveRef.current();
    },
    [],
  );
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    edited.current = true;
    set(v);
  };

  const next = async () => {
    const p = patch();
    if (!p) {
      setMileageError('Enter the mileage as a whole number.');
      return;
    }
    setBusy(true);
    try {
      pending.current = false;
      await updateRentalDetails(id, p);
      router.push(startHref(id, 'contract'));
    } catch (e) {
      showToast(e instanceof DataError ? e.message : 'Couldn’t save the details. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const unit = rental.data?.distanceUnit ?? 'km';
  const preset = presetOf(returnAt, now);
  const lastMileage = vehicle.data?.mileage ?? null;

  return (
    <StartFlowScreen
      rentalId={id}
      route="details"
      insets={{ bottom: false }}
      overlay={
        <>
          <ReturnPicker
            open={pickOpen}
            initial={returnAt ?? returnAtPreset('1d', now)}
            onClose={() => setPickOpen(false)}
            onSet={(at) => {
              setPickOpen(false);
              touch(setReturnAt)(at);
            }}
          />
          <Modal visible={zoom && !!dashFull} transparent={false} animationType="fade" onRequestClose={() => setZoom(false)} statusBarTranslucent>
            <View style={styles.zoom}>
              {dashFull ? <Image source={{ uri: dashFull }} style={styles.fill} contentFit="contain" accessibilityLabel="Dashboard photo" /> : null}
              <View style={[styles.zoomClose, { top: insets.top + 8 }]}>
                <IconButton icon={X} accessibilityLabel="Close" color={palette.onRebate} onPress={() => setZoom(false)} />
              </View>
            </View>
          </Modal>
        </>
      }
    >
      <KeyboardAwareForm footer={<Button label="Next" onPress={next} loading={busy} fullWidth disabled={!loaded} />}>
        <View style={styles.mileageRow}>
          <View style={styles.fill}>
            <TextField
              label="Start mileage"
              variant="mileage"
              unit={unit}
              value={mileage}
              onChangeText={(t) => {
                setMileageError(null);
                setPrefilled(false);
                touch(setMileage)(t.replace(/[^0-9]/g, ''));
              }}
              error={mileageError}
              hint={
                prefilled && lastMileage !== null
                  ? `From the last return (${formatMileage(lastMileage, unit)}). Check the odometer.`
                  : lastMileage !== null
                    ? `Last recorded ${formatMileage(lastMileage, unit)}`
                    : undefined
              }
              selectTextOnFocus
              maxLength={9}
            />
          </View>
          {dashUri ? (
            <Touchable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel="Dashboard photo. Tap to zoom." style={styles.dash} focusRadius={radii.photo}>
              <Image source={{ uri: dashUri }} style={styles.dashImage} contentFit="cover" />
              <Text variant="code" tone="secondary">
                Dashboard
              </Text>
            </Touchable>
          ) : null}
        </View>

        <View style={styles.group}>
          <Text variant="label">
            Fuel{' '}
            <Text variant="label" tone="tertiary">
              (optional)
            </Text>
          </Text>
          <SegmentedControl options={FUEL_OPTIONS} value={fuel} onChange={touch(setFuel)} accessibilityLabel="Fuel level" />
        </View>

        <View style={styles.group}>
          <Text variant="label">
            Expected return{' '}
            <Text variant="label" tone="tertiary">
              (optional)
            </Text>
          </Text>
          <View style={styles.chips}>
            {RETURN_PRESETS.map((p) => (
              <Chip key={p.value} label={p.label} selected={preset === p.value} onPress={() => touch(setReturnAt)(preset === p.value ? null : returnAtPreset(p.value, now))} />
            ))}
            <Chip label="Pick…" selected={returnAt !== null && preset === null} onPress={() => setPickOpen(true)} />
          </View>
          <Text variant="bodySmall" tone="secondary" tabular>
            {returnAt !== null ? `Due back ${formatRelativeDateTime(returnAt, now)}` : 'No return date. Tap a chip to set one.'}
          </Text>
        </View>

        <Touchable onPress={() => setTermsOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: termsOpen }} style={styles.toggle}>
          <Text variant="bodyStrong" tone="accent">
            Special terms for this contract
          </Text>
          <Text variant="body" tone="tertiary">
            (optional)
          </Text>
          <View style={styles.fill} />
          <Icon icon={termsOpen ? ChevronUp : ChevronDown} color={light.accent} />
        </Touchable>
        {termsOpen ? (
          <TextField
            label="Special terms"
            value={terms}
            onChangeText={touch(setTerms)}
            multiline
            hint="Printed in this rental’s contract only, e.g. “Child seat included.”"
            maxLength={1000}
          />
        ) : null}
      </KeyboardAwareForm>
    </StartFlowScreen>
  );
}

function ReturnPicker({ open, initial, onClose, onSet }: { open: boolean; initial: number; onClose: () => void; onSet: (at: number) => void }) {
  const [at, setAt] = useState(initial);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setAt(initial);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }
  const stepper = (label: string, value: string, onPrev: () => void, onNext: () => void, what: string) => (
    <View style={styles.group}>
      <Text variant="label">{label}</Text>
      <View style={styles.stepper}>
        <IconButton icon={ChevronLeft} accessibilityLabel={`Earlier ${what}`} onPress={onPrev} />
        <Text variant="titleM" tabular align="center" style={styles.fill} accessibilityLiveRegion="polite">
          {value}
        </Text>
        <IconButton icon={ChevronRight} accessibilityLabel={`Later ${what}`} onPress={onNext} />
      </View>
    </View>
  );
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[480]}
      accessibilityLabel="Pick the return date"
      header={<Text variant="titleL">Expected return</Text>}
      footer={<Button label="Set return date" onPress={() => onSet(at)} fullWidth />}
    >
      <View style={styles.picker}>
        {stepper('Day', formatDateLong(at), () => setAt((a) => shiftDays(a, -1)), () => setAt((a) => shiftDays(a, 1)), 'day')}
        <View style={styles.chips}>
          <Chip label="−1 week" selected={false} onPress={() => setAt((a) => shiftDays(a, -7))} />
          <Chip label="+1 week" selected={false} onPress={() => setAt((a) => shiftDays(a, 7))} />
        </View>
        {stepper('Time', formatTime(at), () => setAt((a) => shiftTime(a, -1)), () => setAt((a) => shiftTime(a, 1)), 'time')}
        <View style={styles.chips}>
          {RETURN_TIMES.map((t) => (
            <Chip key={t.label} label={t.label} selected={formatTime(at) === formatTime(atHour(at, t.hour))} onPress={() => setAt((a) => atHour(a, t.hour))} />
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  mileageRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dash: { marginTop: 26, gap: 4, alignItems: 'center' },
  dashImage: { width: 86, height: 64, borderRadius: radii.photo, backgroundColor: light.surfaceTint },
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  picker: { paddingHorizontal: 16, gap: 16, paddingTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: light.surfaceTint, borderRadius: radii.md },
  zoom: { flex: 1, backgroundColor: palette.rebate },
  zoomClose: { position: 'absolute', left: 8 },
});
