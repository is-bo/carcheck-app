/** Image sizes for embedding in PDFs (IMAGE_PIPELINE §8). Pure, shared by pdf.ts and tests. */

export interface EmbedPreset {
  /** Long edge in px; smaller images are never upscaled. */
  maxEdge: number;
  /** JPEG quality 0..1 (ignored for PNG). */
  quality: number;
  format: 'jpeg' | 'png';
}

export const EMBED_PRESETS = {
  /** Composed evidence images: ~250–400 KB each. */
  evidence: { maxEdge: 1600, quality: 0.8, format: 'jpeg' },
  /** Contract photos (thumbnails with markers). */
  contractPhoto: { maxEdge: 1200, quality: 0.8, format: 'jpeg' },
  /** Contact-sheet tiles and close-ups: ~80 KB each. */
  thumbnail: { maxEdge: 800, quality: 0.75, format: 'jpeg' },
  /** Agency logo keeps transparency. */
  logo: { maxEdge: 600, quality: 1, format: 'png' },
} as const satisfies Record<string, EmbedPreset>;

/** Target size so the long edge is at most `maxEdge`; null when no resize is needed. */
export function fitLongEdge(
  size: { width: number; height: number },
  maxEdge: number,
): { width: number; height: number } | null {
  const long = Math.max(size.width, size.height);
  if (long <= maxEdge || long <= 0) return null;
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
