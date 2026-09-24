# Wave C fixes — status per finding

One line per finding in the four reviews (the review files themselves are unchanged). All areas were fixed in one pass, so this single report replaces the per-area `fixes-<area>.md` files. Checks after the last change: `npx tsc --noEmit` clean, `npx eslint app src` clean, 385 jest tests passing. Nothing was run on a phone yet: every UI change needs the on-phone test round (HANDOFF step 3).

## functional.md

- **H1** contract "View" route missing → fixed. New `app/rental/[id]/contract.tsx`: the frozen HTML with its signature, rings read back from the signed SVG, voided versions listed and marked, Share PDF, Check, Fix contract.
- **M1** flows bounce back into rental detail → fixed. Detail redirects only on arrival, then shows Continue/Resume; leaving the start flow reuses the detail underneath (`useExitStartFlow({ toRental })`).
- **M2** blank capture screen → fixed. `initialTarget` opens a skipped angle when every angle was skipped; capture never renders empty on `finish`; Condition says "Take at least one outside photo".
- **M3** voided PDFs shared as "Signed contract" → fixed. Vehicle documents label "Voided contract" and share through `ensureContractPdf` (re-rendered with the VOID mark).
- **L1** two staleness keys → fixed. `shareSignedContract` calls `shareContractPdf`; one renderer.
- **L2** details loses the last edit → fixed. Pending autosave flushes on unmount.
- **L3** Home promise chains → fixed. Rejections handled (agency check, search, history).
- **L4** stacking screens → fixed. A retake goes back to Compare; capture finishes with `dismissTo(compare)`; Edit return from the report replaces it.
- **L5** SDK patch mismatches → fixed. `npx expo install --fix` on its own commit (expo 57.0.25 and five module patches); expo-doctor 21/21.

## architecture-data.md

- **H1** rental closed with only a voided contract → fixed. Migration 2 trigger (`returned` needs a valid contract), `returnBlockers` `needs_signature`, void refused once the return inspection started (trigger + `canVoidContract`), Fix contract hidden then.
- **H2** vehicle change keeps the old car's frozen photos → fixed. Migration 2 trigger + `canChangeVehicle`: no change once anything was signed/frozen; drafts with photos ask keep/delete (`setRentalVehicle(..., { beforePhotos })`).
- **M1** draft "Repaired / gone" survives → fixed. Triggers undo it on draft delete or vehicle switch; migration 2 repairs rows left by the old behaviour.
- **M2** return retake moves rings silently → partly. The retake now warns to check the marks and returns to Compare on that angle. A persisted "needs check" flag blocking completion was not added.
- **M3** report lacks pick-up condition → fixed. Paired BEFORE | AFTER contact sheet per angle.
- **M4** two contract-PDF renderers; live agency name in header → fixed. One renderer; header uses the frozen `agency.name` variable.
- **M5** empty DB + sweep deletes everything → fixed. `isOrphanSweepSafe` refuses when the DB references nothing or orphans exceed 20 % (>10). No recovery screen was added.
- **L1** stale HTML accepted at signing → fixed. Signing re-renders in the transaction and compares every clock-independent variable.
- **L2** hash does not cover photos; verify never called → partly. Check contract re-hashes the photos the contract shows (frozen rows hold the reference hash) and is reachable from the viewer. The preimage itself was not versioned to v2.
- **L3** boot fallbacks delete other roots → fixed. A guessed root keeps the runner-up as `previous` for 14 days and nothing is deleted that boot.
- **L4** boot outcome invisible; restore log lost on crash → fixed. Boot notes shown after launch; the log row is written into the staged DB before the switch.
- **L5** restore accepts backups listing missing/damaged files → fixed by owner decision (DECISIONS Data §2 updated): files already missing/damaged on the source phone → allowed with a warning that gives their count; a corrupt file or one absent from the archive → blocked (unchanged `corrupted` / `incomplete` errors). The contradictory "complete and undamaged" copy is fixed.
- **L6** close-up phase unchecked → fixed. Repo + migration 2 trigger.
- **L7** four `useLiveQuery` hooks, entities one can go stale → partly. The entities hook ignores superseded results; the hooks were not merged.
- **L8** layering drifted from ARCHITECTURE §4 → fixed in docs (§4 rewritten, empty `src/export` removed). Not lint-enforced.

## ux.md

- **H1** contract viewer → fixed (see functional H1).
- **H2** FAB covers the last row → fixed. `Screen fabClearance` on the three tab roots.
- **H3** portrait Compare stage too small → fixed. Toggles moved to the top bar, marks list is one summary row + sheet, "Turn sideways for bigger photos" when panes are < 160 dp.
- **H4** damage sheet hides its mark → partly. Compact sheet (340/420 dp, status first at return), no scrim so the ring stays visible and can be dragged/resized, marks can't be switched under unsaved edits. No auto-pan and no landscape right-rail variant.
- **M1** customer buttons truncate → fixed. Customer buttons wrap to 2 lines; they stack when font scale > 1.3.
- **M2** sign pad in landscape → fixed. Prompt in the top bar, buttons in a column beside the pad.
- **M3** customer can't enlarge photos → fixed. Tap opens a full-screen pinch-zoom view with captions.
- **M4** marker editor has no way forward → fixed. Next photo / Done footer (Next in the top bar in landscape).
- **M5** 12 MP originals as thumbnails → fixed on rental and vehicle detail.
- **M6** start vs return capture differ → partly. One Skip control, one skip sheet (one-tap reasons), "n of 8 done" on both. The last-shot preview is still two components.
- **M7** silent reopen of a completed return → fixed. Confirm dialog on Compare, report and rental detail; the Compare primary becomes "Edit return".
- **M8** dark controls under 3:1 → fixed. `rebate.outline` is now `onRebate2`; segmented control, toggles and slider tracks use it.
- **M9** search drops status/Return → fixed.
- **M10** date stepper slow → fixed without a new dependency: ±1 week and 09:00/12:00/18:00 chips.
- **M11** ID photos unblurred, tap deletes → fixed (`ProtectedThumb`).
- **M12** landscape rail overflows → fixed (scrolls, no subtitle).
- **M13** "Mark new damage" truncates → fixed ("Mark damage").
- **M14** return stepper only on step 3 → fixed. Compare subtitle shows "Return 2 of 4".
- **M15** "Start its return" leaves an orphan draft → fixed.
- **L1** raw exception text → fixed (lists, rental detail, customer screens).
- **L2** onboarding phone without "+" → fixed.
- **L3** mileage warning styled as error → fixed (hint).
- **L4** extra tap at the end of the hand-off → fixed. Continue lands on the rental with "Rental started · Share contract".
- **L5** "Ask staff" next to Sign → fixed (after the agreement).
- **L6** two headlines → fixed.
- **L7** optional shots gate completion → fixed.
- **L8** vehicle subtitle → fixed ("Renault Clio · 2019").
- **L9** redundant settings rows → partly. Reference folded into Agency details, Try again added; the report-footer field was not moved.
- **L10** hidden hold-to-blink → fixed (one-time hint).
- **L11** zoom close ignores safe area → fixed.
- **L12** misleading "Recent" → fixed ("All vehicles").
- **L13** kicker above the picked customer → fixed.
- **L14** token bypasses → fixed.
- **L15** "· Offline" filler → fixed.

## security-ios.md

- **M1** restored contract HTML printed unchecked → fixed. `contractHtmlProblems` (allow-list of the renderer's tags/attributes + reference check) runs at signing and on restore.
- **M2** no CI offline gate → already fixed before this pass (android-apk.yml step).
- **M3** expo-image-picker on iOS unverified; stale doc → docs fixed (ARCHITECTURE §3). Device check stays for the iOS phase.
- **M4** unencrypted backups → no change (the review's assessment: warnings are the proportionate MVP answer).
- **L1** FileProvider scope → skipped (optional hardening; every share already stages a copy under `cache/`).
- **L2** untrusted SQLite parsing → no change (inherent; keep expo-sqlite current).
- **L3** iOS zip-slip unverified → deferred to the iOS phase (test with a `../` entry).
- **L4** no screenshot protection → fixed (owner approved `expo-screen-capture`). `useNoScreenshots` sets FLAG_SECURE only while the sign/hand-off screen or a screen showing customer ID photos (start-flow customer step, customer detail, new, edit) is focused; employee screens stay screenshotable. The module's detection permissions (READ_MEDIA_IMAGES, DETECT_SCREEN_CAPTURE) are blocked and CI fails if a blocked permission reaches the release APK.
- **L5** camera temp files not cleaned → fixed. Housekeeping sweeps `Camera/`, `ImagePicker/`, `ImageManipulator/` after 1 h.
