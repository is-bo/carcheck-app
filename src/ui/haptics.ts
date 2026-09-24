import * as Haptics from 'expo-haptics';

// DESIGN.md allows exactly two haptic moments. Both are fire-and-forget: a device without a
// vibrator (or with haptics disabled) must never surface an error.

/** Shutter tick: the photo was taken. */
export function hapticShutter(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** A damage pin landed on the photo. */
export function hapticMarkerDrop(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
