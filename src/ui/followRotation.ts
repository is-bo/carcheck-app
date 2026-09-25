import { useFocusEffect } from 'expo-router';
import { lockPlatformAsync, unlockAsync } from 'expo-screen-orientation';
import { useCallback } from 'react';
import { Platform } from 'react-native';

/** android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR */
const ANDROID_SENSOR = 4;

let holders = 0;

function apply(): void {
  const request = holders > 0 ? lockPlatformAsync({ screenOrientationConstantAndroid: ANDROID_SENSOR }) : unlockAsync();
  request.catch(() => undefined);
}

/**
 * While the calling screen is focused, the UI turns with the phone (portrait or landscape) even
 * when the phone's auto-rotate is switched off: many employees keep it off, and the camera and the
 * signature pad must still turn when the phone is held sideways. Android's "sensor" orientation
 * does exactly that; leaving the screen hands rotation back to the phone's own setting. iOS always
 * follows its own rotation lock, so nothing changes there.
 */
export function useFollowPhoneRotation(): void {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      holders += 1;
      if (holders === 1) apply();
      return () => {
        holders -= 1;
        if (holders === 0) apply();
      };
    }, []),
  );
}
