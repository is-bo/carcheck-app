# Handoff — where the build stands

Read this first, then docs/AGENT_RULES.md.

## Done
- **Wave A (foundations):** data layer + migrations + immutability triggers (src/data, src/domain), UI kit + app shell (src/ui, app/_layout.tsx), camera/photo/signature (src/media/camera|photo|signature), comparison/markers/evidence composer (src/media/compare|annotate|evidence), PDFs/sharing (src/documents).
- **Wave B (screens):** start flow, return flow + compare + report, tabs/vehicles/customers/rental detail, settings + onboarding + contract template editor, backup & restore (src/data/backup, app/settings/backup).
- **Wave C reviews:** four read-only reviews in docs/reviews/ — architecture-data.md, functional.md, ux.md, security-ios.md.
- **Wave C fixes:** every finding handled; status per finding in **docs/reviews/fixes.md** (fixed / partly / skipped and why). Highlights: signed-contract viewer, schema migration 2 (return needs a valid contract, no void once the return started, vehicle fixed once signed, draft repairs undone, close-up phase), safe orphan sweep, restored contract HTML re-validated, no flow bounce, compact damage sheet, paired pick-up/return sheet in the report.
- **Docs sync:** UX_FLOWS route inventory matches app/; ARCHITECTURE §3/§4/§6 and DATA_MODEL §3/§4/§7.4 updated; short README for the owner.
- **Owner decisions applied:** restore rule written into DECISIONS Data §2 (source-phone gaps → allowed with a warning; corrupt file or file absent from the archive → blocked); `expo-screen-capture` blocks screenshots only on the sign/hand-off and customer ID-photo screens; SDK patch updates on their own commit; the "check the marks" flag after a return retake (migration 3) warns at Complete return.
- Checks: `npx tsc --noEmit` clean, `npx eslint app src` clean, 390 jest tests passing, expo-doctor 21/21.
- CI: .github/workflows/android-apk.yml builds a release APK on every push to master (debug-keystore signed until release secrets exist) and fails if the release APK requests INTERNET or any permission blocked in app.config.ts. Other branches build only through **Run workflow**.

## Owner decisions needed
None open. The three from Wave C are applied (see Done).

## Not done — next steps, in order
1. Build the APK in CI (merge to master, or Run workflow on this branch), then do the first on-phone test: camera, gestures, Skia drawing, PDFs, share, backup/restore — and every Wave C UI change, which was verified by type checks and unit tests only. Check especially: the scrim-less damage sheet (ring drag/resize while open), Compare portrait layout and the "Turn sideways" tag, sign pad in landscape and at large font sizes, the contract viewer, keep/delete photos on a car change, the one-time Overlay hint, boot/restore messages, "Marks look right" after a return retake, screenshots blocked on the sign and customer screens. The owner's checklist is in the pull request. Expect a fix round.
2. Remaining "partly" items worth doing after the phone test (see fixes.md): one shot-preview component for both captures (ux M6), damage-sheet auto-pan and landscape rail variant (ux H4), merging the four `useLiveQuery` hooks (arch L7), moving the report-footer field into Agency details (ux L9).
3. Release prep: create the release keystore and add it as repo secrets (the owner does this; docs/ARCHITECTURE.md §8.1). Changing the key later forces agencies to reinstall and lose data.

## Rules that matter
- docs/DECISIONS.md overrides the other docs.
- A migration that has shipped is never edited: schema changes go in a new migration (migrations 2 and 3 are not on master yet, so they can still change before they ship).
- The repo is PUBLIC: never commit local paths, usernames, emails or secrets. Commit as the GitHub no-reply identity.
- No local Android SDK: APKs are built only by GitHub Actions.
