import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { resolveFileUri } from '@/data/files';
import { updateAgencySettings } from '@/data/repos';
import { LogoPicker, pickAgencyLogo } from '@/features/settings';
import { Button, KeyboardAwareForm, Screen, Text, TextField, showToast } from '@/ui';
import { space } from '@/ui/theme/tokens';

/**
 * First launch only (UX_FLOWS §10 "First launch"; screen inventory `app/onboarding.tsx`). One
 * screen, one required field, then straight to Home — no tour. The boot gate (app/_layout.tsx,
 * not owned here) is responsible for routing here while isAgencyConfigured() is false, and for
 * never showing it again once an agency name is saved.
 */
export default function OnboardingScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmedName = name.trim();
  const nameError = nameTouched && trimmedName === '' ? 'Enter the agency name.' : null;

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

  const submit = async () => {
    if (trimmedName === '') {
      setNameTouched(true);
      return;
    }
    setSaving(true);
    try {
      await updateAgencySettings({
        name: trimmedName,
        phone: phone.trim() || null,
        address: address.trim() || null,
      });
      router.replace('/');
    } catch (e) {
      setSaving(false);
      showToast(e instanceof Error ? e.message : 'Could not save your agency details.');
    }
  };

  return (
    <Screen header={false} insets={{ bottom: false }}>
      <KeyboardAwareForm
        gap={space[6]}
        footer={<Button label="Get started" fullWidth onPress={submit} loading={saving} />}
      >
        <View style={styles.intro}>
          <Text variant="headline" accessibilityRole="header">
            Welcome to CarCheck
          </Text>
          <Text variant="body" tone="secondary">
            Set up your agency once. You can change all of this later in Settings.
          </Text>
        </View>

        <TextField
          label="Agency name"
          placeholder="e.g. Coastline Rentals"
          hint="Shown on contracts and reports."
          error={nameError}
          value={name}
          onChangeText={setName}
          onBlur={() => setNameTouched(true)}
          returnKeyType="next"
        />

        <LogoPicker uri={logoPath ? resolveFileUri(logoPath) : null} onPick={addLogo} busy={logoBusy} />

        <TextField
          label="Phone"
          optional
          keyboardType="phone-pad"
          autoComplete="tel"
          placeholder="+351 …"
          value={phone}
          onChangeText={setPhone}
        />
        <TextField
          label="Address"
          optional
          multiline
          placeholder="Branch address shown on contracts"
          value={address}
          onChangeText={setAddress}
        />
      </KeyboardAwareForm>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space[2] },
});
