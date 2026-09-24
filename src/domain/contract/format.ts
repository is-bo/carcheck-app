/**
 * Deterministic, locale-independent text for contract variables. The rendered contract is
 * frozen at signing, so the same input must always produce the same text.
 * Times pair epoch ms with a UTC offset in minutes EAST of UTC (UTC+02:00 -> 120).
 */
import type { DistanceUnit, EpochMs, FuelEighths } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = (n: number) => String(n).padStart(2, '0');

function localParts(ms: EpochMs, tzOffsetMin: number) {
  const d = new Date(ms + tzOffsetMin * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** "24 Sep 2026" */
export function formatContractDate(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${p.day} ${MONTHS[p.month]} ${p.year}`;
}

/** "24 Sep 2026, 17:05" */
export function formatContractDateTime(ms: EpochMs, tzOffsetMin: number): string {
  const p = localParts(ms, tzOffsetMin);
  return `${formatContractDate(ms, tzOffsetMin)}, ${pad2(p.hour)}:${pad2(p.minute)}`;
}

const FUEL_NAMES: Record<number, string> = { 0: 'Empty', 2: '¼', 4: '½', 6: '¾', 8: 'Full' };

export function formatFuel(eighths: FuelEighths): string {
  const clamped = Math.max(0, Math.min(8, Math.round(eighths)));
  return FUEL_NAMES[clamped] ?? `${clamped}/8`;
}

/** "12 345 km" (narrow no-break space groups digits in any locale). */
export function formatDistance(value: number, unit: DistanceUnit): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${unit}`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Joins the parts that have text: ["Renault", null, "Clio"] -> "Renault Clio". */
export function joinText(parts: readonly (string | number | null | undefined)[], separator = ' '): string | null {
  const text = parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter((p) => p.length > 0)
    .join(separator);
  return text.length > 0 ? text : null;
}
