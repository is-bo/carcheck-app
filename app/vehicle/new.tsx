import { router, type Href } from 'expo-router';

import { VehicleForm } from '@/features/entities';

// Quick-create inside Start (UX_FLOWS §2.1) is a bottom sheet owned by the start-flow agent;
// this is the full vehicle form reached from the Vehicles tab's FAB (UX_FLOWS §1 inventory).
export default function NewVehicleScreen() {
  return (
    <VehicleForm
      mode="create"
      onCancel={() => router.back()}
      onSaved={(vehicle) => router.replace(`/vehicle/${vehicle.id}` as Href)}
    />
  );
}
