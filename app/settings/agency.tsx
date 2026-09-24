import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { resolveFileUri } from '@/data/files';
import { getAgencySettings, updateAgencySettings } from '@/data/repos';
import type { AgencySettings } from '@/domain/types';
import { formatRentalReference } from '@/domain/types';
import { LogoPicker, pickAgencyLogo, removeAgencyLogo, useAutosaveField, useLiveQuery, type AutosaveField } from '@/features/settings';
import { KeyboardAwareForm, Screen, SkeletonRows, Text, TextField, showToast, type TextFieldProps } from '@/ui';
import { space } from '@/ui/theme/tokens';

const PREFIX_RE = /^[A-Z0-9]{1,6}$/;

/** Settings → Agency: contact details + logo, and the rental reference prefix (DATA_MODEL §0.4). */
export default function AgencySettingsScreen() {
  const { data, loading } = useLiveQuery(getAgencySettings, ['settings']);
  return (
    <Screen title="Agency" insets={{ bottom: false }}>
      {loading && !data ? (
        <SkeletonRows count={5} />
      ) : data ? (
        <AgencyForm agency={data} />
      ) : (
        <Text variant="body" tone="secondary" style={styles.error}>
          Couldn’t load agency settings.
        </Text>
      )}
    </Screen>
  );
}

function AgencyForm({ agency }: { agency: AgencySettings }) {
  const [logoPath, setLogoPath] = useState(agency.logo?.path ?? null);
  const [logoBusy, setLogoBusy] = useState(false);

  const name = useAutosaveField(agency.name, (v) => updateAgencySettings({ name: v }));
  const address = useAutosaveField(agency.address ?? '', (v) => updateAgencySettings({ address: v || null }));
  const phone = useAutosaveField(agency.phone ?? '', (v) => updateAgencySettings({ phone: v || null }));
  const email = useAutosaveField(agency.email ?? '', (v) => updateAgencySettings({ email: v || null }));
  const registrationNumber = useAutosaveField(agency.registrationNumber ?? '', (v) =>
    updateAgencySettings({ registrationNumber: v || null }),
  );
  const prefix = useAutosaveField(agency.rentalRefPrefix, (v) => updateAgencySettings({ rentalRefPrefix: v }));

  const normalizedPrefix = prefix.value.trim().toUpperCase();
  const prefixForPreview = PREFIX_RE.test(normalizedPrefix) ? normalizedPrefix : agency.rentalRefPrefix;
  const nextReference = formatRentalReference(prefixForPreview, agency.rentalRefLastSeq + 1);

  const addLogo = async () => {
    setLogoBusy(true);
    try {
      const updated = await pickAgencyLogo();
      if (updated) setLogoPath(updated.logo?.path ?? null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await removeAgencyLogo();
      setLogoPath(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove the logo.');
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <KeyboardAwareForm gap={space[6]}>
      <LogoPicker uri={logoPath ? resolveFileUri(logoPath) : null} onPick={addLogo} onRemove={logoPath ? removeLogo : undefined} busy={logoBusy} />

      <Field field={name} label="Agency name" hint="Shown on contracts and reports." />
      <Field field={address} label="Address" optional multiline placeholder="Branch address shown on contracts" />
      <Field field={phone} label="Phone" optional variant="numeric" placeholder="+351 …" />
      <Field field={email} label="Email" optional keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
      <Field field={registrationNumber} label="Tax / registration no." optional placeholder="Company or VAT number" />

      <View style={styles.section}>
        <Text variant="label" style={styles.sectionTitle}>
          Rental reference
        </Text>
        <Field
          field={prefix}
          label="Reference prefix"
          hint="1 to 6 letters or digits. Give each phone its own prefix so numbers never clash."
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
        />
        <Text variant="bodySmall" tone="secondary">
          Next rental: {nextReference}
        </Text>
      </View>
    </KeyboardAwareForm>
  );
}

function Field({
  field,
  ...props
}: { field: AutosaveField } & Omit<TextFieldProps, 'value' | 'onChangeText' | 'onBlur' | 'error'>) {
  return <TextField {...props} value={field.value} onChangeText={field.setValue} onBlur={field.onBlur} error={field.error} />;
}

const styles = StyleSheet.create({
  error: { padding: 24 },
  section: { gap: space[3] },
  sectionTitle: { marginBottom: -space[1] },
});
