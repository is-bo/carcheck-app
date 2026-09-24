import { Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Decode a local photo into an SkImage and free it when the URI changes or the view unmounts.
 * A decoded 2048 px derivative is ~12 MB of native memory that Hermes' GC cannot see, so on
 * low-end Android images are released explicitly instead of waiting for collection.
 * Returns null while loading, on error, or when `uri` is null/undefined.
 */
export function useSkImage(uri: string | null | undefined, onError?: (error: Error) => void): SkImage | null {
  const [state, setState] = useState<{ uri: string; image: SkImage } | null>(null);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    let image: SkImage | null = null;
    Skia.Data.fromURI(uri)
      .then((data) => {
        const decoded = Skia.Image.MakeImageFromEncoded(data);
        data.dispose();
        if (!decoded) throw new Error(`Could not decode ${uri}`);
        if (cancelled) {
          decoded.dispose();
          return;
        }
        image = decoded;
        setState({ uri, image: decoded });
      })
      .catch((err: unknown) => {
        if (!cancelled) onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
      const old = image;
      // Free after the next frame: by then the canvas has re-recorded without this image.
      if (old) requestAnimationFrame(() => old.dispose());
    };
  }, [uri]);

  return state && state.uri === uri ? state.image : null;
}
