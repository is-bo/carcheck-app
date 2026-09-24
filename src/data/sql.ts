/**
 * Thin database adapter shared by the app (expo-sqlite) and Node tests (better-sqlite3).
 *
 * A driver only knows how to run one statement. createSqlDb() adds what repositories rely on:
 * - every top-level call is serialized through one queue, so a write transaction can never
 *   interleave with another caller's statements on the same connection;
 * - transaction() runs BEGIN IMMEDIATE…COMMIT, or a SAVEPOINT when called on a transaction
 *   handle, so repository helpers compose.
 *
 * Inside transaction(fn) use ONLY the `tx` handle: calling the top-level db from there waits for
 * the transaction to finish and deadlocks.
 */

export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params?: SqlParams): Promise<SqlRunResult>;
  getFirstAsync<T>(source: string, params?: SqlParams): Promise<T | null>;
  getAllAsync<T>(source: string, params?: SqlParams): Promise<T[]>;
}

export interface SqlDb extends SqlExecutor {
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
}

export interface ClosableSqlDb extends SqlDb {
  /** Waits for queued work, then closes the connection. */
  close(): Promise<void>;
}

/** One statement at a time; implemented per platform. */
export interface SqlDriver {
  exec(source: string): Promise<void>;
  run(source: string, params: SqlParams): Promise<SqlRunResult>;
  get<T>(source: string, params: SqlParams): Promise<T | null>;
  all<T>(source: string, params: SqlParams): Promise<T[]>;
  close(): Promise<void>;
}

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function executor(driver: SqlDriver): SqlExecutor {
  return {
    execAsync: (source) => driver.exec(source),
    runAsync: (source, params = []) => driver.run(source, params),
    getFirstAsync: <T>(source: string, params: SqlParams = []) => driver.get<T>(source, params),
    getAllAsync: <T>(source: string, params: SqlParams = []) => driver.all<T>(source, params),
  };
}

function transactionHandle(driver: SqlDriver, depth: number): SqlDb {
  const base = executor(driver);
  return {
    ...base,
    async transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
      const name = `sp_${depth}`;
      await driver.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn(transactionHandle(driver, depth + 1));
        await driver.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        await driver.exec(`ROLLBACK TO ${name}`).catch(() => undefined);
        await driver.exec(`RELEASE ${name}`).catch(() => undefined);
        throw e;
      }
    },
  };
}

export function createSqlDb(driver: SqlDriver): ClosableSqlDb {
  const queue = new SerialQueue();
  let closed = false;
  const guard = <T>(task: () => Promise<T>): Promise<T> =>
    queue.run(() => {
      if (closed) return Promise.reject(new Error('Database connection is closed'));
      return task();
    });

  return {
    execAsync: (source) => guard(() => driver.exec(source)),
    runAsync: (source, params = []) => guard(() => driver.run(source, params)),
    getFirstAsync: <T>(source: string, params: SqlParams = []) => guard(() => driver.get<T>(source, params)),
    getAllAsync: <T>(source: string, params: SqlParams = []) => guard(() => driver.all<T>(source, params)),
    transaction: <T>(fn: (tx: SqlDb) => Promise<T>) =>
      guard(async () => {
        await driver.exec('BEGIN IMMEDIATE');
        try {
          const result = await fn(transactionHandle(driver, 1));
          await driver.exec('COMMIT');
          return result;
        } catch (e) {
          await driver.exec('ROLLBACK').catch(() => undefined);
          throw e;
        }
      }),
    close: () =>
      queue.run(async () => {
        if (closed) return;
        closed = true;
        await driver.close();
      }),
  };
}

/** "?, ?, ?" for an IN (...) list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
