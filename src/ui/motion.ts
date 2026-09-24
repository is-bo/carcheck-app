import { Easing } from 'react-native-reanimated';

import { motion } from './theme/tokens';

/** Reanimated easings for the DESIGN.md curves. Use with withTiming. */
export const ease = {
  standard: Easing.bezier(...motion.easing.standard),
  decelerate: Easing.bezier(...motion.easing.decelerate),
  accelerate: Easing.bezier(...motion.easing.accelerate),
} as const;

export const duration = motion.duration;
