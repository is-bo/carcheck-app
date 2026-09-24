import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronDown, ChevronUp, CircleAlert, IdCard, ImageIcon, FileText, UserRound } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { resolveFileUri, type DocumentOwner } from '@/data/files';
import {
  DataError,
  deleteCustomerDocuments,
  getCustomer,
  getPref,
  getRental,
  listCustomerDocuments,
  listCustomers,
  pickRentalCustomer,
  setPref,
  setRentalCustomer,
} from '@/data/repos';
import type { Customer, CustomerDocument, CustomerDocumentKind, CustomerSnapshot, Id } from '@/domain/types';
import { importDocumentFromLibrary, saveDocumentShot } from '@/features/inspection/captureService';
import { SingleShotCamera } from '@/features/inspection/SingleShotCamera';
import { StartFlowScreen } from '@/features/inspection/StartFlowScreen';
import { startHref } from '@/features/inspection/startFlow';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  KeyboardAwareForm,
  ListRow,
  ListSection,
  showToast,
  Text,
  TextField,
  Touchable,
  type LucideIcon,
} from '@/ui';
import { layout, light, palette, radii } from '@/ui/theme/tokens';

type Details = Omit<CustomerSnapshot, 'fullName'>;
const EMPTY_DETAILS: Details = { phone: null, address: null, licenceNumber: null, idNumber: null, notes: null };

const DOC_KINDS: { kind: CustomerDocumentKind; label: string; icon: LucideIcon }[] = [
  { kind: 'licence', label: 'Licence', icon: IdCard },
  { kind: 'id_passport', label: 'ID / Passport', icon: UserRound },
  { kind: 'other', label: 'Other doc', icon: FileText },
];
const DOC_LABEL: Record<CustomerDocumentKind, string> = { licence: 'Licence', id_passport: 'ID / Passport', other: 'Other doc' };

const AUTOSAVE_MS = 600;

/** Step 2 (UX §2.2): only the name is required; picking a profile fills everything and moves on. */
export default function CustomerStep() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rental = useLiveQuery(() => getRental(id), [id], []);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [customerId, setCustomerId] = useState<Id | null>(null);
  const [saveAsProfile, setSaveAsProfile] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [docMenu, setDocMenu] = useState<CustomerDocumentKind | null>(null);
  const [camera, setCamera] = useState<CustomerDocumentKind | null>(null);
  const [deleting, setDeleting] = useState<CustomerDocument | null>(null);

  // First load: the rental's snapshot (render-time adjustment) and the remembered switch.
  if (!loaded && rental.data) {
    const r = rental.data;
    setName(r.customer.fullName ?? '');
    const d: Details = {
      phone: r.customer.phone,
      address: r.customer.address,
      licenceNumber: r.customer.licenceNumber,
      idNumber: r.customer.idNumber,
      notes: r.customer.notes,
    };
    setDetails(d);
    setCustomerId(r.customerId);
    setMoreOpen(Object.values(d).some((v) => !!v));
    setLoaded(true);
  }
  useEffect(() => {
    getPref<boolean>('saveAsProfile').then((v) => v !== null && setSaveAsProfile(v), () => undefined);
  }, []);

  const picked = useLiveQuery(async () => (customerId ? getCustomer(customerId) : null), [customerId], ['customer']);
  const owner: DocumentOwner = customerId ? { customerId } : { rentalId: id };
  const docs = useLiveQuery(() => listCustomerDocuments(owner), [customerId, id], ['customer', 'rental']);

  const q = name.trim();
  const matches = useLiveQuery(
    async () => (!customerId && q.length >= 2 ? (await listCustomers({ search: q })).slice(0, 5) : []),
    [q, customerId],
    ['customer'],
  );

  // Autosave the snapshot while typing (debounced); Next writes it once more with the profile choice.
  const snapshot = useCallback((): CustomerSnapshot => ({ fullName: name.trim() || null, ...details }), [name, details]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    await setRentalCustomer(id, { customerId, snapshot: snapshot(), saveAsProfile: false });
  }, [id, customerId, snapshot]);
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      flush().catch(() => undefined);
    }, AUTOSAVE_MS);
  }, [loaded, name, details, flush]);
  // Leaving the step (Back, step sheet, ✕) saves what was typed in the last moment too.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(
    () => () => {
      flushRef.current().catch(() => undefined);
    },
    [],
  );

  const edit = (patch: Partial<Details>) => {
    dirty.current = true;
    setDetails((d) => ({ ...d, ...patch }));
  };

  const pick = async (c: Customer) => {
    if (busy) return;
    setBusy(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      dirty.current = false;
      await pickRentalCustomer(id, c.id);
      setCustomerId(c.id);
      setName(c.fullName);
      setDetails({ phone: c.phone, address: c.address, licenceNumber: c.licenceNumber, idNumber: c.idNumber, notes: c.notes });
      router.push(startHref(id, 'capture'));
    } catch (e) {
      showToast(e instanceof DataError ? e.message : 'Couldn’t use this customer. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const change = () => {
    dirty.current = true;
    setCustomerId(null);
    setName('');
    setDetails(EMPTY_DETAILS);
  };

  const next = async () => {
    if (!q) {
      setNameError('Enter the customer name.');
      return;
    }
    setBusy(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      dirty.current = false;
      const r = await setRentalCustomer(id, { customerId, snapshot: snapshot(), saveAsProfile });
      setCustomerId(r.customerId);
      if (!customerId) setPref('saveAsProfile', saveAsProfile).catch(() => undefined);
      router.push(startHref(id, 'capture'));
    } catch (e) {
      showToast(e instanceof DataError ? e.message : 'Couldn’t save the customer. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const addFromCamera = (kind: CustomerDocumentKind, uri: string, meta: { capturedAt: number; tzOffsetMin: number }) => {
    saveDocumentShot(owner, kind, uri, meta).then(
      () => showToast(`${DOC_LABEL[kind]} photo saved`),
      (e: unknown) => showToast(e instanceof DataError ? e.message : 'Couldn’t save the photo. Try again.'),
    );
  };
  const addFromLibrary = (kind: CustomerDocumentKind) => {
    importDocumentFromLibrary(owner, kind).then(
      (doc) => doc && showToast(`${DOC_LABEL[kind]} photo saved`),
      (e: unknown) => showToast(e instanceof DataError ? e.message : 'Couldn’t add the photo. Try again.'),
    );
  };

  if (rental.error && !rental.data) {
    return (
      <StartFlowScreen rentalId={id} route="customer">
        <EmptyState
          icon={CircleAlert}
          title="Couldn’t load this rental."
          body="Your draft is safe. Try again."
          action={<Button label="Try again" onPress={rental.reload} />}
        />
      </StartFlowScreen>
    );
  }

  const profile = customerId ? picked.data : null;

  return (
    <StartFlowScreen
      rentalId={id}
      route="customer"
      insets={{ bottom: false }}
      overlay={
        <>
          <BottomSheet
            open={!!docMenu}
            onClose={() => setDocMenu(null)}
            snapPoints={[250]}
            accessibilityLabel="Add document photo"
            header={<Text variant="titleL">{docMenu ? `${DOC_LABEL[docMenu]} photo` : ''}</Text>}
          >
            <ListSection>
              <ListRow
                leading={<Icon icon={Camera} />}
                title="Take photo"
                onPress={() => {
                  setCamera(docMenu);
                  setDocMenu(null);
                }}
              />
              <ListRow
                leading={<Icon icon={ImageIcon} />}
                title="Choose from photos"
                onPress={() => {
                  const kind = docMenu;
                  setDocMenu(null);
                  if (kind) addFromLibrary(kind);
                }}
              />
            </ListSection>
          </BottomSheet>
          <ConfirmDialog
            visible={!!deleting}
            title={deleting ? `Delete this ${DOC_LABEL[deleting.kind].toLowerCase()} photo?` : ''}
            message="It is removed from this phone. The numbers typed above stay."
            confirmLabel="Delete"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const d = deleting;
              setDeleting(null);
              if (d) deleteCustomerDocuments([d.id]).catch(() => showToast('Couldn’t delete the photo.'));
            }}
          />
          <SingleShotCamera
            visible={!!camera}
            title={camera ? DOC_LABEL[camera].toUpperCase() : ''}
            instruction="Lay the document flat and fill the frame. Avoid glare."
            onCaptured={(uri, meta) => camera && addFromCamera(camera, uri, meta)}
            onClose={() => setCamera(null)}
          />
        </>
      }
    >
      <KeyboardAwareForm footer={<Button label="Next" onPress={next} loading={busy} fullWidth />}>
        {profile ? (
          <View style={styles.picked}>
            <View style={styles.pickedText}>
              <Text variant="label" tone="secondary">
                Customer profile
              </Text>
              <Text variant="titleM">{profile.fullName}</Text>
              {profile.phone || profile.licenceNumber ? (
                <Text variant="bodySmall" tone="secondary">
                  {[profile.phone, profile.licenceNumber ? `Licence ${profile.licenceNumber}` : null].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Button label="Change" variant="quiet" onPress={change} />
          </View>
        ) : (
          <View>
            <TextField
              label="Customer name"
              value={name}
              onChangeText={(t) => {
                dirty.current = true;
                setName(t);
                if (nameError) setNameError(null);
              }}
              error={nameError}
              autoFocus={loaded && !name}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={next}
              placeholder="First and last name"
            />
            {(matches.data ?? []).length > 0 ? (
              <View style={styles.matches}>
                <Text variant="labelSmall" tone="secondary" style={styles.matchesLabel}>
                  Saved customers
                </Text>
                {(matches.data ?? []).map((m, i, all) => (
                  <ListRow
                    key={m.customer.id}
                    leading={<Icon icon={UserRound} color={light.textSecondary} />}
                    title={m.customer.fullName}
                    subtitle={[m.customer.phone, m.customer.licenceNumber ? `Licence ${m.customer.licenceNumber}` : null].filter(Boolean).join(' · ') || undefined}
                    onPress={() => pick(m.customer)}
                    divider={i < all.length - 1}
                    accessibilityHint="Fills in this customer and continues"
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}

        <Touchable
          onPress={() => setMoreOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityState={{ expanded: moreOpen }}
          style={styles.moreToggle}
        >
          <Text variant="bodyStrong" tone="accent">
            More details
          </Text>
          <Text variant="body" tone="tertiary">
            (optional)
          </Text>
          <View style={styles.flex} />
          <Icon icon={moreOpen ? ChevronUp : ChevronDown} color={light.accent} />
        </Touchable>

        {moreOpen ? (
          <View style={styles.more}>
            <TextField
              label="Phone"
              value={details.phone ?? ''}
              onChangeText={(t) => edit({ phone: t })}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
            />
            <TextField label="Licence no." value={details.licenceNumber ?? ''} onChangeText={(t) => edit({ licenceNumber: t })} autoCapitalize="characters" autoCorrect={false} />
            <TextField label="ID / passport no." value={details.idNumber ?? ''} onChangeText={(t) => edit({ idNumber: t })} autoCapitalize="characters" autoCorrect={false} />
            <TextField label="Address" value={details.address ?? ''} onChangeText={(t) => edit({ address: t })} autoCapitalize="words" multiline />
            <TextField label="Notes" value={details.notes ?? ''} onChangeText={(t) => edit({ notes: t })} multiline />

            <View style={styles.docs}>
              <Text variant="label">Document photos</Text>
              <Text variant="bodySmall" tone="secondary">
                Stored only on this phone.
              </Text>
              {(docs.data ?? []).length > 0 ? (
                <View style={styles.docGrid}>
                  {(docs.data ?? []).map((d) => (
                    <Touchable
                      key={d.id}
                      onPress={() => setDeleting(d)}
                      accessibilityRole="button"
                      accessibilityLabel={`${DOC_LABEL[d.kind]} photo`}
                      accessibilityHint="Delete this photo"
                      focusRadius={radii.photo}
                      style={styles.docTile}
                    >
                      <Image source={{ uri: resolveFileUri(d.file.path) }} style={styles.docImage} contentFit="cover" />
                      <Text variant="code" tone="secondary" numberOfLines={1}>
                        {DOC_LABEL[d.kind]}
                      </Text>
                    </Touchable>
                  ))}
                </View>
              ) : null}
              <View style={styles.docButtons}>
                {DOC_KINDS.map((k) => (
                  <Button key={k.kind} label={k.label} icon={k.icon} variant="secondary" size="small" onPress={() => setDocMenu(k.kind)} />
                ))}
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text variant="bodyStrong">{customerId ? 'Update the saved profile' : 'Save as customer profile'}</Text>
            <Text variant="bodySmall" tone="secondary">
              {customerId ? 'Changes above also go to their profile.' : 'Next time, pick them by name.'}
            </Text>
          </View>
          <Switch
            value={saveAsProfile}
            onValueChange={setSaveAsProfile}
            trackColor={{ true: light.accent, false: light.outline }}
            thumbColor={palette.white}
            accessibilityLabel={customerId ? 'Update the saved profile' : 'Save as customer profile'}
          />
        </View>
      </KeyboardAwareForm>
    </StartFlowScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: light.surfaceTint,
    borderRadius: radii.md,
    paddingLeft: layout.screenGutter,
    paddingRight: 4,
    paddingVertical: 12,
  },
  pickedText: { flex: 1, gap: 2 },
  matches: { marginTop: 8, marginHorizontal: -layout.screenGutter },
  matchesLabel: { paddingHorizontal: layout.screenGutter, paddingTop: 4 },
  moreToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  more: { gap: 16, marginTop: -4 },
  docs: { gap: 8, marginTop: 4 },
  docGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  docTile: { width: 104, gap: 4 },
  docImage: { width: 104, height: 78, borderRadius: radii.photo, backgroundColor: light.surfaceTint },
  docButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
});
