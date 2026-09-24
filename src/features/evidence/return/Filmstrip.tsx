/**
 * Compare filmstrip (UX §5, mockup e-compare): one frame per pair in walk order. A tick means
 * viewed, a vermilion dot means new damage, hatching means one side is missing, and the
 * current frame carries the accent outline.
 */
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import type { AnglePair } from '@/domain/types';
import { Icon, Text, Touchable } from '@/ui';
import { marker, palette, radii, rebate } from '@/ui/theme/tokens';

import { usePhotoUri } from '../photoFiles';
import { compareStatus, hasNewDamage } from '../returnPlan';

const FRAME_W = 44;
const FRAME_H = 33;
const ITEM_W = 52;

export interface FilmstripProps {
  pairs: readonly AnglePair[];
  index: number;
  onSelect: (index: number) => void;
}

export function Filmstrip({ pairs, index, onSelect }: FilmstripProps) {
  const scroll = useRef<ScrollView>(null);
  const width = useRef(0);

  useEffect(() => {
    const x = index * ITEM_W - width.current / 2 + ITEM_W / 2;
    scroll.current?.scrollTo({ x: Math.max(0, x), animated: true });
  }, [index]);

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
      contentContainerStyle={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel="Angles"
    >
      {pairs.map((p, i) => (
        <Frame key={`${p.angleKey}#${p.slot}`} pair={p} number={i + 1} current={i === index} onPress={() => onSelect(i)} />
      ))}
    </ScrollView>
  );
}

function Frame({ pair, number, current, onPress }: { pair: AnglePair; number: number; current: boolean; onPress: () => void }) {
  const photo = pair.after ?? pair.before;
  const uri = usePhotoUri(photo, 'thumb');
  const status = compareStatus(pair);
  const damaged = hasNewDamage(pair);
  const oneSided = !pair.before || !pair.after;
  const words = [pair.label, status === 'reviewed' ? 'viewed' : null, damaged ? 'new damage' : null, oneSided ? 'one photo missing' : null]
    .filter(Boolean)
    .join(', ');

  return (
    <Touchable
      onPress={onPress}
      noPressOpacity
      accessibilityRole="tab"
      accessibilityLabel={words}
      accessibilityState={{ selected: current }}
      hitSlop={{ top: 8, bottom: 8 }}
      style={styles.item}
    >
      <View style={[styles.frame, current && styles.current, !current && status !== 'reviewed' && styles.dim]}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" /> : null}
        {oneSided ? <Hatch /> : null}
      </View>
      <Text variant="code" tone={current ? 'primary' : 'secondary'} tabular>
        {number}
      </Text>
      {damaged ? (
        <View style={[styles.badge, styles.dot]} />
      ) : status === 'reviewed' ? (
        <View style={[styles.badge, styles.tick]}>
          <Icon icon={Check} size={12} color={palette.ink} />
        </View>
      ) : null}
    </Touchable>
  );
}

function Hatch() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern id="filmHatch" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <Rect width={1.5} height={5} fill={rebate.textSecondary} opacity={0.6} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#filmHatch)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, gap: 0 },
  item: { width: ITEM_W, alignItems: 'center', gap: 3, paddingTop: 6, minHeight: 48 },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    borderRadius: radii.photo,
    overflow: 'hidden',
    backgroundColor: rebate.surfaceTint,
  },
  current: { borderWidth: 2, borderColor: rebate.accent },
  dim: { opacity: 0.6 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { backgroundColor: rebate.text },
  dot: { backgroundColor: marker.new.badgeFill, borderWidth: 2, borderColor: rebate.background, width: 14, height: 14, top: 2, right: 4 },
});
