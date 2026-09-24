⚠️ DEGRADED: single-context (no sub-agent tool exposed to this reviewer; code-only review, nothing rendered)

# CarCheck — UX review (Impeccable critique + native audit)

Scope: every screen under `app/**` plus `src/ui/**`, `src/features/**`, `src/media/**`, checked against BRIEF, DECISIONS, UX_FLOWS, DESIGN.md, PRODUCT.md and the mockups in `docs/design/screens/`. The review is from source only (JSX and styles), not a running app. Any size or overflow claims below are arithmetic from the styles, so verify them on a 360×740 dp Android phone before and after each fix.

**Static detector:** I ran `detect.mjs` on `app`, `src/ui`, `src/features`, `src/media` and `docs/design/screens`. All **173 findings are in the HTML mockups**: phone-frame chrome, radii such as 32 px, and SVG path strings misread as radii. None are real. The TSX found **0** findings, because the detector's regex engine does not understand StyleSheet objects. I did a manual grep instead. Token discipline in the app code is very good: the only raw literals are ripple colours and a few overlay values (see L14).

## Heuristic scores (Nielsen, 0–4)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Honest progress on report, backup and capture. The return stepper appears only on step 3. |
| 2 | Match with the real world | 3 | Plain copy and the plate frame work well. A few raw exception messages leak into the UI. |
| 3 | User control and freedom | 3 | Autosave, ✕ exits the flow, Undo on delete. Reopening a completed return happens silently from Compare. |
| 4 | Consistency and standards | 2 | Start and return capture differ (skip sheet, Skip control, preview). Controls on the dark screens fail the 3:1 boundary rule. |
| 5 | Error prevention | 3 | Guards on completion and void. Tapping an ID photo in the start flow opens a delete prompt. |
| 6 | Recognition over recall | 3 | Orbit diagram, filmstrip and marker glyphs carry state. The hold-to-blink gesture is hidden. |
| 7 | Flexibility and efficiency | 3 | Auto-advance, one-tap pick, inline Return. The annotate screen has no "next photo". The date stepper is slow. |
| 8 | Aesthetic, minimalist | 3 | Genuinely restrained. The portrait compare screen is crowded around a small photo. |
| 9 | Error recovery | 3 | "Your photos and marks are safe" copy throughout. The contract "View" route dead-ends. |
| 10 | Help | 3 | Inline hints at the right moments. No help for gestures. |
| **Total** | | **29/40** | **Good.** The foundation is strong; the core compare and marking ergonomics need work. |

**Design specificity verdict:** clearly built for this product. The plate frame, the film edge codes, the letter/number marker shapes, the angle orbit and the photo-screen black all come from the domain. Nothing here reads as a generic SaaS template, and there is no card soup, gradient, glass or pill confetti. The weak points are ergonomic, not aesthetic.

---

## High

### H1. The contract "View" button goes to a screen that does not exist
- **Where:** Rental detail. `app/rental/[id]/index.tsx:274` pushes `crossAgent.contractViewer(id)`, which is `src/features/entities/routes.ts:32` → `/rental/[id]/contract`. There is no route file for it: `app/rental/[id]/` holds only `index`, `report`, `void`, `annotate/`, `start/` and `return/`.
- **User impact:** every active or returned rental shows a "View" action on the signed contract. Tapping it lands on expo-router's unmatched-route screen. This is the one place staff go to show a customer what they signed.
- **Fix:** add `app/rental/[id]/contract.tsx` as a read-only viewer:
  - A paper `Screen` titled "Contract", with the reference as subtitle.
  - A grey Banner with a `lock` icon: "Signed contracts can't be edited." Its quiet action is "Fix contract", which goes to `/rental/[id]/void` (active rentals only).
  - `ContractView` with `audience="employee"`, `signatureUri` set to the signed PNG, and the frozen `renderedHtml` of the valid contract.
  - Below it, a `ListSection` titled "Voided versions", one row per void showing date and reason, each opening that version.
  - An `ActionFooter` with "Share PDF" (secondary).
  - Until that exists, point "View" to `shareContractPdf` or hide it.

### H2. The FAB covers the last row's Return / Resume button
- **Where:** Rentals, Vehicles and Customers tabs. `app/(tabs)/index.tsx:127-131`, `vehicles.tsx:36-38`, `customers.tsx:113-115`. `Screen` pads the scroll content by only `24` dp when `insets.bottom` is false (`src/ui/components/Screen.tsx:171`). The FAB is 56 dp tall, sits 16 dp above the nav bar, and is anchored bottom-right (`Fab.tsx:50-55`).
- **User impact:** scrolled to the bottom, the last "Due back" or "Out" row has its inline **Return** button (trailing, right edge) under "New rental". Tapping there starts a new rental instead of the return. On the Vehicles and Customers tabs the chevron and right side of the last row are covered.
- **Fix:** add a `fabClearance` prop to `Screen`, or pass `contentStyle={{ paddingBottom: touch.fabHeight + layout.bottomActionInset * 2 }}` (88 dp) on the three tab roots. Do it in `Screen` so any future tab root gets it by default.

### H3. Portrait Compare squeezes the photos to a fraction of the screen
- **Where:** Compare, portrait. `app/rental/[id]/return/compare.tsx:501-521`. From top to bottom the screen stacks:
  - top bar (56) and mode bar (44 + 16)
  - the stage, which gets whatever height is left (`stageWrap` min 200)
  - the opacity control in Overlay mode (48)
  - toggles (40 + 12)
  - "On this angle" header and rows (up to 112 + 20)
  - filmstrip (about 70)
  - action row (52 + 16 + gesture inset)
- **User impact:** on a 360×740 dp phone with marks present, the stage gets roughly 230–260 dp. Side by side stacks two 4:3 photos, so each pane is about 120 dp tall and letterboxed to about 45% of the width. The brief's "max screen use" for the core feature fails exactly where damage is judged.
- **Fix (target: stage ≥ 60% of window height in portrait):**
  1. Move the **Markers / Existing** toggles off the body: make them two 48 dp `IconButton` toggles (`eye`, `history`) in the `TopBar` actions next to ⋮, or put them at the right end of the mode row.
  2. Replace the "On this angle" list with a single 48 dp summary row: "2 marks · New 1, Existing A ›". It opens a half-height sheet containing the current `DamageRows`.
  3. Give the stage `flex: 1` with no competing flex children. Keep the filmstrip, but at 40 dp frames.
  4. If the stacked side-by-side panes would be under 160 dp tall, show a one-line tag on the stage: "Turn sideways for bigger photos" (a `Smartphone` icon PhotoTag, the same as the capture nudge).

### H4. The damage sheet hides the mark it describes, and resizing means closing it
- **Where:** Compare and annotate. `src/features/damage/DamageSheet.tsx:65` uses fixed heights (452 at pick-up, 540 at return, +64 with a note). `BottomSheet.tsx:180-188` draws a full 48% scrim and closes on a backdrop tap.
- **User impact:**
  - In portrait Compare, the AFTER pane (the lower half, where the pin was just dropped) sits entirely under the sheet and scrim.
  - In landscape (about 360 dp tall) the sheet is clamped to near full height and covers everything.
  - The employee can't see whether the ring sits on the dent while picking the type.
  - Resizing means dismissing the sheet (which saves), dragging the ring edge, then tapping the badge again to reopen it.
  - That is 2–3 extra taps per mark, at the moment the brief budgets exactly 3 taps: pin, type, Done.
- **Fix:**
  - Give the sheet two snap points: `[248, fullHeight]`. The first shows the badge header, the damage-type grid and **Done**. Severity, status, note and close-up sit behind a drag or a "More" quiet button.
  - Give this sheet no scrim: add a `backdrop="none"` prop to BottomSheet that renders no Pressable/scrim, so touches above the sheet reach the photo. Ring drag and resize then keep working with the sheet open.
  - Before opening, call `viewport` to pan the ring into the visible area above the sheet.
  - In landscape Compare, render the sheet's content in the existing 304 dp right rail instead of as a bottom sheet.
  - When the return status is uncertain, keep the Status segmented control in the first snap, because it changes the badge.

---

## Medium

### M1. Customer buttons truncate at large font sizes
- **Where:** Sign pad footer. `src/ui/components/Button.tsx:133` sets `numberOfLines={1}`. Customer type is never capped (`tokens.ts:337-341`). `app/rental/[id]/start/sign.tsx:225-245` puts **Clear** and **Confirm signature** side by side.
- **Impact:** a customer with system font at 1.5–2× (PRODUCT.md: possibly without reading glasses) sees "Confirm sig…" on the binding button.
- **Fix:** for `size="customer"`, allow `numberOfLines={2}` and `minHeight` rather than a fixed height. In `sign.tsx`, when `useWindowDimensions().fontScale > 1.3`, drop `row` so the buttons stack, Confirm first.

### M2. The signature pad has no room in landscape
- **Where:** `sign.tsx:249-271`, with `pad: { flex: 1, minHeight: 180 }`.
- **Impact:** at about 360 dp tall, the top bar (56), headline (34), recap (48–72), fine print (40) and footer (88+) leave under 100 dp for a pad that demands 180. The content overflows under the footer. UX_FLOWS §2.5 promises that landscape gives more room.
- **Fix:** when `width > height`:
  - hide the Title L headline and fold "Sign above the line" into the top-bar title;
  - clamp the recap to one line;
  - move Clear / Confirm into a 200 dp right column beside the pad;
  - keep the fine print under the pad at `customer.fine`.

### M3. The customer can't enlarge the condition photos they are signing for
- **Where:** `src/features/contract/ContractView.tsx:65-78`. `MarkedPhoto` is not pressable. UX_FLOWS §2.5 says "tap to enlarge with markers".
- **Impact:** the customer is agreeing to damages A and B from a phone-width thumbnail.
- **Fix:** wrap `photoBlock` in `Touchable` (`accessibilityRole="imagebutton"`, hint "Opens the photo larger"). It opens a full-screen rebate modal using `MarkerEditor` with `editable={false}`, which gives pinch zoom. Use customer-size badges (30 dp), a close ✕ at the top-left inside the safe area, and a caption list below: "Existing A · Scratch, left front door".

### M4. The marker editor has no way forward, only back to the top-left
- **Where:** `app/rental/[id]/annotate/[photoId].tsx:161-254`. There is no footer.
- **Impact:** marking damage on several pick-up angles means Back (top-left, out of thumb reach) → tap the next tile → mark → Back… That adds about 2 reaches per angle, one-handed, customer waiting.
- **Fix:** add an `ActionFooter` on the rebate screen (in portrait: below the marks list; in landscape: at the bottom of the photo area) with:
  - **Next photo ›** (secondary): `router.replace(annotateHref(id, nextPhotoId))` in walk order, skipping skipped angles.
  - **Done** (primary): `router.back()`.
  - Hide Next on the last angle.

### M5. Rental and vehicle detail load 12 MP originals as thumbnails
- **Where:** `app/rental/[id]/index.tsx:236` uses `resolveFileUri(a.photo.file.path)`. `app/vehicle/[id]/index.tsx:166, 206` does the same. By contrast, `condition.tsx:208` correctly uses `usePhotoUri(view.photo, 'thumb')`.
- **Impact:** eight full-resolution decodes for about 170 dp tiles cause slow scrolling, memory pressure and possible out-of-memory crashes on the mid-range Android phones agencies use.
- **Fix:** use `usePhotoUri(photo, 'thumb')` (or `photoFileUris(photo).thumb`) in a small tile component, as the Condition grid already does.

### M6. Start and return capture behave differently for the same task
- **Where:**
  - Skip sheet. Start: tapping a reason chip skips immediately, plus "Skip without a reason" (`app/rental/[id]/start/capture.tsx:335-355`). Return: pick a chip, then press **Skip** (`src/features/evidence/return/CaptureParts.tsx:76-103`).
  - Skip control. Start uses a white bodyStrong custom `Touchable` (`start/capture.tsx:287-292`); return uses a quiet cyanotype `Button` (`CaptureParts.tsx:55`).
  - Progress. Start shows "n of 8 done" under an 84 dp orbit; return shows a 60/80 dp orbit with no count.
  - Last-shot preview. Start uses an absolute overlay where tapping anywhere means Keep; return uses a `Modal` with explicit buttons.
- **Impact:** the same employee does both halves on every rental, so muscle memory breaks and the return skip costs an extra tap.
- **Fix:** extract one `CaptureRail` and one `SkipSheet` used by both flows. Use the start pattern (one-tap reason chips plus a quiet "Skip without a reason"), white `bodyStrong` Skip with the `skip-forward` icon, and the "n of 8 done" code line. Use one `ShotPreview` component in both flows.

### M7. "Mark new damage" silently reopens a completed return
- **Where:** `compare.tsx:244-249` (`startMarking` → `reopen()`, confirmed only by a toast). The same pattern is in `report.tsx:207-216` and `app/rental/[id]/index.tsx:94-101`.
- **Impact:** a report that may already be on the customer's WhatsApp is invalidated by one tap on a button that looks like normal marking.
- **Fix:**
  - When `!editable`, replace the primary with **Edit return** (secondary, `pencil-line` icon).
  - Show a `ConfirmDialog`: "Reopen this return? / The report is rebuilt when you complete it again. Anything already shared stays as it was." with the confirm label "Reopen".
  - Use the same dialog for the ⋮ "Edit return" items.

### M8. Controls on the dark (rebate) screens fail the Sunlight Rule's 3:1 boundary
- **Where:**
  - `ToggleChip` border is `rebate.divider` #3A4044 on #0C0D0E, about 1.9:1 (`CompareParts.tsx:180`).
  - `SegmentedControl` on rebate uses `colors.divider` for its frame and dividers (`SegmentedControl.tsx:66`), so the compare-mode switch outline is nearly invisible in glare.
  - The opacity and ghost slider tracks also use `rebate.divider` (`OpacityControl.tsx:132`, `CaptureChrome.tsx:310`).
- **Impact:** DESIGN.md says "anything the user taps has a 3:1 boundary". Outdoors, the unselected segments and the "off" toggles look like plain text.
- **Fix:**
  - On rebate, use `palette.onRebate2` (#A3AAAE, about 8:1) for the outlines of interactive controls: toggle border, segmented frame and dividers.
  - Use `palette.onRebate2` at 60% for slider tracks.
  - Keep `rebateRule` for passive dividers only.
  - Consider adding a `rebate.controlOutline` role in `tokens.ts`.

### M9. Rentals search drops the status and the Return button
- **Where:** `app/(tabs)/index.tsx:187-196`. The meta line is only `item.rental.reference`, with no trailing action.
- **Impact:** typing the plate is the fastest way to find the car coming back. Results don't say whether it is Out, Due or Returned, and returning it needs detail → Start return (+1 screen, +1 tap).
- **Fix:** reuse the section renderers by status:
  - draft or in progress: `unfinishedMeta` with **Resume**;
  - active: `dueBackMeta` or "Due …" with **Return**;
  - returned: `returnedStatusLine`.
  - Keep the reference in the subtitle: "Clio · J. Smith · R-0142".

### M10. The expected-return picker moves one step per tap
- **Where:** `app/rental/[id]/start/details.tsx:244-280` has day ± and time ± steppers.
- **Impact:** any date beyond the chips (a 10-day rental) takes 8+ taps on "Later day", plus several time taps.
- **Fix:** keep the chips. Make "Pick…" open the platform date picker, then time picker (`@react-native-community/datetimepicker`, which works offline). If a new dependency isn't approved, add "+1 week" to the chips and put a time chip row (09:00 · 12:00 · 18:00 · Now) in the sheet.

### M11. ID photos in the start flow are unblurred, and tapping one asks to delete it
- **Where:** `app/rental/[id]/start/customer.tsx:358-376`. It uses a raw `Image`, and `onPress` opens the delete dialog. The customer detail screen and `CustomerForm` already use `ProtectedThumb` (blur until tapped, separate trash button).
- **Impact:** passport and licence images are shown in clear while the customer and others stand beside the phone. The natural "tap to look" gesture triggers a destructive prompt.
- **Fix:** replace the tile with `<ProtectedThumb uri=… label=… onDelete={() => setDeleting(d)} />`. Keep "Stored only on this phone."

### M12. The landscape Compare rail overflows at larger font sizes
- **Where:** `compare.tsx:66` (`RAIL_WIDTH = 304`), `484-497`. The top bar, mode switch, toggles, rows and two stacked 52 dp buttons sit in about 360 dp of height with no scroll. At font scale 1.3 the actions are pushed off-screen.
- **Fix:**
  - Wrap everything between `modeSwitch` and `railActions` in a `ScrollView`.
  - Shorten the landscape actions: primary "Mark damage", with Next as a 48 dp `IconButton` (`arrow-right`, label "Next angle").
  - Drop the subtitle in landscape; the plate is on the photo tag.

### M13. "Mark new damage" truncates on 360 dp phones
- **Where:** `compare.tsx:431-450`. The primary button is `flex: 1.35` next to Next: about 183 dp at 360 dp width. The label (15 characters at 17 sp) plus a 20 dp icon plus 40 dp padding needs about 190 dp.
- **Fix:** drop the `Plus` icon in portrait, or shorten the label to "Mark damage" (UX_FLOWS copy allows it), or stack the two buttons in the thumb zone with Next as a smaller secondary.

### M14. The return flow shows its stepper only on step 3
- **Where:** `app/rental/[id]/return/details.tsx:176` shows "3 of 4 · Details". Capture uses camera tags and Compare uses a plain `TopBar`, so steps 1–2 never show a stepper.
- **Impact:** "3 of 4" appears out of nowhere, and the step sheet lists only Inspect and Compare.
- **Fix:** either show the step in the Compare subtitle ("Return · 2 of 4 · J. Smith · AB-123") and the capture title tag, or drop the numeric stepper for the return and use `TopBar` "Return details" with ✕.

### M15. "Start its return" from the vehicle picker leaves an orphan draft and a confusing back stack
- **Where:** `app/rental/[id]/start/vehicle.tsx:208-221` pushes `/rental/<other>/return/capture` on top of the new draft's start flow.
- **Impact:** Back from that return lands on the vehicle picker of a draft nobody wanted, and the empty draft sits in "Unfinished" on the home screen.
- **Fix:** if the draft has no vehicle yet, call `discardDraft(id)`, then use `useExitStartFlow()({ toast: null, to: returnEntry(rid) })`, so the return opens from Home.

---

## Low

- **L1. Raw exception text in error states.** `app/(tabs)/index.tsx:207`, `vehicles.tsx:53`, `customers.tsx:130`, `app/rental/[id]/index.tsx:67`, `app/rental/[id]/start/contract.tsx:39`. Show a plain sentence ("Your data is safe on this phone. Try again.") and log the detail with `console.warn`. `sign.tsx:83` shows an error message to the *customer*, so use "Please hand the phone back to staff."
- **L2. The onboarding phone field can't type "+".** The phone field in `app/onboarding.tsx` uses `variant="numeric"`, which gives Android's number-pad without "+". Use `keyboardType="phone-pad"`, `autoComplete="tel"`, as `start/customer.tsx:344` does.
- **L3. A non-blocking mileage warning is styled as an error.** `return/details.tsx:243` uses `error=` (red border and error icon) for "lower than start", which reads as "can't continue". Use `hint` with an ink `TriangleAlert`: "Lower than the start (12,400 km). Check the odometer."
- **L4. An extra tap at the end of every hand-off.** `sign.tsx:277-351` goes Thanks → Continue → Success → Done. Per UX_FLOWS §2.5, Continue could land on rental detail with the snackbar "Rental started · **Share contract**", saving one tap per rental. Keep the Success screen only if sharing there tests better.
- **L5. "Something wrong? Ask staff." sits next to the Sign button.** `sign.tsx:151-154` places it 8 dp above **Sign agreement** in the customer footer, and it drops the customer into staff screens. Move it to the end of the scroll content, after the agreement text.
- **L6. Two headlines on the customer review.** The screen headline "Please review your rental" is followed by the template H1, also at `customer.headline` (`ContractView.tsx:34-40`). Map the template h1 to `customer.section` in customer mode.
- **L7. Optional shots add taps to every return.** The dashboard and extras are in the compare sequence and the "not compared" guard (`src/features/evidence/returnPlan.ts:82-84, 126-138`). This adds 1–3 Next taps per return, and an unviewed dashboard triggers the "1 angle not compared" sheet. Exclude optional pairs from `unreviewed` gating, or auto-mark them reviewed on view.
- **L8. Vehicle subtitles read as three facts.** "Renault · Clio · 2019" (`src/features/entities/display.ts:261-264`). Use "Renault Clio · 2019".
- **L9. Settings has redundant and thin entries.** "Agency details" and "Rental reference" open the same screen (`app/settings/index.tsx:44-55`). "Report info" is a static list plus one footer field. Fold the reference into the Agency row subtitle and move the report-footer field into Agency details, which leaves 5 rows. The settings error state (`index.tsx:98-100`) needs a "Try again" button.
- **L10. The hold-to-blink gesture is hidden.** Holding the photo in Overlay flips it to BEFORE, and nothing says so. On first entry to Overlay, show a one-time tag: "Hold the photo to see BEFORE".
- **L11. The dashboard zoom close button ignores the safe area.** It sits at a fixed `top: 40` (`start/details.tsx:293`). Use `insets.top + 8`.
- **L12. The vehicle picker's "Recent" header is misleading.** The list is all vehicles in repository order (`start/vehicle.tsx:114`). Sort by last rental or label it "All vehicles".
- **L13. A label-above-heading on the picked customer.** "Customer profile" sits above the name (`start/customer.tsx:270-273`), a kicker pattern the design system bans. Drop it; the "Change" action and the grey band already say this is a picked profile.
- **L14. Small token bypasses.** `PhotoTile.tsx:203` repeats `overlay.tagBackground` as a literal. `ProtectedThumb.tsx:46` uses a raw rgba scrim. `PhotoTag.tsx:49` and `settings/contract-template.tsx:368` use literal font sizes. Swap these for tokens.
- **L15. The Settings row subtitle "Version x · Offline" is filler** (`settings/index.tsx:91`). Keep only the version.

---

## Tap-count check (code vs UX_FLOWS §12)

- **Start** (existing car, walk-in customer, 8 angles, 1 existing damage, dashboard): **about 26 taps** against 25 specified. The extra tap is the Success "Done" (L4). Resizing a mark adds 2–3 taps (H4), and moving between marked photos adds 2 per angle (M4).
- **Return** (no new damage, dashboard shot): **about 23–24 taps** against 22 specified. The dashboard pair adds a Next in Compare (L7). Finding the car through search adds 2 (M9).
- **Per new damage:** 3 taps as specified when placement is right first time. Any resize adds 2–3 because the sheet covers the ring (H4).

---

## Keep: this is good (don't break it)

- **The token system and primitives:** `Text` with per-context font-scale caps, `Touchable` (ripple, iOS 0.7 press, 2 dp focus ring, 40% disabled), `slopTo48`, 1 dp rules, no `hairlineWidth`. The TSX has essentially no colour or size drift.
- **Autosave everywhere, no "are you sure":** ✕ leaves with a "Draft saved" toast, and Resume lands on the exact step and next missing angle.
- **One-tap selection:** one tap on a vehicle, or on a matching saved customer, selects and advances. Quick-create is prefilled from the search, and duplicates offer "Use existing".
- **Capture:** freeze plus auto-advance, the orbit that doubles as the angle picker, the ghost from the previous rental, and "Check the marks" after retaking a marked photo.
- **Damage markers:** shape carries status (square with letters, circle with numbers, diamond with "?"). Rows show glyph plus status word, and delete offers Undo instead of a dialog.
- **Compare:**
  - the mode switch is always visible and remembered across angles and sessions;
  - zoom is synchronised across photos;
  - swipe is disabled while zoomed, and the slider handle has priority;
  - the opacity control has Before/After snap ends and a 50% detent;
  - the filmstrip shows viewed, new-damage and missing states;
  - the one-time "approx." toast for existing damage projected onto AFTER.
- **Customer mode:**
  - a genuinely different register: agency header, uncapped 19/28 type, second person;
  - cyanotype reserved for the binding buttons;
  - Confirm stays disabled until the signature is a meaningful stroke;
  - honest "cannot be changed" copy;
  - system Back steps back one stage and never exits the flow.
- **Error and progress copy:** "Your photos and marks are safe", real report progress ("Building evidence image 2 of 3…"), and "They look the same" as the escape from the not-compared guard.
- **Empty states:** left-aligned icon, a sentence saying what will appear, and a line saying how it gets there. No illustrations.
- **The Grease Pencil Rule is honoured:** overdue uses a clock icon plus weight, and banners are ink on grey card, never red.
