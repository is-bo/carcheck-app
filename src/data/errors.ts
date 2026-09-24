/**
 * Typed errors thrown by the data layer. Screens switch on `code` (or instanceof) to pick copy,
 * e.g. LockedError -> "Void & re-sign to change it".
 */
import { DB_ERROR } from './migrations';

export type DataErrorCode =
  | 'not_ready'
  | 'not_found'
  | 'locked'
  | 'immutable'
  | 'invalid_state'
  | 'conflict'
  | 'validation';

export class DataError extends Error {
  readonly code: DataErrorCode;
  override readonly cause?: unknown;
  constructor(code: DataErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.cause = cause;
  }
}

/** initializeData() has not finished (or the data store was closed for a restore). */
export class DataNotReadyError extends DataError {
  constructor() {
    super('not_ready', 'Data store is not initialized; call initializeData() first');
    this.name = 'DataNotReadyError';
  }
}

export class NotFoundError extends DataError {
  readonly entity: string;
  readonly id: string;
  constructor(entity: string, id: string) {
    super('not_found', `${entity} ${id} not found`);
    this.name = 'NotFoundError';
    this.entity = entity;
    this.id = id;
  }
}

/**
 * Evidence locked by the rental's state: signed pick-up (void & re-sign unlocks it), completed
 * return (Edit return unlocks it) or cancelled rental (never).
 */
export class LockedError extends DataError {
  constructor(message: string, cause?: unknown) {
    super('locked', message, cause);
    this.name = 'LockedError';
  }
}

/** The row can never change: signed contract, void record, template version, frozen photo. */
export class ImmutableError extends DataError {
  constructor(message: string, cause?: unknown) {
    super('immutable', message, cause);
    this.name = 'ImmutableError';
  }
}

/** The operation is not allowed in the entity's current state (e.g. completing a draft's return). */
export class InvalidStateError extends DataError {
  constructor(message: string, cause?: unknown) {
    super('invalid_state', message, cause);
    this.name = 'InvalidStateError';
  }
}

export type ConflictReason =
  | 'vehicle_out'
  | 'photo_exists'
  | 'already_voided'
  | 'duplicate'
  | 'has_damage'
  | 'has_photos';

export class ConflictError extends DataError {
  readonly reason: ConflictReason;
  constructor(reason: ConflictReason, message: string, cause?: unknown) {
    super('conflict', message, cause);
    this.name = 'ConflictError';
    this.reason = reason;
  }
}

export class ValidationError extends DataError {
  readonly field: string | null;
  constructor(message: string, field: string | null = null) {
    super('validation', message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Readable part of a trigger message: "CARCHECK_LOCKED: <text>" -> "<text>". */
function triggerText(message: string, prefix: string): string {
  const at = message.indexOf(prefix);
  return message.slice(at + prefix.length).replace(/^:\s*/, '').trim() || message;
}

/** Maps SQLite/trigger failures to typed errors; DataErrors pass through unchanged. */
export function mapDbError(e: unknown): unknown {
  if (e instanceof DataError) return e;
  const message = messageOf(e);
  if (message.includes(DB_ERROR.immutable)) return new ImmutableError(triggerText(message, DB_ERROR.immutable), e);
  if (message.includes(DB_ERROR.locked)) return new LockedError(triggerText(message, DB_ERROR.locked), e);
  if (message.includes(DB_ERROR.invalid)) return new InvalidStateError(triggerText(message, DB_ERROR.invalid), e);
  // ux_rental_vehicle_out (one active rental per vehicle) reports its column, not its name.
  if (message.includes('UNIQUE constraint failed: rental.vehicle_id')) {
    return new ConflictError('vehicle_out', 'This vehicle is already out on another rental', e);
  }
  if (message.includes('UNIQUE constraint failed')) return new ConflictError('duplicate', message, e);
  return e;
}
