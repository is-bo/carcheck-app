import type { NativeStackNavigationOptions } from 'expo-router';

import { light, rebate } from './theme/tokens';

/**
 * Presentation presets for native-stack screens. The root layout maps routes onto them; flow
 * layouts (start/_layout, return/_layout) reuse them for their own children, e.g. the customer
 * hand-off or the compare screen. Every screen draws its own bar through <Screen>, so the native
 * header is off everywhere.
 */
const base: NativeStackNavigationOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: light.background },
  animation: 'default',
};

export const screenPresets = {
  /** Ordinary push (detail, settings pages). Platform push, system Back and edge-swipe intact. */
  card: base,

  /** Start / Return flow shells: full-screen task, tab bar gone, ✕ leaves (draft autosaved). */
  flow: {
    ...base,
    presentation: 'fullScreenModal',
    animation: 'slide_from_bottom',
  },

  /** Create vehicle / customer. A self-contained sub-task. */
  modalForm: {
    ...base,
    presentation: 'modal',
    animation: 'slide_from_bottom',
  },

  /** Camera and full-screen viewer: rebate black, no swipe-dismiss mid-shot, fade in. */
  rebateFullScreen: {
    ...base,
    presentation: 'fullScreenModal',
    animation: 'fade',
    contentStyle: { backgroundColor: rebate.background },
    gestureEnabled: false,
  },

  /** Marker editor, compare: pushed like a card but painted rebate so the push has no white flash. */
  rebateCard: {
    ...base,
    contentStyle: { backgroundColor: rebate.background },
  },

  /**
   * Customer hand-off (start/sign). Back moves through the screen's internal states, so the
   * iOS swipe must not pop the customer straight out to the employee view.
   */
  handOff: {
    ...base,
    animation: 'fade',
    gestureEnabled: false,
  },

  /** First launch: nothing to go back to. */
  onboarding: {
    ...base,
    animation: 'fade',
    gestureEnabled: false,
  },

  /** Routes with no UI (rental/new creates a draft and replaces itself). */
  instant: {
    ...base,
    animation: 'none',
  },
} satisfies Record<string, NativeStackNavigationOptions>;

export type ScreenPreset = keyof typeof screenPresets;
