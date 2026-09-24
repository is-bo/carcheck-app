import { createContext, useContext, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { light, rebate, type ColorRoles } from './theme/tokens';

/**
 * Paper (lists, forms, customer) or rebate (photo screens). Components read their colours from
 * the nearest surface, so a Button inside a rebate rail inverts without extra props.
 */
export type SurfaceTone = 'paper' | 'rebate';

const SurfaceContext = createContext<SurfaceTone>('paper');

export function useSurface(): { tone: SurfaceTone; colors: ColorRoles } {
  const tone = useContext(SurfaceContext);
  return { tone, colors: tone === 'rebate' ? rebate : light };
}

export function colorsFor(tone: SurfaceTone): ColorRoles {
  return tone === 'rebate' ? rebate : light;
}

export function SurfaceProvider({ tone, children }: { tone: SurfaceTone; children: ReactNode }) {
  return <SurfaceContext.Provider value={tone}>{children}</SurfaceContext.Provider>;
}

interface SurfaceProps extends ViewProps {
  tone: SurfaceTone;
}

/** A view painted in the tone's background that re-themes everything inside it. */
export function Surface({ tone, style, children, ...rest }: SurfaceProps) {
  return (
    <SurfaceContext.Provider value={tone}>
      <View style={[{ backgroundColor: colorsFor(tone).background }, style]} {...rest}>
        {children}
      </View>
    </SurfaceContext.Provider>
  );
}
