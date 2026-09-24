# Product

<!-- impeccable:product-schema 1 -->

> Inferred from `docs/BRIEF.md` and the orchestrator's task packet. No interactive interview was possible in this run (the design subagent has no question tool). Items marked *(inferred)* are reasonable readings of the brief, not user-confirmed facts.

## Platform

adaptive

React Native (Expo). Ships first as a side-loaded Android APK; Play Store and App Store later. The design must not lock into Android-only idioms: Material conventions on Android, HIG guarantees (safe area, edge-swipe back, Reduce Motion) on iPhone.

## Stack

Expo / React Native, TypeScript. 100% offline: local database for structured data, app-private files for media. No backend, accounts, cloud or network at runtime.

## Users

- **Primary: rental-desk and lot employees.** Standing next to a car, often outdoors in bright sun, frequently one-handed (keys, clipboard or the car door in the other hand), often with the customer waiting beside them. They repeat the same inspection many times a day, so speed and muscle memory matter more than discoverability after day one. A first-time employee must understand the flow with almost no explanation.
- **Secondary: the rental customer.** Holds the phone briefly to read the condition contract and sign with a finger. Unfamiliar with the app, possibly in a hurry, possibly reading in a second language *(inferred)*, possibly without reading glasses *(inferred)*.
- **Tertiary: whoever receives the evidence.** Agency manager, insurer, the customer after the fact, a small-claims clerk. They see only exported images and PDFs, often via WhatsApp or on paper, with no access to the app.

## Product Purpose

Document a vehicle's condition before a rental, get the customer to sign a condition/damage agreement on the phone, document again on return, compare BEFORE and AFTER per angle, mark new damage, and produce evidence that stands on its own: one composed BEFORE/AFTER image per damaged angle and a final PDF report embedding those images and the original signed contract.

Success: a disputed damage claim can be settled from the exported evidence alone, and producing that evidence costs the employee a few minutes per car, not a stop-the-desk ordeal.

Not a rental ERP: no booking, no accounting, no fleet management.

## Positioning

Angle identity is first-class data. Every photo knows it is, e.g., `front_left` in phase `before` or `after`, so the app can guide the return shot against the matching BEFORE, compare the pair in three modes, and compose a single paired evidence image per angle. Generic inspection or photo apps store loose pictures; CarCheck stores matched pairs and signed context.

## Operating Context

- Outdoors, daylight to harsh direct sun; also dim parking garages at night *(inferred)*.
- One-handed operation where practical; thumb reach matters.
- Customer present during BEFORE and signing; the phone is physically handed over for review and signature, then handed back.
- Default angles: front, front-left, left, rear-left, rear, rear-right, right, front-right; extra close-ups allowed.
- Evidence travels outside the app: WhatsApp, email, print, PDF. It is viewed on small phone screens and on black-and-white office printers *(inferred)*.
- Signing freezes content: the exact rendered contract, the signature image and a timestamp. Post-sign changes are explicit amendments or void-and-re-sign, never silent.

## Capabilities and Constraints

- Entities: Vehicle (reusable), Customer (optional profile or inline snapshot; only name mandatory), Rental, Photo (angle + phase), Damage (pre-existing / new / uncertain; employee decides, no AI), Contract (template + variables, frozen on sign).
- Comparison modes: Side by side, Overlay (opacity 0–100%), Slider. Mode switcher always visible. Markers stay attached to the correct image across modes.
- Evidence image: header (angle title), BEFORE | AFTER, numbered markers on AFTER, corresponding dashed rings on BEFORE, captions footer. JPEG ~q85, long edge ~2400–3000 px. Originals never modified; annotations stored as normalized coordinates; evidence is regenerable.
- Reports: signed contract PDF; final damage report PDF. Share via OS share sheet; print via platform.
- Backup & Restore of everything, versioned, validated before touching live data.
- Sensitive data (ID documents) stays in app-private storage; nothing leaks to the media gallery.
- Deleting a vehicle or customer never destroys historical rental evidence.
- Contract template is starter text and explicitly not legal advice.
- **Undecided:** dark theme for non-camera screens; tablet layouts; localisation (future, must not be blocked).

## Brand Commitments

- Name: **CarCheck**.
- No logo or brand colour exists yet. Agencies may add their own logo in Settings; it appears on contracts and reports, not in app chrome *(inferred)*.
- Anti-slop list from the brief is binding: no card soup, gradients, glow, glassmorphism, hero layouts, pill confetti, meaningless charts, or SaaS-dashboard look.

## Evidence on Hand

- No real photos, agencies, customers, contracts or logos exist yet. All mockup content (plates, names, agency names, damage entries) is synthetic and must be labelled as such.
- No legal contract text exists; the default template is starter text only.

## Product Principles

1. **Evidence first.** Every screen either captures, protects or presents evidence. Nothing ambiguous may enter a signed or exported artifact.
2. **The photo is the subject.** Interface chrome recedes wherever a photo is on screen.
3. **Never silently change what was signed.** Frozen means frozen; changes are visible acts.
4. **Standalone legibility.** An exported image or PDF must explain itself to someone who has never seen the app.
5. **One hand, bright sun, customer waiting.** Speed and certainty beat richness.

## Accessibility & Inclusion

- Outdoor readability: high contrast in light theme, WCAG AA minimum, AAA for primary text where practical.
- Damage status (pre-existing / new / uncertain) must be distinguishable without colour: shape and label as well as hue, including in black-and-white prints.
- Touch targets at least 48 dp; bigger for camera, capture and signing controls.
- Customer-facing contract and signature screens use larger type and follow the system font-size setting.
- Honour Reduce Motion / Remove animations.
