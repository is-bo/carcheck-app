import { router, useLocalSearchParams } from 'expo-router';
import { EllipsisVertical, FileText, PencilLine, Printer, RefreshCw, Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { resolveFileUri } from '@/data/files';
import { DataError, reopenReturn } from '@/data/repos';
import { SharingUnavailableError } from '@/documents';
import { planEvidence } from '@/features/evidence/evidencePlan';
import type { EvidenceImage } from '@/features/evidence/generateEvidence';
import { ActionSheet, type SheetAction } from '@/features/evidence/return/ActionSheet';
import { compareSequence } from '@/features/evidence/returnPlan';
import { returnRoutes } from '@/features/evidence/returnRoutes';
import { useLiveQuery } from '@/features/evidence/useLiveQuery';
import { EvidenceViewer } from '@/features/report/EvidenceViewer';
import { ContactSheet, EvidenceFrame, GeneratingState } from '@/features/report/ReportParts';
import {
  buildReturnDocuments,
  loadReportData,
  printReport,
  shareAllEvidence,
  shareEvidenceImage,
  shareReportPdf,
  shareSignedContract,
  type BuildProgress,
  type ReportData,
} from '@/features/report/returnDocuments';
import {
  ActionFooter,
  Button,
  EmptyState,
  formatDate,
  IconButton,
  PlateFrame,
  Screen,
  showToast,
  SkeletonRows,
  Text,
} from '@/ui';
import { layout } from '@/ui/theme/tokens';

type Build = { status: 'auto' } | { status: 'idle' } | { status: 'running'; progress: BuildProgress | null } | { status: 'failed' };
type Busy = 'all' | 'pdf' | 'print' | 'image' | 'contract' | null;

function progressText(p: BuildProgress | null): { step: string; fraction: number | null } {
  if (!p) return { step: 'Checking evidence images…', fraction: null };
  if (p.step === 'report') return { step: 'Creating report PDF…', fraction: 0.9 };
  return { step: `Building evidence image ${p.index} of ${p.total}…`, fraction: ((p.index - 1) / p.total) * 0.85 };
}

function shareError(e: unknown): string {
  if (e instanceof SharingUnavailableError || e instanceof DataError) return e.message;
  return "Couldn't share. Try again.";
}

/**
 * Return report (UX §6): builds missing or stale evidence images and the report PDF on open
 * (safe to re-run after a crash), then shows each evidence image with Share all images, Print
 * and Share report PDF. Linked from rental detail as `/rental/[id]/report`.
 */
export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useLiveQuery(id, ['artifact', 'rental', 'damage', 'photo', 'inspection'], () => loadReportData(id));
  // 'auto' until the first open decided whether documents must be built.
  const [build, setBuild] = useState<Build>({ status: 'auto' });

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(returnRoutes.rental(id));
  }, [id]);

  // Only async callbacks set state here, so the automatic first build can start from an effect.
  const start = useCallback(
    (force: boolean) =>
      buildReturnDocuments(id, { force, onProgress: (progress) => setBuild({ status: 'running', progress }) }).then(
        () => setBuild({ status: 'idle' }),
        (e: unknown) => {
          console.warn('[report] generation failed', e);
          setBuild({ status: 'failed' });
        },
      ),
    [id],
  );
  const run = useCallback(
    (force: boolean) => {
      setBuild({ status: 'running', progress: null });
      void start(force);
    },
    [start],
  );

  // Missing or stale documents are built once automatically; after that it is the employee's call.
  const phase = data.data?.documents.phase;
  useEffect(() => {
    if (phase === 'needs_build' && build.status === 'auto') void start(false);
  }, [build.status, phase, start]);

  if (data.status === 'loading') {
    return (
      <Screen title="Return report" onLeadingPress={goBack} leading="back">
        <SkeletonRows count={3} plate />
      </Screen>
    );
  }
  if (!data.data) {
    return (
      <Screen title="Return report" onLeadingPress={goBack} leading="back">
        <EmptyState
          icon={FileText}
          title="Couldn't open the report."
          body="Your photos and marks are safe. Try again."
          action={<Button label="Try again" variant="secondary" onPress={data.reload} />}
        />
      </Screen>
    );
  }

  if (build.status === 'running' || (data.data.documents.phase === 'needs_build' && build.status === 'auto')) {
    const { step, fraction } = progressText(build.status === 'running' ? build.progress : null);
    return (
      <Screen title="Return report" onLeadingPress={goBack} leading="back">
        <GeneratingState step={step} fraction={fraction} />
      </Screen>
    );
  }

  const report = data.data;
  if (report.documents.phase === 'not_returned') return <NotReturned data={report} onBack={goBack} />;
  if (build.status === 'failed' || report.documents.phase === 'needs_build' || !report.documents.report) {
    return (
      <Screen title="Return report" onLeadingPress={goBack} leading="back">
        <EmptyState
          icon={FileText}
          title="Couldn't create the report."
          body="Your photos and marks are safe."
          action={<Button label="Try again" onPress={() => run(false)} />}
        />
      </Screen>
    );
  }
  return <ReportReady data={report} onBack={goBack} onRegenerate={() => run(true)} />;
}

function NotReturned({ data, onBack }: { data: ReportData; onBack: () => void }) {
  const { rental } = data;
  const reopened = rental.status === 'returned';
  const canStart = rental.status === 'active';
  return (
    <Screen title="Return report" onLeadingPress={onBack} leading="back">
      <EmptyState
        icon={FileText}
        title={reopened ? 'The return is being edited.' : "The return isn't complete yet."}
        body={
          reopened
            ? 'Complete it again to update the evidence images and the report.'
            : 'The report is created when the return is completed.'
        }
        action={
          reopened || canStart ? (
            <Button label="Resume return" onPress={() => router.push(returnRoutes.entry(rental.id))} />
          ) : undefined
        }
      />
    </Screen>
  );
}

function ReportReady({ data, onBack, onRegenerate }: { data: ReportData; onBack: () => void; onRegenerate: () => void }) {
  const { rental, pairs, damages, evidence } = data;
  const report = data.documents.report!;
  const [busy, setBusy] = useState<Busy>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewing, setViewing] = useState<EvidenceImage | null>(null);

  const newCount = damages.filter((d) => d.status === 'new').length;
  const uncertainCount = damages.filter((d) => d.status === 'uncertain').length;
  const clean = newCount + uncertainCount === 0;
  const withoutBefore = planEvidence(pairs, damages).withoutBefore;
  const summary = clean
    ? 'No new damage found'
    : [
        newCount ? `${newCount} new ${newCount === 1 ? 'damage' : 'damages'}` : null,
        uncertainCount ? `${uncertainCount} uncertain` : null,
      ]
        .filter(Boolean)
        .join(' · ');
  const meta = [rental.customer.fullName, rental.reference].filter(Boolean).join(' · ');

  const act = useCallback(async (kind: NonNullable<Busy>, job: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await job();
    } catch (e) {
      showToast(shareError(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const menu: SheetAction[] = [
    {
      label: 'Share signed contract PDF',
      icon: Share2,
      onPress: () => void act('contract', () => shareSignedContract(rental.id)),
    },
    { label: 'Regenerate evidence', detail: 'Builds the images and the report again.', icon: RefreshCw, onPress: onRegenerate },
    {
      label: 'Edit return',
      detail: 'Reopens the return. Complete it again to update the report.',
      icon: PencilLine,
      onPress: () =>
        void reopenReturn(rental.id).then(
          () => router.push(returnRoutes.compare(rental.id)),
          (e: unknown) => showToast(e instanceof DataError ? e.message : "Couldn't reopen the return. Try again."),
        ),
    },
  ];

  return (
    <Screen
      title="Return report"
      leading="back"
      onLeadingPress={onBack}
      actions={<IconButton icon={EllipsisVertical} accessibilityLabel="More" onPress={() => setMenuOpen(true)} />}
      insets={{ bottom: false }}
      overlay={<ActionSheet open={menuOpen} onClose={() => setMenuOpen(false)} actions={menu} accessibilityLabel="More" />}
      footer={
        <ActionFooter rule>
          <View style={styles.row}>
            {!clean ? (
              <Button
                label="Share all images"
                variant="secondary"
                icon={Share2}
                style={styles.flex}
                loading={busy === 'all'}
                disabled={busy !== null && busy !== 'all'}
                onPress={() =>
                  void act('all', async () => {
                    const way = await shareAllEvidence(rental, evidence);
                    if (way === 'pack') showToast('Shared as one PDF with every evidence image.');
                  })
                }
              />
            ) : null}
            <Button
              label="Print"
              variant="secondary"
              icon={Printer}
              style={styles.flex}
              loading={busy === 'print'}
              disabled={busy !== null && busy !== 'print'}
              onPress={() => void act('print', () => printReport(report))}
            />
          </View>
          <Button
            label="Share report PDF"
            icon={Share2}
            fullWidth
            loading={busy === 'pdf'}
            disabled={busy !== null && busy !== 'pdf'}
            onPress={() => void act('pdf', () => shareReportPdf(rental, report))}
          />
        </ActionFooter>
      }
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.head}>
          {rental.vehicle ? <PlateFrame plate={rental.vehicle.plate} /> : null}
          {meta ? (
            <Text variant="body" tone="secondary" tabular>
              {meta}
            </Text>
          ) : null}
          <Text variant="titleL" accessibilityRole="header">
            {summary}
          </Text>
          {rental.returnRevision > 1 && rental.returnCompletedAt ? (
            <Text variant="bodySmall" tone="secondary">
              Revised {formatDate(rental.returnCompletedAt)}
            </Text>
          ) : null}
        </View>

        {clean ? (
          <View style={styles.section}>
            <Text variant="body" tone="secondary">
              Returned in the same condition as at pick-up.
            </Text>
            <ContactSheet pairs={compareSequence(pairs)} />
          </View>
        ) : (
          <View style={styles.section}>
            {evidence.map((e, i) => (
              <EvidenceFrame
                key={e.artifact.id}
                evidence={e}
                index={i}
                total={evidence.length}
                damages={damages}
                onPress={() => setViewing(e)}
              />
            ))}
            {withoutBefore.length > 0 ? (
              <Text variant="bodySmall" tone="secondary">
                {withoutBefore.map((p) => p.label).join(', ')}: new damage with no pick-up photo to compare. It is listed in the
                report PDF.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      <EvidenceViewer
        uri={viewing ? resolveFileUri(viewing.artifact.file.path) : null}
        title={viewing?.label ?? ''}
        width={viewing?.artifact.width ?? 0}
        height={viewing?.artifact.height ?? 0}
        sharing={busy === 'image'}
        onShare={() => {
          if (viewing) void act('image', () => shareEvidenceImage(rental, viewing));
        }}
        onClose={() => setViewing(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  content: { paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 24, gap: 24 },
  head: { gap: 8, alignItems: 'flex-start' },
  section: { gap: 24 },
});
