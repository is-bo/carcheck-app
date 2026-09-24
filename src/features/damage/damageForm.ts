/**
 * Pure helpers behind the damage quick sheet: options, copy, and what changed. No React.
 */
import { DAMAGE_SEVERITY_LABELS, DAMAGE_TYPE_LABELS, damageCaption, damageSequence, damageTypeLabel } from '@/domain/damage';
import type { Damage, DamageSeverity, DamageStatus, DamageType, Id } from '@/domain/types';
import { DAMAGE_TYPES } from '@/domain/types';

/** Pick-up sheet (always Existing) or return sheet (status chooser). */
export type DamageSheetMode = 'pre_existing' | 'return';

export interface DamageSheetValues {
  status: DamageStatus;
  type: DamageType | null;
  severity: DamageSeverity | null;
  note: string | null;
}

export interface DamageSheetInitial {
  status?: DamageStatus;
  type?: DamageType | null;
  severity?: DamageSeverity | null;
  note?: string | null;
  closeupPhotoId?: Id | null;
}

export const DAMAGE_TYPE_OPTIONS = DAMAGE_TYPES.map((value) => ({ value, label: DAMAGE_TYPE_LABELS[value] }));

export const SEVERITY_OPTIONS = (['minor', 'moderate', 'severe'] as const).map((value) => ({
  value,
  label: DAMAGE_SEVERITY_LABELS[value],
}));

/** Return marks: "Was there" turns the mark into pre-existing damage missed at pick-up (UX §4). */
export const RETURN_STATUS_OPTIONS: readonly { value: DamageStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'uncertain', label: 'Uncertain' },
  { value: 'pre_existing', label: 'Was there' },
];

export function initialValues(mode: DamageSheetMode, initial: DamageSheetInitial = {}): DamageSheetValues {
  return {
    status: mode === 'pre_existing' ? 'pre_existing' : (initial.status ?? 'new'),
    type: initial.type ?? null,
    severity: initial.severity ?? null,
    note: initial.note ?? null,
  };
}

/** One line under the sheet title. */
export function statusLine(mode: DamageSheetMode, status: DamageStatus): string {
  if (mode === 'pre_existing') return 'Existing · already there at pick-up';
  switch (status) {
    case 'new':
      return 'New damage';
    case 'uncertain':
      return 'Uncertain · not sure if new';
    case 'pre_existing':
      return 'Was there · missed at pick-up';
  }
}

/**
 * Badge text while the sheet is open. Switching between new and uncertain keeps the number;
 * "Was there" moves to the letter sequence, whose letter is only known once saved.
 */
export function previewBadgeLabel(initialStatus: DamageStatus, status: DamageStatus, badgeLabel: string | undefined): string {
  const base = (badgeLabel ?? '').replace('?', '');
  if (!base || damageSequence(initialStatus) !== damageSequence(status)) return '';
  return status === 'uncertain' ? `${base}?` : base;
}

/** Trimmed note, or null when blank (the repository never stores ''). */
export function cleanNote(note: string | null | undefined): string | null {
  const t = (note ?? '').trim();
  return t.length > 0 ? t : null;
}

/** Only the fields that differ from `before`; empty when nothing changed. */
export function changedValues(before: DamageSheetValues, after: DamageSheetValues): Partial<DamageSheetValues> {
  const out: Partial<DamageSheetValues> = {};
  if (before.status !== after.status) out.status = after.status;
  if (before.type !== after.type) out.type = after.type;
  if (before.severity !== after.severity) out.severity = after.severity;
  if (cleanNote(before.note) !== cleanNote(after.note)) out.note = cleanNote(after.note);
  return out;
}

/** "Existing A · Scratch" / "New 2 · Damage (type not set)". */
export function damageRowTitle(d: Pick<Damage, 'status' | 'number' | 'type'>): string {
  return `${damageCaption(d)} · ${damageTypeLabel(d.type)}`;
}

/** Second line of a damage row: severity and note, when there are any. */
export function damageRowDetail(d: Pick<Damage, 'severity' | 'note' | 'locationLabel'>): string | null {
  const parts = [d.locationLabel, d.severity ? DAMAGE_SEVERITY_LABELS[d.severity] : null, d.note ? `“${d.note}”` : null].filter(
    (p): p is string => !!p,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}
