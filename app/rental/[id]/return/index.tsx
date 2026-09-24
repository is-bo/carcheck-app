import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { getRental, getRentalFacts } from '@/data/repos';
import { resumeTarget } from '@/domain/rentalLifecycle';
import { returnRoutes } from '@/features/evidence/returnRoutes';
import { Screen } from '@/ui';

/** "Start return" / "Resume return": lands on the step the return stopped at (UX §2 drafts & resume). */
export default function ReturnEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [target, setTarget] = useState<ReturnType<typeof returnRoutes.capture> | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getRentalFacts(id), getRental(id)]).then(
      ([facts, rental]) => {
        if (!alive) return;
        const step = resumeTarget(facts, rental.resumeStep);
        setTarget(
          step === 'return_details'
            ? returnRoutes.details(id)
            : step === 'return_compare'
              ? returnRoutes.compare(id)
              : step === 'return_capture'
                ? returnRoutes.capture(id)
                : // Completed and not reopened: the report is the place to see it.
                  returnRoutes.report(id),
        );
      },
      () => alive && setTarget(returnRoutes.capture(id)),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (!target) return <Screen tone="rebate" header={false} />;
  return <Redirect href={target} />;
}
