# CarCheck

Offline Android app for car-rental agencies: photograph the car at pick-up, have the customer sign a condition agreement on the phone, photograph it again at return, compare BEFORE and AFTER per angle, mark new damage, and hand over evidence images and a PDF report. No accounts, no cloud, no network: everything stays on the phone (backups are files you save or share).

## Get the app

APKs are built by GitHub Actions only (there is no local Android SDK):

1. Open **Actions → Android APK** and pick the latest green run on `master` (or **Run workflow** to build one).
2. Download the APK from the run's **Artifacts**, copy it to the phone, open it and allow "install unknown apps".

Until the release key exists, builds are signed with the public debug key and named `…-debugsigned.apk`. Use them for testing only: **before the first agency install, create the release keystore and add it as repo secrets** (steps in `docs/ARCHITECTURE.md` §8.1). The key can never change afterwards without agencies reinstalling and losing their data.

## Work on it

```sh
npm ci
npm run verify   # typecheck, lint, unit tests (CI runs the same)
npm start        # Metro for the dev-client APK (Actions → Run workflow → variant: debug)
```

## Where things are

| Read | For |
|---|---|
| `docs/HANDOFF.md` | Where the build stands and what comes next |
| `docs/BRIEF.md` → `docs/DECISIONS.md` | What the product is; decisions that override every other doc |
| `docs/ARCHITECTURE.md` | Stack, folders, builds, offline and privacy rules |
| `docs/DATA_MODEL.md` | Database, evidence locks, files, backup and restore |
| `docs/UX_FLOWS.md`, `DESIGN.md` | Screens, copy and visual system |
| `docs/reviews/` | Reviews and the status of every finding (`fixes.md`) |

The contract template shipped with the app is starter text, not legal advice: agencies should adapt it in Settings → Contract template.
