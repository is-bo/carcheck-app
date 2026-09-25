import {
  clampToPad,
  inkMetrics,
  isMeaningfulSignature,
  planSignatureExport,
  refitStrokes,
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

describe('refitStrokes (pad resized when the phone turns)', () => {
  const portrait = { width: 340, height: 480, baseline: 404 };
  const landscape = { width: 560, height: 260, baseline: 184 };
  const flat = (strokes: SignatureStroke[]) => strokes.flat();
  // Pairwise distance ratios survive only a translation + uniform scale (no distortion).
  const ratio = (a: SignatureStroke[], b: SignatureStroke[]) => {
    const pa = flat(a);
    const pb = flat(b);
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
    return d(pb[0], pb[pb.length - 1]) / d(pa[0], pa[pa.length - 1]);
  };

  it('keeps a signature that fits at exactly its size and shape, same height above the line', () => {
    const ink = signature().map((s) => s.map((p) => ({ ...p, y: p.y + 260 })));
    const out = refitStrokes(ink, portrait, landscape, 8);
    expect(ratio(ink, out)).toBeCloseTo(1, 6);
    const dx = out[0][0].x - ink[0][0].x;
    const dy = out[0][0].y - ink[0][0].y;
    flat(out).forEach((p, i) => {
      expect(p.x - flat(ink)[i].x).toBeCloseTo(dx, 6);
      expect(p.y - flat(ink)[i].y).toBeCloseTo(dy, 6);
      expect(p.t).toBe(flat(ink)[i].t);
    });
    // Same distance to the signing line as before the turn.
    const bottom = (ss: SignatureStroke[]) => Math.max(...flat(ss).map((p) => p.y));
    expect(landscape.baseline - bottom(out)).toBeCloseTo(portrait.baseline - bottom(ink), 6);
  });

  it('shrinks ink that no longer fits, uniformly, and keeps it inside the pad', () => {
    const tall = [stroke([20, 40], [300, 420], [40, 400])];
    const out = refitStrokes(tall, portrait, landscape, 8);
    const pts = flat(out);
    pts.forEach((p) => {
      expect(p.x).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p.x).toBeLessThanOrEqual(landscape.width - 8 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p.y).toBeLessThanOrEqual(landscape.height - 8 + 1e-9);
    });
    const r = ratio(tall, out);
    expect(r).toBeLessThan(1);
    // Every segment scales by the same factor: no stretching in one direction.
    const seg = (ss: SignatureStroke[], i: number) => Math.hypot(ss[0][i + 1].x - ss[0][i].x, ss[0][i + 1].y - ss[0][i].y);
    expect(seg(out, 0) / seg(tall, 0)).toBeCloseTo(seg(out, 1) / seg(tall, 1), 6);
  });

  it('round-trips portrait -> landscape -> portrait without drift for ink that fits', () => {
    const ink = signature().map((s) => s.map((p) => ({ ...p, y: p.y + 260 })));
    const back = refitStrokes(refitStrokes(ink, portrait, landscape, 8), landscape, portrait, 8);
    flat(back).forEach((p, i) => {
      expect(p.x).toBeCloseTo(flat(ink)[i].x, 6);
      expect(p.y).toBeCloseTo(flat(ink)[i].y, 6);
    });
  });

  it('leaves an empty pad empty and copies unchanged geometry', () => {
    expect(refitStrokes([], portrait, landscape, 8)).toEqual([]);
    const ink = signature();
    expect(refitStrokes(ink, portrait, portrait, 8)).toEqual(ink);
  });
});
