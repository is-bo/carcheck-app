import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { DatabaseZap } from 'lucide-react-native';

import { initializeData } from '@/data/db';
import { Button, Icon, screenPresets, Surface, Text, ToastHost, type ScreenPreset } from '@/ui';
import { fontAssets } from '@/ui/fonts';
import { layout, light } from '@/ui/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 200, fade: true });

/**
 * Route → presentation (UX_FLOWS §1 screen inventory). Matched on the root stack's child names,
 * so routes that land later pick up the right presentation without touching this file.
 */
const ROUTE_PRESETS: [RegExp, ScreenPreset][] = [
  [/^onboarding$/, 'onboarding'],
  [/^rental\/new$/, 'instant'],
  [/^rental\/\[id\]\/(start|return)$/, 'flow'],
  [/^rental\/\[id\]\/annotate\//, 'rebateCard'],
  [/^camera$/, 'rebateFullScreen'],
  [/^media\//, 'rebateFullScreen'],
  [/^(vehicle|customer)\/new$/, 'modalForm'],
];

function presetFor(routeName: string) {
  const hit = ROUTE_PRESETS.find(([re]) => re.test(routeName));
  return screenPresets[hit ? hit[1] : 'card'];
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  // A font failure must not brick an offline app: fall back to the system face and carry on.
  const fontsReady = fontsLoaded || fontError != null;

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(light.background).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {fontsReady ? (
          <DataGate>
            <Stack screenOptions={({ route }) => presetFor(route.name)}>
              <Stack.Screen name="(tabs)" />
            </Stack>
            <ToastHost />
          </DataGate>
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

type GateState = { status: 'pending' } | { status: 'ready' } | { status: 'failed'; error: unknown; retrying: boolean };

/**
 * Opens the database (migrations, interrupted-restore recovery) before any route renders. The
 * splash stays up until the first attempt settles, so a normal launch never flashes a loader.
 */
function DataGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    initializeData().then(
      () => alive && setState({ status: 'ready' }),
      (error: unknown) => alive && setState({ status: 'failed', error, retrying: false }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (state.status !== 'pending') SplashScreen.hideAsync().catch(() => {});
  }, [state.status]);

  if (state.status === 'pending') return null;
  if (state.status === 'ready') return <>{children}</>;
  return (
    <BootError
      error={state.error}
      retrying={state.retrying}
      onRetry={() => {
        setState({ ...state, retrying: true });
        setAttempt((n) => n + 1);
      }}
    />
  );
}

function BootError({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <Surface
      tone="paper"
      style={[styles.fill, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + layout.bottomActionInset }]}
    >
      <View style={[styles.errorBody, styles.column]}>
        <Icon icon={DatabaseZap} size={48} color={light.textTertiary} />
        <Text variant="headline" accessibilityRole="header" style={styles.errorTitle}>
          CarCheck couldn’t open its data
        </Text>
        <Text variant="body" tone="secondary" style={styles.errorText}>
          Your rentals and photos are stored on this phone. Try again. If it keeps failing, restart the phone.
        </Text>
        <Text variant="body" style={styles.errorText}>
          Don’t uninstall CarCheck: that deletes everything stored in it.
        </Text>
        <Text variant="bodySmall" tone="tertiary" selectable style={styles.errorCode}>
          {detail}
        </Text>
      </View>
      <View style={[styles.errorFooter, styles.column]}>
        <Button label="Try again" onPress={onRetry} loading={retrying} fullWidth />
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { width: '100%', maxWidth: 600, alignSelf: 'center' },
  errorBody: { flex: 1, paddingHorizontal: layout.screenGutter },
  errorTitle: { marginTop: 20 },
  errorText: { marginTop: 10 },
  errorCode: { marginTop: 20 },
  errorFooter: { paddingHorizontal: layout.screenGutter },
});
