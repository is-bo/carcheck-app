import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { EllipsisVertical, Info, RotateCcw } from 'lucide-react-native';

import { getActiveTemplate, saveTemplateVersion, resetTemplateToDefault } from '@/data/repos';
import {
  CONTRACT_VARIABLE_GROUPS,
  CONTRACT_VARIABLES,
  STARTER_TEMPLATE_NOTICE,
  type ContractVariableGroup,
} from '@/domain/contract';
import type { ContractTemplate } from '@/domain/types';
import { ContractPreview } from '@/features/settings';
import {
  ActionFooter,
  Banner,
  BottomSheet,
  Button,
  ChipGroup,
  ConfirmDialog,
  Icon,
  IconButton,
  ListRow,
  Screen,
  SegmentedControl,
  SkeletonRows,
  Text,
  showToast,
  useKeyboardVisible,
  useSurface,
} from '@/ui';
import { fontFamily, fontScaleCap, layout, lines, space, type } from '@/ui/theme/tokens';

type Selection = { start: number; end: number };
type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error' };

// Cast until typed routes regenerate (matches app/(tabs)/_layout.tsx); this route always exists
// (it's the one we're on), the fallback only matters if we were somehow pushed with no history.
const SETTINGS = '/settings' as Href;

const GROUP_OPTIONS = CONTRACT_VARIABLE_GROUPS.map((g) => ({ value: g.key, label: g.label }));
const EDIT_PREVIEW_OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'preview', label: 'Preview' },
] as const;

/**
 * Full-screen contract template editor (UX_FLOWS §7): Edit | Preview, an insertable variable
 * chip bar and a live native preview. Saving appends a new template version — signed contracts
 * never change (DATA_MODEL §1 contract_template is append-only).
 */
export default function ContractTemplateScreen() {
  const { colors } = useSurface();
  const { width, height } = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();
  const sideBySide = width >= 700 || width > height;

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [body, setBody] = useState('');
  const [savedBody, setSavedBody] = useState('');
  const [mode, setMode] = useState<(typeof EDIT_PREVIEW_OPTIONS)[number]['value']>('edit');
  const [activeGroup, setActiveGroup] = useState<ContractVariableGroup>(CONTRACT_VARIABLE_GROUPS[0].key);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const cursorRef = useRef<Selection>({ start: 0, end: 0 });
  const [forcedSelection, setForcedSelection] = useState<Selection | undefined>(undefined);

  const dirty = body !== savedBody;
  const showEdit = sideBySide || mode === 'edit';
  const showPreview = sideBySide || mode === 'preview';

  useEffect(() => {
    let alive = true;
    getActiveTemplate().then(
      (t) => {
        if (!alive) return;
        setTemplate(t);
        setBody(t.body);
        setSavedBody(t.body);
        cursorRef.current = { start: t.body.length, end: t.body.length };
        setLoad({ status: 'ready' });
      },
      () => alive && setLoad({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, []);

  const goBack = useCallback(() => (router.canGoBack() ? router.back() : router.replace(SETTINGS)), []);

  const handleLeave = useCallback(() => {
    if (dirty) setDiscardOpen(true);
    else goBack();
  }, [dirty, goBack]);

  // Android hardware back gets the same discard guard as the top-bar back arrow.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!dirty) return false;
        setDiscardOpen(true);
        return true;
      });
      return () => sub.remove();
    }, [dirty]),
  );

  useEffect(() => {
    if (forcedSelection === undefined) return;
    const t = setTimeout(() => setForcedSelection(undefined), 50);
    return () => clearTimeout(t);
  }, [forcedSelection]);

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const { start, end } = cursorRef.current;
    setBody((current) => current.slice(0, start) + token + current.slice(end));
    const caret = start + token.length;
    cursorRef.current = { start: caret, end: caret };
    setForcedSelection({ start: caret, end: caret });
    inputRef.current?.focus();
  };

  const handleSave = async () => {
    if (!template) return;
    setSaving(true);
    try {
      const updated = await saveTemplateVersion({ title: template.title, body });
      setTemplate(updated);
      setSavedBody(updated.body);
      showToast('Contract template saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save the template.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const updated = await resetTemplateToDefault();
      setTemplate(updated);
      setBody(updated.body);
      setSavedBody(updated.body);
      cursorRef.current = { start: updated.body.length, end: updated.body.length };
      setResetOpen(false);
      showToast('Reset to the starter template');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not reset the template.');
    } finally {
      setResetting(false);
    }
  };

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    cursorRef.current = e.nativeEvent.selection;
  };

  const groupVars = CONTRACT_VARIABLES.filter((v) => v.group === activeGroup);
  const activeGroupLabel = CONTRACT_VARIABLE_GROUPS.find((g) => g.key === activeGroup)?.label ?? '';

  return (
    <Screen
      title="Contract template"
      leading="back"
      onLeadingPress={handleLeave}
      actions={
        <View style={styles.actionsRow}>
          <Button
            label="Save"
            variant="quiet"
            size="small"
            onPress={handleSave}
            loading={saving}
            disabled={!dirty || load.status !== 'ready'}
          />
          <IconButton icon={EllipsisVertical} accessibilityLabel="More options" onPress={() => setMenuOpen(true)} />
        </View>
      }
      scroll={false}
      column={!sideBySide}
      insets={{ bottom: false }}
      footer={
        showEdit && load.status === 'ready' ? (
          <ActionFooter compact={keyboardVisible} rule gutter={0}>
            <ChipGroup
              accessibilityLabel="Variable group"
              layout="row"
              options={GROUP_OPTIONS}
              value={activeGroup}
              onChange={(g) => g && setActiveGroup(g)}
              allowDeselect={false}
            />
            <ChipGroup
              accessibilityLabel={`${activeGroupLabel} variables — insert at cursor`}
              layout="row"
              options={groupVars.map((v) => ({ value: v.key, label: v.label }))}
              value={null}
              onChange={(key) => key && insertVariable(key)}
            />
          </ActionFooter>
        ) : undefined
      }
      overlay={
        <>
          <BottomSheet open={menuOpen} onClose={() => setMenuOpen(false)} accessibilityLabel="Template options">
            <ListRow
              title="Reset to default template"
              leading={<Icon icon={RotateCcw} />}
              onPress={() => {
                setMenuOpen(false);
                setResetOpen(true);
              }}
            />
          </BottomSheet>
          <BottomSheet
            open={helpOpen}
            onClose={() => setHelpOpen(false)}
            accessibilityLabel="Formatting help"
            snapPoints={['55%']}
            header={<Text variant="titleL">Formatting help</Text>}
          >
            <ScrollView contentContainerStyle={styles.helpBody}>
              <HelpRow syntax="# Heading" description="A heading line, on its own." />
              <HelpRow syntax="**bold**" description="Bold text, inside a line." />
              <HelpRow syntax="- List item" description="One bullet per line, starting with - or *." />
              <HelpRow syntax="(blank line)" description="Starts a new paragraph. A single line break just wraps the text." />
              <HelpRow syntax="{{variable}}" description="Replaced with the rental's details. Tap a chip below the editor to insert one at the cursor." />
            </ScrollView>
          </BottomSheet>
          <ConfirmDialog
            visible={discardOpen}
            title="Discard changes?"
            message="Your edits to the contract template will be lost."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            onCancel={() => setDiscardOpen(false)}
            onConfirm={() => {
              setDiscardOpen(false);
              goBack();
            }}
          />
          <ConfirmDialog
            visible={resetOpen}
            title="Replace your template with the original starter text?"
            message="Your current edits are replaced with the starter text. Contracts already signed are never changed."
            confirmLabel="Reset to default"
            onCancel={() => setResetOpen(false)}
            onConfirm={handleReset}
            busy={resetting}
          />
        </>
      }
    >
      {load.status === 'loading' ? (
        <SkeletonRows count={4} />
      ) : load.status === 'error' ? (
        <Text variant="body" tone="secondary" style={styles.pad}>
          Couldn’t load the contract template.
        </Text>
      ) : (
        <View style={styles.body}>
          <View style={styles.pad}>
            <Banner icon={Info} message={STARTER_TEMPLATE_NOTICE} />
            <Text variant="bodySmall" tone="tertiary" style={styles.versionNote}>
              Changes apply to new rentals only. Signed contracts never change.
            </Text>
          </View>

          {!sideBySide ? (
            <View style={styles.pad}>
              <SegmentedControl
                accessibilityLabel="Edit or preview"
                options={EDIT_PREVIEW_OPTIONS}
                value={mode}
                onChange={setMode}
              />
            </View>
          ) : null}

          <View style={[styles.panes, sideBySide && styles.panesRow]}>
            {showEdit ? (
              <View style={sideBySide ? styles.paneHalf : styles.paneFull}>
                <View style={styles.editToolbar}>
                  <Button label="Formatting help" variant="quiet" size="small" icon={Info} onPress={() => setHelpOpen(true)} />
                </View>
                <TextInput
                  ref={inputRef}
                  multiline
                  value={body}
                  onChangeText={setBody}
                  onSelectionChange={onSelectionChange}
                  selection={forcedSelection}
                  placeholder="Write the contract text…"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.accent}
                  cursorColor={colors.accent}
                  textAlignVertical="top"
                  maxFontSizeMultiplier={fontScaleCap.body}
                  accessibilityLabel="Contract template text"
                  style={[styles.editor, { color: colors.text }]}
                />
              </View>
            ) : null}
            {sideBySide && showPreview ? <View style={[styles.divider, { backgroundColor: colors.divider }]} /> : null}
            {showPreview ? (
              <ScrollView
                style={sideBySide ? styles.paneHalf : styles.paneFull}
                contentContainerStyle={styles.previewContent}
                keyboardShouldPersistTaps="handled"
              >
                <ContractPreview body={body} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      )}
    </Screen>
  );
}

function HelpRow({ syntax, description }: { syntax: string; description: string }) {
  return (
    <View style={styles.helpRow}>
      <Text variant="code" tone="secondary" style={styles.helpSyntax}>
        {syntax}
      </Text>
      <Text variant="body" tone="secondary">
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pad: { paddingHorizontal: layout.screenGutter },
  body: { flex: 1 },
  versionNote: { marginTop: space[3] },
  panes: { flex: 1 },
  panesRow: { flexDirection: 'row' },
  paneFull: { flex: 1 },
  paneHalf: { flex: 1, minWidth: 0 },
  divider: { width: lines.divider },
  editToolbar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 },
  editor: {
    flex: 1,
    ...type.body,
    lineHeight: 24,
    paddingHorizontal: layout.screenGutter,
    paddingTop: space[2],
    paddingBottom: space[7],
    includeFontPadding: false,
  },
  previewContent: { paddingTop: space[3], paddingBottom: space[8] },
  helpBody: { padding: layout.screenGutter, paddingTop: 0, gap: space[5] },
  helpRow: { gap: space[1] },
  helpSyntax: { fontFamily: fontFamily.codeSemibold },
});
