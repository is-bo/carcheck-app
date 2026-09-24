/**
 * The damage quick sheet (UX §4, mockup c-mark): type tiles, optional severity, + Note,
 * + Close-up photo, and in return mode the status chooser. Type is the only input that matters;
 * Done with nothing chosen saves "Damage (type not set)".
 *
 * Edits stay local until Done. Dismissing the sheet (swipe, Back, backdrop) also saves pending
 * edits before onClose, so nothing typed is lost.
 */
import { Image } from 'expo-image';
import { Camera, NotebookPen, Trash2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { DamageStatus } from '@/domain/types';
import {
  BottomSheet,
  Button,
  ChipGroup,
  IconButton,
  MarkerBadge,
  SegmentedControl,
  Text,
  TextField,
  Touchable,
} from '@/ui';
import { layout, markerGeometry, radii } from '@/ui/theme/tokens';

import {
  changedValues,
  cleanNote,
  DAMAGE_TYPE_OPTIONS,
  initialValues,
  previewBadgeLabel,
  RETURN_STATUS_OPTIONS,
  SEVERITY_OPTIONS,
  statusLine,
  type DamageSheetInitial,
  type DamageSheetMode,
  type DamageSheetValues,
} from './damageForm';

export type { DamageSheetInitial, DamageSheetMode, DamageSheetValues };

export interface DamageSheetProps {
  visible: boolean;
  /** 'pre_existing' = pick-up mark (always Existing); 'return' = status chooser New / Uncertain / Was there. */
  mode: DamageSheetMode;
  initial?: DamageSheetInitial;
  /** Current badge text of the mark ("A", "3"); the title reads "Damage A". */
  badgeLabel?: string;
  onSave: (values: DamageSheetValues) => void;
  /** Shows the trash button. The caller deletes and offers Undo (no dialog). */
  onDelete?: () => void;
  /** Shows "+ Close-up photo" (or "Replace close-up" once one is linked). */
  onAddCloseup?: () => void;
  onClose: () => void;
  /** Thumbnail of the linked close-up, if any. */
  closeupUri?: string | null;
  /** Locked evidence (signed pick-up, completed return): details only, no edits. */
  readOnly?: boolean;
  /** Why it is read-only, shown above the details. */
  readOnlyReason?: string;
}

/**
 * Compact on purpose (UX H4): the header, the status (return) and the type grid fit with Done,
 * severity / note / close-up scroll in below. The mark stays visible above the sheet, and with
 * no scrim its ring can still be dragged and resized while the sheet is open.
 */
const SHEET_HEIGHT = { pre_existing: 340, return: 420 } as const;
const NOTE_EXTRA = 64;
const READ_ONLY_HEIGHT = 340;

export function DamageSheet({
  visible,
  mode,
  initial,
  badgeLabel,
  onSave,
  onDelete,
  onAddCloseup,
  onClose,
  closeupUri,
  readOnly = false,
  readOnlyReason,
}: DamageSheetProps) {
  const [values, setValues] = useState<DamageSheetValues>(() => initialValues(mode, initial));
  const [noteOpen, setNoteOpen] = useState(!!initial?.note);
  const [start, setStart] = useState(values);

  // A new mark (or reopening one) resets the form to its stored values (render-time adjustment).
  const initialKey = visible
    ? `${mode}|${initial?.status ?? ''}|${initial?.type ?? ''}|${initial?.severity ?? ''}|${initial?.note ?? ''}|${badgeLabel ?? ''}`
    : null;
  const [formKey, setFormKey] = useState<string | null>(null);
  if (initialKey !== formKey) {
    setFormKey(initialKey);
    if (initialKey !== null) {
      const next = initialValues(mode, initial);
      setStart(next);
      setValues(next);
      setNoteOpen(!!next.note);
    }
  }

  const set = (patch: Partial<DamageSheetValues>) => setValues((v) => ({ ...v, ...patch }));
  const finalValues = (): DamageSheetValues => ({ ...values, note: cleanNote(values.note) });

  const done = () => {
    if (!readOnly) onSave(finalValues());
    onClose();
  };
  const dismiss = () => {
    if (!readOnly && Object.keys(changedValues(start, values)).length > 0) onSave(finalValues());
    onClose();
  };

  // Leaving the screen with the sheet open (Back in the top bar) still keeps what was chosen.
  const pendingSave = useRef<(() => void) | null>(null);
  useEffect(() => {
    pendingSave.current =
      visible && !readOnly && Object.keys(changedValues(start, values)).length > 0 ? () => onSave(finalValues()) : null;
  });
  useEffect(() => () => pendingSave.current?.(), []);

  const initialStatus = start.status;
  const shownLabel = previewBadgeLabel(initialStatus, values.status, badgeLabel);
  const titleLabel = (badgeLabel ?? '').replace('?', '');
  const title = titleLabel ? `Damage ${titleLabel}` : 'Damage';
  const height = readOnly ? READ_ONLY_HEIGHT : SHEET_HEIGHT[mode] + (noteOpen ? NOTE_EXTRA : 0);

  const header = (
    <View style={styles.header}>
      <MarkerBadge status={values.status} label={shownLabel} size={markerGeometry.badgeSizeCustomer} accessible={false} />
      <View style={styles.titles}>
        <Text variant="titleL" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <Text variant="subtitle" tone="secondary" numberOfLines={1}>
          {statusLine(mode, values.status)}
        </Text>
      </View>
      {onDelete && !readOnly ? (
        <IconButton icon={Trash2} accessibilityLabel={`Delete ${title.toLowerCase()}`} onPress={onDelete} />
      ) : null}
    </View>
  );

  return (
    <BottomSheet
      open={visible}
      onClose={dismiss}
      snapPoints={[height]}
      backdrop="none"
      header={header}
      accessibilityLabel={title}
      footer={<Button label="Done" onPress={done} fullWidth />}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {readOnly ? (
          <ReadOnlyDetails values={values} reason={readOnlyReason} closeupUri={closeupUri} />
        ) : (
          <>
            {mode === 'return' ? (
              <View style={styles.group}>
                <Text variant="labelSmall" tone="secondary">
                  Status
                </Text>
                <SegmentedControl
                  options={RETURN_STATUS_OPTIONS}
                  value={values.status}
                  onChange={(status: DamageStatus) => set({ status })}
                  accessibilityLabel="Damage status"
                />
              </View>
            ) : null}

            <ChipGroup
              options={DAMAGE_TYPE_OPTIONS}
              value={values.type}
              onChange={(type) => set({ type })}
              columns={4}
              accessibilityLabel="Damage type"
            />

            <View style={styles.group}>
              <Text variant="labelSmall" tone="secondary">
                Severity{' '}
                <Text variant="labelSmall" tone="tertiary">
                  (optional)
                </Text>
              </Text>
              <SegmentedControl
                options={SEVERITY_OPTIONS}
                value={values.severity}
                onChange={(severity) => set({ severity })}
                accessibilityLabel="Severity"
              />
            </View>

            {noteOpen ? (
              <View style={styles.group}>
                <TextField
                  label="Note"
                  value={values.note ?? ''}
                  onChangeText={(note) => set({ note })}
                  placeholder="e.g. below the door handle"
                  returnKeyType="done"
                  autoFocus={!values.note}
                  maxLength={200}
                />
              </View>
            ) : null}

            <View style={styles.quietRow}>
              {!noteOpen ? <Button label="Note" icon={NotebookPen} variant="quiet" onPress={() => setNoteOpen(true)} /> : null}
              {onAddCloseup ? (
                closeupUri ? (
                  <Touchable
                    onPress={onAddCloseup}
                    accessibilityRole="button"
                    accessibilityLabel="Close-up photo. Tap to replace it."
                    focusRadius={radii.photo}
                    style={styles.closeup}
                  >
                    <Image source={{ uri: closeupUri }} style={styles.closeupThumb} contentFit="cover" />
                    <Text variant="button" tone="accent">
                      Replace close-up
                    </Text>
                  </Touchable>
                ) : (
                  <Button label="Close-up photo" icon={Camera} variant="quiet" onPress={onAddCloseup} />
                )
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

function ReadOnlyDetails({
  values,
  reason,
  closeupUri,
}: {
  values: DamageSheetValues;
  reason?: string;
  closeupUri?: string | null;
}) {
  const type = DAMAGE_TYPE_OPTIONS.find((o) => o.value === values.type)?.label ?? 'Type not set';
  const severity = SEVERITY_OPTIONS.find((o) => o.value === values.severity)?.label ?? null;
  return (
    <View style={styles.readOnly}>
      {reason ? (
        <Text variant="bodySmall" tone="secondary">
          {reason}
        </Text>
      ) : null}
      <Text variant="bodyStrong">{[type, severity].filter(Boolean).join(' · ')}</Text>
      {values.note ? <Text variant="body">“{values.note}”</Text> : null}
      {closeupUri ? <Image source={{ uri: closeupUri }} style={styles.closeupLarge} contentFit="cover" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  titles: { flex: 1, minWidth: 0 },
  body: { paddingHorizontal: layout.screenGutter, paddingTop: 10, paddingBottom: 8, gap: 18 },
  group: { gap: 8 },
  quietRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: -12, marginTop: -6 },
  closeup: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 12 },
  closeupThumb: { width: 48, height: 36, borderRadius: radii.photo },
  closeupLarge: { width: 160, height: 120, borderRadius: radii.photo },
  readOnly: { gap: 10 },
});
