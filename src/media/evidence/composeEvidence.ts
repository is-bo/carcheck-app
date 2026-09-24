/**
 * Offscreen composition of the per-angle BEFORE/AFTER evidence JPEG (IMAGE_PIPELINE §5).
 * The layout (every rect, wrapped line, ring and pin) comes from evidenceLayout.ts; this file
 * only paints it on a CPU raster surface, so output is deterministic and independent of the
 * screen. Marker paints come from annotate/markerStyle, the same source as the live screen.
 *
 * Runs on the JS thread, one angle at a time. Every native object (decoded photos, surface,
 * snapshot, fonts, paints, paths) is disposed before returning, so repeated exports do not
 * accumulate ~50 MB per image on low-end Android.
 */
import {
  ClipOp,
  ImageFormat,
  PaintStyle,
  Skia,
  StrokeCap,
  type SkCanvas,
  type SkFont,
  type SkImage,
  type SkPaint,
  type SkPathEffect,
} from '@shopify/react-native-skia';
import { File } from 'expo-file-system';

import type { DamageStatus as DomainStatus } from '@/domain/types';

import { BADGE_BASELINE_EM, makeBadgePath } from '../annotate/badgePath';
import { markerVisual, type MarkerVisual } from '../annotate/markerStyle';
import type { MarkerRole } from '../annotate/types';
import {
  computeEvidenceLayout,
  type DamageStatus as EvidenceStatus,
  type EvidenceLayout,
  type FontWeight,
  type PanelLayout,
  type PinLayout,
  type TextBlock,
} from '../evidenceLayout';
import { advanceWidth, loadSkiaTypefaces, makeSkiaFont, type SkiaTypefaces } from '../fonts';
import type { Rect } from '../geometry';
import {
  composeEvidenceInputHash,
  EVIDENCE_LONG_EDGE,
  evidenceFootnote,
  evidenceJpegQuality,
  toEvidenceLayoutInput,
  type ComposeEvidenceInputs,
} from './evidenceInput';

export interface ComposeEvidenceResult {
  /** URI of the written JPEG (the destination). */
  uri: string;
  width: number;
  height: number;
  byteSize: number;
  /** SHA-256 of the input fingerprint; store it to detect staleness (composeEvidenceInputHash). */
  inputHash: string;
  /** Many captions made the image taller than the target long edge (nothing was dropped). */
  exceedsTargetLongEdge: boolean;
  /** Source long edge each panel needs to avoid upscaling (> 2048: pass the original instead). */
  requiredSourceLongEdge: { before: number; after: number };
}

/** Measuring reference size: advances scale linearly with size (linear metrics, no hinting). */
const MEASURE_SIZE = 100;
const EDGE = 'rgba(0,0,0,0.45)';

function toDomainStatus(s: EvidenceStatus): DomainStatus {
  return s === 'existing' ? 'pre_existing' : s;
}

/** Fonts, paints and path effects created during one composition, all disposed at the end. */
class Resources {
  private fonts = new Map<string, SkFont>();
  private widths = new Map<string, number>();
  private disposables: { dispose(): void }[] = [];

  constructor(private faces: SkiaTypefaces) {}

  private face(weight: FontWeight) {
    return weight === 'bold' ? this.faces.bold : this.faces.regular;
  }

  font(weight: FontWeight, size: number): SkFont {
    const key = `${weight}:${size}`;
    let f = this.fonts.get(key);
    if (!f) {
      f = makeSkiaFont(this.face(weight), size);
      this.fonts.set(key, f);
    }
    return f;
  }

  readonly measure = (text: string, size: number, weight: FontWeight): number => {
    const key = `${weight}:${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      w = advanceWidth(this.font(weight, MEASURE_SIZE), text);
      this.widths.set(key, w);
    }
    return (w * size) / MEASURE_SIZE;
  };

  fill(color: string): SkPaint {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    this.disposables.push(p);
    return p;
  }

  stroke(color: string, width: number, effect: SkPathEffect | null = null, cap: StrokeCap = StrokeCap.Butt): SkPaint {
    const p = this.fill(color);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(cap);
    if (effect) p.setPathEffect(effect);
    return p;
  }

  dash(intervals: number[]): SkPathEffect {
    const e = Skia.PathEffect.MakeDash(intervals);
    this.disposables.push(e);
    return e;
  }

  track<T extends { dispose(): void }>(obj: T): T {
    this.disposables.push(obj);
    return obj;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const f of this.fonts.values()) f.dispose();
    this.disposables = [];
    this.fonts.clear();
  }
}

async function decodeImage(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  try {
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) throw new Error(`Could not decode photo ${uri}`);
    return image;
  } finally {
    data.dispose();
  }
}

function drawBlock(c: SkCanvas, r: Resources, block: TextBlock, color = block.color, dx = 0) {
  const font = r.font(block.weight, block.fontSize);
  const paint = r.fill(color);
  for (const line of block.lines) c.drawText(line.text, line.x + dx, line.y, paint, font);
}

/** DESIGN.md panel label: BEFORE in an outlined ink tag, AFTER in a solid ink tag. */
function drawPanelLabel(c: SkCanvas, r: Resources, panel: PanelLayout, ink: string, paper: string) {
  const block = panel.label;
  const line = block.lines[0];
  if (!line) return;
  const size = block.fontSize;
  const padX = size * 0.3;
  const padY = size * 0.22;
  const cap = size * 0.7;
  const w = r.measure(line.text, size, block.weight);
  const tag = { x: line.x, y: line.y - cap - padY, width: w + 2 * padX, height: cap + 2 * padY };
  const radius = size * 0.08;
  const rrect = { rect: tag, rx: radius, ry: radius };
  if (panel.side === 'after') {
    c.drawRRect(rrect, r.fill(ink));
    drawBlock(c, r, block, paper, padX);
  } else {
    const bw = Math.max(2, size * 0.08);
    c.drawRRect({ rect: { x: tag.x + bw / 2, y: tag.y + bw / 2, width: tag.width - bw, height: tag.height - bw }, rx: radius, ry: radius }, r.stroke(ink, bw));
    drawBlock(c, r, block, ink, padX);
  }
}

function drawPanel(c: SkCanvas, r: Resources, panel: PanelLayout, image: SkImage, layout: EvidenceLayout) {
  drawPanelLabel(c, r, panel, layout.colors.text, layout.colors.background);
  drawBlock(c, r, panel.time);
  c.drawRect(panel.box, r.fill(layout.colors.letterbox));
  const src = { x: 0, y: 0, width: image.width(), height: image.height() };
  // Mitchell cubic: a clean downscale of the 2048 px derivative.
  c.drawImageRectCubic(image, src, panel.imageRect, 1 / 3, 1 / 3);
}

function drawRing(c: SkCanvas, r: Resources, layout: EvidenceLayout, v: MarkerVisual, cx: number, cy: number, radius: number) {
  const s = layout.markerStyle;
  const dash = v.dashed ? r.dash(s.dash) : null;
  const haloCap = v.dashed ? StrokeCap.Round : StrokeCap.Butt;
  if (v.ringEdge) c.drawCircle(cx, cy, radius, r.stroke(v.ringEdge, s.edgeWidth, dash, haloCap));
  c.drawCircle(cx, cy, radius, r.stroke(v.ringHalo, s.haloWidth, dash, haloCap));
  c.drawCircle(cx, cy, radius, r.stroke(v.ringCore, s.strokeWidth, dash));
}

function drawPin(c: SkCanvas, r: Resources, pin: PinLayout, v: MarkerVisual) {
  const path = r.track(makeBadgePath(pin.shape, pin.r, pin.cx, pin.cy));
  const border = pin.r * 0.19;
  if (v.ringEdge && !v.hollow) c.drawPath(path, r.stroke(EDGE, border + pin.r * 0.15));
  c.drawPath(path, r.fill(v.badgeFill));
  const dash = pin.dashed ? r.dash([pin.r * 0.34, pin.r * 0.24]) : null;
  c.drawPath(path, r.stroke(v.badgeBorder, border, dash));
  const font = r.font('bold', pin.fontSize);
  const w = r.measure(pin.label, pin.fontSize, 'bold');
  c.drawText(pin.label, pin.cx - w / 2, pin.cy + pin.fontSize * BADGE_BASELINE_EM, r.fill(v.badgeText), font);
}

function withClip(c: SkCanvas, clip: Rect, draw: () => void) {
  c.save();
  c.clipRect(clip, ClipOp.Intersect, true);
  draw();
  c.restore();
}

function paint(c: SkCanvas, r: Resources, layout: EvidenceLayout, before: SkImage, after: SkImage) {
  const { colors } = layout;
  c.clear(Skia.Color(colors.background));

  for (const block of layout.header.texts) drawBlock(c, r, block);
  const margin = layout.panels.before.box.x;
  const rule = layout.header.dividerWidth * 2;
  c.drawRect({ x: margin, y: layout.header.dividerY - rule / 2, width: layout.canvas.width - 2 * margin, height: rule }, r.fill(colors.divider));

  drawPanel(c, r, layout.panels.before, before, layout);
  drawPanel(c, r, layout.panels.after, after, layout);

  const visual = (status: EvidenceStatus, role: MarkerRole) => markerVisual(toDomainStatus(status), role);
  // All rings first, then all pins, so no ring ever crosses a pin.
  for (const m of layout.markers) {
    withClip(c, m.clip, () => drawRing(c, r, layout, visual(m.status, m.role), m.ring.cx, m.ring.cy, m.ring.r));
  }
  for (const m of layout.markers) {
    withClip(c, m.clip, () => drawPin(c, r, m.pin, visual(m.status, m.role)));
  }

  for (const row of layout.footer.rows) {
    drawPin(c, r, row.pin, visual(row.status, 'primary'));
    drawBlock(c, r, row.text);
    if (row.note) drawBlock(c, r, row.note);
  }
  drawBlock(c, r, layout.footer.legend);
  if (layout.footer.footnote) drawBlock(c, r, layout.footer.footnote);
}

function destinationFile(destination: File | string): File {
  return typeof destination === 'string' ? new File(destination) : destination;
}

/**
 * Compose one angle's evidence image and write it as a JPEG to `destination` (a file URI or
 * File; its folder is created if needed). The write goes through a temp file and a move, so a
 * crash never leaves a half-written JPEG at the destination. Originals are only read.
 */
export async function composeEvidence(inputs: ComposeEvidenceInputs, destination: File | string): Promise<ComposeEvidenceResult> {
  const faces = await loadSkiaTypefaces();
  const inputHash = await composeEvidenceInputHash(inputs);
  const resources = new Resources(faces);
  let before: SkImage | null = null;
  let after: SkImage | null = null;
  let bytes: Uint8Array;
  let layout: EvidenceLayout;
  try {
    layout = computeEvidenceLayout(toEvidenceLayoutInput(inputs, evidenceFootnote(inputs, inputHash)), {
      longEdge: inputs.longEdge ?? EVIDENCE_LONG_EDGE,
      measureText: resources.measure,
    });
    before = await decodeImage(inputs.before.uri);
    after = await decodeImage(inputs.after.uri);

    const surface = Skia.Surface.Make(layout.canvas.width, layout.canvas.height);
    if (!surface) throw new Error(`Could not allocate a ${layout.canvas.width}x${layout.canvas.height} evidence canvas`);
    try {
      paint(surface.getCanvas(), resources, layout, before, after);
      surface.flush();
      const snapshot = surface.makeImageSnapshot();
      try {
        bytes = snapshot.encodeToBytes(ImageFormat.JPEG, evidenceJpegQuality(inputs));
      } finally {
        snapshot.dispose();
      }
    } finally {
      surface.dispose();
    }
  } finally {
    before?.dispose();
    after?.dispose();
    resources.dispose();
  }
  if (!bytes || bytes.length === 0) throw new Error('Evidence image encoding produced no data');

  const dest = destinationFile(destination);
  const dir = dest.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `.${dest.name}.part`);
  if (tmp.exists) tmp.delete();
  tmp.write(bytes);
  await tmp.move(dest, { overwrite: true });

  return {
    uri: dest.uri,
    width: layout.canvas.width,
    height: layout.canvas.height,
    byteSize: bytes.length,
    inputHash,
    exceedsTargetLongEdge: layout.exceedsTargetLongEdge,
    requiredSourceLongEdge: {
      before: layout.panels.before.requiredSourceLongEdge,
      after: layout.panels.after.requiredSourceLongEdge,
    },
  };
}
