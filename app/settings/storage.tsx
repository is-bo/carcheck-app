import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HardDrive, Trash2 } from 'lucide-react-native';

import { deleteSafetyCopy, getSafetyCopy, type SafetyCopyInfo } from '@/data/backup';
import type { DataEntity } from '@/data/repos';
import { getRecordCounts, getStorageUsage } from '@/data/repos';
import { clearTempExports, useLiveQuery } from '@/features/settings';
import {
  Banner,
  Button,
  ConfirmDialog,
  ListRow,
  ListSection,
  Screen,
  SkeletonRows,
  Text,
  formatDate,
  formatFileSize,
  plural,
  showToast,
} from '@/ui';
import { layout, space } from '@/ui/theme/tokens';

const WATCH_ENTITIES: DataEntity[] = ['photo', 'contract', 'artifact', 'customer', 'vehicle', 'settings', 'rental'];

interface Group {
  count: number;
  bytes: number;
}

function sum(...groups: (Group | undefined)[]): Group {
  return groups.reduce<Group>((acc, g) => ({ count: acc.count + (g?.count ?? 0), bytes: acc.bytes + (g?.bytes ?? 0) }), {
    count: 0,
    bytes: 0,
  });
}

async function load() {
  const [storage, counts] = await Promise.all([getStorageUsage(), getRecordCounts()]);
  // getSafetyCopy() is a local fs/pointer read, not a repo call, but it belongs with the rest of
  // this screen's numbers, so it's fetched alongside them rather than during render.
  return { storage, counts, safetyCopy: getSafetyCopy() };
}

/** Settings → Storage (UX_FLOWS §1 inventory: `app/settings/storage.tsx`). */
export default function StorageSettingsScreen() {
  const { data, loading, reload } = useLiveQuery(load, WATCH_ENTITIES);
  const [clearing, setClearing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const clearTemp = () => {
    setClearing(true);
    try {
      const { bytesFreed } = clearTempExports();
      showToast(bytesFreed > 0 ? `Cleared ${formatFileSize(bytesFreed)} of temporary export files.` : 'No temporary files to clear.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not clear temporary files.');
    } finally {
      setClearing(false);
    }
  };

  const handleDeleteSafetyCopy = () => {
    setDeleting(true);
    try {
      deleteSafetyCopy();
      setDeleteOpen(false);
      showToast('Safety copy deleted');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete the safety copy.');
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <Screen title="Storage">
        <SkeletonRows count={5} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen title="Storage">
        <Text variant="body" tone="secondary" style={styles.pad}>
          Couldn’t read storage usage.
        </Text>
      </Screen>
    );
  }

  const byOwner = data.storage.byOwner;
  const photos = sum(byOwner.photo, byOwner.vehicle_photo);
  const documents = sum(byOwner.customer_document);
  const generated = sum(byOwner.artifact);
  const other = sum(byOwner.signature, byOwner.agency_logo);

  return (
    <Screen
      title="Storage"
      scroll
      overlay={
        <ConfirmDialog
          visible={deleteOpen}
          title="Delete this safety copy?"
          message="It was kept in case your last restore needed to be undone. Once deleted, the data from before that restore can't be recovered."
          confirmLabel="Delete"
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDeleteSafetyCopy}
          busy={deleting}
        />
      }
    >
      <View style={styles.pad}>
        <Text variant="numericLarge" tabular>
          {formatFileSize(data.storage.totalBytes)}
        </Text>
        <Text variant="body" tone="secondary" style={styles.totalLabel}>
          used on this phone
        </Text>
        <Text variant="bodySmall" tone="tertiary">
          {plural(data.counts.rentals, '{n} rental', '{n} rentals')} ·{' '}
          {plural(data.counts.vehicles, '{n} vehicle', '{n} vehicles')} ·{' '}
          {plural(data.counts.customers, '{n} customer', '{n} customers')}
        </Text>
      </View>

      <ListSection title="Breakdown">
        <BreakdownRow label="Photos" group={photos} />
        <BreakdownRow label="Documents" group={documents} />
        <BreakdownRow label="Generated evidence and reports" group={generated} />
        {other.count > 0 ? <BreakdownRow label="Other" group={other} /> : null}
      </ListSection>

      {data.safetyCopy ? (
        <ListSection title="Restore safety copy">
          <SafetyCopyRow info={data.safetyCopy} onDelete={() => setDeleteOpen(true)} />
        </ListSection>
      ) : null}

      <View style={styles.pad}>
        <Banner
          icon={HardDrive}
          message="Copies made for sharing or Save to folder are cleared automatically, but you can reclaim that space now."
        />
        <Button
          label="Clear temporary exports"
          variant="secondary"
          onPress={clearTemp}
          loading={clearing}
          style={styles.clearButton}
        />
      </View>
    </Screen>
  );
}

function BreakdownRow({ label, group }: { label: string; group: Group }) {
  return (
    <ListRow
      title={label}
      trailing={
        <Text variant="numeric" tone="secondary" tabular>
          {formatFileSize(group.bytes)}
        </Text>
      }
      meta={plural(group.count, '{n} file', '{n} files')}
    />
  );
}

function SafetyCopyRow({ info, onDelete }: { info: SafetyCopyInfo; onDelete: () => void }) {
  return (
    <ListRow
      title="Data from before your last restore"
      subtitle={`${formatFileSize(info.bytes)}${info.until ? ` · kept until ${formatDate(info.until)}` : ''}`}
      trailing={<Button label="Delete" variant="destructive" size="small" icon={Trash2} onPress={onDelete} />}
    />
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: layout.screenGutter, gap: space[3] },
  totalLabel: { marginTop: -space[2] },
  clearButton: { marginTop: space[4], alignSelf: 'flex-start' },
});
