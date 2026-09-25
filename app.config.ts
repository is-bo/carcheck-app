import type { ConfigContext, ExpoConfig } from 'expo/config';

import pkg from './package.json';

// CI sets CARCHECK_VERSION_CODE (monotonic, e.g. the GitHub run number) so every side-loaded
// APK installs over the previous one. Local builds fall back to 1.
const versionCode = Number(process.env.CARCHECK_VERSION_CODE ?? '1');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'CarCheck',
  slug: 'carcheck',
  scheme: 'carcheck',
  version: pkg.version,
  // Unlocked: exterior angles are shot in landscape; signature and comparison use both (UX_FLOWS).
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.carcheck.app',
    buildNumber: String(versionCode),
    supportsTablet: true,
    infoPlist: {
      // "Save image" in the share sheet writes to Photos; iOS terminates the app without this key.
      NSPhotoLibraryAddUsageDescription:
        'CarCheck saves evidence images to your photo library only when you choose "Save Image" in the share sheet.',
      // Defensive: the system photo picker (PHPicker) used for ID/vehicle/logo import normally needs
      // no permission, but iOS terminates the app if it ever does touch PHPhotoLibrary and this key
      // is missing. Harmless to ship even if never triggered (see docs/reviews/security-ios.md M3).
      NSPhotoLibraryUsageDescription:
        'CarCheck reads a photo only when you choose one for a customer ID, vehicle photo or agency logo.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.carcheck.app',
    versionCode,
    // Customer IDs and signatures must never reach Google Drive auto-backup.
    allowBackup: false,
    permissions: ['android.permission.CAMERA'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      // expo-screen-capture declares this for screenshot detection below Android 14, which
      // CarCheck does not use; the module checks it before use, so blocking it is safe.
      'android.permission.READ_MEDIA_IMAGES',
      // NOT blocked: android.permission.DETECT_SCREEN_CAPTURE. On Android 14+ expo-screen-capture
      // registers a screen-capture callback as soon as the module loads, and without this
      // (install-time, no-prompt) permission Android throws and the app dies at startup.
    ],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-image',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'CarCheck uses the camera to photograph vehicles and documents for condition reports.',
        microphonePermission: false,
        recordAudioAndroid: false,
        // Drops the ML Kit barcode dependency (Play Services model download, larger APK).
        barcodeScannerEnabled: false,
      },
    ],
    'react-native-zip-archive',
    './plugins/withReleaseOffline',
  ],
  experiments: {
    typedRoutes: true,
  },
});
