/**
 * Agency settings (singleton row), the angle catalog and UI preferences.
 */
import type { AgencySettings, Angle, CapturedFile, DistanceUnit } from '@/domain/types';
import { formatRentalReference } from '@/domain/types';

import { getPlatform } from '../connection';
import { ValidationError } from '../errors';
import { logoPath, type LogoExtension } from '../filePaths';
import type { SqlExecutor } from '../sql';
import {
  cleanText,
  deleteFilesLater,
  mapAgency,
  mapAngle,
  read,
  withImportedFile,
  write,
  type AgencyRow,
  type AngleRow,
} from './internal';

export interface AgencySettingsPatch {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  registrationNumber?: string | null;
  reportFooter?: string | null;
  distanceUnit?: DistanceUnit;
  /** 1-6 characters A-Z / 0-9; give each phone its own prefix. */
  rentalRefPrefix?: string;
}

export async function loadAgency(db: SqlExecutor): Promise<AgencySettings> {
  const row = await db.getFirstAsync<AgencyRow>('SELECT * FROM agency_settings WHERE id = 1');
  if (!row) throw new Error('agency_settings row is missing');
  return mapAgency(row);
}

export function getAgencySettings(): Promise<AgencySettings> {
  return read(loadAgency);
}

/** False until onboarding saved an agency name. */
export async function isAgencyConfigured(): Promise<boolean> {
  return (await getAgencySettings()).name.trim().length > 0;
}

export function normalizeRefPrefix(value: string): string {
  const prefix = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(prefix)) {
    throw new ValidationError('Use 1 to 6 letters or digits for the reference prefix.', 'rentalRefPrefix');
  }
  return prefix;
}

export async function updateAgencySettings(patch: AgencySettingsPatch): Promise<AgencySettings> {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const set = (column: string, value: string | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) {
    const name = cleanText(patch.name);
    if (!name) throw new ValidationError('Enter the agency name.', 'name');
    set('name', name);
  }
  if (patch.address !== undefined) set('address', cleanText(patch.address));
  if (patch.phone !== undefined) set('phone', cleanText(patch.phone));
  if (patch.email !== undefined) set('email', cleanText(patch.email));
  if (patch.registrationNumber !== undefined) set('registration_number', cleanText(patch.registrationNumber));
  if (patch.reportFooter !== undefined) set('report_footer', cleanText(patch.reportFooter));
  if (patch.distanceUnit !== undefined) {
    if (patch.distanceUnit !== 'km' && patch.distanceUnit !== 'mi') throw new ValidationError('Unknown unit', 'distanceUnit');
    set('distance_unit', patch.distanceUnit);
  }
  if (patch.rentalRefPrefix !== undefined) set('rental_ref_prefix', normalizeRefPrefix(patch.rentalRefPrefix));
  return write(['settings'], async ({ tx, now }) => {
    if (sets.length > 0) {
      await tx.runAsync(`UPDATE agency_settings SET ${sets.join(', ')}, updated_at = ? WHERE id = 1`, [...params, now]);
    }
    return loadAgency(tx);
  });
}

/** Replaces (or removes, with null) the agency logo. The old file is deleted after commit. */
export async function setAgencyLogo(image: CapturedFile | null, ext: LogoExtension = 'png'): Promise<AgencySettings> {
  const apply = (path: string | null) =>
    write(['settings'], async (scope) => {
      const before = await loadAgency(scope.tx);
      await scope.tx.runAsync(
        'UPDATE agency_settings SET logo_path = ?, logo_byte_size = ?, logo_sha256 = ?, updated_at = ? WHERE id = 1',
        [path, image && path ? image.byteSize : null, image && path ? image.sha256 : null, scope.now],
      );
      deleteFilesLater(scope, [before.logo?.path]);
      return loadAgency(scope.tx);
    });
  if (!image) return apply(null);
  const rel = logoPath(getPlatform().newId(), ext);
  return withImportedFile(image.tempUri, rel, () => apply(rel));
}

/**
 * Allocates the next rental reference ("R-0142") inside the caller's transaction. Numbers only
 * move forward, so a changed prefix never produces a duplicate.
 */
export async function allocateRentalReference(tx: SqlExecutor, now: number): Promise<string> {
  for (;;) {
    const row = await tx.getFirstAsync<{ rental_ref_prefix: string; rental_ref_last_seq: number }>(
      'UPDATE agency_settings SET rental_ref_last_seq = rental_ref_last_seq + 1, updated_at = ? WHERE id = 1 ' +
        'RETURNING rental_ref_prefix, rental_ref_last_seq',
      [now],
    );
    if (!row) throw new Error('agency_settings row is missing');
    const reference = formatRentalReference(row.rental_ref_prefix, row.rental_ref_last_seq);
    const taken = await tx.getFirstAsync<{ id: string }>('SELECT id FROM rental WHERE reference = ?', [reference]);
    if (!taken) return reference;
  }
}

export function listAngles(options: { includeInactive?: boolean } = {}): Promise<Angle[]> {
  return read(async (db) => {
    const rows = await db.getAllAsync<AngleRow>(
      `SELECT * FROM angle ${options.includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, key`,
    );
    return rows.map(mapAngle);
  });
}

// ---------------------------------------------------------------------------------------------
// UI preferences (JSON values; not evidence)

export type PrefKey =
  | 'compareMode'
  | 'ghostOpacity'
  | 'saveAsProfile'
  | 'backupReminderSnoozedUntil'
  | 'overlayHoldHintShown'
  | (string & {});

export function getPref<T>(key: PrefKey): Promise<T | null> {
  return read(async (db) => {
    const row = await db.getFirstAsync<{ value_json: string }>('SELECT value_json FROM app_pref WHERE key = ?', [key]);
    return row ? (JSON.parse(row.value_json) as T) : null;
  });
}

/** `undefined`/`null` removes the preference. */
export function setPref(key: PrefKey, value: unknown): Promise<void> {
  return write(['settings'], async ({ tx, now }) => {
    if (value === undefined || value === null) {
      await tx.runAsync('DELETE FROM app_pref WHERE key = ?', [key]);
      return;
    }
    await tx.runAsync(
      'INSERT INTO app_pref (key, value_json, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      [key, JSON.stringify(value), now],
    );
  });
}
