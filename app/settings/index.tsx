import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import Constants from 'expo-constants';

import { isStarterTemplate } from '@/domain/contract';
import { formatRentalReference } from '@/domain/types';
import { getActiveTemplate, getAgencySettings, getLastBackupAt, getStorageUsage } from '@/data/repos';
import { useLiveQuery } from '@/features/settings';
import { Button, formatDate, formatFileSize, ListRow, ListSection, Screen, SkeletonRows, Text } from '@/ui';
import { layout } from '@/ui/theme/tokens';

// Typed routes regenerate from the files under app/ (expo start / CI prebuild); cast until then,
// matching app/(tabs)/_layout.tsx. `/settings/backup` is owned by another Wave B agent.
const AGENCY = '/settings/agency' as Href;
const CONTRACT_TEMPLATE = '/settings/contract-template' as Href;
const REPORT = '/settings/report' as Href;
const BACKUP = '/settings/backup' as Href;
const STORAGE = '/settings/storage' as Href;
const ABOUT = '/settings/about' as Href;

async function loadSummary() {
  const [agency, lastBackupAt, storage, template] = await Promise.all([
    getAgencySettings(),
    getLastBackupAt(),
    getStorageUsage(),
    getActiveTemplate(),
  ]);
  return { agency, lastBackupAt, storage, template };
}

/** Grouped hairline list (UX_FLOWS §1 screen inventory: `app/settings/index.tsx`). */
export default function SettingsScreen() {
  const { data, loading, reload } = useLiveQuery(loadSummary, ['settings', 'template', 'backup']);
  useFocusEffect(useCallback(() => reload(), [reload]));

  return (
    <Screen title="Settings" scroll>
      {loading && !data ? (
        <SkeletonRows count={6} />
      ) : data ? (
        <>
          <ListSection title="Agency" flush>
            <ListRow
              title="Agency details"
              subtitle={[
                data.agency.name || 'Add your agency name',
                `Next ${formatRentalReference(data.agency.rentalRefPrefix, data.agency.rentalRefLastSeq + 1)}`,
              ].join(' · ')}
              chevron
              onPress={() => router.push(AGENCY)}
            />
          </ListSection>

          <ListSection title="Contract">
            <ListRow
              title="Contract template"
              subtitle={isStarterTemplate(data.template.body) ? 'Starter template' : `Customized · version ${data.template.version}`}
              chevron
              onPress={() => router.push(CONTRACT_TEMPLATE)}
            />
            <ListRow
              title="Report info"
              subtitle="What appears on the final damage report"
              chevron
              onPress={() => router.push(REPORT)}
            />
          </ListSection>

          <ListSection title="Data">
            <ListRow
              title="Backup & restore"
              subtitle={data.lastBackupAt ? `Last backup: ${formatDate(data.lastBackupAt)}` : 'Never backed up'}
              chevron
              onPress={() => router.push(BACKUP)}
            />
            <ListRow
              title="Storage"
              subtitle={`${formatFileSize(data.storage.totalBytes)} used on this phone`}
              chevron
              onPress={() => router.push(STORAGE)}
            />
          </ListSection>

          <ListSection title="About">
            <ListRow
              title="About CarCheck"
              subtitle={`Version ${Constants.expoConfig?.version ?? '—'}`}
              chevron
              onPress={() => router.push(ABOUT)}
            />
          </ListSection>
        </>
      ) : (
        <View style={styles.error}>
          <Text variant="body" tone="secondary">
            Couldn’t load settings. Your data is safe on this phone.
          </Text>
          <Button label="Try again" variant="secondary" onPress={reload} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { paddingHorizontal: layout.screenGutter, paddingTop: 24, gap: 16, alignItems: 'flex-start' },
});
