/**
 * Framing guide for guided capture (UX §3, DESIGN "Camera & comparison chrome"): line-art of
 * the car as seen from each angle, a 2 dp white stroke over a 4.5 dp rebate halo with a 12%
 * white fill, so it stays visible in sun. Left/right are the vehicle's own sides.
 */
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { AngleKey } from '@/domain/types';
import type { Size } from '@/media/geometry';
import { overlay } from '@/ui/theme/tokens';

type View = 'side' | 'front' | 'rear' | 'quarterFront' | 'quarterRear' | 'dashboard';

/** Which drawing, and whether it is mirrored (nose on the right). */
const ANGLE_VIEWS: Record<string, { view: View; mirror: boolean }> = {
  front: { view: 'front', mirror: false },
  front_left: { view: 'quarterFront', mirror: false },
  left: { view: 'side', mirror: false },
  rear_left: { view: 'quarterRear', mirror: true },
  rear: { view: 'rear', mirror: false },
  rear_right: { view: 'quarterRear', mirror: false },
  right: { view: 'side', mirror: true },
  front_right: { view: 'quarterFront', mirror: true },
  dashboard: { view: 'dashboard', mirror: false },
};

// Drawn in a 400 x 300 box (the 4:3 frame); outline first, then detail lines.
const DRAWINGS: Record<View, { outline: string; detail: string; wheels: [number, number, number][] }> = {
  side: {
    outline:
      'M44 206L40 178Q42 158 70 154L140 146L178 104L276 102L322 140L352 146Q362 150 360 172L358 206L330 206' +
      'A30 30 0 0 0 270 206L130 206A30 30 0 0 0 70 206Z',
    detail: 'M152 146L184 110L270 109L308 146ZM226 110V200M40 190H58M344 176H358',
    wheels: [
      [100, 210, 24],
      [300, 210, 24],
    ],
  },
  front: {
    outline: 'M70 222L70 172Q72 150 96 145L126 96Q131 88 142 88L258 88Q269 88 274 96L304 145Q328 150 330 172L330 222Z',
    detail:
      'M136 100L264 100L291 141L109 141ZM84 160L134 166L134 178L84 176ZM316 160L266 166L266 178L316 176Z' +
      'M162 172L238 172L234 194L166 194ZM78 222V240H112V222M288 222V240H322V222M52 136L70 142M348 136L330 142',
    wheels: [],
  },
  rear: {
    outline: 'M70 222L70 168Q72 150 96 146L128 98Q133 90 144 90L256 90Q267 90 272 98L304 146Q328 150 330 168L330 222Z',
    detail:
      'M140 104L260 104L284 140L116 140ZM80 156L136 160L134 176L80 174ZM320 156L264 160L266 176L320 174Z' +
      'M168 182H232V200H168ZM78 222V240H112V222M288 222V240H322V222',
    wheels: [],
  },
  quarterFront: {
    outline:
      'M42 212L40 172Q44 152 64 148L122 146L152 140L190 104L286 100L330 136L356 142Q366 148 364 170L362 206L334 206' +
      'A26 26 0 0 0 284 206L178 210A28 28 0 0 0 122 212Z',
    detail: 'M160 140L196 110L280 107L316 138ZM122 146V212M50 160L80 162L80 172L48 170ZM96 162L116 162L116 172L96 172ZM236 108V204',
    wheels: [
      [150, 214, 25],
      [309, 210, 21],
    ],
  },
  quarterRear: {
    outline:
      'M42 212L40 168Q44 150 64 146L122 144L152 138L184 106L282 102L330 136L356 142Q366 148 364 170L362 206L334 206' +
      'A26 26 0 0 0 284 206L178 210A28 28 0 0 0 122 212Z',
    detail: 'M156 138L188 110L276 106L314 138ZM122 144V212M48 156L82 158L80 170L46 168ZM94 186H116V198H94ZM232 106V204',
    wheels: [
      [150, 214, 25],
      [309, 210, 21],
    ],
  },
  dashboard: {
    outline: 'M40 230Q40 90 200 84Q360 90 360 230Z',
    detail: 'M150 170m-44 0a44 44 0 1 0 88 0a44 44 0 1 0 -88 0M250 170m-44 0a44 44 0 1 0 88 0a44 44 0 1 0 -88 0M150 170L126 148M250 170L276 150',
    wheels: [],
  },
};

const GROUND = 'M16 236H384';

export function hasAngleGuide(angleKey: AngleKey): boolean {
  return angleKey in ANGLE_VIEWS;
}

export function AngleGuide({ angleKey, frame }: { angleKey: AngleKey; frame: Size }) {
  const spec = ANGLE_VIEWS[angleKey];
  if (!spec) return null;
  const d = DRAWINGS[spec.view];
  const layer = (stroke: string, width: number, fill: boolean) => (
    <G>
      <Path
        d={d.outline}
        fill={fill ? overlay.guideFill : 'none'}
        stroke={stroke}
        strokeWidth={width}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <Path d={d.detail} fill="none" stroke={stroke} strokeWidth={width * 0.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {d.wheels.map(([cx, cy, r]) => (
        <Circle key={`${cx}`} cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={width} vectorEffect="non-scaling-stroke" />
      ))}
      {spec.view !== 'dashboard' ? (
        <Path d={GROUND} stroke={stroke} strokeWidth={width * 0.75} strokeDasharray={[6, 8]} vectorEffect="non-scaling-stroke" />
      ) : null}
    </G>
  );
  return (
    <Svg width={frame.width} height={frame.height} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
      <G transform={spec.mirror ? 'translate(400 0) scale(-1 1)' : undefined}>
        {layer(overlay.guideHalo, 4.5, true)}
        {layer(overlay.guideStroke, 2, false)}
      </G>
    </Svg>
  );
}
