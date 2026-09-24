import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, FileX2 } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DataError, getRental, getValidContract, voidContract } from '@/data/repos';
import { startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  formatDateTime,
  Icon,
  KeyboardAwareForm,
  PlateFrame,
  Screen,
  showToast,
  SkeletonRows,
  Text,
  TextField,
} from '@/ui';
import { light } from '@/ui/theme/tokens';

/**
 * Void & re-sign (UX §10, DECISIONS): the only way to change a signed contract. The voided
 * contract stays on record; the rental then needs a new signature via Details → Sign.
 */
export default function VoidContractRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useLiveQuery(
    async () => {
      const [rental, contract] = await Promise.all([getRental(id), getValidContract(id)]);
      return { rental, contract };
    },
    [id],
    ['contract', 'rental'],
  );
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const resign = () => router.replace(startHref(id, 'details'));

  const doVoid = async () => {
    const contract = data.data?.contract;
    if (!contract) return;
    setBusy(true);
    try {
      await voidContract(contract.id, reason);
      setConfirming(false);
      showToast('Contract voided. Check the details, then have the customer sign again.');
      resign();
    } catch (e) {
      setConfirming(false);
      showToast(e instanceof DataError ? e.message : 'Couldn’t void the contract. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (data.error && !data.data) {
    return (
      <Screen leading="back" title="Fix contract">
        <EmptyState icon={CircleAlert} title="Couldn’t load this rental." body="Nothing was changed." action={<Button label="Try again" onPress={data.reload} />} />
      </Screen>
    );
  }
  if (!data.data) {
    return (
      <Screen leading="back" title="Fix contract">
        <SkeletonRows count={3} plate={false} />
      </Screen>
    );
  }

  const { rental, contract } = data.data;
  if (!contract || rental.status !== 'active') {
    const needsSignature = rental.status === 'active' && !contract;
    return (
      <Screen leading="back" title="Fix contract">
        <EmptyState
          icon={FileX2}
          title={needsSignature ? 'This contract is already void.' : 'This contract can’t be voided.'}
          body={
            needsSignature
              ? 'The rental needs a new signature. Check the details and hand the phone to the customer.'
              : 'Only the contract of a rental that is out can be voided and signed again.'
          }
          action={needsSignature ? <Button label="Continue to re-sign" onPress={resign} /> : <Button label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  return (
    <Screen leading="back" title="Fix contract" insets={{ bottom: false }}>
      <KeyboardAwareForm
        footer={<Button label="Void & re-sign" variant="destructive" icon={FileX2} onPress={() => setConfirming(true)} fullWidth />}
      >
        <View style={styles.head}>
          <Icon icon={FileX2} size={48} color={light.textTertiary} />
          <Text variant="titleL" accessibilityRole="header">
            Void this contract and have the customer sign a corrected one?
          </Text>
          <Text variant="body" tone="secondary">
            Signed contracts can’t be edited. The voided contract is kept on record and listed in the report. After voiding,
            you can change the details and pick-up damage, then the customer signs again.
          </Text>
        </View>
        <View style={styles.facts}>
          {rental.vehicle ? <PlateFrame plate={rental.vehicle.plate} /> : null}
          <Text variant="body" tabular>
            {[rental.reference, contract.signerName].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="bodySmall" tone="secondary" tabular>
            Signed {formatDateTime(contract.signedAt)}
            {contract.sequence > 1 ? ` · contract no. ${contract.sequence}` : ''}
          </Text>
        </View>
        <TextField
          label="Reason"
          optional
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. wrong mileage"
          hint="Printed with the voided contract."
          maxLength={200}
        />
      </KeyboardAwareForm>
      <ConfirmDialog
        visible={confirming}
        title={`Void contract ${rental.reference ?? ''}?`.replace(' ?', '?')}
        message="The rental will need a new customer signature. The voided contract stays on record."
        confirmLabel="Void & re-sign"
        onConfirm={doVoid}
        onCancel={() => setConfirming(false)}
        busy={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 12, paddingTop: 8 },
  facts: { gap: 6 },
});
