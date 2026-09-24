import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Archive, Car, Plus, TriangleAlert } from 'lucide-react-native';

import {
  Button,
  Chip,
  EmptyState,
  Fab,
  ListRow,
  ListSection,
  PlateFrame,
  Screen,
  SkeletonRows,
  Text,
  TextField,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';
import { listVehicles, type DataEntity } from '@/data/repos';
import { vehicleMakeModelYear, vehicleStatusLine, useLiveQuery } from '@/features/entities';

const WATCH: readonly DataEntity[] = ['vehicle', 'rental', 'damage'];

export default function VehiclesScreen() {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = useLiveQuery(() => listVehicles({ search: query, includeArchived: showArchived }), WATCH);

  const items = list.data;
  const isEmpty = !!items && items.length === 0 && query.trim().length === 0 && !showArchived;
  const noMatches = !!items && items.length === 0 && (query.trim().length > 0 || showArchived);

  return (
    <Screen
      insets={{ top: false, bottom: false }}
      scroll
      overlay={<Fab icon={Plus} label="New vehicle" onPress={() => router.push('/vehicle/new' as Href)} />}
    >
      <View style={styles.toolbar}>
        <TextField variant="search" placeholder="Plate, make or model" value={query} onChangeText={setQuery} />
        <View style={styles.filterRow}>
          <Chip label="Archived" selected={showArchived} onPress={() => setShowArchived((v) => !v)} role="checkbox" />
        </View>
      </View>

      {list.loading && !items ? (
        <SkeletonRows count={4} />
      ) : list.error ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load vehicles"
          body={list.error instanceof Error ? list.error.message : String(list.error)}
          action={<Button label="Try again" variant="secondary" onPress={list.reload} />}
        />
      ) : isEmpty ? (
        <EmptyState
          icon={Car}
          title="No cars yet."
          body="Cars you add appear here. You can also add one while starting a rental."
        />
      ) : noMatches ? (
        <EmptyState icon={Archive} title="No matches" body="Try a different plate, make or model." />
      ) : items ? (
        <ListSection flush>
          {items.map((item) => (
            <ListRow
              key={item.vehicle.id}
              title={<PlateFrame plate={item.vehicle.plate} />}
              subtitle={vehicleMakeModelYear(item)}
              meta={
                <Text variant="bodySmall" tone={item.vehicle.archivedAt ? 'tertiary' : 'secondary'}>
                  {item.vehicle.archivedAt ? 'Archived' : vehicleStatusLine(item)}
                </Text>
              }
              chevron
              onPress={() => router.push(`/vehicle/${item.vehicle.id}` as Href)}
            />
          ))}
        </ListSection>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: layout.screenGutter, paddingTop: 4, gap: 10 },
  filterRow: { flexDirection: 'row' },
});
