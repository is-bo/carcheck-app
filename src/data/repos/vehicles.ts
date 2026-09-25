/**
 * Vehicles: reusable profiles. A vehicle that was ever used by a rental is archived instead of
 * deleted, so its history and evidence stay intact; a vehicle that is out cannot be archived.
 */
import type {
  CapturedImage,
  VehicleDocument,
  Id,
  Vehicle,
  VehicleDetail,
  VehicleListItem,
  VehicleOutInfo,
} from '@/domain/types';

import { getPlatform } from '../connection';
import { ConflictError, ValidationError } from '../errors';
import { vehiclePhotoPath } from '../filePaths';
import type { SqlExecutor } from '../sql';
import { loadKnownDamage } from './damage';
import {
  cleanText,
  deleteFilesLater,
  mapArtifact,
  mapPhoto,
  mapVehicle,
  read,
  requireRow,
  VEHICLE_COLUMNS,
  withImportedFile,
  write,
  PHOTO_COLUMNS,
  type ArtifactRow,
  type PhotoRow,
  type VehicleRow,
} from './internal';
import { mapRentalItem, queryRentalItems } from './rentalItems';

export interface VehicleInput {
  plate: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  mileage?: number | null;
  notes?: string | null;
}

export type VehiclePatch = Partial<VehicleInput>;

/** Same normalisation as the generated plate_key column (duplicate warnings, search). */
export function plateKey(plate: string): string {
  return plate.replace(/[ .-]/g, '').toUpperCase();
}

function validYear(year: number | null | undefined): number | null {
  if (year === null || year === undefined) return null;
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new ValidationError('Enter a valid year.', 'year');
  return year;
}

function validMileage(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw new ValidationError('Enter a valid mileage.', field);
  return Math.round(value);
}

function requirePlate(plate: string | undefined): string {
  const p = cleanText(plate);
  if (!p) throw new ValidationError('Enter the plate.', 'plate');
  return p;
}

async function loadVehicle(db: SqlExecutor, id: Id): Promise<Vehicle> {
  const row = await db.getFirstAsync<VehicleRow>(`SELECT ${VEHICLE_COLUMNS} FROM vehicle v WHERE v.id = ?`, [id]);
  return mapVehicle(requireRow(row, 'Vehicle', id));
}

async function loadOutInfo(db: SqlExecutor, vehicleId: Id): Promise<VehicleOutInfo | null> {
  const row = await db.getFirstAsync<{ id: string; reference: string | null; cust_full_name: string | null; expected_return_at: number | null }>(
    "SELECT id, reference, cust_full_name, expected_return_at FROM rental WHERE vehicle_id = ? AND status = 'active'",
    [vehicleId],
  );
  return row
    ? { rentalId: row.id, reference: row.reference, customerName: row.cust_full_name, expectedReturnAt: row.expected_return_at }
    : null;
}

/** Refreshes the snapshot of draft rentals using this vehicle (DATA_MODEL §2). */
async function refreshDraftSnapshots(tx: SqlExecutor, v: Vehicle, now: number): Promise<void> {
  await tx.runAsync(
    "UPDATE rental SET veh_plate = ?, veh_make = ?, veh_model = ?, veh_year = ?, veh_color = ?, veh_vin = ?, updated_at = ? " +
      "WHERE vehicle_id = ? AND status = 'draft'",
    [v.plate, v.make, v.model, v.year, v.color, v.vin, now, v.id],
  );
}

export function getVehicle(id: Id): Promise<Vehicle> {
  return read((db) => loadVehicle(db, id));
}

export function listVehicles(query: { search?: string; includeArchived?: boolean } = {}): Promise<VehicleListItem[]> {
  return read(async (db) => {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!query.includeArchived) where.push('v.archived_at IS NULL');
    const search = query.search?.trim();
    if (search) {
      where.push("(v.plate_key LIKE ? ESCAPE '\\' OR v.make LIKE ? ESCAPE '\\' OR v.model LIKE ? ESCAPE '\\')");
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(`%${plateKey(search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`, like, like);
    }
    const rows = await db.getAllAsync<
      VehicleRow & {
        out_id: string | null;
        out_reference: string | null;
        out_customer: string | null;
        out_due: number | null;
        last_rental_at: number | null;
      }
    >(
      `SELECT ${VEHICLE_COLUMNS},
         o.id AS out_id, o.reference AS out_reference, o.cust_full_name AS out_customer, o.expected_return_at AS out_due,
         (SELECT max(coalesce(r.activated_at, r.created_at)) FROM rental r WHERE r.vehicle_id = v.id) AS last_rental_at
       FROM vehicle v LEFT JOIN rental o ON o.vehicle_id = v.id AND o.status = 'active'
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY last_rental_at IS NULL, last_rental_at DESC, v.plate COLLATE NOCASE`,
      params,
    );
    return rows.map((r) => ({
      vehicle: mapVehicle(r),
      out: r.out_id
        ? { rentalId: r.out_id, reference: r.out_reference, customerName: r.out_customer, expectedReturnAt: r.out_due }
        : null,
      lastRentalAt: r.last_rental_at,
    }));
  });
}

/** Vehicles whose normalised plate equals `plate` (duplicate warning on create). */
export function findVehiclesByPlate(plate: string): Promise<Vehicle[]> {
  return read(async (db) => {
    const rows = await db.getAllAsync<VehicleRow>(`SELECT ${VEHICLE_COLUMNS} FROM vehicle v WHERE v.plate_key = ?`, [
      plateKey(plate),
    ]);
    return rows.map(mapVehicle);
  });
}

export function getVehicleDetail(id: Id): Promise<VehicleDetail> {
  return read(async (db) => {
    const vehicle = await loadVehicle(db, id);
    const now = getPlatform().now();
    const history = (
      await queryRentalItems(db, "r.vehicle_id = ? AND r.status <> 'draft'", [id], 'ORDER BY coalesce(r.activated_at, r.created_at) DESC')
    ).map((r) => mapRentalItem(r, now));
    const documents = await db.getAllAsync<ArtifactRow & { x_voided: number }>(
      'SELECT a.*, EXISTS (SELECT 1 FROM contract_void cv WHERE cv.contract_id = a.contract_id) AS x_voided ' +
        'FROM generated_artifact a JOIN rental r ON r.id = a.rental_id WHERE r.vehicle_id = ? ' +
        "AND a.kind IN ('contract_pdf', 'report_pdf') ORDER BY a.generated_at DESC",
      [id],
    );
    const latestPhoto = await db.getFirstAsync<PhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM photo p JOIN rental r ON r.id = p.rental_id
       WHERE r.vehicle_id = ? AND p.kind = 'angle' AND p.angle_key = 'front_left' AND p.slot = 1
       ORDER BY p.captured_at DESC LIMIT 1`,
      [id],
    );
    return {
      vehicle,
      out: await loadOutInfo(db, id),
      history,
      knownDamage: await loadKnownDamage(db, id, null),
      documents: documents.map((a): VehicleDocument => ({ ...mapArtifact(a), contractVoided: a.x_voided === 1 })),
      latestPhoto: latestPhoto ? mapPhoto(latestPhoto) : null,
    };
  });
}

export function createVehicle(input: VehicleInput): Promise<Vehicle> {
  const plate = requirePlate(input.plate);
  const year = validYear(input.year);
  const mileage = validMileage(input.mileage, 'mileage');
  return write(['vehicle'], async ({ tx, now, newId }) => {
    const id = newId();
    await tx.runAsync(
      'INSERT INTO vehicle (id, plate, make, model, year, color, vin, mileage, notes, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, plate, cleanText(input.make), cleanText(input.model), year, cleanText(input.color), cleanText(input.vin), mileage, cleanText(input.notes), now, now],
    );
    return loadVehicle(tx, id);
  });
}

export function updateVehicle(id: Id, patch: VehiclePatch): Promise<Vehicle> {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.plate !== undefined) set('plate', requirePlate(patch.plate));
  if (patch.make !== undefined) set('make', cleanText(patch.make));
  if (patch.model !== undefined) set('model', cleanText(patch.model));
  if (patch.year !== undefined) set('year', validYear(patch.year));
  if (patch.color !== undefined) set('color', cleanText(patch.color));
  if (patch.vin !== undefined) set('vin', cleanText(patch.vin));
  if (patch.mileage !== undefined) set('mileage', validMileage(patch.mileage, 'mileage'));
  if (patch.notes !== undefined) set('notes', cleanText(patch.notes));
  return write(['vehicle', 'rental'], async ({ tx, now }) => {
    await loadVehicle(tx, id);
    if (sets.length > 0) await tx.runAsync(`UPDATE vehicle SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, id]);
    const vehicle = await loadVehicle(tx, id);
    await refreshDraftSnapshots(tx, vehicle, now);
    return vehicle;
  });
}

/** Sets (or removes, with null) the vehicle's own photo. */
export async function setVehiclePhoto(id: Id, image: CapturedImage | null): Promise<Vehicle> {
  const apply = (path: string | null) =>
    write(['vehicle'], async (scope) => {
      const before = await loadVehicle(scope.tx, id);
      await scope.tx.runAsync(
        'UPDATE vehicle SET photo_path = ?, photo_byte_size = ?, photo_sha256 = ?, updated_at = ? WHERE id = ?',
        [path, image && path ? image.byteSize : null, image && path ? image.sha256 : null, scope.now, id],
      );
      deleteFilesLater(scope, [before.photo?.path]);
      return loadVehicle(scope.tx, id);
    });
  if (!image) return apply(null);
  const rel = vehiclePhotoPath(id, getPlatform().newId());
  return withImportedFile(image.tempUri, rel, () => apply(rel));
}

/**
 * Deletes a vehicle that was never used by a rental; otherwise archives it (hidden from
 * pickers, history kept). Refused while the vehicle is out.
 */
export function removeVehicle(id: Id): Promise<'deleted' | 'archived'> {
  return write(['vehicle'], async (scope) => {
    const vehicle = await loadVehicle(scope.tx, id);
    if (await loadOutInfo(scope.tx, id)) {
      throw new ConflictError('vehicle_out', 'This vehicle is out on a rental. Complete the return first.');
    }
    const used = await scope.tx.getFirstAsync<{ n: number }>(
      'SELECT (SELECT count(*) FROM rental WHERE vehicle_id = ?) + (SELECT count(*) FROM vehicle_damage WHERE vehicle_id = ?) AS n',
      [id, id],
    );
    if ((used?.n ?? 0) > 0) {
      await scope.tx.runAsync('UPDATE vehicle SET archived_at = coalesce(archived_at, ?), updated_at = ? WHERE id = ?', [scope.now, scope.now, id]);
      return 'archived';
    }
    await scope.tx.runAsync('DELETE FROM vehicle WHERE id = ?', [id]);
    deleteFilesLater(scope, [vehicle.photo?.path]);
    return 'deleted';
  });
}

export function archiveVehicle(id: Id): Promise<Vehicle> {
  return write(['vehicle'], async ({ tx, now }) => {
    await loadVehicle(tx, id);
    if (await loadOutInfo(tx, id)) {
      throw new ConflictError('vehicle_out', 'This vehicle is out on a rental. Complete the return first.');
    }
    await tx.runAsync('UPDATE vehicle SET archived_at = coalesce(archived_at, ?), updated_at = ? WHERE id = ?', [now, now, id]);
    return loadVehicle(tx, id);
  });
}

export function unarchiveVehicle(id: Id): Promise<Vehicle> {
  return write(['vehicle'], async ({ tx, now }) => {
    await loadVehicle(tx, id);
    await tx.runAsync('UPDATE vehicle SET archived_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
    return loadVehicle(tx, id);
  });
}
