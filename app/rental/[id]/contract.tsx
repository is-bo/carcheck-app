import { router, useLocalSearchParams } from 'expo-router';
import { FileText, Lock, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { resolveFileUri } from '@/data/files';
import { getRentalDetail, verifyContract, type DataEntity } from '@/data/repos';
import { ContractView } from '@/features/contract/ContractView';
import { shareContractPdf } from '@/features/contract/contractPdf';
import { crossAgent, useLiveQuery } from '@/features/entities';
import {
  ActionFooter,
  Banner,
  Button,
  EmptyState,
  formatDate,
  formatDateTime,
  ListRow,
  ListSection,
  Screen,
  showToast,
  SkeletonRows,
  Text,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';

const WATCH: readonly DataEntity[] = ['contract', 'rental', 'inspection'];

/**
 * Read-only signed contract (UX §1 inventory): the frozen HTML exactly as signed, with its
 * signature. Voided versions stay readable and are clearly marked; changing a contract is only
 * possible through Fix contract (void & re-sign).
 */
export default function ContractViewerRoute() {
  const { id, v } = useLocalSearchParams<{ id: string; v?: string }>();
  const query = useLiveQuery(() => getRentalDetail(id), WATCH);
  const [sharing, setSharing] = useState(false);
  const [checking, setChecking] = useState(false);
  const detail = query.data;

  if (query.error && !detail) {
    return (
      <Screen title="Contract" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn’t load this contract"
          body="Your data is safe on this phone. Try again."
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }
  if (!detail) {
    return (
      <Screen title="Contract" leading="back">
        <SkeletonRows count={4} plate={false} />
      </Screen>
    );
  }

  const { rental } = detail.item;
  const contracts = detail.contracts;
  const valid = contracts.find((c) => !c.void) ?? null;
  const shown = contracts.find((c) => c.id === v) ?? valid ?? contracts[contracts.length - 1] ?? null;

  if (!shown) {
    return (
      <Screen title="Contract" leading="back">
        <EmptyState icon={FileText} title="No signed contract yet" body="The contract appears here once the customer has signed it." />
      </Screen>
    );
  }

  const canFix = rental.status === 'active' && valid !== null && shown.id === valid.id && detail.after === null;
  const others = contracts.filter((c) => c.id !== shown.id).reverse();

  async function share() {
    setSharing(true);
    try {
      await shareContractPdf(shown!.id);
    } catch {
      showToast('Couldn’t share the contract. Try again.');
    } finally {
      setSharing(false);
    }
  }

  // Recomputes the fingerprint and re-hashes the signature and the photos the contract shows.
  async function check() {
    setChecking(true);
    try {
      const result = await verifyContract(shown!.id);
      showToast(result.ok ? 'Contract checked: unchanged since signing.' : result.problems.join(' '), { duration: 8000 });
    } catch {
      showToast('Couldn’t check the contract. Try again.');
    } finally {
      setChecking(false);
    }
  }

  const banner = shown.void
    ? `Voided ${formatDateTime(shown.void.voidedAt)}${shown.void.reason ? ` · ${shown.void.reason}` : ''}. Kept on record; it no longer applies.`
    : 'Signed contracts can’t be edited.';

  return (
    <Screen
      title="Contract"
      subtitle={[rental.reference, shown.sequence > 1 || contracts.length > 1 ? `no. ${shown.sequence}` : null].filter(Boolean).join(' · ')}
      leading="back"
      scroll
      footer={
        <ActionFooter row>
          <Button label="Check" variant="secondary" icon={ShieldCheck} loading={checking} onPress={check} />
          <Button label="Share PDF" variant="secondary" icon={FileText} loading={sharing} onPress={share} style={styles.fill} />
        </ActionFooter>
      }
    >
      <View style={styles.banner}>
        <Banner
          icon={Lock}
          message={banner}
          action={canFix ? <Button label="Fix contract" variant="quiet" onPress={() => router.push(crossAgent.voidContract(id))} /> : undefined}
        />
      </View>
      <Text variant="bodySmall" tone="secondary" tabular style={styles.meta}>
        Signed by {shown.signerName} · {formatDateTime(shown.signedAt)}
      </Text>
      <ContractView
        html={shown.renderedHtml}
        rentalId={id}
        damage={[]}
        audience="employee"
        signatureUri={resolveFileUri(shown.signature.path)}
      />
      {others.length > 0 ? (
        <ListSection title="Other versions" count={others.length}>
          {others.map((c) => (
            <ListRow
              key={c.id}
              title={c.void ? `No. ${c.sequence} · Voided ${formatDate(c.void.voidedAt)}` : `No. ${c.sequence} · Signed ${formatDate(c.signedAt)}`}
              subtitle={c.void?.reason ?? (c.void ? undefined : 'Current contract')}
              chevron
              onPress={() => router.setParams({ v: c.id })}
            />
          ))}
        </ListSection>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { paddingTop: 12 },
  meta: { paddingHorizontal: layout.screenGutter, paddingTop: 12 },
});
