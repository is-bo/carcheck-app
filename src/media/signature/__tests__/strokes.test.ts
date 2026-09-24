import {
  clampToPad,
  inkMetrics,
  isMeaningfulSignature,
  planSignatureExport,
  serializeStrokes,
  shouldAppendPoint,
  SIGNATURE_EXPORT,
  SIGNATURE_STROKE_WIDTH,
  strokeLength,
  traceStroke,
  traceStrokes,
  type PathSink,
  type SignatureStroke,
} from '../strokes';

type Cmd = [string, ...number[]];

function recorder(): PathSink & { cmds: Cmd[] } {
  const cmds: Cmd[] = [];
  return {
    cmds,
    moveTo: (x, y) => cmds.push(['M', x, y]),
    lineTo: (x, y) => cmds.push(['L', x, y]),
    quadTo: (x1, y1, x2, y2) => cmds.push(['Q', x1, y1, x2, y2]),
  };
}

const stroke = (...xy: [number, number][]): SignatureStroke => xy.map(([x, y], i) => ({ x, y, t: i * 16 }));

/** A plausible cursive signature: ~200 dp wide, ~45 dp tall. */
function signature(): SignatureStroke[] {
  const a: [number, number][] = [];
  for (let i = 0; i <= 60; i++) a.push([40 + i * 3, 100 + Math.sin(i / 4) * 20]);
  return [stroke(...a), stroke([90, 70], [95, 120])];
}

describe('traceStroke (midpoint quadratic smoothing)', () => {
  it('draws a single sample as a dot', () => {
    const r = recorder();
    traceStroke(stroke([10, 20]), r);
    expect(r.cmds[0]).toEqual(['M', 10, 20]);
    expect(r.cmds[1][0]).toBe('L');
    expect(r.cmds).toHaveLength(2);
  });

  it('draws two samples as a line', () => {
    const r = recorder();
    traceStroke(stroke([0, 0], [10, 0]), r);
    expect(r.cmds).toEqual([['M', 0, 0], ['L', 10, 0]]);
  });

  it('uses samples as control points and passes through midpoints, ending on the last sample', () => {
    const r = recorder();
    traceStroke(stroke([0, 0], [10, 0], [10, 10], [20, 10]), r);
    expect(r.cmds).toEqual([
      ['M', 0, 0],
      ['Q', 10, 0, 10, 5],
      ['Q', 10, 10, 15, 10],
      ['L', 20, 10],
    ]);
  });

  it('draws nothing for an empty stroke and one contour per stroke', () => {
    const r = recorder();
    traceStroke([], r);
    expect(r.cmds).toHaveLength(0);
    traceStrokes(signature(), r);
    expect(r.cmds.filter((c) => c[0] === 'M')).toHaveLength(2);
  });
});

describe('sampling helpers', () => {
  it('drops samples closer than the minimum distance', () => {
    expect(shouldAppendPoint(undefined, 5, 5, 1)).toBe(true);
    expect(shouldAppendPoint({ x: 0, y: 0 }, 0.5, 0.5, 1)).toBe(false);
    expect(shouldAppendPoint({ x: 0, y: 0 }, 0.6, 0.8, 1)).toBe(true);
  });

  it('clamps touches to the pad', () => {
    const pad = { width: 300, height: 200 };
    expect(clampToPad(-5, 250, pad)).toEqual({ x: 0, y: 200 });
    expect(clampToPad(120, 40, pad)).toEqual({ x: 120, y: 40 });
  });
});

describe('minimum-ink validation', () => {
  it('measures length and bounds', () => {
    expect(strokeLength(stroke([0, 0], [3, 4], [3, 10]))).toBeCloseTo(11, 9);
    expect(inkMetrics([stroke([0, 0], [30, 0]), stroke([10, -5], [10, 12])])).toEqual({ length: 47, width: 30, height: 17 });
    expect(inkMetrics([])).toEqual({ length: 0, width: 0, height: 0 });
  });

  it('rejects empty pads, dots, ticks and flat lines', () => {
    expect(isMeaningfulSignature([])).toBe(false);
    expect(isMeaningfulSignature([stroke([50, 50])])).toBe(false);
    expect(isMeaningfulSignature([stroke([50, 50], [60, 40], [70, 70])])).toBe(false);
    expect(isMeaningfulSignature([stroke([10, 50], [200, 52])])).toBe(false); // long but flat
    expect(isMeaningfulSignature([stroke([10, 10], [12, 150])])).toBe(false); // tall but narrow
  });

  it('accepts a real signature, including one made of several strokes', () => {
    expect(isMeaningfulSignature(signature())).toBe(true);
    expect(isMeaningfulSignature([stroke([10, 10], [60, 10]), stroke([10, 30], [60, 30]), stroke([35, 5], [35, 35])])).toBe(true);
  });
});

describe('planSignatureExport', () => {
  it('trims to the ink plus half the stroke and the margin, at 3x', () => {
    const plan = planSignatureExport([stroke([100, 50], [300, 120])])!;
    const pad = SIGNATURE_STROKE_WIDTH / 2 + SIGNATURE_EXPORT.margin;
    expect(plan.bounds.x).toBeCloseTo(100 - pad, 9);
    expect(plan.bounds.y).toBeCloseTo(50 - pad, 9);
    expect(plan.bounds.width).toBeCloseTo(200 + 2 * pad, 9);
    expect(plan.scale).toBe(3);
    expect(plan.pixelWidth).toBe(Math.ceil(plan.bounds.width * 3));
    expect(plan.pixelHeight).toBe(Math.ceil(plan.bounds.height * 3));
  });

  it('drops to 2x when 3x would exceed the maximum width', () => {
    const plan = planSignatureExport([stroke([0, 0], [1000, 100])])!;
    expect(plan.scale).toBe(2);
    expect(plan.pixelWidth).toBeLessThanOrEqual(2 * 1000 + 2 * 2 * (SIGNATURE_STROKE_WIDTH / 2 + SIGNATURE_EXPORT.margin) + 1);
  });

  it('returns null without ink', () => {
    expect(planSignatureExport([])).toBeNull();
    expect(planSignatureExport([[]])).toBeNull();
  });
});

describe('serializeStrokes', () => {
  it('writes compact, rounded, time-relative JSON', () => {
    const s: SignatureStroke[] = [
      [
        { x: 10.04, y: 20.06, t: 1000 },
        { x: 11.55, y: 21, t: 1016.4 },
      ],
      [{ x: 5, y: 5, t: 1500 }],
    ];
    const parsed = JSON.parse(serializeStrokes(s, { width: 320.25, height: 180 }, 3.2));
    expect(parsed).toEqual({
      v: 1,
      unit: 'dp',
      pad: [320.3, 180],
      strokeWidth: 3.2,
      strokes: [
        [
          [10, 20.1, 0],
          [11.6, 21, 16],
        ],
        [[5, 5, 500]],
      ],
    });
  });
});
