import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Archive, ArchiveRestore, Car, FileText, Share2, SquarePen, Trash2, TriangleAlert } from 'lucide-react-native';

import { resolveFileUri } from '@/data/files';
import {
  archiveVehicle,
  getVehicleDetail,
  removeVehicle,
  resolveKnownDamage,
  unarchiveVehicle,
  type DataEntity,
} from '@/data/repos';
import { damageTypeLabel } from '@/domain/damage';
import type { GeneratedArtifact, KnownDamageItem } from '@/domain/types';
import {
  crossAgent,
  OverflowButton,
  type OverflowAction,
  shareGeneratedArtifact,
  useLiveQuery,
  vehicleMakeModelYear,
  vehicleMileageLine,
  vehicleStatusLine,
} from '@/features/entities';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  formatDate,
  Icon,
  ListRow,
  ListSection,
  PlateFrame,
  plural,
  Screen,
  SkeletonRows,
  Text,
  showToast,
} from '@/ui';
import { layout, palette, radii } from '@/ui/theme/tokens';

const WATCH: readonly DataEntity[] = ['vehicle', 'rental', 'damage', 'artifact'];

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLiveQuery(() => getVehicleDetail(id), WATCH);
  const detail = query.data;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (query.loading && !detail) {
    return (
      <Screen title="Vehicle" leading="back">
        <SkeletonRows count={5} />
      </Screen>
    );
  }
  if (query.error || !detail) {
    return (
      <Screen title="Vehicle" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this vehicle"
          body={query.error instanceof Error ? query.error.message : 'It may have been removed.'}
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }

  const { vehicle } = detail;
  const listShape = { vehicle, out: detail.out, lastRentalAt: null };
  const photoRel = vehicle.photo?.path ?? detail.latestPhoto?.file.path ?? null;
  const willArchive = detail.history.length > 0 || detail.knownDamage.length > 0;
  const referenceByRental = new Map(detail.history.map((h) => [h.rental.id, h.rental.reference]));

  async function handleArchive() {
    try {
      await archiveVehicle(id);
      showToast('Vehicle archived', { action: { label: 'Undo', onPress: () => void unarchiveVehicle(id).catch(() => {}) } });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't archive this vehicle.");
    }
  }

  async function handleUnarchive() {
    try {
      await unarchiveVehicle(id);
      showToast('Vehicle unarchived');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't unarchive this vehicle.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await removeVehicle(id);
      setDeleteOpen(false);
      if (result === 'deleted') {
        showToast('Vehicle deleted');
        router.back();
      } else {
        showToast('This vehicle has rental history, so it was archived instead.');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete this vehicle.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleResolve(item: KnownDamageItem) {
    try {
      await resolveKnownDamage(item.vehicleDamage.id, 'repaired');
      showToast('Marked repaired', {
        action: { label: 'Undo', onPress: () => void resolveKnownDamage(item.vehicleDamage.id, null).catch(() => {}) },
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't update this damage.");
    }
  }

  async function shareDocument(artifact: GeneratedArtifact) {
    try {
      await shareGeneratedArtifact(artifact, referenceByRental.get(artifact.rentalId) ?? null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't share this file.");
    }
  }

  const actions: OverflowAction[] = [
    { label: 'Edit', icon: SquarePen, onPress: () => router.push(`/vehicle/${id}/edit` as Href) },
    ...(vehicle.archivedAt
      ? [{ label: 'Unarchive', icon: ArchiveRestore, onPress: handleUnarchive }]
      : detail.out
        ? []
        : willArchive
          ? [{ label: 'Archive', icon: Archive, onPress: handleArchive }]
          : [{ label: 'Delete vehicle', icon: Trash2, destructive: true, onPress: () => setDeleteOpen(true) }]),
  ];

  return (
    <Screen
      title={vehicleMakeModelYear(listShape)}
      leading="back"
      scroll
      actions={<OverflowButton actions={actions} accessibilityLabel="Vehicle actions" />}
      overlay={
        <ConfirmDialog
          visible={deleteOpen}
          title="Delete this vehicle?"
          message="This can't be undone."
          confirmLabel="Delete"
          busy={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      }
    >
      <View style={styles.hero}>
        {photoRel ? (
          <Image source={{ uri: resolveFileUri(photoRel) }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Icon icon={Car} size={32} color={palette.ink3} />
          </View>
        )}
        <View style={styles.heroBody}>
          <PlateFrame plate={vehicle.plate} />
          <Text variant="bodySmall" tone="secondary" style={styles.status}>
            {vehicle.archivedAt ? 'Archived' : vehicleStatusLine(listShape)}
          </Text>
          {vehicle.vin ? (
            <Text variant="bodySmall" tone="tertiary">
              VIN {vehicle.vin}
            </Text>
          ) : null}
          {vehicleMileageLine(vehicle.mileage, 'km') ? (
            <Text variant="bodySmall" tone="tertiary">
              {vehicleMileageLine(vehicle.mileage, 'km')}
            </Text>
          ) : null}
        </View>
      </View>

      {detail.out ? (
        <ListSection>
          <ListRow
            title="Currently out"
            subtitle={detail.out.customerName ?? undefined}
            chevron
            onPress={() => router.push(crossAgent.rental(detail.out!.rentalId))}
          />
        </ListSection>
      ) : null}

      {detail.knownDamage.length > 0 ? (
        <ListSection title="Known damage" count={detail.knownDamage.length}>
          {detail.knownDamage.map((k) => (
            <ListRow
              key={k.vehicleDamage.id}
              leading={<Image source={{ uri: resolveFileUri(k.latestPhoto.file.path) }} style={styles.damageThumb} contentFit="cover" />}
              title={damageTypeLabel(k.latest.type)}
              subtitle={`Found ${formatDate(k.firstFoundAt)}`}
              trailing={<Button label="Mark repaired" variant="quiet" onPress={() => handleResolve(k)} />}
            />
          ))}
        </ListSection>
      ) : null}

      {detail.history.length > 0 ? (
        <ListSection title="History" count={detail.history.length}>
          {detail.history.map((h) => (
            <ListRow
              key={h.rental.id}
              title={h.rental.reference ?? 'Rental'}
              subtitle={`${formatDate(h.rental.activatedAt ?? h.rental.createdAt)} · ${h.rental.customer.fullName ?? 'Walk-in customer'}`}
              meta={plural(h.newDamageCount, '{n} new damage', '{n} new damages')}
              chevron
              onPress={() => router.push(crossAgent.rental(h.rental.id))}
            />
          ))}
        </ListSection>
      ) : null}

      {detail.documents.length > 0 ? (
        <ListSection title="Documents" count={detail.documents.length}>
          {detail.documents.map((doc) => (
            <ListRow
              key={doc.id}
              leading={<Icon icon={FileText} />}
              title={doc.kind === 'contract_pdf' ? 'Signed contract' : 'Damage report'}
              subtitle={formatDate(doc.generatedAt)}
              trailing={<Icon icon={Share2} />}
              onPress={() => shareDocument(doc)}
              accessibilityLabel={`Share ${doc.kind === 'contract_pdf' ? 'signed contract' : 'damage report'}`}
            />
          ))}
        </ListSection>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 16, paddingHorizontal: layout.screenGutter, paddingTop: 16 },
  photo: { width: 120, height: 90, borderRadius: radii.photo, backgroundColor: palette.paper2 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  heroBody: { flex: 1, gap: 4, justifyContent: 'center' },
  status: { marginTop: 2 },
  damageThumb: { width: 48, height: 36, borderRadius: radii.photo, backgroundColor: palette.paper2 },
});
