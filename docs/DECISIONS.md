# Orchestrator decisions (override conflicting text in other docs)

Read order for implementers: BRIEF.md → DECISIONS.md → ARCHITECTURE.md → DATA_MODEL.md → IMAGE_PIPELINE.md → UX_FLOWS.md → DESIGN.md.

## Damage markers (reconciles DESIGN.md vs IMAGE_PIPELINE.md)
- **Badge shape encodes status** (DESIGN.md is authoritative for visuals):
  - Pre-existing → hollow SQUARE badge, labelled with LETTERS A, B, C… (per rental).
  - New → filled CIRCLE badge, labelled with NUMBERS 1, 2, 3…
  - Uncertain → DIAMOND badge with the same number sequence as new (new + uncertain share one sequence per rental), plus "?" in caption.
- **Ring style encodes where it was marked**:
  - Solid ring = the area marked on this photo.
  - Dashed ring = "same area" projected onto the counterpart photo (e.g. BEFORE side of a new damage).
- Badge never sits at the ring centre (never occlude the damage); placed on ring edge with a leader if needed (IMAGE_PIPELINE §geometry rules).
- Status is conveyed by shape + label + caption, never colour alone (prints in B/W).

## Stack confirmations
- expo-camera (ratio 4:3, ~12MP pictureSize, exif:false). On-screen shutter only (no volume-key shutter).
- react-native-share approved for "Share all images"; expo-sharing for single files.
- Evidence/PDF font: the DESIGN.md families (Barlow / Barlow Semi Condensed), bundled TTF assets so Skia offscreen text works offline.
- PDF images embedded as base64 data URIs, downscaled ~1600px.

## Product decisions
- Exterior photos: landscape preferred, not enforced; AFTER capture nudges to match BEFORE orientation.
- No customer signature at return in MVP.
- Overlay nudge-alignment: optional data field, UI deferred.
- Backups: share sheet + Android SAF folder picker.
- Dark theme for list/form screens deferred; camera/compare/mark screens are dark by design.
- Signed contract changes: only via explicit void & re-sign (never silent edits).
- APK builds: GitHub Actions only (no local Android SDK). Release keystore via repo secrets — set up at release time by the user.
- iOS iCloud-backup exclusion: deferred to iOS phase.

## Data decisions (answers to DATA_MODEL §10)
1. Retake of a photo that has markers (only possible before it is locked): new photo replaces it, markers carry over (normalized coords) and the UI asks the employee to check them; the unlocked old file is deleted.
2. Restore with any corrupt/missing file: blocked, the error lists what is damaged. No partial restore in MVP.
3. Share temp files: deferred cleanup (on next app start, files older than 24h). OK.
4. Rental reference prefix: configurable in Settings (default "R"), so two phones can use different prefixes.
5. Backups > 4 GB: rely on zip64 support of react-native-zip-archive; QA must confirm; warn the user when a backup exceeds ~3.5 GB.
