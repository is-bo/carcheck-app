/**
 * A customer ID/licence document thumbnail: blurred until tapped, per UX_FLOWS §8 ("thumbnails
 * blurred until tapped, marked 'Stored only on this phone'"). Shared by CustomerForm (with a
 * delete action) and customer detail (read-only; bulk delete lives in the overflow menu there).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Lock, Trash2 } from 'lucide-react-native';

import { IconButton, Touchable } from '@/ui';
import { palette, radii } from '@/ui/theme/tokens';

export interface ProtectedThumbProps {
  uri: string;
  label: string;
  onDelete?: () => void;
}

export function ProtectedThumb({ uri, label, onDelete }: ProtectedThumbProps) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.wrap}>
      <Touchable
        onPress={() => setRevealed((r) => !r)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${label} photo. ${revealed ? 'Tap to hide it again.' : 'Tap to reveal it.'}`}
        style={styles.touchable}
      >
        <Image source={{ uri }} style={styles.image} contentFit="cover" blurRadius={revealed ? 0 : 25} />
        {!revealed ? (
          <View pointerEvents="none" style={styles.lock}>
            <Lock size={16} color={palette.white} absoluteStrokeWidth strokeWidth={2} />
          </View>
        ) : null}
      </Touchable>
      {onDelete ? <IconButton icon={Trash2} accessibilityLabel={`Delete ${label} photo`} onPress={onDelete} style={styles.delete} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 96 },
  touchable: { width: 96, height: 72, borderRadius: radii.photo, overflow: 'hidden', backgroundColor: palette.paper2 },
  image: { width: '100%', height: '100%' },
  lock: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(12,13,14,0.35)' },
  delete: { alignSelf: 'flex-end', marginTop: -4 },
});
