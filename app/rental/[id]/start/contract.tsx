import { router, useLocalSearchParams, type Href } from 'expo-router';
import { CircleAlert, FileWarning, Info } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LockedError } from '@/data/repos';
import { isStarterTemplate, STARTER_TEMPLATE_NOTICE } from '@/domain/contract';
import { BLOCKER_MESSAGES, type Blocker } from '@/domain/rentalLifecycle';
import { ContractView } from '@/features/contract/ContractView';
import { usePreparedContract } from '@/features/contract/usePreparedContract';
import { StartFlowScreen, useExitStartFlow } from '@/features/inspection/StartFlowScreen';
import { rentalHref, startEntryHref, startHref } from '@/features/inspection/startFlow';
import { ActionFooter, Banner, Button, EmptyState, PlateFrame, plural, SkeletonRows, Text } from '@/ui';
import { layout } from '@/ui/theme/tokens';

/** Where "Fix" goes for each blocker the employee can resolve. */
const FIX: Partial<Record<Blocker, Href>> = {
  agency_name_missing: '/settings/agency' as Href,
  unknown_variables: '/settings/contract-template' as Href,
};

/**
 * Step 5a (UX §2.5): the contract exactly as it will be signed, rendered from the template with
 * live data. Problems show inline with a Fix link. Primary: Hand to customer.
 */
export default function ContractReviewStep() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const exit = useExitStartFlow();
  const contract = usePreparedContract(id);
  const data = contract.data;

  let body;
  let footer = null;
  if (contract.error && !data) {
    const signed = contract.error instanceof LockedError;
    body = (
      <EmptyState
        icon={CircleAlert}
        title={signed ? 'This contract is already signed.' : 'The contract isn’t ready yet.'}
        body={contract.error instanceof Error ? contract.error.message : 'Try again.'}
        action={
          signed ? (
            <Button label="Open rental" onPress={() => exit({ toast: null, to: rentalHref(id) })} />
          ) : (
            <Button label="Go to that step" onPress={() => router.dismissTo(startEntryHref(id))} />
          )
        }
      />
    );
  } else if (!data) {
    body = <SkeletonRows count={5} plate={false} />;
  } else {
    const { prep } = data;
    const r = prep.rental;
    const blockers = prep.blockers;
    const existing = prep.context.existingDamage.length;
    body = (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.summary}>
          <View style={styles.vehicle}>
            {r.vehicle ? <PlateFrame plate={r.vehicle.plate} /> : null}
            <Text variant="body" numberOfLines={1} style={styles.fill}>
              {[r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(' ')}
            </Text>
          </View>
          <Text variant="bodySmall" tone="secondary" tabular>
            {[r.customer.fullName, r.reference, existing ? plural(existing, '{n} existing damage', '{n} existing damages') : 'No existing damage'].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {blockers.map((b) => (
          <Banner
            key={b}
            icon={FileWarning}
            message={b === 'unknown_variables' ? `${BLOCKER_MESSAGES[b]} Unknown: ${prep.render.unknownKeys.map((k) => `{{${k}}}`).join(', ')}` : BLOCKER_MESSAGES[b]}
            action={
              FIX[b] ? (
                <Button label="Fix" variant="quiet" onPress={() => router.push(FIX[b]!)} />
              ) : (
                <Button label="Go to that step" variant="quiet" onPress={() => router.dismissTo(startEntryHref(id))} />
              )
            }
          />
        ))}
        {isStarterTemplate(prep.template.body) ? <Banner icon={Info} message={STARTER_TEMPLATE_NOTICE} /> : null}
        <ContractView html={prep.render.html} rentalId={id} damage={prep.context.existingDamage} audience="employee" />
      </ScrollView>
    );
    footer = (
      <ActionFooter rule>
        <Button
          label="Hand to customer"
          onPress={() => router.push(startHref(id, 'sign'))}
          disabled={blockers.length > 0}
          accessibilityHint="Opens the customer view of the agreement"
          fullWidth
        />
      </ActionFooter>
    );
  }

  return (
    <StartFlowScreen rentalId={id} route="contract" insets={{ bottom: false }} footer={footer}>
      {body}
    </StartFlowScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingBottom: 32 },
  summary: { paddingHorizontal: layout.screenGutter, paddingTop: 12, paddingBottom: 8, gap: 6 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
