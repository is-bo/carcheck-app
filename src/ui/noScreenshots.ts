import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';
import { useCallback } from 'react';

/**
 * Blocks screenshots, screen recording and the recent-apps preview (Android FLAG_SECURE) while
 * the calling screen is focused. Used only where customer ID photos, the signature pad or the
 * customer hand-off are on screen (security review L4); employee screens stay screenshotable for
 * support. Each screen passes its own key: a screen pushed on top blocks under its key, and the
 * one below re-blocks when it regains focus.
 */
export function useNoScreenshots(key: string): void {
  useFocusEffect(
    useCallback(() => {
      const tag = `carcheck:${key}`;
      preventScreenCaptureAsync(tag).catch(() => undefined);
      return () => {
        allowScreenCaptureAsync(tag).catch(() => undefined);
      };
    }, [key]),
  );
}
