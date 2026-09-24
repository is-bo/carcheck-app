import { StyleSheet } from 'react-native';

import { getAgencySettings, updateAgencySettings } from '@/data/repos';
import type { AgencySettings } from '@/domain/types';
import { useAutosaveField, useLiveQuery } from '@/features/settings';
import { KeyboardAwareForm, ListRow, ListSection, Screen, SkeletonRows, Text, TextField } from '@/ui';
import { space } from '@/ui/theme/tokens';

const REPORT_CONTENTS = [
  'Agency details and logo',
  'Rental, vehicle and customer summary',
  'Pick-up and return photos, compared per angle',
  'New damage found, each with its evidence image',
  'Timestamps and the signed contract',
];

/**
 * Settings → Report info (UX_FLOWS §1 inventory: `app/settings/report.tsx`). The only report
 * field the data model exposes is the footer text (`agency_settings.report_footer`); everything
 * else printed on the report is fixed content, listed here read-only.
 */
export default function ReportSettingsScreen() {
  const { data, loading } = useLiveQuery(getAgencySettings, ['settings']);
  return (
    <Screen title="Report info" insets={{ bottom: false }}>
      {loading && !data ? (
        <SkeletonRows count={4} />
      ) : data ? (
        <ReportForm agency={data} />
      ) : (
        <Text variant="body" tone="secondary" style={styles.error}>
          Couldn’t load report settings.
        </Text>
      )}
    </Screen>
  );
}

function ReportForm({ agency }: { agency: AgencySettings }) {
  const footer = useAutosaveField(agency.reportFooter ?? '', (v) => updateAgencySettings({ reportFooter: v || null }));

  return (
    <>
      <ListSection title="What appears on the report" flush>
        {REPORT_CONTENTS.map((line, i) => (
          <ListRow key={line} title={line} divider={i < REPORT_CONTENTS.length - 1} />
        ))}
      </ListSection>
      <KeyboardAwareForm gap={space[6]}>
        <TextField
          label="Report footer"
          optional
          multiline
          hint="Printed at the bottom of every page of the final damage report."
          placeholder="e.g. Thank you for choosing Coastline Rentals"
          value={footer.value}
          onChangeText={footer.setValue}
          onBlur={footer.onBlur}
          error={footer.error}
        />
      </KeyboardAwareForm>
    </>
  );
}

const styles = StyleSheet.create({
  error: { padding: 24 },
});
