/**
 * Scaffold of every employee-facing START step: the stepper header (✕ leaves, the title opens
 * the step list), autosaved resume point, and the usual Screen slots.
 */
import { router, useFocusEffect, useNavigation, type Href } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { getRentalFacts, getRentalItem, setResumeStep } from '@/data/repos';
import { canEnterStep, isStartFlowOpen, START_STEPS as STEP_KEYS, type StartStep } from '@/domain/rentalLifecycle';
import type { Id } from '@/domain/types';
import { BottomSheet, Icon, ListRow, ListSection, plural, Screen, showToast, START_STEPS, StepHeader, Text, type ScreenProps } from '@/ui';

import { routeForStep, START_ROUTE_STEP, startHref, resumeStepFor, stepNumber, type StartRoute } from './startFlow';
import { useLiveQuery } from './useLiveQuery';

/** Leaves the whole flow (the draft is already saved, so no dialog). */
export function useExitStartFlow(): (options?: { toast?: string | null; to?: Href }) => void {
  const navigation = useNavigation();
  return useCallback(
    (options) => {
      const toast = options?.toast === undefined ? 'Draft saved' : options.toast;
      // The flow is one route of the root stack: pop it as a whole, then open `to` if given.
      const root = navigation.getParent();
      if (root?.canGoBack()) {
        root.goBack();
        if (options?.to) router.push(options.to);
      } else {
        router.replace(options?.to ?? '/');
      }
      if (toast) showToast(toast);
    },
    [navigation],
  );
}

/** Stores where Resume lands whenever a step screen gains focus (open flows only). */
export function useResumePoint(rentalId: Id, route: StartRoute): void {
  useFocusEffect(
    useCallback(() => {
      getRentalFacts(rentalId)
        .then((facts) => (isStartFlowOpen(facts) ? setResumeStep(rentalId, resumeStepFor(route)) : undefined))
        .catch(() => undefined);
    }, [rentalId, route]),
  );
}

export interface StartFlowScreenProps extends Omit<ScreenProps, 'header' | 'title' | 'subtitle' | 'leading' | 'actions'> {
  rentalId: Id;
  route: StartRoute;
  children?: ReactNode;
}

export function StartFlowScreen({ rentalId, route, overlay, ...screen }: StartFlowScreenProps) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const exit = useExitStartFlow();
  useResumePoint(rentalId, route);

  return (
    <Screen
      {...screen}
      header={
        <StepHeader step={stepNumber(route)} steps={START_STEPS} onClose={() => exit()} onTitlePress={() => setStepsOpen(true)} />
      }
      overlay={
        <>
          {overlay}
          <StepSheet rentalId={rentalId} route={route} open={stepsOpen} onClose={() => setStepsOpen(false)} />
        </>
      }
    />
  );
}

function StepSheet({ rentalId, route, open, onClose }: { rentalId: Id; route: StartRoute; open: boolean; onClose: () => void }) {
  const data = useLiveQuery(
    async () => (open ? { facts: await getRentalFacts(rentalId), item: await getRentalItem(rentalId) } : null),
    [rentalId, open],
    ['rental', 'photo', 'inspection', 'customer', 'vehicle'],
  );
  const current = START_ROUTE_STEP[route];

  const summary = (step: StartStep): string | undefined => {
    const item = data.data?.item;
    if (!item) return undefined;
    const r = item.rental;
    switch (step) {
      case 'vehicle':
        return r.vehicle ? [r.vehicle.plate, [r.vehicle.make, r.vehicle.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : 'Not chosen';
      case 'customer':
        return r.customer.fullName ?? 'Not entered';
      case 'inspect':
        return `${item.beforeProgress.done} of ${item.beforeProgress.total} angles · ${plural(item.existingDamageCount, '{n} damage', '{n} damages')}`;
      case 'details':
        return r.startMileage !== null ? `${r.startMileage} ${r.distanceUnit}` : 'Mileage, fuel, return date';
      case 'sign':
        return 'Review and customer signature';
    }
  };

  const go = (step: StartStep) => {
    onClose();
    const facts = data.data?.facts;
    const target = routeForStep(step, (facts?.before?.captured.length ?? 0) > 0);
    if (target !== route) router.dismissTo(startHref(rentalId, target));
  };

  return (
    <BottomSheet open={open} onClose={onClose} snapPoints={[440]} accessibilityLabel="Steps" header={<Text variant="titleL">Steps</Text>}>
      <ListSection>
        {STEP_KEYS.map((step, i) => {
          const facts = data.data?.facts;
          const isCurrent = step === current;
          const enabled = !!facts && !isCurrent && canEnterStep(step, facts);
          return (
            <ListRow
              key={step}
              leading={
                <View style={styles.number}>
                  <Text variant="label" tabular tone={enabled || isCurrent ? 'primary' : 'tertiary'}>
                    {i + 1}
                  </Text>
                </View>
              }
              title={
                <Text variant={isCurrent ? 'bodyStrong' : 'body'} tone={enabled || isCurrent ? 'primary' : 'tertiary'}>
                  {START_STEPS[i]}
                </Text>
              }
              subtitle={summary(step)}
              trailing={
                isCurrent ? (
                  <Text variant="labelSmall" tone="accent">
                    Current
                  </Text>
                ) : enabled ? (
                  <Icon icon={ChevronRight} size={20} />
                ) : null
              }
              onPress={enabled ? () => go(step) : undefined}
              accessibilityLabel={`Step ${i + 1}, ${START_STEPS[i]}${isCurrent ? ', current' : enabled ? '' : ', not available yet'}`}
            />
          );
        })}
      </ListSection>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  number: { width: 24, alignItems: 'center' },
});
