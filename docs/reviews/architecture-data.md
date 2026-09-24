# Review: architecture and data integrity

Scope: signed contracts, originals and annotations, generated evidence, BEFORE/AFTER pairing, damage linkage and numbering, deletion and orphan cleanup, migrations, data-root pointer, backup/restore, paths, iOS readiness, duplication, layering, and transaction boundaries. Reviewed at `ba8b2a5`.

Method: I read the docs and all of `src/data`, `src/features`, `src/documents`, and the relevant `app/` routes. I checked the zip layout against the native code of `react-native-zip-archive` 9.5.1. I ran `npx jest` (40 suites, 369 tests, all pass). I also ran 11 probe tests against the real migrations and repositories (the better-sqlite3 test harness), from the session scratchpad; no repo files were touched. Findings cite them as "Probe Pn".

**Counts:** Critical 0 · High 2 · Medium 5 · Low 8

---

## High

### H1. A rental can be returned and closed for good while its only contract is voided
- **Where:**
  - `src/domain/rentalLifecycle.ts:180-190`: `returnBlockers('start' | 'complete')` never checks `hasValidContract`.
  - `src/data/migrations.ts:471-476`: `trg_rental_status_transition` requires a valid contract only for `→ active`.
  - `src/data/migrations.ts:557-560` and `app/rental/[id]/index.tsx:134`: void is allowed for any active rental, including one whose return is already in progress.
- **Failure (Probes P1, P1b, P4):**
  - Return in progress → "Fix contract (void & re-sign)". Pick-up damage and the rental snapshot unlock while the car is already back.
  - `startReturn` is accepted with only a voided contract. `completeReturn` then succeeds: status `returned`, contracts `['1:void']`.
  - From then on re-signing is refused ("This rental is closed…") and voiding is refused (not active). The rental is closed forever with no valid signature, and the report has no valid contract to embed.
  - Today only navigation stops this: the rental detail page redirects needs-signature rentals to the start flow, and the return entry bounces to the report. The data layer does not enforce it, although DATA_MODEL §0 says the triggers enforce every evidence lock. A stale return screen or any future entry point would close the rental unsigned.
- **Fix:**
  1. In migration 2, recreate `trg_rental_status_transition` with an extra condition: `OR (NEW.status = 'returned' AND NOT <activeContract(NEW.id)>)`.
  2. Make `returnBlockers` return a `needs_signature` blocker for `start` and `complete` when `!hasValidContract`.
  3. Refuse a void once an AFTER inspection exists (`trg_void_insert_rules` + `canVoidContract`), or at least block completion until the rental is re-signed.

### H2. Changing the vehicle keeps the old car's pick-up photos, which are frozen and cannot be replaced after a void
- **Where:**
  - `src/data/repos/rentals.ts:258-281`: `setRentalVehicle` refuses only when damage rows exist (line 271).
  - `src/data/migrations.ts:491-493`: `trg_rental_vehicle_change` makes the same check.
  - `src/features/inspection/StartFlowScreen.tsx:102-115`: the Steps sheet lets the re-sign flow jump back to "Vehicle".
- **Failure (Probes P5, P6):** a mid-rental car swap, a common real-world case.
  - Fix contract → Steps → Vehicle → pick car B. The change is accepted, and the rental now shows car B with 8 frozen BEFORE photos of car A.
  - Those photos can never be retaken or deleted: they are frozen, and `ux_photo_pair` holds each pair key.
  - The re-signed contract, the return ghost overlay, compare and the evidence images then pair car A's pick-up photos with car B's return photos. That produces invented "new damage" evidence.
  - Drafts behave the same way: photos are kept silently, with no prompt. It is less severe there because retake is still possible.
- **Fix:**
  - Reject a `vehicle_id` change when the rental has any frozen photo or any `signed_contract` row (trigger + repo). A physical swap should be cancel + new rental.
  - In drafts that already have BEFORE photos, ask "Same car, keep photos / Different car, delete photos", and do the delete in the same transaction.

---

## Medium

### M1. "Repaired / gone" chosen in a draft survives the draft and silently erases known damage
- **Where:**
  - `src/data/repos/damage.ts:380-397`
  - `src/data/migrations.ts:317`: `resolved_rental_id … ON DELETE SET NULL`
  - `src/data/repos/rentals.ts:399-416` (`discardDraft`) and `258-281` (`setRentalVehicle`)
  - `app/rental/[id]/start/condition.tsx:345-352`
- **Failure (Probes P2, P9):**
  - The vehicle has one known dent. A new draft marks it "Repaired / gone" in the carry-over, then the draft is discarded.
  - The `vehicle_damage` row keeps `resolved_at` and `resolution='not_found'`; only `resolved_rental_id` becomes NULL. `listKnownDamage` then returns 0.
  - The next pick-up never shows the dent, so a later return can record it as "new". Switching the draft to another vehicle has the same effect.
- **Fix:**
  - In `discardDraft` and `setRentalVehicle`, in the same transaction, clear the resolution: `UPDATE vehicle_damage SET resolved_at=NULL, resolution=NULL, resolution_note=NULL, resolved_rental_id=NULL WHERE resolved_rental_id = ?`. Back this up with a `BEFORE DELETE ON rental` trigger.
  - Cleaner alternative: record draft resolutions as pending and apply them only when the contract is signed.

### M2. Retaking a return photo silently moves new-damage rings onto a differently framed shot
- **Where:**
  - `src/data/repos/inspections.ts:175-207`: retake re-points every damage row.
  - `src/features/inspection/captureService.ts:122-128`
  - `app/rental/[id]/return/capture.tsx:128-149`: no `hadMarks` check. It is reached from `compare.tsx:318-321` "Retake return photo".
  - By contrast, start capture (`start/capture.tsx:188-205`) and annotate (`annotate/[photoId].tsx:128-133`) do prompt.
- **Failure (Probe P10):**
  - A new-damage ring sits at (0.7, 0.2) on the AFTER front photo. The employee retakes that photo from compare.
  - The ring is copied unchanged onto the new photo, with no prompt. The evidence image can then circle bare paint.
  - DECISIONS Data §1 requires the employee to be asked to check the marks.
- **Fix:**
  - In return capture, compute `hadMarks` and show the same "Check the marks" prompt with a jump to compare.
  - Better: persist a needs-check flag (e.g. `damage.marker_checked_at`, cleared on retake) and block "Complete return" until every flagged mark has been checked.

### M3. The final report leaves out the pick-up condition (the BEFORE side of every pair)
- **Where:**
  - `src/features/report/buildReport.ts:207`: only `docPhotoThumbs(pairs, 'after')` is built.
  - `src/documents/report.ts:198-222`
- **Failure:**
  - The report shows only "Condition at return". The pick-up state of undamaged angles appears nowhere; the contract appendix shows only photos that carry pre-existing marks.
  - This falls short of the BRIEF ("initial & return condition") and IMAGE_PIPELINE §8 ("2×9 thumbnails").
- **Fix:** also build `docPhotoThumbs(pairs, 'before')`. Render one paired contact sheet (BEFORE | AFTER per pair key, with skip reasons) instead of an AFTER-only grid.

### M4. The signed-contract PDF has two diverging render paths with incompatible fingerprints, and its header comes from live settings
- **Where:**
  - `src/features/contract/contractPdf.ts:25-28, 42-68`: fingerprint `contract-pdf/1:…`.
  - `src/features/report/returnDocuments.ts:167-196`: a second renderer. Its fingerprint is `contentSha256` (line 192) and it resolves only BEFORE photos.
  - `src/documents/contract.ts:180-186`: `headerLeft = input.agencyName`, taken from current settings.
- **Failure:**
  - The background render after signing fails. The report screen's "Share signed contract" then renders and stores a PDF with fingerprint `contentSha256`.
  - The next "Share PDF" on the rental detail page treats it as stale. It renders again and deletes the file that was just sent.
  - Every re-render (missing file, void mark, layout bump, this mismatch) prints the *current* agency name in the page header. A contract signed under "Coastline Rentals" can be reissued with "Coastline Rentals Ltd" in its header.
  - The body is safe: every path embeds the frozen `rendered_html`, and none re-renders from the template (verified).
- **Fix:**
  - Delete the duplicate renderer in `returnDocuments.ts` and call `ensureContractPdf`.
  - Take the header inputs from the frozen `variables['agency.name']` instead of live settings.

### M5. A missing or empty DB file, followed by the deferred orphan sweep, deletes every stored file
- **Where:**
  - `src/data/db.ts:193-219`: if the DB is absent, `openDatabaseAt` creates it, `migrate` runs from v0 without complaint, and housekeeping starts 4 s later.
  - `src/data/db.ts:283-291` and `src/data/filePaths.ts:108-121`
- **Failure** (read from the code; no probe, since this needs the device file system):
  - The root's `carcheck.db` is lost or 0 bytes (storage fault, a partial copy, a future bug) while `files/` still holds media.
  - Boot silently creates an empty v1 database. Four seconds later `sweepOrphans` finds no references and deletes every photo, signature and PDF older than 1 h.
  - Likelihood is low but the loss is total and cannot be recovered.
- **Fix:**
  - If `user_version` was 0 on a root whose `files/` is not empty, refuse to open and show a recovery screen.
  - In `sweepOrphans`, skip deletion when the referenced set is empty or when orphans exceed a sane share of files.
  - Prefer moving orphans to `trash/` with a 7-day expiry.

---

## Low

- **L1. `signContract` stores caller-supplied HTML without checking it against the rental's current data.**
  - Where: `src/data/repos/contracts.ts:255-331`.
  - Probe P7: prepare the contract at 1 000 km, change mileage to 99 999, sign the stale HTML. It is accepted: the contract says 1 000 km, while the locked rental and the report cover say 99 999.
  - The sign screen re-prepares on mount, so the normal flow does not hit this.
  - Fix: inside the signing transaction, re-render from the template, rental data and pick-up damage (`renderContractTemplate(template, loadContext(tx, …))`) and compare with the submitted HTML/variables (ignoring the render time).
- **L2. The content hash does not cover the pick-up photos the contract shows, and `verifyContract` is never called.**
  - Where: `src/domain/types.ts:609-634`, `contracts.ts:379-404`. The PDF text at `documents/contract.ts:131-132` states what the fingerprint covers.
  - Fix: add the referenced photos' sha256 values in a `carcheck-contract/2` preimage, re-hash those photos in verification, and expose "Verify contract".
- **L3. Boot fallbacks irreversibly delete other data roots.**
  - Where: `src/data/db.ts:144-185`, `src/data/pointer.ts:92-104`.
  - With `current.json` unreadable, the root with the newest DB file is adopted. A restore-staging DB is written during prepare, so it can win. `abandonedRoots` then deletes every other `data-*` directory.
  - The "start empty" branch (root missing, no `previous`) does the same.
  - Fix: after a reconstructed or fallback pointer, delete nothing. Keep the runner-up root as `previous` and tell the user.
- **L4. The boot outcome is never shown, and the restore log entry is lost on a crash after the pointer switch.**
  - Where: `src/data/db.ts:236-239` (only `commitRestore` reads `getBootReport`), `src/data/backup/restore.ts:352-369`.
  - If the app is killed after the switch, the next launch finishes or rolls back silently. There is no INTERRUPTED message (DATA_MODEL §7.4) and no `backup_log` row, so "Last backup" is wrong.
  - Fix: surface `BootReport` in `DataGate`, and insert the restore log row into the staged DB before switching.
- **L5. Restore accepts archives whose manifest lists missing or damaged files, against DECISIONS Data §2.**
  - Where: `src/data/backup/manifest.ts:317-321`, `restore.ts:201-206`. In `app/settings/backup/restore.tsx:355`, "Every photo and record in this file is complete and undamaged" appears directly above the warning banner (`:372`).
  - Damaged files are restored even though their DB hashes no longer match.
  - Fix: block these restores (or add an explicit "restore anyway" if the decision changes) and correct the copy.
- **L6. Close-up links are not checked for phase.**
  - Where: `src/data/repos/damage.ts:131-138`, `src/data/migrations.ts:122-123`.
  - A pick-up close-up can be attached to "new" damage and printed as return evidence.
  - Fix: require the close-up's phase to equal `found_phase`, in both the trigger and `assertCloseup`.
- **L7. Four `useLiveQuery` hooks with three different APIs; the entities variant can show stale data.**
  - Where: `src/features/{entities,evidence,inspection,settings}/useLiveQuery.ts`.
  - `entities/useLiveQuery.ts:34-43` has no guard against superseded results, so a slow focus fetch can overwrite a newer data-event fetch.
  - Fix: keep one hook (the inspection variant's ticket guard plus an optional focus refetch) and delete the rest.
- **L8. Layering has drifted from ARCHITECTURE §4.**
  - The undocumented `src/features` layer does file IO, PDF work and sharing (`contractPdf.ts`, `returnDocuments.ts`, `buildReport.ts`, `captureService.ts`).
  - `src/export/` is empty.
  - `src/media/**` imports `src/ui` tokens, the reverse of the documented direction.
  - Fix: update §4 to the real layers and enforce them with `no-restricted-imports`.

---

## Checked and sound

- **Signed contracts:**
  - Triggers block UPDATE and DELETE on `signed_contract`, `contract_void` and template versions.
  - The signature file is imported before the transaction and removed if the transaction fails. It is never overwritten or deleted afterwards.
  - The hash covers the ids, template version, signer, time, signature sha, variables and HTML.
  - PDFs are always built from the frozen `rendered_html`. No code path re-renders a signed contract from the template.
- **Originals and annotations:**
  - `processPhoto` and `importFile` refuse to overwrite an existing target. Frozen photos cannot change or disappear (triggers).
  - Retake and delete work only on unfrozen photos. Markers are stored as normalized JSON on the damage row.
  - Evidence and report files are artifacts keyed by fingerprint (photo sha256, marks, labels, layout version, font). Updates follow write new → swap row → delete old after commit.
- **Pairing:** the pair key `(angle_key, slot)` is enforced by `ux_photo_pair` and by the damage consistency trigger. Compare, evidence and the report all use `getAnglePairs`.
- **Numbering:** pre-existing damage uses letters, and new + uncertain share one number sequence (`ux_damage_number`). Compaction never moves locked rows (Probe P8).
- **Draft discard:** it fires the identity-cleanup trigger through the cascade (Probe P3).
- **Deletion:**
  - Vehicles and customers are archived when referenced, with FK `RESTRICT` as a backstop. Only draft rentals can be deleted.
  - Files are deleted only after commit.
  - The orphan sweep deletes only files that no DB row references and that are older than 1 h (see the M5 caveat).
- **Backup completeness:**
  - `v_file_ref` covers photos (angle and close-up), customer documents, signatures, every artifact (evidence images, contract and report PDFs), the vehicle photo and the logo.
  - Templates and settings travel in the `VACUUM INTO` snapshot. Derivatives are excluded and can be regenerated.
  - The zip entries land at the archive root on both platforms: Android uses zip4j `addFolder` per child, and iOS uses `expandedZipEntries`.
- **Restore:**
  - Size and sha256 are checked for every file and for the DB. Integrity and FK checks, counts and reference coverage are verified, and the staged DB is migrated.
  - The pointer switch uses `verifyPending` with rollback, and the old data is kept as a 14-day safety copy.
- **Paths:** a DB `CHECK` rejects absolute paths, URIs and `..`. Contracts reference photos by id tokens only. No absolute path is persisted anywhere (including `app_pref`).
- **Transactions:**
  - One serialized connection. Every repository write runs as a single `BEGIN IMMEDIATE` transaction.
  - Files are written before their rows, and deleted only after commit. A crash leaves only orphan files, never rows pointing at missing files.
- **iOS:** no blockers found beyond the already-deferred iCloud backup exclusion.
  - SQLite directory paths are decoded correctly.
  - `modificationTime` is in milliseconds on both platforms.
  - Zip and `listContents` both have iOS implementations.
  - "Save to folder" is correctly limited to Android.
