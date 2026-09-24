# CarCheck — UX Flows, IA & Interaction Spec

Owner: UX/product-flow. Source of truth for behaviour: `docs/BRIEF.md`. Visual language (colour, type, iconography) lives in `DESIGN.md`; this file uses role names only (primary, destructive, new-damage, existing-damage, uncertain).

**Usage scene.** An employee stands next to a car, outdoors, phone in one hand, customer waiting. Every screen answers: *what do I do next, with my thumb, in under a second?*

**Principles that drove the decisions below**
1. **One primary action per screen**, bottom-anchored, full width, in thumb reach. Secondary actions go in the top bar or overflow.
2. **Autosave everything, confirm almost nothing.** Every tap persists. We confirm only what is destructive or legally binding. Everything else offers Undo.
3. **Flows are full-screen tasks.** Tabs disappear during Start and Return so nobody navigates away by accident. System Back always works and never loses data.
4. **Pairing is the product.** The same angle keys, order and silhouette appear in capture, marking, comparison, evidence and report.
5. **Status is never colour alone.** Existing, new and uncertain damage differ by shape and label as well as colour (outdoor glare, colour blindness).

## 1. Information architecture & navigation

**Top level: Material navigation bar, 3 tabs.** Rentals (home) · Vehicles · Customers. These are the three kinds of thing an employee looks up every day, so tabs fit. **Settings is not a tab.** It is used rarely, so it sits behind a gear icon in the top app bar of every tab root. Everything else is a stack pushed on top. Start and Return are full-screen flow stacks with the tab bar hidden. On tablets or expanded width the bar becomes a navigation rail.

**Home = Rentals tab.** When the app opens, the employee sees what needs them now, grouped in this order:
1. **Unfinished**: draft starts and returns in progress, each with one **Resume** button. Hidden when empty.
2. **Due back**: overdue first, then due today. Each row has an inline **Return** button.
3. **Out**: other active rentals, soonest due first.
4. **Returned**: the last 7 days, max 5 rows, then "All history" (a filtered list).

Search at the top matches plate, customer name and rental reference (`R-0142`). The extended FAB **New rental** sits bottom-right.

```
┌──────────────────────────────────┐
│ Rentals                       ⚙  │
│ [🔍 Plate, name or R-number    ] │
│ UNFINISHED                       │
│ AB-123-CD  Clio · J. Smith       │
│ Inspection 5 of 8        [Resume]│
│ DUE BACK                         │
│ XY-987-ZZ  Golf · M. Diaz        │
│ Overdue · was due 10:00  [Return]│
│ OUT                              │
│ KL-555-AA  Yaris · A. Chen       │
│ Due Thu 18:00            [Return]│
│                   [ + New rental]│
│ ─────────────────────────────────│
│  Rentals   Vehicles   Customers  │
└──────────────────────────────────┘
```

Row anatomy: plate (largest text, since it is what they read off the car), then model · customer, then status/due line. Tapping the row opens rental detail. Tapping Return/Resume skips straight to the flow.

### Screen inventory (expo-router)

| Route | Screen | Notes |
|---|---|---|
| `app/_layout.tsx` | Root stack | Boot gate: onboarding if no agency; blocks UI while a restore finishes |
| `app/onboarding.tsx` | Onboarding | Agency name + optional logo |
| `app/(tabs)/_layout.tsx` | Tab bar | Rentals · Vehicles · Customers |
| `app/(tabs)/index.tsx` | Rentals (home) | Sections above; search |
| `app/(tabs)/vehicles.tsx` | Vehicles list | Status: Available / Out; filter Archived |
| `app/(tabs)/customers.tsx` | Customers list | Search; filter Archived |
| `app/rental/new.tsx` | (no UI) | Creates draft rental, replaces to `start/vehicle` |
| `app/rental/[id]/index.tsx` | Rental detail | Draft → redirects to its current step |
| `app/rental/[id]/start/_layout.tsx` | Start flow shell | Stepper header, tab bar hidden |
| `app/rental/[id]/start/vehicle.tsx` | 1 Vehicle | Pick or quick-create |
| `app/rental/[id]/start/customer.tsx` | 2 Customer | Pick or inline entry |
| `app/rental/[id]/start/capture.tsx` | 3 Inspect: camera | BEFORE guided capture |
| `app/rental/[id]/start/condition.tsx` | 3 Inspect: condition | Angle grid, existing damage, known-damage carry-over |
| `app/rental/[id]/start/details.tsx` | 4 Details | Mileage, fuel, expected return, special terms |
| `app/rental/[id]/start/contract.tsx` | 5 Sign: employee review | Rendered contract |
| `app/rental/[id]/start/sign.tsx` | 5 Sign: customer view | Read → sign → thank-you (internal states) |
| `app/rental/[id]/return/_layout.tsx` | Return flow shell | Stepper header |
| `app/rental/[id]/return/capture.tsx` | 1 Inspect | AFTER capture with BEFORE ghost |
| `app/rental/[id]/return/compare.tsx` | 2 Compare | `?angle=front_left`; marking happens here |
| `app/rental/[id]/return/details.tsx` | 3 Details | Return mileage, fuel, notes, Complete |
| `app/rental/[id]/report.tsx` | 4 Report | Generation progress → report and share |
| `app/rental/[id]/annotate/[photoId].tsx` | Marker editor | BEFORE photos and extra shots |
| `app/rental/[id]/contract.tsx` | Signed contract viewer | Read-only; lists voided versions |
| `app/rental/[id]/void.tsx` | Void & re-sign | Explainer + destructive confirm |
| `app/media/[mediaId].tsx` | Full-screen viewer | Zoom, share; used everywhere |
| `app/camera.tsx` | Single-shot camera (modal) | `?purpose=closeup|id_doc|vehicle` |
| `app/vehicle/new.tsx` · `app/vehicle/[id]/index.tsx` · `app/vehicle/[id]/edit.tsx` | Vehicle | Create (modal), detail, edit |
| `app/customer/new.tsx` · `app/customer/[id]/index.tsx` · `app/customer/[id]/edit.tsx` | Customer | Create (modal), detail, edit |
| `app/settings/index.tsx` | Settings | Grouped list |
| `app/settings/agency.tsx` · `contract-template.tsx` · `report.tsx` · `backup.tsx` · `restore.tsx` · `storage.tsx` · `about.tsx` | Settings pages | See §7, §9 |

**Count: 40 route files, 35 screens.** (The root, tab and two flow `_layout`s and `new.tsx` are plumbing.)

## 2. START flow

**Stepper.** There are five steps: **Vehicle · Customer · Inspect · Details · Sign**. The header shows a close ✕, `3 of 5 · Inspect`, and a 5-segment progress bar. Tapping the title opens a sheet listing the steps. Completed steps are tappable to jump back, and the rest are disabled. Pressing ✕ just leaves; the draft is already saved, so there is no dialog. After signing, the stepper no longer exists and the rental is active.

**Order decision: Details comes after Inspect, not before.** The employee reads the odometer when they are in the car, and the optional last capture shot is the dashboard. The Details screen shows that dashboard photo next to the mileage field. Mileage is prefilled from the vehicle's last return mileage, so it is often a single glance to confirm.

**Drafts & resume.** The draft rental row is created when the employee taps New rental. Each field and photo is written the moment it is entered, and photos go straight to app storage. If the app is killed, the draft sits at the top of Home under *Unfinished*, showing its step and progress, e.g. "Inspection 5 of 8". **Resume** reopens exactly where they stopped. For capture, that means the next missing angle. Discard is in the rental detail overflow and in a row long-press: "Discard this draft? Photos taken for it will be deleted." It is destructive. Drafts never expire automatically.

### 2.1 Vehicle
```
┌──────────────────────────────────┐
│ ✕   1 of 5 · Vehicle             │
│ ▰▱▱▱▱                            │
│ [🔍 Plate, make or model       ] │
│ + Add "AB-123" as new vehicle    │  ← only when search has no exact match
│ RECENT                           │
│ AB-123-CD  Renault Clio · White  │
│ KL-555-AA  Toyota Yaris  Out·Thu │  ← disabled, shows who has it
└──────────────────────────────────┘
```
- One tap on an available vehicle selects it and advances. There is no Next button.
- An **Out** vehicle is disabled and labelled "Out · A. Chen · due Thu". Long-press offers "Start its return".
- **Quick create** opens as a bottom sheet in the flow, not a new screen. **Plate** is required and prefilled from the search. **Make**, **Model** (suggestions from existing vehicles), **Colour** and **Year** are optional. **Save & use** selects the vehicle and advances. Everything else (VIN, photo, notes) is added later in vehicle detail.

### 2.2 Customer
- One field does both jobs: **"Customer name"**, with matching profiles listed under it as you type.
  - Tapping a profile fills the rental's snapshot. It shows as a filled card with "Change".
  - Typing a new name and tapping **Next** continues with an inline customer.
- **More details (optional)** is collapsed by default. It holds phone, licence no., ID/passport no., address and notes, plus three photo buttons: **Licence**, **ID / Passport**, **Other doc**. These open `camera.tsx?purpose=id_doc`.
- **Save as customer profile** is a switch, on by default. Its last state is remembered.
- The rental always stores a snapshot of the customer. Editing the profile later never changes past rentals.

### 2.3 Inspect (capture → condition)
Guided capture is covered in §3. After the last angle, the flow lands on **Condition**:
- A 2-column grid of the angle photos in walk order. Each tile has a damage count badge; skipped angles are hatched and labelled "Skipped · Blocked".
- A **known-damage banner** appears if the vehicle has recorded damage: "This car has 3 known damages. Check they're still there." Tapping it shows known markers as dashed suggestions on the matching angle photos. Each suggestion offers **Still there** (becomes an existing-damage marker the employee can nudge) or **Repaired / gone**. **Confirm all** handles the common case in one tap.
- Tapping a tile opens the marker editor (§4).
- **+ Add photo** covers close-ups, interior and wheels.
- The primary button is **Next**, with no confirmation. Unmarked photos are fine because "no damage" is a valid answer.

### 2.4 Details
- **Start mileage** uses the numeric keypad and is prefilled from the last return mileage. The dashboard thumbnail sits beside it, and tapping it zooms.
- **Fuel** is 5 segments (E ¼ ½ ¾ F) and optional.
- **Expected return** is optional. Chips: Tomorrow · +2 days · +3 days · +1 week · Pick… The time defaults to now.
- **Special terms for this contract (optional)** is collapsed. It feeds `{{rental.terms}}`. This is the only per-rental contract text; the template body itself is never edited per rental.
- **Next.**

### 2.5 Sign: employee review → customer view
**`contract.tsx` (employee).** Shows the contract exactly as it will be signed, rendered from the template with live data. The existing-damage list appears with thumbnails. Errors, such as a missing agency name or an unknown variable, show inline with a "Fix" link. The primary button is **Hand to customer**.

**`sign.tsx` (customer view).** A deliberately different mode. There is no stepper, no ✕ and no employee actions. The header shows the agency logo and name. Text is about 1.25× body size. Copy switches to polite second person.
```
┌──────────────────────────────────┐
│ [logo] Coastline Rentals         │
│ Please review your rental        │
│ Renault Clio · AB-123-CD         │
│ ── Condition at pick-up ──       │
│ [img①②] [img③]  3 marks        │  ← tap to enlarge with markers
│ ── Agreement ──                  │
│ Lorem terms… (scrolls)           │
│ Something wrong? Ask staff.      │  ← returns to employee review
│ [        Sign agreement        ] │
└──────────────────────────────────┘
```
- **Sign agreement** opens the signature pad full-screen. It works in both orientations; landscape gives more room. The pad has a baseline, "Sign above the line", and the name and date printed under the line. **Clear** is secondary. **Confirm signature** is primary and stays disabled until there is a meaningful stroke.
- **Confirm signature is the finalize action.** It freezes the rendered contract, the signature image and the timestamp, and the rental becomes **Active**. There is no extra "Are you sure?", because the button label is the confirmation. The PDF renders in the background and retries silently if it fails.
- **Thank-you state:** "Thank you, Jane. You're all set. Please hand the phone back." A small, employee-styled **Continue** button replaces the stack with rental detail, showing the snackbar "Rental started · **Share contract**". The share action sends the signed PDF to the customer, for example on WhatsApp.
- System Back inside the customer view moves back one state (pad → read → employee review). It never exits the flow.

## 3. Guided capture

**Angle set (confirmed):** front, front_left, left, rear_left, rear, rear_right, right, front_right. That is 8 required-by-default shots taken in one continuous walk around the car. They are followed by **dashboard**, an optional 9th shot of the odometer and fuel gauge. **Extras** can be added at any time with a label (Interior · Wheel · Roof · Close-up · Other). Extras are optional, have no fixed position and pair by label on return. "Left/right" always means the vehicle's own left/right, and the diagram makes that unambiguous.

**Orientation: the 8 exterior angles are landscape-only.** This keeps pairs comparable and matches how evidence is composed. When the phone is held upright, the viewfinder shows a rotate hint and the shutter is disabled. Close-ups, the dashboard and documents allow any orientation.

```
┌───────────────────────────────────────────────────┐  (landscape)
│ ✕  FRONT LEFT · 2 of 8                   ⚡Auto   │
│                                                   │
│         ╭──────── silhouette guide ───────╮        │
│         │   (line-art of car at this      │   ( ◉ )│ ← shutter, 72dp
│         │    angle; or BEFORE ghost)      │        │
│         ╰─────────────────────────────────╯   [▢] │ ← last shot thumb
│ [top-down car ●]  Skip                    [Guide] │
└───────────────────────────────────────────────────┘
```
- **Progress diagram:** a top-down car in the corner with 8 positions around it. States are captured ✓, current (pulsing dot), skipped (hatched) and pending. Tapping it opens a larger picker so the employee can jump to any angle, for example to start at the rear when the car is against a wall.
- **Framing guide:** a line-art silhouette for each angle with a light fill and dark outline, so it stays visible in sun. The **Guide** button toggles it. When earlier photos of this vehicle exist, including on BEFORE capture, the previous photo replaces the silhouette as a ghost at 30%. This keeps framing consistent across rentals.
- **Shutter:** a haptic tick plus a 400 ms freeze-frame, then **auto-advance** to the next missing angle. There is no per-photo confirm; that alone saves 8 taps. The volume keys also trigger the shutter, for one-handed use.
- **Retake:** tapping the last-shot thumbnail opens a preview with **Retake** and **Keep**. Retake from the Condition grid works the same way. A retake replaces that angle's photo, and the old file is deleted only if it has no markers.
- **Skip:** allowed, never blocking. Tapping **Skip** shows one row of reason chips (Blocked · Too dark · Other) plus a plain **Skip** button. The reason is optional and shows in the report as "Not photographed — blocked".
- **Quality:** no automatic blur or darkness detection. Flash is Auto/On/Off. That is all.
- **Finish:** after the 8th exterior shot, the dashboard prompt reads "Dashboard (optional) — odometer & fuel" with **Take photo** and **Skip**. Then the Condition screen. At least 1 exterior photo is required to leave capture.

**RETURN capture** uses the same camera, angle order and diagram, with the BEFORE reference built in:
```
┌───────────────────────────────────────────────────┐
│ [BEFORE] ✕  REAR · 5 of 8                 ⚡Auto  │ ← corner thumb; hold = full peek
│                                              ┃▲ │
│      AFTER live view with BEFORE ghost       ┃█ │ ← vertical opacity slider,
│      at 40% over it                          ┃▼ │   right edge, thumb reach
│                                          ( ◉ )  │
│ [diagram]  Skip                   [👁 Ghost on]  │
└───────────────────────────────────────────────────┘
```
- The ghost defaults to on at 40%. The slider covers 0–80%; above that the live view becomes unusable. The **Ghost** toggle turns it on and off without losing the chosen level.
- **Corner thumbnail:** press and hold shows the BEFORE photo full-screen, and releasing returns to the viewfinder. This is the fastest way to check.
- If an angle has no BEFORE photo because it was skipped, the silhouette guide shows with the label "No pick-up photo for this angle."
- BEFORE extras are listed at the end: "Also taken at pick-up: Interior, Close-up ×2". Each has Take and Skip.

## 4. Damage marking

**Marker model.** A marker is a numbered pin with a ring whose radius shows the damage area. It is stored as normalized coordinates plus a radius on the original photo. Numbers run through the whole rental for each status group: existing 1…n from pick-up, new 1…n from return. This makes captions like "New 2 — Dent, rear bumper" unambiguous across angles.

**Interaction (same editor on every photo)**
1. **Tap** the photo to drop a pin with its ring at the default size. Pinch-zoom and one-finger pan work while zoomed, and a single tap still places a pin.
2. **Resize:** drag the ring's edge handle (the 48dp hit area goes beyond the ring). **Move:** drag the pin.
3. The **quick sheet** opens at half height as soon as the pin is dropped:
```
┌──────────────────────────────────┐
│ Damage 3                    🗑   │
│ [Scratch][Dent][Crack][Chip]     │  ← single-select, 48dp chips
│ [Scuff][Broken][Missing][Other]  │
│ Severity (optional)              │
│ [Minor] [Moderate] [Severe]      │
│ + Note      + Close-up photo     │
│ Status: [New][Uncertain][Was there]│ ← return only
│ [             Done             ] │
└──────────────────────────────────┘
```
- Type is the only input that matters. If the employee taps Done without choosing, the damage saves as "Damage (type not set)" and shows a soft badge, but nothing blocks. This is 3 taps at minimum: pin, type, Done.
- **+ Note** expands a one-line field. **+ Close-up photo** opens `camera.tsx?purpose=closeup`, which is linked to this marker and appears in its caption and in the report.
- **Edit:** tap an existing pin to reopen its sheet. **Delete:** 🗑 in the sheet, with no dialog; the snackbar offers "Damage 3 deleted · **Undo**".
- A list toggle (≡) in the editor's top bar shows all markers on this photo as rows, for anyone who prefers lists.

**Status: visual and copy (shape carries meaning, colour reinforces)**

| Status | Where set | Marker | Label / copy |
|---|---|---|---|
| Existing (pre-existing) | Every BEFORE mark; known-damage carry-over | Hollow pin, solid neutral ring | "Existing" / "Already there at pick-up" |
| New | Default for return marks | Filled pin in the new-damage role, solid ring | "New" / "New damage" |
| Uncertain | Return sheet | Filled pin with a "?" badge, dashed ring | "Uncertain" / "Not sure if new" |

"Was there" on return turns the mark into an existing damage that was missed at pick-up. It still appears in the report, under "Found at return, marked as pre-existing", so nothing is quietly erased.

## 5. Comparison screen (`return/compare.tsx`)

```
┌──────────────────────────────────┐  (portrait)
│ ←  Rear left · 4 of 8        ⋮   │
│ [Side by side|Overlay|Slider]    │ ← always visible, segmented
│ ┌──────────────────────────────┐ │
│ │ BEFORE  12 Mar 09:14         │ │
│ ├──────────────────────────────┤ │  side-by-side = stacked in portrait,
│ │ AFTER   15 Mar 17:40   ①     │ │  left|right in landscape
│ └──────────────────────────────┘ │
│ [◐ Markers] [◌ Existing]          │ ← toggles
│ [▢✓][▢✓][▢●][▢ ][▢ ][▢ ][▢ ][▢ ] │ ← filmstrip: ✓ reviewed, ● new damage
│ [Mark new damage]   [Next angle →]│
└──────────────────────────────────┘
```
- **Angle switcher:** a filmstrip of pair thumbnails in walk order, plus horizontal swipe on the image area when not zoomed. Badges: ● means has new damage, ✓ means viewed, hatched means one side is missing. Unpaired extras come after the 8 angles.
- **Mode control:** a segmented control that is never hidden, including in landscape (it moves to the top of a right-side rail). The chosen mode persists across angles and sessions.
- **Side by side:** stacked vertically in portrait, since landscape photos fill the width, and left|right in landscape. Each pane is labelled BEFORE/AFTER with its timestamp. Zoom and pan are **synchronized**: pinch either pane and both follow. Double-tap toggles 2.5× and fit.
- **Overlay:** AFTER sits on top of BEFORE. An **opacity slider** appears above the bottom bar, full width, labelled "Before" at the left end and "After" at the right. Tapping either label snaps to 0% or 100%. **Press and hold the image** to flip instantly to BEFORE, which is the fastest blink test. **Align** in the ⋮ menu is optional: it enters nudge mode (drag and pinch the AFTER layer, then Reset or Done), and the alignment is saved per pair and used by Overlay and Slider.
- **Slider:** a vertical divider with a 48dp round handle, starting at 50%. Only the handle drags the divider. Elsewhere, one finger pans when zoomed and pinch zooms both layers together.
- **Markers:** they are always attached to their own photo. New/uncertain markers live on AFTER, and existing markers on BEFORE. In Overlay and Slider, each marker draws only where its layer is visible. **Markers** toggles all markers. **Existing** also projects existing-damage rings onto AFTER as grey dashed context, which is approximate, so it is labelled "approx." at first use.
- **Mark new damage** is the prominent primary button. It puts the current mode into marking: a banner reads "Tap the damage on the AFTER photo" with a **Done** button. Taps map to AFTER coordinates in every mode. In Side by side, only the AFTER pane accepts pins, and a matching dashed ring appears live on BEFORE. The quick sheet is the same as in §4.
- **Next angle →** marks the angle as viewed and advances. On the last angle it becomes **Continue**. Unviewed angles do not block; the Details step shows "2 angles not reviewed" with a link back.
- **Landscape:** the image takes the full height. The right rail holds, top to bottom: the mode switch, toggles, and Mark/Next. The filmstrip moves into the ⋮ angle picker.

## 6. Return completion → evidence → report

**`return/details.tsx`**
- **Return mileage** is not prefilled; the start mileage is shown as a hint and the dashboard thumbnail sits alongside. If the value is below the start mileage, an inline warning appears but nothing blocks.
- **Fuel** and **Notes** are both optional.
- The summary line reads "3 new · 1 uncertain · 8 of 8 angles compared".
- The primary button is **Complete return**, with no dialog. The return can be reopened (§8), and all evidence can be regenerated.

**`report.tsx`: generating state.**
- Progress with honest steps: "Building evidence image 2 of 3…" then "Creating report PDF…". It cannot be cancelled, but it is safe: if the app is killed, generation re-runs when the rental is opened.
- On failure: "Couldn't create the report. Your photos and marks are safe." with a **Try again** button.

**Report state**
```
┌──────────────────────────────────┐
│ ←  Return report             ⋮   │
│ AB-123-CD · J. Smith · R-0142    │
│ 3 new damages · 1 uncertain      │
│ ┌──────────────────────────────┐ │
│ │ [evidence: Rear left 1,2]    │ │ ← full-width previews,
│ └──────────────────────────────┘ │   tap = viewer w/ Share
│ ┌──────────────────────────────┐ │
│ │ [evidence: Front 3]          │ │
│ └──────────────────────────────┘ │
│ [Share all images]    [Print]    │
│ [       Share report PDF       ] │
└──────────────────────────────────┘
```
- Evidence images are shown one per damaged angle, full width, in walk order. Tapping one opens `media/[id]` with zoom and **Share image**.
- **Share report PDF** (primary) is the full report, including the signed contract. **Share all images** covers the evidence images only. **Print** uses the system print dialog.
- The ⋮ menu holds: Share signed contract PDF · Export original photos (the explicit raw export) · Regenerate evidence.
- **No new damage:** the header reads "No new damage found". In place of evidence images, the screen shows a compact 8-angle before/after contact sheet (also in the PDF), and the PDF says "Returned in the same condition as at pick-up." The primary button is still **Share report PDF**, because a clean report protects the agency too.

## 7. Contract template editor (`settings/contract-template.tsx`)

- A persistent notice at the top: **"Starter template — not legal advice. Have it checked for your country before using it with customers."**
- Segmented **Edit | Preview**. In portrait they swap; on tablet or landscape they sit side by side.
- **Edit:** a plain multiline text field. The supported markdown-ish syntax is `# Heading`, `**bold**`, `- list` and a blank line for a paragraph break. **Formatting help** opens a small sheet.
- **Insert variable:** a chip bar docked above the keyboard, scrolling horizontally and grouped Agency · Customer · Vehicle · Rental · Damage · Signature. Chips show plain labels ("Customer name") and insert `{{customer.name}}` at the cursor. They are populated from the variable registry, so new variables appear automatically.
- **Preview:** renders with realistic sample data, including 2 sample damages. Unknown variables are highlighted with "Unknown field: {{foo}}". The same warning shows at the Sign step, so it cannot slip through.
- **Save** (top bar). Leaving with unsaved changes prompts "Discard changes?". **Reset to default** is in the ⋮ menu and asks for confirmation: "Replace your template with the original starter text?".
- The copy under Save reads: "Changes apply to new rentals only. Signed contracts never change." Each saved template is versioned internally.

## 8. Detail screens

**Rental detail, active.** The header shows the plate (large), the model and the rental reference, plus a status line such as "Out since Tue 09:14 · due Thu 18:00".
- The primary button is **Start return**. It becomes **Resume return** when a return is in progress.
- Sections: Customer (tap opens the profile if one exists) · Condition at pick-up (angle grid with existing count) · Contract ("Signed 12 Mar 09:31", **View**, **Share PDF**) · Details (mileage, fuel, expected return, terms).
- ⋮ menu: **Fix contract (void & re-sign)** · Cancel rental (for when the car never left; kept in history as Cancelled).

**Rental detail, completed.** The status line reads "Returned 15 Mar 17:52 · 3 new damages". The primary button is **Share report PDF**. Sections: Report (open), Evidence strip, Compare (opens `compare` read-only; tapping Mark reopens the return), Pick-up and return details, Contract. ⋮ menu: **Edit return**. This reopens the return; evidence and report regenerate, and the report footer shows "Revised 16 Mar".

**Vehicle detail.** The vehicle photo, or the latest front-left photo, with plate, make/model/year/colour and last known mileage.
- **Status:** Available / Out (links to the rental).
- **Known damage:** the current list across rentals, each with thumbnail, type, date found and "Mark repaired".
- **History:** rentals newest first, each with dates, customer and new-damage count.
- **Documents:** contracts and reports.
- ⋮ menu: Edit · Archive.

**Customer detail.** Name, contact details and licence/ID numbers.
- **ID documents:** thumbnails blurred until tapped, marked "Stored only on this phone".
- Notes, then rentals history.
- ⋮ menu: Edit · Archive · Delete ID photos. Rentals keep their own snapshot.

## 9. Backup & restore

**`settings/backup.tsx`**
- **Status line:** "Last backup: 20 Sep, 1.2 GB" or "Never backed up". If there are more than 7 days of changes since the last backup, a quiet banner on Home reads "Back up your data — last backup 9 days ago", with Back up and Dismiss for 7 days.
- **Create backup:** a progress screen with honest steps: Saving records → Copying photos 234 / 1,120 → Checking backup. **Cancel** is available until it completes.
- **Done:** "Backup ready · 1.2 GB · CarCheck-2026-09-24-1402.carcheck".
  - **Save to folder…** (primary) uses the system folder picker, which covers Downloads, a USB drive or the SD card.
  - **Share…** opens the share sheet for Drive, email and similar.
  - Copy: "Keep this file somewhere other than this phone. It contains customer ID photos — store it safely." The temp copy is deleted after it is saved or shared, or on the next app start.

**`settings/restore.tsx`**
1. **Choose backup file** opens the system file picker.
2. **Checking backup…** validates the whole archive (manifest, version, checksums) before touching live data.
3. **Metadata card:** created date, CarCheck version, agency name, counts (rentals, vehicles, customers, photos) and size.
4. **Replace all data** (destructive button). The dialog reads: "Replace everything on this phone with this backup? Current rentals, photos and settings will be deleted. This can't be undone." Actions: **Back up current data first** · **Replace data** (destructive) · Cancel.
5. **Progress:** it cannot be cancelled once the swap starts. Restore unpacks into staging and swaps only when complete.
6. **Result:** "Restore complete — 142 rentals, 38 vehicles" with **Open CarCheck**, which reloads to Home.

**Restore errors** (all state that current data is untouched)
- Damaged file: "This backup file is damaged or incomplete. Nothing was changed."
- Newer version: "This backup was made with a newer version of CarCheck. Update the app, then try again."
- Not a backup: "This isn't a CarCheck backup file."
- No space: "Not enough space. The restore needs 2.3 GB; 1.1 GB is free."
- Interrupted swap: on next launch the boot gate finishes or rolls back automatically, then shows the result.

## 10. Edge cases & states

| Situation | Behaviour & copy |
|---|---|
| First launch | One screen: "Welcome to CarCheck" · **Agency name** ("Shown on contracts and reports") · **Add logo** (optional, from gallery) · **Get started**. Nothing else. |
| Home empty | "No rentals yet. When a customer picks up a car, tap **New rental** — CarCheck walks you through photos, damage and signature." FAB visible. |
| Vehicles / Customers empty | "Cars you add appear here. You can also add one while starting a rental." Customers: "Customers you save appear here. Saving is optional." |
| Camera permission | Full-screen in the camera: "CarCheck needs the camera to photograph the car." **Allow camera**. Permanently denied: **Open settings**. The draft is kept. |
| Low storage | Checked when entering capture. Under 500 MB: an inline banner "Storage is getting low (320 MB free)". Under 100 MB: shutter disabled, "Phone storage is full. Free up space to keep taking photos. Photos already taken are safe." |
| App killed mid-capture | Every shot is already on disk. Resume lands on the next missing angle, and the diagram shows what is done. |
| App killed mid-sign | Unsigned: resume at employee review. A signature counts only after Confirm, and saving it is atomic (all or nothing). |
| Fix after signing | Contract view banner: "Signed contracts can't be edited." The ⋮ menu has **Fix contract**. The void screen reads: "Void this contract and have the customer sign a corrected one? The voided contract is kept on record." Then **Void & re-sign**, which goes through Details → Sign. The rental shows "Needs signature" until re-signed. The report includes the valid contract and lists voided versions. |
| Add existing damage after signing | The marker editor on BEFORE photos is read-only after signing: "Pick-up damage is part of the signed contract. Void & re-sign to change it, or mark it as Uncertain at return." |
| Vehicle with history | **Archive** instead of Delete: "Archived cars are hidden from new rentals. Their history and reports stay." Delete appears only for vehicles that have never been rented. Customers work the same way. |
| Vehicle already out | Not selectable in Start (§2.1). |
| Evidence gen fails | Report error state (§6). The rental is still Completed and a retry is available. |
| Two returns / double tap | Primary buttons disable while in progress, and routes are idempotent: Start return on a rental with a return in progress resumes it. |

Loading uses skeleton rows in lists and never a central spinner over content. The only full progress screens are the long jobs: evidence generation, backup and restore.

## 11. Copy

**Employee tone:** short, imperative, verbs on buttons, no jargon ("inspection" is fine; "phase", "annotation" and "entity" are not). **Customer tone:** polite, complete sentences, second person, no internal terms.

| Where | Copy |
|---|---|
| FAB / flow titles | New rental · Vehicle · Customer · Inspect · Details · Sign |
| Capture | FRONT LEFT · 2 of 8 · Skip · Guide · "Turn your phone sideways" · "Dashboard (optional) — odometer & fuel" |
| Condition | "Tap a photo to mark damage" · "This car has 3 known damages. Check they're still there." · Still there · Repaired / gone · Confirm all |
| Marker sheet | Damage 3 · Severity (optional) · + Note · + Close-up photo · Done |
| Hand-off | Hand to customer · (customer) "Please review your rental" · Sign agreement · "Sign above the line" · Clear · Confirm signature · "Thank you, Jane. You're all set. Please hand the phone back." |
| Snackbars | "Rental started · Share contract" · "Damage 3 deleted · Undo" · "Draft saved" (on ✕) |
| Return | Start return · Mark new damage · Next angle · "Tap the damage on the AFTER photo" · Complete return |
| Report | "No new damage found" · Share report PDF · Share all images · Print |
| Labels | BEFORE / AFTER (images) · Existing / New / Uncertain (damage) · Out / Available / Archived |

Dates use the device locale and relative forms where helpful ("Today 17:40", "Overdue · was due 10:00").

## 12. Friction audit (happy paths)

**Start.** Existing car, walk-in customer, 8 angles, 1 existing damage, dashboard shot.

| Step | Taps | Typing |
|---|---|---|
| New rental | 1 | |
| Pick vehicle (auto-advance) | 1 | |
| Customer name → Next | 1 | name |
| 8 angles + dashboard | 9 shutter + 1 "Take photo" | |
| Condition: tile → pin → type → Done → back → Next | 6 | |
| Details: mileage prefilled, "Tomorrow" chip, Next | 2 | (mileage if changed) |
| Hand to customer · Sign agreement · Confirm signature · Continue | 4 | signature |
| **Total** | **25 (15 excluding shutters)** | 1 field + signature |

With no existing damage, the Condition step is 1 tap (Next), for a total of 20. With 3 known damages carried over, the damage work is 2 taps (banner → Confirm all).

**Return.** No new damage, 8 angles, dashboard.

| Step | Taps |
|---|---|
| Inline **Return** on Home row | 1 |
| 8 angles + dashboard | 10 |
| Compare: Next angle ×7, Continue ×1 | 8 |
| Details: fuel chip, Complete return | 2 (+ mileage typing) |
| Share report PDF | 1 |
| **Total** | **22 (12 excluding shutters)** |

Each new damage adds 3 taps: Mark new damage, then pin, type and Done in one pass. A second pin on the same angle adds only pin, type and Done.

**Confirmations removed:** per-photo accept, step "Next are you sure", leaving the flow (autosave), deleting a marker (Undo instead), completing a return (reopenable), skipping an angle (inline chips, no dialog), and choosing a vehicle or customer (auto-advance).

**Confirmations kept, because they are destructive or binding:** Confirm signature (the button is the confirmation), Discard draft, Void contract, Reset template, Replace data on restore, Discard unsaved template changes.

## Open decisions for the orchestrator

1. **Landscape-only exterior capture.** Recommended for pairing quality, but it costs one-handed comfort. Confirm.
2. **Return sign-off by the customer.** The brief does not require it. An optional "Customer signs the return report" step could be added before Complete return. Default is not included.
3. **"Share all images"** needs multi-file sharing. `expo-sharing` handles one file only, so this needs `react-native-share` or a zip fallback.
4. **Backup "Save to folder"** relies on Android SAF (the system folder picker); iOS will use the share sheet or Files. Very large backups (GBs) need streaming zip. Engineering should confirm feasibility.
5. **Overlay "Align"** (nudge) is specified as optional. It can ship in a later pass without changing the layout.
