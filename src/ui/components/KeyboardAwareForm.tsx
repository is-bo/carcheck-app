import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { layout } from '../theme/tokens';
import { ActionFooter } from './ActionFooter';

export interface KeyboardAwareFormProps {
  children: ReactNode;
  /** Primary action(s); stays visible above the keyboard. */
  footer?: ReactNode;
  footerRow?: boolean;
  /** Space between fields (default 20 dp). */
  gap?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

/** Keyboard state for layouts that must shed the bottom inset while typing. */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setVisible(true),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * Form body for Screen: scrolls, keeps taps working while the keyboard is up, and lifts the
 * footer above the keyboard. KeyboardAvoidingView measures its own frame against the keyboard,
 * so it behaves the same whether or not the Android window resizes (edge-to-edge).
 * Use as the Screen body with `insets={{ bottom: false }}`: the footer owns the bottom inset.
 */
export function KeyboardAwareForm({ children, footer, footerRow, gap = 20, contentStyle }: KeyboardAwareFormProps) {
  const keyboardVisible = useKeyboardVisible();
  return (
    <KeyboardAvoidingView style={styles.fill} behavior="padding">
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, { gap }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        automaticallyAdjustKeyboardInsets={false}
      >
        {children}
      </ScrollView>
      {footer ? (
        <ActionFooter row={footerRow} compact={keyboardVisible} rule={keyboardVisible}>
          {footer}
        </ActionFooter>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: layout.screenGutter, paddingTop: 16, paddingBottom: 24 },
});
