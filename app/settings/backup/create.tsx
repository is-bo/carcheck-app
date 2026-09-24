import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { Check, CircleCheck, FolderDown, HardDrive, Share2, TriangleAlert, type LucideIcon } from 'lucide-react-native';

import {
  canSaveToFolder,
  createBackup,
  describeBackupError,
  discardBackup,
  estimateBackup,
  isBackupError,
  saveBackupToFolder,
  shareBackup,
  type BackupEstimate,
  type BackupResult,
  type BackupStep,
} from '@/data/backup';
import {
  ActionFooter,
  Banner,
  Button,
  formatFileSize,
  formatNumber,
  Icon,
  plural,
  Screen,
  showToast,
  Text,
  useSurface,
} from '@/ui';
import { duration, ease } from '@/ui/motion';
import { layout, lines, radii } from '@/ui/theme/tokens';

// ---------------------------------------------------------------------------------------------
// Job UI shared with ./restore (named exports; the route is the default export)

export interface JobStep<K extends string> {
  key: K;
  label: string;
}

export interface JobProgress<K extends string> {
  step: K;
  done: number;
  total: number;
}

/** 4 dp determinate bar in the accent (DESIGN.md: cyanotype marks progress). */
export function ProgressBar({ fraction, accessibilityLabel }: { fraction: number; accessibilityLabel: string }) {
  const { colors } = useSurface();
  const reduceMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, fraction));
  const value = useSharedValue(clamped);

  useEffect(() => {
    value.set(withTiming(clamped, { duration: reduceMotion ? 0 : duration.base, easing: ease.standard }));
  }, [clamped, reduceMotion, value]);

  const fill = useAnimatedStyle(() => ({ width: `${value.get() * 100}%` }));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { backgroundColor: colors.divider }]}
    >
      <Animated.View style={[styles.fill, { backgroundColor: colors.accent }, fill]} />
    </View>
  );
}

/**
 * The honest step list of a long job (UX_FLOWS §9): done steps ticked, the current one with a
 * spinner, its counter and a bar, later steps waiting in grey.
 */
export function JobSteps<K extends string>({
  steps,
  progress,
  units,
}: {
  steps: readonly JobStep<K>[];
  /** null before the first step starts. */
  progress: JobProgress<K> | null;
  /** Which steps count bytes; the others count files (or have no counter when total ≤ 1). */
  units: Partial<Record<K, 'bytes' | 'files'>>;
}) {
  const { colors } = useSurface();
  const currentIndex = progress ? steps.findIndex((s) => s.key === progress.step) : -1;

  return (
    <View style={styles.steps}>
      {steps.map((step, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending';
        const unit = units[step.key];
        const counting = state === 'current' && progress && unit && progress.total > 1;
        const counter = counting
          ? unit === 'bytes'
            ? `${formatFileSize(progress.done)} of ${formatFileSize(progress.total)}`
            : `${formatNumber(progress.done)} of ${formatNumber(progress.total)}`
          : null;
        const spoken = `${step.label}${counter ? `, ${counter}` : ''}, ${state === 'done' ? 'done' : state === 'current' ? 'in progress' : 'waiting'}`;
        return (
          <View key={step.key} style={styles.stepRow} accessible accessibilityLabel={spoken}>
            <View style={styles.stepGlyph}>
              {state === 'done' ? (
                <Icon icon={Check} size={20} />
              ) : state === 'current' ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <View style={[styles.pendingDot, { borderColor: colors.outline }]} />
              )}
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepLine}>
                <Text
                  variant={state === 'current' ? 'bodyStrong' : 'body'}
                  tone={state === 'pending' ? 'secondary' : 'primary'}
                  style={styles.stepLabel}
                >
                  {step.label}
                </Text>
                {counter ? (
                  <Text variant="bodySmall" tone="secondary" tabular>
                    {counter}
                  </Text>
                ) : null}
              </View>
              {counting ? (
                <ProgressBar fraction={progress.done / progress.total} accessibilityLabel={step.label} />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * While `blocked`, leaving the screen (top-bar back, Android back, iOS swipe) is stopped and
 * `onAttempt` runs instead, e.g. to cancel the job first. Render the returned element so the
 * iOS edge swipe is disabled too; call `release()` right before navigating away on purpose.
 */
export function useLeaveGuard(
  blocked: boolean,
  onAttempt?: (release: () => void) => void,
): { element: ReactNode; release: () => void } {
  const navigation = useNavigation();
  const attempt = useRef(onAttempt);
  const released = useRef(false);
  useEffect(() => {
    attempt.current = onAttempt;
  });

  const release = useCallback(() => {
    released.current = true;
  }, []);

  useEffect(() => {
    if (!blocked) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (released.current) return;
      e.preventDefault();
      attempt.current?.(release);
    });
  }, [navigation, blocked, release]);

  return { element: <Stack.Screen options={{ gestureEnabled: !blocked }} />, release };
}

/** Icon, Headline and body of a finished job (success or error), left-aligned like EmptyState. */
export function Outcome({
  icon,
  error,
  title,
  children,
}: {
  icon: LucideIcon;
  error?: boolean;
  title: string;
  children?: ReactNode;
}) {
  const { colors } = useSurface();
  return (
    <View style={styles.outcome}>
      <Icon icon={icon} size={48} color={error ? colors.error : colors.text} />
      <Text variant="headline" accessibilityRole="header" style={styles.outcomeTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Paths or problems listed under an error, one per line. */
export function DetailList({ items }: { items: readonly string[] }) {
  const { colors } = useSurface();
  if (items.length === 0) return null;
  return (
    <View style={[styles.details, { borderTopColor: colors.divider }]}>
      {items.map((item, i) => (
        <Text key={`${i}-${item}`} variant="bodySmall" tone="secondary" numberOfLines={1} ellipsizeMode="middle" selectable>
          {item}
        </Text>
      ))}
    </View>
  );
}

/** Coalesces rapid progress callbacks (one per file) into at most one render per ~100 ms. */
export function useThrottledState<T>(initial: T): [T, (value: T) => void, (value: T) => void] {
  const [state, setState] = useState(initial);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    if (pending.current) setState(pending.current.value);
    pending.current = null;
  }, []);
  const setThrottled = useCallback(
    (value: T) => {
      pending.current = { value };
      if (!timer.current) timer.current = setTimeout(flush, 100);
    },
    [flush],
  );
  const setNow = useCallback((value: T) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setState(value);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [state, setThrottled, setNow];
}

// ---------------------------------------------------------------------------------------------
// Create backup

const BACKUP_STEPS: readonly JobStep<BackupStep>[] = [
  { key: 'records', label: 'Saving records' },
  { key: 'files', label: 'Checking photos' },
  { key: 'archive', label: 'Copying photos' },
  { key: 'verify', label: 'Checking backup' },
];

type Phase =
  | { kind: 'running' }
  | { kind: 'done'; result: BackupResult }
  | { kind: 'error'; error: unknown };

/**
 * Settings › Backup & restore › Create backup (UX_FLOWS §9). Starts as soon as it opens; Cancel
 * (or Back) stops it and deletes the partial file. `?then=restore` comes from the restore
 * confirmation ("Back up current data first") and returns there when done.
 */
export default function CreateBackupScreen() {
  const { then } = useLocalSearchParams<{ then?: string }>();
  const fromRestore = then === 'restore';
  const [phase, setPhase] = useState<Phase>({ kind: 'running' });
  const [progress, setProgress, setProgressNow] = useThrottledState<JobProgress<BackupStep> | null>(null);
  const [estimate, setEstimate] = useState<BackupEstimate | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [exported, setExported] = useState<{ saved: boolean; shared: boolean }>({ saved: false, shared: false });
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [attempt, setAttempt] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const leaveWhenStopped = useRef(false);
  const mounted = useRef(true);
  const resultRef = useRef<BackupResult | null>(null);
  const sharedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Deferred so a development double-mount doesn't cancel the job it is about to reuse.
      setTimeout(() => {
        if (mounted.current) return;
        controller.current?.abort();
        // A shared copy may still be read by the receiving app; housekeeping sweeps it later.
        if (resultRef.current && !sharedRef.current) discardBackup(resultRef.current);
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setPhase({ kind: 'running' });
    setProgressNow(null);
    estimateBackup().then((e) => mounted.current && setEstimate(e), () => undefined);
    createBackup({ signal: job.signal, onProgress: setProgress })
      .then((result) => {
        resultRef.current = result;
        if (!mounted.current) return;
        setProgressNow(null);
        setPhase({ kind: 'done', result });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        if (isBackupError(error, 'cancelled')) {
          showToast('Backup cancelled');
          leaveWhenStopped.current = true;
          setCancelling(false);
          setPhase({ kind: 'error', error });
          return;
        }
        setPhase({ kind: 'error', error });
      })
      .finally(() => {
        if (controller.current === job) controller.current = null;
      });
  }, [attempt, setProgress, setProgressNow]);

  const running = phase.kind === 'running';
  const cancel = useCallback(() => {
    setCancelling(true);
    controller.current?.abort();
  }, []);
  const { element: guard } = useLeaveGuard(running, () => {
    leaveWhenStopped.current = true;
    cancel();
  });

  useEffect(() => {
    if (!running && leaveWhenStopped.current) {
      leaveWhenStopped.current = false;
      if (router.canGoBack()) router.back();
    }
  }, [running]);

  const save = async (result: BackupResult) => {
    setBusy('save');
    try {
      if ((await saveBackupToFolder(result)) === 'saved') {
        setExported((x) => ({ ...x, saved: true }));
        showToast('Backup saved to the folder');
      }
    } catch (error) {
      showToast(
        isBackupError(error, 'no_space')
          ? 'Not enough space in that folder. Choose another one, or use Share.'
          : "Couldn't save to that folder. Choose another one, or use Share.",
      );
    } finally {
      setBusy(null);
    }
  };

  const share = async (result: BackupResult) => {
    setBusy('share');
    try {
      await shareBackup(result);
      sharedRef.current = true;
      setExported((x) => ({ ...x, shared: true }));
    } catch {
      showToast(canSaveToFolder ? "Couldn't open the share sheet. Use Save to folder instead." : "Couldn't open the share sheet.");
    } finally {
      setBusy(null);
    }
  };

  const finish = () => {
    if (router.canGoBack()) router.back();
  };

  let body: ReactNode;
  let footer: ReactNode;

  if (phase.kind === 'running') {
    body = (
      <>
        <View style={styles.intro}>
          <Text variant="titleL" accessibilityRole="header">
            {cancelling ? 'Cancelling…' : 'Backing up'}
          </Text>
          <Text variant="body" tone="secondary" style={styles.introText}>
            {estimate
              ? `About ${formatFileSize(estimate.bytes)}. Keep CarCheck open until it finishes.`
              : 'Keep CarCheck open until it finishes.'}
          </Text>
        </View>
        <JobSteps steps={BACKUP_STEPS} progress={progress} units={{ files: 'files', archive: 'bytes' }} />
        {estimate?.large ? <LargeBanner bytes={estimate.bytes} /> : null}
      </>
    );
    footer = (
      <ActionFooter>
        <Button label="Cancel" variant="secondary" fullWidth loading={cancelling} onPress={cancel} />
      </ActionFooter>
    );
  } else if (phase.kind === 'done') {
    const { result } = phase;
    const anyExport = exported.saved || exported.shared;
    body = (
      <>
        <Outcome icon={CircleCheck} title="Backup ready">
          <Text variant="body" tabular style={styles.outcomeLine}>
            {formatFileSize(result.byteSize)} · {result.fileName}
          </Text>
          <Text variant="bodySmall" tone="secondary" tabular style={styles.outcomeLine}>
            {plural(result.counts.rentals, '{n} rental', '{n} rentals')} ·{' '}
            {plural(result.counts.photos, '{n} photo', '{n} photos')} ·{' '}
            {plural(result.counts.customers, '{n} customer', '{n} customers')}
          </Text>
          <Text variant="body" style={styles.outcomeNote}>
            Keep this file somewhere other than this phone. It contains customer ID photos — store it safely.
          </Text>
          {exported.saved ? <ExportedLine label="Saved to a folder" /> : null}
          {exported.shared ? <ExportedLine label="Sent to the share sheet" /> : null}
        </Outcome>
        {result.large ? <LargeBanner bytes={result.byteSize} /> : null}
        {result.missingFiles.length > 0 || result.damagedFiles.length > 0 ? (
          <Banner
            icon={TriangleAlert}
            message={`${plural(
              result.missingFiles.length + result.damagedFiles.length,
              '{n} file was',
              '{n} files were',
            )} already missing or damaged on this phone. The backup keeps them as they are.`}
          />
        ) : null}
      </>
    );
    const saveButton = (primary: boolean) => (
      <Button
        label="Save to folder…"
        icon={FolderDown}
        variant={primary ? 'primary' : 'secondary'}
        fullWidth={primary}
        style={primary ? undefined : styles.flex}
        loading={busy === 'save'}
        disabled={busy !== null && busy !== 'save'}
        onPress={() => save(result)}
      />
    );
    const shareButton = (primary: boolean) => (
      <Button
        label="Share…"
        icon={Share2}
        variant={primary ? 'primary' : 'secondary'}
        fullWidth={primary}
        style={primary ? undefined : styles.flex}
        loading={busy === 'share'}
        disabled={busy !== null && busy !== 'share'}
        onPress={() => share(result)}
      />
    );
    footer = anyExport ? (
      <ActionFooter>
        <Button label={fromRestore ? 'Continue to restore' : 'Done'} fullWidth disabled={busy !== null} onPress={finish} />
        <View style={styles.row}>
          {canSaveToFolder ? saveButton(false) : null}
          {shareButton(false)}
        </View>
      </ActionFooter>
    ) : (
      <ActionFooter>
        {canSaveToFolder ? saveButton(true) : null}
        {canSaveToFolder ? (
          <Button
            label="Share…"
            icon={Share2}
            variant="secondary"
            fullWidth
            loading={busy === 'share'}
            disabled={busy !== null && busy !== 'share'}
            onPress={() => share(result)}
          />
        ) : (
          shareButton(true)
        )}
      </ActionFooter>
    );
  } else {
    const copy = describeBackupError(phase.error, formatFileSize);
    body = (
      <Outcome icon={TriangleAlert} error title={copy.title}>
        <Text variant="body" tone="secondary" style={styles.outcomeLine}>
          {copy.message}
        </Text>
        <DetailList items={copy.details} />
      </Outcome>
    );
    footer = (
      <ActionFooter>
        <Button label="Try again" fullWidth onPress={() => setAttempt((n) => n + 1)} />
        <Button label="Close" variant="quiet" fullWidth onPress={finish} />
      </ActionFooter>
    );
  }

  return (
    <Screen title="Create backup" scroll footer={footer}>
      {guard}
      {body}
    </Screen>
  );
}

function ExportedLine({ label }: { label: string }) {
  return (
    <View style={styles.exported}>
      <Icon icon={Check} size={16} />
      <Text variant="bodySmall">{label}</Text>
    </View>
  );
}

function LargeBanner({ bytes }: { bytes: number }) {
  return (
    <Banner
      icon={HardDrive}
      message={`This backup is ${formatFileSize(bytes)}. Some USB drives and apps can't take files over 4 GB; save it to the phone's storage or a cloud drive.`}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  intro: { paddingHorizontal: layout.screenGutter, paddingTop: 16, paddingBottom: 8 },
  introText: { marginTop: 6 },
  steps: { paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 16 },
  stepRow: { flexDirection: 'row', gap: 12, minHeight: 48, paddingVertical: 12 },
  stepGlyph: { width: 24, height: 22, alignItems: 'center', justifyContent: 'center' },
  pendingDot: { width: 10, height: 10, borderRadius: radii.round, borderWidth: lines.control },
  stepBody: { flex: 1, gap: 10 },
  stepLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  stepLabel: { flexShrink: 1 },
  track: { height: 4, borderRadius: radii.none, overflow: 'hidden' },
  fill: { height: '100%' },
  outcome: { paddingHorizontal: layout.screenGutter, paddingTop: 32, paddingBottom: 16 },
  outcomeTitle: { marginTop: 16 },
  outcomeLine: { marginTop: 6 },
  outcomeNote: { marginTop: 20 },
  exported: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  details: { marginTop: 20, paddingTop: 12, gap: 4, borderTopWidth: lines.divider },
});
