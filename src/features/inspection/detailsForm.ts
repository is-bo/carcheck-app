/**
 * Pure helpers of the Details step (UX §2.4): fuel segments, expected-return chips, mileage.
 */
import type { EpochMs, FuelEighths } from '@/domain/types';

/** Five segments E ¼ ½ ¾ F, stored as eighths (0, 2, 4, 6, 8). */
export const FUEL_OPTIONS = [
  { value: '0', label: 'E', accessibilityLabel: 'Empty' },
  { value: '2', label: '¼', accessibilityLabel: 'Quarter' },
  { value: '4', label: '½', accessibilityLabel: 'Half' },
  { value: '6', label: '¾', accessibilityLabel: 'Three quarters' },
  { value: '8', label: 'F', accessibilityLabel: 'Full' },
] as const;

export type FuelValue = (typeof FUEL_OPTIONS)[number]['value'];

/** Nearest segment of a stored value (older data may hold odd eighths). */
export function fuelSegment(eighths: FuelEighths | null): FuelValue | null {
  if (eighths === null || !Number.isFinite(eighths)) return null;
  const q = Math.min(8, Math.max(0, Math.round(eighths / 2) * 2));
  return String(q) as FuelValue;
}

export const RETURN_PRESETS = [
  { value: '1d', label: 'Tomorrow', days: 1 },
  { value: '2d', label: '+2 days', days: 2 },
  { value: '3d', label: '+3 days', days: 3 },
  { value: '1w', label: '+1 week', days: 7 },
] as const;

export type ReturnPreset = (typeof RETURN_PRESETS)[number]['value'];

/** `days` calendar days after `now`, at the same local time (to the minute). DST-safe. */
export function returnAtPreset(preset: ReturnPreset, now: EpochMs): EpochMs {
  const days = RETURN_PRESETS.find((p) => p.value === preset)?.days ?? 1;
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function dayStart(ms: EpochMs): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The chip that produced `at` (same calendar day as the preset from `now`), if any. */
export function presetOf(at: EpochMs | null, now: EpochMs): ReturnPreset | null {
  if (at === null) return null;
  return RETURN_PRESETS.find((p) => dayStart(returnAtPreset(p.value, now)) === dayStart(at))?.value ?? null;
}

/** Day stepper of the "Pick…" sheet: same time, `delta` days later/earlier. */
export function shiftDays(at: EpochMs, delta: number): EpochMs {
  const d = new Date(at);
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

/** Time stepper: moves by `stepMin` minutes and snaps to the step grid. */
export function shiftTime(at: EpochMs, deltaSteps: number, stepMin = 15): EpochMs {
  const d = new Date(at);
  d.setSeconds(0, 0);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const snapped = deltaSteps > 0 ? Math.floor(minutes / stepMin) * stepMin : Math.ceil(minutes / stepMin) * stepMin;
  d.setHours(0, snapped + deltaSteps * stepMin);
  return d.getTime();
}

/** Mileage as typed: digits only (thousand separators ignored). '' = not entered. */
export function parseMileage(text: string): number | null | 'invalid' {
  const t = text.replace(/[\s.,'’]/g, '');
  if (t === '') return null;
  if (!/^\d{1,9}$/.test(t)) return 'invalid';
  return Number(t);
}
