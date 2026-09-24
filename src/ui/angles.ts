import { EXTERIOR_ANGLE_KEYS, type ExteriorAngleKey } from '@/domain/types';

/**
 * Default display names for the 8 exterior angles. The DB `angles.label` is authoritative when a
 * screen has it; these cover components that only know the key (orbit, accessibility labels).
 */
export const exteriorAngleLabels: Record<ExteriorAngleKey, string> = {
  front: 'Front',
  front_left: 'Front left',
  left: 'Left',
  rear_left: 'Rear left',
  rear: 'Rear',
  rear_right: 'Rear right',
  right: 'Right',
  front_right: 'Front right',
};

/**
 * Where each angle sits on the top-down orbit: degrees in screen space, 0 = the car's right
 * (screen right), 90 = rear (screen down). Nose up, the car's left on screen-left.
 */
export const orbitDegrees: Record<ExteriorAngleKey, number> = {
  front: -90,
  front_left: -135,
  left: 180,
  rear_left: 135,
  rear: 90,
  rear_right: 45,
  right: 0,
  front_right: -45,
};

export { EXTERIOR_ANGLE_KEYS };
export type { ExteriorAngleKey };
