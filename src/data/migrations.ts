/**
 * CarCheck SQLite schema as ordered forward migrations, tracked with PRAGMA user_version.
 *
 * Why TS and not a .sql asset: Metro bundles this module directly (no asset loading, no async
 * file read at boot), Jest/Node can run it unchanged, and repeated trigger predicates are built
 * from a few helpers instead of being copy-pasted 20 times.
 *
 * Rules
 * - A migration that has shipped is NEVER edited (helpers used by it are frozen with it).
 *   Change the schema by appending a migration with the next version number.
 * - Each migration runs in one transaction together with its user_version bump.
 * - Pure module: no expo imports. Anything exposing execAsync/getFirstAsync/getAllAsync works
 *   (expo-sqlite's SQLiteDatabase in the app, a node:sqlite wrapper in tests).
 *
 * The lock rules the triggers enforce are explained in docs/DATA_MODEL.md §3.
 */

/** Structural subset of expo-sqlite's SQLiteDatabase used here. */
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string): Promise<T | null>;
  getAllAsync<T>(source: string): Promise<T[]>;
}

export interface Migration {
  version: number;
  name: string;
  /** Table rebuilds (SQLite's 12-step ALTER) need FKs off; the runner re-checks them before COMMIT. */
  foreignKeysOff?: boolean;
  sql: string;
}

export const DB_FILE_NAME = 'carcheck.db';

/** Prefixes of trigger RAISE() messages, so repositories can map failures to typed errors. */
export const DB_ERROR = {
  /** Row can never change (signed contract, void record, template version, frozen photo). */
  immutable: 'CARCHECK_IMMUTABLE',
  /** Row is locked by the rental's state (signed, returned, cancelled); an explicit action unlocks it. */
  locked: 'CARCHECK_LOCKED',
  /** Write would break a cross-row rule (wrong photo for the angle, illegal status change...). */
  invalid: 'CARCHECK_INVALID',
} as const;

/** Run on every connection, before migrate(). Must be outside a transaction. */
export const CONNECTION_PRAGMAS =
  'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;';

// ---------------------------------------------------------------------------------------------
// Helpers for migration 1 (frozen with it)

const NOW_MS = `(CAST(strftime('%s', 'now') AS INTEGER) * 1000)`;

/** Relative path under the files root: "dir/..."; no leading slash, scheme, drive, "..", "\" or "//". */
const relPath = (col: string) =>
  `(${col} IS NULL OR (${col} GLOB '[a-z]*/?*' AND ${col} NOT GLOB '*..*' AND ${col} NOT GLOB '*:*'` +
  ` AND ${col} NOT GLOB '*\\*' AND ${col} NOT GLOB '*//*'))`;

const sha256 = (col: string) => `(${col} IS NULL OR (length(${col}) = 64 AND ${col} NOT GLOB '*[^0-9a-f]*'))`;

const raise = (code: string, message: string) => `SELECT RAISE(ABORT, '${code}: ${message}');`;

const changed = (cols: readonly string[]) => `(${cols.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(' OR ')})`;

/** The rental has a signed contract that is not voided. */
const activeContract = (rentalId: string) =>
  `EXISTS (SELECT 1 FROM signed_contract sc WHERE sc.rental_id = ${rentalId}` +
  ` AND NOT EXISTS (SELECT 1 FROM contract_void cv WHERE cv.contract_id = sc.id))`;

/**
 * Pick-up evidence is editable while the rental is a draft, or active without a valid contract
 * (voided, waiting for re-sign). "Locked" is false when the rental row is gone, so cascading
 * deletes of a draft are never blocked (the rental delete trigger only lets drafts through).
 */
const beforeLocked = (rentalId: string) =>
  `EXISTS (SELECT 1 FROM rental rr WHERE rr.id = ${rentalId} AND NOT (rr.status = 'draft'` +
  ` OR (rr.status = 'active' AND NOT ${activeContract('rr.id')})))`;

/** Return evidence is editable while the rental is out, or its completed return was reopened. */
const afterLocked = (rentalId: string) =>
  `EXISTS (SELECT 1 FROM rental rr WHERE rr.id = ${rentalId} AND NOT (rr.status = 'active'` +
  ` OR (rr.status = 'returned' AND rr.return_reopened_at IS NOT NULL)))`;

const phaseLocked = (rentalId: string, phase: string) =>
  `(CASE ${phase} WHEN 'before' THEN ${beforeLocked(rentalId)} ELSE ${afterLocked(rentalId)} END)`;

const RENTAL_COLUMNS = [
  'id', 'reference', 'status', 'vehicle_id', 'customer_id',
  'cust_full_name', 'cust_phone', 'cust_address', 'cust_licence_number', 'cust_id_number', 'cust_notes',
  'veh_plate', 'veh_make', 'veh_model', 'veh_year', 'veh_color', 'veh_vin',
  'distance_unit', 'started_at', 'expected_return_at', 'start_mileage', 'start_fuel_eighths', 'special_terms',
  'activated_at', 'returned_at', 'return_mileage', 'return_fuel_eighths', 'return_notes',
  'return_revision', 'return_completed_at', 'return_reopened_at',
  'cancelled_at', 'cancel_reason', 'resume_step', 'created_at', 'updated_at',
] as const;

/** Snapshot + start conditions the customer signed. expected_return_at is deliberately NOT here:
 *  it is operational (phone extensions); the agreed date stays frozen in the contract snapshot. */
const RENTAL_CONTRACT_COLUMNS = [
  'vehicle_id',
  'cust_full_name', 'cust_phone', 'cust_address', 'cust_licence_number', 'cust_id_number', 'cust_notes',
  'veh_plate', 'veh_make', 'veh_model', 'veh_year', 'veh_color', 'veh_vin',
  'distance_unit', 'started_at', 'start_mileage', 'start_fuel_eighths', 'special_terms',
] as const;

const RENTAL_RETURN_COLUMNS = [
  'returned_at', 'return_mileage', 'return_fuel_eighths', 'return_notes', 'return_revision', 'return_completed_at',
] as const;

const RENTAL_CANCELLED_COLUMNS = RENTAL_COLUMNS.filter((c) => c !== 'customer_id' && c !== 'updated_at');

/** A damage row must point at photos of its own rental, pair (angle + slot) and phase. */
const damageInconsistent = `
     NEW.vehicle_id IS NOT (SELECT vehicle_id FROM rental WHERE id = NEW.rental_id)
  OR NEW.vehicle_id IS NOT (SELECT vehicle_id FROM vehicle_damage WHERE id = NEW.vehicle_damage_id)
  OR (NEW.before_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM photo p WHERE p.id = NEW.before_photo_id
      AND p.rental_id = NEW.rental_id AND p.phase = 'before' AND p.kind = 'angle'
      AND p.angle_key = NEW.angle_key AND p.slot = NEW.slot))
  OR (NEW.after_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM photo p WHERE p.id = NEW.after_photo_id
      AND p.rental_id = NEW.rental_id AND p.phase = 'after' AND p.kind = 'angle'
      AND p.angle_key = NEW.angle_key AND p.slot = NEW.slot))
  OR (NEW.closeup_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM photo p WHERE p.id = NEW.closeup_photo_id
      AND p.rental_id = NEW.rental_id AND p.kind = 'damage_closeup'))`;

const IMMUTABLE = 'CARCHECK_IMMUTABLE';
const LOCKED = 'CARCHECK_LOCKED';
const INVALID = 'CARCHECK_INVALID';

// ---------------------------------------------------------------------------------------------
// Migration 1: initial schema

const V1_TABLES = `
CREATE TABLE agency_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  name                 TEXT NOT NULL DEFAULT '',
  address              TEXT,
  phone                TEXT,
  email                TEXT,
  registration_number  TEXT,
  logo_path            TEXT UNIQUE CHECK ${relPath('logo_path')},
  logo_byte_size       INTEGER CHECK (logo_byte_size IS NULL OR logo_byte_size > 0),
  logo_sha256          TEXT CHECK ${sha256('logo_sha256')},
  report_footer        TEXT,
  distance_unit        TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi')),
  rental_ref_prefix    TEXT NOT NULL DEFAULT 'R'
                       CHECK (length(rental_ref_prefix) BETWEEN 1 AND 6 AND rental_ref_prefix NOT GLOB '*[^A-Z0-9]*'),
  rental_ref_last_seq  INTEGER NOT NULL DEFAULT 0 CHECK (rental_ref_last_seq >= 0),
  updated_at           INTEGER NOT NULL,
  CHECK ((logo_path IS NULL) = (logo_sha256 IS NULL) AND (logo_path IS NULL) = (logo_byte_size IS NULL))
);

CREATE TABLE angle (
  key          TEXT PRIMARY KEY NOT NULL CHECK (key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*'),
  label        TEXT NOT NULL,
  angle_group  TEXT NOT NULL CHECK (angle_group IN ('exterior', 'dashboard', 'extra')),
  sort_order   INTEGER NOT NULL,
  built_in     INTEGER NOT NULL DEFAULT 0 CHECK (built_in IN (0, 1)),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
) WITHOUT ROWID;

CREATE TABLE contract_template (
  id            TEXT PRIMARY KEY NOT NULL,
  template_key  TEXT NOT NULL DEFAULT 'default',
  version       INTEGER NOT NULL CHECK (version >= 1),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  body_format   TEXT NOT NULL DEFAULT 'markdown',
  created_at    INTEGER NOT NULL,
  UNIQUE (template_key, version)
);

CREATE TABLE vehicle (
  id               TEXT PRIMARY KEY NOT NULL,
  plate            TEXT NOT NULL CHECK (length(trim(plate)) > 0),
  plate_key        TEXT GENERATED ALWAYS AS (upper(replace(replace(replace(plate, ' ', ''), '-', ''), '.', ''))) VIRTUAL,
  make             TEXT,
  model            TEXT,
  year             INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  color            TEXT,
  vin              TEXT,
  mileage          INTEGER CHECK (mileage IS NULL OR mileage >= 0),
  photo_path       TEXT UNIQUE CHECK ${relPath('photo_path')},
  photo_byte_size  INTEGER CHECK (photo_byte_size IS NULL OR photo_byte_size > 0),
  photo_sha256     TEXT CHECK ${sha256('photo_sha256')},
  notes            TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  archived_at      INTEGER,
  CHECK ((photo_path IS NULL) = (photo_sha256 IS NULL) AND (photo_path IS NULL) = (photo_byte_size IS NULL))
);

CREATE TABLE customer (
  id              TEXT PRIMARY KEY NOT NULL,
  full_name       TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone           TEXT,
  address         TEXT,
  licence_number  TEXT,
  id_number       TEXT,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  archived_at     INTEGER
);

CREATE TABLE rental (
  id                   TEXT PRIMARY KEY NOT NULL,
  reference            TEXT UNIQUE,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'returned', 'cancelled')),
  vehicle_id           TEXT REFERENCES vehicle(id) ON DELETE RESTRICT,
  customer_id          TEXT REFERENCES customer(id) ON DELETE RESTRICT,
  cust_full_name       TEXT,
  cust_phone           TEXT,
  cust_address         TEXT,
  cust_licence_number  TEXT,
  cust_id_number       TEXT,
  cust_notes           TEXT,
  veh_plate            TEXT CHECK (veh_plate IS NULL OR length(trim(veh_plate)) > 0),
  veh_make             TEXT,
  veh_model            TEXT,
  veh_year             INTEGER,
  veh_color            TEXT,
  veh_vin              TEXT,
  distance_unit        TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km', 'mi')),
  started_at           INTEGER,
  expected_return_at   INTEGER,
  start_mileage        INTEGER CHECK (start_mileage IS NULL OR start_mileage >= 0),
  start_fuel_eighths   INTEGER CHECK (start_fuel_eighths IS NULL OR start_fuel_eighths BETWEEN 0 AND 8),
  special_terms        TEXT,
  activated_at         INTEGER,
  returned_at          INTEGER,
  return_mileage       INTEGER CHECK (return_mileage IS NULL OR return_mileage >= 0),
  return_fuel_eighths  INTEGER CHECK (return_fuel_eighths IS NULL OR return_fuel_eighths BETWEEN 0 AND 8),
  return_notes         TEXT,
  return_revision      INTEGER NOT NULL DEFAULT 0 CHECK (return_revision >= 0),
  return_completed_at  INTEGER,
  return_reopened_at   INTEGER,
  cancelled_at         INTEGER,
  cancel_reason        TEXT,
  resume_step          TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK ((vehicle_id IS NULL) = (veh_plate IS NULL)),
  CHECK (status = 'draft' OR (reference IS NOT NULL AND vehicle_id IS NOT NULL AND started_at IS NOT NULL
         AND activated_at IS NOT NULL AND length(trim(coalesce(cust_full_name, ''))) > 0)),
  CHECK (status <> 'returned' OR (returned_at IS NOT NULL AND return_completed_at IS NOT NULL AND return_revision >= 1)),
  CHECK (return_reopened_at IS NULL OR status = 'returned'),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE TABLE customer_document (
  id           TEXT PRIMARY KEY NOT NULL,
  customer_id  TEXT REFERENCES customer(id) ON DELETE CASCADE,
  rental_id    TEXT REFERENCES rental(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('licence', 'id_passport', 'other')),
  label        TEXT,
  file_path    TEXT NOT NULL UNIQUE CHECK ${relPath('file_path')},
  width        INTEGER NOT NULL CHECK (width > 0),
  height       INTEGER NOT NULL CHECK (height > 0),
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  sha256       TEXT NOT NULL CHECK ${sha256('sha256')},
  captured_at  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  CHECK ((customer_id IS NULL) <> (rental_id IS NULL))
);

CREATE TABLE inspection (
  id          TEXT PRIMARY KEY NOT NULL,
  rental_id   TEXT NOT NULL REFERENCES rental(id) ON DELETE CASCADE,
  phase       TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  started_at  INTEGER NOT NULL,
  UNIQUE (rental_id, phase),
  UNIQUE (id, rental_id, phase)
);

CREATE TABLE inspection_angle (
  inspection_id   TEXT NOT NULL REFERENCES inspection(id) ON DELETE CASCADE,
  angle_key       TEXT NOT NULL REFERENCES angle(key),
  slot            INTEGER NOT NULL DEFAULT 1 CHECK (slot >= 1),
  skipped_at      INTEGER,
  skip_reason     TEXT CHECK (skip_reason IS NULL OR skip_reason IN ('blocked', 'too_dark', 'other')),
  reviewed_at     INTEGER,
  alignment_json  TEXT CHECK (alignment_json IS NULL OR json_valid(alignment_json)),
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (inspection_id, angle_key, slot),
  CHECK (skip_reason IS NULL OR skipped_at IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE photo (
  id             TEXT PRIMARY KEY NOT NULL,
  rental_id      TEXT NOT NULL,
  inspection_id  TEXT NOT NULL,
  phase          TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  kind           TEXT NOT NULL DEFAULT 'angle' CHECK (kind IN ('angle', 'damage_closeup')),
  angle_key      TEXT NOT NULL REFERENCES angle(key),
  slot           INTEGER NOT NULL DEFAULT 1 CHECK (slot >= 1),
  label          TEXT,
  capture_order  INTEGER NOT NULL CHECK (capture_order >= 1),
  captured_at    INTEGER NOT NULL,
  tz_offset_min  INTEGER NOT NULL,
  file_path      TEXT NOT NULL UNIQUE CHECK ${relPath('file_path')},
  width          INTEGER NOT NULL CHECK (width > 0),
  height         INTEGER NOT NULL CHECK (height > 0),
  byte_size      INTEGER NOT NULL CHECK (byte_size > 0),
  sha256         TEXT NOT NULL CHECK ${sha256('sha256')},
  frozen_at      INTEGER,
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (inspection_id, rental_id, phase) REFERENCES inspection(id, rental_id, phase) ON DELETE CASCADE,
  UNIQUE (inspection_id, capture_order)
);

CREATE TABLE vehicle_damage (
  id                  TEXT PRIMARY KEY NOT NULL,
  vehicle_id          TEXT NOT NULL REFERENCES vehicle(id) ON DELETE RESTRICT,
  resolved_at         INTEGER,
  resolution          TEXT CHECK (resolution IS NULL OR resolution IN ('repaired', 'not_found')),
  resolution_note     TEXT,
  resolved_rental_id  TEXT REFERENCES rental(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

CREATE TABLE damage (
  id                 TEXT PRIMARY KEY NOT NULL,
  rental_id          TEXT NOT NULL REFERENCES rental(id) ON DELETE CASCADE,
  vehicle_id         TEXT NOT NULL REFERENCES vehicle(id) ON DELETE RESTRICT,
  vehicle_damage_id  TEXT NOT NULL REFERENCES vehicle_damage(id),
  found_phase        TEXT NOT NULL CHECK (found_phase IN ('before', 'after')),
  status             TEXT NOT NULL CHECK (status IN ('pre_existing', 'new', 'uncertain')),
  number             INTEGER NOT NULL CHECK (number >= 1),
  angle_key          TEXT NOT NULL REFERENCES angle(key),
  slot               INTEGER NOT NULL DEFAULT 1 CHECK (slot >= 1),
  type               TEXT,
  severity           TEXT CHECK (severity IS NULL OR severity IN ('minor', 'moderate', 'severe')),
  location_label     TEXT,
  note               TEXT,
  before_photo_id    TEXT REFERENCES photo(id),
  after_photo_id     TEXT REFERENCES photo(id),
  closeup_photo_id   TEXT REFERENCES photo(id),
  marker_json        TEXT NOT NULL CHECK (json_valid(marker_json)),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  CHECK (found_phase = 'after' OR (status = 'pre_existing' AND before_photo_id IS NOT NULL AND after_photo_id IS NULL)),
  CHECK (found_phase = 'before' OR after_photo_id IS NOT NULL)
);

CREATE TABLE signed_contract (
  id                   TEXT PRIMARY KEY NOT NULL,
  rental_id            TEXT NOT NULL REFERENCES rental(id) ON DELETE RESTRICT,
  sequence             INTEGER NOT NULL CHECK (sequence >= 1),
  supersedes_id        TEXT REFERENCES signed_contract(id),
  template_id          TEXT NOT NULL REFERENCES contract_template(id) ON DELETE RESTRICT,
  template_version     INTEGER NOT NULL,
  rendered_html        TEXT NOT NULL,
  variables_json       TEXT NOT NULL CHECK (json_valid(variables_json)),
  signer_name          TEXT NOT NULL CHECK (length(trim(signer_name)) > 0),
  signature_path       TEXT NOT NULL UNIQUE CHECK ${relPath('signature_path')},
  signature_byte_size  INTEGER NOT NULL CHECK (signature_byte_size > 0),
  signature_sha256     TEXT NOT NULL CHECK ${sha256('signature_sha256')},
  signed_at            INTEGER NOT NULL,
  tz_offset_min        INTEGER NOT NULL,
  content_sha256       TEXT NOT NULL CHECK ${sha256('content_sha256')},
  app_version          TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  UNIQUE (rental_id, sequence),
  CHECK ((sequence = 1) = (supersedes_id IS NULL))
);

CREATE TABLE contract_void (
  contract_id  TEXT PRIMARY KEY NOT NULL REFERENCES signed_contract(id) ON DELETE RESTRICT,
  voided_at    INTEGER NOT NULL,
  reason       TEXT,
  created_at   INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE generated_artifact (
  id                  TEXT PRIMARY KEY NOT NULL,
  rental_id           TEXT NOT NULL REFERENCES rental(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('evidence_image', 'contact_sheet', 'report_pdf', 'contract_pdf')),
  angle_key           TEXT REFERENCES angle(key),
  slot                INTEGER CHECK (slot IS NULL OR slot >= 1),
  contract_id         TEXT REFERENCES signed_contract(id),
  file_path           TEXT NOT NULL UNIQUE CHECK ${relPath('file_path')},
  mime_type           TEXT NOT NULL,
  byte_size           INTEGER NOT NULL CHECK (byte_size > 0),
  sha256              TEXT NOT NULL CHECK ${sha256('sha256')},
  width               INTEGER,
  height              INTEGER,
  page_count          INTEGER,
  source_fingerprint  TEXT NOT NULL,
  generated_at        INTEGER NOT NULL,
  CHECK ((kind = 'evidence_image') = (angle_key IS NOT NULL)),
  CHECK ((angle_key IS NULL) = (slot IS NULL)),
  CHECK ((kind = 'contract_pdf') = (contract_id IS NOT NULL))
);

CREATE TABLE app_pref (
  key         TEXT PRIMARY KEY NOT NULL,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE backup_log (
  id                 TEXT PRIMARY KEY NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('backup', 'restore')),
  at                 INTEGER NOT NULL,
  file_name          TEXT NOT NULL,
  byte_size          INTEGER,
  schema_version     INTEGER NOT NULL,
  backup_created_at  INTEGER NOT NULL,
  counts_json        TEXT CHECK (counts_json IS NULL OR json_valid(counts_json))
);
`;

const V1_INDEXES = `
CREATE INDEX idx_vehicle_plate_key ON vehicle(plate_key);
CREATE INDEX idx_customer_name ON customer(full_name COLLATE NOCASE);
CREATE INDEX idx_rental_status_due ON rental(status, expected_return_at);
CREATE INDEX idx_rental_vehicle ON rental(vehicle_id, created_at);
CREATE INDEX idx_rental_customer ON rental(customer_id);
-- A vehicle can be out on only one rental at a time.
CREATE UNIQUE INDEX ux_rental_vehicle_out ON rental(vehicle_id) WHERE status = 'active';
CREATE INDEX idx_customer_document_customer ON customer_document(customer_id);
CREATE INDEX idx_customer_document_rental ON customer_document(rental_id);
-- One canonical shot per pair key (angle + slot) per inspection; close-ups are unlimited.
CREATE UNIQUE INDEX ux_photo_pair ON photo(inspection_id, angle_key, slot) WHERE kind = 'angle';
CREATE INDEX idx_photo_rental ON photo(rental_id, phase, angle_key, slot);
CREATE INDEX idx_vehicle_damage_vehicle ON vehicle_damage(vehicle_id, resolved_at);
-- Label sequences per rental (DECISIONS): pre-existing is lettered A, B...; new + uncertain share one sequence.
CREATE UNIQUE INDEX ux_damage_number ON damage(rental_id, (status = 'pre_existing'), number);
CREATE INDEX idx_damage_rental_pair ON damage(rental_id, angle_key, slot);
CREATE INDEX idx_damage_vehicle ON damage(vehicle_id, created_at);
CREATE INDEX idx_damage_identity ON damage(vehicle_damage_id);
CREATE INDEX idx_damage_before_photo ON damage(before_photo_id);
CREATE INDEX idx_damage_after_photo ON damage(after_photo_id);
CREATE INDEX idx_damage_closeup_photo ON damage(closeup_photo_id);
CREATE INDEX idx_signed_contract_template ON signed_contract(template_id);
CREATE UNIQUE INDEX ux_artifact_target ON generated_artifact(
  rental_id, kind, coalesce(angle_key, ''), coalesce(slot, 0), coalesce(contract_id, ''));
CREATE INDEX idx_backup_log_at ON backup_log(kind, at);
`;

/** Every stored file, for backup manifests, orphan sweeps and the media viewer. New file columns MUST be added here. */
const V1_VIEWS = `
CREATE VIEW v_file_ref (id, owner, path, byte_size, sha256) AS
  SELECT id, 'photo', file_path, byte_size, sha256 FROM photo
  UNION ALL SELECT id, 'customer_document', file_path, byte_size, sha256 FROM customer_document
  UNION ALL SELECT id, 'signature', signature_path, signature_byte_size, signature_sha256 FROM signed_contract
  UNION ALL SELECT id, 'artifact', file_path, byte_size, sha256 FROM generated_artifact
  UNION ALL SELECT id, 'vehicle_photo', photo_path, photo_byte_size, photo_sha256 FROM vehicle WHERE photo_path IS NOT NULL
  UNION ALL SELECT 'agency_logo', 'agency_logo', logo_path, logo_byte_size, logo_sha256 FROM agency_settings
    WHERE logo_path IS NOT NULL;
`;

const V1_TRIGGERS = `
-- angle: keys are stable identities; built-ins cannot be removed.
CREATE TRIGGER trg_angle_key_immutable BEFORE UPDATE OF key ON angle WHEN NEW.key IS NOT OLD.key
BEGIN ${raise(IMMUTABLE, 'angle keys never change')} END;
CREATE TRIGGER trg_angle_builtin_no_delete BEFORE DELETE ON angle WHEN OLD.built_in = 1
BEGIN ${raise(IMMUTABLE, 'built-in angles cannot be deleted')} END;

-- contract_template: append-only; editing saves a new version.
CREATE TRIGGER trg_template_append_only BEFORE UPDATE ON contract_template
BEGIN ${raise(IMMUTABLE, 'template versions are append-only; save a new version')} END;

-- rental
CREATE TRIGGER trg_rental_reference_once BEFORE UPDATE ON rental
WHEN NEW.id IS NOT OLD.id OR (OLD.reference IS NOT NULL AND NEW.reference IS NOT OLD.reference)
BEGIN ${raise(IMMUTABLE, 'rental id and reference never change once assigned')} END;

CREATE TRIGGER trg_rental_status_transition BEFORE UPDATE OF status ON rental
WHEN NEW.status IS NOT OLD.status AND (
     NOT ((OLD.status = 'draft' AND NEW.status = 'active')
       OR (OLD.status = 'active' AND NEW.status IN ('returned', 'cancelled')))
  OR (NEW.status = 'active' AND NOT ${activeContract('NEW.id')}))
BEGIN ${raise(INVALID, 'illegal rental status change')} END;

CREATE TRIGGER trg_rental_contract_fields_locked BEFORE UPDATE ON rental
WHEN ${changed(RENTAL_CONTRACT_COLUMNS)} AND ${activeContract('OLD.id')}
BEGIN ${raise(LOCKED, 'covered by the signed contract; void and re-sign to change it')} END;

CREATE TRIGGER trg_rental_return_fields_locked BEFORE UPDATE ON rental
WHEN OLD.status = 'returned' AND OLD.return_reopened_at IS NULL AND ${changed(RENTAL_RETURN_COLUMNS)}
BEGIN ${raise(LOCKED, 'return is completed; reopen it to edit')} END;

CREATE TRIGGER trg_rental_cancelled_locked BEFORE UPDATE ON rental
WHEN OLD.status = 'cancelled' AND (${changed(RENTAL_CANCELLED_COLUMNS)}
  OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS NOT OLD.customer_id))
BEGIN ${raise(LOCKED, 'cancelled rentals cannot change')} END;

CREATE TRIGGER trg_rental_vehicle_change BEFORE UPDATE OF vehicle_id ON rental
WHEN NEW.vehicle_id IS NOT OLD.vehicle_id AND EXISTS (SELECT 1 FROM damage WHERE rental_id = OLD.id)
BEGIN ${raise(INVALID, 'remove the damage marks of this rental before changing its vehicle')} END;

CREATE TRIGGER trg_rental_delete_draft_only BEFORE DELETE ON rental WHEN OLD.status <> 'draft'
BEGIN ${raise(IMMUTABLE, 'only draft rentals can be deleted')} END;

-- Completing (or re-completing) a return, or cancelling, freezes every photo of the rental.
CREATE TRIGGER trg_rental_freeze_photos AFTER UPDATE ON rental
WHEN (NEW.status = 'returned' AND NEW.return_reopened_at IS NULL
      AND (OLD.status IS NOT 'returned' OR OLD.return_reopened_at IS NOT NULL))
  OR (NEW.status = 'cancelled' AND OLD.status IS NOT 'cancelled')
BEGIN
  UPDATE photo SET frozen_at = NEW.updated_at WHERE rental_id = NEW.id AND frozen_at IS NULL;
END;

-- photo: insert only while its phase is open; frozen photos never change or disappear.
CREATE TRIGGER trg_photo_insert_gate BEFORE INSERT ON photo WHEN ${phaseLocked('NEW.rental_id', 'NEW.phase')}
BEGIN ${raise(LOCKED, 'this inspection is closed for new photos')} END;
CREATE TRIGGER trg_photo_frozen_update BEFORE UPDATE ON photo WHEN OLD.frozen_at IS NOT NULL
BEGIN ${raise(IMMUTABLE, 'photo is part of signed or completed evidence')} END;
CREATE TRIGGER trg_photo_frozen_delete BEFORE DELETE ON photo WHEN OLD.frozen_at IS NOT NULL
BEGIN ${raise(IMMUTABLE, 'photo is part of signed or completed evidence')} END;

-- damage: editable only while its phase is open; must reference its own rental's photos.
CREATE TRIGGER trg_damage_insert_gate BEFORE INSERT ON damage WHEN ${phaseLocked('NEW.rental_id', 'NEW.found_phase')}
BEGIN ${raise(LOCKED, 'damage for this inspection is locked')} END;
CREATE TRIGGER trg_damage_insert_consistency BEFORE INSERT ON damage WHEN ${damageInconsistent}
BEGIN ${raise(INVALID, 'damage must reference photos of the same rental, angle and phase')} END;
CREATE TRIGGER trg_damage_keys_immutable BEFORE UPDATE ON damage
WHEN NEW.id IS NOT OLD.id OR NEW.rental_id IS NOT OLD.rental_id OR NEW.found_phase IS NOT OLD.found_phase
BEGIN ${raise(INVALID, 'damage id, rental and phase never change')} END;
CREATE TRIGGER trg_damage_update_gate BEFORE UPDATE ON damage WHEN ${phaseLocked('OLD.rental_id', 'OLD.found_phase')}
BEGIN ${raise(LOCKED, 'damage for this inspection is locked')} END;
CREATE TRIGGER trg_damage_update_consistency BEFORE UPDATE ON damage WHEN ${damageInconsistent}
BEGIN ${raise(INVALID, 'damage must reference photos of the same rental, angle and phase')} END;
CREATE TRIGGER trg_damage_delete_gate BEFORE DELETE ON damage WHEN ${phaseLocked('OLD.rental_id', 'OLD.found_phase')}
BEGIN ${raise(LOCKED, 'damage for this inspection is locked')} END;
-- A known-damage identity lives exactly as long as it has at least one observation.
CREATE TRIGGER trg_damage_identity_cleanup AFTER DELETE ON damage
BEGIN
  DELETE FROM vehicle_damage WHERE id = OLD.vehicle_damage_id
    AND NOT EXISTS (SELECT 1 FROM damage WHERE vehicle_damage_id = OLD.vehicle_damage_id);
END;

-- signed_contract: immutable; signing is only possible without a valid contract.
CREATE TRIGGER trg_contract_insert_rules BEFORE INSERT ON signed_contract
WHEN NOT EXISTS (SELECT 1 FROM rental r WHERE r.id = NEW.rental_id AND r.status IN ('draft', 'active'))
  OR ${activeContract('NEW.rental_id')}
  OR NEW.sequence IS NOT (SELECT count(*) + 1 FROM signed_contract WHERE rental_id = NEW.rental_id)
  OR NEW.supersedes_id IS NOT (SELECT id FROM signed_contract WHERE rental_id = NEW.rental_id ORDER BY sequence DESC LIMIT 1)
  OR NEW.template_version IS NOT (SELECT version FROM contract_template WHERE id = NEW.template_id)
BEGIN ${raise(INVALID, 'rental must be draft or active, with no valid contract, and sequence must follow')} END;
CREATE TRIGGER trg_contract_no_update BEFORE UPDATE ON signed_contract
BEGIN ${raise(IMMUTABLE, 'signed contracts never change; void and re-sign instead')} END;
CREATE TRIGGER trg_contract_no_delete BEFORE DELETE ON signed_contract
BEGIN ${raise(IMMUTABLE, 'signed contracts are never deleted')} END;
-- Signing activates a draft and freezes every pick-up photo the contract can show.
CREATE TRIGGER trg_contract_after_insert AFTER INSERT ON signed_contract
BEGIN
  UPDATE rental SET status = 'active', activated_at = coalesce(activated_at, NEW.signed_at), updated_at = NEW.created_at
    WHERE id = NEW.rental_id AND status = 'draft';
  UPDATE photo SET frozen_at = NEW.signed_at WHERE rental_id = NEW.rental_id AND phase = 'before' AND frozen_at IS NULL;
END;

-- contract_void: append-only; only contracts of a rental that is out can be voided.
CREATE TRIGGER trg_void_insert_rules BEFORE INSERT ON contract_void
WHEN NOT EXISTS (SELECT 1 FROM signed_contract sc JOIN rental r ON r.id = sc.rental_id
                 WHERE sc.id = NEW.contract_id AND r.status = 'active')
BEGIN ${raise(LOCKED, 'only contracts of an active rental can be voided')} END;
CREATE TRIGGER trg_void_no_update BEFORE UPDATE ON contract_void
BEGIN ${raise(IMMUTABLE, 'void records never change')} END;
CREATE TRIGGER trg_void_no_delete BEFORE DELETE ON contract_void
BEGIN ${raise(IMMUTABLE, 'void records are never deleted')} END;
`;

const V1_SEED = `
INSERT INTO agency_settings (id, updated_at) VALUES (1, ${NOW_MS});
INSERT INTO angle (key, label, angle_group, sort_order, built_in) VALUES
  ('front',       'Front',       'exterior',  10, 1),
  ('front_left',  'Front left',  'exterior',  20, 1),
  ('left',        'Left side',   'exterior',  30, 1),
  ('rear_left',   'Rear left',   'exterior',  40, 1),
  ('rear',        'Rear',        'exterior',  50, 1),
  ('rear_right',  'Rear right',  'exterior',  60, 1),
  ('right',       'Right side',  'exterior',  70, 1),
  ('front_right', 'Front right', 'exterior',  80, 1),
  ('dashboard',   'Dashboard',   'dashboard', 100, 1),
  ('interior',    'Interior',    'extra',     200, 1),
  ('wheel',       'Wheel',       'extra',     210, 1),
  ('roof',        'Roof',        'extra',     220, 1),
  ('closeup',     'Close-up',    'extra',     230, 1),
  ('other',       'Other',       'extra',     240, 1);
`;

// ---------------------------------------------------------------------------------------------
// Migration 2: signature and vehicle rules found in review (docs/reviews/architecture-data.md H1, H2, M1)

/** The rental has a signed contract that is not voided (frozen with migration 2). */
const activeContractV2 = (rentalId: string) =>
  `EXISTS (SELECT 1 FROM signed_contract sc WHERE sc.rental_id = ${rentalId}` +
  ` AND NOT EXISTS (SELECT 1 FROM contract_void cv WHERE cv.contract_id = sc.id))`;

/** damageInconsistent (v1) plus: the close-up's phase equals the mark's found_phase. */
const damageInconsistentV2 = `(${damageInconsistent}
  OR (NEW.closeup_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM photo p WHERE p.id = NEW.closeup_photo_id
      AND p.phase = NEW.found_phase)))`;

const V2_TRIGGERS = `
-- A return can only be completed on a rental with a valid (not voided) signed contract.
DROP TRIGGER trg_rental_status_transition;
CREATE TRIGGER trg_rental_status_transition BEFORE UPDATE OF status ON rental
WHEN NEW.status IS NOT OLD.status AND (
     NOT ((OLD.status = 'draft' AND NEW.status = 'active')
       OR (OLD.status = 'active' AND NEW.status IN ('returned', 'cancelled')))
  OR (NEW.status IN ('active', 'returned') AND NOT ${activeContractV2('NEW.id')}))
BEGIN ${raise(INVALID, 'illegal rental status change')} END;

-- Once the return inspection has started, the pick-up contract can no longer be voided.
DROP TRIGGER trg_void_insert_rules;
CREATE TRIGGER trg_void_insert_rules BEFORE INSERT ON contract_void
WHEN NOT EXISTS (SELECT 1 FROM signed_contract sc JOIN rental r ON r.id = sc.rental_id
                 WHERE sc.id = NEW.contract_id AND r.status = 'active')
  OR EXISTS (SELECT 1 FROM signed_contract sc JOIN inspection i ON i.rental_id = sc.rental_id
             WHERE sc.id = NEW.contract_id AND i.phase = 'after')
BEGIN ${raise(LOCKED, 'only contracts of an active rental whose return has not started can be voided')} END;

-- The vehicle is fixed once anything was signed or frozen: a car swap is cancel + new rental.
DROP TRIGGER trg_rental_vehicle_change;
CREATE TRIGGER trg_rental_vehicle_change BEFORE UPDATE OF vehicle_id ON rental
WHEN NEW.vehicle_id IS NOT OLD.vehicle_id AND (
     EXISTS (SELECT 1 FROM damage WHERE rental_id = OLD.id)
  OR EXISTS (SELECT 1 FROM signed_contract WHERE rental_id = OLD.id)
  OR EXISTS (SELECT 1 FROM photo WHERE rental_id = OLD.id AND frozen_at IS NOT NULL))
BEGIN ${raise(INVALID, 'the vehicle of a signed rental cannot change; cancel it and start a new rental')} END;

-- A close-up must come from the same inspection (phase) as its mark.
DROP TRIGGER trg_damage_insert_consistency;
CREATE TRIGGER trg_damage_insert_consistency BEFORE INSERT ON damage WHEN ${damageInconsistentV2}
BEGIN ${raise(INVALID, 'damage must reference photos of the same rental, angle and phase')} END;
DROP TRIGGER trg_damage_update_consistency;
CREATE TRIGGER trg_damage_update_consistency BEFORE UPDATE ON damage WHEN ${damageInconsistentV2}
BEGIN ${raise(INVALID, 'damage must reference photos of the same rental, angle and phase')} END;

-- "Repaired / gone" chosen in a draft only counts while that draft keeps the vehicle.
CREATE TRIGGER trg_rental_vehicle_unresolve AFTER UPDATE OF vehicle_id ON rental
WHEN NEW.vehicle_id IS NOT OLD.vehicle_id
BEGIN
  UPDATE vehicle_damage SET resolved_at = NULL, resolution = NULL, resolution_note = NULL, resolved_rental_id = NULL,
    updated_at = NEW.updated_at
    WHERE resolved_rental_id = NEW.id AND vehicle_id IS OLD.vehicle_id;
END;
CREATE TRIGGER trg_rental_delete_unresolve BEFORE DELETE ON rental
BEGIN
  UPDATE vehicle_damage SET resolved_at = NULL, resolution = NULL, resolution_note = NULL, resolved_rental_id = NULL,
    updated_at = ${NOW_MS}
    WHERE resolved_rental_id = OLD.id;
END;

-- Repair rows left by the old behaviour. "not_found" is only set from a rental's pick-up; with no
-- rental left it came from a discarded draft. A resolution whose rental now has another vehicle
-- came from a draft that switched cars.
UPDATE vehicle_damage SET resolved_at = NULL, resolution = NULL, resolution_note = NULL, resolved_rental_id = NULL,
    updated_at = ${NOW_MS}
  WHERE (resolution = 'not_found' AND resolved_rental_id IS NULL)
     OR (resolved_rental_id IS NOT NULL AND vehicle_id IS NOT (SELECT vehicle_id FROM rental WHERE id = resolved_rental_id));
`;

// ---------------------------------------------------------------------------------------------
// v3: "check the marks" after a return retake (architecture review M2). A retake carries the
// marks over to a differently framed photo; the new photo is flagged until the employee confirms
// in Compare that every mark still sits on the damage. Frozen photos keep whatever they had.

const V3_MARKS_CHECK = `
ALTER TABLE photo ADD COLUMN marks_check_needed INTEGER NOT NULL DEFAULT 0 CHECK (marks_check_needed IN (0, 1));
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: V1_TABLES + V1_INDEXES + V1_VIEWS + V1_TRIGGERS + V1_SEED },
  { version: 2, name: 'signature and vehicle rules', sql: V2_TRIGGERS },
  { version: 3, name: 'marks check after a return retake', sql: V3_MARKS_CHECK },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// ---------------------------------------------------------------------------------------------
// Runner

export class SchemaTooNewError extends Error {
  readonly found: number;
  readonly supported: number;
  constructor(found: number, supported: number) {
    super(`Database schema v${found} is newer than this app supports (v${supported})`);
    this.name = 'SchemaTooNewError';
    this.found = found;
    this.supported = supported;
  }
}

export class MigrationError extends Error {
  readonly version: number;
  readonly original: unknown;
  constructor(version: number, original: unknown) {
    super(`Migration to v${version} failed: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'MigrationError';
    this.version = version;
    this.original = original;
  }
}

export interface MigrateOptions {
  /** Called once before upgrading a non-empty database (e.g. VACUUM INTO a pre-migration copy). */
  beforeUpgrade?: (fromVersion: number, toVersion: number) => Promise<void>;
}

export interface MigrateResult {
  from: number;
  to: number;
}

export async function getSchemaVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Bring the database to SCHEMA_VERSION. Call right after opening and applying
 * CONNECTION_PRAGMAS, before any other query runs on the connection. A failed step rolls back
 * completely and leaves user_version at the last good version.
 */
export async function migrate(db: SqlDatabase, options: MigrateOptions = {}): Promise<MigrateResult> {
  assertMigrationList();
  const from = await getSchemaVersion(db);
  if (from > SCHEMA_VERSION) throw new SchemaTooNewError(from, SCHEMA_VERSION);
  if (from === SCHEMA_VERSION) return { from, to: from };
  if (from > 0 && options.beforeUpgrade) await options.beforeUpgrade(from, SCHEMA_VERSION);

  for (const m of MIGRATIONS) {
    if (m.version > from) await applyMigration(db, m);
  }
  return { from, to: SCHEMA_VERSION };
}

async function applyMigration(db: SqlDatabase, m: Migration): Promise<void> {
  if (m.foreignKeysOff) await db.execAsync('PRAGMA foreign_keys = OFF');
  try {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      await db.execAsync(m.sql);
      if (m.foreignKeysOff) {
        const violations = await db.getAllAsync<unknown>('PRAGMA foreign_key_check');
        if (violations.length > 0) throw new Error(`${violations.length} foreign key violations`);
      }
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
      await db.execAsync('COMMIT');
    } catch (e) {
      await db.execAsync('ROLLBACK').catch(() => undefined);
      throw new MigrationError(m.version, e);
    }
  } finally {
    if (m.foreignKeysOff) await db.execAsync('PRAGMA foreign_keys = ON');
  }
}

function assertMigrationList(): void {
  MIGRATIONS.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`MIGRATIONS[${i}] has version ${m.version}; expected ${i + 1}`);
  });
}

export interface IntegrityReport {
  ok: boolean;
  problems: string[];
}

/** Full structural check: used on restore staging, after migrations and by Storage > Check data. */
export async function checkIntegrity(db: SqlDatabase): Promise<IntegrityReport> {
  const problems: string[] = [];
  const integrity = await db.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  for (const row of integrity) if (row.integrity_check !== 'ok') problems.push(row.integrity_check);
  const fk = await db.getAllAsync<{ table: string; rowid: number; parent: string }>('PRAGMA foreign_key_check');
  for (const v of fk) problems.push(`foreign key: ${v.table} row ${v.rowid} -> ${v.parent}`);
  return { ok: problems.length === 0, problems };
}
