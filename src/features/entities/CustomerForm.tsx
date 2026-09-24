/**
 * Create/edit customer body (BRIEF: only the name is required). Document photos are protected
 * thumbnails (UX_FLOWS §8: "blurred until tapped, marked 'Stored only on this phone'") added via
 * CaptureCamera or the library, one of the three kinds at a time (UX_FLOWS §2.2). A brand-new
 * customer has no id yet, so photos are held locally until the customer itself is saved.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Camera, ImagePlus } from 'lucide-react-native';

import { resolveFileUri } from '@/data/files';
import {
  addCustomerDocument,
  createCustomer,
  deleteCustomerDocuments,
  listCustomerDocuments,
  updateCustomer,
  ValidationError,
  type CustomerInput,
} from '@/data/repos';
import type { CapturedImage, Customer, CustomerDocument, CustomerDocumentKind } from '@/domain/types';
import { Button, ConfirmDialog, KeyboardAwareForm, Screen, Text, TextField, showToast } from '@/ui';

import { capturedImageFromLibrary } from './media';
import { PhotoCaptureModal } from './PhotoCaptureModal';
import { ProtectedThumb } from './ProtectedThumb';
import { useLiveQuery } from './useLiveQuery';

export interface CustomerFormProps {
  mode: 'create' | 'edit';
  customer?: Customer;
  onSaved: (customer: Customer) => void;
  onCancel: () => void;
}

const KIND_SECTIONS: { kind: CustomerDocumentKind; label: string }[] = [
  { kind: 'licence', label: 'Licence' },
  { kind: 'id_passport', label: 'ID / Passport' },
  { kind: 'other', label: 'Other doc' },
];
const KIND_LABEL: Record<CustomerDocumentKind, string> = { licence: 'Licence', id_passport: 'ID / Passport', other: 'Other doc' };

interface PendingDoc {
  localId: string;
  kind: CustomerDocumentKind;
  uri: string;
  image: CapturedImage;
}

const DOCS_WATCH = ['customer'] as const;

export function CustomerForm({ mode, customer, onSaved, onCancel }: CustomerFormProps) {
  const existing = useLiveQuery(
    () => (customer ? listCustomerDocuments({ customerId: customer.id }) : Promise.resolve([])),
    DOCS_WATCH,
  );

  const [fullName, setFullName] = useState(customer?.fullName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [licenceNumber, setLicenceNumber] = useState(customer?.licenceNumber ?? '');
  const [idNumber, setIdNumber] = useState(customer?.idNumber ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');

  const [pending, setPending] = useState<PendingDoc[]>([]);
  const [cameraKind, setCameraKind] = useState<CustomerDocumentKind | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function addFromLibrary(kind: CustomerDocumentKind) {
    try {
      const image = await capturedImageFromLibrary('id_doc');
      if (image) setPending((p) => [...p, { localId: `${Date.now()}-${p.length}`, kind, uri: image.tempUri, image }]);
    } catch {
      showToast("Couldn't open the photo library.");
    }
  }

  async function handleSubmit() {
    const name = fullName.trim();
    if (!name) {
      setNameError('Enter the customer name.');
      return;
    }
    setSubmitting(true);
    const input: CustomerInput = {
      fullName: name,
      phone: phone.trim() || null,
      address: address.trim() || null,
      licenceNumber: licenceNumber.trim() || null,
      idNumber: idNumber.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const saved = mode === 'edit' && customer ? await updateCustomer(customer.id, input) : await createCustomer(input);
      for (const doc of pending) await addCustomerDocument({ customerId: saved.id }, doc.image, doc.kind);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'fullName') setNameError(e.message);
      else showToast(e instanceof Error ? e.message : "Couldn't save the customer.");
    } finally {
      setSubmitting(false);
    }
  }

  const docsOf = (kind: CustomerDocumentKind) => [
    ...(existing.data ?? []).filter((d) => d.kind === kind).map((d) => ({ kind: 'existing' as const, doc: d })),
    ...pending.filter((d) => d.kind === kind).map((d) => ({ kind: 'pending' as const, doc: d })),
  ];

  return (
    <Screen
      title={mode === 'edit' ? 'Edit customer' : 'New customer'}
      leading={mode === 'edit' ? 'back' : 'close'}
      onLeadingPress={onCancel}
      insets={{ bottom: false }}
      overlay={
        <ConfirmDialog
          visible={!!deleteTarget}
          title="Delete this photo?"
          message="This can't be undone."
          confirmLabel="Delete"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            setDeleting(true);
            try {
              await deleteCustomerDocuments([deleteTarget.id]);
              setDeleteTarget(null);
            } catch (e) {
              showToast(e instanceof Error ? e.message : "Couldn't delete this photo.");
            } finally {
              setDeleting(false);
            }
          }}
        />
      }
    >
      <KeyboardAwareForm
        footer={
          <Button label={mode === 'edit' ? 'Save changes' : 'Add customer'} onPress={handleSubmit} loading={submitting} fullWidth />
        }
      >
        <TextField
          label="Full name"
          value={fullName}
          onChangeText={(v) => {
            setFullName(v);
            if (nameError) setNameError(null);
          }}
          error={nameError}
        />
        <TextField label="Phone" optional variant="numeric" value={phone} onChangeText={setPhone} placeholder="+351 …" />
        <TextField label="Address" optional value={address} onChangeText={setAddress} />
        <TextField label="Licence no." optional value={licenceNumber} onChangeText={setLicenceNumber} />
        <TextField label="ID / passport no." optional value={idNumber} onChangeText={setIdNumber} />
        <TextField label="Notes" optional multiline value={notes} onChangeText={setNotes} />

        <View>
          <Text variant="label" style={styles.docsLabel}>
            Documents{' '}
            <Text variant="label" tone="tertiary">
              (optional)
            </Text>
          </Text>
          <Text variant="bodySmall" tone="tertiary" style={styles.docsHint}>
            Stored only on this phone.
          </Text>
          {KIND_SECTIONS.map(({ kind, label }) => {
            const items = docsOf(kind);
            return (
              <View key={kind} style={styles.kindSection}>
                <Text variant="bodySmall" tone="secondary">
                  {label}
                </Text>
                {items.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                    {items.map((item) =>
                      item.kind === 'existing' ? (
                        <ProtectedThumb
                          key={item.doc.id}
                          uri={resolveFileUri(item.doc.file.path)}
                          label={KIND_LABEL[item.doc.kind]}
                          onDelete={() => setDeleteTarget(item.doc)}
                        />
                      ) : (
                        <ProtectedThumb
                          key={item.doc.localId}
                          uri={item.doc.uri}
                          label={KIND_LABEL[item.doc.kind]}
                          onDelete={() => setPending((p) => p.filter((d) => d.localId !== item.doc.localId))}
                        />
                      ),
                    )}
                  </ScrollView>
                ) : null}
                <View style={styles.docButtons}>
                  <Button label="Camera" variant="secondary" size="small" icon={Camera} onPress={() => setCameraKind(kind)} />
                  <Button label="Library" variant="secondary" size="small" icon={ImagePlus} onPress={() => addFromLibrary(kind)} />
                </View>
              </View>
            );
          })}
        </View>
      </KeyboardAwareForm>

      <PhotoCaptureModal
        visible={cameraKind !== null}
        title={cameraKind ? `${KIND_LABEL[cameraKind]} photo` : undefined}
        onClose={() => setCameraKind(null)}
        onCaptured={(image) => {
          if (!cameraKind) return;
          setPending((p) => [...p, { localId: `${Date.now()}-${p.length}`, kind: cameraKind, uri: image.tempUri, image }]);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  docsLabel: { marginBottom: 4 },
  docsHint: { marginBottom: 8 },
  kindSection: { marginTop: 14, gap: 8 },
  thumbRow: { gap: 10 },
  docButtons: { flexDirection: 'row', gap: 8 },
});
