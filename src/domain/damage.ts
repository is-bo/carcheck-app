/**
 * Damage labels and numbering rules (DECISIONS: damage markers). Pure.
 *
 * Pre-existing damage is lettered per rental (A, B, C…, Z, AA…); new and uncertain damage share
 * one numeric sequence per rental. The label never depends on colour; it prints in B/W.
 */
import type { DamageSeverity, DamageStatus, DamageType } from './types';

export type DamageSequence = 'letters' | 'numbers';

export function damageSequence(status: DamageStatus): DamageSequence {
  return status === 'pre_existing' ? 'letters' : 'numbers';
}

/** 1 -> "A", 26 -> "Z", 27 -> "AA" (spreadsheet columns). */
export function damageLetter(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid damage letter index ${n}`);
  let out = '';
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

/** The badge text: "A" for pre-existing, "3" for new/uncertain. */
export function damageLabel(d: { status: DamageStatus; number: number }): string {
  return damageSequence(d.status) === 'letters' ? damageLetter(d.number) : String(d.number);
}

export const DAMAGE_STATUS_LABELS: Record<DamageStatus, string> = {
  pre_existing: 'Existing',
  new: 'New',
  uncertain: 'Uncertain',
};

/** "Existing A", "New 2", "Uncertain 3". */
export function damageCaption(d: { status: DamageStatus; number: number }): string {
  return `${DAMAGE_STATUS_LABELS[d.status]} ${damageLabel(d)}`;
}

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  scratch: 'Scratch',
  dent: 'Dent',
  crack: 'Crack',
  chip: 'Chip',
  scuff: 'Scuff',
  broken: 'Broken',
  missing: 'Missing',
  other: 'Other',
};

export const DAMAGE_SEVERITY_LABELS: Record<DamageSeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
};

/** "Scratch" or "Damage (type not set)". */
export function damageTypeLabel(type: DamageType | null): string {
  return type ? DAMAGE_TYPE_LABELS[type] : 'Damage (type not set)';
}

export interface NumberedRow {
  id: string;
  number: number;
  /** Locked rows keep their number (signed pick-up, completed return). */
  locked: boolean;
}

/**
 * Compacts one sequence after a delete or a status change: editable rows close the gaps, locked
 * rows never move. Numbers only ever decrease, so no row is assigned a number a later row holds.
 * Returns only the rows whose number changes.
 */
export function compactSequence(rows: readonly NumberedRow[]): { id: string; number: number }[] {
  const sorted = [...rows].sort((a, b) => a.number - b.number);
  const changes: { id: string; number: number }[] = [];
  let next = 1;
  for (const row of sorted) {
    if (row.locked) {
      next = Math.max(next, row.number + 1);
      continue;
    }
    if (row.number !== next) changes.push({ id: row.id, number: next });
    next += 1;
  }
  return changes;
}

/** Next number in a sequence: max + 1. */
export function nextSequenceNumber(numbers: readonly number[]): number {
  return numbers.reduce((max, n) => Math.max(max, n), 0) + 1;
}
