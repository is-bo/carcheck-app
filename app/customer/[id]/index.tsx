import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Archive, ArchiveRestore, KeyRound, SquarePen, Trash2, TriangleAlert } from 'lucide-react-native';

import { resolveFileUri } from '@/data/files';
import {
  archiveCustomer,
  deleteCustomerDocuments,
  getCustomerDetail,
  removeCustomer,
  unarchiveCustomer,
  type DataEntity,
} from '@/data/repos';
import {
  crossAgent,
  OverflowButton,
  type OverflowAction,
  ProtectedThumb,
  useLiveQuery,
} from '@/features/entities';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  formatDate,
  ListRow,
  ListSection,
  plural,
  Screen,
  SkeletonRows,
  Text,
  showToast,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';

const WATCH: readonly DataEntity[] = ['customer', 'rental'];
const KIND_LABEL = { licence: 'Licence', id_passport: 'ID / Passport', other: 'Other doc' } as const;

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useLiveQuery(() => getCustomerDetail(id), WATCH);
  const detail = query.data;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDocsOpen, setDeleteDocsOpen] = useState(false);
  const [deletingDocs, setDeletingDocs] = useState(false);

  if (query.loading && !detail) {
    return (
      <Screen title="Customer" leading="back">
        <SkeletonRows count={5} plate={false} />
      </Screen>
    );
  }
  if (query.error || !detail) {
    return (
      <Screen title="Customer" leading="back">
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load this customer"
          body={query.error instanceof Error ? query.error.message : 'They may have been removed.'}
          action={<Button label="Try again" variant="secondary" onPress={query.reload} />}
        />
      </Screen>
    );
  }

  const { customer } = detail;
  const willArchive = detail.rentals.length > 0;

  async function handleArchive() {
    try {
      await archiveCustomer(id);
      showToast('Customer archived', { action: { label: 'Undo', onPress: () => void unarchiveCustomer(id).catch(() => {}) } });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't archive this customer.");
    }
  }

  async function handleUnarchive() {
    try {
      await unarchiveCustomer(id);
      showToast('Customer unarchived');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't unarchive this customer.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const result = await removeCustomer(id);
      setDeleteOpen(false);
      if (result === 'deleted') {
        showToast('Customer deleted');
        router.back();
      } else {
        showToast('This customer has rental history, so they were archived instead.');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete this customer.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteDocs() {
    setDeletingDocs(true);
    try {
      await deleteCustomerDocuments(detail!.documents.map((d) => d.id));
      setDeleteDocsOpen(false);
      showToast('ID photos deleted');
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't delete these photos.");
    } finally {
      setDeletingDocs(false);
    }
  }

  const actions: OverflowAction[] = [
    { label: 'Edit', icon: SquarePen, onPress: () => router.push(`/customer/${id}/edit` as Href) },
    ...(customer.archivedAt
      ? [{ label: 'Unarchive', icon: ArchiveRestore, onPress: handleUnarchive }]
      : willArchive
        ? [{ label: 'Archive', icon: Archive, onPress: handleArchive }]
        : [{ label: 'Delete customer', icon: Trash2, destructive: true, onPress: () => setDeleteOpen(true) }]),
    ...(detail.documents.length > 0
      ? [{ label: 'Delete ID photos', icon: Trash2, destructive: true, onPress: () => setDeleteDocsOpen(true) }]
      : []),
  ];

  const facts = [
    customer.phone,
    customer.address,
    customer.licenceNumber ? `Licence ${customer.licenceNumber}` : null,
    customer.idNumber ? `ID ${customer.idNumber}` : null,
  ].filter((v): v is string => !!v);

  return (
    <Screen
      title={customer.fullName}
      subtitle={customer.archivedAt ? 'Archived' : undefined}
      leading="back"
      scroll
      actions={<OverflowButton actions={actions} accessibilityLabel="Customer actions" />}
      overlay={
        <>
          <ConfirmDialog
            visible={deleteOpen}
            title="Delete this customer?"
            message="This can't be undone."
            confirmLabel="Delete"
            busy={deleting}
            onCancel={() => setDeleteOpen(false)}
            onConfirm={handleDelete}
          />
          <ConfirmDialog
            visible={deleteDocsOpen}
            title="Delete ID photos?"
            message="Every licence, ID and other document photo saved for this customer will be deleted. This can't be undone."
            confirmLabel="Delete"
            busy={deletingDocs}
            onCancel={() => setDeleteDocsOpen(false)}
            onConfirm={handleDeleteDocs}
          />
        </>
      }
    >
      {facts.length > 0 ? (
        <View style={styles.facts}>
          {facts.map((f) => (
            <Text key={f} variant="body" tone="secondary">
              {f}
            </Text>
          ))}
        </View>
      ) : null}

      {detail.documents.length > 0 ? (
        <View style={styles.docsSection}>
          <Text variant="label" style={styles.docsLabel}>
            ID documents
          </Text>
          <Text variant="bodySmall" tone="tertiary" style={styles.docsHint}>
            Stored only on this phone.
          </Text>
          <View style={styles.thumbRow}>
            {detail.documents.map((doc) => (
              <ProtectedThumb key={doc.id} uri={resolveFileUri(doc.file.path)} label={KIND_LABEL[doc.kind]} />
            ))}
          </View>
        </View>
      ) : null}

      {customer.notes ? (
        <View style={styles.notes}>
          <Text variant="label" style={styles.docsLabel}>
            Notes
          </Text>
          <Text variant="body" tone="secondary">
            {customer.notes}
          </Text>
        </View>
      ) : null}

      {detail.rentals.length > 0 ? (
        <ListSection title="Rentals" count={detail.rentals.length}>
          {detail.rentals.map((r) => (
            <ListRow
              key={r.rental.id}
              title={r.rental.reference ?? 'Rental'}
              subtitle={`${formatDate(r.rental.activatedAt ?? r.rental.createdAt)} · ${r.rental.vehicle ? [r.rental.vehicle.make, r.rental.vehicle.model].filter(Boolean).join(' ') : 'No vehicle'}`}
              meta={plural(r.newDamageCount, '{n} new damage', '{n} new damages')}
              chevron
              onPress={() => router.push(crossAgent.rental(r.rental.id))}
            />
          ))}
        </ListSection>
      ) : (
        <EmptyState icon={KeyRound} title="No rentals yet" body="Rentals for this customer will appear here." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  facts: { paddingHorizontal: layout.screenGutter, paddingTop: 16, gap: 4 },
  docsSection: { paddingHorizontal: layout.screenGutter, paddingTop: 24 },
  docsLabel: { marginBottom: 4 },
  docsHint: { marginBottom: 10 },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  notes: { paddingHorizontal: layout.screenGutter, paddingTop: 24 },
});
