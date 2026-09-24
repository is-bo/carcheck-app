/**
 * Deterministic, locale-independent formatting for printed documents.
 *
 * Times are printed in the device's local time at the moment of the event, so every
 * timestamp is paired with a UTC offset in minutes EAST of UTC (UTC+02:00 -> 120, i.e.
 * `-new Date().getTimezoneOffset()`). The same input always prints the same text, which keeps
 * generated documents reproducible and testable.
 */
import type {
  AngleKey,
  DamageSeverity,
  DamageStatus,
  DamageType,
  DistanceUnit,
  EpochMs,
  FuelEighths,
  SkipReason,
} from '@/domain/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function localParts(ms: EpochMs, tzOffsetMin: number) {
  const d = new Date(ms + tzOffsetMin * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** "24 Sep 2026" */
export function formatDate(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "24 Sep 2026, 17:05" */
export function formatDateTime(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${p.day} ${MONTHS[p.month]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** "UTC+02:00", "UTC-05:30", "UTC" */
export function formatUtcOffset(tzOffsetMin: number): string {
  if (tzOffsetMin === 0) return 'UTC';
  const sign = tzOffsetMin > 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMin);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** "24 Sep 2026, 17:05:32 (UTC+02:00)": used wherever a timestamp is evidence (signatures). */
export function formatTimestampWithZone(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${formatDateTime(ms, tzOffsetMin)}:${pad2(p.second)} (${formatUtcOffset(tzOffsetMin)})`;
}

/** Edge-code form, "24.09.2026 17:05" (uppercased by CSS, figures tabular). */
export function formatEdgeCodeTime(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${pad2(p.day)}.${pad2(p.month + 1)}.${p.year} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Digits grouped with a narrow no-break space ("12 345"), readable in any locale. */
export function formatInteger(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatMileage(value: number | null, unit: DistanceUnit): string | null {
  return value === null ? null : `${formatInteger(value)} ${unit}`;
}

const FUEL_NAMES: Record<number, string> = { 0: 'Empty', 2: '¼', 4: '½', 6: '¾', 8: 'Full' };

export function formatFuel(eighths: FuelEighths | null): string | null {
  if (eighths === null) return null;
  const clamped = Math.max(0, Math.min(8, Math.round(eighths)));
  return FUEL_NAMES[clamped] ?? `${clamped}/8`;
}

/** Existing damage is lettered A, B, … Z, AA, AB …; new and uncertain share a number sequence. */
export function damageMark(status: DamageStatus, number: number): string {
  if (status === 'pre_existing') return toLetters(number);
  return status === 'uncertain' ? `${number}?` : String(number);
}

function toLetters(n: number): string {
  let value = Math.max(1, Math.floor(n));
  let out = '';
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

export const DAMAGE_STATUS_WORD: Record<DamageStatus, string> = {
  pre_existing: 'Existing',
  new: 'New',
  uncertain: 'Uncertain',
};

/** "New 1", "Uncertain 2?", "Existing A" */
export function damageTitle(status: DamageStatus, number: number): string {
  return `${DAMAGE_STATUS_WORD[status]} ${damageMark(status, number)}`;
}

const TYPE_LABEL: Record<DamageType, string> = {
  scratch: 'Scratch',
  dent: 'Dent',
  crack: 'Crack',
  chip: 'Chip',
  scuff: 'Scuff',
  broken: 'Broken',
  missing: 'Missing',
  other: 'Other damage',
};

export function damageTypeLabel(type: DamageType | null): string {
  return type ? TYPE_LABEL[type] : 'Damage (type not set)';
}

const SEVERITY_LABEL: Record<DamageSeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
};

export function severityLabel(severity: DamageSeverity | null): string | null {
  return severity ? SEVERITY_LABEL[severity] : null;
}

/** "Dent, rear bumper" */
export function damageDescription(type: DamageType | null, locationLabel: string | null): string {
  const location = locationLabel?.trim();
  return location ? `${damageTypeLabel(type)}, ${location}` : damageTypeLabel(type);
}

const SKIP_LABEL: Record<SkipReason, string> = {
  blocked: 'Blocked',
  too_dark: 'Too dark',
  other: 'Not taken',
};

export function skipReasonLabel(reason: SkipReason): string {
  return SKIP_LABEL[reason];
}

/** Fallback label for an angle key when no catalog label was supplied ("front_left" -> "Front left"). */
export function humanizeAngleKey(key: AngleKey): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "3f9a 1c2b 77d0 e41d": the first 64 bits of a SHA-256, grouped for reading aloud. */
export function shortHash(sha256Hex: string): string {
  const head = sha256Hex.toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 16);
  return head.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Joins the parts that have text: ["Renault", null, "Clio"] -> "Renault · Clio". */
export function joinNonEmpty(parts: (string | null | undefined)[], separator = ' · '): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(separator);
}
