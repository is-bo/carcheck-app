import { router } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createDraftRental } from '@/data/repos';
import { startHref } from '@/features/inspection/startFlow';
import { Button, EmptyState, Screen } from '@/ui';

/**
 * "New rental" (UX §2): creates the draft before any vehicle is chosen, then replaces itself
 * with the first step. No UI unless creating the draft fails.
 */
export default function NewRentalRoute() {
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  const create = useCallback(() => {
    setFailed(false);
    createDraftRental().then(
      (rental) => router.replace(startHref(rental.id, 'vehicle')),
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, [create]);

  if (!failed) return null;
  return (
    <Screen leading="close" title="New rental">
      <EmptyState
        icon={CircleAlert}
        title="Couldn’t start a new rental."
        body="Nothing was saved. Try again; if it keeps failing, restart CarCheck."
        action={<Button label="Try again" onPress={create} />}
      />
    </Screen>
  );
}
