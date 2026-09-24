/**
 * A photo with its damage rings drawn at constant screen weight, for places that show marks
 * without editing them: contract review, the customer hand-off, known-damage suggestions.
 * Badges sit on the ring at 45° upper-right, never over the damage (DESIGN "Damage markers").
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import type { DamageStatus } from '@/domain/types';
import type { Ring } from '@/media/geometry';
import { MarkerBadge } from '@/ui';
import { marker, markerGeometry, palette, radii } from '@/ui/theme/tokens';

import { usePhotoUri, type PhotoRef, type PhotoVariant } from '../inspection/photoFiles';

export interface PhotoMark {
  key: string;
  status: DamageStatus;
  /** Badge text ("A", "2", "3?"). */
  label: string;
  ring: Ring;
  /** Dashed "same area" suggestion (known damage carried over), never a status. */
  reference?: boolean;
}

export interface MarkedPhotoProps {
  photo: PhotoRef | null;
  /** Upright pixel size of the photo (for the aspect and the ring radius). */
  size: { width: number; height: number };
  marks: readonly PhotoMark[];
  variant?: PhotoVariant;
  badgeSize?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const SIN45 = Math.SQRT1_2;

export function MarkedPhoto({
  photo,
  size,
  marks,
  variant = 'display',
  badgeSize = markerGeometry.badgeSize,
  accessibilityLabel,
  style,
}: MarkedPhotoProps) {
  const uri = usePhotoUri(photo, variant);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
  };
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 4 / 3;

  return (
    <View
      style={[styles.frame, { aspectRatio: aspect }, style]}
      onLayout={onLayout}
      accessible={!!accessibilityLabel}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} accessible={false} /> : null}
      {box ? (
        <>
          <Svg width={box.width} height={box.height} style={StyleSheet.absoluteFill} pointerEvents="none">
            {marks.map((m) => {
              const t = marker[m.status === 'pre_existing' ? 'existing' : m.status];
              const cx = m.ring.x * box.width;
              const cy = m.ring.y * box.height;
              const r = Math.max(m.ring.r * Math.min(box.width, box.height), markerGeometry.ringMinRadius / 2);
              const dash = m.reference ? [...markerGeometry.referenceDash] : undefined;
              return (
                <G key={m.key}>
                  <Circle cx={cx} cy={cy} r={r} fill="none" stroke={t.ringHalo} strokeWidth={markerGeometry.ringHalo} strokeOpacity={m.reference ? 0.7 : 1} />
                  <Circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={m.reference && m.status === 'pre_existing' ? palette.rule : t.ringCore}
                    strokeWidth={markerGeometry.ringCore}
                    strokeDasharray={dash}
                  />
                </G>
              );
            })}
          </Svg>
          {marks.map((m) => {
            const r = Math.max(m.ring.r * Math.min(box.width, box.height), markerGeometry.ringMinRadius / 2);
            const cx = m.ring.x * box.width + r * SIN45;
            const cy = m.ring.y * box.height - r * SIN45;
            const left = Math.min(Math.max(cx - badgeSize / 2, 0), box.width - badgeSize);
            const top = Math.min(Math.max(cy - badgeSize / 2, 0), box.height - badgeSize);
            return (
              <View key={`${m.key}:b`} style={[styles.badge, { left, top }]} pointerEvents="none">
                <MarkerBadge status={m.status} label={m.label} size={badgeSize} reference={m.reference} accessible={false} />
              </View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: radii.photo, overflow: 'hidden', backgroundColor: palette.paper2 },
  badge: { position: 'absolute' },
});
