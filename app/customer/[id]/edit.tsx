import { router, useLocalSearchParams, type Href } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';

import { getCustomer } from '@/data/repos';
import { CustomerForm, useLiveQuery } from '@/features/entities';
import { Button, EmptyState, Screen, SkeletonRows, useNoScreenshots } from '@/ui';

export default function EditCustomerScreen() {
  useNoScreenshots('customer-edit');
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLiveQuery(() => getCustomer(id), ['customer'] as const);

  if (query.loading && !query.data) {
    return (
      <Screen title="Edit customer" leading="back">
        <SkeletonRows count={5} plate={false} />
      </Screen>
    );
  }
  if (query.error || !query.data) {
    return (
      <Screen title="Edit customer" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this customer"
          body={query.error instanceof Error ? query.error.message : 'They may have been removed.'}
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }

  return (
    <CustomerForm
      mode="edit"
      customer={query.data}
      onCancel={() => router.back()}
      onSaved={() => router.replace(`/customer/${id}` as Href)}
    />
  );
}
