import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';

import { colorsFor, Surface, useSurface, type SurfaceTone } from '../surface';
import { layout, touch } from '../theme/tokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

/** Content column on tablets and landscape (DESIGN.md › Layout). */
export const MAX_CONTENT_WIDTH = 600;

/* ------------------------------------------------------------------ */
/* Top bars                                                            */
/* ------------------------------------------------------------------ */

export type Leading = 'back' | 'close' | 'none' | ReactNode;

export interface TopBarProps {
  title?: string;
  subtitle?: string;
  leading?: Leading;
  onLeadingPress?: () => void;
  /** Trailing IconButtons (max two; the rest go in an overflow). */
  actions?: ReactNode;
  /** Add the status-bar inset above the bar. Screen passes true. */
  insetTop?: boolean;
}

/** 56 dp stack top bar: ← / ✕, Title M with an optional one-line subtitle, trailing actions. */
export function TopBar({ title, subtitle, leading: leadingProp, onLeadingPress, actions, insetTop }: TopBarProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const leading = leadingProp ?? (navigation.canGoBack() ? 'back' : 'none');
  const goBack = onLeadingPress ?? (() => navigation.canGoBack() && navigation.goBack());

  let lead: ReactNode = null;
  if (leading === 'back') lead = <IconButton icon={ArrowLeft} accessibilityLabel="Back" onPress={goBack} />;
  else if (leading === 'close') lead = <IconButton icon={X} accessibilityLabel="Close" onPress={goBack} />;
  else if (leading !== 'none') lead = leading;

  return (
    <View
      style={{ paddingTop: insetTop ? insets.top : 0, paddingLeft: 4 + insets.left, paddingRight: 4 + insets.right }}
    >
      <View style={styles.topBarRow}>
        {lead ?? <View style={styles.leadSpacer} />}
        <View style={styles.titles}>
          {title ? (
            <Text variant="titleM" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="subtitle" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

export interface AppBarProps {
  title: string;
  actions?: ReactNode;
  insetTop?: boolean;
}

/** 64 dp tab-root bar: Headline title ("Rentals") and the settings gear. */
export function AppBar({ title, actions, insetTop = true }: AppBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useSurface();
  return (
    <View
      style={{
        backgroundColor: colors.background,
        paddingTop: insetTop ? insets.top : 0,
        paddingLeft: layout.screenGutter + insets.left,
        paddingRight: 4 + insets.right,
      }}
    >
      <View style={styles.appBarRow}>
        <Text variant="headline" numberOfLines={1} accessibilityRole="header" style={styles.appBarTitle}>
          {title}
        </Text>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export interface ScreenProps {
  children?: ReactNode;
  /** Paper for lists and forms; rebate wherever a photo is the subject. */
  tone?: SurfaceTone;
  title?: string;
  subtitle?: string;
  leading?: Leading;
  onLeadingPress?: () => void;
  actions?: ReactNode;
  /** Replace the top bar (StepHeader, customer header) or `false` for none (camera). */
  header?: ReactNode | false;
  /** Wrap children in a ScrollView. Lists pass false and bring their own FlatList. */
  scroll?: boolean;
  /** Bottom-anchored action area, usually an <ActionFooter>. */
  footer?: ReactNode;
  /** Absolutely-positioned layers above everything (BottomSheet). */
  overlay?: ReactNode;
  /** Which safe-area edges this screen pads. Tab screens pass { top: false, bottom: false }. */
  insets?: { top?: boolean; bottom?: boolean };
  /** Constrain content to a 600 dp column (default on paper). */
  column?: boolean;
  /** A Fab floats over the content: keep the last row's trailing action clear of it. */
  fabClearance?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Screen scaffold: surface tone + status bar, safe areas, top bar, body, footer, overlays.
 * Flows are edge-to-edge; nothing sits under the notch or the gesture bar.
 */
export function Screen({
  children,
  tone = 'paper',
  title,
  subtitle,
  leading,
  onLeadingPress,
  actions,
  header,
  scroll = false,
  footer,
  overlay,
  insets: edges,
  column,
  fabClearance = false,
  contentStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padTop = edges?.top ?? true;
  const padBottom = edges?.bottom ?? true;
  const useColumn = column ?? tone === 'paper';

  const bar =
    header === false ? null : header !== undefined ? (
      header
    ) : title || leading || actions ? (
      <TopBar title={title} subtitle={subtitle} leading={leading} onLeadingPress={onLeadingPress} actions={actions} />
    ) : null;

  const columnStyle = useColumn ? styles.column : null;
  const bottomPad = (!footer && padBottom ? insets.bottom : 0) + (fabClearance ? FAB_CLEARANCE : 0);

  return (
    <Surface tone={tone} style={styles.fill} testID={testID}>
      <StatusBar style={tone === 'rebate' ? 'light' : 'dark'} />
      <View style={[styles.fill, { paddingTop: padTop ? insets.top : 0 }]}>
        {bar}
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[columnStyle, { paddingBottom: bottomPad + 24 }, contentStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, columnStyle, { paddingBottom: bottomPad }, contentStyle]}>{children}</View>
        )}
        {footer ? <View style={columnStyle}>{footer}</View> : null}
      </View>
      {overlay}
    </Surface>
  );
}

const FAB_CLEARANCE = touch.fabHeight + layout.bottomActionInset * 2;

/** Colours of a tone without a context (navigation options, native backgrounds). */
export const screenBackground = (tone: SurfaceTone) => colorsFor(tone).background;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  topBarRow: { height: layout.topBarHeight, flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadSpacer: { width: 12 },
  titles: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  appBarRow: { height: layout.appBarHeight, flexDirection: 'row', alignItems: 'center', gap: 4 },
  appBarTitle: { flex: 1 },
});
