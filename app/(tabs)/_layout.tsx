import { useWindowDimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useReducedMotion } from 'react-native-reanimated';
import { Car, KeyRound, Settings, Users } from 'lucide-react-native';

import { AppBar, IconButton, NavigationBar, type LucideIcon } from '@/ui';
import { light } from '@/ui/theme/tokens';

const TAB_ICONS: Record<string, LucideIcon> = {
  index: KeyRound,
  vehicles: Car,
  customers: Users,
};

// Typed routes are generated as the route files land; these two exist by the UX_FLOWS inventory.
const SETTINGS = '/settings' as Href;
const DEV_KIT = '/dev/kit' as Href;

/** Settings is not a tab: a 48 dp gear in the app bar of every tab root. */
function SettingsAction() {
  return (
    <IconButton
      icon={Settings}
      accessibilityLabel="Settings"
      onPress={() => router.push(SETTINGS)}
      // Dev builds only: long-press opens the component kit for design review.
      onLongPress={__DEV__ ? () => router.push(DEV_KIT) : undefined}
    />
  );
}

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const rail = width >= 600;

  return (
    <Tabs
      tabBar={(props) => <NavigationBar {...props} icons={TAB_ICONS} rail={rail} />}
      screenOptions={{
        tabBarPosition: rail ? 'left' : 'bottom',
        header: ({ options }) => <AppBar title={options.title ?? ''} actions={<SettingsAction />} />,
        animation: reduceMotion ? 'none' : 'fade',
        sceneStyle: { backgroundColor: light.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Rentals' }} />
      <Tabs.Screen name="vehicles" options={{ title: 'Vehicles' }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers' }} />
    </Tabs>
  );
}
