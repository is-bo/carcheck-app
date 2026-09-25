/**
 * Signature stroke model and math (IMAGE_PIPELINE §7). Pure; the path functions are worklets so the
 * pad can build its Skia path on the UI thread, and Jest can test them with a recording sink.
 *
 * Coordinates are dp inside the pad, origin top-left. `t` is ms since the pad's first touch.
 * Stroke width is constant (DESIGN.md 3.2 dp): velocity-based width would make the exported PNG
 * depend on touch timing, and the signed artefact should be reproducible from the stored strokes.
 */
import { pointsBounds, type Point, type Rect, type Size } from '../geometry';

export interface SignaturePoint {
  x: number;
  y: number;
  t: number;
}

export type SignatureStroke = SignaturePoint[];

/** The subset of SkPathBuilder the tracer uses (also satisfied by a test recorder). */
export interface PathSink {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  quadTo(x1: number, y1: number, x2: number, y2: number): unknown;
}

/** DESIGN.md "Signature pad": ink stroke 3.2 dp, round caps. */
export const SIGNATURE_STROKE_WIDTH = 3.2;
/** Samples closer than this to the previous one are dropped (finger jitter). */
export const MIN_POINT_DISTANCE = 1;

/** "Meaningful stroke" rule that enables Confirm (IMAGE_PIPELINE §7). */
export const MEANINGFUL_SIGNATURE = { minLength: 60, minWidth: 40, minHeight: 15 } as const;

export const SIGNATURE_EXPORT = {
  /** Transparent margin around the ink, dp, on top of half the stroke width. */
  margin: 8,
  scale: 3,
  fallbackScale: 2,
  /** Above this width at 3x, export at 2x. */
  maxPixelWidth: 2400,
} as const;

/**
 * Midpoint quadratic smoothing: each sample is a control point and the curve passes through the
 * midpoints between samples, so corners round off without overshooting the finger.
 * A single sample becomes a dot (a zero-length line drawn with round caps).
 */
export function traceStroke(points: readonly Point[], sink: PathSink): void {
  'worklet';
  const n = points.length;
  if (n === 0) return;
  const p0 = points[0];
  sink.moveTo(p0.x, p0.y);
  if (n === 1) {
    sink.lineTo(p0.x + 0.01, p0.y);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    sink.quadTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  const last = points[n - 1];
  sink.lineTo(last.x, last.y);
}

export function traceStrokes(strokes: readonly (readonly Point[])[], sink: PathSink): void {
  'worklet';
  for (let i = 0; i < strokes.length; i++) traceStroke(strokes[i], sink);
}

/** True when (x, y) is far enough from the last sample to be worth keeping. */
export function shouldAppendPoint(last: Point | undefined, x: number, y: number, minDistance: number): boolean {
  'worklet';
  if (!last) return true;
  const dx = x - last.x;
  const dy = y - last.y;
  return dx * dx + dy * dy >= minDistance * minDistance;
}

/** Keeps a touch inside the pad so the export matches what the signer saw. */
export function clampToPad(x: number, y: number, pad: Size): Point {
  'worklet';
  return {
    x: x < 0 ? 0 : x > pad.width ? pad.width : x,
    y: y < 0 ? 0 : y > pad.height ? pad.height : y,
  };
}

export function strokeLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Bounding box of the raw samples (the smoothed curve stays inside it). */
export function inkBounds(strokes: readonly SignatureStroke[], pad = 0): Rect | null {
  const all: Point[] = [];
  for (const s of strokes) for (const p of s) all.push(p);
  return pointsBounds(all, pad);
}

export interface InkMetrics {
  length: number;
  width: number;
  height: number;
}

export function inkMetrics(strokes: readonly SignatureStroke[]): InkMetrics {
  const b = inkBounds(strokes);
  let length = 0;
  for (const s of strokes) length += strokeLength(s);
  return { length, width: b?.width ?? 0, height: b?.height ?? 0 };
}

/** Rejects dots, ticks and flat lines: enough ink over a big enough area to be a signature. */
export function isMeaningfulSignature(
  strokes: readonly SignatureStroke[],
  rule: { minLength: number; minWidth: number; minHeight: number } = MEANINGFUL_SIGNATURE,
): boolean {
  const m = inkMetrics(strokes);
  return m.length >= rule.minLength && m.width >= rule.minWidth && m.height >= rule.minHeight;
}

export interface SignatureExportPlan {
  /** Region of the pad to export, dp (ink bounds + half stroke + margin). */
  bounds: Rect;
  /** Pixels per dp. */
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** Trim + density plan for the PNG: 3x, or 2x when 3x would exceed the max pixel width. */
export function planSignatureExport(
  strokes: readonly SignatureStroke[],
  strokeWidth: number = SIGNATURE_STROKE_WIDTH,
  opts: { margin: number; scale: number; fallbackScale: number; maxPixelWidth: number } = SIGNATURE_EXPORT,
): SignatureExportPlan | null {
  const bounds = inkBounds(strokes, strokeWidth / 2 + opts.margin);
  if (!bounds) return null;
  const scale = Math.ceil(bounds.width * opts.scale) <= opts.maxPixelWidth ? opts.scale : opts.fallbackScale;
  return {
    bounds,
    scale,
    pixelWidth: Math.ceil(bounds.width * scale),
    pixelHeight: Math.ceil(bounds.height * scale),
  };
}

/**
 * Compact JSON of the raw strokes, stored with the signed contract (a few KB):
 * `{"v":1,"unit":"dp","pad":[w,h],"strokeWidth":3.2,"strokes":[[[x,y,t],...],...]}`,
 * x/y rounded to 0.1 dp, t in whole ms since the first sample.
 */
export function serializeStrokes(strokes: readonly SignatureStroke[], pad: Size, strokeWidth: number): string {
  const t0 = strokes.length > 0 && strokes[0].length > 0 ? strokes[0][0].t : 0;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return JSON.stringify({
    v: 1,
    unit: 'dp',
    pad: [r1(pad.width), r1(pad.height)],
    strokeWidth,
    strokes: strokes.map((s) => s.map((p) => [r1(p.x), r1(p.y), Math.round(p.t - t0)])),
  });
}

/** A pad's size and where its signing line sits (dp from the top). */
export interface PadGeometry {
  width: number;
  height: number;
  baseline: number;
}

/**
 * The phone turned and the pad changed size: moves the ink onto the new pad without distorting
 * it. The signature keeps its shape exactly (a translation, plus one uniform shrink only when it no
 * longer fits inside `margin`), its horizontal place in proportion, and its height above the
 * signing line. What the customer sees after the turn is exactly what gets exported.
 */
export function refitStrokes(
  strokes: readonly SignatureStroke[],
  from: PadGeometry,
  to: PadGeometry,
  margin: number,
): SignatureStroke[] {
  'worklet';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    for (let j = 0; j < s.length; j++) {
      const p = s[j];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity || from.width <= 0 || to.width <= 0) return strokes.map((s) => s.slice());
  const inkW = maxX - minX;
  const inkH = maxY - minY;
  const availW = Math.max(1, to.width - 2 * margin);
  const availH = Math.max(1, to.height - 2 * margin);
  const scale = Math.min(1, inkW > 0 ? availW / inkW : 1, inkH > 0 ? availH / inkH : 1);
  const fromCx = (minX + maxX) / 2;
  const fromCy = (minY + maxY) / 2;
  const halfW = (inkW * scale) / 2;
  const halfH = (inkH * scale) / 2;
  const clampTo = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v);
  const cx = clampTo((fromCx / from.width) * to.width, margin + halfW, to.width - margin - halfW);
  const cy = clampTo(to.baseline + (fromCy - from.baseline) * scale, margin + halfH, to.height - margin - halfH);
  return strokes.map((s) => s.map((p) => ({ x: cx + (p.x - fromCx) * scale, y: cy + (p.y - fromCy) * scale, t: p.t })));
}
