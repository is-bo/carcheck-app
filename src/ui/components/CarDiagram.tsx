import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import Animated, {
  cancelAnimation,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { EXTERIOR_ANGLE_KEYS, exteriorAngleLabels, orbitDegrees, type ExteriorAngleKey } from '../angles';
import { useSurface } from '../surface';
import { palette } from '../theme/tokens';
import { Touchable } from './Touchable';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type AngleState = 'pending' | 'done' | 'skipped' | 'new-damage';

export interface CarDiagramProps {
  /** Per-angle state; missing keys are pending. */
  states?: Partial<Record<ExteriorAngleKey, AngleState>>;
  /** Where the photographer stands now: cyanotype segment plus a camera dot outside the ring. */
  current?: ExteriorAngleKey | null;
  /** dp. 88 to 96 on the capture rail, 240 in the angle picker sheet. */
  size?: number;
  /** Angle picker: each segment becomes a 48 dp target. Needs size >= 200. */
  onSelectAngle?: (key: ExteriorAngleKey) => void;
  /** The whole diagram as one button (capture rail opens the picker). */
  onPress?: () => void;
  labels?: Partial<Record<ExteriorAngleKey, string>>;
}

const VIEW = 108; // viewBox -54..54, as in the mockups
const RING = 40;
const HALF_SPAN = 17; // degrees each side of an angle's centre
const DOT_RADIUS = 47;

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (deg: number, r: number) => ({ x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)) });

function arcPath(center: number): string {
  const a = polar(center - HALF_SPAN, RING);
  const b = polar(center + HALF_SPAN, RING);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)}A${RING} ${RING} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

const stateWords: Record<AngleState, string> = {
  pending: 'not taken',
  done: 'taken',
  skipped: 'skipped',
  'new-damage': 'new damage',
};

/**
 * Angle orbit: a top-down car (nose up, the car's left on screen-left) ringed by 8 arc segments
 * in walk order. The same diagram appears in capture, the angle picker, rental detail and report.
 */
export function CarDiagram({ states = {}, current, size = 92, onSelectAngle, onPress, labels }: CarDiagramProps) {
  const { tone, colors } = useSurface();
  const reduceMotion = useReducedMotion();
  const dark = tone === 'rebate';
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!current || reduceMotion) {
      pulse.set(1);
      return;
    }
    pulse.set(0.6);
    pulse.set(withRepeat(withTiming(1, { duration: 800 }), -1, true));
    return () => cancelAnimation(pulse);
  }, [current, reduceMotion, pulse]);

  const dotProps = useAnimatedProps(() => ({ opacity: pulse.get() }));

  const segColor = (state: AngleState, isCurrent: boolean) => {
    if (isCurrent) return colors.accent;
    switch (state) {
      case 'done':
        return dark ? palette.onRebate : palette.ink;
      case 'new-damage':
        return palette.vermilion;
      case 'skipped':
        return dark ? palette.onRebate2 : palette.ink3;
      default:
        return dark ? palette.rebateRule : palette.rule;
    }
  };

  const car = {
    body: dark ? palette.rebate3 : palette.white,
    line: dark ? palette.onRebate2 : palette.ink2,
    glass: dark ? palette.rebate : palette.rule,
  };

  const nameOf = (k: ExteriorAngleKey) => labels?.[k] ?? exteriorAngleLabels[k];
  const done = EXTERIOR_ANGLE_KEYS.filter((k) => states[k] === 'done' || states[k] === 'new-damage').length;
  const summary = current
    ? `Angle ${EXTERIOR_ANGLE_KEYS.indexOf(current) + 1} of 8, ${nameOf(current)}. ${done} of 8 taken.`
    : `${done} of 8 angles taken.`;

  const dot = current ? polar(orbitDegrees[current], DOT_RADIUS) : null;
  const scale = size / VIEW;

  const diagram = (
    <Svg width={size} height={size} viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`}>
      <G>
        <Path
          d="M-13 -8l-5 1v4h5M13 -8l5 1v4h-5"
          fill={car.body}
          stroke={car.line}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <Rect x={-13} y={-26} width={26} height={52} rx={8} fill={car.body} stroke={car.line} strokeWidth={1.5} />
        <Path d="M-10 -11H10L8 -4H-8ZM-8 13H8L10 18H-10Z" fill={car.glass} />
        <Path d="M-8 -24h5M3 -24h5" stroke={car.line} strokeWidth={1.5} strokeLinecap="round" />
      </G>
      {EXTERIOR_ANGLE_KEYS.map((k) => {
        const state = states[k] ?? 'pending';
        return (
          <Path
            key={k}
            d={arcPath(orbitDegrees[k])}
            fill="none"
            stroke={segColor(state, k === current)}
            strokeWidth={7}
            strokeLinecap="butt"
            strokeDasharray={state === 'skipped' && k !== current ? [2, 2.5] : undefined}
          />
        );
      })}
      {dot ? (
        <>
          <Circle cx={dot.x} cy={dot.y} r={6.5} fill={dark ? 'rgba(127,166,230,0.28)' : 'rgba(31,78,150,0.18)'} />
          <AnimatedCircle cx={dot.x} cy={dot.y} r={3.5} fill={colors.accent} animatedProps={dotProps} />
        </>
      ) : null}
    </Svg>
  );

  if (onSelectAngle) {
    return (
      <View style={{ width: size, height: size }} accessibilityRole="radiogroup" accessibilityLabel={summary}>
        {diagram}
        {EXTERIOR_ANGLE_KEYS.map((k) => {
          const p = polar(orbitDegrees[k], RING);
          const state = states[k] ?? 'pending';
          return (
            <Touchable
              key={k}
              onPress={() => onSelectAngle(k)}
              rippleRadius={24}
              focusRadius={24}
              accessibilityRole="radio"
              accessibilityLabel={`${nameOf(k)}, ${stateWords[state]}`}
              accessibilityState={{ selected: k === current, checked: k === current }}
              style={[styles.target, { left: size / 2 + p.x * scale - 24, top: size / 2 + p.y * scale - 24 }]}
            />
          );
        })}
      </View>
    );
  }

  if (onPress) {
    return (
      <Touchable
        onPress={onPress}
        rippleRadius={size / 2}
        focusRadius={size / 2}
        accessibilityRole="button"
        accessibilityLabel={summary}
        accessibilityHint="Choose another angle"
        style={{
          width: Math.max(size, 48),
          height: Math.max(size, 48),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {diagram}
      </Touchable>
    );
  }

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ width: size, height: size }}>
      {diagram}
    </View>
  );
}

const styles = StyleSheet.create({
  target: { position: 'absolute', width: 48, height: 48, borderRadius: 24 },
});
