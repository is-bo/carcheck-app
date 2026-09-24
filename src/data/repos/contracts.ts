/**
 * Contract templates (append-only versions) and signed contracts (immutable; corrections are
 * voided and re-signed). Signing freezes the exact HTML the customer reviewed, the variable
 * values, the template version, the signature file and a SHA-256 content hash.
 */
import {
  contractHtmlReferences,
  renderContractTemplate,
  STARTER_TEMPLATE_BODY,
  STARTER_TEMPLATE_KEY,
  STARTER_TEMPLATE_TITLE,
  type ContractDamageItem,
  type ContractRenderResult,
  type RentalContext,
} from '@/domain/contract';
import { damageLabel } from '@/domain/damage';
import { BLOCKER_MESSAGES, isStartFlowOpen, signBlockers, type Blocker } from '@/domain/rentalLifecycle';
import type {
  CapturedFile,
  ContractTemplate,
  ContractVariables,
  DamageMarker,
  EpochMs,
  Id,
  Rental,
  SignedContractWithState,
} from '@/domain/types';
import { contractHashPreimage } from '@/domain/types';

import { getPlatform } from '../connection';
import { ConflictError, InvalidStateError, LockedError, ValidationError } from '../errors';
import { signaturePath } from '../filePaths';
import { placeholders, type SqlExecutor } from '../sql';
import { LOCK_MESSAGES } from './guards';
import {
  cleanText,
  CONTRACT_SELECT,
  mapContract,
  mapTemplate,
  read,
  requireRow,
  withImportedFile,
  write,
  type ContractRow,
  type DamageRow,
  type TemplateRow,
} from './internal';
import { loadRentalFacts } from './rentalItems';
import { loadRental } from './rentals';
import { allocateRentalReference, loadAgency } from './settings';

// ---------------------------------------------------------------------------------------------
// Templates

async function loadActiveTemplate(db: SqlExecutor, templateKey: string): Promise<ContractTemplate> {
  const row = await db.getFirstAsync<TemplateRow>(
    'SELECT * FROM contract_template WHERE template_key = ? ORDER BY version DESC LIMIT 1',
    [templateKey],
  );
  return mapTemplate(requireRow(row, 'Contract template', templateKey));
}

async function insertTemplateVersion(tx: SqlExecutor, id: Id, templateKey: string, title: string, body: string, now: number): Promise<void> {
  await tx.runAsync(
    `INSERT INTO contract_template (id, template_key, version, title, body, body_format, created_at)
     VALUES (?, ?, (SELECT coalesce(max(version), 0) + 1 FROM contract_template WHERE template_key = ?), ?, ?, 'markdown', ?)`,
    [id, templateKey, templateKey, title, body, now],
  );
}

/** Boot: seeds the starter template when no version exists yet. */
export async function ensureStarterTemplate(db: SqlExecutor, id: Id, now: number): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM contract_template WHERE template_key = ?', [STARTER_TEMPLATE_KEY]);
  if ((row?.n ?? 0) > 0) return;
  await insertTemplateVersion(db, id, STARTER_TEMPLATE_KEY, STARTER_TEMPLATE_TITLE, STARTER_TEMPLATE_BODY, now);
}

/** The highest version is the active one. */
export function getActiveTemplate(templateKey: string = STARTER_TEMPLATE_KEY): Promise<ContractTemplate> {
  return read((db) => loadActiveTemplate(db, templateKey));
}

export function getTemplate(id: Id): Promise<ContractTemplate> {
  return read(async (db) =>
    mapTemplate(requireRow(await db.getFirstAsync<TemplateRow>('SELECT * FROM contract_template WHERE id = ?', [id]), 'Contract template', id)),
  );
}

export function listTemplateVersions(templateKey: string = STARTER_TEMPLATE_KEY): Promise<ContractTemplate[]> {
  return read(async (db) =>
    (await db.getAllAsync<TemplateRow>('SELECT * FROM contract_template WHERE template_key = ? ORDER BY version DESC', [templateKey])).map(
      mapTemplate,
    ),
  );
}

/** Saving the editor appends version n+1 (unchanged text returns the active version). */
export function saveTemplateVersion(input: { title: string; body: string; templateKey?: string }): Promise<ContractTemplate> {
  const title = cleanText(input.title);
  if (!title) throw new ValidationError('Enter a title.', 'title');
  const body = input.body.replace(/\r\n?/g, '\n');
  if (body.trim().length === 0) throw new ValidationError('The contract text is empty.', 'body');
  const key = input.templateKey ?? STARTER_TEMPLATE_KEY;
  return write(['template'], async ({ tx, now, newId }) => {
    const active = await tx.getFirstAsync<TemplateRow>(
      'SELECT * FROM contract_template WHERE template_key = ? ORDER BY version DESC LIMIT 1',
      [key],
    );
    if (active && active.title === title && active.body === body) return mapTemplate(active);
    const id = newId();
    await insertTemplateVersion(tx, id, key, title, body, now);
    return mapTemplate(requireRow(await tx.getFirstAsync<TemplateRow>('SELECT * FROM contract_template WHERE id = ?', [id]), 'Contract template', id));
  });
}

/** "Reset to default": a new version holding the starter text (history is kept). */
export function resetTemplateToDefault(): Promise<ContractTemplate> {
  return saveTemplateVersion({ title: STARTER_TEMPLATE_TITLE, body: STARTER_TEMPLATE_BODY });
}

// ---------------------------------------------------------------------------------------------
// Context & preparation

export interface ContextOptions {
  /** Review / signing moment. Default: now. */
  renderedAt?: EpochMs;
  /** Minutes east of UTC. Default: the device offset at `renderedAt`. */
  tzOffsetMin?: number;
}

export function deviceTzOffsetMin(at: EpochMs): number {
  return -new Date(at).getTimezoneOffset();
}

async function loadContext(db: SqlExecutor, rentalId: Id, options: ContextOptions): Promise<RentalContext> {
  const renderedAt = options.renderedAt ?? getPlatform().now();
  const rental = await loadRental(db, rentalId);
  const agency = await loadAgency(db);
  const rows = await db.getAllAsync<DamageRow & { photo_width: number; photo_height: number; photo_label: string | null; angle_label: string }>(
    `SELECT d.*, p.width AS photo_width, p.height AS photo_height, p.label AS photo_label, a.label AS angle_label
     FROM damage d JOIN photo p ON p.id = d.before_photo_id JOIN angle a ON a.key = d.angle_key
     WHERE d.rental_id = ? AND d.found_phase = 'before' AND d.status = 'pre_existing'
     ORDER BY d.number`,
    [rentalId],
  );
  const existingDamage = rows.map((r): ContractDamageItem => {
    const marker = JSON.parse(r.marker_json) as DamageMarker;
    return {
      label: damageLabel({ status: 'pre_existing', number: r.number }),
      type: r.type,
      severity: r.severity,
      locationLabel: r.location_label,
      note: r.note,
      angleLabel: r.photo_label ?? (r.slot > 1 ? `${r.angle_label} ${r.slot}` : r.angle_label),
      photoId: r.before_photo_id as string,
      photoWidth: r.photo_width,
      photoHeight: r.photo_height,
      ring: marker.ring,
    };
  });
  return {
    agency: {
      name: agency.name,
      address: agency.address,
      phone: agency.phone,
      email: agency.email,
      registrationNumber: agency.registrationNumber,
    },
    rental: {
      reference: rental.reference,
      startedAt: rental.startedAt,
      expectedReturnAt: rental.expectedReturnAt,
      startMileage: rental.startMileage,
      startFuelEighths: rental.startFuelEighths,
      specialTerms: rental.specialTerms,
      distanceUnit: rental.distanceUnit,
    },
    customer: rental.customer,
    vehicle: rental.vehicle,
    existingDamage,
    renderedAt,
    tzOffsetMin: options.tzOffsetMin ?? deviceTzOffsetMin(renderedAt),
  };
}

/** Everything a contract needs, read from the rental snapshot (never the live profiles). */
export function buildContractContext(rentalId: Id, options: ContextOptions = {}): Promise<RentalContext> {
  return read((db) => loadContext(db, rentalId, options));
}

export interface ContractPreparation {
  rental: Rental;
  template: ContractTemplate;
  context: RentalContext;
  render: ContractRenderResult;
  /** Empty = ready for the customer. */
  blockers: Blocker[];
}

/**
 * Employee review ("contract.tsx"): assigns the rental reference on first use and the pick-up
 * time if unset, then renders the active template. Throws if the start steps are incomplete.
 */
export function prepareContract(rentalId: Id, options: ContextOptions = {}): Promise<ContractPreparation> {
  return write(['rental'], async ({ tx, now }) => {
    const { row, facts } = await loadRentalFacts(tx, rentalId);
    if (!isStartFlowOpen(facts)) throw new LockedError(facts.status === 'active' ? LOCK_MESSAGES.signed : LOCK_MESSAGES.closedBefore);
    const steps = signBlockers(facts);
    if (steps.length > 0) throw new InvalidStateError(BLOCKER_MESSAGES[steps[0]]);
    if (row.reference === null) {
      await tx.runAsync('UPDATE rental SET reference = ?, updated_at = ? WHERE id = ?', [await allocateRentalReference(tx, now), now, rentalId]);
    }
    if (row.started_at === null) await tx.runAsync('UPDATE rental SET started_at = ?, updated_at = ? WHERE id = ?', [now, now, rentalId]);
    const template = await loadActiveTemplate(tx, STARTER_TEMPLATE_KEY);
    const context = await loadContext(tx, rentalId, options);
    const render = renderContractTemplate(template, context);
    const agency = await loadAgency(tx);
    return {
      rental: await loadRental(tx, rentalId),
      template,
      context,
      render,
      blockers: signBlockers(facts, { agencyName: agency.name, unknownVariables: render.unknownKeys }),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Signing

export interface SignContractInput {
  rentalId: Id;
  /** The template version the HTML was rendered from. */
  templateId: Id;
  /** Exactly what the customer reviewed (ContractRenderResult.html). */
  renderedHtml: string;
  /** ContractRenderResult.variables. */
  variables: ContractVariables;
  signerName: string;
  /** Transparent PNG of the signature, already hashed. */
  signature: CapturedFile;
  signedAt?: EpochMs;
  /** Minutes east of UTC. Default: the device offset at signing. */
  tzOffsetMin?: number;
}

async function loadContract(db: SqlExecutor, id: Id): Promise<SignedContractWithState> {
  return mapContract(requireRow(await db.getFirstAsync<ContractRow>(`${CONTRACT_SELECT} WHERE sc.id = ?`, [id]), 'Signed contract', id));
}

/**
 * "Confirm signature" (one transaction): stores the signature file, inserts the immutable
 * contract; the trigger activates the rental and freezes every pick-up photo.
 */
export async function signContract(input: SignContractInput): Promise<SignedContractWithState> {
  const signerName = cleanText(input.signerName);
  if (!signerName) throw new ValidationError('The signer name is missing.', 'signerName');
  const refs = contractHtmlReferences(input.renderedHtml);
  if (refs.invalid.length > 0) throw new ValidationError(`The contract references external content: ${refs.invalid[0]}`, 'renderedHtml');
  if (input.renderedHtml.includes('[missing: ')) throw new ValidationError(BLOCKER_MESSAGES.unknown_variables, 'renderedHtml');
  const variablesJson = JSON.stringify(input.variables);
  const platform = getPlatform();
  const contractId = platform.newId();
  const rel = signaturePath(input.rentalId, contractId);

  return withImportedFile(input.signature.tempUri, rel, () =>
    write(['contract', 'rental', 'photo'], async ({ tx, now }) => {
      const { row, facts } = await loadRentalFacts(tx, input.rentalId);
      if (!isStartFlowOpen(facts)) {
        if (facts.hasValidContract) throw new ConflictError('duplicate', 'This rental already has a valid signed contract.');
        throw new InvalidStateError('This rental can no longer be signed.');
      }
      const agency = await loadAgency(tx);
      const blockers = signBlockers(facts, { agencyName: agency.name, unknownVariables: [] });
      if (blockers.length > 0) throw new InvalidStateError(BLOCKER_MESSAGES[blockers[0]]);

      const template = requireRow(
        await tx.getFirstAsync<TemplateRow>('SELECT * FROM contract_template WHERE id = ?', [input.templateId]),
        'Contract template',
        input.templateId,
      );
      if (refs.photoIds.length > 0) {
        const found = await tx.getAllAsync<{ id: string }>(
          `SELECT id FROM photo WHERE rental_id = ? AND phase = 'before' AND id IN (${placeholders(refs.photoIds.length)})`,
          [input.rentalId, ...refs.photoIds],
        );
        if (found.length !== refs.photoIds.length) {
          throw new ValidationError('The contract shows a photo that is not a pick-up photo of this rental.', 'renderedHtml');
        }
      }
      if (row.reference === null) {
        await tx.runAsync('UPDATE rental SET reference = ?, updated_at = ? WHERE id = ?', [await allocateRentalReference(tx, now), now, input.rentalId]);
      }
      if (row.started_at === null) await tx.runAsync('UPDATE rental SET started_at = ?, updated_at = ? WHERE id = ?', [now, now, input.rentalId]);

      const previous = await tx.getFirstAsync<{ id: string; sequence: number }>(
        'SELECT id, sequence FROM signed_contract WHERE rental_id = ? ORDER BY sequence DESC LIMIT 1',
        [input.rentalId],
      );
      const sequence = (previous?.sequence ?? 0) + 1;
      const signedAt = input.signedAt ?? now;
      const tzOffsetMin = input.tzOffsetMin ?? deviceTzOffsetMin(signedAt);
      const contentSha256 = await platform.sha256Text(
        contractHashPreimage({
          rentalId: input.rentalId,
          sequence,
          templateId: template.id,
          templateVersion: template.version,
          signerName,
          signedAt,
          tzOffsetMin,
          signatureSha256: input.signature.sha256,
          variablesJson,
          renderedHtml: input.renderedHtml,
        }),
      );
      await tx.runAsync(
        `INSERT INTO signed_contract (id, rental_id, sequence, supersedes_id, template_id, template_version, rendered_html,
           variables_json, signer_name, signature_path, signature_byte_size, signature_sha256, signed_at, tz_offset_min,
           content_sha256, app_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contractId, input.rentalId, sequence, previous?.id ?? null, template.id, template.version, input.renderedHtml,
          variablesJson, signerName, rel, input.signature.byteSize, input.signature.sha256, signedAt, tzOffsetMin,
          contentSha256, platform.appVersion, now,
        ],
      );
      await tx.runAsync('UPDATE rental SET resume_step = NULL WHERE id = ?', [input.rentalId]);
      return loadContract(tx, contractId);
    }),
  );
}

/** "Fix contract": voids the valid contract; snapshot and pick-up evidence unlock for re-signing. */
export function voidContract(contractId: Id, reason?: string | null): Promise<SignedContractWithState> {
  return write(['contract', 'rental'], async ({ tx, now }) => {
    const contract = await loadContract(tx, contractId);
    if (contract.void) throw new ConflictError('already_voided', 'This contract is already void.');
    const rental = await loadRental(tx, contract.rentalId);
    if (rental.status !== 'active') throw new InvalidStateError('Only the contract of a rental that is out can be voided.');
    await tx.runAsync('INSERT INTO contract_void (contract_id, voided_at, reason, created_at) VALUES (?, ?, ?, ?)', [
      contractId,
      now,
      cleanText(reason),
      now,
    ]);
    await tx.runAsync("UPDATE rental SET resume_step = 'details', updated_at = ? WHERE id = ?", [now, contract.rentalId]);
    return loadContract(tx, contractId);
  });
}

export function getContract(id: Id): Promise<SignedContractWithState> {
  return read((db) => loadContract(db, id));
}

/** All contracts of a rental, oldest first (voided ones included, for the report). */
export function listContracts(rentalId: Id): Promise<SignedContractWithState[]> {
  return read(async (db) =>
    (await db.getAllAsync<ContractRow>(`${CONTRACT_SELECT} WHERE sc.rental_id = ? ORDER BY sc.sequence`, [rentalId])).map(mapContract),
  );
}

export function getValidContract(rentalId: Id): Promise<SignedContractWithState | null> {
  return read(async (db) => {
    const row = await db.getFirstAsync<ContractRow>(
      `${CONTRACT_SELECT} WHERE sc.rental_id = ? AND cv.contract_id IS NULL ORDER BY sc.sequence DESC LIMIT 1`,
      [rentalId],
    );
    return row ? mapContract(row) : null;
  });
}

export interface ContractVerification {
  ok: boolean;
  problems: string[];
}

/** "Verify contract": recomputes the content hash and re-hashes the signature file. */
export function verifyContract(contractId: Id): Promise<ContractVerification> {
  return read(async (db) => {
    const row = requireRow(await db.getFirstAsync<ContractRow>(`${CONTRACT_SELECT} WHERE sc.id = ?`, [contractId]), 'Signed contract', contractId);
    const platform = getPlatform();
    const problems: string[] = [];
    const recomputed = await platform.sha256Text(
      contractHashPreimage({
        rentalId: row.rental_id,
        sequence: row.sequence,
        templateId: row.template_id,
        templateVersion: row.template_version,
        signerName: row.signer_name,
        signedAt: row.signed_at,
        tzOffsetMin: row.tz_offset_min,
        signatureSha256: row.signature_sha256,
        variablesJson: row.variables_json,
        renderedHtml: row.rendered_html,
      }),
    );
    if (recomputed !== row.content_sha256) problems.push('The contract content does not match its fingerprint.');
    const fileHash = await platform.files.sha256(row.signature_path);
    if (fileHash === null) problems.push('The signature image is missing.');
    else if (fileHash !== row.signature_sha256) problems.push('The signature image has changed.');
    return { ok: problems.length === 0, problems };
  });
}
