/** @jest-environment node */
import {
  checkIntegrity,
  CONNECTION_PRAGMAS,
  getSchemaVersion,
  migrate,
  MIGRATIONS,
  MigrationError,
  SCHEMA_VERSION,
  SchemaTooNewError,
} from '../migrations';
import { openNodeDatabase } from './support/testData';

async function freshDb() {
  const { db } = openNodeDatabase();
  await db.execAsync(CONNECTION_PRAGMAS);
  return db;
}

describe('migrations', () => {
  it('migrates an empty database to the current schema', async () => {
    const db = await freshDb();
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await migrate(db)).toEqual({ from: 0, to: SCHEMA_VERSION });
    expect(await getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(await checkIntegrity(db)).toEqual({ ok: true, problems: [] });
    await db.close();
  });

  it('is idempotent and does not call beforeUpgrade on a fresh or current database', async () => {
    const db = await freshDb();
    const beforeUpgrade = jest.fn(async () => undefined);
    await migrate(db, { beforeUpgrade });
    expect(await migrate(db, { beforeUpgrade })).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    expect(beforeUpgrade).not.toHaveBeenCalled();
    await db.close();
  });

  it('seeds the agency row, the angle catalog and nothing else', async () => {
    const db = await freshDb();
    await migrate(db);
    const agency = await db.getFirstAsync<{ name: string; rental_ref_prefix: string; rental_ref_last_seq: number }>(
      'SELECT name, rental_ref_prefix, rental_ref_last_seq FROM agency_settings',
    );
    expect(agency).toEqual({ name: '', rental_ref_prefix: 'R', rental_ref_last_seq: 0 });
    const angles = await db.getAllAsync<{ key: string }>("SELECT key FROM angle WHERE angle_group = 'exterior' ORDER BY sort_order");
    expect(angles.map((a) => a.key)).toEqual(['front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right']);
    expect(await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM rental')).toEqual({ n: 0 });
    await db.close();
  });

  it('refuses a database from a newer app version', async () => {
    const db = await freshDb();
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toBeInstanceOf(SchemaTooNewError);
    await db.close();
  });

  it('rolls a failed step back completely', async () => {
    const db = await freshDb();
    // A table the migration wants to create already exists: step 1 fails and leaves nothing behind.
    await db.execAsync('CREATE TABLE vehicle (x INTEGER)');
    await expect(migrate(db)).rejects.toBeInstanceOf(MigrationError);
    expect(await getSchemaVersion(db)).toBe(0);
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name = 'rental'")).toBeNull();
    await db.close();
  });

  it('rejects absolute paths, URIs and traversal in file columns', async () => {
    const db = await freshDb();
    await migrate(db);
    const insert = (path: string) =>
      db.runAsync(
        "INSERT INTO vehicle (id, plate, photo_path, photo_byte_size, photo_sha256, created_at, updated_at) VALUES (?, 'AB', ?, 1, ?, 0, 0)",
        [`v-${path.length}-${Math.random()}`, path, 'a'.repeat(64)],
      );
    for (const bad of ['/data/x.jpg', 'file:///x.jpg', 'photos/../x.jpg', 'photos\\x.jpg', 'x.jpg', 'photos//x.jpg']) {
      await expect(insert(bad)).rejects.toThrow(/CHECK constraint failed/);
    }
    await expect(insert('vehicles/v1/f1.jpg')).resolves.toBeDefined();
    const refs = await db.getAllAsync<{ owner: string; path: string }>('SELECT owner, path FROM v_file_ref');
    expect(refs).toEqual([{ owner: 'vehicle_photo', path: 'vehicles/v1/f1.jpg' }]);
    await db.close();
  });

  it('v2 clears repairs left behind by discarded or re-targeted drafts, and keeps real ones', async () => {
    const db = await freshDb();
    await db.execAsync(`BEGIN; ${MIGRATIONS[0].sql}; PRAGMA user_version = 1; COMMIT;`);
    await db.execAsync(`
      INSERT INTO vehicle (id, plate, created_at, updated_at) VALUES ('va', 'A', 0, 0), ('vb', 'B', 0, 0);
      INSERT INTO rental (id, status, vehicle_id, veh_plate, distance_unit, created_at, updated_at) VALUES ('r1', 'draft', 'vb', 'B', 'km', 0, 0);
      INSERT INTO vehicle_damage (id, vehicle_id, resolved_at, resolution, resolved_rental_id, created_at, updated_at) VALUES
        ('discarded', 'va', 5, 'not_found', NULL, 0, 0),
        ('switched',  'va', 5, 'not_found', 'r1', 0, 0),
        ('repaired',  'va', 5, 'repaired',  NULL, 0, 0);
    `);
    expect(await migrate(db)).toEqual({ from: 1, to: SCHEMA_VERSION });
    const rows = await db.getAllAsync<{ id: string; resolution: string | null }>('SELECT id, resolution FROM vehicle_damage ORDER BY id');
    expect(rows).toEqual([
      { id: 'discarded', resolution: null },
      { id: 'repaired', resolution: 'repaired' },
      { id: 'switched', resolution: null },
    ]);
    await db.close();
  });
});
