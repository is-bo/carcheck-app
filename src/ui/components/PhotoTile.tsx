import { StyleSheet, View } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { Camera } from 'lucide-react-native';

import type { DamageStatus } from '@/domain/types';

import { plural } from '../format';
import { useSurface } from '../surface';
import { markerGeometry, overlay, palette, radii } from '../theme/tokens';
import { Icon } from './Icon';
import { MarkerBadge, markerName } from './MarkerBadge';
import { Text } from './Text';
import { Touchable } from './Touchable';

export type PhotoTileState = 'empty' | 'captured' | 'skipped' | 'damaged';

export interface TileMark {
  status: DamageStatus;
  label: string;
}

export interface PhotoTileProps {
  /** Angle name ("Front left"); shown in the edge code under the frame. */
  label: string;
  state: PhotoTileState;
  /** Thumbnail: a file URI string or an expo-image source. */
  source?: ImageSource | string | null;
  /** Marks on this photo; glyphs sit top-right (max three, then "+n"). */
  marks?: readonly TileMark[];
  /** Skipped reason word ("Blocked"). */
  skipReason?: string | null;
  /** Replaces the default caption ("FRONT LEFT · 2 MARKS"). */
  caption?: string;
  /** Current / selected (filmstrip, picker): 2 dp accent outline with 2 dp offset. */
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
}

/**
 * Angle capture tile (Condition grid): a 4:3 frame at 2 dp radius with an edge-code caption
 * beneath. Width follows the parent; place tiles in a grid.
 */
export function PhotoTile({
  label,
  state,
  source,
  marks = [],
  skipReason,
  caption,
  selected,
  onPress,
  onLongPress,
  accessibilityHint,
}: PhotoTileProps) {
  const { tone, colors } = useSurface();
  const dark = tone === 'rebate';
  const hasPhoto = (state === 'captured' || state === 'damaged') && source != null;
  const markCount = marks.length;

  const code =
    caption ??
    (state === 'skipped'
      ? `${label} · Skipped`
      : state === 'empty'
        ? `${label} · Not taken`
        : markCount > 0
          ? `${label} · ${plural(markCount, '{n} mark', '{n} marks')}`
          : label);

  const spoken = [
    label,
    state === 'skipped' ? `skipped${skipReason ? `, ${skipReason}` : ''}` : state === 'empty' ? 'not taken yet' : null,
    markCount > 0 ? marks.map((m) => markerName(m.status, m.label)).join(', ') : hasPhoto ? 'no marks' : null,
  ]
    .filter(Boolean)
    .join('. ');

  const frame = (
    <View>
      <View>
        <View style={[styles.frame, { backgroundColor: dark ? palette.rebate2 : colors.surfaceTint }]}>
          {hasPhoto ? (
            <Image
              source={typeof source === 'string' ? { uri: source } : source}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={120}
              accessible={false}
            />
          ) : state === 'skipped' ? (
            <>
              <Hatch color={dark ? palette.rebateRule : palette.rule} />
              <View style={styles.centerLabel}>
                <Text variant="label" tone="secondary" align="center">
                  {skipReason ? `Skipped · ${skipReason}` : 'Skipped'}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.centerLabel}>
              <Icon icon={Camera} color={colors.textTertiary} />
            </View>
          )}
          {markCount > 0 ? (
            <View style={styles.marks} pointerEvents="none">
              {marks.slice(0, 3).map((m, i) => (
                <MarkerBadge
                  key={`${m.status}${m.label}${i}`}
                  status={m.status}
                  label={m.label}
                  size={markerGeometry.badgeMinThumbnail}
                  accessible={false}
                />
              ))}
              {markCount > 3 ? (
                <View style={styles.more}>
                  <Text variant="caption" color={palette.onRebate} tabular>
                    +{markCount - 3}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {selected ? <View pointerEvents="none" style={[styles.selected, { borderColor: colors.accent }]} /> : null}
      </View>
      <Text variant="code" tone="secondary" numberOfLines={1} style={styles.caption}>
        {code}
      </Text>
    </View>
  );

  if (!onPress && !onLongPress) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={spoken}>
        {frame}
      </View>
    );
  }
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      focusRadius={radii.photo}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected }}
    >
      {frame}
    </Touchable>
  );
}

/** 45° hatching: the "one side missing / skipped" texture. */
function Hatch({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width={2} height={6} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#hatch)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radii.photo,
    overflow: 'hidden',
  },
  selected: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderRadius: radii.photo + 4,
  },
  centerLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  marks: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 3, alignItems: 'center' },
  more: {
    minWidth: 22,
    height: 22,
    borderRadius: radii.plate,
    paddingHorizontal: 4,
    backgroundColor: overlay.tagBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: { marginTop: 6 },
});
