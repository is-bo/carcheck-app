import { Redirect, useLocalSearchParams } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';

import { getRental, getRentalFacts } from '@/data/repos';
import { resumeTarget } from '@/domain/rentalLifecycle';
import { routeForResume, rentalHref, startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import { Button, EmptyState, Screen } from '@/ui';

/**
 * Resume entry (`/rental/<id>/start`): lands exactly where the employee stopped. Capture then
 * opens at the next missing angle. Rentals with nothing left to start go to their detail.
 */
export default function StartResumeRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const target = useLiveQuery(
    async () => {
      const [facts, rental] = await Promise.all([getRentalFacts(id), getRental(id)]);
      return routeForResume(resumeTarget(facts, rental.resumeStep));
    },
    [id],
    [],
  );

  if (target.loading) return null;
  if (target.error) {
    return (
      <Screen leading="close" title="Rental">
        <EmptyState
          icon={CircleAlert}
          title="Couldn’t open this rental."
          body="It may have been discarded. Your other rentals are not affected."
          action={<Button label="Try again" onPress={target.reload} />}
        />
      </Screen>
    );
  }
  return <Redirect href={target.data ? startHref(id, target.data) : rentalHref(id)} />;
}
