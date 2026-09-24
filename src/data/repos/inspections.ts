/**
 * Inspections, photos and per-angle state (skips, compare review, overlay alignment).
 *
 * A pair key is (angle_key, slot). One canonical 'angle' photo per pair key per inspection;
 * close-ups are unlimited. BEFORE and AFTER photos with the same pair key form an AnglePair.
 * Frozen photos (signed pick-up, completed return, cancelled rental) never change or disappear.
 */
import type {
  Alignment,
  AngleGroup,
  AnglePair,
  CapturedImage,
  Id,
  Inspection,
  InspectionAngleState,
  InspectionAngleView,
  PairKey,
  Phase,
  Photo,
  PhotoKind,
  SkipReason,
} from '@/domain/types';
import { DASHBOARD_ANGLE_KEY, EXTERIOR_ANGLE_KEYS } from '@/domain/types';

import { getPlatform } from '../connection';
import { ConflictError, ImmutableError, ValidationError } from '../errors';
import { photoPath } from '../filePaths';
import type { SqlExecutor } from '../sql';
import { compactDamageSequence } from './damage';
import { assertPhaseEditable, isPhaseEditable } from './guards';
import {
  cleanText,
  mapInspection,
  mapInspectionAngle,
  mapPhoto,
  PHOTO_COLUMNS,
  read,
  requireRow,
  withImportedFile,
  write,
  type AngleRow,
  type InspectionAngleRow,
  type InspectionRow,
  type PhotoRow,
  type WriteScope,
} from './internal';
import { loadRentalFacts } from './rentalItems';

export interface AddPhotoInput {
  rentalId: Id;
  phase: Phase;
  image: CapturedImage;
  angleKey: string;
  /** Default 1. Repeated extras use nextFreeSlot(); return shots of a BEFORE extra reuse its slot. */
  slot?: number;
  /** Default 'angle' (the canonical shot of the pair key). */
  kind?: PhotoKind;
  label?: string | null;
}

const SKIP_REASONS: readonly SkipReason[] = ['blocked', 'too_dark', 'other'];

async function loadPhoto(db: SqlExecutor, id: Id): Promise<PhotoRow> {
  const row = await db.getFirstAsync<PhotoRow>(`SELECT ${PHOTO_COLUMNS} FROM photo p WHERE p.id = ?`, [id]);
  return requireRow(row, 'Photo', id);
}

async function findInspection(db: SqlExecutor, rentalId: Id, phase: Phase): Promise<InspectionRow | null> {
  return db.getFirstAsync<InspectionRow>('SELECT * FROM inspection WHERE rental_id = ? AND phase = ?', [rentalId, phase]);
}

async function ensureInspection(scope: WriteScope, rentalId: Id, phase: Phase): Promise<InspectionRow> {
  const existing = await findInspection(scope.tx, rentalId, phase);
  if (existing) return existing;
  const id = scope.newId();
  await scope.tx.runAsync('INSERT INTO inspection (id, rental_id, phase, started_at) VALUES (?, ?, ?, ?)', [id, rentalId, phase, scope.now]);
  return requireRow(await findInspection(scope.tx, rentalId, phase), 'Inspection', id);
}

function validSlot(slot: number | undefined): number {
  const s = slot ?? 1;
  if (!Number.isInteger(s) || s < 1) throw new ValidationError('Invalid slot', 'slot');
  return s;
}

async function assertAngle(db: SqlExecutor, key: string): Promise<AngleRow> {
  const angle = await db.getFirstAsync<AngleRow>('SELECT * FROM angle WHERE key = ?', [key]);
  if (!angle) throw new ValidationError(`Unknown angle ${key}`, 'angleKey');
  return angle;
}

async function nextCaptureOrder(tx: SqlExecutor, inspectionId: Id): Promise<number> {
  const row = await tx.getFirstAsync<{ n: number | null }>('SELECT max(capture_order) AS n FROM photo WHERE inspection_id = ?', [inspectionId]);
  return (row?.n ?? 0) + 1;
}

function deletePhotoFilesLater(scope: WriteScope, photos: readonly { id: string; file_path: string }[]): void {
  if (photos.length === 0) return;
  scope.afterCommit(async () => {
    const files = getPlatform().files;
    for (const p of photos) {
      await files.deleteFile(p.file_path);
      await files.deletePhotoDerivatives(p.id);
    }
  });
}

/** Idempotent: returns the existing inspection, or opens one while its phase is editable. */
export function startInspection(rentalId: Id, phase: Phase): Promise<Inspection> {
  return write(['inspection'], async (scope) => {
    const existing = await findInspection(scope.tx, rentalId, phase);
    if (existing) return mapInspection(existing);
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    assertPhaseEditable(facts, phase);
    return mapInspection(await ensureInspection(scope, rentalId, phase));
  });
}

export function getInspection(rentalId: Id, phase: Phase): Promise<Inspection | null> {
  return read(async (db) => {
    const row = await findInspection(db, rentalId, phase);
    return row ? mapInspection(row) : null;
  });
}

/** Stores a captured photo (write protocol) and clears a skip on its pair key. */
export async function addPhoto(input: AddPhotoInput): Promise<Photo> {
  const slot = validSlot(input.slot);
  const kind: PhotoKind = input.kind ?? 'angle';
  if (kind !== 'angle' && kind !== 'damage_closeup') throw new ValidationError(`Unknown photo kind ${kind as string}`, 'kind');
  const id = getPlatform().newId();
  const rel = photoPath(input.rentalId, id);
  return withImportedFile(input.image.tempUri, rel, () =>
    write(['photo', 'inspection'], async (scope) => {
      const { tx, now } = scope;
      await assertAngle(tx, input.angleKey);
      const { facts } = await loadRentalFacts(tx, input.rentalId);
      assertPhaseEditable(facts, input.phase);
      const inspection = await ensureInspection(scope, input.rentalId, input.phase);
      if (kind === 'angle') {
        const taken = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM photo WHERE inspection_id = ? AND kind = 'angle' AND angle_key = ? AND slot = ?",
          [inspection.id, input.angleKey, slot],
        );
        if (taken) throw new ConflictError('photo_exists', 'This angle already has a photo. Retake it instead.');
      }
      const img = input.image;
      await tx.runAsync(
        `INSERT INTO photo (id, rental_id, inspection_id, phase, kind, angle_key, slot, label, capture_order, captured_at,
           tz_offset_min, file_path, width, height, byte_size, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.rentalId, inspection.id, input.phase, kind, input.angleKey, slot, cleanText(input.label),
          await nextCaptureOrder(tx, inspection.id), img.capturedAt, img.tzOffsetMin, rel, img.width, img.height,
          img.byteSize, img.sha256, now,
        ],
      );
      if (kind === 'angle') {
        await tx.runAsync(
          'UPDATE inspection_angle SET skipped_at = NULL, skip_reason = NULL, updated_at = ? ' +
            'WHERE inspection_id = ? AND angle_key = ? AND slot = ? AND skipped_at IS NOT NULL',
          [now, inspection.id, input.angleKey, slot],
        );
      }
      return mapPhoto(await loadPhoto(tx, id));
    }),
  );
}

/**
 * Retake (DECISIONS §Data 1): the new photo replaces the old one on the same pair key; damage
 * marks carry over with their normalized rings (the UI asks the employee to check them) and
 * the old file is deleted after commit. Frozen photos can never be retaken.
 */
export async function retakePhoto(photoId: Id, image: CapturedImage): Promise<Photo> {
  const current = await read((db) => loadPhoto(db, photoId));
  if (current.frozen_at !== null) throw new ImmutableError('This photo is part of signed or completed evidence.');
  const id = getPlatform().newId();
  const rel = photoPath(current.rental_id, id);
  return withImportedFile(image.tempUri, rel, () =>
    write(['photo', 'damage'], async (scope) => {
      const { tx, now } = scope;
      const old = await loadPhoto(tx, photoId);
      if (old.frozen_at !== null) throw new ImmutableError('This photo is part of signed or completed evidence.');
      const { facts } = await loadRentalFacts(tx, old.rental_id);
      assertPhaseEditable(facts, old.phase);
      // The damage rows point at the old row until they are re-pointed below.
      await tx.execAsync('PRAGMA defer_foreign_keys = ON');
      await tx.runAsync('DELETE FROM photo WHERE id = ?', [old.id]);
      await tx.runAsync(
        `INSERT INTO photo (id, rental_id, inspection_id, phase, kind, angle_key, slot, label, capture_order, captured_at,
           tz_offset_min, file_path, width, height, byte_size, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, old.rental_id, old.inspection_id, old.phase, old.kind, old.angle_key, old.slot, old.label,
          await nextCaptureOrder(tx, old.inspection_id), image.capturedAt, image.tzOffsetMin, rel, image.width,
          image.height, image.byteSize, image.sha256, now,
        ],
      );
      for (const column of ['before_photo_id', 'after_photo_id', 'closeup_photo_id']) {
        await tx.runAsync(`UPDATE damage SET ${column} = ?, updated_at = ? WHERE ${column} = ?`, [id, now, old.id]);
      }
      deletePhotoFilesLater(scope, [old]);
      return mapPhoto(await loadPhoto(tx, id));
    }),
  );
}

/**
 * Deletes an unfrozen photo. Marks drawn on it are deleted with it; close-up links and the
 * BEFORE link of return marks are cleared.
 */
export function deletePhoto(photoId: Id): Promise<void> {
  return write(['photo', 'damage'], async (scope) => {
    const { tx, now } = scope;
    const photo = await loadPhoto(tx, photoId);
    if (photo.frozen_at !== null) throw new ImmutableError('This photo is part of signed or completed evidence.');
    const { facts } = await loadRentalFacts(tx, photo.rental_id);
    assertPhaseEditable(facts, photo.phase);
    const ringColumn = photo.phase === 'before' ? 'before_photo_id' : 'after_photo_id';
    const marks = await tx.getAllAsync<{ id: string; status: string }>(
      `SELECT id, status FROM damage WHERE ${ringColumn} = ? AND found_phase = ?`,
      [photo.id, photo.phase],
    );
    await tx.runAsync(`DELETE FROM damage WHERE ${ringColumn} = ? AND found_phase = ?`, [photo.id, photo.phase]);
    await tx.runAsync('UPDATE damage SET closeup_photo_id = NULL, updated_at = ? WHERE closeup_photo_id = ?', [now, photo.id]);
    if (photo.phase === 'before') {
      await tx.runAsync("UPDATE damage SET before_photo_id = NULL, updated_at = ? WHERE before_photo_id = ? AND found_phase = 'after'", [now, photo.id]);
    }
    await tx.runAsync('DELETE FROM photo WHERE id = ?', [photo.id]);
    if (marks.some((m) => m.status === 'pre_existing')) await compactDamageSequence(tx, photo.rental_id, 'letters', now);
    if (marks.some((m) => m.status !== 'pre_existing')) await compactDamageSequence(tx, photo.rental_id, 'numbers', now);
    deletePhotoFilesLater(scope, [photo]);
  });
}

export function getPhoto(id: Id): Promise<Photo> {
  return read(async (db) => mapPhoto(await loadPhoto(db, id)));
}

export function listPhotos(rentalId: Id, filter: { phase?: Phase; kind?: PhotoKind } = {}): Promise<Photo[]> {
  return read(async (db) => {
    const where = ['p.rental_id = ?'];
    const params: string[] = [rentalId];
    if (filter.phase) {
      where.push('p.phase = ?');
      params.push(filter.phase);
    }
    if (filter.kind) {
      where.push('p.kind = ?');
      params.push(filter.kind);
    }
    const rows = await db.getAllAsync<PhotoRow>(
      `SELECT ${PHOTO_COLUMNS} FROM photo p WHERE ${where.join(' AND ')} ORDER BY p.phase = 'after', p.capture_order`,
      params,
    );
    return rows.map(mapPhoto);
  });
}

/** Next unused slot of an angle across both inspections (repeated extras: "Close-up 2"). */
export function nextFreeSlot(rentalId: Id, angleKey: string): Promise<number> {
  return read(async (db) => {
    const row = await db.getFirstAsync<{ n: number | null }>(
      `SELECT max(slot) AS n FROM (
         SELECT slot FROM photo WHERE rental_id = ? AND angle_key = ? AND kind = 'angle'
         UNION ALL SELECT ia.slot FROM inspection_angle ia JOIN inspection i ON i.id = ia.inspection_id
           WHERE i.rental_id = ? AND ia.angle_key = ?)`,
      [rentalId, angleKey, rentalId, angleKey],
    );
    return (row?.n ?? 0) + 1;
  });
}

async function upsertAngleState(
  tx: SqlExecutor,
  inspectionId: Id,
  key: PairKey,
  now: number,
  set: { skippedAt?: number | null; skipReason?: SkipReason | null; reviewedAt?: number | null; alignment?: string | null },
): Promise<void> {
  await tx.runAsync(
    'INSERT OR IGNORE INTO inspection_angle (inspection_id, angle_key, slot, updated_at) VALUES (?, ?, ?, ?)',
    [inspectionId, key.angleKey, key.slot, now],
  );
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (set.skippedAt !== undefined) {
    sets.push('skipped_at = ?');
    params.push(set.skippedAt);
  }
  if (set.skipReason !== undefined) {
    sets.push('skip_reason = ?');
    params.push(set.skipReason);
  }
  if (set.reviewedAt !== undefined) {
    sets.push('reviewed_at = ?');
    params.push(set.reviewedAt);
  }
  if (set.alignment !== undefined) {
    sets.push('alignment_json = ?');
    params.push(set.alignment);
  }
  await tx.runAsync(
    `UPDATE inspection_angle SET ${[...sets, 'updated_at = ?'].join(', ')} WHERE inspection_id = ? AND angle_key = ? AND slot = ?`,
    [...params, now, inspectionId, key.angleKey, key.slot],
  );
}

/** Skip an angle (reason optional) or, with `false`, un-skip it. A photographed angle cannot be skipped. */
export function setAngleSkipped(rentalId: Id, phase: Phase, key: PairKey, skip: { reason: SkipReason | null } | false): Promise<void> {
  if (skip && skip.reason !== null && !SKIP_REASONS.includes(skip.reason)) {
    throw new ValidationError(`Unknown skip reason ${skip.reason as string}`, 'reason');
  }
  const slot = validSlot(key.slot);
  return write(['inspection'], async (scope) => {
    await assertAngle(scope.tx, key.angleKey);
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    assertPhaseEditable(facts, phase);
    const inspection = await ensureInspection(scope, rentalId, phase);
    if (skip) {
      const photo = await scope.tx.getFirstAsync<{ id: string }>(
        "SELECT id FROM photo WHERE inspection_id = ? AND kind = 'angle' AND angle_key = ? AND slot = ?",
        [inspection.id, key.angleKey, slot],
      );
      if (photo) throw new ConflictError('photo_exists', 'This angle already has a photo.');
    }
    await upsertAngleState(scope.tx, inspection.id, { angleKey: key.angleKey, slot }, scope.now, {
      skippedAt: skip ? scope.now : null,
      skipReason: skip ? skip.reason : null,
    });
  });
}

/** Compare "viewed ✓". A no-op when the return is not editable (read-only compare). */
export function markPairReviewed(rentalId: Id, key: PairKey): Promise<void> {
  return write(['inspection'], async (scope) => {
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    if (!isPhaseEditable(facts, 'after')) return;
    const inspection = await ensureInspection(scope, rentalId, 'after');
    await upsertAngleState(scope.tx, inspection.id, key, scope.now, { reviewedAt: scope.now });
  });
}

/** Saves (or clears) the BEFORE->AFTER overlay alignment of a pair on the AFTER inspection. */
export function setPairAlignment(rentalId: Id, key: PairKey, alignment: Alignment | null): Promise<void> {
  if (alignment && ![alignment.dx, alignment.dy, alignment.scale].every(Number.isFinite)) {
    throw new ValidationError('Invalid alignment', 'alignment');
  }
  return write(['inspection'], async (scope) => {
    const { facts } = await loadRentalFacts(scope.tx, rentalId);
    assertPhaseEditable(facts, 'after');
    const inspection = await ensureInspection(scope, rentalId, 'after');
    await upsertAngleState(scope.tx, inspection.id, key, scope.now, {
      alignment: alignment ? JSON.stringify({ dx: alignment.dx, dy: alignment.dy, scale: alignment.scale }) : null,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Views

interface AngleCatalog {
  byKey: Map<string, AngleRow>;
}

async function loadCatalog(db: SqlExecutor): Promise<AngleCatalog> {
  const rows = await db.getAllAsync<AngleRow>('SELECT * FROM angle');
  return { byKey: new Map(rows.map((r) => [r.key, r])) };
}

function pairLabel(catalog: AngleCatalog, key: PairKey, photoLabel: string | null): string {
  if (photoLabel) return photoLabel;
  const base = catalog.byKey.get(key.angleKey)?.label ?? key.angleKey;
  return key.slot > 1 ? `${base} ${key.slot}` : base;
}

const pairId = (k: PairKey) => `${k.angleKey}#${k.slot}`;

function sortPairs<T extends PairKey>(catalog: AngleCatalog, pairs: T[]): T[] {
  return pairs.sort((a, b) => {
    const sa = catalog.byKey.get(a.angleKey)?.sort_order ?? 10_000;
    const sb = catalog.byKey.get(b.angleKey)?.sort_order ?? 10_000;
    return sa - sb || a.angleKey.localeCompare(b.angleKey) || a.slot - b.slot;
  });
}

const BASE_KEYS: readonly string[] = [...EXTERIOR_ANGLE_KEYS, DASHBOARD_ANGLE_KEY];

/**
 * Capture diagram / condition grid for one inspection: the 8 exterior angles and the dashboard
 * always, plus every extra that has a photo or state, in walk-around order.
 */
export function listInspectionAngles(rentalId: Id, phase: Phase): Promise<InspectionAngleView[]> {
  return read(async (db) => {
    const catalog = await loadCatalog(db);
    const photos = (
      await db.getAllAsync<PhotoRow>(
        `SELECT ${PHOTO_COLUMNS} FROM photo p WHERE p.rental_id = ? AND p.phase = ? AND p.kind = 'angle'`,
        [rentalId, phase],
      )
    ).map(mapPhoto);
    const states = (
      await db.getAllAsync<InspectionAngleRow>(
        'SELECT ia.* FROM inspection_angle ia JOIN inspection i ON i.id = ia.inspection_id WHERE i.rental_id = ? AND i.phase = ?',
        [rentalId, phase],
      )
    ).map(mapInspectionAngle);
    const counts = await db.getAllAsync<{ angle_key: string; slot: number; n: number }>(
      'SELECT angle_key, slot, count(*) AS n FROM damage WHERE rental_id = ? AND found_phase = ? GROUP BY angle_key, slot',
      [rentalId, phase],
    );
    const keys = new Map<string, PairKey>();
    for (const k of BASE_KEYS) keys.set(pairId({ angleKey: k, slot: 1 }), { angleKey: k, slot: 1 });
    for (const p of [...photos, ...states]) keys.set(pairId(p), { angleKey: p.angleKey, slot: p.slot });
    const views = [...keys.values()].map((key): InspectionAngleView => {
      const photo = photos.find((p) => pairId(p) === pairId(key)) ?? null;
      return {
        angleKey: key.angleKey,
        slot: key.slot,
        label: pairLabel(catalog, key, photo?.label ?? null),
        group: (catalog.byKey.get(key.angleKey)?.angle_group ?? 'extra') as AngleGroup,
        photo,
        state: states.find((s) => pairId(s) === pairId(key)) ?? null,
        damageCount: counts.find((c) => c.angle_key === key.angleKey && c.slot === key.slot)?.n ?? 0,
      };
    });
    return sortPairs(catalog, views);
  });
}

/**
 * BEFORE <-> AFTER pairing per pair key: the 8 exterior angles always, plus the dashboard and
 * extras photographed or skipped in either phase. Unpaired extras have one side null.
 */
export function getAnglePairs(rentalId: Id): Promise<AnglePair[]> {
  return read(async (db) => {
    const catalog = await loadCatalog(db);
    const photos = (
      await db.getAllAsync<PhotoRow>(`SELECT ${PHOTO_COLUMNS} FROM photo p WHERE p.rental_id = ? AND p.kind = 'angle'`, [rentalId])
    ).map(mapPhoto);
    const states = await db.getAllAsync<InspectionAngleRow & { phase: Phase }>(
      'SELECT ia.*, i.phase FROM inspection_angle ia JOIN inspection i ON i.id = ia.inspection_id WHERE i.rental_id = ?',
      [rentalId],
    );
    const counts = await db.getAllAsync<{ angle_key: string; slot: number; status: string; n: number }>(
      'SELECT angle_key, slot, status, count(*) AS n FROM damage WHERE rental_id = ? GROUP BY angle_key, slot, status',
      [rentalId],
    );
    const keys = new Map<string, PairKey>();
    for (const k of EXTERIOR_ANGLE_KEYS) keys.set(pairId({ angleKey: k, slot: 1 }), { angleKey: k, slot: 1 });
    for (const p of photos) keys.set(pairId(p), { angleKey: p.angleKey, slot: p.slot });
    for (const s of states) keys.set(pairId({ angleKey: s.angle_key, slot: s.slot }), { angleKey: s.angle_key, slot: s.slot });

    const stateOf = (key: PairKey, phase: Phase): InspectionAngleState | null => {
      const row = states.find((s) => s.phase === phase && s.angle_key === key.angleKey && s.slot === key.slot);
      return row ? mapInspectionAngle(row) : null;
    };
    const count = (key: PairKey, status: string) =>
      counts.find((c) => c.angle_key === key.angleKey && c.slot === key.slot && c.status === status)?.n ?? 0;

    const pairs = [...keys.values()].map((key): AnglePair => {
      const before = photos.find((p) => p.phase === 'before' && pairId(p) === pairId(key)) ?? null;
      const after = photos.find((p) => p.phase === 'after' && pairId(p) === pairId(key)) ?? null;
      return {
        angleKey: key.angleKey,
        slot: key.slot,
        label: pairLabel(catalog, key, before?.label ?? after?.label ?? null),
        group: (catalog.byKey.get(key.angleKey)?.angle_group ?? 'extra') as AngleGroup,
        before,
        after,
        beforeState: stateOf(key, 'before'),
        afterState: stateOf(key, 'after'),
        existingDamageCount: count(key, 'pre_existing'),
        newDamageCount: count(key, 'new'),
        uncertainDamageCount: count(key, 'uncertain'),
      };
    });
    return sortPairs(catalog, pairs);
  });
}
