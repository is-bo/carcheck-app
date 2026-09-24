/**
 * Report screen pieces: the generation progress state, an evidence preview frame, and the
 * compact before/after contact sheet of a clean return (UX §6).
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { resolveFileUri } from '@/data/files';
import type { AnglePair, Damage } from '@/domain/types';
import { MarkerBadge, markerLabel, Text, Touchable } from '@/ui';
import { layout, light, radii } from '@/ui/theme/tokens';

import type { EvidenceImage } from '../evidence/generateEvidence';
import { usePhotoUri } from '../evidence/photoFiles';

// ---------------------------------------------------------------------------------------------

export interface GeneratingStateProps {
  /** "Building evidence image 2 of 3…" / "Creating report PDF…" */
  step: string;
  /** 0..1, or null while the amount of work is not known yet. */
  fraction: number | null;
}

/** The one full progress screen of the report: honest steps, safe to leave. */
export function GeneratingState({ step, fraction }: GeneratingStateProps) {
  return (
    <View style={styles.generating} accessibilityLiveRegion="polite">
      <Text variant="titleL">Creating the report</Text>
      <Text variant="body" tone="secondary" tabular>
        {step}
      </Text>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={fraction === null ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) }}
      >
        <View style={[styles.fill, { width: `${Math.round((fraction ?? 0.04) * 100)}%` }]} />
      </View>
      <Text variant="bodySmall" tone="tertiary">
        Your photos and marks are already saved. If you leave, this finishes the next time you open the report.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

export interface EvidenceFrameProps {
  evidence: EvidenceImage;
  index: number;
  total: number;
  damages: readonly Damage[];
  onPress: () => void;
}

/** Full-width evidence preview with its edge code and the marks it shows. */
export function EvidenceFrame({ evidence, index, total, damages, onPress }: EvidenceFrameProps) {
  const { artifact } = evidence;
  const aspect = artifact.width && artifact.height ? artifact.width / artifact.height : 0.6;
  const shown = evidence.damageIds
    .map((id) => damages.find((d) => d.id === id))
    .filter((d): d is Damage => !!d && d.status !== 'pre_existing');
  return (
    <View style={styles.evidence}>
      <Touchable
        onPress={onPress}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${evidence.label} evidence image. Opens it full screen.`}
        style={[styles.evidenceFrame, { aspectRatio: aspect }]}
      >
        <Image source={{ uri: resolveFileUri(artifact.file.path) }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
      </Touchable>
      <View style={styles.evidenceCaption}>
        <Text variant="code" tone="secondary" style={styles.flex} numberOfLines={1}>
          {`${evidence.label} · Evidence ${index + 1} of ${total}`}
        </Text>
        <View style={styles.glyphs}>
          {shown.map((d) => (
            <MarkerBadge key={d.id} status={d.status} label={markerLabel(d.status, d.number)} size={22} />
          ))}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

/** Clean return: every angle's BEFORE next to its AFTER, so "no new damage" can be checked. */
export function ContactSheet({ pairs }: { pairs: readonly AnglePair[] }) {
  return (
    <View style={styles.sheet}>
      {pairs.map((p) => (
        <View key={`${p.angleKey}#${p.slot}`} style={styles.sheetRow}>
          <Text variant="code" tone="secondary">
            {p.label}
          </Text>
          <View style={styles.sheetPair}>
            <Thumb photo={p.before} word="Before" skipped={p.beforeState?.skippedAt != null} />
            <Thumb photo={p.after} word="After" skipped={p.afterState?.skippedAt != null} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Thumb({ photo, word, skipped }: { photo: AnglePair['before']; word: string; skipped: boolean }) {
  const uri = usePhotoUri(photo, 'thumb');
  return (
    <View style={styles.thumbCell}>
      <View style={styles.thumb}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={word} />
        ) : !photo ? (
          <View style={styles.thumbEmpty}>
            <Text variant="caption" tone="secondary">
              {skipped ? 'Skipped' : 'No photo'}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="code" tone="tertiary">
        {word}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  generating: { flex: 1, justifyContent: 'center', gap: 12, paddingHorizontal: layout.screenGutter, paddingBottom: 64 },
  track: { height: 4, backgroundColor: light.divider, marginTop: 8 },
  fill: { height: 4, backgroundColor: light.accent },
  evidence: { gap: 8 },
  evidenceFrame: { width: '100%', borderRadius: radii.photo, overflow: 'hidden', backgroundColor: light.surfaceTint },
  evidenceCaption: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  glyphs: { flexDirection: 'row', gap: 4 },
  sheet: { gap: 16 },
  sheetRow: { gap: 6 },
  sheetPair: { flexDirection: 'row', gap: 8 },
  thumbCell: { flex: 1, gap: 4 },
  thumb: { aspectRatio: 4 / 3, borderRadius: radii.photo, overflow: 'hidden', backgroundColor: light.surfaceTint },
  thumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
