/**
 * Pure layout for the composed BEFORE/AFTER evidence image (one per damaged angle).
 *
 * Produces every rect, text line (already wrapped, aligned, baseline-positioned), ring and pin
 * the Skia renderer needs, so the renderer is a dumb loop and the layout is unit-testable.
 * Text widths come from an injected `measureText` (Skia font in production, an approximation
 * in tests). All coordinates are output-canvas pixels.
 */
import {
  badgeExtent,
  containFit,
  placeBadge,
  ringToRect,
  type BadgeShape,
  type PxRing,
  type Rect,
  type Ring,
  type Size,
} from './geometry';

/** Bump whenever the visual output changes: it is part of the cache fingerprint. */
export const EVIDENCE_LAYOUT_VERSION = 2;

export type DamageStatus = 'new' | 'uncertain' | 'existing';
export type FontWeight = 'regular' | 'bold';
export type MeasureText = (text: string, fontSize: number, weight: FontWeight) => number;
export type Arrangement = 'sideBySide' | 'stacked';
export type PanelSide = 'before' | 'after';

export interface EvidencePhoto {
  /** Upright pixel size of the stored original. */
  size: Size;
  /** Pre-formatted capture time for the panel label, e.g. "Pick-up · 12 Mar 2026, 09:14". */
  timeLabel: string;
}

export interface EvidenceDamage {
  status: DamageStatus;
  /**
   * Badge label without the status suffix: a number for new/uncertain ("2"), a letter for
   * existing ("A") per DECISIONS.md. Uncertain labels get "?" appended by the layout.
   */
  number: string;
  typeLabel: string;
  locationLabel?: string;
  severityLabel?: string;
  note?: string;
  /** Ring on BEFORE: the damage itself for `existing`, the "same area" ring for new/uncertain. */
  before?: Ring;
  /** Ring on AFTER: the damage itself for new/uncertain, projected context for `existing`. */
  after?: Ring;
  /**
   * Photo the damage was marked on (solid ring); the other side is the dashed "same area".
   * Defaults to AFTER for new/uncertain and BEFORE for existing; an existing damage found at
   * return ("Was there") passes 'after'.
   */
  primary?: PanelSide;
}

export interface EvidenceTexts {
  before: string;
  after: string;
  status: Record<DamageStatus, string>;
  legend: string;
}

export const DEFAULT_EVIDENCE_TEXTS: EvidenceTexts = {
  before: 'BEFORE',
  after: 'AFTER',
  status: { new: 'New', uncertain: 'Uncertain', existing: 'Existing' },
  legend: 'Rings on AFTER mark the damage at return. Dashed rings on BEFORE show the same area at pick-up.',
};

export interface EvidenceLayoutInput {
  /** Header title, e.g. "Rear left". */
  angleLabel: string;
  /** Header second line, e.g. "R-0142 · Renault Clio · AB-123-CD". */
  subtitle: string;
  /** Right-aligned header line, e.g. "Returned 15 Mar 2026, 17:40". */
  dateLabel: string;
  agencyName?: string;
  before: EvidencePhoto;
  after: EvidencePhoto;
  damages: EvidenceDamage[];
  /** Deterministic provenance line (no generation time; see evidenceFingerprint). */
  footnote?: string;
  texts?: Partial<EvidenceTexts>;
}

export interface EvidenceLayoutOptions {
  /** Target long edge of the output image in px. */
  longEdge: number;
  arrangement: Arrangement | 'auto';
  captionMaxLines: number;
  /** Footer switches to two columns from this many damages. */
  twoColumnsFrom: number;
  measureText: MeasureText;
}

export interface TextLine {
  text: string;
  /** Left edge (alignment already applied). */
  x: number;
  /** Baseline. */
  y: number;
}

export interface TextBlock {
  lines: TextLine[];
  fontSize: number;
  weight: FontWeight;
  color: string;
}

export interface PinLayout {
  cx: number;
  cy: number;
  /** Nominal radius; the drawn size per shape is geometry.badgeHalfSize(shape, r). */
  r: number;
  /** Status shape: square = existing, circle = new, diamond = uncertain. */
  shape: BadgeShape;
  /** solid = filled status colour; hollow = white fill, status-colour border and label. */
  fill: 'solid' | 'hollow';
  /** Dashed badge border: the pin of a counterpart ("same area") ring. */
  dashed: boolean;
  color: string;
  /** Text inside the badge, with the status suffix ("2?" for uncertain). */
  label: string;
  fontSize: number;
}

export interface MarkerLayout {
  damageIndex: number;
  panel: PanelSide;
  /** primary = the damage on its own photo; counterpart = the same area on the paired photo. */
  role: 'primary' | 'counterpart';
  status: DamageStatus;
  color: string;
  /** Dashed means "same area on the other photo" and nothing else (DECISIONS.md). */
  dashed: boolean;
  ring: PxRing;
  pin: PinLayout;
  /** Clip every marker layer to its photo so nothing bleeds into the other panel. */
  clip: Rect;
}

export interface PanelLayout {
  side: PanelSide;
  label: TextBlock;
  time: TextBlock;
  /** Letterbox area (fill with colors.letterbox). */
  box: Rect;
  /** Where the photo is drawn (contain-fit inside box). */
  imageRect: Rect;
  /** Smallest source long edge that avoids upscaling: pick the display derivative if >= this. */
  requiredSourceLongEdge: number;
}

export interface CaptionRow {
  damageIndex: number;
  status: DamageStatus;
  rect: Rect;
  pin: PinLayout;
  text: TextBlock;
  note: TextBlock | null;
}

export interface MarkerStyle {
  strokeWidth: number;
  /** Total width of the white halo stroked under the colour stroke. */
  haloWidth: number;
  /** Total width of the thin dark edge stroked under the halo. */
  edgeWidth: number;
  dash: [number, number];
}

export interface EvidenceLayout {
  version: number;
  arrangement: Arrangement;
  canvas: Size;
  colors: typeof EVIDENCE_COLORS;
  header: { rect: Rect; dividerY: number; dividerWidth: number; texts: TextBlock[] };
  panels: { before: PanelLayout; after: PanelLayout };
  markerStyle: MarkerStyle;
  /** Draw order: all rings first, then all pins, in this order. */
  markers: MarkerLayout[];
  footer: { rect: Rect; columns: number; rows: CaptionRow[]; legend: TextBlock; footnote: TextBlock | null };
  /** True when many captions forced the image past the target long edge (never drops captions). */
  exceedsTargetLongEdge: boolean;
}

/** DESIGN.md print identity: ink on paper; damage inks appear only on marks. */
export const EVIDENCE_COLORS = {
  background: '#FFFFFF',
  text: '#131517',
  muted: '#454B50',
  divider: '#131517',
  letterbox: '#F1F2F2',
  halo: '#FFFFFF',
  edge: 'rgba(0,0,0,0.45)',
  pinText: '#FFFFFF',
  status: { new: '#C8321B', uncertain: '#F0A81C', existing: '#131517' } as Record<DamageStatus, string>,
};

const BADGE_SHAPE: Record<DamageStatus, BadgeShape> = { new: 'circle', uncertain: 'diamond', existing: 'square' };
const LABEL_SUFFIX: Record<DamageStatus, string> = { new: '', uncertain: '?', existing: '' };

/** Badge text for a damage, e.g. "2?" for uncertain 2; captions repeat it. */
export function badgeText(d: Pick<EvidenceDamage, 'status' | 'number'>): string {
  return d.number + LABEL_SUFFIX[d.status];
}

/** Text metrics as fractions of canvas width. */
const K = {
  margin: 0.022,
  gutter: 0.016,
  title: 0.034,
  meta: 0.02,
  label: 0.022,
  time: 0.018,
  caption: 0.021,
  note: 0.018,
  small: 0.015,
  sectionGap: 0.018,
  stripGap: 0.008,
  rowGap: 0.012,
};

/** Marker metrics as fractions of the smaller photo short side, so markers scale with the photos. */
const M = {
  stroke: 0.008,
  halo: 0.008,
  edge: 0.003,
  pin: 0.036,
  pinGap: 0.008,
  minRing: 0.03,
  dashOn: 0.03,
  dashOff: 0.02,
};

const LINE = 1.28;
/** Baseline offset from a line's vertical centre (half a cap height). */
const CAP_HALF = 0.36;
const STATUS_RANK: Record<DamageStatus, number> = { new: 0, uncertain: 1, existing: 2 };
const MIN_WIDTH: Record<Arrangement, number> = { sideBySide: 1800, stacked: 1200 };
/** Legibility reference: fit the canvas into an A4-portrait / phone-portrait frame. */
const REFERENCE_ASPECT = Math.SQRT2;

// ---------------------------------------------------------------------------------------------
// Text

/** Rough advance widths (em) of a humanist sans; production passes real Skia measurements. */
export function approximateMeasure(text: string, fontSize: number, weight: FontWeight): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.27;
    else if ('il.,:;\'|!ftjI()[]'.includes(ch)) em += 0.3;
    else if ('mwMW@—'.includes(ch)) em += 0.88;
    else if (ch >= '0' && ch <= '9') em += 0.58;
    else if (ch >= 'A' && ch <= 'Z') em += 0.66;
    else em += 0.55;
  }
  return em * fontSize * (weight === 'bold' ? 1.06 : 1);
}

export function ellipsize(text: string, maxWidth: number, size: number, weight: FontWeight, measure: MeasureText): string {
  if (measure(text, size, weight) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + '…', size, weight) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '…' : text.slice(0, lo).trimEnd() + '…';
}

/** Greedy word wrap; over-long words are broken; the last allowed line is ellipsized. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  weight: FontWeight,
  measure: MeasureText,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    const candidate = current ? current + ' ' + word : word;
    if (measure(candidate, size, weight) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) lines.push(current);
    current = '';
    // Break a single word that does not fit on its own line.
    let rest = word;
    while (measure(rest, size, weight) > maxWidth && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n), size, weight) > maxWidth) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    current = rest;
  };
  for (const w of words) pushWord(w);
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines - 1);
  kept.push(ellipsize(lines.slice(maxLines - 1).join(' '), maxWidth, size, weight, measure));
  return kept;
}

/** Shrink a one-line text down to `minScale` of its size, then ellipsize. */
function fitLine(
  text: string,
  maxWidth: number,
  size: number,
  minScale: number,
  weight: FontWeight,
  measure: MeasureText,
): { text: string; size: number } {
  let s = size;
  while (measure(text, s, weight) > maxWidth && s * 0.95 >= size * minScale) s *= 0.95;
  return { text: ellipsize(text, maxWidth, s, weight, measure), size: s };
}

function block(
  lines: string[],
  x: number,
  firstBaseline: number,
  size: number,
  weight: FontWeight,
  color: string,
  measure: MeasureText,
  align: 'left' | 'right' = 'left',
): TextBlock {
  return {
    lines: lines.map((text, i) => ({
      text,
      x: align === 'right' ? x - measure(text, size, weight) : x,
      y: firstBaseline + i * size * LINE,
    })),
    fontSize: size,
    weight,
    color,
  };
}

/** Baseline that vertically centres a line of `size` in a line box starting at `top`. */
function baselineIn(top: number, size: number): number {
  return top + (size * LINE) / 2 + size * CAP_HALF;
}

// ---------------------------------------------------------------------------------------------
// Markers

interface MarkerMetrics {
  stroke: number;
  halo: number;
  edge: number;
  pinR: number;
  pinGap: number;
  minRing: number;
  dash: [number, number];
}

function markerMetrics(unit: number): MarkerMetrics {
  const stroke = Math.max(2, unit * M.stroke);
  return {
    stroke,
    halo: stroke + Math.max(2, unit * M.halo),
    edge: stroke + Math.max(2, unit * M.halo) + Math.max(1, unit * M.edge),
    pinR: unit * M.pin,
    pinGap: unit * M.pinGap,
    minRing: unit * M.minRing,
    dash: [unit * M.dashOn, unit * M.dashOff],
  };
}

function primarySide(d: EvidenceDamage): PanelSide {
  return d.primary ?? (d.status === 'existing' ? 'before' : 'after');
}

function pinLayout(
  cx: number,
  cy: number,
  r: number,
  status: DamageStatus,
  hollow: boolean,
  dashed: boolean,
  label: string,
  measure: MeasureText,
): PinLayout {
  const shape = BADGE_SHAPE[status];
  // The diamond is narrower than a circle at the height of the text.
  const maxW = r * (shape === 'diamond' ? 1.3 : 1.5);
  let fontSize = r * 1.1;
  const w = measure(label, fontSize, 'bold');
  if (w > maxW) fontSize *= maxW / w;
  return {
    cx,
    cy,
    r,
    shape,
    fill: hollow ? 'hollow' : 'solid',
    dashed,
    color: EVIDENCE_COLORS.status[status],
    label,
    fontSize,
  };
}

function layoutMarker(
  damage: EvidenceDamage,
  damageIndex: number,
  side: PanelSide,
  ring: Ring,
  imageRect: Rect,
  mm: MarkerMetrics,
  measure: MeasureText,
): MarkerLayout {
  const role = side === primarySide(damage) ? 'primary' : 'counterpart';
  const px = ringToRect(ring, imageRect);
  const r = Math.max(px.r, mm.minRing);
  const inset = mm.edge / 2;
  const bounds = {
    x: imageRect.x + inset,
    y: imageRect.y + inset,
    width: imageRect.width - 2 * inset,
    height: imageRect.height - 2 * inset,
  };
  const extent = badgeExtent(BADGE_SHAPE[damage.status], mm.pinR);
  const pinCentre = placeBadge({ cx: px.cx, cy: px.cy, r }, extent, mm.pinGap + mm.halo / 2, bounds);
  const dashed = role === 'counterpart';
  // Existing damage is always a hollow pin; every counterpart is hollow too.
  const hollow = dashed || damage.status === 'existing';
  return {
    damageIndex,
    panel: side,
    role,
    status: damage.status,
    color: EVIDENCE_COLORS.status[damage.status],
    dashed,
    ring: { cx: px.cx, cy: px.cy, r },
    pin: pinLayout(pinCentre.x, pinCentre.y, mm.pinR, damage.status, hollow, dashed, badgeText(damage), measure),
    clip: imageRect,
  };
}

function captionText(d: EvidenceDamage, texts: EvidenceTexts): string {
  const what = [d.typeLabel, d.locationLabel].filter(Boolean).join(', ');
  const parts = [`${texts.status[d.status]} ${badgeText(d)}`, what, d.severityLabel].filter(Boolean);
  return parts.join(' — ');
}

// ---------------------------------------------------------------------------------------------
// Layout

function layoutAt(
  width: number,
  arrangement: Arrangement,
  input: EvidenceLayoutInput,
  damages: EvidenceDamage[],
  texts: EvidenceTexts,
  opts: EvidenceLayoutOptions,
): EvidenceLayout {
  const W = Math.round(width);
  const measure = opts.measureText;
  const C = EVIDENCE_COLORS;
  const m = W * K.margin;
  const g = W * K.gutter;
  const contentW = W - 2 * m;

  // Header ------------------------------------------------------------------------------------
  const titleSize = W * K.title;
  const metaSize = W * K.meta;
  const rightTexts = [input.dateLabel, input.agencyName ?? ''].filter(Boolean);
  const rightW = Math.min(
    contentW * 0.42,
    Math.max(0, ...rightTexts.map((t) => measure(t, metaSize, 'regular'))),
  );
  const leftW = contentW - (rightW > 0 ? rightW + g : 0);
  const top = m * 0.9;
  const title = fitLine(input.angleLabel, leftW, titleSize, 0.7, 'bold', measure);
  const titleBaseline = baselineIn(top, titleSize);
  const row2Top = top + titleSize * LINE;
  const metaBaseline = baselineIn(row2Top, metaSize);
  const headerTexts: TextBlock[] = [
    block([title.text], m, titleBaseline, title.size, 'bold', C.text, measure),
    block([ellipsize(input.subtitle, leftW, metaSize, 'regular', measure)], m, metaBaseline, metaSize, 'regular', C.muted, measure),
  ];
  if (input.dateLabel) {
    const t = ellipsize(input.dateLabel, rightW, metaSize, 'regular', measure);
    headerTexts.push(block([t], W - m, titleBaseline, metaSize, 'regular', C.text, measure, 'right'));
  }
  if (input.agencyName) {
    const t = ellipsize(input.agencyName, rightW, metaSize, 'regular', measure);
    headerTexts.push(block([t], W - m, metaBaseline, metaSize, 'regular', C.muted, measure, 'right'));
  }
  const dividerY = row2Top + metaSize * LINE + W * 0.01;
  const header = {
    rect: { x: 0, y: 0, width: W, height: dividerY },
    dividerY,
    dividerWidth: Math.max(1, W * 0.001),
    texts: headerTexts,
  };

  // Panels ------------------------------------------------------------------------------------
  const labelSize = W * K.label;
  const timeSize = W * K.time;
  const stripH = labelSize * LINE + W * K.stripGap;
  const photos = { before: input.before, after: input.after };
  const labels = { before: texts.before, after: texts.after };

  const panelAt = (side: PanelSide, x: number, stripTop: number, boxW: number, boxH: number): PanelLayout => {
    const baseline = baselineIn(stripTop, labelSize);
    const labelW = measure(labels[side], labelSize, 'bold');
    const timeMax = Math.max(0, boxW - labelW - g);
    const time = ellipsize(photos[side].timeLabel, timeMax, timeSize, 'regular', measure);
    const box = { x, y: stripTop + stripH, width: boxW, height: boxH };
    const imageRect = containFit(photos[side].size, box);
    return {
      side,
      label: block([labels[side]], x, baseline, labelSize, 'bold', C.text, measure),
      time: block([time], x + boxW, baseline, timeSize, 'regular', C.muted, measure, 'right'),
      box,
      imageRect,
      requiredSourceLongEdge: Math.ceil(Math.max(imageRect.width, imageRect.height)),
    };
  };

  const aspect = (s: Size) => s.width / s.height;
  const panelsTop = dividerY + W * K.sectionGap;
  let before: PanelLayout;
  let after: PanelLayout;
  if (arrangement === 'sideBySide') {
    const pw = (contentW - g) / 2;
    // The taller photo sets the shared box height; very tall photos are pillarboxed.
    const boxH = Math.min(pw / Math.min(aspect(input.before.size), aspect(input.after.size)), pw * 1.5);
    before = panelAt('before', m, panelsTop, pw, boxH);
    after = panelAt('after', m + pw + g, panelsTop, pw, boxH);
  } else {
    // Full width each; portrait photos are pillarboxed so a stacked pair stays readable.
    const boxH = (s: Size) => Math.min(contentW / aspect(s), contentW * 0.75);
    before = panelAt('before', m, panelsTop, contentW, boxH(input.before.size));
    after = panelAt('after', m, before.box.y + before.box.height + W * K.sectionGap, contentW, boxH(input.after.size));
  }
  const panelsBottom = Math.max(before.box.y + before.box.height, after.box.y + after.box.height);

  // Markers -----------------------------------------------------------------------------------
  const unit = Math.min(before.imageRect.width, before.imageRect.height, after.imageRect.width, after.imageRect.height);
  const mm = markerMetrics(unit);
  const markers: MarkerLayout[] = [];
  damages.forEach((d, i) => {
    if (d.before) markers.push(layoutMarker(d, i, 'before', d.before, before.imageRect, mm, measure));
    if (d.after) markers.push(layoutMarker(d, i, 'after', d.after, after.imageRect, mm, measure));
  });
  // Counterparts underneath, then existing, then new/uncertain on top.
  const drawRank = (mk: MarkerLayout) => (mk.role === 'counterpart' ? 0 : mk.status === 'existing' ? 1 : 2);
  markers.sort((a, b) => drawRank(a) - drawRank(b));

  // Footer ------------------------------------------------------------------------------------
  const capSize = W * K.caption;
  const noteSize = W * K.note;
  const smallSize = W * K.small;
  const footerTop = panelsBottom + W * K.sectionGap;
  const columns = damages.length >= opts.twoColumnsFrom ? 2 : 1;
  const colW = columns === 2 ? (contentW - g) / 2 : contentW;
  const perCol = Math.ceil(damages.length / columns);
  const pinR = capSize * 0.62;
  const rows: CaptionRow[] = [];
  let rowsBottom = footerTop;
  for (let c = 0; c < columns; c++) {
    const colX = m + c * (colW + g);
    const textX = colX + 2 * pinR + W * 0.012;
    const textW = colX + colW - textX;
    let y = footerTop;
    for (let i = c * perCol; i < Math.min(damages.length, (c + 1) * perCol); i++) {
      const d = damages[i];
      const lines = wrapText(captionText(d, texts), textW, capSize, 'regular', measure, opts.captionMaxLines);
      const firstBaseline = baselineIn(y, capSize);
      const text = block(lines, textX, firstBaseline, capSize, 'regular', C.text, measure);
      const textBottom = y + lines.length * capSize * LINE;
      let note: TextBlock | null = null;
      let rowBottom = textBottom;
      if (d.note && d.note.trim()) {
        const noteLine = ellipsize(`“${d.note.trim()}”`, textW, noteSize, 'regular', measure);
        note = block([noteLine], textX, baselineIn(textBottom, noteSize), noteSize, 'regular', C.muted, measure);
        rowBottom += noteSize * LINE;
      }
      const pin = pinLayout(
        colX + pinR,
        y + (capSize * LINE) / 2,
        pinR,
        d.status,
        d.status === 'existing',
        false,
        badgeText(d),
        measure,
      );
      const height = Math.max(rowBottom - y, 2 * pinR);
      rows.push({ damageIndex: i, status: d.status, rect: { x: colX, y, width: colW, height }, pin, text, note });
      y += height + W * K.rowGap;
    }
    rowsBottom = Math.max(rowsBottom, y);
  }
  const legendTop = rowsBottom + (damages.length ? 0 : W * K.rowGap);
  const legend = block(
    [ellipsize(texts.legend, contentW, smallSize, 'regular', measure)],
    m,
    baselineIn(legendTop, smallSize),
    smallSize,
    'regular',
    C.muted,
    measure,
  );
  let bottom = legendTop + smallSize * LINE;
  let footnote: TextBlock | null = null;
  if (input.footnote) {
    footnote = block(
      [ellipsize(input.footnote, contentW, smallSize, 'regular', measure)],
      m,
      baselineIn(bottom, smallSize),
      smallSize,
      'regular',
      C.muted,
      measure,
    );
    bottom += smallSize * LINE;
  }
  const H = Math.ceil(bottom + m);

  return {
    version: EVIDENCE_LAYOUT_VERSION,
    arrangement,
    canvas: { width: W, height: H },
    colors: EVIDENCE_COLORS,
    header,
    panels: { before, after },
    markerStyle: { strokeWidth: mm.stroke, haloWidth: mm.halo, edgeWidth: mm.edge, dash: mm.dash },
    markers,
    footer: { rect: { x: 0, y: footerTop, width: W, height: H - footerTop }, columns, rows, legend, footnote },
    exceedsTargetLongEdge: false,
  };
}

/** Resize one arrangement so its long edge hits the target (everything scales with width). */
function fitToLongEdge(
  arrangement: Arrangement,
  input: EvidenceLayoutInput,
  damages: EvidenceDamage[],
  texts: EvidenceTexts,
  opts: EvidenceLayoutOptions,
): EvidenceLayout {
  const target = opts.longEdge;
  const minW = Math.min(MIN_WIDTH[arrangement], target);
  let w = arrangement === 'stacked' ? target * 0.5 : target;
  let layout = layoutAt(w, arrangement, input, damages, texts, opts);
  for (let i = 0; i < 4; i++) {
    const le = Math.max(layout.canvas.width, layout.canvas.height);
    if (le <= target && le >= target * 0.98) break;
    const next = Math.max(minW, Math.min(target, Math.floor(w * (target / le))));
    if (next === Math.round(w)) break;
    w = next;
    layout = layoutAt(w, arrangement, input, damages, texts, opts);
  }
  // Wrapping can shift a line after the last resize; shave until the target holds.
  while (Math.max(layout.canvas.width, layout.canvas.height) > target && w > minW) {
    w = Math.max(minW, Math.floor(w * 0.99));
    layout = layoutAt(w, arrangement, input, damages, texts, opts);
  }
  layout.exceedsTargetLongEdge = Math.max(layout.canvas.width, layout.canvas.height) > target;
  return layout;
}

/**
 * Legibility score: area of the smaller photo when the whole image is fitted into a portrait
 * reference frame of unit width (phone screen in WhatsApp, A4 page in the PDF).
 */
export function legibilityScore(layout: EvidenceLayout): number {
  const s = Math.min(1 / layout.canvas.width, REFERENCE_ASPECT / layout.canvas.height);
  const area = (r: Rect) => r.width * r.height;
  return Math.min(area(layout.panels.before.imageRect), area(layout.panels.after.imageRect)) * s * s;
}

export const DEFAULT_EVIDENCE_OPTIONS: EvidenceLayoutOptions = {
  longEdge: 2800,
  arrangement: 'auto',
  captionMaxLines: 2,
  twoColumnsFrom: 4,
  measureText: approximateMeasure,
};

/**
 * Full evidence-image layout. With arrangement 'auto', landscape pairs stack BEFORE above
 * AFTER and portrait pairs sit side by side; mixed pairs take whichever keeps the smaller photo
 * larger. BEFORE always comes first (left or top).
 */
export function computeEvidenceLayout(
  input: EvidenceLayoutInput,
  options: Partial<EvidenceLayoutOptions> = {},
): EvidenceLayout {
  const opts: EvidenceLayoutOptions = { ...DEFAULT_EVIDENCE_OPTIONS, ...options };
  const texts: EvidenceTexts = {
    ...DEFAULT_EVIDENCE_TEXTS,
    ...input.texts,
    status: { ...DEFAULT_EVIDENCE_TEXTS.status, ...input.texts?.status },
  };
  const damages = orderedDamages(input.damages);
  const candidates: Arrangement[] = opts.arrangement === 'auto' ? ['stacked', 'sideBySide'] : [opts.arrangement];
  let best: EvidenceLayout | null = null;
  for (const a of candidates) {
    const layout = fitToLongEdge(a, input, damages, texts, opts);
    if (!best || legibilityScore(layout) > legibilityScore(best)) best = layout;
  }
  return best as EvidenceLayout;
}

/**
 * Damages in the order the layout uses (MarkerLayout/CaptionRow.damageIndex refer to it):
 * new, then uncertain, then existing; caller order kept within a group.
 */
export function orderedDamages(damages: EvidenceDamage[]): EvidenceDamage[] {
  return damages
    .map((d, i) => ({ d, i }))
    .sort((a, b) => STATUS_RANK[a.d.status] - STATUS_RANK[b.d.status] || a.i - b.i)
    .map((x) => x.d);
}

// ---------------------------------------------------------------------------------------------
// Cache fingerprint

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return JSON.stringify(Math.round(value * 1e6) / 1e6);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(obj[k]))
      .join(',') +
    '}'
  );
}

export interface EvidenceRenderIdentity {
  beforeSha256: string;
  afterSha256: string;
  /** Changes when the bundled font file changes, e.g. "Inter-4.1". */
  fontId: string;
  longEdge: number;
  jpegQuality: number;
}

/**
 * Canonical string of everything that affects the pixels. SHA-256 it (expo-crypto) to get the
 * evidence cache key: same key => reuse the file, different key => regenerate. `footnote` is
 * excluded because it quotes that key.
 */
export function evidenceFingerprint(input: EvidenceLayoutInput, identity: EvidenceRenderIdentity): string {
  return canonical({ layoutVersion: EVIDENCE_LAYOUT_VERSION, input: { ...input, footnote: undefined }, identity });
}
