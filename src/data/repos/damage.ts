/**
 * Damage observations and the per-vehicle known-damage identities.
 *
 * Numbering (DECISIONS): pre-existing damage is lettered per rental (number 1 = "A"); new and
 * uncertain share one numeric sequence, so flipping between them keeps the number. Moving to the
 * other sequence ("Was there") takes max + 1 there; deletes and moves compact editable rows only.
 */
import { compactSequence, damageSequence, nextSequenceNumber, type DamageSequence } from '@/domain/damage';
import type {
  Damage,
  DamageMarker,
  DamageSeverity,
  DamageStatus,
  DamageType,
  Id,
  KnownDamageItem,
  KnownDamageResolution,
  Phase,
} from '@/domain/types';
import { DAMAGE_TYPES } from '@/domain/types';

import { ConflictError, InvalidStateError, ValidationError } from '../errors';
import type { SqlExecutor } from '../sql';
import { assertPhaseEditable, isPhaseEditable } from './guards';
import {
  cleanText,
  DAMAGE_COLUMNS,
  mapDamage,
  mapPhoto,
  mapVehicleDamage,
  PHOTO_COLUMNS,
  read,
  requireRow,
  write,
  type DamageRow,
  type PhotoRow,
  type VehicleDamageRow,
} from './internal';
import { loadRentalFacts } from './rentalItems';

export interface NewDamageInput {
  /** The canonical angle photo the ring is drawn on (BEFORE for pick-up, AFTER for return). */
  photoId: Id;
  marker: DamageMarker;
  /** Return marks only: 'new' (default), 'uncertain' or 'pre_existing' ("Was there"). */
  status?: DamageStatus;
  type?: DamageType | null;
  severity?: DamageSeverity | null;
  locationLabel?: string | null;
  note?: string | null;
  closeupPhotoId?: Id | null;
}

export interface DamagePatch {
  status?: DamageStatus;
  type?: DamageType | null;
  severity?: DamageSeverity | null;
  locationLabel?: string | null;
  note?: string | null;
  marker?: DamageMarker;
  closeupPhotoId?: Id | null;
}

const SEVERITIES: readonly DamageSeverity[] = ['minor', 'moderate', 'severe'];
const STATUSES: readonly DamageStatus[] = ['pre_existing', 'new', 'uncertain'];

function isRing(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as { x?: unknown; y?: unknown; r?: unknown };
  return (
    typeof r.x === 'number' && typeof r.y === 'number' && typeof r.r === 'number' &&
    r.x >= 0 && r.x <= 1 && r.y >= 0 && r.y <= 1 && r.r > 0 && r.r <= 1
  );
}

function validMarker(marker: DamageMarker): string {
  if (marker?.v !== 1 || !isRing(marker.ring) || (marker.counterpart !== undefined && !isRing(marker.counterpart))) {
    throw new ValidationError('Invalid damage marker', 'marker');
  }
  const clean: DamageMarker = marker.counterpart ? { v: 1, ring: marker.ring, counterpart: marker.counterpart } : { v: 1, ring: marker.ring };
  return JSON.stringify(clean);
}

function validType(type: DamageType | null | undefined): DamageType | null {
  if (type === null || type === undefined) return null;
  if (!DAMAGE_TYPES.includes(type)) throw new ValidationError(`Unknown damage type ${type}`, 'type');
  return type;
}

function validSeverity(severity: DamageSeverity | null | undefined): DamageSeverity | null {
  if (severity === null || severity === undefined) return null;
  if (!SEVERITIES.includes(severity)) throw new ValidationError(`Unknown severity ${severity}`, 'severity');
  return severity;
}

async function loadDamage(db: SqlExecutor, id: Id): Promise<Damage> {
  const row = await db.getFirstAsync<DamageRow>(`SELECT ${DAMAGE_COLUMNS} FROM damage d WHERE d.id = ?`, [id]);
  return mapDamage(requireRow(row, 'Damage', id));
}

const inSequence = (seq: DamageSequence) => (seq === 'letters' ? "d.status = 'pre_existing'" : "d.status <> 'pre_existing'");

async function nextNumber(tx: SqlExecutor, rentalId: Id, seq: DamageSequence): Promise<number> {
  const rows = await tx.getAllAsync<{ number: number }>(
    `SELECT d.number FROM damage d WHERE d.rental_id = ? AND ${inSequence(seq)}`,
    [rentalId],
  );
  return nextSequenceNumber(rows.map((r) => r.number));
}

/** Closes gaps in one sequence; rows of a locked phase never move (the triggers would refuse). */
export async function compactDamageSequence(tx: SqlExecutor, rentalId: Id, seq: DamageSequence, now: number): Promise<void> {
  const { facts } = await loadRentalFacts(tx, rentalId);
  const rows = await tx.getAllAsync<{ id: string; number: number; found_phase: Phase }>(
    `SELECT d.id, d.number, d.found_phase FROM damage d WHERE d.rental_id = ? AND ${inSequence(seq)}`,
    [rentalId],
  );
  const changes = compactSequence(rows.map((r) => ({ id: r.id, number: r.number, locked: !isPhaseEditable(facts, r.found_phase) })));
  // Ascending order: each target number is already free (numbers only decrease).
  for (const c of changes) {
    await tx.runAsync('UPDATE damage SET number = ?, updated_at = ? WHERE id = ?', [c.number, now, c.id]);
  }
}

async function loadAnglePhoto(tx: SqlExecutor, photoId: Id): Promise<PhotoRow> {
  const row = requireRow(await tx.getFirstAsync<PhotoRow>(`SELECT ${PHOTO_COLUMNS} FROM photo p WHERE p.id = ?`, [photoId]), 'Photo', photoId);
  if (row.kind !== 'angle') throw new ValidationError('Damage is marked on an angle photo, not on a close-up', 'photoId');
  return row;
}

async function assertCloseup(tx: SqlExecutor, rentalId: Id, closeupId: Id | null): Promise<Id | null> {
  if (closeupId === null) return null;
  const row = await tx.getFirstAsync<{ rental_id: string; kind: string }>('SELECT rental_id, kind FROM photo WHERE id = ?', [closeupId]);
  if (!row || row.rental_id !== rentalId || row.kind !== 'damage_closeup') {
    throw new ValidationError('The close-up must be a close-up photo of this rental', 'closeupPhotoId');
  }
  return closeupId;
}

/** Pins a new damage on a photo. Pick-up marks are always pre-existing. */
export function addDamage(input: NewDamageInput): Promise<Damage> {
  const markerJson = validMarker(input.marker);
  const type = validType(input.type);
  const severity = validSeverity(input.severity);
  return write(['damage'], async ({ tx, now, newId }) => {
    const photo = await loadAnglePhoto(tx, input.photoId);
    const { row: rental, facts } = await loadRentalFacts(tx, photo.rental_id);
    assertPhaseEditable(facts, photo.phase);
    if (!rental.vehicle_id) throw new InvalidStateError('Choose a vehicle before marking damage');

    let status: DamageStatus;
    if (photo.phase === 'before') {
      if (input.status && input.status !== 'pre_existing') {
        throw new ValidationError('Damage marked at pick-up is always pre-existing', 'status');
      }
      status = 'pre_existing';
    } else {
      status = input.status ?? 'new';
      if (!STATUSES.includes(status)) throw new ValidationError(`Unknown status ${status}`, 'status');
    }

    let beforePhotoId: string | null = photo.id;
    let afterPhotoId: string | null = null;
    if (photo.phase === 'after') {
      afterPhotoId = photo.id;
      const pair = await tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM photo WHERE rental_id = ? AND phase = 'before' AND kind = 'angle' AND angle_key = ? AND slot = ?",
        [photo.rental_id, photo.angle_key, photo.slot],
      );
      beforePhotoId = pair?.id ?? null;
    }
    const closeup = await assertCloseup(tx, photo.rental_id, input.closeupPhotoId ?? null);

    const identityId = newId();
    await tx.runAsync('INSERT INTO vehicle_damage (id, vehicle_id, created_at, updated_at) VALUES (?, ?, ?, ?)', [
      identityId,
      rental.vehicle_id,
      now,
      now,
    ]);
    const id = newId();
    await tx.runAsync(
      `INSERT INTO damage (id, rental_id, vehicle_id, vehicle_damage_id, found_phase, status, number, angle_key, slot,
         type, severity, location_label, note, before_photo_id, after_photo_id, closeup_photo_id, marker_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, photo.rental_id, rental.vehicle_id, identityId, photo.phase, status,
        await nextNumber(tx, photo.rental_id, damageSequence(status)),
        photo.angle_key, photo.slot, type, severity, cleanText(input.locationLabel), cleanText(input.note),
        beforePhotoId, afterPhotoId, closeup, markerJson, now, now,
      ],
    );
    return loadDamage(tx, id);
  });
}

export function updateDamage(id: Id, patch: DamagePatch): Promise<Damage> {
  const markerJson = patch.marker !== undefined ? validMarker(patch.marker) : undefined;
  const type = patch.type !== undefined ? validType(patch.type) : undefined;
  const severity = patch.severity !== undefined ? validSeverity(patch.severity) : undefined;
  return write(['damage'], async ({ tx, now }) => {
    const current = await loadDamage(tx, id);
    const { facts } = await loadRentalFacts(tx, current.rentalId);
    assertPhaseEditable(facts, current.foundPhase);

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (column: string, value: string | number | null) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (type !== undefined) set('type', type);
    if (severity !== undefined) set('severity', severity);
    if (patch.locationLabel !== undefined) set('location_label', cleanText(patch.locationLabel));
    if (patch.note !== undefined) set('note', cleanText(patch.note));
    if (markerJson !== undefined) set('marker_json', markerJson);
    if (patch.closeupPhotoId !== undefined) set('closeup_photo_id', await assertCloseup(tx, current.rentalId, patch.closeupPhotoId));

    let movedFrom: DamageSequence | null = null;
    if (patch.status !== undefined && patch.status !== current.status) {
      if (!STATUSES.includes(patch.status)) throw new ValidationError(`Unknown status ${patch.status}`, 'status');
      if (current.foundPhase === 'before') throw new ValidationError('Damage marked at pick-up is always pre-existing', 'status');
      set('status', patch.status);
      const from = damageSequence(current.status);
      const to = damageSequence(patch.status);
      if (from !== to) {
        set('number', await nextNumber(tx, current.rentalId, to));
        movedFrom = from;
      }
    }
    if (sets.length === 0) return current;
    await tx.runAsync(`UPDATE damage SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, id]);
    if (movedFrom) await compactDamageSequence(tx, current.rentalId, movedFrom, now);
    return loadDamage(tx, id);
  });
}

/** Deletes one observation (the known-damage identity goes with its last observation). */
export function deleteDamage(id: Id): Promise<void> {
  return write(['damage'], async ({ tx, now }) => {
    const current = await loadDamage(tx, id);
    const { facts } = await loadRentalFacts(tx, current.rentalId);
    assertPhaseEditable(facts, current.foundPhase);
    await tx.runAsync('DELETE FROM damage WHERE id = ?', [id]);
    await compactDamageSequence(tx, current.rentalId, damageSequence(current.status), now);
  });
}

export function getDamage(id: Id): Promise<Damage> {
  return read((db) => loadDamage(db, id));
}

/** Rental's damage: letters first (A, B…), then the shared new/uncertain sequence. */
export function listDamage(rentalId: Id, filter: { phase?: Phase; photoId?: Id } = {}): Promise<Damage[]> {
  return read(async (db) => {
    const where = ['d.rental_id = ?'];
    const params: string[] = [rentalId];
    if (filter.phase) {
      where.push('d.found_phase = ?');
      params.push(filter.phase);
    }
    if (filter.photoId) {
      where.push('(d.before_photo_id = ? OR d.after_photo_id = ?)');
      params.push(filter.photoId, filter.photoId);
    }
    const rows = await db.getAllAsync<DamageRow>(
      `SELECT ${DAMAGE_COLUMNS} FROM damage d WHERE ${where.join(' AND ')}
       ORDER BY d.status <> 'pre_existing', d.number`,
      params,
    );
    return rows.map(mapDamage);
  });
}

// ---------------------------------------------------------------------------------------------
// Known damage

/**
 * Open (unresolved) identities of a vehicle with their latest observation. With `rentalId`,
 * observations of that rental are left out of "latest" and returned as observationInRental,
 * and identities resolved during that rental are included (so the UI can undo).
 */
export async function loadKnownDamage(db: SqlExecutor, vehicleId: Id, rentalId: Id | null): Promise<KnownDamageItem[]> {
  const identities = await db.getAllAsync<VehicleDamageRow>(
    `SELECT * FROM vehicle_damage WHERE vehicle_id = ? AND (resolved_at IS NULL OR resolved_rental_id IS ?)
     ORDER BY created_at`,
    [vehicleId, rentalId],
  );
  const items: KnownDamageItem[] = [];
  for (const identity of identities) {
    if (identity.resolved_at !== null && (rentalId === null || identity.resolved_rental_id !== rentalId)) continue;
    const observations = (
      await db.getAllAsync<DamageRow>(
        `SELECT ${DAMAGE_COLUMNS} FROM damage d WHERE d.vehicle_damage_id = ? ORDER BY d.created_at DESC`,
        [identity.id],
      )
    ).map(mapDamage);
    const previous = rentalId ? observations.filter((o) => o.rentalId !== rentalId) : observations;
    const latest = previous[0];
    if (!latest) continue;
    const ringPhotoId = latest.foundPhase === 'before' ? latest.beforePhotoId : latest.afterPhotoId;
    const photo = ringPhotoId
      ? await db.getFirstAsync<PhotoRow>(`SELECT ${PHOTO_COLUMNS} FROM photo p WHERE p.id = ?`, [ringPhotoId])
      : null;
    if (!photo) continue;
    const item: KnownDamageItem = {
      vehicleDamage: mapVehicleDamage(identity),
      latest,
      latestPhoto: mapPhoto(photo),
      firstFoundAt: observations[observations.length - 1].createdAt,
    };
    if (rentalId) item.observationInRental = observations.find((o) => o.rentalId === rentalId) ?? null;
    items.push(item);
  }
  return items;
}

export function listKnownDamage(vehicleId: Id): Promise<KnownDamageItem[]> {
  return read((db) => loadKnownDamage(db, vehicleId, null));
}

/** Known damage of the rental's vehicle for the pick-up carry-over banner. */
export function listKnownDamageForRental(rentalId: Id): Promise<KnownDamageItem[]> {
  return read(async (db) => {
    const row = await db.getFirstAsync<{ vehicle_id: string | null }>('SELECT vehicle_id FROM rental WHERE id = ?', [rentalId]);
    const vehicleId = requireRow(row, 'Rental', rentalId).vehicle_id;
    return vehicleId ? loadKnownDamage(db, vehicleId, rentalId) : [];
  });
}

/**
 * "Still there": records a new pre-existing observation of a known damage on this rental's
 * BEFORE photo, copying type, severity, location and note from the latest observation.
 */
export function confirmKnownDamage(rentalId: Id, vehicleDamageId: Id, beforePhotoId: Id, marker: DamageMarker): Promise<Damage> {
  const markerJson = validMarker(marker);
  return write(['damage'], async ({ tx, now, newId }) => {
    const { row: rental, facts } = await loadRentalFacts(tx, rentalId);
    assertPhaseEditable(facts, 'before');
    const identity = requireRow(
      await tx.getFirstAsync<VehicleDamageRow>('SELECT * FROM vehicle_damage WHERE id = ?', [vehicleDamageId]),
      'Known damage',
      vehicleDamageId,
    );
    if (identity.vehicle_id !== rental.vehicle_id) throw new ValidationError('This damage belongs to another vehicle');
    if (identity.resolved_at !== null) throw new InvalidStateError('This damage was marked repaired or gone');
    const already = await tx.getFirstAsync<{ id: string }>('SELECT id FROM damage WHERE vehicle_damage_id = ? AND rental_id = ?', [
      vehicleDamageId,
      rentalId,
    ]);
    if (already) throw new ConflictError('duplicate', 'This damage is already confirmed for this rental');
    const photo = await loadAnglePhoto(tx, beforePhotoId);
    if (photo.rental_id !== rentalId || photo.phase !== 'before') {
      throw new ValidationError('Use a pick-up photo of this rental', 'beforePhotoId');
    }
    const latest = requireRow(
      await tx.getFirstAsync<DamageRow>(
        `SELECT ${DAMAGE_COLUMNS} FROM damage d WHERE d.vehicle_damage_id = ? ORDER BY d.created_at DESC LIMIT 1`,
        [vehicleDamageId],
      ),
      'Damage observation',
      vehicleDamageId,
    );
    const id = newId();
    await tx.runAsync(
      `INSERT INTO damage (id, rental_id, vehicle_id, vehicle_damage_id, found_phase, status, number, angle_key, slot,
         type, severity, location_label, note, before_photo_id, after_photo_id, closeup_photo_id, marker_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'before', 'pre_existing', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      [
        id, rentalId, identity.vehicle_id, vehicleDamageId, await nextNumber(tx, rentalId, 'letters'),
        photo.angle_key, photo.slot, latest.type, latest.severity, latest.location_label, latest.note,
        photo.id, markerJson, now, now,
      ],
    );
    return loadDamage(tx, id);
  });
}

/** "Repaired / gone" (or null to reopen). Resolution is vehicle history, not rental evidence. */
export function resolveKnownDamage(
  vehicleDamageId: Id,
  resolution: KnownDamageResolution | null,
  options: { note?: string | null; rentalId?: Id | null } = {},
): Promise<void> {
  if (resolution !== null && resolution !== 'repaired' && resolution !== 'not_found') {
    throw new ValidationError(`Unknown resolution ${resolution as string}`, 'resolution');
  }
  return write(['damage', 'vehicle'], async ({ tx, now }) => {
    requireRow(await tx.getFirstAsync<{ id: string }>('SELECT id FROM vehicle_damage WHERE id = ?', [vehicleDamageId]), 'Known damage', vehicleDamageId);
    await tx.runAsync(
      'UPDATE vehicle_damage SET resolved_at = ?, resolution = ?, resolution_note = ?, resolved_rental_id = ?, updated_at = ? WHERE id = ?',
      resolution === null
        ? [null, null, null, null, now, vehicleDamageId]
        : [now, resolution, cleanText(options.note), options.rentalId ?? null, now, vehicleDamageId],
    );
  });
}
