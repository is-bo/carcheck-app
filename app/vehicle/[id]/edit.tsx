import { useState } from 'react';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';

import { getVehicle } from '@/data/repos';
import { useLiveQuery, VehicleForm } from '@/features/entities';
import { Button, EmptyState, Screen, SkeletonRows } from '@/ui';

export default function EditVehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLiveQuery(() => getVehicle(id), ['vehicle'] as const);
  const [key, setKey] = useState(0); // remounts the form if the id changes underneath it

  if (query.loading && !query.data) {
    return (
      <Screen title="Edit vehicle" leading="back">
        <SkeletonRows count={5} plate={false} />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen title="Edit vehicle" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this vehicle"
          body={query.error instanceof Error ? query.error.message : 'It may have been removed.'}
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }

  return (
    <VehicleForm
      key={key}
      mode="edit"
      vehicle={query.data}
      onCancel={() => router.back()}
      onSaved={() => {
        setKey((k) => k + 1);
        router.replace(`/vehicle/${id}` as Href);
      }}
    />
  );
}
