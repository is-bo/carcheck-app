# CarCheck — Functional / runtime review

Scope: every workflow traced through `app/**`, `src/features/**`, `src/data/**`, `src/media/**` and `src/documents/**`. Every library call was checked against the **installed** type definitions and, where behaviour mattered, the native sources in `node_modules`. Those libraries are expo-file-system 57.0.7, expo-camera 57.0.5, Skia 2.6.2, Reanimated 4.5.1 / worklets 0.10.1, RNGH 2.32, expo-print 57.0.2, react-native-share 12.3.1, react-native-zip-archive 9.5.1, expo-sqlite 57.0.3 and expo-router 57.0.22. The review reads source only; nothing was run on a device. Only verified issues are listed.

## Checks run

| Check | Result |
|---|---|
| `npx expo-doctor` | 20/21 passed. The one failure is 6 patch-version mismatches (L5). |
| `npx expo config --type prebuild` | OK. Plugins resolve. The main manifest gets CAMERA + INTERNET; `withReleaseOffline` strips INTERNET/ACCESS_NETWORK_STATE in `src/release`. |
| `tsc --noEmit` | 0 errors |
| `jest` | 40 suites, 369 tests pass |
| `expo lint` | clean |
| CI action tags (`checkout@v7`, `setup-node@v7`, `setup-java@v6`, `gradle/actions@v6`, `upload-artifact@v7`) | all exist upstream |

**Counts:** Critical 0 · High 1 · Medium 3 · Low 5

---

## High

### H1. "View" on the contract row opens a route that does not exist
- **Where:** `app/rental/[id]/index.tsx:274` → `crossAgent.contractViewer(id)` = `/rental/${id}/contract` (`src/features/entities/routes.ts:32`). There is no `app/rental/[id]/contract.tsx` and no `+not-found`.
- **Failure:** Every active or returned rental shows **Contract · View**. Tapping it lands on expo-router's built-in "Unmatched Route" page, so there is no way to read the signed contract or its voided versions in-app. `typedRoutes` did not catch it because the href is cast `as Href`.
- **Fix:** Add `app/rental/[id]/contract.tsx`, a read-only viewer. It should read `listContracts(id)` and render each one with `<ContractView html={c.renderedHtml} signatureUri={resolveFileUri(c.signature.path)} … />`. Mark voided versions with their void date and reason, and give it a Share PDF action (`shareContractPdf`). As a stopgap, point "View" at `shareContractPdf(shownContract.id)`.

---

## Medium

### M1. Leaving a flow bounces back into it (rental detail stays mounted under the flow)
- **Where:** `app/rental/[id]/index.tsx:79-80` renders `<Redirect>` whenever `returnInProgress` or `needsSignature` is true. expo-router 57's `Redirect` fires `router.replace` in `useFocusEffect` (`node_modules/expo-router/build/link/Redirect.js`). The same screen then **pushes** the flow on top of itself:
  - "Start return" at `:82-86` and "Edit return" at `:94-97`
  - void, then re-sign: `app/rental/[id]/void.tsx:43` replaces void with `start/details`, so rental detail is still underneath.
- **Failure:** The write (`startReturn` / `reopenReturn` / `voidContract`) emits a data change, and the mounted detail re-renders into a `<Redirect>`. When the employee taps ✕, `useLeaveReturnFlow` (`src/features/evidence/return/flow.ts:37-39`) or `useExitStartFlow` (`src/features/inspection/StartFlowScreen.tsx:25-28`) pops to the detail. The detail regains focus and immediately replaces itself with the flow again. The first ✕ looks broken; only a second ✕ lands on Home. Separately, after a re-sign, "Done" does `goBack()` + `push(rentalHref)`, so two rental-detail screens end up stacked.
- **Fix:** Start these flows with `router.replace(...)` instead of `push` from rental detail, so the detail is not underneath. Alternatively, make the detail redirect only on its first load (use a ref so it never redirects after it has rendered as a normal detail). In `useExitStartFlow`, `router.dismissTo(to)` would avoid the duplicate detail.

### M2. Start capture can open to a blank black screen with no controls
- **Where:** `app/rental/[id]/start/capture.tsx:114` stores `initialTarget(...)`. That returns `{ kind: 'finish' }` when all 8 exterior angles are captured or skipped and the dashboard is handled, and then `:252` renders an empty `<View>`.
- **Reachable when:** all 8 exterior angles are skipped (for example, a car in a tight garage) and the dashboard is taken or skipped.
  - Condition's footer shows "**0** angles still to photograph or skip." plus **Continue photos** (`condition.tsx:84-89`, because `!hasExteriorPhoto`), which opens the blank screen.
  - Home **Resume** also opens the blank screen, because `resumeTarget` returns `'capture'` when the inspection is not complete (`src/domain/rentalLifecycle.ts:284`, and complete needs ≥1 photo).
  - The step sheet's **Inspect** does the same when there are no photos.
  - It also happens if the app is killed in the 400 ms freeze window after the last shot, because the resume step is still `capture`.
- **Failure:** A dead end with no shutter, no ✕ and no message; only hardware Back escapes. The only way forward is to tap a hatched tile.
- **Fix:** Handle `finish` in `capture.tsx`. If there is no exterior photo, target the first skipped exterior angle (`{ kind: 'angle', angleKey: firstSkipped }`); otherwise `router.dismissTo(conditionHref)`. In `condition.tsx`, when `missing.length === 0 && !hasExteriorPhoto`, say "Take at least one outside photo" and open capture on a skipped angle.

### M3. Vehicle → Documents shares voided contracts as "Signed contract" with no VOID mark
- **Where:** `src/data/repos/vehicles.ts:157-160` lists every `contract_pdf` artifact. `app/vehicle/[id]/index.tsx:236-239` titles each one "Signed contract", and `src/features/entities/contractShare.ts:20-31` shares the stored file as-is. `voidContract` (`src/data/repos/contracts.ts:335-350`) never invalidates or re-renders the PDF made at signing. Only `ensureContractPdf` re-renders on void (its fingerprint includes void state), and it runs only for the contract shown on rental detail.
- **Failure:** After a void and re-sign, the vehicle history offers the **pre-void PDF**, unmarked, labelled as a signed contract. That undermines the "voided contracts stay on record, never silently" rule.
- **Fix:** For `contract_pdf` rows, share through `ensureContractPdf(artifact.target.contractId)` so a stale file is re-rendered with the VOID banner. Label voided ones "Voided contract" (join `contract_void` in the query), or hide them from this list.

---

## Low

### L1. Two incompatible staleness keys for the same contract-PDF artifact
- **Where:** `src/features/report/returnDocuments.ts:174,192` (`shareSignedContract`) reuses any existing file with no fingerprint check and saves `sourceFingerprint = contract.contentSha256`. `src/features/contract/contractPdf.ts:193-208` expects `contract-pdf/1:<id>:<sha>:valid|void@…`.
- **Failure:** Whichever path runs second treats the other's PDF as stale and re-renders it, adding 1–3 s to "Share". It also means the report's **Share signed contract PDF** can share an unmarked pre-void PDF when the rental has no valid contract. That happens when a needs-signature rental is returned through the vehicle step's "Start its return" (`startReturn` only checks `status === 'active'`).
- **Fix:** Have `shareSignedContract` call `ensureContractPdf(contract.id)` and drop its own render path.

### L2. Details step loses the last ≤700 ms of edits when leaving
- **Where:** `app/rental/[id]/start/details.tsx:92-99`. The autosave timer is cleared on unmount with no final write. The customer step (`customer.tsx:125-130`) and return details both flush on unmount.
- **Failure:** If the employee types the mileage and taps ✕, Back, or a step-sheet jump within 0.7 s, the value is silently dropped.
- **Fix:** Add an unmount effect that writes `patch()` when `edited.current` is set and a save is pending.

### L3. Home has promise chains with no rejection handler
- **Where:** `app/(tabs)/index.tsx:42` (`isAgencyConfigured`), `:69` (`searchRentals`) and `:86` (`listRentals` for "All history").
- **Failure:** Each rejection is unhandled. At `:42`, `agencyChecked` stays false and Home renders `null` forever. At `:69` the search skeleton is stuck, and at `:86` the "All history" button spinner is stuck.
- **Fix:** Add rejection handlers: treat a failed agency check as configured and show a toast, and reset `searching` / `returnedExpanding`.

### L4. Retake / edit paths keep stacking screens
- **Where:** Compare's "Retake return photo" and "Take photo" **push** a new capture (`compare.tsx:320,378`). After the shot, `return/capture.tsx:103-108` either walks on to other missing angles or `goCompare()` **pushes** another compare. Separately, the report's "Edit return" (`report.tsx:211-213`) pushes the return flow over the report, and "Complete return" then `replace`s the flow with a *second* report.
- **Failure:** The stack becomes [capture, compare, capture, compare] (or report, report). Back walks through stale copies. It is not a crash.
- **Fix:** When capture is opened with `?angle=` (a retake), `router.back()` after the shot. Use `router.dismissTo(returnRoutes.compare(id))` in `goCompare`. From the report, `replace` into the flow.

### L5. SDK patch mismatches (expo-doctor)
- expo 57.0.24 (expected ~57.0.25). Also behind: expo-image-manipulator 57.0.19, expo-image-picker 57.0.19, expo-linking 57.0.10, expo-router 57.0.22, expo-sharing 57.0.21.
- **Fix:** Run `npx expo install --fix` before the release build. No runtime break is known from these versions.

---

## Verified OK (no action)

- **Routes and params:** every other `router.push` / `replace` / `dismissTo` / `Redirect` target has a route file. Param names match: `annotate/[photoId]`, `?angle&slot` (return), `?angle&single&extra` (start capture), `?then=restore`. `start/index` and rental detail cannot ping-pong, because `resumeTarget` always returns a start step while the start flow is open.
- **Onboarding:** Home redirects to `/onboarding` until an agency name exists. Onboarding then `replace('/')` (replace, so Android Back exits instead of returning to onboarding).
- **expo-file-system:** `copy` and `move` are async in 57 and are awaited everywhere. `write()` creates missing files natively, and `rename`, `Paths.info` and `availableDiskSpace` exist. expo-sqlite accepts the plain directory path.
- **expo-camera:** all `CameraView` props (`ratio`, `pictureSize`, `enableTorch`, `animateShutter`, `onMountError`, `responsiveOrientationWhenOrientationLocked`) and the `takePictureAsync({ quality, exif, shutterSound })` options exist. Permission denial is handled, including the path to Settings and the re-check when the app returns to the foreground.
- **Skia:** `Surface.Make` is a CPU raster surface (not `MakeOffscreen`). `encodeToBytes` gets quality 0–100 (0.85 is scaled ×100). `PathBuilder`, `Typeface.MakeFreeTypeFaceFromData` and `loadData` exist; in a release APK the fonts resolve as `res/raw`. `Data.fromURI(file://)` uses a Java URL stream, so no network is needed. Text is drawn only once the font has loaded.
- **Worklets and gestures:** every helper called from a gesture or derived value carries `'worklet'`. JS callbacks go through `scheduleOnRN`, and easings are `Easing.bezier`. The Modals with gestures wrap their content in `GestureHandlerRootView`. babel-preset-expo 57 adds `react-native-worklets/plugin` automatically, and Skia and worklets need no metro config.
- **Printing and sharing:** the expo-print options match its types. react-native-share gets copies staged under `cache/`, which matches its FileProvider `cache-path`, and expo-sharing gets the same staged copies.
- **Backup:** the zip-archive signatures (`zip(options)`, `unzip(options)`, `listContents`, `subscribe`, `NO_COMPRESSION`) match. Android zip4j puts a listed directory's children at the archive root, which matches the manifest layout and the Node test fake.
- **Offline release:** no `fetch`, http or download calls exist, so stripping INTERNET is safe. expo-dev-client is debug-only.
- **Optional fields never block:** only unknown template keys render as `[missing: …]`. Plate and customer name are the only required inputs, and mileage may be empty.
- **Android Back:** Back is handled in the sign screen's stages, bottom sheets, the dirty guard on the template editor, the backup and restore guards, and every Modal (`onRequestClose`).
