# Handoff — where the build stands

Paused on purpose so work can continue in a cloud session. Read this first, then docs/AGENT_RULES.md.

## Done
- **Wave A (foundations):** data layer + migrations + immutability triggers (src/data, src/domain), UI kit + app shell (src/ui, app/_layout.tsx), camera/photo/signature (src/media/camera|photo|signature), comparison/markers/evidence composer (src/media/compare|annotate|evidence), PDFs/sharing (src/documents).
- **Wave B (screens):** start flow, return flow + compare + report, tabs/vehicles/customers/rental detail, settings + onboarding + contract template editor, backup & restore (src/data/backup, app/settings/backup).
- **Wave C reviews:** four read-only reviews in docs/reviews/ — architecture-data.md, functional.md, ux.md, security-ios.md. Each finding has file:line and a proposed fix.
- Checks at pause: `npx tsc --noEmit` clean, lint clean, 369 jest tests passing.
- CI: .github/workflows/android-apk.yml builds a release APK on every push to master (debug-keystore signed until release secrets exist). A step now fails the build if the release APK requests INTERNET.

## Not done — next steps, in order
1. **Wave C fixes.** The fixers were stopped before editing code, so NO review finding is fixed yet. Musts:
   - functional H1: `/rental/[id]/contract` (signed-contract viewer) does not exist; rental detail links to it.
   - functional M1: rental detail redirects on focus, so ✕ from the return/re-sign flows bounces back.
   - functional M2: blank capture screen when all angles are skipped. M3: voided contract PDFs shown as "Signed contract".
   - architecture-data H1: voided rental can still be returned/completed and can't be re-signed (enforce in the data layer). H2: vehicle change after void keeps the old car's locked photos. M1, M2, M5 (orphan cleanup must never run when the DB is missing/empty).
   - ux H2: New-rental FAB covers the last row's Return button. H3: compare photos too small in portrait. H4: damage sheet hides its pin. M7: confirm before reopening a completed return.
   - security-ios: re-validate contract HTML from restored backups before PDF/print; clean untracked camera temp files.
   Suggested split by folder ownership: data (src/data, src/domain), start flow (app/rental/[id]/start|annotate|void|contract, src/features/inspection|damage|contract), return (app/rental/[id]/return|report, src/features/evidence|report, src/media/compare|evidence, src/documents), shell (tabs, vehicle, customer, rental detail, settings, src/ui, src/features/entities|settings). Each fixer writes docs/reviews/fixes-<area>.md.
2. Finish docs sync (partly done): UX_FLOWS route inventory vs actual app/ routes; short README for the owner.
3. Build the APK in CI, then do the first on-phone test (camera, gestures, Skia drawing, PDFs, share, backup/restore). Expect a fix round.
4. Release prep: create the release keystore and add it as repo secrets (the owner does this). Changing the key later forces agencies to reinstall and lose data.

## Rules that matter
- docs/DECISIONS.md overrides the other docs.
- The repo is PUBLIC: never commit local paths, usernames, emails or secrets. Commit as the GitHub no-reply identity.
- No local Android SDK: APKs are built only by GitHub Actions.
