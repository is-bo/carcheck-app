/**
 * CarCheck domain types: what repositories return and accept. Pure TS, no React/Expo.
 *
 * Mirrors the SQLite schema in src/data/migrations.ts (snake_case columns -> camelCase here;
 * repositories do the mapping). Model and lock rules: docs/DATA_MODEL.md.
 *
 * Conventions
 * - Ids are UUID v4 strings (expo-crypto randomUUID), unique across all tables.
 * - Timestamps are epoch milliseconds (UTC). Evidence rows also keep the device's UTC offset.
 * - File paths are RELATIVE to the files root of the live data directory, never absolute URIs.
 * - `null` means "not provided"; optional text is never stored as ''.
 */
import type { Alignment, DamageMarker } from '../media/geometry';

export type { Alignment, DamageMarker };

export type Id = string;
export type EpochMs = number;
/** e.g. "photos/<rentalId>/<photoId>.jpg". Resolve against the files root at use time. */
export type RelPath = string;
/** Lower-case hex SHA-256. */
export type Sha256Hex = string;

export interface StoredFile {
  path: RelPath;
  byteSize: number;
  sha256: Sha256Hex;
}

/** Image as stored: pixels are upright (orientation baked in), width/height are upright dimensions. */
export interface StoredImage extends StoredFile {
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------------------------
// Enumerations

export const PHASES = ['before', 'after'] as const;
/** before = pick-up inspection, after = return inspection. */
export type Phase = (typeof PHASES)[number];

/** The 8 guided exterior angles, in walk-around order. Keys are stable forever. */
export const EXTERIOR_ANGLE_KEYS = [
  'front', 'front_left', 'left', 'rear_left', 'rear', 'rear_right', 'right', 'front_right',
] as const;
export const DASHBOARD_ANGLE_KEY = 'dashboard';
/** Optional extra shots; repeatable, distinguished by slot (Close-up 1, Close-up 2...). */
export const EXTRA_ANGLE_KEYS = ['interior', 'wheel', 'roof', 'closeup', 'other'] as const;

export type ExteriorAngleKey = (typeof EXTERIOR_ANGLE_KEYS)[number];
export type ExtraAngleKey = (typeof EXTRA_ANGLE_KEYS)[number];
export type BuiltInAngleKey = ExteriorAngleKey | typeof DASHBOARD_ANGLE_KEY | ExtraAngleKey;
/** Built-in keys plus any future custom key ([a-z][a-z0-9_]*). */
export type AngleKey = BuiltInAngleKey | (string & {});
export type AngleGroup = 'exterior' | 'dashboard' | 'extra';

/** A BEFORE photo pairs with the AFTER photo that has the same pair key. */
export interface PairKey {
  angleKey: AngleKey;
  /** 1 for exterior angles and dashboard; 1..n for repeated extras. */
  slot: number;
}

export type RentalStatus = 'draft' | 'active' | 'returned' | 'cancelled';
export type DamageStatus = 'pre_existing' | 'new' | 'uncertain';
export const DAMAGE_TYPES = ['scratch', 'dent', 'crack', 'chip', 'scuff', 'broken', 'missing', 'other'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type DamageSeverity = 'minor' | 'moderate' | 'severe';
export type SkipReason = 'blocked' | 'too_dark' | 'other';
export type PhotoKind = 'angle' | 'damage_closeup';
export type CustomerDocumentKind = 'licence' | 'id_passport' | 'other';
export type DistanceUnit = 'km' | 'mi';
export type KnownDamageResolution = 'repaired' | 'not_found';
export type ArtifactKind = 'evidence_image' | 'contact_sheet' | 'report_pdf' | 'contract_pdf';
/** 0 = empty ... 8 = full. The UI shows quarters (0, 2, 4, 6, 8). */
export type FuelEighths = number;

/** Where "Resume" lands. UI state only; not evidence. */
export type ResumeStep =
  | 'vehicle' | 'customer' | 'capture' | 'condition' | 'details' | 'contract' | 'sign'
  | 'return_capture' | 'return_compare' | 'return_details';

// ---------------------------------------------------------------------------------------------
// Settings & catalog

export interface AgencySettings {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  logo: StoredFile | null;
  reportFooter: string | null;
  distanceUnit: DistanceUnit;
  /** Per-device prefix of rental references ("R" -> "R-0142"); use distinct prefixes per phone. */
  rentalRefPrefix: string;
  rentalRefLastSeq: number;
  updatedAt: EpochMs;
}

export interface Angle {
  key: AngleKey;
  label: string;
  group: AngleGroup;
  sortOrder: number;
  builtIn: boolean;
  active: boolean;
}

// ---------------------------------------------------------------------------------------------
// Vehicles & customers (reusable profiles; archived, never deleted once rented)

export interface Vehicle {
  id: Id;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  /** Last known odometer reading (updated when a return completes). */
  mileage: number | null;
  photo: StoredFile | null;
  notes: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  archivedAt: EpochMs | null;
}

export interface Customer {
  id: Id;
  fullName: string;
  phone: string | null;
  address: string | null;
  licenceNumber: string | null;
  idNumber: string | null;
  notes: string | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
  archivedAt: EpochMs | null;
}

/** ID / licence / other document photo. Owned by a profile, or by a rental for inline customers. */
export interface CustomerDocument {
  id: Id;
  customerId: Id | null;
  rentalId: Id | null;
  kind: CustomerDocumentKind;
  label: string | null;
  file: StoredImage;
  capturedAt: EpochMs;
  createdAt: EpochMs;
}

// ---------------------------------------------------------------------------------------------
// Rental

/** The rental's own copy of the customer; frozen while a valid signed contract exists. */
export interface CustomerSnapshot {
  /** Null only while the rental is a draft. */
  fullName: string | null;
  phone: string | null;
  address: string | null;
  licenceNumber: string | null;
  idNumber: string | null;
  notes: string | null;
}

export interface VehicleSnapshot {
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
}

export interface Rental {
  id: Id;
  /** "R-0142". Assigned once when the contract is first prepared; null for early drafts. */
  reference: string | null;
  status: RentalStatus;
  vehicleId: Id | null;
  /** Link to a profile; null for inline customers. The snapshot below is what counts. */
  customerId: Id | null;
  customer: CustomerSnapshot;
  vehicle: VehicleSnapshot | null;
  distanceUnit: DistanceUnit;
  startedAt: EpochMs | null;
  /** Operational due date; may change after signing (the signed date stays in the contract). */
  expectedReturnAt: EpochMs | null;
  startMileage: number | null;
  startFuelEighths: FuelEighths | null;
  specialTerms: string | null;
  /** First signature time. */
  activatedAt: EpochMs | null;
  returnedAt: EpochMs | null;
  returnMileage: number | null;
  returnFuelEighths: FuelEighths | null;
  returnNotes: string | null;
  /** Times the return was completed; > 1 means the report shows "Revised". */
  returnRevision: number;
  returnCompletedAt: EpochMs | null;
  /** Set while a completed return is reopened for edits ("Edit return"). */
  returnReopenedAt: EpochMs | null;
  cancelledAt: EpochMs | null;
  cancelReason: string | null;
  resumeStep: ResumeStep | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** States the UI shows that are derived, not stored. */
export interface RentalDerivedState {
  /** Active, but every signed contract is voided: "Needs signature". */
  needsSignature: boolean;
  /** Active with a return inspection started, or returned and reopened. */
  returnInProgress: boolean;
  overdue: boolean;
}

// ---------------------------------------------------------------------------------------------
// Inspections, photos, damage

export interface Inspection {
  id: Id;
  rentalId: Id;
  phase: Phase;
  startedAt: EpochMs;
}

/** Per pair-key state inside one inspection (skip, compare review, overlay alignment). */
export interface InspectionAngleState extends PairKey {
  inspectionId: Id;
  skippedAt: EpochMs | null;
  skipReason: SkipReason | null;
  /** AFTER inspection only: the employee viewed this pair in Compare. */
  reviewedAt: EpochMs | null;
  /** AFTER inspection only: BEFORE->AFTER nudge for this pair (see media/geometry). */
  alignment: Alignment | null;
  updatedAt: EpochMs;
}

export interface Photo extends PairKey {
  id: Id;
  rentalId: Id;
  inspectionId: Id;
  phase: Phase;
  /** 'angle' = the canonical shot of its pair key (one per inspection); close-ups are unlimited. */
  kind: PhotoKind;
  label: string | null;
  /** 1..n within the inspection, in shutter order. */
  captureOrder: number;
  capturedAt: EpochMs;
  /**
   * Device UTC offset at capture in minutes EAST of UTC (UTC+02:00 -> 120, i.e.
   * `-new Date().getTimezoneOffset()`), so reports print the local time the employee saw.
   */
  tzOffsetMin: number;
  file: StoredImage;
  /** Set when a signature or completed return makes the photo permanent evidence. */
  frozenAt: EpochMs | null;
  createdAt: EpochMs;
}

/**
 * One observation of a damage within one rental. `marker.ring` is on the photo of `foundPhase`
 * (BEFORE for pick-up marks, AFTER for return marks); `marker.counterpart` optionally overrides
 * the derived ring on the paired photo.
 */
export interface Damage extends PairKey {
  id: Id;
  rentalId: Id;
  vehicleId: Id;
  /** Identity of the physical damage across rentals (known-damage list). */
  vehicleDamageId: Id;
  foundPhase: Phase;
  status: DamageStatus;
  /**
   * Label sequence per rental (DECISIONS: markers). Pre-existing damage is lettered (1 = "A",
   * 2 = "B"...); new and uncertain share ONE numeric sequence, so flipping between them never
   * renumbers. Use damageLabel() from '@/domain/damage' for display.
   */
  number: number;
  /** Null = "Damage (type not set)". */
  type: DamageType | null;
  severity: DamageSeverity | null;
  locationLabel: string | null;
  note: string | null;
  /** Required for pick-up marks; for return marks, the paired BEFORE photo if one exists. */
  beforePhotoId: Id | null;
  /** Required for return marks; always null for pick-up marks. */
  afterPhotoId: Id | null;
  closeupPhotoId: Id | null;
  marker: DamageMarker;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** A physical damage on a vehicle; open until marked repaired / not found. */
export interface VehicleDamage {
  id: Id;
  vehicleId: Id;
  resolvedAt: EpochMs | null;
  resolution: KnownDamageResolution | null;
  resolutionNote: string | null;
  resolvedRentalId: Id | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** Read model for "Known damage" (vehicle detail, pick-up carry-over banner). */
export interface KnownDamageItem {
  vehicleDamage: VehicleDamage;
  /** Most recent observation; its photo and marker drive the suggestion. */
  latest: Damage;
  /** The photo `latest.marker.ring` is drawn on. */
  latestPhoto: Photo;
  firstFoundAt: EpochMs;
  /** Only from listKnownDamageForRental: this rental's own observation ("Still there" done). */
  observationInRental?: Damage | null;
}

// ---------------------------------------------------------------------------------------------
// Contracts

/** Append-only: saving the editor inserts version n+1; the highest version is the active one. */
export interface ContractTemplate {
  id: Id;
  templateKey: string;
  version: number;
  title: string;
  /** Markdown-ish source with {{variables}}. */
  body: string;
  bodyFormat: 'markdown';
  createdAt: EpochMs;
}

/** Variable values exactly as rendered, keyed by variable path ("customer.name"). */
export type ContractVariables = Record<string, unknown>;

/** Immutable. Never updated or deleted; corrections are voided and re-signed. */
export interface SignedContract {
  id: Id;
  rentalId: Id;
  /** 1 = original; 2.. = re-signed after a void. */
  sequence: number;
  supersedesId: Id | null;
  templateId: Id;
  templateVersion: number;
  /**
   * Exact HTML the customer reviewed, before the signature. External references are only
   * `carcheck-photo:<photoId>` and `carcheck-signature:customer`, resolved at display/print time.
   */
  renderedHtml: string;
  variables: ContractVariables;
  signerName: string;
  signature: StoredFile;
  signedAt: EpochMs;
  tzOffsetMin: number;
  /** SHA-256 of contractHashPreimage(...). */
  contentSha256: Sha256Hex;
  appVersion: string;
  createdAt: EpochMs;
}

export interface ContractVoid {
  contractId: Id;
  voidedAt: EpochMs;
  reason: string | null;
  createdAt: EpochMs;
}

export interface SignedContractWithState extends SignedContract {
  void: ContractVoid | null;
}

// ---------------------------------------------------------------------------------------------
// Generated artifacts (regenerable)

export interface GeneratedArtifact {
  id: Id;
  rentalId: Id;
  kind: ArtifactKind;
  /** evidence_image only. */
  pairKey: PairKey | null;
  /** contract_pdf only. */
  contractId: Id | null;
  file: StoredFile;
  mimeType: string;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  /** Opaque key from the generator (e.g. evidenceFingerprint); different key = stale. */
  sourceFingerprint: string;
  generatedAt: EpochMs;
}

// ---------------------------------------------------------------------------------------------
// Backup

export const BACKUP_FORMAT = 'carcheck-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_EXTENSION = '.carcheck';

export interface BackupManifestFile {
  /** Relative to the files root; equals the archive entry name. */
  path: RelPath;
  size: number;
  sha256: Sha256Hex;
}

export interface BackupCounts {
  vehicles: number;
  customers: number;
  rentals: number;
  photos: number;
  signedContracts: number;
  files: number;
}

/** manifest.json at the archive root. */
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  /** ISO 8601 UTC. */
  createdAt: string;
  platform: 'android' | 'ios';
  agencyName: string;
  counts: BackupCounts;
  totalBytes: number;
  /** The DB snapshot, stored at the archive root as carcheck.db. */
  db: { path: 'carcheck.db'; size: number; sha256: Sha256Hex };
  files: BackupManifestFile[];
  /** Referenced by the DB but absent on the device at backup time (known loss, not corruption). */
  missingFiles: RelPath[];
  /** Present but with a size different from the DB record at backup time (copied as-is). */
  damagedFiles: RelPath[];
}

export interface BackupLogEntry {
  id: Id;
  kind: 'backup' | 'restore';
  at: EpochMs;
  fileName: string;
  byteSize: number | null;
  schemaVersion: number;
  /** For 'restore': when the restored backup was made. For 'backup': equals `at`. */
  backupCreatedAt: EpochMs;
  counts: BackupCounts | null;
}

// ---------------------------------------------------------------------------------------------
// Inputs from the capture / generation pipelines

/**
 * A finished file waiting in a temp location (cache). The repository moves it into the files
 * root and records it; hash and size must be computed on these exact final bytes.
 */
export interface CapturedFile {
  tempUri: string;
  byteSize: number;
  sha256: Sha256Hex;
}

/** An upright photo (orientation baked in) ready to be stored. */
export interface CapturedImage extends CapturedFile {
  width: number;
  height: number;
  capturedAt: EpochMs;
  /** Minutes east of UTC at capture (see Photo.tzOffsetMin). */
  tzOffsetMin: number;
}

/** Which generated file a GeneratedArtifact row stands for (one row per target). */
export type ArtifactTarget =
  | { kind: 'evidence_image'; pairKey: PairKey }
  | { kind: 'contact_sheet' }
  | { kind: 'report_pdf' }
  | { kind: 'contract_pdf'; contractId: Id };

/** Row of the v_file_ref view: every file the DB references. */
export interface FileRef {
  id: Id;
  owner: 'photo' | 'customer_document' | 'signature' | 'artifact' | 'vehicle_photo' | 'agency_logo';
  path: RelPath;
  byteSize: number;
  sha256: Sha256Hex;
}

// ---------------------------------------------------------------------------------------------
// Read models (what list and detail screens receive)

export interface RentalListItem {
  rental: Rental;
  derived: RentalDerivedState;
  hasValidContract: boolean;
  contractCount: number;
  /** Required exterior angles captured or skipped, per inspection ("Inspection 5 of 8"). */
  beforeProgress: { done: number; total: number };
  afterProgress: { done: number; total: number } | null;
  existingDamageCount: number;
  newDamageCount: number;
  uncertainDamageCount: number;
}

export interface HomeSections {
  /** Drafts, returns in progress and rentals whose contract was voided (needs signature). */
  unfinished: RentalListItem[];
  /** Active: overdue first, then due before the end of today. */
  dueBack: RentalListItem[];
  /** Other active rentals, soonest due first. */
  out: RentalListItem[];
  /** Returned in the last 7 days, newest first, max 5. */
  returned: RentalListItem[];
}

export interface VehicleOutInfo {
  rentalId: Id;
  reference: string | null;
  customerName: string | null;
  expectedReturnAt: EpochMs | null;
}

export interface VehicleListItem {
  vehicle: Vehicle;
  /** Null = Available. */
  out: VehicleOutInfo | null;
  lastRentalAt: EpochMs | null;
}

export interface VehicleDetail {
  vehicle: Vehicle;
  out: VehicleOutInfo | null;
  /** Non-draft rentals, newest first. */
  history: RentalListItem[];
  knownDamage: KnownDamageItem[];
  /** Signed-contract and report PDFs of this vehicle's rentals, newest first. */
  documents: GeneratedArtifact[];
  /** Latest front-left photo (header fallback when the vehicle has no photo of its own). */
  latestPhoto: Photo | null;
}

export interface CustomerListItem {
  customer: Customer;
  rentalCount: number;
  lastRentalAt: EpochMs | null;
  documentCount: number;
}

export interface CustomerDetail {
  customer: Customer;
  documents: CustomerDocument[];
  rentals: RentalListItem[];
}

export interface RentalDetail {
  item: RentalListItem;
  /** Live profiles (may be archived); the rental's own snapshot is what counts. */
  vehicleProfile: Vehicle | null;
  customerProfile: Customer | null;
  contracts: SignedContractWithState[];
  before: Inspection | null;
  after: Inspection | null;
  damage: Damage[];
  /** Documents owned by the rental (inline customer) plus the linked profile's documents. */
  documents: CustomerDocument[];
  artifacts: GeneratedArtifact[];
}

/** One pair key inside one inspection: the capture diagram / condition grid tile. */
export interface InspectionAngleView extends PairKey {
  label: string;
  group: AngleGroup;
  photo: Photo | null;
  state: InspectionAngleState | null;
  damageCount: number;
}

/** BEFORE and AFTER of one pair key, the unit of comparison and evidence. */
export interface AnglePair extends PairKey {
  label: string;
  group: AngleGroup;
  before: Photo | null;
  after: Photo | null;
  beforeState: InspectionAngleState | null;
  afterState: InspectionAngleState | null;
  existingDamageCount: number;
  newDamageCount: number;
  uncertainDamageCount: number;
}

// ---------------------------------------------------------------------------------------------
// Pure helpers whose output must be identical wherever it is produced

/** "R-0142": prefix, dash, sequence zero-padded to 4 (grows naturally past 9999). */
export function formatRentalReference(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

/**
 * Canonical text whose SHA-256 (UTF-8) is SignedContract.contentSha256. Variable-length fields
 * are length-prefixed so no two different contracts share a preimage. Changing this function
 * breaks verification of existing contracts: add a new version tag instead.
 */
export function contractHashPreimage(c: {
  rentalId: Id;
  sequence: number;
  templateId: Id;
  templateVersion: number;
  signerName: string;
  signedAt: EpochMs;
  tzOffsetMin: number;
  signatureSha256: Sha256Hex;
  variablesJson: string;
  renderedHtml: string;
}): string {
  const field = (name: string, value: string) => `${name}=${value.length}:${value}\n`;
  return (
    'carcheck-contract/1\n' +
    field('rental_id', c.rentalId) +
    field('sequence', String(c.sequence)) +
    field('template_id', c.templateId) +
    field('template_version', String(c.templateVersion)) +
    field('signer_name', c.signerName) +
    field('signed_at', String(c.signedAt)) +
    field('tz_offset_min', String(c.tzOffsetMin)) +
    field('signature_sha256', c.signatureSha256) +
    field('variables_json', c.variablesJson) +
    field('rendered_html', c.renderedHtml)
  );
}
