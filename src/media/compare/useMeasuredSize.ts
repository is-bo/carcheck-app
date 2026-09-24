import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { Size } from '../geometry';

/** Size of a view as React state (for layout decisions) and as a shared value (for worklets). */
export function useMeasuredSize(): { size: Size; sizeSV: SharedValue<Size>; onLayout: (e: LayoutChangeEvent) => void } {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const sizeSV = useSharedValue<Size>({ width: 0, height: 0 });
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      sizeSV.set({ width, height });
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    },
    [sizeSV],
  );
  return { size, sizeSV, onLayout };
}
