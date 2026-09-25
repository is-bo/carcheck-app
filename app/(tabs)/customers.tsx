import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Archive, Plus, TriangleAlert, Users } from 'lucide-react-native';

import { Button, Chip, EmptyState, Fab, ListRow, ListSection, Screen, SkeletonRows, TextField } from '@/ui';
import { layout } from '@/ui/theme/tokens';
import { listCustomers, type DataEntity } from '@/data/repos';
import { customerSummaryLine, useLiveQuery } from '@/features/entities';

const WATCH: readonly DataEntity[] = ['customer', 'rental'];

export default function CustomersScreen() {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = useLiveQuery(() => listCustomers({ search: query, includeArchived: showArchived }), WATCH);

  const items = list.data;
  const isEmpty = !!items && items.length === 0 && query.trim().length === 0 && !showArchived;
  const noMatches = !!items && items.length === 0 && (query.trim().length > 0 || showArchived);

  return (
    <Screen
      insets={{ top: false, bottom: false }}
      scroll
      fabClearance
      overlay={<Fab icon={Plus} label="New customer" onPress={() => router.push('/customer/new' as Href)} />}
    >
      <View style={styles.toolbar}>
        <TextField variant="search" placeholder="Name, phone or licence no." value={query} onChangeText={setQuery} />
        <View style={styles.filterRow}>
          <Chip label="Archived" selected={showArchived} onPress={() => setShowArchived((v) => !v)} role="checkbox" />
        </View>
      </View>

      {list.loading && !items ? (
        <SkeletonRows count={4} plate={false} />
      ) : list.error ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load customers"
          body="Your data is safe on this phone. Try again."
          action={<Button label="Try again" variant="secondary" onPress={list.reload} />}
        />
      ) : isEmpty ? (
        <EmptyState icon={Users} title="No customers yet." body="Customers you save appear here. Saving is optional." />
      ) : noMatches ? (
        <EmptyState icon={Archive} title="No matches" body="Try a different name, phone or licence number." />
      ) : items ? (
        <ListSection flush>
          {items.map((item) => (
            <ListRow
              key={item.customer.id}
              title={item.customer.fullName}
              subtitle={customerSummaryLine(item)}
              meta={item.customer.archivedAt ? 'Archived' : undefined}
              chevron
              onPress={() => router.push(`/customer/${item.customer.id}` as Href)}
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
