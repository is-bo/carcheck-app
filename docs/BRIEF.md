# CarCheck — Product Brief (source of truth)

Mobile app for car-rental agencies focused on **vehicle damage documentation and signed damage/condition contracts**. NOT a rental ERP (no booking, no accounting).

Value: document the vehicle before rental → customer signs a condition/damage agreement on the phone → document again on return → compare BEFORE/AFTER per angle (side-by-side, overlay, slider) → mark new damage → produce professional evidence: ONE composed BEFORE/AFTER image per angle with rendered markers, plus a final PDF report that embeds those images and the original signed contract.

Used by a rental employee standing next to a car, phone in hand, often outdoors, often one-handed.

## Platform
- Now: Android APK side-loaded to agencies. Later: Play Store + App Store — no Android lock-in.
- 100% offline. No backend, no accounts, no cloud, no network at runtime. Everything local.

## Core flow
Start: select/create vehicle → select/enter customer (only NAME is mandatory; signature required to finalize) → BEFORE inspection (guided repeatable angles) → mark existing damage → generate contract from template → customer reviews → finger signature (clear/retry, confirm) → signature embedded, contract finalized & frozen → rental active.
Return: open rental → return inspection with the matching BEFORE shown per angle (reference preview / translucent overlay / framing guide) → compare each angle (Side-by-side | Overlay w/ opacity | Slider, zoom/pan) → "Mark new damage" → generate paired evidence image per damaged angle → final damage report PDF → share/print.

## Entities
- **Vehicle** (reusable): make, model, year, plate, VIN optional, color, mileage, photo, notes. History: rentals, inspections, known damage, documents. Minimal required fields.
- **Customer** (optional reusable profile): name, phone, address, licence no., ID/passport, ID/licence/passport/other doc photos (sensitive, local-only), notes. Employee must be able to type customer details inline on the rental without creating a profile. Picking a profile pre-fills.
- **Rental**: vehicle, customer (profile or inline snapshot), start datetime, expected return (opt), start mileage, fuel (opt), BEFORE inspection, existing damage, signed contract, RETURN inspection, new damage, final report. Return mileage/fuel.
- **Photos**: each has angle identity (e.g. `front_left`) + phase (before/after) so `front_left_before ↔ front_left_after` is first-class data. Metadata: inspection, vehicle, capture order, angle, timestamp, phase. Default angles: front, front-left, left, rear-left, rear, rear-right, right, front-right (UX may refine; close-ups/extra shots allowed).
- **Damage**: location, type, note, severity (opt), angle/photo, close-up photo (opt), visual marker (circle/arrow/numbered pin/freeform — UX decides). Status: pre-existing / new / uncertain. Employee decides; no AI. New damage links rental, vehicle, angle, BEFORE photo, AFTER photo. Multiple numbered markers per angle.

## Contract system
- Default editable template (starter text, NOT legal advice; say so). Editable in Settings without code.
- Variables: agency info, customer name/info, vehicle, plate, dates, mileage, existing damage list, rental reference no., signatures, timestamp. Extensible variable registry.
- Signing freezes the exact rendered content the customer saw + signature image + timestamp. Never silently overwrite signed evidence. Post-sign edits that would change contract must be explicit (e.g. amendment/void & re-sign), never silent.

## Comparison (core, not polish)
- Side-by-side: BEFORE | AFTER, labelled, synchronized zoom/pan, max screen use.
- Overlay: AFTER over BEFORE, fast opacity control 0–100%. Optional small nudge alignment if practical.
- Slider: draggable divider, smooth, horizontal default, zoom/pan if practical.
- Mode switcher always visible (segmented), not in settings. Markers stay attached to the right image across modes. Obvious "Mark new damage" action.

## Evidence image generation (MOST IMPORTANT)
- Per damaged angle: ONE image = header (angle title) + BEFORE | AFTER + rendered markers + damage captions footer. Never two loose files; never mix angles.
- AFTER: clear numbered circles/arrows. BEFORE: show the corresponding area (e.g. dashed ring) so viewer can inspect prior state. Don't occlude damage.
- Must be understandable standalone (WhatsApp, print, PDF). Good quality, sane size (JPEG ~q85, long edge ~2400–3000px).
- Non-destructive: originals never modified. Distinguish original image / annotation data (normalized coords) / generated evidence (regenerable).

## Reports & export
- Signed contract PDF; final damage report PDF (agency, rental, customer, vehicle, initial & return condition, new damage each with its paired evidence image, timestamps, original signed contract, signatures). All generated on-device.
- Share via OS share sheet (any app), print via platform. Batch export of evidence images. Raw photo export only as explicit separate action.

## Storage, backup, privacy
- Structured data in a local DB; media as files in app-private storage with DB references (no big blobs in DB).
- Settings → Backup & Restore: Create Backup (complete: DB, all photos, doc photos, signatures, templates, signed contracts, evidence, settings), Restore (validate integrity & version BEFORE touching live data, confirm destructive replace, handle partial/corrupt archives safely), backup metadata/date. Versioned format with migration path.
- Sensitive data: app-private storage only, no media-store leakage, share only on explicit user action, temp export files cleaned. No enterprise-security complexity.
- Deleting vehicles/customers must never destroy historical rental evidence (archive/soft-delete, snapshots).

## Settings
Agency details, logo, contract template editor, report info, backup/restore, storage/data management, about. Keep it small.

## UI/UX
Exceptionally polished specialist mobile tool (Impeccable). No AI-slop: no card soup, gradients, glow, glassmorphism, hero layouts, pill confetti, meaningless charts, SaaS-dashboard look. Clear hierarchy, restrained system, deliberate type, quality icons, big touch targets, outdoor readability, one-handed where practical, great camera & comparison experiences, subtle purposeful motion. Light theme polished; dark only if done well. First-time employee understands with almost no explanation.

## Future (don't build, don't block)
Cloud backup, sync, accounts/teams, subscriptions, store distribution, i18n, richer rental mgmt, AI damage detection.
