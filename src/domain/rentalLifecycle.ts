/**
 * Rental state machine and step guards. Pure: the rentals repository gathers RentalFacts from
 * the DB and screens ask these functions what is allowed next.
 *
 * Statuses: draft -> active (signing) -> returned | cancelled. A completed return is reopened
 * with returnReopenedAt, never by changing the status back. The DB triggers enforce the same
 * rules (docs/DATA_MODEL.md §3); these functions let the UI explain them before a write fails.
 */
import {
  EXTERIOR_ANGLE_KEYS,
  type AngleKey,
  type EpochMs,
  type RentalDerivedState,
  type RentalStatus,
  type ResumeStep,
} from './types';

export const START_STEPS = ['vehicle', 'customer', 'inspect', 'details', 'sign'] as const;
export type StartStep = (typeof START_STEPS)[number];

/** Every guided exterior angle must be photographed or explicitly skipped before signing. */
export const REQUIRED_ANGLE_KEYS: readonly AngleKey[] = EXTERIOR_ANGLE_KEYS;

export interface InspectionFacts {
  /** Angle keys with a canonical photo in slot 1. */
  captured: readonly AngleKey[];
  /** Angle keys explicitly skipped in slot 1. */
  skipped: readonly AngleKey[];
}

export interface RentalFacts {
  status: RentalStatus;
  hasVehicle: boolean;
  customerName: string | null;
  /** A signed contract that is not voided exists. */
  hasValidContract: boolean;
  contractCount: number;
  before: InspectionFacts | null;
  after: InspectionFacts | null;
  returnReopenedAt: EpochMs | null;
  expectedReturnAt: EpochMs | null;
}

export const RENTAL_TRANSITIONS: Record<RentalStatus, readonly RentalStatus[]> = {
  draft: ['active'],
  active: ['returned', 'cancelled'],
  returned: [],
  cancelled: [],
};

export function canTransition(from: RentalStatus, to: RentalStatus): boolean {
  return RENTAL_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------------------------
// Inspections

export interface InspectionProgress {
  total: number;
  /** Required angles captured or skipped. */
  done: number;
  captured: number;
  skipped: number;
  /** Required angles neither captured nor skipped, in walk-around order. */
  missing: AngleKey[];
  nextMissing: AngleKey | null;
  hasExteriorPhoto: boolean;
  complete: boolean;
}

export function inspectionProgress(facts: InspectionFacts | null): InspectionProgress {
  const captured = new Set(facts?.captured ?? []);
  const skipped = new Set(facts?.skipped ?? []);
  const missing = REQUIRED_ANGLE_KEYS.filter((k) => !captured.has(k) && !skipped.has(k));
  const capturedCount = REQUIRED_ANGLE_KEYS.filter((k) => captured.has(k)).length;
  const skippedCount = REQUIRED_ANGLE_KEYS.filter((k) => !captured.has(k) && skipped.has(k)).length;
  return {
    total: REQUIRED_ANGLE_KEYS.length,
    done: capturedCount + skippedCount,
    captured: capturedCount,
    skipped: skippedCount,
    missing,
    nextMissing: missing[0] ?? null,
    hasExteriorPhoto: capturedCount > 0,
    complete: missing.length === 0 && capturedCount > 0,
  };
}

/** UX §3: at least one exterior photo is required to leave capture. */
export function canLeaveCapture(facts: InspectionFacts | null): boolean {
  return inspectionProgress(facts).hasExteriorPhoto;
}

// ---------------------------------------------------------------------------------------------
// Editability (mirrors the triggers)

/** Pick-up evidence and the rental snapshot: draft, or active with every contract voided. */
export function isBeforeEditable(status: RentalStatus, hasValidContract: boolean): boolean {
  return status === 'draft' || (status === 'active' && !hasValidContract);
}

/** Return evidence: while out, or while a completed return is reopened. */
export function isAfterEditable(status: RentalStatus, returnReopenedAt: EpochMs | null): boolean {
  return status === 'active' || (status === 'returned' && returnReopenedAt !== null);
}

// ---------------------------------------------------------------------------------------------
// Guards

export type Blocker =
  | 'wrong_status'
  | 'no_vehicle'
  | 'no_customer_name'
  | 'no_exterior_photo'
  | 'angles_missing'
  | 'agency_name_missing'
  | 'unknown_variables'
  | 'no_return_photo';

export const BLOCKER_MESSAGES: Record<Blocker, string> = {
  wrong_status: 'This step is not available for this rental any more.',
  no_vehicle: 'Choose a vehicle first.',
  no_customer_name: 'Enter the customer name first.',
  no_exterior_photo: 'Take at least one outside photo of the car.',
  angles_missing: 'Photograph or skip every outside angle.',
  agency_name_missing: 'Add your agency name in Settings.',
  unknown_variables: 'The contract template has unknown fields. Fix the template first.',
  no_return_photo: 'Take at least one outside photo at return.',
};

/** The start flow (steps 1-5) is open for drafts and for re-signing after a void. */
export function isStartFlowOpen(facts: RentalFacts): boolean {
  return facts.status === 'draft' || (facts.status === 'active' && !facts.hasValidContract);
}

function hasName(name: string | null): boolean {
  return name !== null && name.trim().length > 0;
}

/** What prevents entering a start step. Details are optional, so they never block. */
export function stepBlockers(step: StartStep, facts: RentalFacts): Blocker[] {
  if (!isStartFlowOpen(facts)) return ['wrong_status'];
  const out: Blocker[] = [];
  const index = START_STEPS.indexOf(step);
  if (index >= START_STEPS.indexOf('customer') && !facts.hasVehicle) out.push('no_vehicle');
  if (index >= START_STEPS.indexOf('inspect') && !hasName(facts.customerName)) out.push('no_customer_name');
  if (index >= START_STEPS.indexOf('details')) {
    const progress = inspectionProgress(facts.before);
    if (!progress.hasExteriorPhoto) out.push('no_exterior_photo');
    if (progress.missing.length > 0) out.push('angles_missing');
  }
  return out;
}

export function canEnterStep(step: StartStep, facts: RentalFacts): boolean {
  return stepBlockers(step, facts).length === 0;
}

export interface ContractReadiness {
  agencyName: string;
  unknownVariables: readonly string[];
}

/**
 * Everything required before the customer may sign: vehicle, customer name, every required
 * BEFORE angle captured or explicitly skipped (with at least one photo), and a template that
 * renders without unknown fields for an agency with a name.
 */
export function signBlockers(facts: RentalFacts, contract?: ContractReadiness): Blocker[] {
  const out = stepBlockers('sign', facts);
  if (contract) {
    if (contract.agencyName.trim().length === 0) out.push('agency_name_missing');
    if (contract.unknownVariables.length > 0) out.push('unknown_variables');
  }
  return out;
}

export type ReturnAction = 'start' | 'complete' | 'reopen';

export function returnBlockers(action: ReturnAction, facts: RentalFacts): Blocker[] {
  switch (action) {
    case 'start':
      return facts.status === 'active' ? [] : ['wrong_status'];
    case 'complete': {
      if (!isAfterEditable(facts.status, facts.returnReopenedAt)) return ['wrong_status'];
      return inspectionProgress(facts.after).hasExteriorPhoto ? [] : ['no_return_photo'];
    }
    case 'reopen':
      return facts.status === 'returned' && facts.returnReopenedAt === null ? [] : ['wrong_status'];
  }
}

export function canVoidContract(facts: RentalFacts): boolean {
  return facts.status === 'active' && facts.hasValidContract;
}

/** "For when the car never left": only an active rental can be cancelled. */
export function canCancel(facts: RentalFacts): boolean {
  return facts.status === 'active';
}

export function canDiscardDraft(facts: RentalFacts): boolean {
  return facts.status === 'draft';
}

// ---------------------------------------------------------------------------------------------
// Derived state, home sections, resume

export function deriveRentalState(facts: RentalFacts, now: EpochMs): RentalDerivedState {
  return {
    needsSignature: facts.status === 'active' && !facts.hasValidContract,
    returnInProgress:
      (facts.status === 'active' && facts.after !== null) ||
      (facts.status === 'returned' && facts.returnReopenedAt !== null),
    overdue: facts.status === 'active' && facts.expectedReturnAt !== null && facts.expectedReturnAt < now,
  };
}

export type HomeSection = 'unfinished' | 'due_back' | 'out' | 'returned' | 'cancelled';

/** Home grouping (UX §1). `endOfToday` is the last ms of the device's local day. */
export function homeSection(facts: RentalFacts, now: EpochMs, endOfToday: EpochMs): HomeSection {
  const derived = deriveRentalState(facts, now);
  switch (facts.status) {
    case 'draft':
      return 'unfinished';
    case 'active':
      if (derived.needsSignature || derived.returnInProgress) return 'unfinished';
      if (facts.expectedReturnAt !== null && facts.expectedReturnAt <= endOfToday) return 'due_back';
      return 'out';
    case 'returned':
      return derived.returnInProgress ? 'unfinished' : 'returned';
    case 'cancelled':
      return 'cancelled';
  }
}

const START_RESUME: Record<StartStep, ResumeStep> = {
  vehicle: 'vehicle',
  customer: 'customer',
  inspect: 'capture',
  details: 'details',
  sign: 'contract',
};

/** The start step a resume target belongs to; null for return steps. */
export function startStepOf(step: ResumeStep): StartStep | null {
  switch (step) {
    case 'vehicle':
    case 'customer':
    case 'details':
      return step;
    case 'capture':
    case 'condition':
      return 'inspect';
    case 'contract':
    case 'sign':
      return 'sign';
    default:
      return null;
  }
}

function isReturnStep(step: ResumeStep): boolean {
  return step === 'return_capture' || step === 'return_compare' || step === 'return_details';
}

/**
 * Where "Resume" lands: the stored step when it is still reachable, else the first step whose
 * requirements are unmet. Capture resumes at the next missing angle (inspectionProgress).
 * Returns null when there is nothing to resume (active and settled, returned, cancelled).
 */
export function resumeTarget(facts: RentalFacts, stored: ResumeStep | null): ResumeStep | null {
  if (isStartFlowOpen(facts)) {
    const storedStart = stored ? startStepOf(stored) : null;
    if (stored && storedStart && canEnterStep(storedStart, facts)) {
      // Never resume past an incomplete inspection.
      if (START_STEPS.indexOf(storedStart) <= START_STEPS.indexOf('inspect') || inspectionProgress(facts.before).complete) {
        return stored;
      }
    }
    if (!facts.hasVehicle) return START_RESUME.vehicle;
    if (!hasName(facts.customerName)) return START_RESUME.customer;
    if (!inspectionProgress(facts.before).complete) return START_RESUME.inspect;
    // Also after a void: re-signing goes through Details -> Sign (UX §10).
    return START_RESUME.details;
  }
  const derived = deriveRentalState(facts, Number.NEGATIVE_INFINITY);
  if (!derived.returnInProgress) return null;
  if (stored && isReturnStep(stored)) return stored;
  if (facts.status === 'returned') return 'return_compare';
  return canLeaveCapture(facts.after) && inspectionProgress(facts.after).complete ? 'return_compare' : 'return_capture';
}
