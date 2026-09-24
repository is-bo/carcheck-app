import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams, type Href } from 'expo-router';
import { Ban, RotateCcw, TriangleAlert } from 'lucide-react-native';

import { resolveFileUri } from '@/data/files';
import { cancelRental, getRentalDetail, listInspectionAngles, reopenReturn, startReturn, type DataEntity } from '@/data/repos';
import { damageLabel, damageTypeLabel, DAMAGE_SEVERITY_LABELS } from '@/domain/damage';
import { shareContractPdf } from '@/features/contract/contractPdf';
import {
  crossAgent,
  fuelLabel,
  OverflowButton,
  type OverflowAction,
  outStatusLine,
  returnedStatusLine,
  useLiveQuery,
} from '@/features/entities';
import {
  ActionFooter,
  Button,
  ConfirmDialog,
  EmptyState,
  formatDate,
  formatDateTime,
  formatMileage,
  ListRow,
  ListSection,
  MarkerBadge,
  PhotoTile,
  PlateFrame,
  Screen,
  SkeletonRows,
  Text,
  showToast,
  type TileMark,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';

const WATCH: readonly DataEntity[] = ['rental', 'inspection', 'photo', 'damage', 'contract', 'artifact'];
const SKIP_REASON_LABEL: Record<string, string> = { blocked: 'Blocked', too_dark: 'Too dark', other: 'Other' };

export default function RentalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLiveQuery(() => getRentalDetail(id), WATCH);
  const beforeAngles = useLiveQuery(() => listInspectionAngles(id, 'before'), WATCH);
  const detail = query.data;

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startingReturn, setStartingReturn] = useState(false);
  const [sharingContract, setSharingContract] = useState(false);

  if (query.loading && !detail) {
    return (
      <Screen title="Rental" leading="back">
        <SkeletonRows count={6} />
      </Screen>
    );
  }
  if (query.error || !detail) {
    return (
      <Screen title="Rental" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this rental"
          body={query.error instanceof Error ? query.error.message : 'It may have been discarded.'}
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }

  const { item } = detail;
  const { rental, derived } = item;

  // Drafts, re-signs and returns in progress belong to their flow, not this screen (UX_FLOWS §1:
  // "Draft -> redirects to its current step"). The start/return agents own the actual resume logic.
  if (derived.returnInProgress) return <Redirect href={crossAgent.returnEntry(id)} />;
  if (rental.status === 'draft' || derived.needsSignature) return <Redirect href={crossAgent.startEntry(id)} />;

  async function handleStartReturn() {
    setStartingReturn(true);
    try {
      await startReturn(id);
      router.push(crossAgent.returnEntry(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't start the return.");
    } finally {
      setStartingReturn(false);
    }
  }

  async function handleEditReturn() {
    try {
      await reopenReturn(id);
      router.push(crossAgent.returnEntry(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't reopen the return.");
    }
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelRental(id);
      setCancelOpen(false);
      showToast('Rental cancelled');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't cancel this rental.");
    } finally {
      setCancelling(false);
    }
  }

  async function handleShareContract(contractId: string) {
    setSharingContract(true);
    try {
      await shareContractPdf(contractId);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't share the contract.");
    } finally {
      setSharingContract(false);
    }
  }

  const validContract = detail.contracts.find((c) => !c.void) ?? null;
  const latestContract = detail.contracts[detail.contracts.length - 1] ?? null;
  const shownContract = validContract ?? latestContract;

  const overflow: OverflowAction[] =
    rental.status === 'active'
      ? [
          { label: 'Fix contract (void & re-sign)', icon: RotateCcw, onPress: () => router.push(crossAgent.voidContract(id)) },
          { label: 'Cancel rental', icon: Ban, destructive: true, onPress: () => setCancelOpen(true) },
        ]
      : rental.status === 'returned'
        ? [{ label: 'Edit return', icon: RotateCcw, onPress: handleEditReturn }]
        : [];

  const subtitle =
    rental.status === 'active'
      ? outStatusLine(item)
      : rental.status === 'returned'
        ? returnedStatusLine(item)
        : rental.status === 'cancelled'
          ? `Cancelled${rental.cancelReason ? ` · ${rental.cancelReason}` : ''}`
          : undefined;

  const damageMarksFor = (angleKey: string, slot: number): TileMark[] =>
    detail.damage
      .filter((d) => d.angleKey === angleKey && d.slot === slot && d.foundPhase === 'before')
      .map((d) => ({ status: d.status, label: damageLabel(d) }));

  return (
    <Screen
      title={rental.reference ?? 'Rental'}
      subtitle={subtitle}
      leading="back"
      scroll
      actions={overflow.length > 0 ? <OverflowButton actions={overflow} accessibilityLabel="Rental actions" /> : undefined}
      footer={
        rental.status === 'active' ? (
          <ActionFooter>
            <Button label="Start return" onPress={handleStartReturn} loading={startingReturn} fullWidth />
          </ActionFooter>
        ) : rental.status === 'returned' ? (
          <ActionFooter>
            <Button label="Open report" onPress={() => router.push(crossAgent.report(id))} fullWidth />
          </ActionFooter>
        ) : undefined
      }
      overlay={
        <ConfirmDialog
          visible={cancelOpen}
          title="Cancel this rental?"
          message="For when the car never left. It stays in history as Cancelled."
          confirmLabel="Cancel rental"
          busy={cancelling}
          onCancel={() => setCancelOpen(false)}
          onConfirm={handleCancel}
        />
      }
    >
      <View style={styles.hero}>
        {rental.vehicle ? <PlateFrame plate={rental.vehicle.plate} /> : null}
        <Text variant="titleM" style={styles.heroTitle}>
          {rental.vehicle ? [rental.vehicle.make, rental.vehicle.model].filter(Boolean).join(' ') || 'Vehicle' : 'No vehicle'}
        </Text>
      </View>

      <ListSection title="Customer">
        <ListRow
          title={rental.customer.fullName ?? 'Walk-in customer'}
          subtitle={rental.customer.phone ?? undefined}
          chevron={!!detail.customerProfile}
          onPress={detail.customerProfile ? () => router.push(`/customer/${detail.customerProfile!.id}` as Href) : undefined}
        />
      </ListSection>

      <ListSection title="Details">
        {rental.startedAt !== null ? <ListRow title="Picked up" trailing={<Text variant="body">{formatDateTime(rental.startedAt)}</Text>} /> : null}
        {rental.expectedReturnAt !== null ? (
          <ListRow title="Expected return" trailing={<Text variant="body">{formatDateTime(rental.expectedReturnAt)}</Text>} />
        ) : null}
        {rental.startMileage !== null ? (
          <ListRow title="Start mileage" trailing={<Text variant="body" tabular>{formatMileage(rental.startMileage, rental.distanceUnit)}</Text>} />
        ) : null}
        {rental.startFuelEighths !== null ? (
          <ListRow title="Start fuel" trailing={<Text variant="body">{fuelLabel(rental.startFuelEighths)}</Text>} />
        ) : null}
        {rental.specialTerms ? <ListRow title="Special terms" subtitle={rental.specialTerms} /> : null}
        {rental.returnedAt !== null ? <ListRow title="Returned" trailing={<Text variant="body">{formatDateTime(rental.returnedAt)}</Text>} /> : null}
        {rental.returnMileage !== null ? (
          <ListRow title="Return mileage" trailing={<Text variant="body" tabular>{formatMileage(rental.returnMileage, rental.distanceUnit)}</Text>} />
        ) : null}
        {rental.returnFuelEighths !== null ? (
          <ListRow title="Return fuel" trailing={<Text variant="body">{fuelLabel(rental.returnFuelEighths)}</Text>} />
        ) : null}
        {rental.returnNotes ? <ListRow title="Return notes" subtitle={rental.returnNotes} /> : null}
      </ListSection>

      {beforeAngles.data && beforeAngles.data.length > 0 ? (
        <View style={styles.photosSection}>
          <Text variant="label" style={styles.sectionLabel}>
            Condition at pick-up
          </Text>
          <View style={styles.grid}>
            {beforeAngles.data.map((a) => {
              const marks = damageMarksFor(a.angleKey, a.slot);
              return (
                <View key={`${a.angleKey}-${a.slot}`} style={styles.cell}>
                  <PhotoTile
                    label={a.label}
                    state={a.photo ? 'captured' : a.state?.skippedAt ? 'skipped' : 'empty'}
                    source={a.photo ? resolveFileUri(a.photo.file.path) : undefined}
                    marks={marks}
                    skipReason={a.state?.skipReason ? SKIP_REASON_LABEL[a.state.skipReason] : undefined}
                    onPress={a.photo ? () => router.push(crossAgent.annotate(id, a.photo!.id)) : undefined}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {detail.damage.length > 0 ? (
        <ListSection title="Damage" count={detail.damage.length}>
          {detail.damage.map((d) => (
            <ListRow
              key={d.id}
              leading={<MarkerBadge status={d.status} label={damageLabel(d)} size={24} accessible={false} />}
              title={damageTypeLabel(d.type)}
              subtitle={[d.locationLabel, d.severity ? DAMAGE_SEVERITY_LABELS[d.severity] : null].filter(Boolean).join(' · ') || undefined}
              chevron={!!(d.afterPhotoId ?? d.beforePhotoId)}
              onPress={
                d.afterPhotoId ?? d.beforePhotoId
                  ? () => router.push(crossAgent.annotate(id, (d.afterPhotoId ?? d.beforePhotoId)!))
                  : undefined
              }
            />
          ))}
        </ListSection>
      ) : null}

      {shownContract ? (
        <ListSection title="Contract">
          <ListRow
            title={shownContract.void ? `Voided ${formatDate(shownContract.void.voidedAt)}` : `Signed ${formatDate(shownContract.signedAt)}`}
            subtitle={detail.contracts.length > 1 ? `${detail.contracts.length} versions` : undefined}
            trailing={
              <View style={styles.contractActions}>
                <Button label="View" variant="quiet" onPress={() => router.push(crossAgent.contractViewer(id))} />
                <Button
                  label="Share PDF"
                  variant="quiet"
                  loading={sharingContract}
                  onPress={() => handleShareContract(shownContract.id)}
                />
              </View>
            }
          />
        </ListSection>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: layout.screenGutter, paddingTop: 16, gap: 8 },
  heroTitle: { marginTop: 2 },
  photosSection: { paddingTop: 8 },
  sectionLabel: { paddingHorizontal: layout.screenGutter, paddingTop: 22, paddingBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: layout.screenGutter },
  cell: { width: '47%' },
  contractActions: { flexDirection: 'row' },
});
