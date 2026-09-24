/**
 * Rentals: draft creation and autosave, vehicle/customer snapshots, details, the return
 * lifecycle and the home lists. Signing (reference, contract, activation) lives in contracts.ts.
 */
import {
  canCancel,
  canDiscardDraft,
  homeSection,
  isStartFlowOpen,
  returnBlockers,
  BLOCKER_MESSAGES,
  type RentalFacts,
} from '@/domain/rentalLifecycle';
import type {
  CustomerSnapshot,
  EpochMs,
  HomeSections,
  Id,
  Inspection,
  Rental,
  RentalDetail,
  RentalListItem,
  RentalStatus,
  ResumeStep,
} from '@/domain/types';

import { getPlatform } from '../connection';
import { ConflictError, InvalidStateError, LockedError, ValidationError } from '../errors';
import type { SqlExecutor } from '../sql';
import { insertCustomer, loadCustomer } from './customers';
import { LOCK_MESSAGES } from './guards';
import {
  cleanText,
  CONTRACT_SELECT,
  mapArtifact,
  mapContract,
  mapCustomerDocument,
  mapDamage,
  mapInspection,
  mapRental,
  mapVehicle,
  read,
  requireRow,
  VEHICLE_COLUMNS,
  DAMAGE_COLUMNS,
  write,
  type ArtifactRow,
  type ContractRow,
  type CustomerDocumentRow,
  type DamageRow,
  type InspectionRow,
  type RentalRow,
  type VehicleRow,
  type WriteScope,
} from './internal';
import { loadRentalFacts, loadRentalItemRow, mapRentalItem, queryRentalItems, rentalFactsFromRow } from './rentalItems';

const RESUME_STEPS: readonly ResumeStep[] = [
  'vehicle', 'customer', 'capture', 'condition', 'details', 'contract', 'sign',
  'return_capture', 'return_compare', 'return_details',
];

export async function loadRental(db: SqlExecutor, id: Id): Promise<Rental> {
  const row = await db.getFirstAsync<RentalRow>('SELECT * FROM rental WHERE id = ?', [id]);
  return mapRental(requireRow(row, 'Rental', id));
}

function assertStartFlowOpen(facts: RentalFacts): void {
  if (isStartFlowOpen(facts)) return;
  if (facts.status === 'active') throw new LockedError(LOCK_MESSAGES.signed);
  if (facts.status === 'cancelled') throw new LockedError(LOCK_MESSAGES.cancelled);
  throw new LockedError(LOCK_MESSAGES.closedBefore);
}

function validMileage(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new ValidationError('Enter a valid mileage.', field);
  return Math.round(value);
}

function validFuel(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 8) throw new ValidationError('Fuel is 0 (empty) to 8 (full) eighths.', field);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Reads

export function getRental(id: Id): Promise<Rental> {
  return read((db) => loadRental(db, id));
}

export function getRentalItem(id: Id): Promise<RentalListItem> {
  return read(async (db) => mapRentalItem(await loadRentalItemRow(db, id), getPlatform().now()));
}

/** Lifecycle facts for rentalLifecycle guards (step blockers, resume target). */
export function getRentalFacts(id: Id): Promise<RentalFacts> {
  return read(async (db) => (await loadRentalFacts(db, id)).facts);
}

export function getRentalDetail(id: Id): Promise<RentalDetail> {
  return read(async (db) => {
    const row = await loadRentalItemRow(db, id);
    const item = mapRentalItem(row, getPlatform().now());
    const vehicle = row.vehicle_id
      ? await db.getFirstAsync<VehicleRow>(`SELECT ${VEHICLE_COLUMNS} FROM vehicle v WHERE v.id = ?`, [row.vehicle_id])
      : null;
    const customer = row.customer_id ? await loadCustomer(db, row.customer_id) : null;
    const contracts = await db.getAllAsync<ContractRow>(`${CONTRACT_SELECT} WHERE sc.rental_id = ? ORDER BY sc.sequence`, [id]);
    const inspections = await db.getAllAsync<InspectionRow>('SELECT * FROM inspection WHERE rental_id = ?', [id]);
    const damage = await db.getAllAsync<DamageRow>(
      `SELECT ${DAMAGE_COLUMNS} FROM damage d WHERE d.rental_id = ? ORDER BY d.status <> 'pre_existing', d.number`,
      [id],
    );
    const documents = await db.getAllAsync<CustomerDocumentRow>(
      'SELECT * FROM customer_document WHERE rental_id = ? OR (customer_id IS NOT NULL AND customer_id = ?) ORDER BY created_at',
      [id, row.customer_id],
    );
    const artifacts = await db.getAllAsync<ArtifactRow>('SELECT * FROM generated_artifact WHERE rental_id = ? ORDER BY generated_at', [id]);
    const inspection = (phase: string) => {
      const found = inspections.find((i) => i.phase === phase);
      return found ? mapInspection(found) : null;
    };
    return {
      item,
      vehicleProfile: vehicle ? mapVehicle(vehicle) : null,
      customerProfile: customer,
      contracts: contracts.map(mapContract),
      before: inspection('before'),
      after: inspection('after'),
      damage: damage.map(mapDamage),
      documents: documents.map(mapCustomerDocument),
      artifacts: artifacts.map(mapArtifact),
    };
  });
}

function localEndOfDay(now: EpochMs): EpochMs {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

const RETURNED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Home sections (UX §1). `endOfToday` defaults to the device's local end of day. */
export function getHome(options: { now?: EpochMs; endOfToday?: EpochMs } = {}): Promise<HomeSections> {
  return read(async (db) => {
    const now = options.now ?? getPlatform().now();
    const endOfToday = options.endOfToday ?? localEndOfDay(now);
    const rows = await queryRentalItems(
      db,
      "r.status IN ('draft', 'active') OR (r.status = 'returned' AND (r.return_reopened_at IS NOT NULL OR r.return_completed_at >= ?))",
      [now - RETURNED_WINDOW_MS],
    );
    const sections: HomeSections = { unfinished: [], dueBack: [], out: [], returned: [] };
    for (const row of rows) {
      const item = mapRentalItem(row, now);
      switch (homeSection(rentalFactsFromRow(row), now, endOfToday)) {
        case 'unfinished':
          sections.unfinished.push(item);
          break;
        case 'due_back':
          sections.dueBack.push(item);
          break;
        case 'out':
          sections.out.push(item);
          break;
        case 'returned':
          sections.returned.push(item);
          break;
      }
    }
    const due = (i: RentalListItem) => i.rental.expectedReturnAt ?? Number.MAX_SAFE_INTEGER;
    sections.unfinished.sort((a, b) => b.rental.updatedAt - a.rental.updatedAt);
    sections.dueBack.sort((a, b) => due(a) - due(b));
    sections.out.sort((a, b) => due(a) - due(b) || (b.rental.activatedAt ?? 0) - (a.rental.activatedAt ?? 0));
    sections.returned.sort((a, b) => (b.rental.returnCompletedAt ?? 0) - (a.rental.returnCompletedAt ?? 0));
    sections.returned = sections.returned.slice(0, 5);
    return sections;
  });
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Plate, customer name or reference ("R-0142", "142"). Newest first. */
export function searchRentals(query: string, limit = 50): Promise<RentalListItem[]> {
  return read(async (db) => {
    const q = query.trim();
    if (!q) return [];
    const plate = `%${likeEscape(q.replace(/[ .-]/g, '').toUpperCase())}%`;
    const like = `%${likeEscape(q)}%`;
    const rows = await queryRentalItems(
      db,
      "(upper(replace(replace(replace(coalesce(r.veh_plate, ''), ' ', ''), '-', ''), '.', '')) LIKE ? ESCAPE '\\'" +
        " OR r.cust_full_name LIKE ? ESCAPE '\\' OR r.reference LIKE ? ESCAPE '\\')",
      [plate, like, like, limit],
      'ORDER BY r.created_at DESC LIMIT ?',
    );
    const now = getPlatform().now();
    return rows.map((r) => mapRentalItem(r, now));
  });
}

export interface RentalFilter {
  statuses?: readonly RentalStatus[];
  vehicleId?: Id;
  customerId?: Id;
  limit?: number;
  offset?: number;
}

/** "All history" and other filtered lists, newest first. */
export function listRentals(filter: RentalFilter = {}): Promise<RentalListItem[]> {
  return read(async (db) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.statuses?.length) {
      where.push(`r.status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }
    if (filter.vehicleId) {
      where.push('r.vehicle_id = ?');
      params.push(filter.vehicleId);
    }
    if (filter.customerId) {
      where.push('r.customer_id = ?');
      params.push(filter.customerId);
    }
    params.push(filter.limit ?? 100, filter.offset ?? 0);
    const rows = await queryRentalItems(db, where.join(' AND '), params, 'ORDER BY r.created_at DESC LIMIT ? OFFSET ?');
    const now = getPlatform().now();
    return rows.map((r) => mapRentalItem(r, now));
  });
}

// ---------------------------------------------------------------------------------------------
// Start flow

/** "New rental": the draft exists before any vehicle is chosen. */
export function createDraftRental(): Promise<Rental> {
  return write(['rental'], async ({ tx, now, newId }) => {
    const id = newId();
    const unit = await tx.getFirstAsync<{ distance_unit: string }>('SELECT distance_unit FROM agency_settings WHERE id = 1');
    await tx.runAsync(
      "INSERT INTO rental (id, status, distance_unit, resume_step, created_at, updated_at) VALUES (?, 'draft', ?, 'vehicle', ?, ?)",
      [id, unit?.distance_unit ?? 'km', now, now],
    );
    return loadRental(tx, id);
  });
}

/** Chooses the vehicle and copies its snapshot. Refused while it is out on another rental. */
export function setRentalVehicle(rentalId: Id, vehicleId: Id): Promise<Rental> {
  return write(['rental'], async ({ tx, now }) => {
    const { row, facts } = await loadRentalFacts(tx, rentalId);
    assertStartFlowOpen(facts);
    const vehicle = mapVehicle(
      requireRow(await tx.getFirstAsync<VehicleRow>(`SELECT ${VEHICLE_COLUMNS} FROM vehicle v WHERE v.id = ?`, [vehicleId]), 'Vehicle', vehicleId),
    );
    if (vehicle.archivedAt !== null) throw new ValidationError('This vehicle is archived. Unarchive it first.', 'vehicleId');
    const out = await tx.getFirstAsync<{ id: string }>("SELECT id FROM rental WHERE vehicle_id = ? AND status = 'active' AND id <> ?", [
      vehicleId,
      rentalId,
    ]);
    if (out) throw new ConflictError('vehicle_out', 'This vehicle is out on another rental.');
    if (row.vehicle_id !== vehicleId && row.x_existing + row.x_new + row.x_uncertain > 0) {
      throw new InvalidStateError('Remove the damage marks of this rental before changing its vehicle.');
    }
    await tx.runAsync(
      'UPDATE rental SET vehicle_id = ?, veh_plate = ?, veh_make = ?, veh_model = ?, veh_year = ?, veh_color = ?, veh_vin = ?, ' +
        'updated_at = ? WHERE id = ?',
      [vehicle.id, vehicle.plate, vehicle.make, vehicle.model, vehicle.year, vehicle.color, vehicle.vin, now, rentalId],
    );
    return loadRental(tx, rentalId);
  });
}

export interface RentalCustomerInput {
  /** A picked profile, or null for an inline customer. */
  customerId?: Id | null;
  /** What the rental records; for a picked profile, usually the profile's fields as shown. */
  snapshot: CustomerSnapshot;
  /**
   * Inline customer: create a profile from the snapshot and link it (the rental's documents
   * move to the profile). Picked profile: write the snapshot back to the profile.
   */
  saveAsProfile?: boolean;
}

async function writeCustomerSnapshot(scope: WriteScope, rentalId: Id, customerId: Id | null, s: CustomerSnapshot): Promise<void> {
  await scope.tx.runAsync(
    'UPDATE rental SET customer_id = ?, cust_full_name = ?, cust_phone = ?, cust_address = ?, cust_licence_number = ?, ' +
      'cust_id_number = ?, cust_notes = ?, updated_at = ? WHERE id = ?',
    [
      customerId, cleanText(s.fullName), cleanText(s.phone), cleanText(s.address), cleanText(s.licenceNumber),
      cleanText(s.idNumber), cleanText(s.notes), scope.now, rentalId,
    ],
  );
}

/** The rental's customer: inline snapshot, picked profile, or "Save as profile". */
export function setRentalCustomer(rentalId: Id, input: RentalCustomerInput): Promise<Rental> {
  return write(['rental', 'customer'], async (scope) => {
    const { tx, now } = scope;
    const { facts } = await loadRentalFacts(tx, rentalId);
    assertStartFlowOpen(facts);
    const name = cleanText(input.snapshot.fullName);
    let customerId: Id | null = input.customerId ?? null;
    if (customerId) {
      await loadCustomer(tx, customerId);
      if (input.saveAsProfile && name) {
        await tx.runAsync(
          'UPDATE customer SET full_name = ?, phone = ?, address = ?, licence_number = ?, id_number = ?, notes = ?, updated_at = ? WHERE id = ?',
          [
            name, cleanText(input.snapshot.phone), cleanText(input.snapshot.address), cleanText(input.snapshot.licenceNumber),
            cleanText(input.snapshot.idNumber), cleanText(input.snapshot.notes), now, customerId,
          ],
        );
      }
    } else if (input.saveAsProfile) {
      if (!name) throw new ValidationError('Enter the customer name.', 'fullName');
      customerId = scope.newId();
      await insertCustomer(tx, customerId, { ...input.snapshot, fullName: name }, now);
      await tx.runAsync('UPDATE customer_document SET customer_id = ?, rental_id = NULL WHERE rental_id = ?', [customerId, rentalId]);
    }
    await writeCustomerSnapshot(scope, rentalId, customerId, input.snapshot);
    return loadRental(tx, rentalId);
  });
}

/** Tapping a profile: copies it into the snapshot and links it. */
export function pickRentalCustomer(rentalId: Id, customerId: Id): Promise<Rental> {
  return write(['rental'], async (scope) => {
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    assertStartFlowOpen(facts);
    const c = await loadCustomer(scope.tx, customerId);
    await writeCustomerSnapshot(scope, rentalId, c.id, {
      fullName: c.fullName,
      phone: c.phone,
      address: c.address,
      licenceNumber: c.licenceNumber,
      idNumber: c.idNumber,
      notes: c.notes,
    });
    return loadRental(scope.tx, rentalId);
  });
}

export interface RentalDetailsPatch {
  startMileage?: number | null;
  startFuelEighths?: number | null;
  /** Operational: still editable after signing (the agreed date stays in the contract). */
  expectedReturnAt?: EpochMs | null;
  specialTerms?: string | null;
}

export function updateRentalDetails(rentalId: Id, patch: RentalDetailsPatch): Promise<Rental> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  const touchesContract = patch.startMileage !== undefined || patch.startFuelEighths !== undefined || patch.specialTerms !== undefined;
  if (patch.startMileage !== undefined) set('start_mileage', validMileage(patch.startMileage, 'startMileage'));
  if (patch.startFuelEighths !== undefined) set('start_fuel_eighths', validFuel(patch.startFuelEighths, 'startFuelEighths'));
  if (patch.specialTerms !== undefined) set('special_terms', cleanText(patch.specialTerms));
  if (patch.expectedReturnAt !== undefined) {
    if (patch.expectedReturnAt !== null && !Number.isFinite(patch.expectedReturnAt)) {
      throw new ValidationError('Invalid date', 'expectedReturnAt');
    }
    set('expected_return_at', patch.expectedReturnAt);
  }
  return write(['rental'], async ({ tx, now }) => {
    const { facts } = await loadRentalFacts(tx, rentalId);
    if (touchesContract) assertStartFlowOpen(facts);
    else if (facts.status !== 'draft' && facts.status !== 'active') throw new LockedError(LOCK_MESSAGES.closedBefore);
    if (sets.length > 0) await tx.runAsync(`UPDATE rental SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, rentalId]);
    return loadRental(tx, rentalId);
  });
}

/** Where "Resume" lands. UI state only; ignored for cancelled rentals. */
export function setResumeStep(rentalId: Id, step: ResumeStep | null): Promise<void> {
  if (step !== null && !RESUME_STEPS.includes(step)) throw new ValidationError(`Unknown step ${step as string}`, 'step');
  return write(['rental'], async ({ tx }) => {
    const rental = await loadRental(tx, rentalId);
    if (rental.status === 'cancelled' || rental.resumeStep === step) return;
    await tx.runAsync('UPDATE rental SET resume_step = ? WHERE id = ?', [step, rentalId]);
  });
}

/** "Discard draft": deletes the draft with its photos, marks and documents (files after commit). */
export function discardDraft(rentalId: Id): Promise<void> {
  return write(['rental', 'photo', 'damage', 'inspection', 'customer'], async (scope) => {
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    if (!canDiscardDraft(facts)) throw new InvalidStateError('Only drafts can be discarded.');
    const photos = await scope.tx.getAllAsync<{ id: string; file_path: string }>('SELECT id, file_path FROM photo WHERE rental_id = ?', [rentalId]);
    const docs = await scope.tx.getAllAsync<{ file_path: string }>('SELECT file_path FROM customer_document WHERE rental_id = ?', [rentalId]);
    const artifacts = await scope.tx.getAllAsync<{ file_path: string }>('SELECT file_path FROM generated_artifact WHERE rental_id = ?', [rentalId]);
    await scope.tx.runAsync('DELETE FROM rental WHERE id = ?', [rentalId]);
    scope.afterCommit(async () => {
      const files = getPlatform().files;
      for (const p of photos) {
        await files.deleteFile(p.file_path);
        await files.deletePhotoDerivatives(p.id);
      }
      for (const f of [...docs, ...artifacts]) await files.deleteFile(f.file_path);
    });
  });
}

/** For when the car never left: kept in history as Cancelled; all photos freeze. */
export function cancelRental(rentalId: Id, reason?: string | null): Promise<Rental> {
  return write(['rental', 'vehicle'], async ({ tx, now }) => {
    const { facts } = await loadRentalFacts(tx, rentalId);
    if (!canCancel(facts)) throw new InvalidStateError('Only a rental that is out can be cancelled.');
    await tx.runAsync(
      "UPDATE rental SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, resume_step = NULL, updated_at = ? WHERE id = ?",
      [now, cleanText(reason), now, rentalId],
    );
    return loadRental(tx, rentalId);
  });
}

// ---------------------------------------------------------------------------------------------
// Return

function assertReturn(facts: RentalFacts, action: 'start' | 'complete' | 'reopen'): void {
  const blockers = returnBlockers(action, facts);
  if (blockers.length === 0) return;
  if (blockers[0] === 'wrong_status' && facts.status === 'returned') throw new LockedError(LOCK_MESSAGES.returned);
  throw new InvalidStateError(BLOCKER_MESSAGES[blockers[0]]);
}

/** "Start return" (idempotent; resumes a return in progress). */
export function startReturn(rentalId: Id): Promise<Inspection> {
  return write(['rental', 'inspection'], async ({ tx, now, newId }) => {
    const existing = await tx.getFirstAsync<InspectionRow>("SELECT * FROM inspection WHERE rental_id = ? AND phase = 'after'", [rentalId]);
    const { facts } = await loadRentalFacts(tx, rentalId);
    if (existing && (facts.status === 'active' || facts.returnReopenedAt !== null)) return mapInspection(existing);
    assertReturn(facts, 'start');
    const id = newId();
    await tx.runAsync("INSERT INTO inspection (id, rental_id, phase, started_at) VALUES (?, ?, 'after', ?)", [id, rentalId, now]);
    await tx.runAsync("UPDATE rental SET resume_step = 'return_capture', updated_at = ? WHERE id = ?", [now, rentalId]);
    return mapInspection(requireRow(await tx.getFirstAsync<InspectionRow>('SELECT * FROM inspection WHERE id = ?', [id]), 'Inspection', id));
  });
}

export interface ReturnDetailsPatch {
  returnMileage?: number | null;
  returnFuelEighths?: number | null;
  returnNotes?: string | null;
}

function returnSets(patch: ReturnDetailsPatch): { sets: string[]; params: (string | number | null)[] } {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (patch.returnMileage !== undefined) {
    sets.push('return_mileage = ?');
    params.push(validMileage(patch.returnMileage, 'returnMileage'));
  }
  if (patch.returnFuelEighths !== undefined) {
    sets.push('return_fuel_eighths = ?');
    params.push(validFuel(patch.returnFuelEighths, 'returnFuelEighths'));
  }
  if (patch.returnNotes !== undefined) {
    sets.push('return_notes = ?');
    params.push(cleanText(patch.returnNotes));
  }
  return { sets, params };
}

/** Autosave of the return details screen (before Complete return). */
export function updateReturnDetails(rentalId: Id, patch: ReturnDetailsPatch): Promise<Rental> {
  const { sets, params } = returnSets(patch);
  return write(['rental'], async ({ tx, now }) => {
    const { facts } = await loadRentalFacts(tx, rentalId);
    if (facts.status === 'returned' && facts.returnReopenedAt === null) throw new LockedError(LOCK_MESSAGES.returned);
    if (facts.status !== 'active' && facts.status !== 'returned') throw new InvalidStateError(LOCK_MESSAGES.returnNotStarted);
    if (sets.length > 0) await tx.runAsync(`UPDATE rental SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, rentalId]);
    return loadRental(tx, rentalId);
  });
}

/**
 * "Complete return": freezes every photo (trigger), bumps the revision ("Revised" when > 1),
 * and records the odometer on the vehicle when it moved forward.
 */
export function completeReturn(rentalId: Id, patch: ReturnDetailsPatch & { returnedAt?: EpochMs } = {}): Promise<Rental> {
  const { sets, params } = returnSets(patch);
  return write(['rental', 'vehicle', 'photo'], async ({ tx, now }) => {
    const { row, facts } = await loadRentalFacts(tx, rentalId);
    assertReturn(facts, 'complete');
    const returnedAt = patch.returnedAt ?? row.returned_at ?? now;
    await tx.runAsync(
      `UPDATE rental SET ${[...sets, 'returned_at = ?'].join(', ')}, status = 'returned', return_revision = return_revision + 1,
         return_completed_at = ?, return_reopened_at = NULL, resume_step = NULL, updated_at = ? WHERE id = ?`,
      [...params, returnedAt, now, now, rentalId],
    );
    const rental = await loadRental(tx, rentalId);
    if (rental.vehicleId && rental.returnMileage !== null) {
      await tx.runAsync('UPDATE vehicle SET mileage = ?, updated_at = ? WHERE id = ? AND (mileage IS NULL OR mileage <= ?)', [
        rental.returnMileage,
        now,
        rental.vehicleId,
        rental.returnMileage,
      ]);
    }
    return rental;
  });
}

/** "Edit return": reopens a completed return; the status stays 'returned'. */
export function reopenReturn(rentalId: Id): Promise<Rental> {
  return write(['rental'], async ({ tx, now }) => {
    const { facts } = await loadRentalFacts(tx, rentalId);
    assertReturn(facts, 'reopen');
    await tx.runAsync("UPDATE rental SET return_reopened_at = ?, resume_step = 'return_compare', updated_at = ? WHERE id = ?", [
      now,
      now,
      rentalId,
    ]);
    return loadRental(tx, rentalId);
  });
}
