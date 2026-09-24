/**
 * Customer profiles (optional; rentals keep their own snapshot) and ID / licence document
 * photos. Documents are privacy data, not rental evidence: they can be deleted at any time.
 */
import type {
  CapturedImage,
  Customer,
  CustomerDetail,
  CustomerDocument,
  CustomerDocumentKind,
  CustomerListItem,
  Id,
} from '@/domain/types';

import { getPlatform } from '../connection';
import { ValidationError } from '../errors';
import { documentPath, type DocumentOwner } from '../filePaths';
import { placeholders, type SqlExecutor } from '../sql';
import {
  cleanText,
  CUSTOMER_COLUMNS,
  deleteFilesLater,
  mapCustomer,
  mapCustomerDocument,
  read,
  requireRow,
  withImportedFile,
  write,
  type CustomerDocumentRow,
  type CustomerRow,
} from './internal';
import { mapRentalItem, queryRentalItems } from './rentalItems';

export interface CustomerInput {
  fullName: string;
  phone?: string | null;
  address?: string | null;
  licenceNumber?: string | null;
  idNumber?: string | null;
  notes?: string | null;
}

export type CustomerPatch = Partial<CustomerInput>;

const DOCUMENT_KINDS: readonly CustomerDocumentKind[] = ['licence', 'id_passport', 'other'];

function requireName(name: string | undefined): string {
  const n = cleanText(name);
  if (!n) throw new ValidationError('Enter the customer name.', 'fullName');
  return n;
}

export async function loadCustomer(db: SqlExecutor, id: Id): Promise<Customer> {
  const row = await db.getFirstAsync<CustomerRow>(`SELECT ${CUSTOMER_COLUMNS} FROM customer c WHERE c.id = ?`, [id]);
  return mapCustomer(requireRow(row, 'Customer', id));
}

export async function insertCustomer(tx: SqlExecutor, id: Id, input: CustomerInput, now: number): Promise<void> {
  await tx.runAsync(
    'INSERT INTO customer (id, full_name, phone, address, licence_number, id_number, notes, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id, requireName(input.fullName), cleanText(input.phone), cleanText(input.address),
      cleanText(input.licenceNumber), cleanText(input.idNumber), cleanText(input.notes), now, now,
    ],
  );
}

/** Refreshes the snapshot of draft rentals linked to this profile (DATA_MODEL §2). */
async function refreshDraftSnapshots(tx: SqlExecutor, c: Customer, now: number): Promise<void> {
  await tx.runAsync(
    'UPDATE rental SET cust_full_name = ?, cust_phone = ?, cust_address = ?, cust_licence_number = ?, cust_id_number = ?, ' +
      "cust_notes = ?, updated_at = ? WHERE customer_id = ? AND status = 'draft'",
    [c.fullName, c.phone, c.address, c.licenceNumber, c.idNumber, c.notes, now, c.id],
  );
}

export function getCustomer(id: Id): Promise<Customer> {
  return read((db) => loadCustomer(db, id));
}

export function listCustomers(query: { search?: string; includeArchived?: boolean } = {}): Promise<CustomerListItem[]> {
  return read(async (db) => {
    const where: string[] = [];
    const params: string[] = [];
    if (!query.includeArchived) where.push('c.archived_at IS NULL');
    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push("(c.full_name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.licence_number LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    const rows = await db.getAllAsync<CustomerRow & { rental_count: number; last_rental_at: number | null; document_count: number }>(
      `SELECT ${CUSTOMER_COLUMNS},
         (SELECT count(*) FROM rental r WHERE r.customer_id = c.id AND r.status <> 'draft') AS rental_count,
         (SELECT max(coalesce(r.activated_at, r.created_at)) FROM rental r WHERE r.customer_id = c.id) AS last_rental_at,
         (SELECT count(*) FROM customer_document cd WHERE cd.customer_id = c.id) AS document_count
       FROM customer c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY c.full_name COLLATE NOCASE`,
      params,
    );
    return rows.map((r) => ({
      customer: mapCustomer(r),
      rentalCount: r.rental_count,
      lastRentalAt: r.last_rental_at,
      documentCount: r.document_count,
    }));
  });
}

export function getCustomerDetail(id: Id): Promise<CustomerDetail> {
  return read(async (db) => {
    const customer = await loadCustomer(db, id);
    const documents = await db.getAllAsync<CustomerDocumentRow>(
      'SELECT * FROM customer_document WHERE customer_id = ? ORDER BY created_at',
      [id],
    );
    const now = getPlatform().now();
    const rentals = await queryRentalItems(db, "r.customer_id = ? AND r.status <> 'draft'", [id], 'ORDER BY coalesce(r.activated_at, r.created_at) DESC');
    return { customer, documents: documents.map(mapCustomerDocument), rentals: rentals.map((r) => mapRentalItem(r, now)) };
  });
}

export function createCustomer(input: CustomerInput): Promise<Customer> {
  requireName(input.fullName);
  return write(['customer'], async ({ tx, now, newId }) => {
    const id = newId();
    await insertCustomer(tx, id, input, now);
    return loadCustomer(tx, id);
  });
}

export function updateCustomer(id: Id, patch: CustomerPatch): Promise<Customer> {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const set = (column: string, value: string | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.fullName !== undefined) set('full_name', requireName(patch.fullName));
  if (patch.phone !== undefined) set('phone', cleanText(patch.phone));
  if (patch.address !== undefined) set('address', cleanText(patch.address));
  if (patch.licenceNumber !== undefined) set('licence_number', cleanText(patch.licenceNumber));
  if (patch.idNumber !== undefined) set('id_number', cleanText(patch.idNumber));
  if (patch.notes !== undefined) set('notes', cleanText(patch.notes));
  return write(['customer', 'rental'], async ({ tx, now }) => {
    await loadCustomer(tx, id);
    if (sets.length > 0) await tx.runAsync(`UPDATE customer SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, now, id]);
    const customer = await loadCustomer(tx, id);
    await refreshDraftSnapshots(tx, customer, now);
    return customer;
  });
}

/** Deletes a profile no rental references (with its documents); otherwise archives it. */
export function removeCustomer(id: Id): Promise<'deleted' | 'archived'> {
  return write(['customer'], async (scope) => {
    await loadCustomer(scope.tx, id);
    const used = await scope.tx.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM rental WHERE customer_id = ?', [id]);
    if ((used?.n ?? 0) > 0) {
      await scope.tx.runAsync('UPDATE customer SET archived_at = coalesce(archived_at, ?), updated_at = ? WHERE id = ?', [scope.now, scope.now, id]);
      return 'archived';
    }
    const docs = await scope.tx.getAllAsync<{ file_path: string }>('SELECT file_path FROM customer_document WHERE customer_id = ?', [id]);
    await scope.tx.runAsync('DELETE FROM customer WHERE id = ?', [id]);
    deleteFilesLater(scope, docs.map((d) => d.file_path));
    return 'deleted';
  });
}

export function archiveCustomer(id: Id): Promise<Customer> {
  return write(['customer'], async ({ tx, now }) => {
    await loadCustomer(tx, id);
    await tx.runAsync('UPDATE customer SET archived_at = coalesce(archived_at, ?), updated_at = ? WHERE id = ?', [now, now, id]);
    return loadCustomer(tx, id);
  });
}

export function unarchiveCustomer(id: Id): Promise<Customer> {
  return write(['customer'], async ({ tx, now }) => {
    await loadCustomer(tx, id);
    await tx.runAsync('UPDATE customer SET archived_at = NULL, updated_at = ? WHERE id = ?', [now, id]);
    return loadCustomer(tx, id);
  });
}

// ---------------------------------------------------------------------------------------------
// Documents

export async function addCustomerDocument(
  owner: DocumentOwner,
  image: CapturedImage,
  kind: CustomerDocumentKind,
  label?: string | null,
): Promise<CustomerDocument> {
  if (!DOCUMENT_KINDS.includes(kind)) throw new ValidationError(`Unknown document kind ${kind}`, 'kind');
  const id = getPlatform().newId();
  const rel = documentPath(owner, id);
  const customerId = 'customerId' in owner ? owner.customerId : null;
  const rentalId = 'rentalId' in owner ? owner.rentalId : null;
  return withImportedFile(image.tempUri, rel, () =>
    write(['customer', 'rental'], async ({ tx, now }) => {
      if (customerId) await loadCustomer(tx, customerId);
      if (rentalId) requireRow(await tx.getFirstAsync<{ id: string }>('SELECT id FROM rental WHERE id = ?', [rentalId]), 'Rental', rentalId);
      await tx.runAsync(
        `INSERT INTO customer_document (id, customer_id, rental_id, kind, label, file_path, width, height, byte_size, sha256, captured_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customerId, rentalId, kind, cleanText(label), rel, image.width, image.height, image.byteSize, image.sha256, image.capturedAt, now],
      );
      const row = await tx.getFirstAsync<CustomerDocumentRow>('SELECT * FROM customer_document WHERE id = ?', [id]);
      return mapCustomerDocument(requireRow(row, 'Customer document', id));
    }),
  );
}

export function listCustomerDocuments(owner: DocumentOwner): Promise<CustomerDocument[]> {
  return read(async (db) => {
    const column = 'customerId' in owner ? 'customer_id' : 'rental_id';
    const value = 'customerId' in owner ? owner.customerId : owner.rentalId;
    const rows = await db.getAllAsync<CustomerDocumentRow>(
      `SELECT * FROM customer_document WHERE ${column} = ? ORDER BY created_at`,
      [value],
    );
    return rows.map(mapCustomerDocument);
  });
}

/** "Delete ID photos": rows first, files after commit. */
export function deleteCustomerDocuments(ids: readonly Id[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return write(['customer', 'rental'], async (scope) => {
    const rows = await scope.tx.getAllAsync<{ file_path: string }>(
      `SELECT file_path FROM customer_document WHERE id IN (${placeholders(ids.length)})`,
      ids,
    );
    await scope.tx.runAsync(`DELETE FROM customer_document WHERE id IN (${placeholders(ids.length)})`, ids);
    deleteFilesLater(scope, rows.map((r) => r.file_path));
  });
}
