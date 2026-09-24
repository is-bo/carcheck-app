/**
 * Rental list items and lifecycle facts, computed in one query per rental set. Internal.
 */
import {
  deriveRentalState,
  inspectionProgress,
  type InspectionFacts,
  type RentalFacts,
} from '@/domain/rentalLifecycle';
import type { Id, RentalListItem } from '@/domain/types';

import type { SqlExecutor, SqlParams } from '../sql';
import { mapRental, requireRow, type RentalRow } from './internal';

export interface RentalItemRow extends RentalRow {
  x_valid_contract: number;
  x_contract_count: number;
  x_before_id: string | null;
  x_after_id: string | null;
  x_before_captured: string | null;
  x_before_skipped: string | null;
  x_after_captured: string | null;
  x_after_skipped: string | null;
  x_existing: number;
  x_new: number;
  x_uncertain: number;
}

const captured = (phase: string) =>
  `(SELECT group_concat(p.angle_key) FROM photo p WHERE p.rental_id = r.id AND p.phase = '${phase}'` +
  ` AND p.kind = 'angle' AND p.slot = 1)`;

const skipped = (phase: string) =>
  `(SELECT group_concat(ia.angle_key) FROM inspection_angle ia JOIN inspection i ON i.id = ia.inspection_id` +
  ` WHERE i.rental_id = r.id AND i.phase = '${phase}' AND ia.slot = 1 AND ia.skipped_at IS NOT NULL)`;

const damageCount = (status: string) =>
  `(SELECT count(*) FROM damage d WHERE d.rental_id = r.id AND d.status = '${status}')`;

export const RENTAL_ITEM_SELECT = `SELECT r.*,
  EXISTS (SELECT 1 FROM signed_contract sc WHERE sc.rental_id = r.id
          AND NOT EXISTS (SELECT 1 FROM contract_void cv WHERE cv.contract_id = sc.id)) AS x_valid_contract,
  (SELECT count(*) FROM signed_contract sc WHERE sc.rental_id = r.id) AS x_contract_count,
  (SELECT i.id FROM inspection i WHERE i.rental_id = r.id AND i.phase = 'before') AS x_before_id,
  (SELECT i.id FROM inspection i WHERE i.rental_id = r.id AND i.phase = 'after') AS x_after_id,
  ${captured('before')} AS x_before_captured,
  ${skipped('before')} AS x_before_skipped,
  ${captured('after')} AS x_after_captured,
  ${skipped('after')} AS x_after_skipped,
  ${damageCount('pre_existing')} AS x_existing,
  ${damageCount('new')} AS x_new,
  ${damageCount('uncertain')} AS x_uncertain
FROM rental r`;

const split = (s: string | null) => (s ? s.split(',') : []);

function inspectionFacts(id: string | null, capturedKeys: string | null, skippedKeys: string | null): InspectionFacts | null {
  return id === null ? null : { captured: split(capturedKeys), skipped: split(skippedKeys) };
}

export function rentalFactsFromRow(r: RentalItemRow): RentalFacts {
  return {
    status: r.status,
    hasVehicle: r.vehicle_id !== null,
    customerName: r.cust_full_name,
    hasValidContract: r.x_valid_contract === 1,
    contractCount: r.x_contract_count,
    before: inspectionFacts(r.x_before_id, r.x_before_captured, r.x_before_skipped),
    after: inspectionFacts(r.x_after_id, r.x_after_captured, r.x_after_skipped),
    returnReopenedAt: r.return_reopened_at,
    expectedReturnAt: r.expected_return_at,
  };
}

export function mapRentalItem(r: RentalItemRow, now: number): RentalListItem {
  const facts = rentalFactsFromRow(r);
  const before = inspectionProgress(facts.before);
  const after = facts.after ? inspectionProgress(facts.after) : null;
  return {
    rental: mapRental(r),
    derived: deriveRentalState(facts, now),
    hasValidContract: facts.hasValidContract,
    contractCount: facts.contractCount,
    beforeProgress: { done: before.done, total: before.total },
    afterProgress: after ? { done: after.done, total: after.total } : null,
    existingDamageCount: r.x_existing,
    newDamageCount: r.x_new,
    uncertainDamageCount: r.x_uncertain,
  };
}

export function queryRentalItems(db: SqlExecutor, where: string, params: SqlParams = [], tail = ''): Promise<RentalItemRow[]> {
  return db.getAllAsync<RentalItemRow>(`${RENTAL_ITEM_SELECT} ${where ? `WHERE ${where}` : ''} ${tail}`, params);
}

export async function loadRentalItemRow(db: SqlExecutor, rentalId: Id): Promise<RentalItemRow> {
  const row = await db.getFirstAsync<RentalItemRow>(`${RENTAL_ITEM_SELECT} WHERE r.id = ?`, [rentalId]);
  return requireRow(row, 'Rental', rentalId);
}

export async function loadRentalFacts(db: SqlExecutor, rentalId: Id): Promise<{ row: RentalItemRow; facts: RentalFacts }> {
  const row = await loadRentalItemRow(db, rentalId);
  return { row, facts: rentalFactsFromRow(row) };
}
