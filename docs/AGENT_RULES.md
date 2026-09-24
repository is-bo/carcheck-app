# Rules for implementation subagents

1. Read, in order: docs/BRIEF.md, docs/DECISIONS.md (overrides everything else), docs/ARCHITECTURE.md, then the docs relevant to your task (DATA_MODEL.md, IMAGE_PIPELINE.md, UX_FLOWS.md, DESIGN.md + src/ui/theme/tokens.ts).
2. Only create/edit files inside the paths your task OWNS. Other agents are working in parallel on other paths. If you need something from a path you don't own, code against the interface contract given in your task and note it in your final answer.
3. Do NOT edit package.json / lockfile / app.config.ts. If you need a dependency, stop and report it (name + why) in your final answer, or work without it. Already installed: see package.json (Skia, Reanimated 4, Gesture Handler, expo-camera, expo-sqlite, expo-file-system, expo-print, expo-sharing, react-native-share, react-native-zip-archive, expo-image, expo-image-manipulator, expo-crypto, expo-haptics, expo-font, @expo-google-fonts/barlow, @expo-google-fonts/barlow-semi-condensed, lucide-react-native, react-native-svg, expo-document-picker, expo-image-picker; dev: better-sqlite3 for Node tests).
4. TypeScript strict, `@/` alias → src/. Keep domain logic (src/domain, src/data) free of React. UI in app/ (routes) and src/ui. No fake/mock backends, no placeholder features, no TODO stubs for core behaviour.
5. Verify focused: `npx tsc --noEmit` must pass for the whole project when you finish (if a failure is in a file you don't own, report it, don't fix it). Write jest tests for pure logic you create; run only your tests (`npx jest <path>`).
6. Match surrounding code style; comments only where the why is non-obvious. No large dumps into your final answer.
7. Final answer ≤ 200 words: what you built (files), exported interfaces others must use, verification results, dependencies needed, known gaps. No code listings.

## Wave B (screens) — shared conventions
- UI kit: import from `@/ui` (Screen, TopBar, Button, ListRow, ListSection, TextField, BottomSheet, SegmentedControl, Chip/ChipGroup, StepHeader, MarkerBadge, CarDiagram, PhotoTile, EmptyState, ConfirmDialog, showToast, ActionFooter, KeyboardAwareForm, PlateFrame, Banner, …). Look at app/dev/kit.tsx for usage. Use tokens, never hard-coded colours/sizes. Don't fork kit components; if one is missing a variant, build a local component in your owned folder and report it.
- Data: `@/data/repos` (see src/data/repos/index.ts), file paths from `@/data/files`, change notifications from `@/data/events` (subscribe to refresh lists).
- Media: `@/media/camera` (CaptureCamera), `@/media/photo` (processPhoto, importPhotoFromLibrary), `@/media/signature` (SignaturePad), `@/media/compare` (ComparisonView…), `@/media/annotate` (MarkerEditor, MarkerLayer, pairMarkers, photoMarkers), `@/media/evidence` (composeEvidence, composeEvidenceInputHash). Documents: `@/documents`.
- Presentation per route is chosen in app/_layout.tsx via `screenPresets` by route name — read it; put routes where UX_FLOWS.md's inventory says.
- Every screen: loading, empty, error states; ≥48dp targets; safe areas; keyboard handling on forms; Android back behaviour sane (flows autosave, no data loss); copy from UX_FLOWS.md.
- Before writing UI read Impeccable: the Impeccable skill's reference/craft-floor.md. Match DESIGN.md and docs/design/screens/*.html mockups. No AI-slop.
- Shared feature services live in src/features/<area>/ owned by the agent named in its task.

## Wave C (fixes) — conventions
- Findings live in docs/reviews/{architecture-data,functional,ux,security-ios}.md. Fix every finding (all severities where the fix is proportionate) whose code lies in YOUR owned paths. Fix root causes, don't layer hacks. Keep the "keep — this is good" items in ux.md intact.
- A finding that needs a change outside your paths: don't touch it; list it in your report.
- Write your report to docs/reviews/fixes-<your-area>.md: one line per finding ID → fixed / partly / skipped (why). Do not edit the review files themselves.
- Never write local machine paths, usernames or emails into committed files (the repo is public).
- Finish with: whole-project `npx tsc --noEmit`, `npx eslint <your paths>`, and your related jest tests all passing.
