/**
 * Customer hand-off copy (UX §2.5, DESIGN "Customer hand-off mode"): polite second person, no
 * internal terms. Pure.
 */
import type { VehicleSnapshot } from '@/domain/types';

/** "Tomás" from "Tomás Ferreira"; the whole name when it is one word; null when blank. */
export function firstName(fullName: string | null | undefined): string | null {
  const t = (fullName ?? '').trim();
  if (!t) return null;
  return t.split(/\s+/)[0];
}

/** "Peugeot 208, 12-BN-88" (or just the plate). */
export function vehicleLine(v: VehicleSnapshot | null): string {
  if (!v) return 'the vehicle';
  const name = [v.make, v.model].filter(Boolean).join(' ');
  return name ? `${name}, ${v.plate}` : v.plate;
}

/** One-sentence recap above the signature pad. */
export function signingRecap(v: VehicleSnapshot | null, existingDamage: number): string {
  const what = `You are signing the rental agreement for the ${vehicleLine(v)}`;
  if (existingDamage === 0) return `${what}. No existing damage was recorded.`;
  return `${what}, including ${existingDamage} existing ${existingDamage === 1 ? 'damage' : 'damages'}.`;
}

export function thankYouTitle(fullName: string | null | undefined): string {
  const name = firstName(fullName);
  return name ? `Thank you, ${name}. You’re all set.` : 'Thank you. You’re all set.';
}

/** Monogram for agencies without a logo: first letter of the first word. */
export function agencyMonogram(name: string): string {
  const t = name.trim();
  return t ? t[0].toUpperCase() : '·';
}
