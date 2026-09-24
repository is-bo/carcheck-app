/**
 * Display formatting for dates, mileage, plates, sizes and marker labels.
 *
 * Locale-aware through Intl only (Hermes ships DateTimeFormat and NumberFormat, but not
 * RelativeTimeFormat or PluralRules, so relative words and plurals come from `formatStrings`).
 * Pass `locale` in tests; the app leaves it undefined to follow the device.
 * Every user-facing word lives in `formatStrings` so it can move into an i18n catalogue later.
 */
import type { DamageStatus, DistanceUnit } from '@/domain/types';

export const formatStrings = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  bytes: ['B', 'KB', 'MB', 'GB', 'TB'] as const,
};

type DateInput = number | Date;
type Locale = string | undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat>();

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale ?? ''}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

function numberFormatter(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale ?? ''}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key) as Intl.NumberFormat | undefined;
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

const toDate = (v: DateInput) => (v instanceof Date ? v : new Date(v));

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local calendar days from `now` to `v` (negative = past). DST-safe. */
export function calendarDayOffset(v: DateInput, now: DateInput = Date.now()): number {
  return Math.round((startOfLocalDay(toDate(v)) - startOfLocalDay(toDate(now))) / DAY_MS);
}

/** "17:05" (or "5:05 PM" where the locale uses a 12-hour clock). */
export function formatTime(v: DateInput, locale?: Locale): string {
  return dateFormatter(locale, { hour: '2-digit', minute: '2-digit' }).format(toDate(v));
}

/** "Thu 24 Sep". Adds the year when it is not the current one. */
export function formatDate(v: DateInput, locale?: Locale, now: DateInput = Date.now()): string {
  const d = toDate(v);
  const sameYear = d.getFullYear() === toDate(now).getFullYear();
  return dateFormatter(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** "Thursday 24 September 2026": printed under a signature, on documents. */
export function formatDateLong(v: DateInput, locale?: Locale): string {
  return dateFormatter(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(v));
}

/** "Thu 24 Sep, 10:30". */
export function formatDateTime(v: DateInput, locale?: Locale, now: DateInput = Date.now()): string {
  return `${formatDate(v, locale, now)}, ${formatTime(v, locale)}`;
}

/**
 * Relative where it helps (UX_FLOWS §11): "Today 17:40", "Tomorrow 09:00", "Yesterday 10:00",
 * weekday within the coming week ("Thu 18:00"), otherwise "Sun 27 Sep, 10:00".
 */
export function formatRelativeDateTime(v: DateInput, now: DateInput = Date.now(), locale?: Locale): string {
  const offset = calendarDayOffset(v, now);
  const time = formatTime(v, locale);
  if (offset === 0) return `${formatStrings.today} ${time}`;
  if (offset === 1) return `${formatStrings.tomorrow} ${time}`;
  if (offset === -1) return `${formatStrings.yesterday} ${time}`;
  if (offset > 1 && offset < 7) {
    return `${dateFormatter(locale, { weekday: 'short' }).format(toDate(v))} ${time}`;
  }
  return formatDateTime(v, locale, now);
}

/** Edge-code timestamp under a photo: "24 Sep 2026 10:04" (the code style uppercases it). */
export function formatEdgeTimestamp(v: DateInput, locale?: Locale): string {
  const d = toDate(v);
  const date = dateFormatter(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  return `${date} ${formatTime(d, locale)}`;
}

export function formatNumber(value: number, locale?: Locale): string {
  return numberFormatter(locale, { maximumFractionDigits: 0 }).format(value);
}

/** "48,213 km" / "48 213 km" per locale. Rounds to whole units. */
export function formatMileage(value: number | null | undefined, unit: DistanceUnit, locale?: Locale): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${formatNumber(Math.round(value), locale)} ${unit}`;
}

/** "1.2 GB", "320 MB". SI units, matching how Android and iOS report storage. */
export function formatFileSize(bytes: number, locale?: Locale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < formatStrings.bytes.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const n = numberFormatter(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
  return `${n} ${formatStrings.bytes[unit]}`;
}

/** Plate as shown in the plate frame: trimmed, upper-case, single spaces. Keeps the typed separators. */
export function formatPlate(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Plate without separators, for matching "ab 123-cd" against "AB-123-CD". Script-agnostic. */
export function normalizePlate(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[\s\-_.·/|]/g, '');
}

/**
 * Badge label for the n-th mark (1-based) of a status sequence (DECISIONS.md): pre-existing
 * damage is lettered A…Z, AA…; new and uncertain share one number sequence, uncertain adds "?".
 */
export function markerLabel(status: DamageStatus, ordinal: number): string {
  const n = Math.max(1, Math.floor(ordinal));
  if (status === 'pre_existing') {
    let s = '';
    let k = n;
    while (k > 0) {
      const r = (k - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      k = Math.floor((k - 1) / 26);
    }
    return s;
  }
  return status === 'uncertain' ? `${n}?` : String(n);
}

/** English one/other. `{n}` in the chosen form is replaced by the number. */
export function plural(n: number, one: string, other: string): string {
  return (n === 1 ? one : other).replace('{n}', String(n));
}
