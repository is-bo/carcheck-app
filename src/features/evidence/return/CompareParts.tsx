/**
 * Pieces of the comparison screen: the Markers / Existing toggles, the "On this angle" rows, the
 * angle list (landscape ⋮ picker) and the panel shown when one side of a pair is missing.
 */
import { Check, ChevronRight, Camera, SkipForward } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';

import { damageCaption, damageTypeLabel } from '@/domain/damage';
import type { AnglePair, Damage } from '@/domain/types';
import { skipReasonLabel } from '@/documents/format';
import { markerLabel } from '@/ui/format';
import { BottomSheet, Button, Icon, ListRow, MarkerBadge, Text, Touchable } from '@/ui';
import { layout, lines, radii, rebate } from '@/ui/theme/tokens';

import { compareStatus, hasNewDamage } from '../returnPlan';

// ---------------------------------------------------------------------------------------------

export interface ToggleChipProps {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}

/** 40 dp rebate toggle with a check when on (mockup .tgl); 48 dp touch target. */
export function ToggleChip({ label, on, onPress, accessibilityHint }: ToggleChipProps) {
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={{ top: 4, bottom: 4 }}
      focusRadius={radii.md}
      style={[styles.toggle, on && styles.toggleOn]}
    >
      {on ? <Icon icon={Check} size={18} color={rebate.text} /> : null}
      <Text variant="button" tone={on ? 'primary' : 'secondary'}>
        {label}
      </Text>
    </Touchable>
  );
}

// ---------------------------------------------------------------------------------------------

export interface DamageRowsProps {
  damages: readonly Damage[];
  /** Return marks open their sheet; pick-up marks are context only. */
  onOpen?: (damage: Damage) => void;
  maxHeight?: number;
}

function rowTitle(d: Damage): string {
  const where = d.locationLabel ? `, ${d.locationLabel}` : '';
  return `${damageCaption(d)} · ${damageTypeLabel(d.type)}${where}`;
}

/** "On this angle": glyph, "New 1 · Dent, left rear door", chevron for editable marks. */
export function DamageRows({ damages, onOpen, maxHeight }: DamageRowsProps) {
  if (damages.length === 0) return null;
  return (
    <View>
      <Text variant="labelSmall" tone="secondary" style={styles.rowsHeader}>
        On this angle
      </Text>
      <ScrollView style={maxHeight ? { maxHeight } : undefined} nestedScrollEnabled>
        {damages.map((d) => {
          const editable = !!onOpen && d.foundPhase === 'after';
          return (
            <ListRow
              key={d.id}
              leading={<MarkerBadge status={d.status} label={markerLabel(d.status, d.number)} size={24} accessible={false} />}
              title={rowTitle(d)}
              subtitle={d.foundPhase === 'before' ? 'Recorded at pick-up' : undefined}
              trailing={editable ? <Icon icon={ChevronRight} size={20} color={rebate.textSecondary} /> : undefined}
              onPress={editable ? () => onOpen?.(d) : undefined}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

export interface AngleListSheetProps {
  open: boolean;
  pairs: readonly AnglePair[];
  index: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

const STATUS_WORD = {
  reviewed: 'Viewed',
  unreviewed: 'Not viewed yet',
  skipped: 'Skipped at return',
  missing: 'Not photographed at return',
  optional: 'Not photographed at return',
} as const;

/** Every angle with its state: the filmstrip's place in landscape (UX §5). */
export function AngleListSheet({ open, pairs, index, onSelect, onClose }: AngleListSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={['70%']}
      accessibilityLabel="Angles"
      header={<Text variant="titleL">Angles</Text>}
    >
      <ScrollView>
        {pairs.map((p, i) => {
          const damaged = hasNewDamage(p);
          return (
            <ListRow
              key={`${p.angleKey}#${p.slot}`}
              title={`${i + 1}  ${p.label}${i === index ? ' · current' : ''}`}
              subtitle={damaged ? `${STATUS_WORD[compareStatus(p)]} · new damage` : STATUS_WORD[compareStatus(p)]}
              chevron
              onPress={() => {
                onClose();
                onSelect(i);
              }}
            />
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------------------------

export interface MissingSidePanelProps {
  pair: AnglePair;
  editable: boolean;
  onTakePhoto: () => void;
  onSkip: () => void;
}

/** In place of the comparison when the pair has no return photo. */
export function MissingSidePanel({ pair, editable, onTakePhoto, onSkip }: MissingSidePanelProps) {
  const skipped = pair.afterState?.skippedAt != null;
  const reason = pair.afterState?.skipReason;
  const title = skipped
    ? `Skipped at return${reason ? ` · ${skipReasonLabel(reason)}` : ''}`
    : 'Not photographed at return';
  return (
    <View style={styles.missing}>
      <Text variant="titleM">{title}</Text>
      <Text variant="body" tone="secondary">
        {pair.before
          ? 'The pick-up photo can only be compared once this angle is photographed at return.'
          : 'This angle has no photo from pick-up or return.'}
      </Text>
      {editable ? (
        <View style={styles.missingActions}>
          <Button label="Take photo" icon={Camera} onPress={onTakePhoto} />
          {!skipped ? <Button label="Skip" variant="secondary" icon={SkipForward} onPress={onSkip} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: radii.md,
    borderWidth: lines.control,
    borderColor: rebate.divider,
  },
  toggleOn: { backgroundColor: rebate.surfacePressed, borderColor: rebate.surfacePressed },
  rowsHeader: { paddingHorizontal: layout.screenGutter, paddingTop: 14, paddingBottom: 2 },
  missing: { flex: 1, justifyContent: 'center', gap: 8, paddingHorizontal: layout.screenGutter * 1.5 },
  missingActions: { flexDirection: 'row', gap: 12, marginTop: 12, flexWrap: 'wrap' },
});
