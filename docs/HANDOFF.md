# Handoff — where the build stands

Read this first, then docs/AGENT_RULES.md.

## Done
- **Wave A (foundations):** data layer + migrations + immutability triggers (src/data, src/domain), UI kit + app shell (src/ui, app/_layout.tsx), camera/photo/signature (src/media/camera|photo|signature), comparison/markers/evidence composer (src/media/compare|annotate|evidence), PDFs/sharing (src/documents).
- **Wave B (screens):** start flow, return flow + compare + report, tabs/vehicles/customers/rental detail, settings + onboarding + contract template editor, backup & restore (src/data/backup, app/settings/backup).
- **Wave C reviews:** four read-only reviews in docs/reviews/ — architecture-data.md, functional.md, ux.md, security-ios.md.
- **Wave C fixes:** every finding handled; status per finding in **docs/reviews/fixes.md** (fixed / partly / skipped and why). Highlights: signed-contract viewer, schema migration 2 (return needs a valid contract, no void once the return started, vehicle fixed once signed, draft repairs undone, close-up phase), safe orphan sweep, restored contract HTML re-validated, no flow bounce, compact damage sheet, paired pick-up/return sheet in the report.
- **Docs sync:** UX_FLOWS route inventory matches app/; ARCHITECTURE §3/§4/§6 and DATA_MODEL §3/§4/§7.4 updated; short README for the owner.
- Checks: `npx tsc --noEmit` clean, `npx eslint app src` clean, 385 jest tests passing.
- CI: .github/workflows/android-apk.yml builds a release APK on every push to master (debug-keystore signed until release secrets exist) and fails if the release APK requests INTERNET. Other branches build only through **Run workflow**.

## Owner decisions needed
1. **Restore of backups that list files already missing on the source phone** (architecture L5): DECISIONS Data §2 says "blocked", but the create screen says such backups keep the files as they are. Current behaviour: allowed, with a clear warning. Keep, or block?
2. **Screenshot protection** on ID-photo, signature and hand-off screens (security L4) needs the new dependency `expo-screen-capture`. Approve or skip.
3. **SDK patch updates** (`npx expo install --fix`, functional L5) before the release build.

## Not done — next steps, in order
1. Build the APK in CI (merge to master, or Run workflow on this branch), then do the first on-phone test: camera, gestures, Skia drawing, PDFs, share, backup/restore — and every Wave C UI change, which was verified by type checks and unit tests only. Check especially: the scrim-less damage sheet (ring drag/resize while open), Compare portrait layout and the "Turn sideways" tag, sign pad in landscape and at large font sizes, the contract viewer, keep/delete photos on a car change, the one-time Overlay hint, boot/restore messages. Expect a fix round.
2. Remaining "partly" items worth doing after the phone test (see fixes.md): persisted "check the marks" flag after a return retake (arch M2), one shot-preview component for both captures (ux M6), damage-sheet auto-pan and landscape rail variant (ux H4), merging the four `useLiveQuery` hooks (arch L7), moving the report-footer field into Agency details (ux L9).
3. Release prep: create the release keystore and add it as repo secrets (the owner does this; docs/ARCHITECTURE.md §8.1). Changing the key later forces agencies to reinstall and lose data.

## Rules that matter
- docs/DECISIONS.md overrides the other docs.
- A migration that has shipped is never edited: schema changes go in a new migration (migration 2 is not on master yet, so it can still change before it ships).
- The repo is PUBLIC: never commit local paths, usernames, emails or secrets. Commit as the GitHub no-reply identity.
- No local Android SDK: APKs are built only by GitHub Actions.
