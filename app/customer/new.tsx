import { router, type Href } from 'expo-router';

import { CustomerForm } from '@/features/entities';

// Inline entry during Start (UX_FLOWS §2.2) is owned by the start-flow agent; this is the full
// customer form reached from the Customers tab's FAB (UX_FLOWS §1 inventory).
export default function NewCustomerScreen() {
  return (
    <CustomerForm
      mode="create"
      onCancel={() => router.back()}
      onSaved={(customer) => router.replace(`/customer/${customer.id}` as Href)}
    />
  );
}
