/**
 * Pieces of the return capture screen: the rail accessory (orbit + Skip), the skip reasons
 * sheet, the angle picker and the last-shot preview (Retake / Keep).
 */
import { Image } from 'expo-image';
import { ArrowRight, SkipForward } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { PairKey, SkipReason } from '@/domain/types';
import {
  BottomSheet,
  Button,
  CarDiagram,
  ChipGroup,
  ListRow,
  Surface,
  Text,
  type AngleState,
  type ExteriorAngleKey,
} from '@/ui';
import { layout, overlay, radii } from '@/ui/theme/tokens';

import type { CaptureTarget } from '../returnPlan';
import { isExterior } from '../returnPlan';

export function orbitStates(targets: readonly CaptureTarget[]): Partial<Record<ExteriorAngleKey, AngleState>> {
  const out: Partial<Record<ExteriorAngleKey, AngleState>> = {};
  for (const t of targets) {
    if (!isExterior(t)) continue;
    out[t.angleKey as ExteriorAngleKey] = t.state === 'done' ? 'done' : t.state === 'skipped' ? 'skipped' : 'pending';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

export interface CaptureRailProps {
  targets: readonly CaptureTarget[];
  current: CaptureTarget | null;
  onOpenPicker: () => void;
  onSkip: () => void;
  skipDisabled?: boolean;
}

/** Left rail (landscape) / bottom-left slot (portrait): the orbit opens the picker; Skip. */
export function CaptureRail({ targets, current, onOpenPicker, onSkip, skipDisabled }: CaptureRailProps) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const currentExterior = current && isExterior(current) ? (current.angleKey as ExteriorAngleKey) : null;
  return (
    <View style={styles.rail}>
      <CarDiagram states={orbitStates(targets)} current={currentExterior} size={landscape ? 80 : 60} onPress={onOpenPicker} />
      <Button label="Skip" variant="quiet" size="small" icon={SkipForward} onPress={onSkip} disabled={skipDisabled} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

const SKIP_OPTIONS: readonly { value: SkipReason; label: string }[] = [
  { value: 'blocked', label: 'Blocked' },
  { value: 'too_dark', label: 'Too dark' },
  { value: 'other', label: 'Other' },
];

export interface SkipSheetProps {
  open: boolean;
  label: string;
  onSkip: (reason: SkipReason | null) => void;
  onClose: () => void;
}

/** One row of reason chips plus a plain Skip (UX §3: the reason is optional, no dialog). */
export function SkipSheet({ open, label, onSkip, onClose }: SkipSheetProps) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[248]}
      accessibilityLabel={`Skip ${label}`}
      header={<Text variant="titleL">Skip {label.toLowerCase()}?</Text>}
      footer={
        <Button
          label="Skip"
          fullWidth
          onPress={() => {
            onSkip(reason);
            setReason(null);
          }}
        />
      }
    >
      <View style={styles.sheetBody}>
        <Text variant="bodySmall" tone="secondary">
          Reason (optional). It shows in the report.
        </Text>
        <ChipGroup accessibilityLabel="Why it was skipped" options={SKIP_OPTIONS} value={reason} onChange={setReason} columns={3} />
      </View>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------------------------

export interface AnglePickerSheetProps {
  open: boolean;
  targets: readonly CaptureTarget[];
  current: CaptureTarget | null;
  onPick: (key: PairKey) => void;
  /** Present once there is at least one outside photo. */
  onCompare?: () => void;
  onClose: () => void;
}

const STATE_WORD = { done: 'Taken', skipped: 'Skipped', pending: 'Not taken' } as const;

/** Jump to any angle (car against a wall: start at the rear), or move on to Compare. */
export function AnglePickerSheet({ open, targets, current, onPick, onCompare, onClose }: AnglePickerSheetProps) {
  const others = targets.filter((t) => !isExterior(t));
  const currentExterior = current && isExterior(current) ? (current.angleKey as ExteriorAngleKey) : null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={['75%']}
      accessibilityLabel="Choose an angle"
      header={<Text variant="titleL">Choose an angle</Text>}
      footer={onCompare ? <Button label="Compare photos" icon={ArrowRight} iconPosition="trailing" fullWidth onPress={onCompare} /> : undefined}
    >
      <ScrollView>
        <View style={styles.picker}>
          <CarDiagram
            states={orbitStates(targets)}
            current={currentExterior}
            size={240}
            onSelectAngle={(k) => onPick({ angleKey: k, slot: 1 })}
          />
        </View>
        {others.map((t) => (
          <ListRow
            key={`${t.angleKey}#${t.slot}`}
            title={t.label}
            subtitle={STATE_WORD[t.state]}
            chevron
            onPress={() => onPick(t)}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------------------------

export interface ShotPreviewProps {
  uri: string | null;
  label: string;
  /** Null when the photo can no longer be replaced (completed return). */
  onRetake: (() => void) | null;
  onClose: () => void;
}

/** Tapping the last-shot thumbnail: the photo, Retake and Keep. No per-photo confirm otherwise. */
export function ShotPreview({ uri, label, onRetake, onClose }: ShotPreviewProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={uri !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <Surface tone="rebate" style={[styles.preview, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={styles.previewPhoto}>
          {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
          <View style={styles.previewTag}>
            <Text variant="code" color={overlay.tagText}>
              {label} · Return
            </Text>
          </View>
        </View>
        <View style={styles.previewActions}>
          {onRetake ? <Button label="Retake" variant="secondary" onPress={onRetake} style={styles.flex} /> : null}
          <Button label="Keep" onPress={onClose} style={styles.flex} />
        </View>
      </Surface>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rail: { alignItems: 'center', gap: 4 },
  sheetBody: { paddingHorizontal: layout.screenGutter, paddingTop: 8, gap: 12 },
  picker: { alignItems: 'center', paddingVertical: 8 },
  preview: { flex: 1 },
  previewPhoto: { flex: 1 },
  previewTag: {
    position: 'absolute',
    left: 12,
    top: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.photo,
    backgroundColor: overlay.tagBackground,
  },
  previewActions: { flexDirection: 'row', gap: 12, padding: layout.screenGutter },
  flex: { flex: 1 },
});
