import { StyleSheet, View } from 'react-native';

import { formatPlate } from '../format';
import { lines, palette, radii } from '../theme/tokens';
import { Text } from './Text';

export interface PlateFrameProps {
  plate: string;
  size?: 'default' | 'small';
}

/**
 * The licence plate in its frame: the one expressive object in the system, used around a plate
 * everywhere a vehicle is identified and nowhere else. Always white with an ink border, even on rebate.
 */
export function PlateFrame({ plate, size = 'default' }: PlateFrameProps) {
  const text = formatPlate(plate);
  const small = size === 'small';
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Plate ${text.split('').join(' ')}`}
      style={[styles.frame, small ? styles.small : styles.default]}
    >
      <Text variant={small ? 'plateSmall' : 'plate'} color={palette.ink} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
    backgroundColor: palette.white,
    borderColor: palette.ink,
    borderRadius: radii.plate,
  },
  default: { borderWidth: lines.control, paddingTop: 2, paddingBottom: 1, paddingHorizontal: 6 },
  small: { borderWidth: 1.25, paddingTop: 1, paddingBottom: 0, paddingHorizontal: 5 },
});
