/**
 * Bundled Barlow typefaces for Skia text (marker badges on screen, offscreen evidence images).
 * System fonts are never used: OEM fonts would change layout and can lack glyphs. The TTFs ship
 * inside the app (Metro assets from @expo-google-fonts), so this works fully offline.
 *
 * Loaded once per app run and kept for its lifetime; fonts derived from them are cheap.
 */
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { Barlow_700Bold } from '@expo-google-fonts/barlow/700Bold';
import { FontEdging, FontHinting, loadData, Skia, type SkFont, type SkTypeface } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';

export type SkiaFace = 'regular' | 'semibold' | 'bold';
export type SkiaTypefaces = Record<SkiaFace, SkTypeface>;

const SOURCES: Record<SkiaFace, number> = {
  regular: Barlow_400Regular,
  semibold: Barlow_600SemiBold,
  bold: Barlow_700Bold,
};

let loaded: SkiaTypefaces | null = null;
let pending: Promise<SkiaTypefaces> | null = null;

async function loadFace(face: SkiaFace): Promise<SkTypeface> {
  const tf = await loadData(SOURCES[face], (data) => {
    const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
    data.dispose();
    return typeface;
  });
  if (!tf) throw new Error(`Could not load the bundled Barlow ${face} font`);
  return tf;
}

/** Load (once) and return the bundled typefaces. A failed load is retried on the next call. */
export function loadSkiaTypefaces(): Promise<SkiaTypefaces> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = Promise.all([loadFace('regular'), loadFace('semibold'), loadFace('bold')])
      .then(([regular, semibold, bold]) => {
        loaded = { regular, semibold, bold };
        return loaded;
      })
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

/** Deterministic font settings: linear metrics and no hinting, so measurement scales with size. */
export function makeSkiaFont(typeface: SkTypeface, size: number): SkFont {
  const font = Skia.Font(typeface, size);
  font.setEdging(FontEdging.AntiAlias);
  font.setHinting(FontHinting.None);
  font.setLinearMetrics(true);
  font.setSubpixel(true);
  return font;
}

/** Advance width of `text` (what layout needs; SkFont.measureText returns ink bounds). */
export function advanceWidth(font: SkFont, text: string): number {
  if (!text) return 0;
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  let w = 0;
  for (let i = 0; i < widths.length; i++) w += widths[i];
  return w;
}

/** The typefaces, or null until loaded (usually a few ms after first use). */
export function useSkiaTypefaces(): SkiaTypefaces | null {
  const [faces, setFaces] = useState<SkiaTypefaces | null>(loaded);
  useEffect(() => {
    if (faces) return;
    let alive = true;
    loadSkiaTypefaces().then(
      (f) => alive && setFaces(f),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [faces]);
  return faces;
}

/** A Skia font of one face and size for on-screen drawing, or null while loading. */
export function useSkiaFont(face: SkiaFace, size: number): SkFont | null {
  const faces = useSkiaTypefaces();
  return useMemo(() => (faces ? makeSkiaFont(faces[face], size) : null), [faces, face, size]);
}
