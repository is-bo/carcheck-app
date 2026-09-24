import { StyleSheet, Text as RNText, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import type { DamageStatus } from '@/domain/types';

import { marker, markerGeometry, palette, type, type DamageStatus as TokenStatus } from '../theme/tokens';

const tokenStatus = (s: DamageStatus): TokenStatus => (s === 'pre_existing' ? 'existing' : s);

export interface MarkerBadgeProps {
  status: DamageStatus;
  /** Letter or number, from markerLabel(): "A", "2", "2?". */
  label: string;
  /** dp. 26 on photos, 30 in customer mode, 22 to 28 as list glyphs. */
  size?: number;
  /**
   * Dashed hollow badge: "the same area" on the counterpart photo. Dashed always means
   * reference, never a status.
   */
  reference?: boolean;
  /** Off when the adjacent text already names the mark ("New 1 · Dent…"). */
  accessible?: boolean;
}

/** Spoken name of a mark: "New 1", "Existing A", "Uncertain 2". */
export function markerName(status: DamageStatus, label: string): string {
  return `${marker[tokenStatus(status)].label} ${label.replace('?', '')}`;
}

/**
 * Damage badge. Shape carries status (DECISIONS.md): hollow square + letter = pre-existing,
 * filled vermilion circle + number = new, amber diamond + number? = uncertain. Readable in
 * greyscale because the shape and the label differ, not just the colour.
 */
export function MarkerBadge({
  status,
  label,
  size = markerGeometry.badgeSize,
  reference = false,
  accessible = true,
}: MarkerBadgeProps) {
  const m = marker[tokenStatus(status)];
  // Drawn in a 26-unit box so strokes scale with the badge, matching the mockup glyphs.
  const u = size / 26;
  const dash = reference ? [4, 3] : undefined;
  const refInk = status === 'pre_existing' ? palette.ink3 : m.uiColor;

  const textColor = reference ? refInk : m.badgeText;
  let shape;
  if (m.badgeShape === 'square') {
    shape = (
      <Rect
        x={2.5}
        y={2.5}
        width={21}
        height={21}
        rx={2}
        fill={palette.white}
        stroke={reference ? refInk : m.badgeBorder}
        strokeWidth={2.2}
        strokeDasharray={dash}
      />
    );
  } else if (m.badgeShape === 'circle') {
    shape = reference ? (
      <Circle cx={13} cy={13} r={11} fill={palette.white} stroke={refInk} strokeWidth={2.2} strokeDasharray={dash} />
    ) : (
      <Circle cx={13} cy={13} r={11.2} fill={m.badgeFill} stroke={m.badgeBorder} strokeWidth={1.8} />
    );
  } else {
    shape = (
      <Rect
        x={3.5}
        y={3.5}
        width={19}
        height={19}
        rx={1.5}
        transform="rotate(45 13 13)"
        fill={reference ? palette.white : m.badgeFill}
        stroke={reference ? refInk : m.badgeBorder}
        strokeWidth={1.8}
        strokeDasharray={dash}
      />
    );
  }

  // The diamond's inscribed square is smaller; "2?" needs the tighter size.
  const long = label.length > 1;
  const fontSize = (m.badgeShape === 'diamond' ? (long ? 10.5 : 12.5) : long ? 12 : 14) * u;

  return (
    <View
      accessible={accessible}
      accessibilityRole="image"
      accessibilityLabel={
        accessible ? (reference ? `Same area as ${markerName(status, label)}` : markerName(status, label)) : undefined
      }
      importantForAccessibility={accessible ? 'yes' : 'no-hide-descendants'}
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size} viewBox="0 0 26 26" style={StyleSheet.absoluteFill}>
        {shape}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <RNText
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            fontFamily: type.markerNumber.fontFamily,
            fontVariant: ['tabular-nums'],
            fontSize,
            lineHeight: fontSize * 1.15,
            color: textColor,
            includeFontPadding: false,
            textAlign: 'center',
          }}
        >
          {label}
        </RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
