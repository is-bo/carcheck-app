import { Stack, useLocalSearchParams } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';

import { DataError } from '@/data/repos';
import { enterReturnFlow } from '@/features/evidence/return/flow';
import { Button, EmptyState, Screen, screenPresets, type ScreenPreset } from '@/ui';

/** Presentation inside the return flow: camera and compare are rebate, details is paper. */
const PRESETS: Record<string, ScreenPreset> = {
  index: 'instant',
  capture: 'rebateCard',
  compare: 'rebateCard',
  details: 'card',
};

type Gate = { status: 'pending' } | { status: 'ready' } | { status: 'failed'; message: string };

/**
 * Return flow shell (UX §1: full-screen task, tab bar hidden). Starts the return inspection the
 * first time the flow opens (idempotent), so every entry point can simply link here.
 */
export default function ReturnFlowLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [gate, setGate] = useState<Gate>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    enterReturnFlow(id).then(
      () => alive && setGate({ status: 'ready' }),
      (e: unknown) =>
        alive &&
        setGate({
          status: 'failed',
          message: e instanceof DataError ? e.message : "Couldn't open the return. Your photos and marks are safe.",
        }),
    );
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  if (gate.status === 'pending') return <Screen tone="rebate" header={false} />;
  if (gate.status === 'failed') {
    return (
      <Screen title="Return" leading="close">
        <EmptyState
          icon={CircleAlert}
          title="This return can't be opened."
          body={gate.message}
          action={
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => {
                setGate({ status: 'pending' });
                setAttempt((n) => n + 1);
              }}
            />
          }
        />
      </Screen>
    );
  }
  return (
    <Stack
      screenOptions={({ route }) => ({
        ...screenPresets[PRESETS[route.name] ?? 'card'],
        ...(route.name === 'capture' ? { animation: 'fade' as const, gestureEnabled: false } : null),
      })}
    />
  );
}
