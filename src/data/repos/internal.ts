/**
 * Shared plumbing for repositories: transactions with after-commit work, error mapping, row
 * mappers (snake_case rows -> domain objects). Not exported from the barrel.
 */
import type {
  AgencySettings,
  Angle,
  ContractTemplate,
  ContractVoid,
  Customer,
  CustomerDocument,
  Damage,
  DamageMarker,
  GeneratedArtifact,
  Id,
  Inspection,
  InspectionAngleState,
  Photo,
  RelPath,
  Rental,
  SignedContract,
  SignedContractWithState,
  Vehicle,
  VehicleDamage,
} from '@/domain/types';

import { getDb, getPlatform } from '../connection';
import { mapDbError, NotFoundError } from '../errors';
import { emitDataChange, type DataEntity } from '../events';
import type { SqlDb, SqlExecutor } from '../sql';

// ---------------------------------------------------------------------------------------------
// Transactions

export interface WriteScope {
  tx: SqlDb;
  /** One timestamp for the whole write. */
  now: number;
  newId(): Id;
  /** Runs after COMMIT (file deletions). Failures are logged, never thrown. */
  afterCommit(task: () => Promise<void> | void): void;
}

export async function write<T>(entities: readonly DataEntity[], fn: (scope: WriteScope) => Promise<T>): Promise<T> {
  const platform = getPlatform();
  const after: (() => Promise<void> | void)[] = [];
  let result: T;
  try {
    result = await getDb().transaction((tx) =>
      fn({ tx, now: platform.now(), newId: () => platform.newId(), afterCommit: (task) => after.push(task) }),
    );
  } catch (e) {
    throw mapDbError(e);
  }
  for (const task of after) {
    try {
      await task();
    } catch (e) {
      console.warn('[data] after-commit task failed', e);
    }
  }
  emitDataChange(entities);
  return result;
}

export async function read<T>(fn: (db: SqlExecutor) => Promise<T>): Promise<T> {
  try {
    return await fn(getDb());
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Write protocol: file first, then the row. If the row fails the stored copy is removed and the
 * temp source is kept (the caller may retry); after commit the temp source is released.
 */
export async function withImportedFile<T>(sourceUri: string, relPath: RelPath, run: () => Promise<T>): Promise<T> {
  const files = getPlatform().files;
  await files.importFile(sourceUri, relPath);
  let result: T;
  try {
    result = await run();
  } catch (e) {
    await files.deleteFile(relPath).catch(() => undefined);
    throw e;
  }
  await files.releaseTemp(sourceUri).catch(() => undefined);
  return result;
}

/** Photo originals and their cached thumbnails/display copies, after commit. */
export function deletePhotoFilesLater(scope: WriteScope, photos: readonly { id: string; file_path: string }[]): void {
  if (photos.length === 0) return;
  scope.afterCommit(async () => {
    const files = getPlatform().files;
    for (const p of photos) {
      await files.deleteFile(p.file_path);
      await files.deletePhotoDerivatives(p.id);
    }
  });
}

export function deleteFilesLater(scope: WriteScope, paths: readonly (RelPath | null | undefined)[]): void {
  const list = paths.filter((p): p is RelPath => !!p);
  if (list.length === 0) return;
  scope.afterCommit(async () => {
    const files = getPlatform().files;
    for (const p of list) await files.deleteFile(p);
  });
}

export function requireRow<T>(row: T | null | undefined, entity: string, id: string): T {
  if (!row) throw new NotFoundError(entity, id);
  return row;
}

/** Optional text is never stored as '': trimmed text or null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export const bool = (v: number | null | undefined) => v === 1;

// ---------------------------------------------------------------------------------------------
// Rows and mappers

export interface AgencyRow {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  registration_number: string | null;
  logo_path: string | null;
  logo_byte_size: number | null;
  logo_sha256: string | null;
  report_footer: string | null;
  distance_unit: 'km' | 'mi';
  rental_ref_prefix: string;
  rental_ref_last_seq: number;
  updated_at: number;
}

export function mapAgency(r: AgencyRow): AgencySettings {
  return {
    name: r.name,
    address: r.address,
    phone: r.phone,
    email: r.email,
    registrationNumber: r.registration_number,
    logo:
      r.logo_path && r.logo_byte_size !== null && r.logo_sha256
        ? { path: r.logo_path, byteSize: r.logo_byte_size, sha256: r.logo_sha256 }
        : null,
    reportFooter: r.report_footer,
    distanceUnit: r.distance_unit,
    rentalRefPrefix: r.rental_ref_prefix,
    rentalRefLastSeq: r.rental_ref_last_seq,
    updatedAt: r.updated_at,
  };
}

export interface AngleRow {
  key: string;
  label: string;
  angle_group: Angle['group'];
  sort_order: number;
  built_in: number;
  active: number;
}

export function mapAngle(r: AngleRow): Angle {
  return {
    key: r.key,
    label: r.label,
    group: r.angle_group,
    sortOrder: r.sort_order,
    builtIn: bool(r.built_in),
    active: bool(r.active),
  };
}

export interface VehicleRow {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  mileage: number | null;
  photo_path: string | null;
  photo_byte_size: number | null;
  photo_sha256: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export const VEHICLE_COLUMNS =
  'v.id, v.plate, v.make, v.model, v.year, v.color, v.vin, v.mileage, v.photo_path, v.photo_byte_size, ' +
  'v.photo_sha256, v.notes, v.created_at, v.updated_at, v.archived_at';

export function mapVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    plate: r.plate,
    make: r.make,
    model: r.model,
    year: r.year,
    color: r.color,
    vin: r.vin,
    mileage: r.mileage,
    photo:
      r.photo_path && r.photo_byte_size !== null && r.photo_sha256
        ? { path: r.photo_path, byteSize: r.photo_byte_size, sha256: r.photo_sha256 }
        : null,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

export interface CustomerRow {
  id: string;
  full_name: string;
  phone: string | null;
  address: string | null;
  licence_number: string | null;
  id_number: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export const CUSTOMER_COLUMNS =
  'c.id, c.full_name, c.phone, c.address, c.licence_number, c.id_number, c.notes, c.created_at, c.updated_at, c.archived_at';

export function mapCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    address: r.address,
    licenceNumber: r.licence_number,
    idNumber: r.id_number,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at,
  };
}

export interface CustomerDocumentRow {
  id: string;
  customer_id: string | null;
  rental_id: string | null;
  kind: CustomerDocument['kind'];
  label: string | null;
  file_path: string;
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
  captured_at: number;
  created_at: number;
}

export function mapCustomerDocument(r: CustomerDocumentRow): CustomerDocument {
  return {
    id: r.id,
    customerId: r.customer_id,
    rentalId: r.rental_id,
    kind: r.kind,
    label: r.label,
    file: { path: r.file_path, width: r.width, height: r.height, byteSize: r.byte_size, sha256: r.sha256 },
    capturedAt: r.captured_at,
    createdAt: r.created_at,
  };
}

export interface RentalRow {
  id: string;
  reference: string | null;
  status: Rental['status'];
  vehicle_id: string | null;
  customer_id: string | null;
  cust_full_name: string | null;
  cust_phone: string | null;
  cust_address: string | null;
  cust_licence_number: string | null;
  cust_id_number: string | null;
  cust_notes: string | null;
  veh_plate: string | null;
  veh_make: string | null;
  veh_model: string | null;
  veh_year: number | null;
  veh_color: string | null;
  veh_vin: string | null;
  distance_unit: 'km' | 'mi';
  started_at: number | null;
  expected_return_at: number | null;
  start_mileage: number | null;
  start_fuel_eighths: number | null;
  special_terms: string | null;
  activated_at: number | null;
  returned_at: number | null;
  return_mileage: number | null;
  return_fuel_eighths: number | null;
  return_notes: string | null;
  return_revision: number;
  return_completed_at: number | null;
  return_reopened_at: number | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
  resume_step: string | null;
  created_at: number;
  updated_at: number;
}

export function mapRental(r: RentalRow): Rental {
  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    vehicleId: r.vehicle_id,
    customerId: r.customer_id,
    customer: {
      fullName: r.cust_full_name,
      phone: r.cust_phone,
      address: r.cust_address,
      licenceNumber: r.cust_licence_number,
      idNumber: r.cust_id_number,
      notes: r.cust_notes,
    },
    vehicle:
      r.veh_plate === null
        ? null
        : { plate: r.veh_plate, make: r.veh_make, model: r.veh_model, year: r.veh_year, color: r.veh_color, vin: r.veh_vin },
    distanceUnit: r.distance_unit,
    startedAt: r.started_at,
    expectedReturnAt: r.expected_return_at,
    startMileage: r.start_mileage,
    startFuelEighths: r.start_fuel_eighths,
    specialTerms: r.special_terms,
    activatedAt: r.activated_at,
    returnedAt: r.returned_at,
    returnMileage: r.return_mileage,
    returnFuelEighths: r.return_fuel_eighths,
    returnNotes: r.return_notes,
    returnRevision: r.return_revision,
    returnCompletedAt: r.return_completed_at,
    returnReopenedAt: r.return_reopened_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    resumeStep: r.resume_step as Rental['resumeStep'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface InspectionRow {
  id: string;
  rental_id: string;
  phase: Inspection['phase'];
  started_at: number;
}

export function mapInspection(r: InspectionRow): Inspection {
  return { id: r.id, rentalId: r.rental_id, phase: r.phase, startedAt: r.started_at };
}

export interface InspectionAngleRow {
  inspection_id: string;
  angle_key: string;
  slot: number;
  skipped_at: number | null;
  skip_reason: InspectionAngleState['skipReason'];
  reviewed_at: number | null;
  alignment_json: string | null;
  updated_at: number;
}

export function mapInspectionAngle(r: InspectionAngleRow): InspectionAngleState {
  return {
    inspectionId: r.inspection_id,
    angleKey: r.angle_key,
    slot: r.slot,
    skippedAt: r.skipped_at,
    skipReason: r.skip_reason,
    reviewedAt: r.reviewed_at,
    alignment: r.alignment_json ? (JSON.parse(r.alignment_json) as InspectionAngleState['alignment']) : null,
    updatedAt: r.updated_at,
  };
}

export interface PhotoRow {
  id: string;
  rental_id: string;
  inspection_id: string;
  phase: Photo['phase'];
  kind: Photo['kind'];
  angle_key: string;
  slot: number;
  label: string | null;
  capture_order: number;
  captured_at: number;
  tz_offset_min: number;
  file_path: string;
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
  frozen_at: number | null;
  created_at: number;
}

export const PHOTO_COLUMNS =
  'p.id, p.rental_id, p.inspection_id, p.phase, p.kind, p.angle_key, p.slot, p.label, p.capture_order, ' +
  'p.captured_at, p.tz_offset_min, p.file_path, p.width, p.height, p.byte_size, p.sha256, p.frozen_at, p.created_at';

export function mapPhoto(r: PhotoRow): Photo {
  return {
    id: r.id,
    rentalId: r.rental_id,
    inspectionId: r.inspection_id,
    phase: r.phase,
    kind: r.kind,
    angleKey: r.angle_key,
    slot: r.slot,
    label: r.label,
    captureOrder: r.capture_order,
    capturedAt: r.captured_at,
    tzOffsetMin: r.tz_offset_min,
    file: { path: r.file_path, width: r.width, height: r.height, byteSize: r.byte_size, sha256: r.sha256 },
    frozenAt: r.frozen_at,
    createdAt: r.created_at,
  };
}

export interface DamageRow {
  id: string;
  rental_id: string;
  vehicle_id: string;
  vehicle_damage_id: string;
  found_phase: Damage['foundPhase'];
  status: Damage['status'];
  number: number;
  angle_key: string;
  slot: number;
  type: Damage['type'];
  severity: Damage['severity'];
  location_label: string | null;
  note: string | null;
  before_photo_id: string | null;
  after_photo_id: string | null;
  closeup_photo_id: string | null;
  marker_json: string;
  created_at: number;
  updated_at: number;
}

export const DAMAGE_COLUMNS =
  'd.id, d.rental_id, d.vehicle_id, d.vehicle_damage_id, d.found_phase, d.status, d.number, d.angle_key, d.slot, ' +
  'd.type, d.severity, d.location_label, d.note, d.before_photo_id, d.after_photo_id, d.closeup_photo_id, ' +
  'd.marker_json, d.created_at, d.updated_at';

export function mapDamage(r: DamageRow): Damage {
  return {
    id: r.id,
    rentalId: r.rental_id,
    vehicleId: r.vehicle_id,
    vehicleDamageId: r.vehicle_damage_id,
    foundPhase: r.found_phase,
    status: r.status,
    number: r.number,
    angleKey: r.angle_key,
    slot: r.slot,
    type: r.type,
    severity: r.severity,
    locationLabel: r.location_label,
    note: r.note,
    beforePhotoId: r.before_photo_id,
    afterPhotoId: r.after_photo_id,
    closeupPhotoId: r.closeup_photo_id,
    marker: JSON.parse(r.marker_json) as DamageMarker,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface VehicleDamageRow {
  id: string;
  vehicle_id: string;
  resolved_at: number | null;
  resolution: VehicleDamage['resolution'];
  resolution_note: string | null;
  resolved_rental_id: string | null;
  created_at: number;
  updated_at: number;
}

export function mapVehicleDamage(r: VehicleDamageRow): VehicleDamage {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
    resolutionNote: r.resolution_note,
    resolvedRentalId: r.resolved_rental_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface TemplateRow {
  id: string;
  template_key: string;
  version: number;
  title: string;
  body: string;
  body_format: string;
  created_at: number;
}

export function mapTemplate(r: TemplateRow): ContractTemplate {
  return {
    id: r.id,
    templateKey: r.template_key,
    version: r.version,
    title: r.title,
    body: r.body,
    bodyFormat: 'markdown',
    createdAt: r.created_at,
  };
}

export interface ContractRow {
  id: string;
  rental_id: string;
  sequence: number;
  supersedes_id: string | null;
  template_id: string;
  template_version: number;
  rendered_html: string;
  variables_json: string;
  signer_name: string;
  signature_path: string;
  signature_byte_size: number;
  signature_sha256: string;
  signed_at: number;
  tz_offset_min: number;
  content_sha256: string;
  app_version: string;
  created_at: number;
  void_voided_at: number | null;
  void_reason: string | null;
  void_created_at: number | null;
}

export const CONTRACT_SELECT =
  'SELECT sc.*, cv.voided_at AS void_voided_at, cv.reason AS void_reason, cv.created_at AS void_created_at ' +
  'FROM signed_contract sc LEFT JOIN contract_void cv ON cv.contract_id = sc.id';

export function mapContract(r: ContractRow): SignedContractWithState {
  const contract: SignedContract = {
    id: r.id,
    rentalId: r.rental_id,
    sequence: r.sequence,
    supersedesId: r.supersedes_id,
    templateId: r.template_id,
    templateVersion: r.template_version,
    renderedHtml: r.rendered_html,
    variables: JSON.parse(r.variables_json) as SignedContract['variables'],
    signerName: r.signer_name,
    signature: { path: r.signature_path, byteSize: r.signature_byte_size, sha256: r.signature_sha256 },
    signedAt: r.signed_at,
    tzOffsetMin: r.tz_offset_min,
    contentSha256: r.content_sha256,
    appVersion: r.app_version,
    createdAt: r.created_at,
  };
  const voidRecord: ContractVoid | null =
    r.void_voided_at === null
      ? null
      : { contractId: r.id, voidedAt: r.void_voided_at, reason: r.void_reason, createdAt: r.void_created_at ?? r.void_voided_at };
  return { ...contract, void: voidRecord };
}

export interface ArtifactRow {
  id: string;
  rental_id: string;
  kind: GeneratedArtifact['kind'];
  angle_key: string | null;
  slot: number | null;
  contract_id: string | null;
  file_path: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  page_count: number | null;
  source_fingerprint: string;
  generated_at: number;
}

export function mapArtifact(r: ArtifactRow): GeneratedArtifact {
  return {
    id: r.id,
    rentalId: r.rental_id,
    kind: r.kind,
    pairKey: r.angle_key !== null && r.slot !== null ? { angleKey: r.angle_key, slot: r.slot } : null,
    contractId: r.contract_id,
    file: { path: r.file_path, byteSize: r.byte_size, sha256: r.sha256 },
    mimeType: r.mime_type,
    width: r.width,
    height: r.height,
    pageCount: r.page_count,
    sourceFingerprint: r.source_fingerprint,
    generatedAt: r.generated_at,
  };
}
