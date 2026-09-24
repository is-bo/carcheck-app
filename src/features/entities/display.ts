/**
 * Pure display strings for the three tab lists and their detail screens. Kept out of the screen
 * files so the shape of a row is testable without React.
 */
import type { CustomerListItem, Rental, RentalListItem, ResumeStep, VehicleListItem } from '@/domain/types';
// Import the pure formatter module directly, not the '@/ui' barrel: that barrel pulls in
// Reanimated-backed components, which have no place in a file with no React dependency.
import { formatMileage, formatRelativeDateTime, formatTime, plural } from '@/ui/format';

// ---------------------------------------------------------------------------------------------
// Rentals home

/** "Renault Clio" from the rental's own vehicle snapshot, or null before a vehicle is chosen. */
export function vehicleModelLine(rental: Rental): string | null {
  if (!rental.vehicle) return null;
  const { make, model } = rental.vehicle;
  return [make, model].filter(Boolean).join(' ') || null;
}

/** "Renault Clio · João Oliveira", degrading gracefully while the draft is still being filled in. */
export function rentalSubtitle(rental: Rental): string {
  const model = vehicleModelLine(rental);
  const name = rental.customer.fullName;
  if (model && name) return `${model} · ${name}`;
  return model ?? name ?? 'New rental';
}

const RESUME_STEP_LABELS: Record<ResumeStep, string> = {
  vehicle: 'Choose a vehicle',
  customer: 'Add the customer',
  capture: 'Inspection',
  condition: 'Inspection',
  details: 'Details',
  contract: 'Review the contract',
  sign: 'Ready to sign',
  return_capture: 'Inspection',
  return_compare: 'Comparing photos',
  return_details: 'Return details',
};

export interface UnfinishedMeta {
  /** Present for capture-stage steps: render ProgressTicks + "Inspection {done} of {total}". */
  progress?: { done: number; total: number };
  text: string;
}

/** What the Unfinished row's third line says, per UX_FLOWS §1/§2 ("Inspection 5 of 8"). */
export function unfinishedMeta(item: RentalListItem): UnfinishedMeta {
  const step = item.rental.resumeStep;
  if (item.rental.status === 'active' && item.derived.needsSignature) return { text: 'Needs signature' };
  if (step === 'capture' || step === 'condition') {
    return { progress: item.beforeProgress, text: `Inspection ${item.beforeProgress.done} of ${item.beforeProgress.total}` };
  }
  if (step === 'return_capture' && item.afterProgress) {
    return { progress: item.afterProgress, text: `Inspection ${item.afterProgress.done} of ${item.afterProgress.total}` };
  }
  return { text: (step && RESUME_STEP_LABELS[step]) ?? 'Continue' };
}

export interface DueBackMeta {
  overdue: boolean;
  text: string;
}

/** "Overdue · was due 11:30" (UX_FLOWS §1/§11) or the relative due date/time. */
export function dueBackMeta(item: RentalListItem, now: number): DueBackMeta {
  const due = item.rental.expectedReturnAt;
  if (item.derived.overdue && due !== null) {
    return { overdue: true, text: `Overdue · was due ${formatTime(due)}` };
  }
  return { overdue: false, text: due !== null ? formatRelativeDateTime(due, now) : 'No return date set' };
}

/** "Returned 15 Mar 17:52 · 3 new damages" (rental detail header, completed). */
export function returnedStatusLine(item: RentalListItem, locale?: string): string {
  const at = item.rental.returnCompletedAt;
  const when = at !== null ? formatRelativeDateTime(at, Date.now(), locale) : 'Returned';
  const damageWord = plural(item.newDamageCount, '{n} new damage', '{n} new damages');
  return item.newDamageCount > 0 ? `Returned ${when} · ${damageWord}` : `Returned ${when} · no new damage`;
}

/** "Out since Tue 09:14 · due Thu 18:00" (rental detail header, active). */
export function outStatusLine(item: RentalListItem, locale?: string): string {
  const since = item.rental.activatedAt;
  const due = item.rental.expectedReturnAt;
  const sincePart = since !== null ? `Out since ${formatRelativeDateTime(since, Date.now(), locale)}` : 'Out';
  if (due === null) return sincePart;
  return `${sincePart} · ${item.derived.overdue ? 'overdue, was due' : 'due'} ${formatRelativeDateTime(due, Date.now(), locale)}`;
}

// ---------------------------------------------------------------------------------------------
// Vehicles

/** "Out · A. Chen · due Thu" / "Available". */
export function vehicleStatusLine(item: VehicleListItem, locale?: string): string {
  if (!item.out) return 'Available';
  const who = item.out.customerName ? ` · ${item.out.customerName}` : '';
  const due = item.out.expectedReturnAt !== null ? ` · due ${formatRelativeDateTime(item.out.expectedReturnAt, Date.now(), locale)}` : '';
  return `Out${who}${due}`;
}

/** "Renault · Clio · 2019" from whichever fields are set. */
export function vehicleMakeModelYear(item: VehicleListItem): string {
  const { make, model, year } = item.vehicle;
  // "Renault Clio · 2019": make and model read as one name.
  const name = [make, model].filter(Boolean).join(' ');
  return [name, year ? String(year) : null].filter(Boolean).join(' · ') || 'No make or model yet';
}

export function vehicleMileageLine(mileage: number | null, unit: 'km' | 'mi'): string | null {
  return mileage === null ? null : `${formatMileage(mileage, unit)} on the clock`;
}

const QUARTER_LABELS = ['E', '¼', '½', '¾', 'F'];

/** UX_FLOWS' 5-segment fuel display (E ¼ ½ ¾ F), rounded from the stored eighths. */
export function fuelLabel(eighths: number | null): string | null {
  if (eighths === null) return null;
  return QUARTER_LABELS[Math.min(4, Math.max(0, Math.round(eighths / 2)))];
}

// ---------------------------------------------------------------------------------------------
// Customers

/** "3 rentals · 2 documents" / "No rentals yet". */
export function customerSummaryLine(item: CustomerListItem): string {
  const rentals = item.rentalCount > 0 ? plural(item.rentalCount, '{n} rental', '{n} rentals') : 'No rentals yet';
  const docs = item.documentCount > 0 ? ` · ${plural(item.documentCount, '{n} document', '{n} documents')}` : '';
  return `${rentals}${docs}`;
}
