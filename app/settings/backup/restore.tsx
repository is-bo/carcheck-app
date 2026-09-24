import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ArchiveRestore, CircleCheck, FileSearch, HardDrive, Info, TriangleAlert } from 'lucide-react-native';

import {
  commitRestore,
  deleteSafetyCopy,
  describeBackupError,
  discardRestore,
  getSafetyCopy,
  isBackupError,
  pickBackupFile,
  prepareRestore,
  type RestoreOutcome,
  type RestorePreview,
  type RestoreStep,
  type SafetyCopyInfo,
} from '@/data/backup';
import {
  ActionFooter,
  Banner,
  Button,
  ConfirmDialog,
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  plural,
  Screen,
  showToast,
  Text,
  useSurface,
} from '@/ui';
import { layout, lines } from '@/ui/theme/tokens';

import { DetailList, JobSteps, Outcome, useLeaveGuard, useThrottledState, type JobProgress, type JobStep } from './create';

const BACKUP_FIRST = '/settings/backup/create?then=restore' as Href;

const CHECK_STEPS: readonly JobStep<RestoreStep>[] = [
  { key: 'open', label: 'Reading backup' },
  { key: 'unpack', label: 'Unpacking' },
  { key: 'files', label: 'Checking photos' },
  { key: 'records', label: 'Checking records' },
];

type Phase =
  | { kind: 'intro' }
  | { kind: 'checking' }
  | { kind: 'ready'; preview: RestorePreview }
  | { kind: 'committing'; preview: RestorePreview }
  | { kind: 'done'; outcome: RestoreOutcome }
  | { kind: 'error'; error: unknown; safetyCopy: SafetyCopyInfo | null };

/**
 * Settings › Backup & restore › Restore (UX_FLOWS §9, DATA_MODEL §7.3). Choose file → the whole
 * archive is checked in a separate data folder (Cancel allowed) → backup details and the
 * destructive confirm → switch (not cancellable) → Open CarCheck reloads to Home. Nothing on the
 * phone changes before the switch; the replaced data is kept for 14 days.
 */
export default function RestoreScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [progress, setProgress, setProgressNow] = useThrottledState<JobProgress<RestoreStep> | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deletingCopy, setDeletingCopy] = useState<'ask' | 'busy' | null>(null);

  const controller = useRef<AbortController | null>(null);
  const preview = useRef<RestorePreview | null>(null);
  const mounted = useRef(true);
  const leaveWhenStopped = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;
        controller.current?.abort();
        // A checked but unconfirmed restore leaves no staging data behind.
        if (preview.current) discardRestore(preview.current);
        preview.current = null;
      }, 0);
    };
  }, []);

  const choose = useCallback(async () => {
    if (preview.current) discardRestore(preview.current);
    preview.current = null;
    setProgressNow({ step: 'open', done: 0, total: 1 });
    setPhase({ kind: 'checking' });
    let picked;
    try {
      picked = await pickBackupFile();
    } catch (error) {
      if (mounted.current) setPhase({ kind: 'error', error, safetyCopy: null });
      return;
    }
    if (!mounted.current) return;
    if (!picked) {
      setPhase({ kind: 'intro' });
      return;
    }
    const job = new AbortController();
    controller.current = job;
    try {
      const checked = await prepareRestore(picked, { signal: job.signal, onProgress: setProgress });
      if (!mounted.current) {
        discardRestore(checked);
        return;
      }
      preview.current = checked;
      setPhase({ kind: 'ready', preview: checked });
    } catch (error) {
      if (!mounted.current) return;
      if (isBackupError(error, 'cancelled')) {
        showToast('Restore cancelled. Nothing was changed.');
        setPhase({ kind: 'intro' });
      } else {
        setPhase({ kind: 'error', error, safetyCopy: isBackupError(error, 'no_space') ? getSafetyCopy() : null });
      }
    } finally {
      if (controller.current === job) controller.current = null;
      setCancelling(false);
    }
  }, [setProgress, setProgressNow]);

  const cancelCheck = useCallback(() => {
    if (!controller.current) return;
    setCancelling(true);
    controller.current.abort();
  }, []);

  const replace = useCallback(async (checked: RestorePreview) => {
    setConfirming(false);
    setPhase({ kind: 'committing', preview: checked });
    try {
      const outcome = await commitRestore(checked);
      preview.current = null;
      setPhase({ kind: 'done', outcome });
    } catch (error) {
      // After a failed switch the staged folder is either gone or no longer referenced.
      discardRestore(checked);
      preview.current = null;
      setPhase({ kind: 'error', error, safetyCopy: null });
    }
  }, []);

  const blocked = phase.kind === 'checking' || phase.kind === 'committing' || phase.kind === 'done';
  const { element: guard, release } = useLeaveGuard(blocked, (releaseGuard) => {
    if (phase.kind === 'checking') {
      leaveWhenStopped.current = true;
      cancelCheck();
    } else if (phase.kind === 'done') {
      goHome(releaseGuard);
    }
  });
  const openHome = () => goHome(release);

  useEffect(() => {
    if (phase.kind !== 'checking' && leaveWhenStopped.current) {
      leaveWhenStopped.current = false;
      if (router.canGoBack()) router.back();
    }
  }, [phase.kind]);

  let body: ReactNode;
  let footer: ReactNode = null;

  switch (phase.kind) {
    case 'intro':
      body = (
        <View style={styles.intro}>
          <Text variant="titleL" accessibilityRole="header">
            Restore from a backup
          </Text>
          <Text variant="body" style={styles.paragraph}>
            Restoring replaces all rentals, photos, contracts and settings on this phone with the ones in a CarCheck
            backup file (.carcheck).
          </Text>
          <Text variant="body" tone="secondary" style={styles.paragraph}>
            CarCheck checks the whole file first. Nothing on this phone changes until you confirm.
          </Text>
        </View>
      );
      footer = (
        <ActionFooter>
          <Button label="Choose backup file" icon={FileSearch} fullWidth onPress={choose} />
        </ActionFooter>
      );
      break;

    case 'checking':
      body = (
        <>
          <View style={styles.intro}>
            <Text variant="titleL" accessibilityRole="header">
              {cancelling ? 'Cancelling…' : 'Checking backup'}
            </Text>
            <Text variant="body" tone="secondary" style={styles.paragraph}>
              Nothing on this phone changes while the file is checked.
            </Text>
          </View>
          <JobSteps steps={CHECK_STEPS} progress={progress} units={{ unpack: 'bytes', files: 'files' }} />
        </>
      );
      footer = (
        <ActionFooter>
          <Button label="Cancel" variant="secondary" fullWidth loading={cancelling} onPress={cancelCheck} />
        </ActionFooter>
      );
      break;

    case 'ready':
    case 'committing': {
      const checked = phase.preview;
      const committing = phase.kind === 'committing';
      body = <PreviewDetails preview={checked} />;
      footer = (
        <ActionFooter rule>
          <Button
            label={committing ? 'Replacing data…' : 'Replace all data'}
            icon={ArchiveRestore}
            variant="destructive"
            fullWidth
            loading={committing}
            onPress={() => setConfirming(true)}
          />
          <Button label="Choose another file" variant="quiet" fullWidth disabled={committing} onPress={choose} />
        </ActionFooter>
      );
      break;
    }

    case 'done':
      body = (
        <Outcome icon={CircleCheck} title="Restore complete">
          <Text variant="body" tabular style={styles.outcomeLine}>
            {plural(phase.outcome.counts.rentals, '{n} rental', '{n} rentals')},{' '}
            {plural(phase.outcome.counts.vehicles, '{n} vehicle', '{n} vehicles')},{' '}
            {plural(phase.outcome.counts.customers, '{n} customer', '{n} customers')}
          </Text>
          <Text variant="body" tone="secondary" style={styles.paragraph}>
            The data that was on this phone before is kept for 14 days, then deleted.
          </Text>
        </Outcome>
      );
      footer = (
        <ActionFooter>
          <Button label="Open CarCheck" fullWidth onPress={openHome} />
        </ActionFooter>
      );
      break;

    case 'error': {
      const copy = describeBackupError(phase.error, formatFileSize);
      body = (
        <>
          <Outcome icon={TriangleAlert} error title={copy.title}>
            <Text variant="body" tone="secondary" style={styles.outcomeLine}>
              {copy.message}
            </Text>
            <DetailList items={copy.details} />
          </Outcome>
          {phase.safetyCopy ? (
            <Banner
              icon={HardDrive}
              message={`${formatFileSize(phase.safetyCopy.bytes)} is taken by the data kept from the last restore${
                phase.safetyCopy.until ? ` (until ${formatDate(phase.safetyCopy.until)})` : ''
              }.`}
              action={<Button label="Delete it" variant="quiet" onPress={() => setDeletingCopy('ask')} />}
            />
          ) : null}
        </>
      );
      footer = (
        <ActionFooter>
          <Button label="Choose backup file" icon={FileSearch} fullWidth onPress={choose} />
          <Button label="Close" variant="quiet" fullWidth onPress={() => router.canGoBack() && router.back()} />
        </ActionFooter>
      );
      break;
    }
  }

  const ready = phase.kind === 'ready' ? phase.preview : null;

  return (
    <Screen title="Restore" scroll footer={footer}>
      {guard}
      {body}
      <ConfirmDialog
        visible={confirming && ready !== null}
        title="Replace everything on this phone with this backup?"
        message="Current rentals, photos and settings will be replaced. CarCheck keeps the replaced data for 14 days in case something went wrong."
        confirmLabel="Replace data"
        onConfirm={() => ready && replace(ready)}
        onCancel={() => setConfirming(false)}
        secondaryAction={{
          label: 'Back up current data first',
          onPress: () => {
            setConfirming(false);
            router.push(BACKUP_FIRST);
          },
        }}
      />
      <ConfirmDialog
        visible={deletingCopy !== null}
        title="Delete the data kept from the last restore?"
        message="It is the data this phone had before the last restore. Delete it only if you don't need it."
        confirmLabel="Delete"
        busy={deletingCopy === 'busy'}
        onCancel={() => setDeletingCopy(null)}
        onConfirm={() => {
          setDeletingCopy('busy');
          try {
            deleteSafetyCopy();
            showToast('Space freed. Choose the backup file again.');
            if (phase.kind === 'error') setPhase({ ...phase, safetyCopy: null });
          } catch (error) {
            showToast(error instanceof Error ? error.message : 'Could not delete it.');
          } finally {
            setDeletingCopy(null);
          }
        }}
      />
    </Screen>
  );
}

/** After a restore every screen shows other data: start again from Home. */
function goHome(releaseGuard: () => void): void {
  releaseGuard();
  router.dismissTo('/');
}

function PreviewDetails({ preview }: { preview: RestorePreview }) {
  const { backup, current } = preview;
  const rows: [string, number, number][] = [
    ['Rentals', backup.counts.rentals, current.counts.rentals],
    ['Vehicles', backup.counts.vehicles, current.counts.vehicles],
    ['Customers', backup.counts.customers, current.counts.customers],
    ['Photos', backup.counts.photos, current.counts.photos],
  ];
  const knownProblems = backup.missingFiles.length + backup.damagedFiles.length;

  return (
    <>
      <View style={styles.intro}>
        <Text variant="titleL" accessibilityRole="header">
          Backup checked
        </Text>
        <Text variant="body" tone="secondary" style={styles.paragraph}>
          {knownProblems > 0
            ? 'Every record in this file is complete. Some photos were already missing or damaged when it was made (see below).'
            : 'Every photo and record in this file is complete and undamaged.'}
        </Text>
      </View>

      <View style={styles.facts}>
        <Fact label="Made" value={formatDateTime(backup.createdAt)} />
        <Fact label="Agency" value={backup.agencyName || '—'} />
        <Fact label="Phone" value={backup.device || (backup.platform === 'ios' ? 'iPhone' : 'Android phone')} />
        <Fact label="CarCheck" value={`Version ${backup.appVersion}`} />
        <Fact label="File" value={preview.fileName} />
      </View>

      <CompareTable rows={rows} backupBytes={backup.totalBytes} currentBytes={current.bytes} />

      {preview.upgradedFrom !== null ? (
        <Banner icon={Info} message="This backup came from an older CarCheck. Its records were updated for this version." />
      ) : null}
      {knownProblems > 0 ? (
        <Banner
          icon={TriangleAlert}
          message={`${plural(knownProblems, '{n} file was', '{n} files were')} already missing or damaged on the phone that made this backup. They stay missing after the restore.`}
        />
      ) : null}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="bodySmall" tone="secondary" style={styles.factLabel}>
        {label}
      </Text>
      <Text variant="body" tabular numberOfLines={2} ellipsizeMode="middle" style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

/** Backup vs this phone, side by side: the "size vs current data" check before replacing. */
function CompareTable({
  rows,
  backupBytes,
  currentBytes,
}: {
  rows: [string, number, number][];
  backupBytes: number;
  currentBytes: number;
}) {
  const { colors } = useSurface();
  const all: [string, string, string][] = [
    ...rows.map(([label, b, c]): [string, string, string] => [label, formatNumber(b), formatNumber(c)]),
    ['Size', formatFileSize(backupBytes), formatFileSize(currentBytes)],
  ];
  return (
    <View style={styles.table} accessibilityRole="summary">
      <View style={[styles.tableRow, styles.tableHead, { borderBottomColor: colors.ruleStrong }]}>
        <Text variant="label" style={styles.tableLabel} />
        <Text variant="label" style={styles.tableCell} align="right">
          Backup
        </Text>
        <Text variant="label" tone="secondary" style={styles.tableCell} align="right">
          This phone
        </Text>
      </View>
      {all.map(([label, b, c], i) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: backup ${b}, this phone ${c}`}
          style={[styles.tableRow, i < all.length - 1 && { borderBottomColor: colors.divider, borderBottomWidth: lines.divider }]}
        >
          <Text variant="body" style={styles.tableLabel}>
            {label}
          </Text>
          <Text variant="numeric" tabular style={styles.tableCell} align="right">
            {b}
          </Text>
          <Text variant="numeric" tone="secondary" tabular style={styles.tableCell} align="right">
            {c}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: layout.screenGutter, paddingTop: 16, paddingBottom: 8 },
  paragraph: { marginTop: 10 },
  outcomeLine: { marginTop: 6 },
  facts: { paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 8 },
  fact: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  factLabel: { width: 84, paddingTop: 2 },
  factValue: { flex: 1 },
  table: { marginHorizontal: layout.screenGutter, marginTop: 16, marginBottom: 16 },
  tableRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 12 },
  tableHead: { minHeight: 32, borderBottomWidth: lines.control },
  tableLabel: { flex: 1.2 },
  tableCell: { flex: 1 },
});
