# CarCheck — Data Model, Storage, Backup & Restore

Owner: data/storage. Product truth: `docs/BRIEF.md`; flows and states: `docs/UX_FLOWS.md`. Executable schema: `src/data/migrations.ts` (migration 1 = tables, indexes, view, triggers, seeds). Domain types: `src/domain/types.ts`. Marker geometry: `src/media/geometry.ts` (owned by the media agent; used as-is here).

## 0. Decisions at a glance

| Topic | Decision | Why |
|---|---|---|
| DB | expo-sqlite (bundles SQLite 3.50), WAL, `foreign_keys=ON`, `synchronous=FULL` | FULL: signed evidence must survive power loss; write rate is tiny |
| Schema source | TS migrations array (`migrations.ts`), not `schema.sql` | Metro bundles it with no asset loading; testable in Node; trigger predicates are built from helpers instead of copy-pasting them 20 times |
| Versioning | `PRAGMA user_version`, forward-only, one transaction per step | Simple, atomic, no metadata table |
| Ids / time | UUID v4 text ids; epoch ms UTC; `tz_offset_min` on photos & contracts | Ids unique across tables (the media viewer resolves any id); reports can print the local time the employee saw |
| Integrity | Triggers enforce every evidence lock (§3); repos cannot bypass them | Bugs fail loudly instead of silently rewriting evidence |
| Snapshots | Rental stores its own customer + vehicle copy; frozen while a valid contract exists | Profile edits never change history; inline customers need no profile |
| Files | App-private files; DB holds **relative** paths + size + sha256 | iOS container paths change on reinstall/restore; hashes power backup verification |
| Data root | Everything live sits in one directory named by a pointer file | Restore = write a new root, then switch the pointer; the old root is the rollback |
| Backup | `.carcheck` = ZIP (no compression) with `manifest.json` + `carcheck.db` snapshot + files tree, built natively by `react-native-zip-archive` | Streams hundreds of MB natively; JPEG/PDF don't compress; zip-slip protected |

## 1. Entities & schema

```
agency_settings (singleton)        angle (catalog)          contract_template (append-only versions)
vehicle ─┬─< rental >─┬─ customer ─< customer_document >── (or owned by rental, inline customers)
         │            ├─< inspection (before|after) ─< photo    inspection ─< inspection_angle
         │            ├─< damage >── vehicle_damage (known-damage identity, per vehicle)
         │            ├─< signed_contract ─── contract_void (0..1)
         │            └─< generated_artifact
app_pref (UI prefs k/v)   backup_log   v_file_ref (view of every stored file)
```

- **agency_settings**: name (empty ⇒ onboarding), contact fields, logo file, report footer, `distance_unit`, `rental_ref_prefix` + `rental_ref_last_seq`.
- **angle**: stable key (`front_left`), label, group (`exterior` ×8, `dashboard`, `extra`: interior, wheel, roof, closeup, other), sort order, built-in flag. Keys can never change; built-ins can never be deleted.
- **Pair key = (angle_key, slot)**. Slot is 1 for the 8 exterior angles and the dashboard. Repeated extras are numbered 1..n ("Close-up 2"). A BEFORE photo pairs with the AFTER photo of the same pair key. Return capture reuses the BEFORE slot numbers; AFTER-only extras get a new slot and stay unpaired.
- **vehicle**: plate (required; `plate_key` is a generated normalised form for search/duplicate warnings), make/model/year/colour/VIN, last known mileage, optional photo, notes, `archived_at`.
- **customer**: full name (required), phone, address, licence no., ID/passport no., notes, `archived_at`. **customer_document**: kind `licence|id_passport|other`, image file. It is owned by exactly one of `customer_id` / `rental_id` (the rental owns it when "Save as profile" is off).
- **rental**: status `draft|active|returned|cancelled`, `reference`, links (`vehicle_id`, `customer_id` nullable), snapshot columns (`cust_*`, `veh_*`), `distance_unit`, start data (`started_at`, `start_mileage`, `start_fuel_eighths`, `special_terms`), operational `expected_return_at`, return data, `return_revision`, `return_reopened_at`, cancel data, `resume_step`. A draft exists from the "New rental" tap, before any vehicle is chosen.
  - Derived, not stored: *Needs signature* = active and every contract voided. *Return in progress* = active with an AFTER inspection, or returned and reopened. *Out* = active; the unique index `ux_rental_vehicle_out` allows one active rental per vehicle. *Overdue* = `expected_return_at` in the past.
- **inspection**: one per (rental, phase), `started_at`. **inspection_angle**: per pair key inside an inspection. It holds the skip (+ reason `blocked|too_dark|other`), `reviewed_at` (Compare "viewed ✓") and, on the AFTER inspection, the overlay `alignment_json` for that pair.
- **photo**: rental, inspection, phase (a composite FK guarantees it matches the inspection), kind `angle` (the one canonical shot per pair key) or `damage_closeup` (unlimited), pair key, label, `capture_order`, `captured_at`, `tz_offset_min`, file (path, upright `width`/`height`, `byte_size`, `sha256`), `frozen_at`.
- **damage**: one *observation* in one rental: `found_phase`, status `pre_existing|new|uncertain`, `number`, pair key, `type` (null = "type not set"), severity, location label, note, `before_photo_id`, `after_photo_id`, `closeup_photo_id`, `marker_json`.
  - `marker_json` is geometry.ts `DamageMarker {v:1, ring, counterpart?}`. `ring` sits on the photo of `found_phase` (BEFORE for pick-up marks, AFTER for return marks). `counterpart` is an optional employee override of the ring on the paired photo; if absent, `deriveCounterpart()` + the pair's alignment compute it.
  - Pick-up marks are always `pre_existing`, with a BEFORE photo and no AFTER photo. Return marks always have an AFTER photo; `before_photo_id` is the paired BEFORE shot if one exists. "Was there" = a return mark with status `pre_existing`.
  - A trigger checks that every photo reference belongs to the same rental, pair key and phase, and that the vehicle matches.
  - **Numbering**: `number` is unique per `(rental_id, status = 'pre_existing')` (`ux_damage_number`) — pre-existing damage has its own 1…n sequence (shown as letters A, B, C…); new and uncertain share one sequence (shown as numbers 1, 2, 3…) so flipping between them never renumbers, per DECISIONS.md. The repo assigns `max+1` within the row's group and compacts only rows that are still editable.
- **vehicle_damage** = the identity of one physical damage across rentals. It powers **Known damage** and the pick-up carry-over.
  - Every damage row points to one. A new mark creates one; "Still there" inserts a new observation (new BEFORE photo, nudged ring, copied type/note) under the same identity. "Repaired / gone" or vehicle-detail "Mark repaired" sets `resolved_at` + `resolution` (+ `resolved_rental_id`).
  - Open known damage = unresolved identities of the vehicle, shown with their latest observation. An identity is deleted automatically when its last observation is deleted.
- **contract_template**: `(template_key, version)` rows; body is markdown-ish with `{{vars}}`. Saving the editor inserts version n+1 and the highest version is active. Rows are never updated. Bootstrap inserts the starter text (a constant owned by the contract module) when the table is empty.
- **signed_contract**: see §3. **contract_void**: `contract_id`, `voided_at`, optional reason.
- **generated_artifact**: kind `evidence_image` (per pair key) | `contact_sheet` | `report_pdf` | `contract_pdf` (per contract). Stores the file plus the opaque `source_fingerprint` (e.g. `evidenceFingerprint()`); one row per target (unique index). Regeneration writes a new file with a new id, swaps the row, then deletes the old file.
- **app_pref**: JSON UI prefs (compare mode, ghost opacity, save-as-profile default, backup-reminder snooze). **backup_log**: backups made and restores done ("Last backup" = latest backup `at`, or the latest restore's `backup_created_at` if newer).
- **v_file_ref(id, owner, path, byte_size, sha256)** lists every stored file. The backup manifest, orphan sweep and media viewer read it. **Any new file column must be added to this view.**

**Rental reference.** It is allocated lazily when the employee first opens the contract review (`prepareContract`), in the same transaction: `UPDATE agency_settings SET rental_ref_last_seq = rental_ref_last_seq + 1 … RETURNING`. The format is `formatRentalReference(prefix, seq)` → `R-0142`. It is assigned once and never changes (trigger). Early discarded drafts don't burn numbers, so gaps are rare and harmless. Multi-phone agencies must give each phone a different prefix (open question 5).

## 2. Snapshot strategy

- Selecting a vehicle copies plate/make/model/year/colour/VIN into `veh_*`. Picking a customer profile copies its fields into `cust_*`; typing inline writes `cust_*` directly with `customer_id = NULL`. "Save as profile" creates the customer from the snapshot and links it.
- While the rental is a draft, the repo refreshes the snapshot when the linked profile is edited. From the first signature, `trg_rental_contract_fields_locked` rejects any change to snapshot + start columns while a non-voided contract exists.
- `expected_return_at` is operational (phone extensions) and stays editable; the agreed date is frozen inside the contract's `variables_json`.
- `customer_id` may be linked later (NULL → profile), even on cancelled rentals, but never re-pointed there.
- Reports, evidence and history read the **rental snapshot**, never the live profile.

## 3. Immutability & integrity (enforced by triggers)

| Data | Editable while | Locked by | Unlocked by |
|---|---|---|---|
| Rental snapshot + start data | draft, or active with all contracts voided | a valid signed contract | Void (then re-sign) |
| Pick-up damage | same as above | signing | Void |
| Pick-up photos | draft (insert/retake/delete) | signing sets `frozen_at` | **never**; after a void, new photos may be *added* only |
| Return fields + return damage | active, or returned & reopened | Complete return | Edit return (`return_reopened_at`) |
| Return photos | active / reopened | completing sets `frozen_at` | **never** (reopen allows adding) |
| Signed contract, void record, template version | never | insert | — |
| Cancelled rental | never (except linking a profile) | cancel (freezes all photos) | — |

- Status transitions allowed: `draft→active` (only via a signed contract; the AFTER INSERT trigger performs it), `active→returned`, `active→cancelled`. A completed return is reopened with `return_reopened_at`, not by status, so the vehicle is never "out" twice.
- **Signing** (one transaction): the signature file is already on disk (§5). Then insert `signed_contract`, and the trigger activates the draft and freezes all BEFORE photos. The trigger requires: rental draft/active, no valid contract, `sequence` = count+1, `supersedes_id` = previous contract, and `template_version` matching the template.
- **Contract content.** `rendered_html` is the exact HTML the customer reviewed, pre-signature. Its only external references are `carcheck-photo:<photoId>` and `carcheck-signature:customer`, resolved at view/print time. Markers are inlined (SVG) from the snapshot, so later damage edits can't alter it. `variables_json` holds the values used. `content_sha256 = sha256(contractHashPreimage(...))` (types.ts) covers ids, sequence, template, signer, time, signature hash, variables and HTML. "Verify contract" recomputes it and re-hashes the signature file.
- **Void & re-sign** (UX §10): insert `contract_void` (only while the rental is active). Snapshot, pick-up damage and new pick-up photos then unlock. Re-signing inserts `sequence n+1` with `supersedes_id`. Voided contracts stay viewable and are listed in the report. Frozen photos referenced by any contract, voided or not, can never be deleted.
- Files can't be protected by SQLite. The file module therefore has **no API to overwrite or delete** paths it did not just create, other than the draft-discard and orphan-sweep routines (§4).

## 4. Deletion policy & cleanup

- **Vehicle / customer**: hard delete only when no rental references it (FK `RESTRICT` is the backstop); otherwise archive (`archived_at`, hidden from pickers, history intact; unarchive allowed). Archiving a vehicle that is Out is refused by the repo.
- **Customer documents**: deletable at any time (UX "Delete ID photos"); they are privacy data, not rental evidence. Rentals keep the typed numbers in their snapshot.
- **Rental**: only drafts can be deleted ("Discard draft"). It cascades to inspections, photos, damage, owned documents and artifacts; the trigger blocks every other status. Signed rentals are **never deletable in MVP** (cancel instead). A future retention purge would ship as a migration that replaces the guard triggers.
- **Delete order**: DB transaction first, files after commit (a crash in between leaves an orphan, never a dangling row). Draft discard then removes `photos/<rentalId>/`, `docs/r-<rentalId>/` and `generated/<rentalId>/`.
- **Retake** (unfrozen photo only): insert the new photo, re-point any damage rows to it (the normalized ring is kept, and the UI asks the employee to check it), delete the old row, delete the old file after commit. See open question 1.
- **Orphan sweep** runs deferred after startup and from Storage → Clean up. Files under the files root that are not in `v_file_ref` and older than 1 h (so in-flight captures are safe) are deleted. Referenced-but-missing files are only *reported*; rows are never auto-deleted.

## 5. File storage layout

```
<Paths.document>/carcheck/
  current.json            {"v":1,"root":"data-<id>","previous":"data-<id>"|null,"previousUntil":ms|null,"verifyPending":bool}
  current.next.json       only while switching roots (§7.4)
  data-<id>/              LIVE ROOT
    db/carcheck.db (+-wal,-shm), db/pre-migrate-v<N>.db
    files/                FILES ROOT — every DB path is relative to this
      photos/<rentalId>/<photoId>.jpg           signatures/<rentalId>/<contractId>.png
      docs/<customerId>/<docId>.jpg             docs/r-<rentalId>/<docId>.jpg  (inline customer)
      generated/<rentalId>/<artifactId>.jpg|pdf vehicles/<vehicleId>/<fileId>.jpg   agency/logo-<fileId>.png|jpg
  data-<other>/           previous root (safety copy after a restore) or restore staging
<Paths.cache>/
  thumbs/<photoId>.jpg    derived; regenerated if missing; never backed up
  capture/  exports/<ts>/  backup/<ts>/  restore/<ts>/     temp; wiped at cold start
```

- Paths are ids-only, unique, and never reused. A DB `CHECK` rejects absolute paths, URIs, `..`, `\` and top-level files. Friendly names such as `R-0142_front-left.jpg` exist only on export copies.
- **Write protocol**: write `<name>.tmp` in the target dir → hash (sha256, size) → move to the final name (no overwrite) → insert the row. If the insert fails, delete the file.
- **Temp exports**: "Save to folder" deletes its copy as soon as the SAF copy completes. Share copies are *not* deleted when the share promise resolves, because Android receivers read asynchronously. They are removed on the next cold start or on foreground once older than 1 h.
- **Privacy**: set `android.allowBackup: false` (Android Auto Backup would upload the DB and ID photos to Google Drive). iOS later: exclude `carcheck/` from iCloud backup. Media never goes to the media store; raw photo export is an explicit action.

## 6. Migrations & connection setup

**Boot order:**
1. Resolve and recover `current.json` (§7.4) and delete abandoned `data-*` dirs.
2. `openDatabaseAsync(DB_FILE_NAME, {}, <root>/db)`.
3. Run `CONNECTION_PRAGMAS`.
4. Run `migrate(db, { beforeUpgrade })`. `beforeUpgrade` does `VACUUM INTO db/pre-migrate-v<from>.db` and keeps only the latest copy.
5. Ensure the starter template exists.
6. Render the app.
7. Deferred: temp wipe, safety-copy expiry, orphan sweep.

- `SchemaTooNewError` (app downgraded) → blocking screen; data untouched. `MigrationError` → rolled back to the last good version; blocking screen with retry; the pre-migrate copy is kept.
- A shipped migration is never edited. Table rebuilds set `foreignKeysOff: true`; the runner turns FKs off outside the transaction and runs `foreign_key_check` before COMMIT. The same `migrate()` upgrades old backups during restore.

## 7. Backup & restore

### 7.1 Format (`format_version` 1)
File `CarCheck-YYYY-MM-DD-HHmm.carcheck`: a standard ZIP, `NO_COMPRESSION`. Entries at the archive root: `manifest.json`, `carcheck.db` (snapshot), then the files-root tree (`photos/…`, `docs/…`, `signatures/…`, `generated/…`, `vehicles/…`, `agency/…`). Thumbnails and temp files are excluded. Manifest (`BackupManifest` in types.ts):
```json
{ "format": "carcheck-backup", "formatVersion": 1, "appVersion": "1.0.0", "schemaVersion": 1,
  "createdAt": "2026-09-24T14:02:11.402Z", "platform": "android", "agencyName": "Coastline Rentals",
  "counts": { "vehicles": 38, "customers": 120, "rentals": 142, "photos": 1120, "signedContracts": 150, "files": 1402 },
  "totalBytes": 1288490188, "db": { "path": "carcheck.db", "size": 5242880, "sha256": "…" },
  "files": [ { "path": "photos/<rid>/<pid>.jpg", "size": 2811904, "sha256": "…" } ],
  "missingFiles": [], "damagedFiles": [] }
```
Readers accept any `formatVersion ≤` their own and any `schemaVersion ≤ SCHEMA_VERSION` (migrated forward). They refuse anything newer.

### 7.2 Create backup (UX §9: Saving records → Copying photos → Checking backup)
1. Enter maintenance mode: writes paused, modal progress with Cancel.
2. Space check: free ≥ 1.1 × (Σ file sizes + DB size).
3. `VACUUM INTO '<cache>/backup/<ts>/carcheck.db'`. This is a consistent, compacted snapshot even in WAL mode. The argument must be a plain filesystem path, not a `file://` URI.
4. Open the **snapshot**, read `v_file_ref` and counts from it, then close it, so the file list matches the DB exactly.
5. For each file: exists and `size == byte_size` → `files[]` with the DB hash. Absent → `missingFiles`. Size differs → re-hash it and add to `damagedFiles`. Live media is not re-hashed otherwise, which would read everything twice; Storage → "Check files" does deep verification on demand.
6. Hash the snapshot and write `manifest.json`.
7. `zip([manifest, snapshot, filesRoot], '<name>.partial', { compressionLevel: NO_COMPRESSION, signal })`, reporting progress via `subscribe`. Orphans inside the files root ride along and are dropped on restore.
8. Check: `getUncompressedSize` ≥ expected, then extract just `manifest.json` and compare it. Rename to `.carcheck`, log it in `backup_log`, and offer **Save to folder…** (SAF) / **Share…**.
9. Cancel or any error: delete the partial file; the live data was never touched.

### 7.3 Restore (validate everything before touching live data)
1. Pick the file and copy it to `cache/restore/<ts>/in.carcheck`; the native unzip needs a local path.
2. Extract only `manifest.json` (unzip `entries`). If the zip is unreadable, the manifest is missing, or `format` is wrong → **NOT_A_BACKUP**. If the version is newer → **NEWER_VERSION**.
3. Space: `getUncompressedSize` × 1.05 must fit in free space, else **NO_SPACE** ("needs X, Y free"). If a previous safety copy exists, offer to delete it.
4. Unzip into a new staging root `data-<new>/files/` (same volume). Move `carcheck.db` to `db/` and `manifest.json` to the staging root. Truncation, CRC errors or `ERR_UNSAFE_PATH` → **DAMAGED**.
5. Verify every manifest file (exists, size, sha256; "Checking photos n/N") and the DB hash. A mismatch → **DAMAGED**. Entries in `missingFiles`/`damagedFiles` are warnings, not errors.
6. Open the staged DB and run `CONNECTION_PRAGMAS`. Check that `user_version == manifest.schemaVersion`, run `checkIntegrity`, `migrate`, then `checkIntegrity` again. Also check that every `v_file_ref` path is staged or listed as missing, and that counts match. Delete staged orphans and close. Failure → **DAMAGED** / **UPGRADE_FAILED**.
7. Show the metadata card, then the destructive confirm. "Back up current data first" runs §7.2 on the live root.
8. Commit: close the live DB → switch the pointer (§7.4) to `{root: new, previous: old, previousUntil: now+14 d, verifyPending: true}` → open the new root and run a quick check. On success, clear `verifyPending`, log the restore, and wipe thumbs/exports/restore temp. On failure, switch the pointer back, reopen the old DB and report **SWITCH_FAILED** ("Nothing was changed").
9. Cancelling before step 8 deletes staging and temp. A crash before step 8 leaves staging unreferenced, and boot deletes it.

**Automatic safety copy.** The previous root is kept untouched as `previous` for 14 days, or until the next restore or Storage → Delete. It costs no copy time or extra space at restore time. Storage shows it ("Data before restore on 24 Sep · 1.1 GB · Export as backup · Delete"); export reuses §7.2 pointed at that root.

### 7.4 Pointer switch (crash-safe)
expo-file-system's `move(..., {overwrite})` deletes the target and then renames it, so it is **not atomic**. Instead:
1. Write `current.next.json` completely.
2. Delete `current.json`.
3. Rename `current.next.json` → `current.json` (same directory, so it is a rename).

**At boot:**
- Only `next` exists → rename it.
- Both exist and `next` parses → it wins.
- `next` is unparsable → delete it.
- `verifyPending` → verify the root; on failure switch back to `previous`.
- Then delete `data-*` dirs named by neither `root` nor `previous`.

Every step is a single atomic filesystem operation, so the pointer always names a complete root.

**User-facing errors** (all but the last say "Nothing on this phone was changed"): NOT_A_BACKUP, NEWER_VERSION, DAMAGED (with count), NO_SPACE (with numbers), UPGRADE_FAILED, SWITCH_FAILED. INTERRUPTED is shown at boot after automatic finish or rollback, and states the outcome.

## 8. Repository API sketch (signatures only; one module per area, async, plain objects from types.ts)

```ts
// db.ts
openDataStore(): Promise<void>; recoverAtBoot(): Promise<BootReport>; runHousekeeping(): Promise<void>
// settings.ts
getAgencySettings(): Promise<AgencySettings>; updateAgencySettings(p: Partial<AgencySettingsInput>): Promise<AgencySettings>
setAgencyLogo(tempUri: string | null): Promise<void>; getPref<T>(k: PrefKey): Promise<T | null>; setPref(k: PrefKey, v: unknown): Promise<void>
// vehicles.ts / customers.ts
listVehicles(q?: { search?: string; includeArchived?: boolean }): Promise<VehicleListItem[]>  // with Out/Available
getVehicleDetail(id): Promise<VehicleDetail>  // history, known damage, documents
createVehicle(i: VehicleInput): Promise<Vehicle>; updateVehicle(id, p): Promise<Vehicle>
removeVehicle(id): Promise<'deleted' | 'archived'>; unarchiveVehicle(id): Promise<void>
listCustomers(q?); getCustomerDetail(id); createCustomer(i); updateCustomer(id, p); removeCustomer(id); unarchiveCustomer(id)
addCustomerDocument(owner: { customerId } | { rentalId }, img: CapturedImage, kind, label?): Promise<CustomerDocument>
deleteCustomerDocuments(ids: Id[]): Promise<void>
// rentals.ts
getHome(): Promise<{ unfinished; dueBack; out; returned }>; searchRentals(q: string): Promise<RentalListItem[]>
createDraftRental(): Promise<Rental>; setRentalVehicle(id, vehicleId): Promise<Rental>
setRentalCustomer(id, c: { customerId?: Id; snapshot: CustomerSnapshot; saveAsProfile: boolean }): Promise<Rental>
updateRentalDetails(id, p: { startMileage?; startFuelEighths?; expectedReturnAt?; specialTerms? }): Promise<Rental>
setResumeStep(id, step: ResumeStep | null): Promise<void>; getRentalDetail(id): Promise<RentalDetail>
discardDraft(id): Promise<void>; cancelRental(id, reason?: string): Promise<void>
// inspections.ts
startInspection(rentalId, phase): Promise<Inspection>                       // idempotent
addPhoto(inspectionId, img: CapturedImage, key: PairKey, opts?: { kind?: PhotoKind; label?: string }): Promise<Photo>
retakePhoto(photoId, img: CapturedImage): Promise<Photo>; deletePhoto(photoId): Promise<void>
setAngleSkipped(inspectionId, key: PairKey, reason: SkipReason | null | false): Promise<void>
markPairReviewed(rentalId, key: PairKey): Promise<void>; setPairAlignment(rentalId, key: PairKey, a: Alignment | null): Promise<void>
// damage.ts
addDamage(i: NewDamageInput): Promise<Damage>; updateDamage(id, p: DamagePatch): Promise<Damage>; deleteDamage(id): Promise<void>
listKnownDamage(vehicleId): Promise<KnownDamageItem[]>
confirmKnownDamage(rentalId, vehicleDamageId, beforePhotoId, marker: DamageMarker): Promise<Damage>
resolveKnownDamage(vehicleDamageId, r: KnownDamageResolution | null, rentalId?: Id): Promise<void>
// contracts.ts
getActiveTemplate(): Promise<ContractTemplate>; saveTemplateVersion(title, body): Promise<ContractTemplate>
prepareContract(rentalId): Promise<{ rental: Rental; template: ContractTemplate }>  // allocates reference, sets started_at
signContract(i: { rentalId; templateId; renderedHtml; variables; signerName; signaturePngTempUri }): Promise<SignedContract>
voidContract(contractId, reason?: string): Promise<void>; listContracts(rentalId): Promise<SignedContractWithState[]>
verifyContract(contractId): Promise<{ ok: boolean; problem?: string }>
// returns.ts
completeReturn(rentalId, p: { returnedAt; returnMileage?; returnFuelEighths?; returnNotes? }): Promise<Rental>
reopenReturn(rentalId): Promise<void>
// artifacts.ts
getArtifact(rentalId, target: ArtifactTarget): Promise<GeneratedArtifact | null>
saveArtifact(rentalId, target: ArtifactTarget, tempUri, meta: ArtifactMeta): Promise<GeneratedArtifact>
// storage.ts / backup.ts
getStorageUsage(): Promise<StorageUsage>; sweepOrphans(): Promise<{ deleted: number; missing: RelPath[] }>; checkFiles(onProgress): Promise<FileCheckReport>
createBackup(o: { signal; onProgress }): Promise<{ uri: string; fileName: string; byteSize: number }>
saveBackupToFolder(uri): Promise<void>; shareBackup(uri): Promise<void>
prepareRestore(pickedUri, o: { signal; onProgress }): Promise<RestorePreview>  // steps 1–6
commitRestore(p: RestorePreview): Promise<void>; discardRestore(p: RestorePreview): Promise<void>
getSafetyCopy(): Promise<SafetyCopyInfo | null>; deleteSafetyCopy(): Promise<void>
```
`CapturedImage = { tempUri; width; height; byteSize; sha256; capturedAt; tzOffsetMin }` comes from the pipeline. Repos map trigger messages (`DB_ERROR.*` prefixes) to typed errors (`LockedError` → "Void & re-sign to change it").

## 9. Hard constraints on other agents

- **Image pipeline.** Store originals upright (orientation baked in; `width`/`height` upright). Deliver `CapturedImage` with sha256 + size computed on the final bytes. Keep photos bounded (≈4000 px long edge, JPEG q≈0.9) so backups stay sane. Markers are `DamageMarker` JSON only. Alignment is read and written via `inspection_angle` (AFTER inspection, per pair key). Thumbnails go in `cache/thumbs/<photoId>.jpg`. Never write into the files root except through the write protocol. Artifacts are stored with `source_fingerprint`. For completed rentals, reuse an existing artifact unless it is missing, the return is re-completed, or the user taps Regenerate (open question 10).
- **Contract/report.** Use the `rendered_html` reference rules and `contractHashPreimage`. Use only frozen photos in contracts. The starter template is seeded by bootstrap, not SQL. Show the voided contract list in reports.
- **UI.** Map status `pre_existing` → "Existing" (media's `existing`). Allocate the reference on employee review. "Edit return" = `reopenReturn` (status stays returned). All writes go through repos; handle `LockedError` with the UX copy. Run backup and restore in a modal maintenance mode.
- **Scaffold.** `app.json`: set `android.allowBackup: false`. Keep `react-native-zip-archive` (it is the backup engine).

## 10. Open questions (orchestrator)

1. **Retake with markers.** UX keeps the old file when it has markers. I re-point the marks to the new photo and delete the old one (unfrozen only) to keep one BEFORE per pair. Confirm.
2. **Damaged media on restore.** Currently fatal (all-or-nothing). Should it offer "Restore anyway: N photos damaged"? The data layer supports both.
3. **Share temp files.** Delete them later, not immediately (Android). OK to deviate from the UX copy?
4. **Void reason.** Optional in the schema; UX has no field. I recommend one optional line.
5. **Reference prefix per phone.** Two phones would both issue R-0001. Expose the prefix in Settings → Agency?
6. **Backups over 4 GB / 65k entries.** Verify ZIP64 in `react-native-zip-archive` on Android and iOS; otherwise warn or cap.
7. **Backup encryption.** Archives hold ID photos in clear. Is a password option in scope later?
8. **New damage when the BEFORE angle was skipped.** Currently allowed as `new` (the evidence shows "not photographed"). Should it be forced to `uncertain`?
9. **Custom angles.** Supported by the schema but have no UI. Leave them out of MVP?
10. **Evidence regeneration after an app update**, for completed rentals: reuse (recommended) vs fingerprint-driven.
