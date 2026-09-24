import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { Clock, DatabaseBackup, TriangleAlert } from 'lucide-react-native';

import { getBackupStatus, type BackupStatus } from '@/data/backup';
import { useLiveQuery } from '@/features/settings';
import {
  ActionFooter,
  Banner,
  Button,
  EmptyState,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  ListRow,
  ListSection,
  plural,
  Screen,
  SkeletonRows,
  Text,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';

// Typed routes are regenerated when the dev server runs; these land with this wave.
const CREATE = '/settings/backup/create' as Href;
const RESTORE = '/settings/backup/restore' as Href;

/** Settings › Backup & restore (UX_FLOWS §9): status, what's on the phone, Create / Restore. */
export default function BackupScreen() {
  const { data, loading, error, reload } = useLiveQuery(
    () => getBackupStatus(),
    ['backup', 'rental', 'vehicle', 'customer', 'photo', 'settings'],
  );
  useFocusEffect(useCallback(() => reload(), [reload]));

  return (
    <Screen
      title="Backup & restore"
      scroll
      footer={
        data ? (
          <ActionFooter>
            <Button label="Create backup" icon={DatabaseBackup} fullWidth onPress={() => router.push(CREATE)} />
          </ActionFooter>
        ) : undefined
      }
    >
      {loading && !data ? (
        <SkeletonRows count={4} plate={false} />
      ) : data ? (
        <Overview status={data} />
      ) : (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load backup status."
          body={error instanceof Error ? error.message : 'Try again in a moment.'}
          action={<Button label="Try again" variant="secondary" onPress={reload} />}
        />
      )}
    </Screen>
  );
}

function lastBackupLine(status: BackupStatus): { title: string; detail: string } {
  const { lastBackupAt, lastBackup, lastRestore } = status;
  if (lastBackupAt === null) {
    return {
      title: 'Never backed up',
      detail: 'A backup is one file with everything CarCheck stores. Keep it somewhere other than this phone.',
    };
  }
  if (lastBackup && lastBackup.at === lastBackupAt) {
    return {
      title: `Last backup: ${formatDateTime(lastBackupAt)}`,
      detail: lastBackup.byteSize !== null ? `${formatFileSize(lastBackup.byteSize)} · ${lastBackup.fileName}` : lastBackup.fileName,
    };
  }
  return {
    title: `Last backup: ${formatDateTime(lastBackupAt)}`,
    detail: lastRestore ? `Restored onto this phone on ${formatDate(lastRestore.at)}` : 'Restored onto this phone',
  };
}

function Overview({ status }: { status: BackupStatus }) {
  const { counts, reminder } = status;
  const line = lastBackupLine(status);
  const rows: [string, string][] = [
    ['Rentals', formatNumber(counts.rentals)],
    ['Vehicles', formatNumber(counts.vehicles)],
    ['Customers', formatNumber(counts.customers)],
    ['Photos', formatNumber(counts.photos)],
    ['Signed contracts', formatNumber(counts.signedContracts)],
    ['Size', formatFileSize(status.bytes)],
  ];

  return (
    <>
      <View style={styles.status}>
        <Text variant="titleL" tabular accessibilityRole="header">
          {line.title}
        </Text>
        <Text variant="bodySmall" tone="secondary" numberOfLines={2} ellipsizeMode="middle" style={styles.statusDetail}>
          {line.detail}
        </Text>
      </View>
      {reminder.due ? (
        <Banner
          icon={Clock}
          message={
            reminder.daysSince === null
              ? 'Back up your data — this phone has never been backed up.'
              : `Back up your data — last backup ${plural(reminder.daysSince, '{n} day', '{n} days')} ago.`
          }
        />
      ) : null}

      <ListSection title="On this phone">
        {rows.map(([label, value]) => (
          <ListRow
            key={label}
            title={label}
            trailing={
              <Text variant="numeric" tabular>
                {value}
              </Text>
            }
          />
        ))}
      </ListSection>
      <Text variant="bodySmall" tone="secondary" style={styles.note}>
        A backup also holds signatures, customer ID photos, evidence images, the contract template, your logo and
        settings. Store it where only your agency can reach it.
      </Text>

      <ListSection title="Restore">
        <ListRow
          title="Restore from a backup file"
          subtitle="Replaces all data on this phone"
          chevron
          onPress={() => router.push(RESTORE)}
        />
      </ListSection>
    </>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: layout.screenGutter, paddingTop: 16, paddingBottom: 16 },
  statusDetail: { marginTop: 6 },
  note: { paddingHorizontal: layout.screenGutter, paddingTop: 12 },
});
