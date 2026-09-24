# CarCheck — Image Pipeline

Owner: image pipeline. Inputs: `docs/BRIEF.md`, `docs/UX_FLOWS.md`, orchestrator decisions (landscape preferred but not enforced; mixed orientations must work; nudge alignment deferred; status must differ by marker **shape**, including in exports).
Code: `src/media/geometry.ts` (coordinates, zoom/pan, BEFORE↔AFTER mapping, pin placement, hit testing) and `src/media/evidenceLayout.ts` (full evidence-image layout + cache fingerprint). Both are pure TS with no dependencies and are covered by `src/media/__tests__`.

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Camera | `expo-camera` 57 (already in the scaffold). `ratio="4:3"`, explicit `pictureSize` ≈ 12 MP, `quality: 0.9`, `exif: false`, never `skipProcessing` |
| Orientation | Pixels upright at capture (expo-camera rotates when `exif:false`); stored JPEG has no EXIF orientation |
| Stored original | ≤ 4032 px long edge JPEG, written once, never modified, SHA-256 in DB |
| Derivatives | `display` 2048 px q0.85 (compare, evidence source), `thumb` 384 px q0.7; regenerable, not backed up |
| Marker model | Numbered pin + circular ring `{x, y, r}` normalized to the original photo; JSON on the damage row |
| Comparison renderer | Skia `<Canvas>` + Reanimated shared values; the same geometry functions as the export |
| Evidence image | Skia CPU raster surface → JPEG q85, long edge 2800 px; landscape pairs stacked, portrait pairs side by side |
| Evidence cache | Derived file keyed by SHA-256 of `evidenceFingerprint()`; regenerated lazily when inputs change |
| Signature | Skia path, quadratic smoothing, trimmed transparent PNG at 3× density |
| PDF | `expo-print` HTML → PDF, images as **base64 data URIs** downscaled to 1600 px |
| Sharing | `expo-sharing` one file at a time; "Share all images" needs `react-native-share` (fallback: evidence-pack PDF) |

## 1. Capture

**Library: keep `expo-camera` (scaffold choice).** We only need stills and an overlay. It ships in lockstep with SDK 57 (no separate native upgrade track). It lets us set picture size and JPEG quality. By default it returns upright pixels. VisionCamera's strengths (frame processors, format-level control, faster capture) do not pay for a second native dependency here. Revisit only if field tests show capture latency above ~1.5 s on target low-end phones.

**Settings (verified against expo-camera 57 source).**
- `ratio="4:3"`: on Android this switches the preview from `FILL_CENTER` to `FIT_CENTER`, so the preview shows the whole captured frame. Also size the `CameraView` itself to exactly 4:3, letterboxed on the screen. Preview framing then equals photo framing on both platforms, which the BEFORE ghost relies on (§2).
- `pictureSize`: from `getAvailablePictureSizesAsync()`, choose the largest 4:3 size with a long edge ≤ 4096 (typically `4032x3024`). **Without it, expo-camera uses `HIGHEST_AVAILABLE_STRATEGY`**, which means 50/108/200 MP files on modern Android phones. Cache the chosen size per device.
- `takePictureAsync({ quality: 0.9, exif: false, shutterSound: false })`. With `exif: false`, Android decodes the JPEG, rotates the bitmap by its EXIF orientation and re-encodes it without EXIF. With `exif: true` it **skips the rotation** and copies the orientation tag instead (`ResolveTakenPicture.kt`). So never request EXIF. Never use `skipProcessing` either.
- iOS: set `responsiveOrientationWhenOrientationLocked`. Android already follows the physical orientation through an `OrientationEventListener`. App orientation is `default` (app.config), so the capture UI rotates with the phone.
- Low-memory fallback: expo-camera may down-sample on out-of-memory errors (`maxDownsampling`). Always store the returned `width`/`height`; never assume the requested size.

**After the shutter (JS, non-blocking; the UX auto-advance does not wait):**
1. The camera writes into the **cache** directory, which the OS may purge. Immediately `File.move()` the file to `documentDirectory/media/rentals/{rentalId}/photos/{photoId}.jpg`.
2. If the long edge is > 4096 (the device ignored `pictureSize`), re-encode once with `ImageManipulator.manipulate(uri).resize({ width|height: 4032 }).renderAsync()` → `saveAsync({ compress: 0.9, format: JPEG })`. Otherwise keep the camera bytes as they are.
3. SHA-256: `Crypto.digest(SHA256, await new File(uri).bytes())` (a ~3 MB read is fine). Hash the file **as stored**. Nothing touches it afterwards.
4. Insert the DB row. The UI can show the photo from this point on.
5. Queue the derivatives. **display**: resize to a 2048 px long edge, q0.85, about 0.7 MB. **thumb**: 384 px, q0.7, about 25 KB. Paths are deterministic (`derived/{photoId}_d2048.jpg`, `_t384.jpg`). They are regenerated if missing and are **excluded from backup**.

**File naming.** Opaque ids only (`{photoId}.jpg`); the DB holds meaning. Store **paths relative to `documentDirectory`**: the iOS container path changes between installs and restores.

**Photo row (request to the data-model agent):** `id, rental_id, inspection_id, vehicle_id, phase ('before'|'after'), angle_key, kind ('angle'|'extra'|'dashboard'|'closeup'|'id_doc'|'vehicle'), extra_label, capture_order, rel_path, width, height, bytes, sha256, mime, captured_at (UTC ISO taken at shutter press, labelled "device time" in reports), tz_offset_min, flash_mode, replaced_by (retake chain)`. Orientation is derived from width and height and is not stored.

**Size budget (for the storage/backup agent).** An original is 2.5–4.5 MB and its derivatives about 0.75 MB. A rental with 8+1 angles in each of 2 phases, i.e. 18 photos, takes about **60–90 MB**. Resolution and quality are two constants in `src/config.ts`; 3264 px at q0.85 roughly halves this if storage becomes the bottleneck. Derivatives of completed rentals can be purged by "Free up space".

## 2. Return capture alignment (BEFORE ghost)

- The ghost is an `expo-image` `<Image>` of the BEFORE **display** derivative. It is absolutely positioned over the 4:3 `CameraView` in the **same rect**, contain-fitted with `containFit(beforeSize, previewRect)`, and has `pointerEvents="none"`. Overlaying RN views on the CameraX `PreviewView` and on the iOS preview layer is standard; opacity is plain view alpha, so there is no Skia cost here.
- UX behaviour: ghost on at 40%, vertical slider 0–80%, the Ghost toggle keeps the level, press-and-hold on the corner thumb shows the BEFORE photo full-screen. Opacity is a Reanimated shared value, so the slider never re-renders the camera.
- **Orientation nudge.** When the BEFORE photo's orientation (`width > height`) differs from the current device orientation, show "Turn the phone to match the pick-up photo" and keep the shutter enabled (landscape is preferred, not enforced). A mismatched ghost is still drawn contain-fitted (pillarboxed) so it is honest about the mismatch.
- The same mechanism shows the previous rental's photo as a 30% ghost during BEFORE capture.

## 3. Annotation model

**Shape set: one shape.** A numbered pin plus a circular ring (UX §4). Arrows and freehand are dropped: rings of any radius plus the minimum ring size (§5) cover small damage, and a close-up photo covers the rest.

```ts
// geometry.ts — persisted as JSON on the damage row (photo ids live in DB columns)
interface Ring { x: number; y: number; r: number }  // x,y in 0..1 of the ORIGINAL upright photo; r = fraction of its SHORT side
interface DamageMarker { v: 1; ring: Ring; counterpart?: Ring }
```
- `r` is relative to the short side, so the ring stays a circle under every uniform scale: screen, zoom, stacked or side-by-side export. `DEFAULT_RING_RADIUS = 0.06`, clamped to 0.015–0.5.
- `ring` lives on the photo the damage was marked on: AFTER for new or uncertain, BEFORE for existing. For "Was there" found at return, `ring` is on AFTER and the status is `existing`.
- **Counterpart ring** (the "same area" on the paired photo) = `deriveCounterpart(ring, dir, beforeSize, afterSize, alignment?)`. It is the same physical spot through the pair mapping (it handles different resolutions and portrait/landscape mismatches), padded ×1.15 so it frames the spot rather than covering it. It is derived live in compare, as the UX asks for ("matching dashed ring appears live on BEFORE"). **Employee override:** dragging the dashed ring stores `counterpart`; "Reset" deletes it. Only an override is persisted, so fixing the mapping later improves every non-overridden ring.
- **Pin position.** The pin is never drawn at the ring's centre, where it would hide the damage. `placeBadge()` puts it outside the ring on a diagonal: upper-right first, flipping near edges, always inside the photo. The editor uses the same function, so screen and export agree. Drag the pin = move; drag the ring edge = resize; `hitTestMarkers()` returns `pin | edge | inside` with the UX's 48 dp tolerance.
- **Status by shape (screen and export)** — badge shape encodes status, never colour alone (DECISIONS.md, prints in B/W):

| Status | Badge shape | Ring on its own photo | Pin | Counterpart on the paired photo |
|---|---|---|---|---|
| New | circle | solid, red | filled, white number | dashed ring, hollow pin |
| Uncertain | diamond | **dashed**, amber | filled + small "?" disc | dashed ring, hollow pin + "?" |
| Existing | square | solid, slate | **hollow** (white fill, slate letter) | dashed ring, hollow pin |

Every ring is stroked three times: a dark 45% edge, a white halo, then the colour. This keeps it legible on white, silver, red and black paint and in black-and-white print. The same pin shapes repeat in the footer captions. Dashed is reserved for the counterpart ring/pin only — it never appears on the primary photo the damage was marked on.
- **Numbering (DECISIONS.md):** existing damage is labelled with LETTERS (A, B, C… per rental); new and uncertain share one NUMBER sequence across the rental, so flipping status never renumbers. Captions add the status word ("New 2", "Uncertain 3", "Existing A"), so equal labels stay unambiguous.

## 4. Comparison rendering

**Renderer: Skia.** Use one `<Canvas>` per comparison viewport. Images are `SkImage`s of the 2048 px display derivatives, from `useImage` / `Skia.Image.MakeImageFromEncoded`: about 12.6 MB decoded each, so about 25 MB for a pair. Release them when the angle changes and prefetch only the next pair. Photo rects and marker positions are `useDerivedValue`s computed with the `geometry.ts` worklets (`imageRectInViewport`, `ringToRect`, `normRectToRect`). Markers are drawn in **screen space**, so strokes and pins keep a constant dp size at any zoom. Opacity (`<Group opacity>`), slider clipping (`<Group clip>`) and dashes (`<DashPathEffect>`) are native. The same drawing rules as the export make the screen WYSIWYG. RN `Image` + Animated transforms was rejected: it needs a separate SVG marker layer with counter-scaled strokes and renders dashes differently from the export.

**Zoom/pan state.** `ViewState { zoom, cx, cy }`: zoom relative to contain-fit, plus the normalized photo point at the viewport centre. It is resolution- and viewport-independent, so **one shared value drives both side-by-side panes**, even if the panes or photos differ in size or orientation. Each pane clamps for its own geometry at render time (`clampViewState`). Pinch: `pinchFrom(start, scale, startFocal, focal)` (focal point follows the fingers). Pan: `panBy`. Double tap: `toggleZoomAt` (2.5×, per UX). `MAX_ZOOM = 6`. Past about 2× on a ~1170 px-wide screen the 2048 px source is upscaled. That is acceptable for locating damage, and close-ups carry fine detail. If field tests say otherwise, add a "detail swap" (crop of the original for the settled viewport) later.

**Modes.**
- *Side by side:* stacked when the viewport is portrait, left|right in landscape (UX). BEFORE is always first. In mark mode only the AFTER pane accepts taps, and the BEFORE pane shows the live derived counterpart.
- *Overlay:* the BEFORE rect is `normRectToRect(beforeRectInAfter(B, A, alignment), afterRect)`. AFTER is drawn on top with opacity `o` (0 = BEFORE, 1 = AFTER). AFTER markers are drawn with opacity `o` and BEFORE markers with `1 − o`, so each marker shows only where its layer shows. Press-and-hold animates `o → 0` and back on release.
- *Slider:* the same as overlay with AFTER clipped to `x ≥ divider`. The divider is a viewport fraction, independent of zoom. BEFORE markers are clipped left of it, AFTER markers right.
- *Alignment (deferred):* `Alignment { dx, dy, scale }` is optional in every function (identity when absent). If it ships, store it per (rental, angle) pair as the BEFORE-in-AFTER transform; the UI may let the finger drag either layer. It also improves derived counterparts.

**Gesture composition (RNGH 2.32).**
- View: `Gesture.Simultaneous(pinch, pan)`. Pan activates only when `zoom > 1`; at zoom 1 a horizontal swipe belongs to the angle switcher (UX).
- Taps: `Gesture.Exclusive(doubleTap, singleTap)`. In mark mode a single tap drops a pin at `viewportToNorm(tap, afterSize, viewport, view)` on the AFTER layer in every mode.
- Editing: on `onTouchesDown`, run `hitTestMarkers`. On a pin or edge, a `manualActivation` drag pan activates and the view pan fails. Otherwise the reverse.
- Slider: `Gesture.Race(dividerPan, view)`. `dividerPan` uses `manualActivation(true)` and activates only when the touch starts within the 48 dp handle; otherwise it calls `fail()`.

## 5. Evidence composition

**Layout** comes from `computeEvidenceLayout(input, options)`: every rect, wrapped text line (baseline position), ring and pin in output pixels. The renderer is a dumb loop. Sample outputs (tested):

| Pair | Arrangement | Canvas | Photo in panel | Ring stroke / pin r |
|---|---|---|---|---|
| landscape, 1 damage | stacked | 1592×2800 | 1522×1141 | 9 / 41 px |
| landscape, 8 damages | stacked, 2-col footer | 1492×2798 | 1426×1070 | 9 / 39 px |
| portrait, 1 damage | side by side | 2800×2512 | 1316×1755 | 10 / 47 px |
| portrait BEFORE + landscape AFTER | stacked | 1557×2799 | 1488×1116 | 7 / 30 px |

- **Arrangement rule:** try stacked and side by side, and keep the one where the *smaller* photo is largest once the whole image is fitted into a portrait A4/phone frame. In practice landscape pairs stack and portrait pairs sit side by side. BEFORE is always first (top or left). Each arrangement is scaled so the long edge is 2800 px (±2%).
- **Visual spec:**
  - Header: angle title (bold, shrinks to 70% then ellipsizes), subtitle `R-0142 · Renault Clio · AB-123-CD`, right-aligned return date and agency name, thin divider.
  - Panel strip: **BEFORE** / **AFTER** (bold) with the capture time right-aligned ("Pick-up · 12 Mar 2026, 09:14").
  - Photo contain-fitted on a light-grey letterbox.
  - Rings and pins as in §3.
  - Footer: one row per damage, ordered new → uncertain → existing. Each row has a pin replica and "New 2 — Dent, rear bumper — Moderate", wrapped to at most 2 lines, plus an optional quoted note (1 line). There are 2 columns from 4 damages.
  - Legend line: "Rings on AFTER mark the damage at return. Dashed rings on BEFORE show the same area at pick-up."
  - Provenance footnote: `CarCheck · R-0142 · evidence {fp8} · photos {sha8 before}/{sha8 after}`.
  - Many damages make the image taller rather than dropping captions (`exceedsTargetLongEdge` flags it).
- Text is sized relative to canvas width (caption ≈ 2.1%). Markers are sized relative to the smaller photo's short side (stroke 0.8%, pin 3.6%, minimum ring 3%, so tiny marks stay visible). All user strings come in through `input.texts` (i18n-ready).
- **Which damages to include:** the new and uncertain damages on the angle, plus existing damages whose ring is on this angle's BEFORE photo. Existing ones are hollow slate pins that show what was already known next to the new damage. Existing rings are **not** projected onto AFTER in exports (the projection is approximate).
- **Source pixels:** the layout reports `requiredSourceLongEdge` per panel. It is ≤ 2048 in every tested case, so **composition uses the display derivatives**, which saves ~70 MB of decoding versus originals. Fall back to the original only when the value exceeds the derivative size.
- **Rendering:**

```ts
const surface = Skia.Surface.Make(W, H);            // CPU raster: deterministic, no GL context, no max-texture limit
const c = surface!.getCanvas(); c.clear(white);
// header/panel/footer text: c.drawText(line.text, line.x, line.y, paint, font(weight, size))
// photos: c.drawImageRectCubic(img, srcRect, panel.imageRect, 1/3, 1/3)   // Mitchell: clean downscale
// rings: per marker, save → clipRect(marker.clip) → stroke edge, halo, colour (dash = Skia.PathEffect.MakeDash(style.dash)) → restore
// pins after ALL rings (solid|hollow fill, number, optional "?" disc)
surface!.flush();
const bytes = surface!.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, 85);
new File(dir, name).write(bytes); // then dispose() images and surface
```
- Run on the JS thread, **one angle at a time**. Peak native memory ≈ canvas (18–31 MB) + 2 decoded derivatives (25 MB), which is safe on 2–3 GB Android devices. Expect ~150–500 ms per image and about **0.5–1.2 MB per JPEG** at q85, since white header and footer compress to almost nothing. Byte sizes still need confirming on a device with real photos.
- **Font:** bundle TTFs in `assets/fonts/` (Regular + Bold/SemiBold). Use the UI family if DESIGN.md's choice has Latin-Extended coverage and tabular figures; otherwise use **Inter** (OFL). Load once at app start with Skia `useFonts({ Evidence: [require(regular), require(bold)] })` and keep the provider in a module singleton. Get typefaces with `provider.matchFamilyStyle('Evidence', { weight: 400|700 })` and fonts with `Skia.Font(tf, size)`. Pass `measureText` into the layout as the sum of `font.getGlyphWidths(font.getGlyphIDs(text))`, which gives advance widths (`measureText` returns ink bounds). System fonts (`matchFont`) are rejected: OEM fonts change the layout and can lack glyphs. The font file version is part of the fingerprint.

## 6. Regeneration (derived artifacts)

- `evidenceFingerprint(input, { beforeSha256, afterSha256, fontId, longEdge, jpegQuality })` returns a canonical string: sorted keys, numbers rounded to 1e-6, plus `EVIDENCE_LAYOUT_VERSION`, and **without** the footnote. SHA-256 of it is the cache key.
- Table `evidence_image(rental_id, angle_key, fingerprint, rel_path, width, height, bytes, sha256, created_at)`, file `media/rentals/{rentalId}/evidence/{angle}-{fp16}.jpg`.
- Anything that changes the pixels changes the key: markers, labels, status, retaken photo, agency name, date format, layout version, font. Stale images regenerate **lazily**, when the report screen, the viewer or an export needs them, never on each drag. Order: write the new file → swap the DB row → delete the old file.
- Report PDFs embed the image bytes, so a generated report is unaffected by later regeneration. A reopened return produces a new report ("Revised …", UX §8).
- Evidence JPEGs and report PDFs **are** backed up (what was shared stays reproducible). Display/thumb/PDF variants are not.

## 7. Signature

- Capture with an RNGH `Pan` (`minDistance(0)`) on the UI thread, appending `{x, y, t}` to a shared array per stroke. Render with a Skia `Path`: `moveTo(p0)`, then `quadTo(p_i, mid(p_i, p_i+1))` per point (midpoint smoothing). Stroke width is a constant 2.75 dp, colour #111, round cap/join. Constant width keeps it deterministic.
- "Meaningful stroke" (enables Confirm): total path length ≥ 60 dp and bounds ≥ 40×15 dp.
- On Confirm: `bounds = pointsBounds(allPoints, strokeWidth/2 + 8dp)`. Render at **3×** onto `Skia.Surface.Make(ceil(w·3), ceil(h·3))`, cleared transparent and translated by `−bounds`. Save with `encodeToBytes(ImageFormat.PNG)` to `media/contracts/{contractId}/signature.png` (typically 15–60 KB) and hash with SHA-256. If it is wider than 2400 px, drop to 2×. Also store the raw strokes JSON (a few KB) with the signed contract.
- In HTML/PDF: `<img src="data:image/png;base64,…" style="height:22mm">` above the signature line, with the name and the signing timestamp printed under it. The frozen contract snapshot embeds the data URI, so it is self-contained.

## 8. PDF (expo-print)

- **Images as base64 data URIs, never `file://`.** Verified in expo-print 57: Android renders with `loadDataWithBaseURL(null, html, …)` in a fresh WebView with default settings, so local file URLs are not reliably readable. Data URIs also work in iOS's WKWebView.
- **Downscale for PDF:** evidence images at 1600 px long edge q0.8 (~250–400 KB); angle photos in the condition grids at 800 px q0.75 (~80 KB); logo at 600 px. `ImageManipulator…saveAsync({ compress, format: JPEG, base64: true })` returns base64 directly. Cache it in `cacheDirectory/pdf/` keyed by source sha256. A typical report (3 evidence images, 2×9 thumbnails, contract appendix) is about **4–6 MB of HTML**. Build it with array `join`, not repeated string concatenation.
- Page setup: `printToFileAsync({ html, width: 595, height: 842 })` (A4 at 72 dpi), CSS `@page { size: A4; margin: 12mm }` (Android), and the `margins` option on iOS.
- Page-break rules:
  - Each evidence block (heading + image + caption list) has `break-inside: avoid; page-break-inside: avoid`.
  - Images use `width:100%; max-height: 235mm; object-fit: contain`. Stacked images take one per page; side-by-side ones fit two.
  - Headings use `break-after: avoid`.
  - The signed-contract appendix starts with `break-before: page`.
  - The damage list uses table rows with `break-inside: avoid`.
- **Signed contract in the report:** embed the **frozen** contract HTML fragment captured at signing (styles scoped under `.contract`, with the signature as a data URI) together with its sha256. Never re-render it from the template. The separately stored signed-contract PDF is what "Share signed contract PDF" sends.
- **Print:** `Print.printAsync({ uri: pdfUri })` prints the exact generated PDF, so what prints is what was shared.

## 9. Export & sharing

- `expo-sharing` 57 `shareAsync(url, { mimeType, UTI, dialogTitle })` shares **one file**. Copy the file to `cacheDirectory/share/` under a human name (`CarCheck_R-0142_rear-left.jpg`, `CarCheck_R-0142_report.pdf`) and share that copy. **Do not delete it the moment `shareAsync` resolves**: the receiving app may still be reading it. Empty `share/` at the next app start (the backup temp file uses the same rule).
- **Share all images (UX open decision 3):** recommend adding `react-native-share` (`Share.open({ urls })`, multi-file Android intents and iOS activity items; fine in our dev-client build). Until it is approved, fall back to an "Evidence pack" PDF with one evidence image per page (expo-print, no new dependency). A ZIP (react-native-zip-archive) is poor for WhatsApp recipients and is used only for raw export.
- **Originals are shared only through "Export original photos"** (UX ⋮ menu): a ZIP of the originals plus `manifest.json` (angle, phase, capture time, sha256), sent as one file.
- Nothing is written to MediaStore or the gallery. iOS "Save Image" happens only through the user's share-sheet action (the `NSPhotoLibraryAddUsageDescription` key is already in app.config).

## 10. Requests to other agents

- **Data model:** the photo columns in §1; `damage.marker_json` (`DamageMarker`) plus `before_photo_id` / `after_photo_id`; the numbering rule in §3; the `evidence_image` table in §6; a frozen contract snapshot (HTML fragment + signature PNG path + sha256 + raw strokes). Store all paths relative to `documentDirectory`.
- **UI/compare:** import the `geometry.ts` worklets unchanged. Place the pin with `placeBadge` (never at the ring centre). Draw status shapes exactly as in §3. Keep BEFORE first in every mode. Use the gesture rules in §4.
- **Capture:** apply the §1 settings exactly (`ratio`, `pictureSize`, `exif:false`). Move the file out of the cache before anything else. Size the preview to 4:3.
- **Architecture/lead:** approve or decline `react-native-share`, and choose the bundled font. Storage math (~75 MB per rental) needs a retention story in "Storage / data management".

## 11. Verification status

- `npx jest src/media`: **50 tests pass** (geometry: fit, zoom/pan round-trips, pinch focal invariance, synchronized panes, pair mapping across resolution and orientation, pin placement at edges, hit testing; layout: landscape/portrait/mixed, target long edge, text inside canvas, 2-column footer, 40 long captions, title shrink/ellipsis, status shapes, draw order, min ring size, fingerprint stability). `tsc --noEmit` and `eslint src/media` are clean.
- Visual check: layouts rendered to SVG and screenshotted headless; nothing overlapped.
- **Not yet verified on device** (needs a dev build):
  - the capture orientation matrix (4 rotations × 2 platforms), including that `exif:false` output is upright on Samsung and Xiaomi phones;
  - that the `pictureSize` string format and choice work on a 50 MP+ phone;
  - Skia CPU-surface JPEG encode time and size with real photos;
  - font loading in release APKs;
  - expo-print with a ~6 MB data-URI HTML on a low-end Android;
  - share-sheet temp-file lifetime.
