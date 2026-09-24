import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Check, CircleAlert, RotateCcw, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { newTempFileUri, resolveFileUri } from '@/data/files';
import { getRental, getValidContract, LockedError, signContract } from '@/data/repos';
import type { Rental, SignedContractWithState } from '@/domain/types';
import { generateContractPdfInBackground, shareContractPdf } from '@/features/contract/contractPdf';
import { ContractView } from '@/features/contract/ContractView';
import { agencyMonogram, signingRecap, thankYouTitle } from '@/features/contract/handOff';
import { usePreparedContract } from '@/features/contract/usePreparedContract';
import { useExitStartFlow, useResumePoint } from '@/features/inspection/StartFlowScreen';
import { SignaturePad, type SignaturePadHandle } from '@/media/signature';
import {
  ActionFooter,
  Button,
  EmptyState,
  formatDateLong,
  formatDateTime,
  Icon,
  PlateFrame,
  Screen,
  showToast,
  SkeletonRows,
  Text,
  TopBar,
  useNoScreenshots,
} from '@/ui';
import { layout, lines, palette, radii } from '@/ui/theme/tokens';

type Stage = 'review' | 'pad' | 'thanks' | 'done';

/**
 * Step 5b (UX §2.5): the customer's own mode. Read → sign → thank-you, then the employee's
 * success screen. No stepper, no ✕, no staff actions; Back moves one state back and never
 * leaves the flow. Confirm signature is the finalize action (no extra dialog).
 */
export default function SignStep() {
  useNoScreenshots('sign');
  const { id } = useLocalSearchParams<{ id: string }>();
  useResumePoint(id, 'sign');
  const [stage, setStage] = useState<Stage>('review');
  const [signed, setSigned] = useState<SignedContractWithState | null>(null);
  // Render once for this hand-off: the customer signs exactly what they read.
  const contract = usePreparedContract(id, { refreshOnFocus: false });

  // Opened after signing (double tap, resume): go straight to the success screen.
  useEffect(() => {
    if (!(contract.error instanceof LockedError) || signed) return;
    getValidContract(id).then((c) => {
      if (c) {
        setSigned(c);
        setStage('done');
      }
    }, () => undefined);
  }, [contract.error, id, signed]);

  const done = useDone(id);
  // Continue lands on the rental with the share offer, one tap shorter than a success screen (UX §2.5).
  const finish = useCallback(
    (c: SignedContractWithState) => {
      done();
      showToast('Rental started', {
        action: {
          label: 'Share contract',
          onPress: () => void shareContractPdf(c.id).catch(() => showToast('Couldn’t create the contract PDF yet. Try again in a moment.')),
        },
      });
    },
    [done],
  );
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (stage === 'pad') setStage('review');
        else if (stage === 'thanks' && signed) finish(signed);
        else if (stage === 'done') done();
        else return false;
        return true;
      });
      return () => sub.remove();
    }, [stage, done, finish, signed]),
  );

  if (stage === 'done' && signed) return <SuccessStage rentalId={id} contract={signed} onDone={done} />;
  if (stage === 'thanks' && signed) return <ThanksStage rentalId={id} onContinue={() => finish(signed)} />;

  if (contract.error && !contract.data) {
    return (
      <Screen leading="back" title="Agreement">
        <EmptyState
          icon={CircleAlert}
          title="The agreement can’t be shown."
          body="Please hand the phone back to staff."
          action={<Button label="Back to review" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }
  if (!contract.data) {
    return (
      <Screen>
        <SkeletonRows count={6} plate={false} />
      </Screen>
    );
  }

  const { prep, agency } = contract.data;
  if (stage === 'pad') {
    return (
      <PadStage
        rental={prep.rental}
        existing={prep.context.existingDamage.length}
        onBack={() => setStage('review')}
        onSign={async (signature) => {
          const c = await signContract({
            rentalId: id,
            templateId: prep.template.id,
            renderedHtml: prep.render.html,
            variables: prep.render.variables,
            signerName: prep.rental.customer.fullName ?? '',
            signature,
          });
          generateContractPdfInBackground(c.id);
          setSigned(c);
          setStage('thanks');
        }}
      />
    );
  }

  const r = prep.rental;
  const period = [r.startedAt ? formatDateTime(r.startedAt) : null, r.expectedReturnAt ? formatDateTime(r.expectedReturnAt) : null];
  const logoUri = agency.logo ? resolveFileUri(agency.logo.path) : null;
  return (
    <Screen
      header={
        <View style={styles.agency}>
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={styles.logo} contentFit="contain" accessibilityLabel={`${agency.name} logo`} />
          ) : (
            <View style={styles.monogram}>
              <Text variant="titleS" color={palette.white}>
                {agencyMonogram(agency.name)}
              </Text>
            </View>
          )}
          <View style={styles.fill}>
            <Text variant="titleM" numberOfLines={1}>
              {agency.name}
            </Text>
            {agency.address ? (
              <Text variant="subtitle" tone="secondary" numberOfLines={1}>
                {agency.address}
              </Text>
            ) : null}
          </View>
        </View>
      }
      insets={{ bottom: false }}
      footer={
        <ActionFooter rule gutter={layout.customerGutter}>
          <Button label="Sign agreement" variant="accent" size="customer" onPress={() => setStage('pad')} fullWidth />
        </ActionFooter>
      }
    >
      <ScrollView contentContainerStyle={styles.review}>
        <View style={styles.intro}>
          <Text variant="customer.headline" accessibilityRole="header">
            Please review your rental
          </Text>
          <View style={styles.vehicleLine}>
            <Text variant="customer.body">{[r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(' ')}</Text>
            {r.vehicle ? <PlateFrame plate={r.vehicle.plate} /> : null}
          </View>
          {period[0] ? (
            <Text variant="customer.secondary" tone="secondary" tabular>
              {period[1] ? `${period[0]} until ${period[1]}` : `From ${period[0]}`}
            </Text>
          ) : null}
        </View>
        <ContractView html={prep.render.html} rentalId={id} damage={prep.context.existingDamage} audience="customer" />
        {/* After the agreement, never next to the binding button. */}
        <View style={styles.askStaffWrap}>
          <Button label="Something wrong? Ask staff." variant="quiet" onPress={() => router.back()} style={styles.askStaff} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Leaves the finished flow for the rental's detail screen. */
function useDone(rentalId: string) {
  const exit = useExitStartFlow();
  return useCallback(() => exit({ toast: null, toRental: rentalId }), [exit, rentalId]);
}

// ---------------------------------------------------------------------------------------------

function PadStage({
  rental,
  existing,
  onBack,
  onSign,
}: {
  rental: Rental;
  existing: number;
  onBack: () => void;
  onSign: (signature: { tempUri: string; byteSize: number; sha256: string }) => Promise<void>;
}) {
  const pad = useRef<SignaturePadHandle>(null);
  const [valid, setValid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => formatDateLong(Date.now()));
  const { width, height, fontScale } = useWindowDimensions();
  const landscape = width > height;
  // Large system text: the two customer buttons stack (Confirm first) instead of truncating.
  const stack = fontScale > 1.3;

  const confirm = async () => {
    if (!pad.current || saving) return;
    setSaving(true);
    setError(null);
    try {
      const png = await pad.current.exportSignature(newTempFileUri('capture', 'png'));
      await onSign({ tempUri: png.uri, byteSize: png.bytes, sha256: png.sha256 });
    } catch (e) {
      // The customer holds the phone: never show a technical message here.
      console.warn('[sign] signing failed', e);
      setError('Your signature couldn’t be saved. Please try again, or ask staff for help.');
      setSaving(false);
    }
  };

  const clear = (
    <Button
      label="Clear"
      icon={RotateCcw}
      variant="secondary"
      size="customer"
      disabled={saving}
      fullWidth={stack || landscape}
      onPress={() => {
        pad.current?.clear();
        setError(null);
      }}
    />
  );
  const confirmButton = (
    <Button
      label="Confirm signature"
      variant="accent"
      size="customer"
      disabled={!valid}
      loading={saving}
      onPress={confirm}
      fullWidth={stack || landscape}
      style={stack || landscape ? undefined : styles.fill}
    />
  );
  const fine = error ? (
    <Text variant="customer.fine" tone="error" accessibilityLiveRegion="polite">
      {error}
    </Text>
  ) : (
    <Text variant="customer.fine" tone="secondary">
      Once you confirm, the agreement and your signature are saved as they are and cannot be changed.
    </Text>
  );
  const signaturePad = (
    <SignaturePad
      ref={pad}
      signerName={rental.customer.fullName ?? undefined}
      dateLabel={today}
      onChange={(s) => setValid(s.isValid)}
      style={landscape ? styles.padLandscape : styles.pad}
    />
  );

  // Landscape gives the pad the room (UX §2.5): the prompt moves into the top bar, the buttons
  // into a column beside the pad.
  if (landscape) {
    return (
      <Screen header={<TopBar leading="back" onLeadingPress={onBack} title="Sign above the line" />} insets={{ bottom: false }}>
        <View style={styles.landscapeRow}>
          <View style={styles.landscapePad}>
            <Text variant="customer.secondary" tone="secondary" numberOfLines={1}>
              {signingRecap(rental.vehicle, existing)}
            </Text>
            {signaturePad}
            {fine}
          </View>
          <View style={styles.landscapeActions}>
            {confirmButton}
            {clear}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      header={<TopBar leading="back" onLeadingPress={onBack} title="Back to agreement" />}
      insets={{ bottom: false }}
      footer={
        stack ? (
          <ActionFooter gutter={layout.customerGutter}>
            {confirmButton}
            {clear}
          </ActionFooter>
        ) : (
          <ActionFooter row gutter={layout.customerGutter}>
            {clear}
            {confirmButton}
          </ActionFooter>
        )
      }
    >
      <View style={styles.padWrap}>
        <Text variant="customer.headline" accessibilityRole="header">
          Sign above the line
        </Text>
        <Text variant="customer.secondary" tone="secondary">
          {signingRecap(rental.vehicle, existing)}
        </Text>
        {signaturePad}
        {fine}
      </View>
    </Screen>
  );
}

function ThanksStage({ rentalId, onContinue }: { rentalId: string; onContinue: () => void }) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    getRental(rentalId).then((r) => setName(r.customer.fullName), () => undefined);
  }, [rentalId]);
  const insets = useSafeAreaInsets();
  return (
    <Screen insets={{ bottom: false }}>
      <View style={[styles.thanks, { paddingBottom: insets.bottom + layout.bottomActionInset }]}>
        <View style={styles.fill}>
          <Icon icon={Check} size={48} />
          <Text variant="customer.headline" accessibilityRole="header" style={styles.thanksTitle}>
            {thankYouTitle(name)}
          </Text>
          <Text variant="customer.body" tone="secondary" style={styles.thanksBody}>
            Please hand the phone back.
          </Text>
        </View>
        <Button label="Continue" variant="secondary" size="small" onPress={onContinue} accessibilityHint="For staff" />
      </View>
    </Screen>
  );
}

function SuccessStage({ rentalId, contract, onDone }: { rentalId: string; contract: SignedContractWithState; onDone: () => void }) {
  const [rental, setRental] = useState<Rental | null>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    getRental(rentalId).then(setRental, () => undefined);
  }, [rentalId]);

  const share = async () => {
    setSharing(true);
    try {
      await shareContractPdf(contract.id);
    } catch {
      showToast('Couldn’t create the contract PDF yet. Try again in a moment.');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      insets={{ bottom: false }}
      footer={
        <ActionFooter>
          <Button label="Share contract" icon={Share2} variant="secondary" loading={sharing} onPress={share} fullWidth />
          <Button label="Done" onPress={onDone} fullWidth />
        </ActionFooter>
      }
    >
      <View style={styles.success}>
        <Icon icon={Check} size={48} />
        <Text variant="headline" accessibilityRole="header" style={styles.thanksTitle}>
          Rental started
        </Text>
        {rental ? (
          <View style={styles.successFacts}>
            {rental.vehicle ? <PlateFrame plate={rental.vehicle.plate} /> : null}
            <Text variant="body" tone="secondary" tabular>
              {[rental.customer.fullName, rental.reference].filter(Boolean).join(' · ')}
            </Text>
            <Text variant="bodySmall" tone="secondary" tabular>
              Signed {formatDateTime(contract.signedAt)}. The contract is saved and can’t be changed.
            </Text>
          </View>
        ) : null}
        <Text variant="body" tone="secondary" style={styles.successHint}>
          Share the signed contract with the customer, for example on WhatsApp or by email.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  agency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: layout.customerGutter,
    borderBottomWidth: lines.divider,
    borderBottomColor: palette.rule,
  },
  logo: { width: 44, height: 36 },
  monogram: { width: 36, height: 36, borderRadius: radii.sm, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  review: { paddingBottom: 32 },
  intro: { paddingHorizontal: layout.customerGutter, paddingTop: 22, paddingBottom: 4, gap: 8 },
  vehicleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  askStaffWrap: { paddingHorizontal: layout.customerGutter, paddingTop: 24 },
  askStaff: { alignSelf: 'flex-start', marginLeft: -12 },
  padWrap: { flex: 1, paddingHorizontal: layout.customerGutter, paddingTop: 8, gap: 12 },
  pad: { flex: 1, minHeight: 180 },
  padLandscape: { flex: 1, minHeight: 120 },
  landscapeRow: { flex: 1, flexDirection: 'row', gap: 16, paddingHorizontal: layout.customerGutter, paddingBottom: 12 },
  landscapePad: { flex: 1, gap: 8 },
  landscapeActions: { width: 200, justifyContent: 'center', gap: 12 },
  thanks: { flex: 1, paddingHorizontal: layout.customerGutter, paddingTop: 48 },
  thanksTitle: { marginTop: 20 },
  thanksBody: { marginTop: 8 },
  success: { paddingHorizontal: layout.screenGutter, paddingTop: 40 },
  successFacts: { marginTop: 16, gap: 8 },
  successHint: { marginTop: 24 },
});
