/**
 * Generated artifacts: evidence images (per pair key), contact sheet, report PDF and signed
 * contract PDFs. They are derived and regenerable: one row per target, keyed for staleness by
 * the generator's opaque source fingerprint (e.g. evidenceFingerprint()).
 */
import type { ArtifactTarget, CapturedFile, EpochMs, GeneratedArtifact, Id } from '@/domain/types';

import { getPlatform } from '../connection';
import { ValidationError } from '../errors';
import { artifactPath } from '../filePaths';
import type { SqlExecutor } from '../sql';
import { deleteFilesLater, mapArtifact, read, requireRow, withImportedFile, write, type ArtifactRow } from './internal';

export type ArtifactMimeType = 'image/jpeg' | 'application/pdf';

export interface ArtifactFile extends CapturedFile {
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
}

export interface ArtifactMeta {
  mimeType: ArtifactMimeType;
  sourceFingerprint: string;
  generatedAt?: EpochMs;
}

export type ArtifactStatus = 'missing' | 'stale' | 'fresh';

function targetColumns(target: ArtifactTarget): { angleKey: string | null; slot: number | null; contractId: string | null } {
  switch (target.kind) {
    case 'evidence_image':
      return { angleKey: target.pairKey.angleKey, slot: target.pairKey.slot, contractId: null };
    case 'contract_pdf':
      return { angleKey: null, slot: null, contractId: target.contractId };
    default:
      return { angleKey: null, slot: null, contractId: null };
  }
}

async function findArtifact(db: SqlExecutor, rentalId: Id, target: ArtifactTarget): Promise<ArtifactRow | null> {
  const c = targetColumns(target);
  return db.getFirstAsync<ArtifactRow>(
    'SELECT * FROM generated_artifact WHERE rental_id = ? AND kind = ? AND angle_key IS ? AND slot IS ? AND contract_id IS ?',
    [rentalId, target.kind, c.angleKey, c.slot, c.contractId],
  );
}

export function getArtifact(rentalId: Id, target: ArtifactTarget): Promise<GeneratedArtifact | null> {
  return read(async (db) => {
    const row = await findArtifact(db, rentalId, target);
    return row ? mapArtifact(row) : null;
  });
}

export function listArtifacts(rentalId: Id, kind?: GeneratedArtifact['kind']): Promise<GeneratedArtifact[]> {
  return read(async (db) => {
    const rows = await db.getAllAsync<ArtifactRow>(
      `SELECT * FROM generated_artifact WHERE rental_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY generated_at`,
      kind ? [rentalId, kind] : [rentalId],
    );
    return rows.map(mapArtifact);
  });
}

/** 'fresh' only when a row exists, its fingerprint matches and its file is on disk. */
export async function getArtifactStatus(
  rentalId: Id,
  target: ArtifactTarget,
  sourceFingerprint: string,
): Promise<{ status: ArtifactStatus; artifact: GeneratedArtifact | null }> {
  const artifact = await getArtifact(rentalId, target);
  if (!artifact || !(await getPlatform().files.exists(artifact.file.path))) return { status: 'missing', artifact };
  return { status: artifact.sourceFingerprint === sourceFingerprint ? 'fresh' : 'stale', artifact };
}

/**
 * Records a freshly generated file: writes it under a new id, swaps the target's row, and
 * deletes the previous file after commit.
 */
export async function saveArtifact(
  rentalId: Id,
  target: ArtifactTarget,
  file: ArtifactFile,
  meta: ArtifactMeta,
): Promise<GeneratedArtifact> {
  if (meta.mimeType !== 'image/jpeg' && meta.mimeType !== 'application/pdf') {
    throw new ValidationError(`Unsupported artifact type ${meta.mimeType as string}`, 'mimeType');
  }
  if (!meta.sourceFingerprint) throw new ValidationError('A source fingerprint is required', 'sourceFingerprint');
  const id = getPlatform().newId();
  const rel = artifactPath(rentalId, id, meta.mimeType);
  const c = targetColumns(target);
  return withImportedFile(file.tempUri, rel, () =>
    write(['artifact'], async (scope) => {
      const { tx, now } = scope;
      requireRow(await tx.getFirstAsync<{ id: string }>('SELECT id FROM rental WHERE id = ?', [rentalId]), 'Rental', rentalId);
      if (c.contractId) {
        const contract = await tx.getFirstAsync<{ rental_id: string }>('SELECT rental_id FROM signed_contract WHERE id = ?', [c.contractId]);
        if (contract?.rental_id !== rentalId) throw new ValidationError('The contract does not belong to this rental', 'contractId');
      }
      const previous = await findArtifact(tx, rentalId, target);
      if (previous) await tx.runAsync('DELETE FROM generated_artifact WHERE id = ?', [previous.id]);
      await tx.runAsync(
        `INSERT INTO generated_artifact (id, rental_id, kind, angle_key, slot, contract_id, file_path, mime_type, byte_size,
           sha256, width, height, page_count, source_fingerprint, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, rentalId, target.kind, c.angleKey, c.slot, c.contractId, rel, meta.mimeType, file.byteSize, file.sha256,
          file.width ?? null, file.height ?? null, file.pageCount ?? null, meta.sourceFingerprint, meta.generatedAt ?? now,
        ],
      );
      deleteFilesLater(scope, [previous?.file_path]);
      return mapArtifact(requireRow(await tx.getFirstAsync<ArtifactRow>('SELECT * FROM generated_artifact WHERE id = ?', [id]), 'Artifact', id));
    }),
  );
}

/** Drops a target's artifact (e.g. an angle that no longer has damage). */
export function deleteArtifact(rentalId: Id, target: ArtifactTarget): Promise<void> {
  return write(['artifact'], async (scope) => {
    const row = await findArtifact(scope.tx, rentalId, target);
    if (!row) return;
    await scope.tx.runAsync('DELETE FROM generated_artifact WHERE id = ?', [row.id]);
    deleteFilesLater(scope, [row.file_path]);
  });
}
