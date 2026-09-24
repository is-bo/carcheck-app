/** @jest-environment node */
import { openNodeDatabase } from './support/testData';

describe('createSqlDb', () => {
  it('commits a transaction and rolls back a failed one', async () => {
    const { db } = openNodeDatabase();
    await db.execAsync('CREATE TABLE t (v INTEGER)');
    await db.transaction(async (tx) => {
      await tx.runAsync('INSERT INTO t (v) VALUES (?)', [1]);
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.runAsync('INSERT INTO t (v) VALUES (?)', [2]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.getAllAsync<{ v: number }>('SELECT v FROM t')).toEqual([{ v: 1 }]);
    await db.close();
  });

  it('nests with savepoints: an inner failure keeps the outer work', async () => {
    const { db } = openNodeDatabase();
    await db.execAsync('CREATE TABLE t (v INTEGER)');
    await db.transaction(async (tx) => {
      await tx.runAsync('INSERT INTO t (v) VALUES (1)');
      await tx
        .transaction(async (inner) => {
          await inner.runAsync('INSERT INTO t (v) VALUES (2)');
          throw new Error('inner');
        })
        .catch(() => undefined);
      await tx.runAsync('INSERT INTO t (v) VALUES (3)');
    });
    expect((await db.getAllAsync<{ v: number }>('SELECT v FROM t ORDER BY v')).map((r) => r.v)).toEqual([1, 3]);
    await db.close();
  });

  it('serializes top-level statements behind a running transaction', async () => {
    const { db } = openNodeDatabase();
    await db.execAsync('CREATE TABLE t (v INTEGER)');
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const txDone = db.transaction(async (tx) => {
      await tx.runAsync('INSERT INTO t (v) VALUES (1)');
      order.push('tx-insert');
      await gate;
      throw new Error('rollback');
    });
    const outside = db.runAsync('INSERT INTO t (v) VALUES (2)').then(() => order.push('outside-insert'));
    await Promise.resolve();
    release();
    await expect(txDone).rejects.toThrow('rollback');
    await outside;
    // The outside insert waited, so the rollback did not take it with it.
    expect(order).toEqual(['tx-insert', 'outside-insert']);
    expect((await db.getAllAsync<{ v: number }>('SELECT v FROM t')).map((r) => r.v)).toEqual([2]);
    await db.close();
  });

  it('rejects work after close', async () => {
    const { db } = openNodeDatabase();
    await db.close();
    await expect(db.getFirstAsync('SELECT 1')).rejects.toThrow('closed');
  });
});
