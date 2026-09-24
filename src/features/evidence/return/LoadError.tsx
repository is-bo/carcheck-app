import { CircleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button, EmptyState, Screen, type SurfaceTone } from '@/ui';
import { layout } from '@/ui/theme/tokens';

export interface LoadErrorProps {
  tone?: SurfaceTone;
  title?: string;
  body?: string;
  onRetry: () => void;
  onClose: () => void;
}

/** A screen whose data could not be read: say so, keep the way out, offer a retry. */
export function LoadError({
  tone = 'paper',
  title = "Couldn't load this return.",
  body = 'Your photos and marks are safe. Try again.',
  onRetry,
  onClose,
}: LoadErrorProps) {
  return (
    <Screen tone={tone} leading="close" onLeadingPress={onClose}>
      <View style={styles.body}>
        <EmptyState icon={CircleAlert} title={title} body={body} action={<Button label="Try again" variant="secondary" onPress={onRetry} />} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: layout.sectionGapTop },
});
