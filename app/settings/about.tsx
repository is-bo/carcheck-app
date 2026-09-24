import { StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import Constants from 'expo-constants';
import { WifiOff } from 'lucide-react-native';

import { STARTER_TEMPLATE_NOTICE } from '@/domain/contract';
import { Banner, Button, ListRow, ListSection, Screen, SectionHeader, Text } from '@/ui';
import { layout, space } from '@/ui/theme/tokens';

const VERSION = Constants.expoConfig?.version ?? '—';
// Cast until typed routes regenerate (matches app/(tabs)/_layout.tsx).
const CONTRACT_TEMPLATE = '/settings/contract-template' as Href;

/** Settings → About (UX_FLOWS §1 inventory: `app/settings/about.tsx`). */
export default function AboutScreen() {
  return (
    <Screen title="About" scroll>
      <View style={styles.intro}>
        <Text variant="titleL" accessibilityRole="header">
          CarCheck
        </Text>
        <Text variant="body" tone="secondary">
          Vehicle condition evidence, documented on the phone.
        </Text>
        <Text variant="bodySmall" tone="tertiary" tabular style={styles.version}>
          Version {VERSION}
        </Text>
      </View>

      <View style={styles.pad}>
        <Banner
          icon={WifiOff}
          message="CarCheck works entirely offline. There is no account, no cloud and no network connection at any point — everything stays on this phone."
        />
      </View>

      <SectionHeader title="Contract disclaimer" />
      <View style={styles.pad}>
        <Text variant="body" tone="secondary">
          {STARTER_TEMPLATE_NOTICE}
        </Text>
        <Button
          label="Edit contract template"
          variant="quiet"
          size="small"
          onPress={() => router.push(CONTRACT_TEMPLATE)}
          style={styles.quietAction}
        />
      </View>

      <SectionHeader title="Licences" />
      <View style={styles.pad}>
        <Text variant="body" tone="secondary">
          CarCheck is built with Expo and React Native, and uses open-source components including
          Barlow and Barlow Semi Condensed (SIL Open Font License 1.1, Google Fonts), Lucide icons
          (ISC License) and Skia (BSD 3-Clause). Each package keeps its own licence.
        </Text>
      </View>

      <ListSection title="On this phone">
        <ListRow
          title="Data storage"
          subtitle="App-private storage only — nothing is written to the photo gallery or media store."
        />
      </ListSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: layout.screenGutter, paddingTop: space[3], gap: space[1] },
  version: { marginTop: space[2] },
  pad: { paddingHorizontal: layout.screenGutter, gap: space[4], paddingBottom: space[3] },
  quietAction: { alignSelf: 'flex-start', marginLeft: -12 },
});
