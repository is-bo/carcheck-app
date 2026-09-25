/**
 * Framing guide for guided capture (UX §3, DESIGN "Camera & comparison chrome"): line-art of
 * the car as seen from each angle, a 2 dp white stroke over a 4.5 dp rebate halo with a 12%
 * white fill, so it stays visible in sun. Left/right are the vehicle's own sides.
 *
 * The four diagonal views are true 3/4 perspectives: scripts/quarter-guides.py projects a simple
 * 3D car from 45° (front-left and rear-left) and traces the silhouette, so the front or rear face,
 * the receding side and the elliptical wheels sit where they do on a real car. The right-hand
 * diagonals are the left-hand ones mirrored (a car is symmetric); front and rear are separate.
 */
import Svg, { Circle, G, Path } from 'react-native-svg';

import type { AngleKey } from '@/domain/types';
import type { Size } from '@/media/geometry';
import { overlay } from '@/ui/theme/tokens';

type View = 'side' | 'front' | 'rear' | 'quarterFront' | 'quarterRear' | 'dashboard';

/** Which drawing, and whether it is mirrored. Standing at the car's left, its nose points left. */
const ANGLE_VIEWS: Record<string, { view: View; mirror: boolean }> = {
  front: { view: 'front', mirror: false },
  // Front face on the left, the car's left side running away to the right.
  front_left: { view: 'quarterFront', mirror: false },
  left: { view: 'side', mirror: false },
  // Rear face on the right, the car's left side running away to the left.
  rear_left: { view: 'quarterRear', mirror: false },
  rear: { view: 'rear', mirror: false },
  rear_right: { view: 'quarterRear', mirror: true },
  right: { view: 'side', mirror: true },
  front_right: { view: 'quarterFront', mirror: true },
  dashboard: { view: 'dashboard', mirror: false },
};

interface Drawing {
  outline: string;
  detail: string;
  /** Wheels seen square-on, as circles. */
  wheels: [number, number, number][];
  /** Wheels seen at an angle (tyre and hub ellipses), as a path. */
  tyres?: string;
}

// Drawn in a 400 x 300 box (the 4:3 frame); outline first, then detail lines.
const DRAWINGS: Record<View, Drawing> = {
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
      'M30.5 189.5L36.6 202.1L97.2 216.7L126.8 223L150.5 218.7L155.5 226.9L160.4 230.7L179.9 235.8L185.8 235.6' +
      'L191.6 233.4L199.2 226.8L204.8 217.1L207 208.5L308.1 190.3L311.2 197.6L315.9 201.8L333.2 204.7L338.7 203' +
      'L342.1 199.9L345 195.6L347.3 190.3L349 182.9L366.4 179.8L370 146.6L368.4 132.4L366.8 127.2L350.7 126.3' +
      'L351.7 126.2L322.9 96.8L309.1 93.1L238.4 92.3L196.7 93.6L183.8 96.8L131.8 132L124.3 132.6L39.3 154.5' +
      'L34.5 162.2L30 173.4Z',
    detail:
      'M225.2 135.6L260.6 101.4L314.2 98.5L344.8 125.2ZM290.5 129.9L283.1 100M220.5 143.7L217.9 191.4L212.6 203.4' +
      'M299.2 132L298.5 188.8M212.6 205.3L322.2 186.3M156.8 208.5L157.5 201.9L159.1 195.4L161.3 189.2L164.3 183.4' +
      'L167.8 178.3L171.8 174L176.2 170.5L180.9 167.9L185.6 166.4L190.4 165.9L195.1 166.3L199.5 167.8L203.6 170.1' +
      'L207.3 173.3L210.5 177.3L213.1 181.9L215.1 187.1L216.5 192.7L217.1 198.6M318.6 182L320.2 171.7L323.6 162.4' +
      'L328.5 155.1L331.2 152.4L334.2 150.5L337.2 149.4L340.1 149L343 149.5L345.8 150.7L350.6 155.3L354.1 162.3' +
      'L355.3 166.5L356.4 175.8M214 138.6L255.3 98L186.5 96.8L134.5 132.4ZM129.4 168.6L38.5 156M95.3 175.4' +
      'L122.5 176.2L126.9 187.9L97.5 185.6ZM47.7 167.8L35.3 162.8L35.3 172.1L47.8 176.8ZM85.9 183.5L51.4 177.4' +
      'L53 191L83.1 197.1ZM103.8 211.9L39.1 197.6',
    tyres:
      'M162.9 209.7L163.1 204.8L164 199.9L165.4 195.1L167.3 190.7L169.7 186.6L172.5 183.1L175.6 180.1L179 177.8' +
      'L182.5 176.3L186.1 175.4L189.7 175.4L193.1 176.1L196.3 177.4L199.3 179.5L201.9 182.2L204.1 185.4L205.9 189.1' +
      'L207.2 193.2L208 197.6L208.2 202.1L208 206.7L207.2 211.3L205.9 215.8L204.2 220L202 224L199.4 227.5' +
      'L196.5 230.5L193.3 232.9L189.9 234.7L186.4 235.8L182.9 236.2L179.4 235.8L176 234.7L172.9 232.8L170.1 230.2' +
      'L167.6 227L165.6 223.3L164.2 219.1L163.2 214.5ZM173.5 207.9L173.7 204.5L175.6 198L177.2 195.2L179.2 192.8' +
      'L181.4 190.8L183.8 189.5L186.3 188.8L188.8 188.8L191.2 189.4L193.3 190.7L195.2 192.5L196.8 194.8L197.9 197.5' +
      'L198.6 200.5L198.9 203.7L198 210.2L195.3 216.1L193.4 218.5L191.3 220.5L189 221.9L186.5 222.6L184 222.8' +
      'L181.6 222.3L179.4 221.1L177.4 219.4L175.8 217.1L174.5 214.3L173.8 211.3ZM321.7 187L321.8 179.3L323.4 171.7' +
      'L324.6 168.3L328 162.4L330 160.1L332.1 158.4L334.3 157.2L336.6 156.6L338.8 156.6L340.9 157.3L342.9 158.4' +
      'L344.8 160.1L347.7 165L349.5 171.3L350 178.4L349.2 185.7L347.1 192.6L344 198.4L342.1 200.7L337.9 203.9' +
      'L335.7 204.6L333.5 204.8L331.3 204.4L329.2 203.4L327.3 201.8L324.1 197L323 194ZM328.2 182.1L328.9 176.8' +
      'L329.7 174.3L332 170.2L333.4 168.7L336.5 167.3L338.1 167.3L340.9 168.9L343 172.2L343.6 174.4L344.1 179.4' +
      'L343.4 184.6L342.7 187L340.4 191.1L339.1 192.6L336 194.1L334.5 194.2L333 193.7L331.6 192.7L329.4 189.4' +
      'L328.7 187.2Z',
    wheels: [],
  },
  quarterRear: {
    outline:
      'M49.2 184L50.8 190.6L54.4 198.2L59.3 203.2L62.9 204.7L82 202L86.7 197.8L89.7 190.9L190 208.1L191.1 213.6' +
      'L193.9 220.7L200.2 229.4L208.3 234.8L214.1 236L217 235.8L236.5 230.8L243.4 224.4L246.7 217.8L278.7 223.3' +
      'L363.1 203.6L370 163.2L366.5 144.9L359.4 136.9L340.8 133.7L335.8 133.5L295.3 98.7L275.5 94.3L154.2 95.5' +
      'L140.8 98.7L91.7 133.3L84 133.8L30.6 143.4L32.2 147.5L30 155.8L31.5 181Z',
    detail:
      'M99.1 130.6L143.1 102.2L209.1 102L241.5 139.1ZM163.2 134.4L168.6 101.9M81.1 136L79.8 176.3L76.1 185.1' +
      'M154.4 136.8L154.6 198.5M76.1 186.7L185.2 205.6M41.7 176.1L42.8 166.9L44 162.7L47.5 155.7L52.3 151.1L55 149.9' +
      'L57.9 149.5L60.8 149.8L63.8 150.9L66.7 152.8L69.5 155.5L74.3 162.7L77.7 172L79.3 182.3M180 198.8L180.7 192.9' +
      'L182.1 187.4L184.1 182.2L186.7 177.6L189.8 173.6L193.5 170.4L197.5 168.1L201.9 166.6L206.5 166.2L211.3 166.7' +
      'L216 168.2L220.6 170.8L225 174.2L229 178.6L232.5 183.6L235.4 189.4L237.7 195.5L239.2 202L239.9 208.7' +
      'M252.4 139.4L214.4 100L280.2 98.6L330 132.6ZM273.3 148.6L364.1 139M300.6 153.1L275.1 155.2L276.2 170.4' +
      'L300.8 164.6ZM354.7 146.6L366.8 144.4L369.8 157L357.1 156.8ZM316.7 169.6L344.7 165.3L344.4 178.5L316.4 183.5Z' +
      'M282.1 201.5L368.6 184.4',
    tyres:
      'M48.1 178.7L48.6 171.6L50.4 165.3L53.3 160.5L55.1 158.8L57.1 157.7L59.2 157L61.4 157L63.6 157.6L65.8 158.8' +
      'L68 160.5L71.7 165.5L73.3 168.6L75.5 175.8L76.1 179.6L76.4 183.4L75.8 190.9L73.8 197.3L70.6 202L68.7 203.6' +
      'L66.7 204.6L64.5 205L62.3 204.8L60.1 204.1L55.9 201L54.1 198.7L50.9 192.9L48.9 186ZM53.9 179.7L54.4 174.8' +
      'L55.1 172.6L57.2 169.2L58.5 168.2L59.9 167.7L61.5 167.6L63 168.1L66 170.5L68.3 174.6L69 177.1L69.8 182.4' +
      'L69.2 187.5L68.5 189.7L66.4 193L65 194L63.5 194.4L62 194.4L59 192.8L57.6 191.3L55.4 187.3L54.6 184.9Z' +
      'M188.9 202.3L189.2 197.7L189.9 193.4L191.2 189.3L193 185.7L195.2 182.4L197.8 179.8L200.7 177.7L203.9 176.3' +
      'L207.3 175.7L210.8 175.7L214.4 176.5L217.9 178.1L221.2 180.4L224.3 183.3L227.1 186.8L229.5 190.9L231.4 195.3' +
      'L232.8 200L233.6 204.9L233.9 209.8L233.6 214.6L232.6 219.1L231.2 223.3L229.2 227.1L226.8 230.3L224 232.8' +
      'L220.9 234.7L217.5 235.8L214.1 236.2L210.5 235.8L207.1 234.7L203.7 232.9L200.5 230.5L197.6 227.5L195.1 224' +
      'L192.9 220.1L191.2 215.9L189.9 211.4L189.1 206.9ZM198.2 203.9L199.1 197.7L200.3 195L201.8 192.7L203.7 190.9' +
      'L205.8 189.6L208.2 189L210.6 189.1L213.1 189.7L215.5 191.1L217.7 193L219.6 195.4L221.2 198.2L223.1 204.7' +
      'L223.4 208.1L223.1 211.4L222.3 214.4L221.1 217.2L219.5 219.5L217.5 221.2L215.3 222.3L212.9 222.8L210.5 222.7' +
      'L208 221.9L205.7 220.5L203.6 218.6L201.7 216.2L199.1 210.3Z',
    wheels: [],
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
      <Path
        d={d.detail}
        fill="none"
        stroke={stroke}
        strokeWidth={width * 0.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {d.tyres ? (
        <Path d={d.tyres} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ) : null}
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
