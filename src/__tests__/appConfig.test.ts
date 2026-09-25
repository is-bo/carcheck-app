import type { ExpoConfig } from 'expo/config';

import appConfig from '../../app.config';

const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]) as ExpoConfig;
const blocked = config.android?.blockedPermissions ?? [];

// Startup crash on Android 14+: expo-screen-capture registers a screen-capture callback when the
// module loads, which throws SecurityException without DETECT_SCREEN_CAPTURE.
describe('app.config android permissions', () => {
  it('never blocks DETECT_SCREEN_CAPTURE while expo-screen-capture is installed', () => {
    expect(blocked).not.toContain('android.permission.DETECT_SCREEN_CAPTURE');
  });

  it('keeps the offline and privacy blocks', () => {
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.READ_MEDIA_IMAGES',
      ]),
    );
    expect(config.android?.permissions).not.toContain('android.permission.INTERNET');
  });
});
