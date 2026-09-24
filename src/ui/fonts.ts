// Per-weight subpaths keep the bundle to the six faces DESIGN.md uses (the package index
// would pull in all 18 Barlow files).
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { Barlow_700Bold } from '@expo-google-fonts/barlow/700Bold';
import { BarlowSemiCondensed_500Medium } from '@expo-google-fonts/barlow-semi-condensed/500Medium';
import { BarlowSemiCondensed_600SemiBold } from '@expo-google-fonts/barlow-semi-condensed/600SemiBold';

import { fontFamily } from './theme/tokens';

/** Map for expo-font's useFonts(); keys are the family names in tokens.fontFamily. */
export const fontAssets = {
  [fontFamily.regular]: Barlow_400Regular,
  [fontFamily.medium]: Barlow_500Medium,
  [fontFamily.semibold]: Barlow_600SemiBold,
  [fontFamily.bold]: Barlow_700Bold,
  [fontFamily.codeMedium]: BarlowSemiCondensed_500Medium,
  [fontFamily.codeSemibold]: BarlowSemiCondensed_600SemiBold,
};
