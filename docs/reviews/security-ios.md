# CarCheck — Security/Privacy & iOS-readiness review

Scope: read-only source review (no build artifacts modified) against docs/BRIEF.md "Storage,
backup, privacy", docs/DECISIONS.md and docs/ARCHITECTURE.md §6/§9/§10. Covers: app-private
storage and EXIF/GPS handling, sharing/FileProvider, Android manifest and permissions (verified
against a real `expo prebuild -p android` output, then deleted), console logging, the `.carcheck`
backup/restore pipeline (zip-slip, manifest validation, untrusted DB handling), the contract
template renderer and PDF/print pipeline (HTML/script injection), and iOS readiness.

**Counts: 0 Critical · 0 High · 4 Medium · 5 Low.** This codebase is unusually disciplined about
exactly the risks this review targets — most of the checklist items below passed. The two
concrete, actionable code fixes are M1 (restore-time HTML re-validation) and M2 (CI gate for the
offline release build); the rest are hardening/verification items, not live holes.

---

## Medium

### M1. A malicious `.carcheck` backup can inject HTML/script into a contract PDF via `rendered_html`
- **Where:** `src/data/repos/contracts.ts:258-259` validates `renderedHtml` with
  `contractHtmlReferences()` (`src/domain/contract/render.ts:245-258`) **only at signing time**.
  `src/data/backup/restore.ts:208-240` (the "records" validation step) checks schema version,
  `PRAGMA integrity_check`, `foreign_key_check`, row counts and that every `v_file_ref` path is
  backed by a manifest entry — but never re-runs `contractHtmlReferences` (or any HTML sanity
  check) over the restored `signed_contract.rendered_html` rows.
- **Scenario:** an attacker crafts a `.carcheck` archive with a self-consistent manifest (its own
  `manifestSha256`, matching DB `PRAGMA user_version`, matching record counts and file hashes —
  all attacker-controlled, since they build the whole archive) whose `signed_contract.rendered_html`
  contains e.g. `<script>` or an `<img src="https://evil.example/…">`. Restore accepts it (none of
  the current checks inspect HTML content). On-screen viewing is safe: `ContractView.tsx` parses
  `renderedHtml` with the hand-rolled tree builder in `src/documents/html/parse.ts`, which treats
  `<script>` as opaque `RAW_TEXT` and only converts a fixed allow-list of tags to native RN views —
  no WebView is involved there. But `src/documents/contract.ts:143-149`
  (`contractSection`/`applyContractAssets`) only rewrites `src`/`href` attributes that exactly match
  `carcheck-photo:…` / `carcheck-signature:customer`; everything else in the frozen HTML is passed
  through **verbatim** into `renderContractDocument()` → `htmlDocument()` →
  `Print.printToFileAsync({ html, … })` (`src/documents/pdf.ts:39-52`), which renders it in a real
  WebView to produce the contract PDF, the embedded report appendix, and the system print dialog.
  This requires the victim to explicitly pick a file and confirm the destructive "Restore" action
  (docs/DATA_MODEL.md §7.3), so it is not remotely triggerable — but "a plausible-looking backup
  file from a USB stick / email / cloud link" is a realistic social-engineering vector for an
  agency's shared-backup workflow (DECISIONS.md: "Backups: share sheet + Android SAF folder
  picker").
- **Fix (proportionate, reuses existing code):** in `prepareRestoreWith` (`restore.ts`, same block
  that already opens the staged DB at line 212), after `getRecordCounts`/`listFileRefs`, also
  `SELECT rendered_html FROM signed_contract` and run `contractHtmlReferences()` on each row; throw
  a `BackupError('corrupted', 'restore', …)` if any row's `invalid.length > 0`. This is the same
  function already trusted at signing time, so there is no new escaping logic to write or review.

### M2. The "offline release build" guarantee has no automated regression check
- **Where:** `plugins/withReleaseOffline.js` and `app.config.ts:74-75` are correct as written — I
  confirmed this by actually running `npx expo prebuild --platform android --no-install` and
  reading the generated manifests: `android/app/src/main/AndroidManifest.xml` has `INTERNET`,
  `android/app/src/release/AndroidManifest.xml` has `tools:node="remove"` for `INTERNET` and
  `ACCESS_NETWORK_STATE` (Android's build-variant manifest merge applies this to `assembleRelease`
  only, which is the documented intent). `.github/workflows/android-apk.yml:90-136` builds and
  signs the release APK but never asserts the *result* has no INTERNET permission.
- **Scenario:** a future dependency or plugin that re-declares `INTERNET` at a manifest-merge
  priority the removal doesn't reach, or an accidental edit to `withReleaseOffline.js` /
  `app.config.ts`'s plugin order, would silently ship a release APK that can open sockets — the
  exact thing "100% offline… no network at runtime" (BRIEF.md) depends on never happening — and
  nothing in CI would fail.
- **Fix:** add one step to `android-apk.yml` after "Build APK" (release variant only):
  `${buildtools}aapt2 dump permissions android/app/build/outputs/apk/release/app-release.apk` (the
  workflow already resolves `$buildtools` in the next step) and `grep -q INTERNET && exit 1` — a
  ~5-line addition, no new tooling.

### M3. `expo-image-picker`'s iOS behaviour (Info.plist, permission prompt) is unverified
- **Where:** `src/media/photo/importPhoto.ts:9,28-43` imports and calls
  `ImagePicker.launchImageLibraryAsync` for ID-document, vehicle-photo and logo import (this is an
  approved dependency per `docs/AGENT_RULES.md` point 3, so the *use* of the library is expected).
  `app.config.ts:50-76`'s `plugins` array has no `expo-image-picker` entry, so its own config
  plugin (which would inject `NSPhotoLibraryUsageDescription` if the picker's iOS flow ever needs
  it) never runs. `docs/ARCHITECTURE.md:49` still lists `expo-image-picker` under "Rejected
  alternatives" ("no gallery import is needed yet… avoids media permissions"), which is stale next
  to the actual code.
- **Scenario:** the code comment in `importPhoto.ts` asserts the modern PHPicker flow needs no
  media permission — true for a plain `PHPickerViewController` present, but this has not been
  exercised on a real iOS device by this project (iOS hasn't been built yet, per
  ARCHITECTURE.md §9). If the exact option combination used here
  (`shouldDownloadFromNetwork: false`, `preferredAssetRepresentationMode: Compatible`) ever touches
  a `PHPhotoLibrary` authorization API internally, the app would crash on first use with no
  `NSPhotoLibraryUsageDescription` key, and no local repro is possible on Windows/Android CI.
- **Fix:** when the iOS build phase starts, test the ID-doc/vehicle/logo pickers on a real device
  first; if a permission prompt or crash appears, add `expo-image-picker` to `app.config.ts`
  `plugins` with an explicit `photosPermission` string. Update `docs/ARCHITECTURE.md:49` either way
  so the rejected-alternatives list matches reality.

### M4. `.carcheck` backups hold all customer PII and ID photos unencrypted — risk assessed, already mitigated
- **Where:** `src/data/backup/manifest.ts` / `createBackup.ts` confirm the archive is a plain,
  uncompressed ZIP (`NO_COMPRESSION`) with no password. `docs/DATA_MODEL.md:254` (open question 7)
  already flags this as undecided.
- **Risk:** anyone who obtains a `.carcheck` file (lost USB drive, misaddressed email, unsecured
  cloud folder) can open it as a normal ZIP and read every ID/passport photo, signature and
  customer record in the agency's history — there is no re-authentication step inside the archive
  itself.
- **Assessment:** for this MVP (BRIEF.md: "No enterprise-security complexity"), the app already
  ships the proportionate mitigation the brief asks for — clear, specific warning copy at both
  points where a human decides where the file goes: `app/settings/backup/index.tsx:132-135` ("A
  backup also holds… customer ID photos… Store it where only your agency can reach it.") and
  `app/settings/backup/create.tsx:415-417` ("Keep this file somewhere other than this phone. It
  contains customer ID photos — store it safely."). **No code change is required for MVP.**
  Optional future enhancement, not a blocker: `react-native-zip-archive`'s `zip()` already accepts
  a `password` option (AES via zip4j on Android), so an opt-in "Protect with a password" toggle on
  Create Backup would be cheap to add later if agencies ask for it — do not build it speculatively.

---

## Low

### L1. `expo-sharing`'s FileProvider is scoped wider than the app's own sharing rule
- **Where:** `node_modules/expo-sharing/android/src/main/res/xml/sharing_provider_paths.xml`
  declares `<files-path name="expo_files" path="."/>`, i.e. the FileProvider (authority
  `${applicationId}.SharingFileProvider`) can mint a `content://` grant for *any* file under
  `Paths.document` (`getFilesDir()`), which is exactly where `src/data/files.ts` stores ID photos,
  signatures and signed contracts (`carcheck/data-<id>/files/…`). `docs/ARCHITECTURE.md:87`
  describes the intended rule ("Always copy files into `cache/export/`… never share from
  `documents/`"), and `src/documents/share.ts:64-93` (`stageFiles`/`shareFile`) and
  `src/data/backup/index.ts:131-163` (`saveBackupToFolder`/`shareBackup`) do correctly enforce it
  today — I checked every call site of `Sharing.shareAsync`/`stageFiles` in `src/` and all of them
  go through a `cache/…` staging copy first.
- **Scenario:** this is defense-in-depth, not a live bug. If a future change ever calls
  `Sharing.shareAsync()` directly on a live document path (skipping `share.ts`'s staging), the
  provider config would silently allow it instead of failing loudly.
- **Fix (cheap):** a small config plugin (same shape as `plugins/withReleaseOffline.js`) that
  overwrites `sharing_provider_paths.xml` (and `react-native-share`'s
  `share_download_paths.xml`, which uses `<cache-path path="/"/>`, i.e. the whole cache dir
  including `backup/`/`restore/` staging) to expose only `cache/exports/`. Optional; the current
  code discipline already prevents exploitation.

### L2. Restore parses a fully untrusted SQLite file before app-level validation completes
- **Where:** `src/data/backup/restore.ts:212-240` opens the staged, attacker-suppliable
  `carcheck.db` with `live.openDb(...)` and immediately runs `PRAGMA integrity_check`,
  `PRAGMA foreign_key_check`, `getRecordCounts`, `listFileRefs` (a `SELECT` over the `v_file_ref`
  view) and, if the (attacker-controlled) schema version is below current, `migrate()`.
- **Assessment:** I traced this for the two things the task asked about — "triggers/views
  executing on open" — and found no code-execution path: every query the app issues here is a pure
  `SELECT`/`PRAGMA`, so `migrations.ts`'s `BEFORE/AFTER INSERT|UPDATE|DELETE` triggers never fire
  (SQLite triggers only run on writes), and `migrate()` only ever executes **this app's own**
  hardcoded migration SQL (`src/data/migrations.ts:586-588`), never attacker-supplied text, and
  only when the attacker's declared `user_version` is genuinely below `SCHEMA_VERSION`. The residual
  risk is entirely in the bundled SQLite/zip4j engines' own memory-safety when parsing a
  maliciously malformed file (a real but generic class of SQLite CVEs, not specific to this app's
  logic) — inherent to supporting local `.carcheck` restore at all.
- **Fix:** none required beyond normal hygiene — keep `expo-sqlite` (and its bundled SQLite) and
  `react-native-zip-archive` current on every SDK upgrade (ARCHITECTURE.md §11 already says this
  for other reasons). Worth a one-line addition to DATA_MODEL.md's open question 7/2 area noting
  this is an accepted, inherent trust boundary of the restore feature.

### L3. iOS zip-slip protection for restore is unverified
- **Where:** Android's path-traversal guard was directly verified in this repo's vendored copy:
  `node_modules/react-native-zip-archive/android/src/main/java/com/rnziparchive/ZipSecurity.java`
  canonicalizes every extract target and throws (`ERR_UNSAFE_PATH`) if it would land outside the
  destination directory, and `RNZipArchiveModule.java` calls `ZipSecurity.validateExtractPath(...)`
  on every extraction code path (confirmed via grep, 4 call sites). `src/data/backup/expo.ts:188-198`
  and `src/data/backup/restore.ts` correctly surface `ERR_UNSAFE_PATH` as a `BackupError('corrupted', …)`.
  I could not find an equivalent explicit canonical-path check in
  `node_modules/react-native-zip-archive/ios/RNZipArchive.mm` (it wraps SSZipArchive; whether the
  vendored SSZipArchive version has its own zip-slip fix was not checked here).
- **Scenario:** low priority today — iOS isn't built yet (ARCHITECTURE.md §9) — but restore is a
  core, security-relevant feature and this needs to be re-verified before the first iOS release,
  not assumed to inherit Android's guarantee.
- **Fix:** when the iOS phase starts, add one test: restore an archive containing an entry with a
  `../` path component on a real iOS build and confirm it is rejected, not silently written outside
  the sandbox.

### L4. No screenshot/screen-recording protection on ID-document or signature screens
- **Where:** `src/features/entities/ProtectedThumb.tsx` blurs stored ID/licence thumbnails until
  tapped ("Stored only on this phone", per UX_FLOWS §8) — a good mitigation for shoulder-surfing —
  but nothing in the app sets Android's `FLAG_SECURE` or uses `expo-screen-capture`, so those same
  screens (and `src/media/signature/SignaturePad.tsx`, and the customer-facing contract hand-off)
  can be screenshotted, screen-recorded, or appear as a plaintext thumbnail in the Android
  recent-apps switcher.
- **Fix (cheap, as the task asks to recommend only if cheap):** add `expo-screen-capture` and call
  its `usePreventScreenCapture()` hook scoped to just the ID-document capture/reveal screens, the
  signature pad, and the customer hand-off screen — not globally, so employee-facing screens stay
  screenshotable for support/troubleshooting.

### L5. Failed photo processing can orphan full-resolution captures outside the swept temp areas
- **Where:** `src/media/camera/CaptureCamera.tsx` hands `picture.uri` (written by expo-camera
  itself to `<cacheDir>/Camera/…`, confirmed via
  `node_modules/expo-camera/android/.../tasks/ResolveTakenPicture.kt:36`
  `private const val DIRECTORY_NAME = "Camera"`) to `processPhoto()`
  (`src/media/photo/processPhoto.ts`). On success, `runProcessPhoto` deletes it
  (`safeDelete(temp)`, line ~169). On failure, the `catch` block
  (`processPhoto.ts:181-185`) does `owned?.release(); written.forEach(safeDelete); throw e;` —
  `written` only holds the *destination*-side files this call created, never `temp`, so a failed
  capture (disk full, corrupt JPEG, decode error) leaves the original photo behind. `src/data/files.ts`
  `cleanupTempFiles()` (lines 253-269) only sweeps `TEMP_AREAS = ['capture', 'exports', 'backup',
  'restore']` (line 59) — `<cacheDir>/Camera/` is a different, untracked directory, so these
  orphaned files (which can include ID-document photos, since `PhotoCaptureModal` is shared for
  both) are never actively cleaned by the app.
- **Impact:** privacy-neutral (still app-private cache, never exposed to another app or the
  gallery, and Android can reclaim app cache under storage pressure) but it is a real gap against
  the stated design ("camera temp files cleaned") and a slow storage leak on a phone with repeated
  capture failures.
  **Fix:** add `safeDelete(temp)` to the `catch` block in `runProcessPhoto`
  (`processPhoto.ts:181-185`), or simpler, have `cleanupTempFiles()` also sweep
  `new Directory(Paths.cache, 'Camera')` alongside the existing `TEMP_AREAS`. Either is a
  one-line change.

---

## Verified sound (no fix needed)

- **App-private storage, no media-store leakage.** Everything lives under
  `Paths.document/carcheck/data-<id>/files/…` (`src/data/files.ts`); every stored path is validated
  by `isValidRelPath()`/`assertRelPath()` (`src/data/filePaths.ts:12-26`, also enforced at the SQL
  layer by the `CHECK` constraints built from the same `relPath()` helper in
  `src/data/migrations.ts:55-57`), which rejects `..`, `\`, `//`, drive letters and absolute paths —
  checked both when a repo writes a path and every time `resolveFileUri()`/`storeFile()` reads one
  back, so even a maliciously-crafted DB row can't be used for path traversal at read time.
- **EXIF/GPS stripped on both capture paths.** Camera: `takePictureAsync({ exif: false, … })`
  (`CaptureCamera.tsx:393`). Gallery import: `ImagePicker.launchImageLibraryAsync({ exif: false,
  … })` (`importPhoto.ts:33-43`) plus a forced re-encode (`processPhoto.ts` `reencode: true` for
  imports) that bakes EXIF orientation into pixels and drops all other metadata, confirmed by
  `runProcessPhoto`'s re-encode branch (`processPhoto.ts:137-158`).
- **Contract/report HTML escaping is correct everywhere in the normal (non-restore) flow.** Traced
  every text/variable path in `src/domain/contract/render.ts`, `damageList.ts`, `variables.ts`, and
  `src/documents/html/blocks.ts`/`contract.ts`/`report.ts`: all free text (template body, customer
  name/phone/address/notes, damage notes, agency fields, void reasons) goes through
  `escapeHtml`/`escapeMultiline` (`src/documents/html/escape.ts`); the only unescaped HTML comes
  from the registry's own `resolveBlockHtml`/`resolveInlineHtml` builders, which themselves escape
  every value they interpolate; image `src` values are constrained to `data:image/(png|jpe?g|webp|
  gif|svg+xml)` by `safeImageSrc()`; and `signContract()` (`src/data/repos/contracts.ts:258-259`)
  rejects any `rendered_html` with a reference outside `carcheck-photo:<id>` /
  `carcheck-signature:customer` before it can ever be persisted. (See M1 for the one gap: this
  guarantee isn't re-checked after a restore.)
- **Sharing discipline.** Every `Sharing.shareAsync`/`share.open()` call site in `src/` stages a
  copy under `cache/exports` (or the backup's own `cache/backup`) first; originals/ID docs are
  never shared directly; `assertShareable()` (`src/documents/share.ts:56-61`) refuses `kind:
  'original'` items unless the caller explicitly opts in, matching BRIEF's "Raw photo export only
  as explicit separate action."
- **Android manifest, confirmed by running `expo prebuild -p android` and reading the output
  (then deleted; not committed):** `allowBackup="false"`; only `CAMERA`, `INTERNET` (debug/dev-client
  only — stripped for release, see M2) and `VIBRATE` are requested; `READ/WRITE_EXTERNAL_STORAGE`,
  `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are explicitly blocked; the only exported component is
  `MainActivity` (required for the launcher + `carcheck://`/`exp+carcheck://` deep links), no
  exported services/receivers/providers of the app's own.
- **Logs are clean of PII.** Every `console.log/warn/error` call in `src/` and `app/` (14 sites,
  all `console.warn`) logs only error objects, internal UUID-based paths/root names or step names —
  none print customer names, phone numbers, ID numbers or file contents.
- **Backup/restore integrity.** Manifest parsing (`src/data/backup/manifest.ts:201-277`) validates
  every field's shape, rejects unknown/newer format or schema versions, and recomputes a self-hash
  before trusting anything; every file is size- and SHA-256-checked against the manifest after
  unzip (`restore.ts:184-206`); DB row counts and every live file reference are cross-checked
  against the manifest (`restore.ts:220-226`) before the pointer switch is even offered.

---

## iOS readiness summary

Not built yet (no Mac in this environment); reviewed from source only.
- `Info.plist`: `NSCameraUsageDescription` comes from the `expo-camera` plugin (config present,
  `app.config.ts:63-73`); `NSPhotoLibraryAddUsageDescription` and `ITSAppUsesNonExemptEncryption:
  false` are set explicitly (`app.config.ts:23-28`). `NSPhotoLibraryUsageDescription` (read) is
  absent — see M3.
- `Paths.document` (where all PII lives) is included in iCloud/device backups by default on iOS;
  `docs/DECISIONS.md:30` and `docs/ARCHITECTURE.md:149` already correctly flag this as deferred to
  the iOS phase, not forgotten. Flagging again here only so it isn't lost: this should land
  *before* the first customer-visible iOS TestFlight build, since it's the direct iOS equivalent of
  the Android `allowBackup="false"` protection already shipped.
  `Directory.pickDirectoryAsync` (Android SAF) is correctly gated off on iOS
  (`canSaveToFolder = Platform.OS === 'android'`, `src/data/backup/index.ts:122`); iOS backup
  save falls back to the share sheet only, as DECISIONS.md specifies.
- `expo-print` renders via WKWebView on iOS vs. an Android WebView; both share the same HTML
  builders in `src/documents/`, so M1's fix applies equally to both platforms. Page-size/margin
  behaviour (`src/documents/pdf.ts:19-28` already branches `IOS_MARGINS`) should still get a manual
  check on a real device per ARCHITECTURE.md §9.
- `expo-image-picker`'s iOS permission behaviour is unverified — see M3.
- Zip-slip protection on iOS restore is unverified — see L3.
