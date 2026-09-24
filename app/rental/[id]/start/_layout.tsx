import { Stack } from 'expo-router';

import { screenPresets, type ScreenPreset } from '@/ui';

/**
 * START flow shell (UX §2): a full-screen task over the tabs. Each step draws its own stepper
 * header (StartFlowScreen); the camera is rebate full-screen, the customer hand-off can't be
 * swiped away mid-signature.
 */
const PRESETS: Record<string, ScreenPreset> = {
  capture: 'rebateFullScreen',
  sign: 'handOff',
  index: 'instant',
};

export default function StartFlowLayout() {
  return <Stack screenOptions={({ route }) => screenPresets[PRESETS[route.name] ?? 'card']} />;
}
