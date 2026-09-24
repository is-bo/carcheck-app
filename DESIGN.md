---
name: CarCheck
description: Offline vehicle-condition evidence tool. Photos are frames, metadata is edge code, damage is grease pencil.
colors:
  ink: "#131517"
  ink-secondary: "#454B50"
  ink-tertiary: "#646B70"
  paper: "#FFFFFF"
  grey-card: "#F1F2F2"
  grey-card-pressed: "#E4E7E8"
  rule: "#D3D7D9"
  outline: "#8A9196"
  cyanotype: "#1F4E96"
  cyanotype-pressed: "#173B72"
  cyanotype-wash: "#E9EEF6"
  cyanotype-on-rebate: "#7FA6E6"
  vermilion-new: "#C8321B"
  vermilion-wash: "#FBEAE7"
  amber-uncertain: "#F0A81C"
  amber-ink: "#9A5B00"
  error: "#B42318"
  rebate: "#0C0D0E"
  rebate-raised: "#1A1D1F"
  rebate-pressed: "#2A2E31"
  rebate-rule: "#3A4044"
  on-rebate: "#F4F5F5"
  on-rebate-secondary: "#A3AAAE"
typography:
  headline:
    fontFamily: "Barlow, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "30px"
    letterSpacing: "-0.2px"
  title:
    fontFamily: "Barlow, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "Barlow, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  plate:
    fontFamily: "Barlow, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "0.9px"
    fontFeature: "\"tnum\" 1, \"zero\" 1"
  code:
    fontFamily: "Barlow Semi Condensed, Barlow, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0.7px"
    fontFeature: "\"tnum\" 1, \"zero\" 1"
  customer-body:
    fontFamily: "Barlow, sans-serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: "28px"
rounded:
  photo: "2px"
  plate: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  fab: "14px"
  sheet: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: "52px"
    padding: "0 20px"
  button-accent:
    backgroundColor: "{colors.cyanotype}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: "56px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "52px"
  button-tonal:
    backgroundColor: "{colors.cyanotype-wash}"
    textColor: "{colors.cyanotype}"
    rounded: "{rounded.md}"
    height: "40px"
  chip-damage-type:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "48px"
  chip-damage-type-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    height: "48px"
  search-field:
    backgroundColor: "{colors.grey-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "48px"
  fab-extended:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.fab}"
    height: "56px"
  plate-frame:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.plate}"
    padding: "2px 6px 1px"
---

# Design System: CarCheck

Tokens in code: `src/ui/theme/tokens.ts` (typed, no dependencies). Reference renders: `docs/design/mockups.html` and one file per screen in `docs/design/screens/`. Behaviour and flows: `docs/UX_FLOWS.md`. This file owns only the visual language.

## Overview

**Creative North Star: "The Contact Sheet"**

CarCheck is the contact sheet an inspector keeps. On a photographer's contact sheet every frame sits in black film rebate with its number and date printed along the edge, and the photographer circles what matters in grease pencil. CarCheck works the same way. The car photo is the frame, and the angle, phase and timestamp are the edge code. Damage marks are the grease pencil: the only saturated colour in the product, and one shape per damage status. Everything else is ink on white paper, set in a sign-painter's grotesque drawn from licence plates and highway signs.

The system is built for a lot employee in bright sun, one hand on the phone, customer waiting. List and form screens are white paper with near-black ink for maximum outdoor contrast. Screens where a photo is the subject switch to rebate black, so the photo carries the light. Chrome is thin: 1 dp rules, grey-card bands for grouping, radii no larger than 6 dp on controls. There are no cards, gradients, glass, glows or stat tiles. The one expressive object is the licence plate frame, because the plate is what staff actually read off the car.

This is an Operate-mode tool. Brand shows up in precise details: tabular numerals, the plate frame, the edge code, and the marker shapes. It never shows up as decoration.

**Key characteristics**
- Ink on white for everything the employee reads; rebate black wherever a photo is the subject.
- One accent (cyanotype blue) for selection, progress and the customer's binding action. Primary actions are ink.
- Colour in the UI almost always means damage. Damage status is carried by shape first, colour second.
- One family (Barlow), with its semi-condensed cut for edge codes only.
- Hairlines and bands, never cards. Flat, except for what physically floats (FAB, sheet, slider handle).

## Colors

The palette is a restrained neutral field with one working accent and three damage inks.

### Primary
- **Ink** (#131517): all primary text; the fill of primary buttons, the FAB and selected chips; section rules on document screens; plate frames. 18.3:1 on white.
- **Cyanotype** (#1F4E96): the single accent, named for the blueprint process. It is used for the selected tab indicator, progress (the current angle), focus rings, tonal Resume buttons, quiet text buttons, and the customer's binding buttons (Sign agreement, Confirm signature). 8.1:1 on white. On rebate it becomes **Cyanotype on rebate** (#7FA6E6).

### Damage inks (semantic, never decorative)
- **Vermilion** (#C8321B): new damage only. It is the filled circle badge, the ring on AFTER and the dashed reference ring on BEFORE. White text on it is 5.35:1.
- **Amber** (#F0A81C): uncertain damage fill, always with an ink border and ink text (9:1). **Amber ink** (#9A5B00) is the text form, 5.4:1 on white.
- **Existing damage** uses ink and white: a hollow white square badge with an ink border, and a white ring with an ink halo. It is neutral on purpose, because existing damage is on record and is not a claim.

### Neutral
- **Paper** (#FFFFFF): screen background, sheets, evidence and PDF pages.
- **Grey card** (#F1F2F2): grouping bands (the Unfinished section), search field and signature pad. It is named after the photographer's 18% grey card, which also tints the second neutral layer.
- **Grey card pressed** (#E4E7E8): pressed rows, and dividers inside a grey-card band.
- **Ink secondary** (#454B50): second lines, helper text. 8.8:1.
- **Ink tertiary** (#646B70): placeholders, counts, metadata. 5.4:1 on white, 4.8:1 on grey card. Never use it for something the user must read to act.
- **Rule** (#D3D7D9): 1 dp row dividers.
- **Outline** (#8A9196): borders of chips, fields and outlined controls (3.2:1 non-text contrast).
- **Error** (#B42318): form and system errors, always with an icon and a sentence.

### Rebate (photo screens)
- **Rebate** (#0C0D0E) background; **Rebate raised** (#1A1D1F) panels; **Rebate pressed** (#2A2E31) selected toggles; **Rebate rule** (#3A4044) dividers and outlines; **On rebate** (#F4F5F5) text (17.8:1); **On rebate secondary** (#A3AAAE) edge codes and metadata (8.3:1).

### Named rules
**The Grease Pencil Rule.** Saturated red and amber appear only on damage marks and their glyphs in lists and captions. Overdue rentals, errors and warnings use ink weight and icons, never vermilion fills, so a red dot always means new damage.

**The One Accent Rule.** Cyanotype marks where you are and the one action that binds someone. It is never a background for decoration, never a second primary on the same screen.

**The Sunlight Rule.** Primary text is AAA (7:1 or more). Anything the user taps has a 3:1 boundary or a filled background. Do not use `StyleSheet.hairlineWidth` for dividers, because it disappears in sun. Use 1 dp.

### Dark mode
Only the rebate scheme is specified. Camera, the marker editor photo area, comparison and the full-screen viewer always use it, whatever the system setting. A full dark theme for list, form and customer screens is **deferred**: the app ships `userInterfaceStyle: light`. Do not auto-invert.

## Typography

**UI font:** Barlow (400, 500, 600, 700), via `@expo-google-fonts/barlow`.
**Edge-code font:** Barlow Semi Condensed (500, 600), via `@expo-google-fonts/barlow-semi-condensed`.

**Character:** Barlow is a low-contrast grotesque modelled on California licence plates, highway signs and transit lettering. It reads at arm's length in glare, its figures are open, and it ships tabular figures (`tnum`) and a slashed zero (`zero`). Plates and mileage therefore line up, and O never reads as 0. The semi-condensed cut is the film edge code: small, uppercase, tracked, and only ever attached to a photo.

On Android, weight lives in the family name (`Barlow_600SemiBold`). Never combine a custom `fontFamily` with `fontWeight`. Use `fontVariant: ['tabular-nums']` for all numbers that align. Slashed zero is applied in HTML (evidence, PDF) via `font-feature-settings`; in React Native it is not exposed, which is acceptable.

### Hierarchy (employee, ratio about 1.2, sp)
- **Headline** (600, 24/30, -0.2): tab-root titles ("Rentals").
- **Title L** (600, 20/26): sheet titles ("Damage 2"), rental detail header.
- **Title M** (600, 18/22): top bar titles, stepper title.
- **Title S / Button large** (600, 17/22): primary buttons, the FAB.
- **Body** (400, 16/22) and **Body strong** (600, 16/22).
- **Body small** (400, 15/20): second and third lines of rows.
- **Label** (600, 15/20): list section headers ("Due back", sentence case), field labels.
- **Plate** (600, 18/20, +0.9 tracking, tabular) inside the plate frame; the largest text on a rental row. **Plate small** (600, 14/16) in subtitles and evidence meta.
- **Numeric** (500, 16/22, tabular); **Numeric large** (600, 28/34) for the mileage field.
- **Code** (Semi Condensed 500, 12/16, +0.7, uppercase, tabular): edge codes under or on photos, e.g. `LEFT · 3/8 · PICK-UP · 24 SEP 2026 10:04`.

### Customer hand-off (about 1.25x)
- Headline 28/34, section 21/26 with a 1.5 dp ink rule beneath, body 19/28, list 18/24, fine print 15/20, button 18. Customer text is never capped by `maxFontSizeMultiplier`. Employee chrome caps at 1.3, body at 2.0.

### Named rules
**The No-Eyebrow Rule.** Section headers are sentence-case Label, never tracked caps above a heading. Uppercase is reserved for edge codes and the BEFORE / AFTER image labels.

**The Edge-Code Rule.** Semi-condensed caps belong to photos: under a frame, in a rebate band, on an overlay tag. If it isn't describing a photo, it isn't an edge code.

## Layout

- **Gutter:** 16 dp (employee), 20 dp (customer). Spacing scale 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Lists:** full-bleed rows with a 1 dp rule inset 16 dp from the left. Section headers have 22 dp above them and 6 dp below. Grouping is by band (grey card) or by rule, never by card. Rental rows: plate frame, then model · customer (Body small, ink secondary), then status line, with an inline 40 dp outlined **Return** or tonal **Resume** button on the right.
- **Thumb zone:** exactly one primary action per screen, bottom-anchored. On tab roots it is the extended FAB (bottom-right, 16 dp above the nav bar). In flows it is a full-width 52 dp button, 16 dp from the bottom inset. Secondary actions sit in the top bar or beside the primary as an outlined button.
- **Navigation:** Material navigation bar with 3 tabs (Rentals, Vehicles, Customers) and a 56×32 indicator in cyanotype wash. On expanded widths it becomes a navigation rail. Settings is a 48 dp gear in the top app bar of each tab root. Flows hide the bar.
- **Stepper (Start, Return):** top bar with ✕, `3 of 5 · Inspect` (Title M) and a 5-segment bar underneath. Segments are 4 dp tall with 2 dp gaps: ink when done, cyanotype when current, rule when pending.
- **Safe areas:** edge-to-edge with insets on both platforms. Nothing sits under the gesture bar, notch or camera cutout.
- **Tablets:** comparison and evidence preview go side by side. Everything else uses a 600 dp max content column.

## Elevation & Depth

The system is flat. Depth comes from tone (paper, then grey card, then grey card pressed; rebate, then raised, then pressed) and from 1 dp rules. Shadows exist only on the three things that physically float over content:

- **FAB:** `0 6 12 rgba(19,21,23,.30)`, Android elevation 6.
- **Bottom sheet:** `0 -4 16 rgba(0,0,0,.22)`, elevation 12, with 14 dp top corners and a 36×4 handle in outline grey.
- **Slider handle and loupe:** `0 2 6 rgba(0,0,0,.40)`, over photos only.

**The Flat Paper Rule.** If it doesn't float over something, it doesn't cast a shadow. Tinted cards, nested cards and shadowed list rows are banned.

## Shapes

- Photos and thumbnails: 2 dp radius. Photos are documents, so they are not softened.
- Plate frame: 3 dp radius, 1.5 dp ink border, white fill. It is always used around a plate, and only around a plate.
- Chips: 4 dp. Buttons, fields, segmented controls, toggles, overlay tags: 6 dp (tags 3 dp).
- Nav indicator 8 dp; FAB and sheet 14 dp.
- Circles only where the object is round: shutter, marker ring, new-damage badge, slider handle, icon-button press state.
- Line weights: 1 dp dividers, 1.5 dp controls and section rules, 2 dp evidence header rule, 3 dp marker ring core.

## Components

Every interactive component defines: default, pressed (ripple on Android, opacity 0.7 on iOS), focused (2 dp cyanotype ring, 2 dp offset), disabled (40% opacity, no ripple, still readable), loading (inline 16 dp spinner replacing the icon, label kept, button disabled), and error where applicable. Every touch target is at least 48×48 dp with 8 dp spacing.

- **Buttons.** *Primary*: ink fill, white label, 52 dp; on rebate it inverts (on-rebate fill, ink label). *Accent*: cyanotype fill, reserved for binding customer actions (56 dp). *Secondary*: 1.5 dp ink outline, ink label. *Tonal*: cyanotype wash with cyanotype label (Resume). *Quiet*: cyanotype text with a leading icon (+ Note, + Close-up photo). *Destructive*: text or outline in error red with the trash icon. Destructive confirmations use a Material dialog whose destructive button is error-filled. Labels are verbs.
- **List row.** It has three lines (plate, description, status) and a trailing action. Overdue: clock icon plus ink 600 text ("Overdue · was due 11:30"), with no red. Unfinished rows sit in a grey-card band and carry an 8-tick progress (10×4 dp ticks, ink when done). Loading uses skeleton rows (grey card blocks at real text sizes), never a spinner.
- **Segmented control.** 44 dp, 1.5 dp outline, 6 dp radius. The selected segment is filled with ink (on rebate: on-rebate fill, ink text). It is used for the compare modes, severity, fuel and Edit | Preview.
- **Search / text field.** 48 dp, grey card fill, 6 dp radius, no border at rest. Focus adds a 1.5 dp cyanotype border. Error adds a 1.5 dp error border, an error icon and a message below in Body small. Label above in Label style; placeholder in ink tertiary. Mileage uses Numeric large with the unit ("km") as a suffix.
- **Damage-type chips.** A 4-column grid of 48 dp tiles, 4 dp radius, 1.5 dp outline border. Selected: ink fill, white 600 label and a leading check. Single-select. They are rectangular tiles like a form's tick grid, never pill confetti. Date chips (Tomorrow, +2 days) use the same component in a single row.
- **Bottom sheet.** Paper, even over rebate screens. Half height by default; the handle and a swipe-down gesture dismiss it. The header row has the status badge, Title L and a trailing trash icon button. The primary action is pinned at the bottom.
- **Marker badge and ring.** See *Damage markers* below.
- **Angle orbit.** A top-down car (nose up, the car's left on screen-left) with 8 arc segments on a ring, in walk order. Captured: ink / on-rebate. Current: cyanotype, with a camera dot outside the ring where the photographer stands. Skipped: dashed. Pending: rule / rebate rule. On compare, a segment with new damage turns vermilion. The same diagram appears in capture (88 to 96 dp), the angle picker sheet (240 dp), rental detail and the evidence report.
- **Angle capture tile (Condition grid).** A 4:3 photo at 2 dp radius with an edge-code caption beneath (`FRONT LEFT · 2 MARKS`). Existing count glyphs sit top-right. Skipped tiles are hatched grey card with "Skipped · Blocked". Tap opens the marker editor.
- **Plate frame.** See Shapes. Plate small inside subtitles and evidence meta.
- **Empty state.** Left-aligned, not centered art. A 48 dp outline icon in ink tertiary, one Title M sentence saying what will appear here, one Body line saying how it gets there, and the relevant action. Example: "No rentals yet." / "When a customer picks up a car, tap New rental." No illustrations.
- **Snackbar.** A Material snackbar in ink with white text and a cyanotype-on-rebate action ("Damage 3 deleted · Undo"). It sits bottom, above the FAB or primary button, for 4 s (8 s with an action). This is the only toast pattern.
- **Banner (inline).** A grey-card band with a leading icon, one sentence and an optional quiet action. Used for low storage, the known-damage carry-over and "Back up your data".

## Damage markers

Shape carries status, colour reinforces it, and the label names it. This must survive glare, colour blindness and a black-and-white office printer.

| Status | Badge | Ring on its own photo | Reference ring elsewhere | Label |
|---|---|---|---|---|
| Existing | Hollow **square**, white fill, 2.5 dp ink border, ink letter | White core 3 dp over ink halo 6 dp | Grey dashed ring on AFTER ("approx.") | Existing |
| New | Filled **circle**, vermilion, 2.5 dp white border, white number | Vermilion core 3 dp over white halo 6 dp | **Dashed** vermilion ring + hollow dashed badge on BEFORE | New |
| Uncertain | Filled **diamond**, amber, ink border, ink number with "?" (e.g. `2?`) | Amber core 3 dp over ink halo 6 dp | Same as new | Uncertain |

- **Letters vs numbers.** Existing (pre-rental) damage is labelled with letters in one A, B, C… sequence, because it is on record before the rental starts and is not being counted against this hand-off. New and uncertain damage share a single 1, 2, 3… sequence across both statuses, in the order they are marked, because both are claims the inspector is raising on this angle. A dashed reference badge always repeats the letter or number of the mark it points to.
- **Dashed means reference.** A dashed ring always means "the corresponding area on the other photo", never a status. The UX spec suggested a dashed ring for uncertain; here uncertain is carried by the diamond and "?" instead, so "dashed" keeps one meaning across screen, evidence and print.
- The badge sits on the ring at 45° upper-right, so it never covers the damage. Drag the badge to move; drag the ring edge to resize (48 dp hit slop).
- Markers keep a **constant screen size** (badge 26 dp; 30 dp in customer mode; at least 22 dp on thumbnails) at any zoom. Only the ring radius scales with the photo.
- The halo pairs (white under colour, ink under white or amber) make every mark readable on white, silver, black and red paint.
- While a pin is dragged, a 104 dp **loupe** at 2.4× shows the area under the finger with a crosshair, offset up and left of the touch point (mirrored near the left edge).
- In lists and captions the same shapes appear as 22 to 28 dp glyphs, followed by the status word and letter or number: "New 1 · Dent, left rear door" or "Existing A · Scratch, left front door".

## Camera & comparison chrome

- **Rebate, not glass.** Controls sit on solid rebate rails beside the frame. Overlays on the photo are limited to corner registration marks, the centre registration cross, the framing guide and 78% rebate tags. No blur.
- **Capture (landscape exterior angles):** left rail holds ✕, the orbit and Skip; the frame is exactly the 4:3 capture; the right rail holds flash (Auto / On / Off), the Guide toggle, an 80 dp shutter under the right thumb, and the last-shot thumbnail with its angle code. The title tag at the top centre of the frame reads `LEFT  3 of 8 · Before` plus a one-line instruction. The framing guide is a line-art silhouette: a 2 dp white stroke over a 4.5 dp rebate halo, with 12% white fill. Portrait shows the rotate hint and a disabled shutter.
- **Return capture:** the BEFORE ghost is the photo itself at 40% (0 to 80%), controlled by a vertical slider on the right edge. The BEFORE corner thumbnail shows the full photo on press-and-hold.
- **Shutter feedback:** haptic tick, then a 400 ms freeze-frame, with the frame edges flashing on-rebate for 120 ms. Then the orbit segment fills (200 ms) and the view auto-advances.
- **Comparison:** the top bar reads angle · n of 8, with the customer and plate as subtitle. The segmented mode control (Side by side | Overlay | Slider) is always visible directly under it. The image comes next with BEFORE / AFTER tags (label in Barlow 700 caps plus an edge-code timestamp). The slider divider is a 2 dp white line with a 48 dp white handle. Below the image: the Markers / Existing toggles, then the "On this angle" rows. Above the actions sits the filmstrip: 8 thumbnails with a tick for viewed, a vermilion dot for new damage, a cyanotype outline for current, and hatching when one side is missing. At the bottom: **Mark new damage** (primary, inverted) and **Next angle →** (secondary). In landscape these move to a right rail.

## Customer hand-off mode

- A different register on the same system. The stepper and employee actions disappear. The header shows the agency logo (or an ink monogram tile when no logo has been set) with the agency name and branch. Customer type scale applies. Copy is polite second person.
- **Review:** headline, vehicle line with plate frame, dates, "Condition at pick-up" (1.5 dp ink rule; thumbnails with constant-size markers; a list with square glyphs), "Agreement" text at body 19/28, "Something wrong? Ask staff." as a quiet link, and **Sign agreement** (accent, 56 dp).
- **Signature pad:** full-screen. It carries a one-sentence recap of what is being signed. The pad is a grey-card surface with a 1.5 dp ink baseline and a "×" start mark, and the signer's name and date are printed under the line. Ink stroke is 3.2 dp with round caps. Below the pad: "Once you confirm, the agreement and your signature are saved as they are and cannot be changed." Actions: **Clear** (secondary, rotate icon) and **Confirm signature** (accent), which stays disabled until there is a meaningful stroke.
- **Thank-you:** ink check at 48 dp, Headline "Thank you, Tomás. You're all set.", body "Please hand the phone back.", and a small employee-styled **Continue**.

## Evidence image & print

Exports carry the same identity, so a WhatsApp image, a printout and the app read as one system.

- **Evidence image** (per damaged angle): 3000×2000 JPEG at q85, white ground, 80 px margin.
  - **Header:** angle name (Barlow 700, 100 px); a meta line with status summary, vehicle, plate frame, rental reference and customer; agency name, branch and "Evidence n of m" right-aligned; then a 2 dp-equivalent ink rule.
  - **Photos:** BEFORE (outlined caps label) and AFTER (solid ink label) side by side. Each has its phase and full date beside the label. Each photo sits in a thin rebate frame with an edge-code band beneath (`LEFT · 3/8 · AFTER · 24.09.2026 17:05:32`).
  - **Markers:** as the table above. AFTER shows new and uncertain marks; BEFORE shows existing marks plus dashed references.
  - **Captions:** one per mark, glyph first, bold "New 1 · Dent, left rear door." or "Existing A · Scratch, left front door." then plain detail.
  - **Footer:** shape legend (New, Same area before, Existing, Uncertain), then `CARCHECK · R-0418 · GENERATED … · ORIGINAL PHOTOS UNMODIFIED` in edge code.
  - It must read correctly in greyscale. Check every export in greyscale during development.
- **PDF (contract and report)** via `expo-print`: A4, 16 mm margins, Barlow embedded as base64 `@font-face` (the app is offline, so no web font links). Body 10.5/15 pt, H1 20 pt, H2 13 pt with a 0.5 pt outline-grey rule. Tables use 0.5 pt rules, no fills. A running header carries agency and reference, and the footer carries page n/m and the generated timestamp. Evidence images are full text width, one per page section. The signed contract block reproduces the frozen render, the signature image on its baseline, name, and the timestamp with timezone. A voided contract gets a diagonal "VOID" in outline grey and stays legible.
- The composition should be rendered with `@shopify/react-native-skia` (already installed) off-screen, using the same tokens (`evidence.*` in tokens.ts).

## Iconography

- **Lucide** via `lucide-react-native` (requires `react-native-svg`). One set only.
- `strokeWidth={2}` with `absoluteStrokeWidth`. Sizes are 24 dp by default, 20 in dense rows and buttons, 16 inline with text, and 28 in the camera rails.
- Icons inherit text colour and never carry status colour by themselves. Damage status is drawn with marker glyphs, not icons.
- Core mapping: Rentals `key-round`, Vehicles `car`, Customers `users`, Settings `settings`, capture `camera`, flash `zap` / `zap-off`, guide `focus`, skip `skip-forward`, list `list-checks`, delete `trash-2`, clear `rotate-ccw`, overdue `clock`, share `share-2`, report `file-text`, lock/frozen `lock`.
- No emoji or Unicode glyphs as icons.

## Motion

- **Durations:** 120 ms (press, toggle, chip), 200 ms (state change, orbit segment fill, snackbar), 280 ms (sheet, push, mode cross-fade), 400 ms (post-shutter freeze).
- **Easing:** standard `cubic-bezier(0.2, 0, 0, 1)`, decelerate `(0, 0, 0, 1)` for entrances, accelerate `(0.3, 0, 1, 1)` for exits. Springs have no overshoot.
- **Allowed:** navigation (platform push / shared-axis), sheets rising, segmented cross-fade between compare modes (the image layers stay put and only the divider or opacity animates), the slider following the finger 1:1, orbit fill, the current-angle dot pulsing (1.6 s, opacity 0.6 to 1, stopped under reduced motion), and skeleton shimmer.
- **Not allowed:** page-load choreography, bouncing, parallax, animated counters, decorative transitions on photos.
- Honour Reduce Motion / Remove animations: replace with instant cuts or 120 ms cross-fades.

## Do's and Don'ts

**Do**
- Put the plate in its frame everywhere a vehicle is identified.
- Keep one primary action per screen, bottom-anchored.
- Use tabular numerals for times, mileage, counts and references.
- Show damage with marker glyphs plus the status word, everywhere.
- Test every screen at full sun brightness and in greyscale.

**Don't**
- Use cards, nested cards, gradients, glass, glow, drop shadows on rows, stat tiles or charts.
- Use vermilion or amber for anything that is not damage.
- Put a tracked-caps label above a heading.
- Overlay controls on photos beyond registration marks, the guide and tags.
- Invert the app for dark mode. Only the rebate scheme is specified.
- Use `StyleSheet.hairlineWidth` for dividers.

## Implementation dependencies

- `@expo-google-fonts/barlow`, `@expo-google-fonts/barlow-semi-condensed`, `expo-font` (loaded before the splash hides).
- `lucide-react-native`, `react-native-svg` (icons, markers, orbit, signature strokes).
- `expo-haptics` (shutter tick, marker drop).
- A bottom sheet built on Reanimated + Gesture Handler, which are already installed. `@gorhom/bottom-sheet` is acceptable if it supports the installed Reanimated 4.
- Already present: `@shopify/react-native-skia` (evidence composition, loupe), `expo-print` (PDF), `react-native-reanimated`, `react-native-gesture-handler`.
