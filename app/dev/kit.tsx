import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Camera, Clock, HardDrive, List, Plus, RotateCcw, Share2, Trash2, Undo2 } from 'lucide-react-native';

import {
  ActionFooter,
  Banner,
  BottomSheet,
  Button,
  CarDiagram,
  ChipGroup,
  ConfirmDialog,
  EmptyState,
  Fab,
  Icon,
  IconButton,
  ListRow,
  ListSection,
  MarkerBadge,
  PhotoTile,
  PlateFrame,
  ProgressTicks,
  Screen,
  SegmentedControl,
  SkeletonRows,
  START_STEPS,
  StepHeader,
  Surface,
  Text,
  TextField,
  showToast,
  markerLabel,
  formatRelativeDateTime,
  formatMileage,
  type ExteriorAngleKey,
} from '@/ui';
import { DAMAGE_TYPES } from '@/domain/types';
import { fontFamily, layout } from '@/ui/theme/tokens';

// Dev-only design review surface: every kit component in its states. Reached by long-pressing
// the settings gear in a dev build; production builds redirect away.

const DAMAGE_OPTIONS = DAMAGE_TYPES.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }));
const COMPARE_MODES = [
  { value: 'side', label: 'Side by side' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'slider', label: 'Slider' },
] as const;
const SEVERITY = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
] as const;
const RETURN_CHIPS = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: '2d', label: '+2 days' },
  { value: '3d', label: '+3 days' },
  { value: '1w', label: '+1 week' },
  { value: 'pick', label: 'Pick…' },
] as const;
const ORBIT_STATES = { front: 'done', front_left: 'done', left: 'pending', rear: 'skipped' } as const;
const COMPARE_STATES = { front: 'done', front_left: 'done', left: 'new-damage', rear_left: 'done' } as const;
const SAMPLE_PHOTO = require('../../assets/icon.png');

export default function KitScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Kit />;
}

function Kit() {
  const [mode, setMode] = useState<(typeof COMPARE_MODES)[number]['value']>('slider');
  const [rebateMode, setRebateMode] = useState<(typeof COMPARE_MODES)[number]['value']>('side');
  const [severity, setSeverity] = useState<(typeof SEVERITY)[number]['value'] | null>(null);
  const [damage, setDamage] = useState<(typeof DAMAGE_OPTIONS)[number]['value'] | null>('scuff');
  const [returnChip, setReturnChip] = useState<string | null>('tomorrow');
  const [multi, setMulti] = useState<string[]>(['dent']);
  const [plate, setPlate] = useState('31-QM-07');
  const [mileage, setMileage] = useState('48213');
  const [search, setSearch] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(3);
  const [current, setCurrent] = useState<ExteriorAngleKey>('left');
  const [now] = useState(() => Date.now());

  return (
    <Screen
      title="Component kit"
      subtitle="Dev build only"
      scroll
      overlay={
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          snapPoints={['55%', '85%']}
          accessibilityLabel="Damage 2"
          header={
            <View style={styles.sheetHeader}>
              <MarkerBadge status="new" label="2" size={30} accessible={false} />
              <View style={styles.flex}>
                <Text variant="titleL">Damage 2</Text>
                <Text variant="subtitle" tone="secondary">
                  New · found at return
                </Text>
              </View>
              <IconButton icon={Trash2} accessibilityLabel="Delete damage 2" onPress={() => setSheetOpen(false)} />
            </View>
          }
          footer={<Button label="Done" fullWidth onPress={() => setSheetOpen(false)} />}
        >
          <View style={styles.sheetBody}>
            <ChipGroup accessibilityLabel="Damage type" options={DAMAGE_OPTIONS} value={damage} onChange={setDamage} />
            <View>
              <Text variant="labelSmall" tone="secondary" style={styles.fieldLabel}>
                Severity{' '}
                <Text variant="labelSmall" tone="tertiary">
                  (optional)
                </Text>
              </Text>
              <SegmentedControl
                accessibilityLabel="Severity"
                options={SEVERITY}
                value={severity}
                onChange={setSeverity}
              />
            </View>
            <View style={styles.row}>
              <Button label="Note" variant="quiet" icon={Plus} />
              <Button label="Close-up photo" variant="quiet" icon={Plus} />
            </View>
          </View>
        </BottomSheet>
      }
    >
      <Section title="Type scale">
        <View style={styles.pad}>
          <Text variant="headline">Rentals</Text>
          <Text variant="titleL">Damage 2</Text>
          <Text variant="titleM">Left · 3 of 8</Text>
          <Text variant="body">Renault Clio · João Oliveira</Text>
          <Text variant="bodySmall" tone="secondary">
            Due Sun 27 Sep, 10:00
          </Text>
          <Text variant="label">Due back</Text>
          <Text variant="numericLarge">{formatMileage(48213, 'km')}</Text>
          <Text variant="code" tone="secondary">
            Left · 3/8 · Pick-up · 24 Sep 2026 10:04
          </Text>
          <Text variant="customer.headline">Please review your rental</Text>
          <Text variant="customer.body">You confirm that the damage above is all the damage present.</Text>
        </View>
      </Section>

      <Section title="Buttons">
        <View style={styles.pad}>
          <Button label="Hand to customer" fullWidth />
          <Button label="Sign agreement" variant="accent" size="customer" fullWidth />
          <View style={styles.row}>
            <Button label="Return" variant="secondary" size="small" />
            <Button label="Resume" variant="tonal" size="small" />
            <Button label="Note" variant="quiet" icon={Plus} />
          </View>
          <View style={styles.row}>
            <Button label="Clear" variant="secondary" icon={RotateCcw} />
            <Button label="Discard draft" variant="destructive" icon={Trash2} onPress={() => setDialogOpen(true)} />
          </View>
          <View style={styles.row}>
            <Button label="Saving" loading />
            <Button label="Next" disabled />
          </View>
          <View style={styles.row}>
            <IconButton icon={Share2} accessibilityLabel="Share" />
            <IconButton icon={List} accessibilityLabel="List of marks" selected />
            <IconButton icon={Trash2} accessibilityLabel="Delete" disabled />
          </View>
        </View>
      </Section>

      <Section title="Plate, progress, markers">
        <View style={styles.pad}>
          <View style={styles.row}>
            <PlateFrame plate="31-qm-07" />
            <PlateFrame plate="74-XR-19" size="small" />
            <ProgressTicks done={5} accessibilityLabel="Inspection 5 of 8" />
          </View>
          <View style={styles.row}>
            <MarkerBadge status="pre_existing" label={markerLabel('pre_existing', 1)} />
            <MarkerBadge status="new" label={markerLabel('new', 1)} />
            <MarkerBadge status="uncertain" label={markerLabel('uncertain', 2)} />
            <MarkerBadge status="new" label="1" reference />
            <MarkerBadge status="pre_existing" label="B" reference />
            <MarkerBadge status="new" label="12" size={22} />
            <MarkerBadge status="pre_existing" label="C" size={30} />
          </View>
        </View>
      </Section>

      <ListSection title="Unfinished" band>
        <ListRow
          title={<PlateFrame plate="05-TL-62" />}
          subtitle="Fiat 500 · Carla Mendes"
          meta={
            <View style={styles.meta}>
              <ProgressTicks done={5} />
              <Text variant="bodySmall" tone="secondary" tabular>
                Inspection 5 of 8
              </Text>
            </View>
          }
          trailing={<Button label="Resume" variant="tonal" size="small" />}
          onPress={() => {}}
        />
      </ListSection>
      <ListSection title="Due back" count={2}>
        <ListRow
          title={<PlateFrame plate="31-QM-07" />}
          subtitle="Renault Clio · João Oliveira"
          meta={
            <View style={styles.meta}>
              <Icon icon={Clock} size={16} />
              <Text variant="bodySmall" style={styles.late} tabular>
                Overdue · was due 11:30
              </Text>
            </View>
          }
          trailing={<Button label="Return" variant="secondary" size="small" />}
          onPress={() => {}}
        />
        <ListRow
          title={<PlateFrame plate="74-XR-19" />}
          subtitle="Seat Ibiza · Maria Keller"
          meta={formatRelativeDateTime(now + 3 * 3600_000, now)}
          trailing={<Button label="Return" variant="secondary" size="small" />}
          onPress={() => {}}
        />
      </ListSection>
      <ListSection title="Settings rows">
        <ListRow title="Agency details" subtitle="Name, logo, address" chevron onPress={() => {}} />
        <ListRow title="Backup & restore" subtitle="Never backed up" chevron onPress={() => {}} />
        <ListRow title="Out · Maria Keller · due Thu" subtitle="Disabled row" disabled onPress={() => {}} />
      </ListSection>

      <Section title="Loading, empty, banner">
        <SkeletonRows count={2} />
        <Banner
          icon={HardDrive}
          message="Storage is getting low (320 MB free)."
          action={<Button label="Manage storage" variant="quiet" />}
        />
        <EmptyState
          icon={Camera}
          title="No rentals yet."
          body="When a customer picks up a car, tap New rental."
          action={<Button label="New rental" icon={Plus} variant="secondary" />}
        />
      </Section>

      <Section title="Fields">
        <View style={styles.pad}>
          <TextField variant="search" placeholder="Plate, name or R-number" value={search} onChangeText={setSearch} />
          <TextField label="Plate" variant="plate" value={plate} onChangeText={setPlate} hint="As printed on the car" />
          <TextField label="Start mileage" variant="mileage" unit="km" value={mileage} onChangeText={setMileage} />
          <TextField label="Phone" optional variant="numeric" placeholder="+351 …" />
          <TextField
            label="Return mileage"
            variant="numeric"
            value="41000"
            error="Lower than the start mileage (48,213 km)."
          />
          <TextField label="Notes" optional multiline placeholder="Anything the next person should know" />
          <TextField label="Agency name" disabled value="Atlântico Rent" />
        </View>
      </Section>

      <Section title="Segmented and chips">
        <View style={styles.pad}>
          <SegmentedControl accessibilityLabel="Compare mode" options={COMPARE_MODES} value={mode} onChange={setMode} />
          <SegmentedControl accessibilityLabel="Severity" options={SEVERITY} value={severity} onChange={setSeverity} />
          <ChipGroup accessibilityLabel="Damage type" options={DAMAGE_OPTIONS} value={damage} onChange={setDamage} />
          <ChipGroup
            accessibilityLabel="Damage types"
            mode="multi"
            options={DAMAGE_OPTIONS}
            value={multi}
            onChange={setMulti}
          />
        </View>
        <ChipGroup
          accessibilityLabel="Expected return"
          layout="row"
          options={RETURN_CHIPS}
          value={returnChip}
          onChange={setReturnChip}
        />
      </Section>

      <Section title="Step header">
        <StepHeader
          step={step}
          steps={START_STEPS}
          onClose={() => showToast('Draft saved')}
          onTitlePress={() => setStep((s) => (s % START_STEPS.length) + 1)}
        />
      </Section>

      <Section title="Photo tiles">
        <View style={[styles.pad, styles.grid]}>
          <View style={styles.cell}>
            <PhotoTile label="Front" state="captured" source={SAMPLE_PHOTO} onPress={() => {}} />
          </View>
          <View style={styles.cell}>
            <PhotoTile
              label="Front left"
              state="damaged"
              source={SAMPLE_PHOTO}
              marks={[
                { status: 'pre_existing', label: 'A' },
                { status: 'pre_existing', label: 'B' },
              ]}
              onPress={() => {}}
            />
          </View>
          <View style={styles.cell}>
            <PhotoTile label="Left" state="skipped" skipReason="Blocked" onPress={() => {}} />
          </View>
          <View style={styles.cell}>
            <PhotoTile label="Rear left" state="empty" selected onPress={() => {}} />
          </View>
        </View>
      </Section>

      <Section title="Car diagram">
        <View style={[styles.pad, styles.row, styles.center]}>
          <CarDiagram states={ORBIT_STATES} current={current} size={96} onPress={() => {}} />
          <CarDiagram states={COMPARE_STATES} size={96} />
        </View>
        <View style={styles.center}>
          <CarDiagram states={ORBIT_STATES} current={current} size={240} onSelectAngle={setCurrent} />
        </View>
      </Section>

      <Surface tone="rebate" style={styles.rebate}>
        <Text variant="labelSmall" tone="secondary" style={styles.rebateHead}>
          Rebate surface
        </Text>
        <View style={styles.pad}>
          <SegmentedControl
            accessibilityLabel="Compare mode"
            options={COMPARE_MODES}
            value={rebateMode}
            onChange={setRebateMode}
          />
          <View style={[styles.row, styles.center]}>
            <CarDiagram states={ORBIT_STATES} current="left" size={92} />
            <View style={styles.flex}>
              <PhotoTile label="Front left" state="captured" source={SAMPLE_PHOTO} selected />
            </View>
          </View>
          <View style={styles.row}>
            <Button label="Mark new damage" icon={Plus} style={styles.flex} />
            <Button label="Next angle" variant="secondary" style={styles.flex} />
          </View>
          <ListRow
            leading={<MarkerBadge status="new" label="1" size={24} accessible={false} />}
            title="New 1 · Dent, left rear door"
            chevron
            onPress={() => {}}
          />
        </View>
      </Surface>

      <Section title="Feedback">
        <View style={styles.pad}>
          <Button
            label="Show snackbar with Undo"
            variant="secondary"
            icon={Undo2}
            onPress={() =>
              showToast('Damage 3 deleted', {
                action: { label: 'Undo', onPress: () => showToast('Damage 3 restored') },
              })
            }
          />
          <Button label="Open quick sheet" variant="secondary" onPress={() => setSheetOpen(true)} />
          <Button
            label="Open destructive dialog"
            variant="destructive"
            icon={Trash2}
            onPress={() => setDialogOpen(true)}
          />
        </View>
      </Section>

      <Section title="Action footer">
        <ActionFooter row compact>
          <Button label="Clear" variant="secondary" icon={RotateCcw} />
          <Button label="Confirm signature" variant="accent" style={styles.flex} />
        </ActionFooter>
      </Section>

      <View style={styles.fabStage}>
        <Fab icon={Plus} label="New rental" onPress={() => showToast('The snackbar sits above the FAB')} />
      </View>

      <ConfirmDialog
        visible={dialogOpen}
        title="Discard this draft?"
        message="Photos taken for it will be deleted."
        confirmLabel="Discard"
        busy={busy}
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setBusy(true);
          setTimeout(() => {
            setBusy(false);
            setDialogOpen(false);
            showToast('Draft discarded');
          }, 900);
        }}
      />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <Text variant="label" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: layout.screenGutter, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  center: { justifyContent: 'center', alignItems: 'center' },
  flex: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  late: { fontFamily: fontFamily.semibold },
  sectionTitle: { paddingHorizontal: layout.screenGutter, paddingTop: 32, paddingBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { width: '47%' },
  rebate: { marginTop: 32, paddingBottom: 16 },
  rebateHead: { paddingHorizontal: layout.screenGutter, paddingTop: 16, paddingBottom: 12 },
  fieldLabel: { marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetBody: { paddingHorizontal: layout.screenGutter, paddingTop: 12, gap: 18 },
  fabStage: { height: 120, marginTop: 24 },
});
