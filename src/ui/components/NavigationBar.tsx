import { StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { useSurface } from '../surface';
import { layout, lines, radii } from '../theme/tokens';
import { Icon, type LucideIcon } from './Icon';
import { Text } from './Text';
import { useToastAnchor } from './Toast';
import { Touchable } from './Touchable';

export interface NavigationBarProps extends BottomTabBarProps {
  /** Glyph per route name. */
  icons: Record<string, LucideIcon>;
  /** Expanded width: vertical rail on the left instead of the bottom bar. */
  rail?: boolean;
}

/**
 * Material navigation bar (80 dp) with a 56×32 cyanotype-wash indicator behind the selected
 * icon; becomes a navigation rail on expanded widths.
 */
export function NavigationBar({ state, descriptors, navigation, insets, icons, rail = false }: NavigationBarProps) {
  const { colors } = useSurface();
  const anchor = useToastAnchor();

  const items = state.routes.map((route, index) => {
    const { options } = descriptors[route.key];
    const label = options.title ?? route.name;
    const focused = state.index === index;
    const glyph = icons[route.name];

    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };

    return (
      <Touchable
        key={route.key}
        onPress={onPress}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        rippleRadius={32}
        noPressOpacity
        focusRadius={radii.lg}
        accessibilityRole="tab"
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        accessibilityState={{ selected: focused }}
        style={rail ? styles.railItem : styles.barItem}
      >
        <View style={[styles.indicator, focused && { backgroundColor: colors.accentWash }]}>
          {glyph ? <Icon icon={glyph} color={focused ? colors.accent : colors.textSecondary} /> : null}
        </View>
        <Text
          variant={focused ? 'captionStrong' : 'caption'}
          tone={focused ? 'primary' : 'secondary'}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Touchable>
    );
  });

  if (rail) {
    return (
      <View
        accessibilityRole="tablist"
        style={[
          styles.rail,
          {
            paddingTop: insets.top + 12,
            paddingLeft: insets.left,
            borderRightColor: colors.divider,
            backgroundColor: colors.background,
          },
        ]}
      >
        {items}
      </View>
    );
  }

  return (
    <View
      {...anchor}
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          borderTopColor: colors.divider,
          backgroundColor: colors.background,
        },
      ]}
    >
      {items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: lines.divider },
  barItem: { flex: 1, height: layout.navBarHeight, alignItems: 'center', justifyContent: 'center', gap: 4 },
  rail: { width: 80, borderRightWidth: lines.divider, gap: 12 },
  railItem: { height: 64, alignItems: 'center', justifyContent: 'center', gap: 4 },
  indicator: { width: 56, height: 32, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
});
