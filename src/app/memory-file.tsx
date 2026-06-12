// src/app/memory-file.tsx
//
// Viewer/editor for one built-in memory file (MEMORY.md or USER.md), reached
// from the Memory screen as /memory-file?name=MEMORY.md. Backed by the
// hermes-mobile plugin's /api/plugins/mobile/memory/files routes: GET for the
// whole file, PUT {content} for an atomic replace (≤ 256 KiB → 413 above).
//
// View mode renders the markdown; Edit switches to a monospace multiline
// input. Leaving with unsaved changes (Cancel, back swipe, header back) asks
// for confirmation before discarding.
import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  formatBytes,
  isMemoryFileName,
  memoryFileLabel,
  memoryFileTooLarge,
  memoryWriteErrorMessage,
  readMemoryFile,
  utf8ByteLength,
  writeMemoryFile,
  MEMORY_FILE_MAX_BYTES,
  type MemoryFileName,
} from '@/api/memory';
import { AuthError } from '@/api/restClient';
import { Icon } from '@/components/icon';
import { MarkdownView } from '@/components/markdown-view';
import { withAuthRetry } from '@/connection';
import { useTheme } from '@/theme';

export { RouteError as ErrorBoundary } from '@/components/route-error';

function HeaderButton({
  label,
  bold,
  disabled,
  onPress,
}: {
  label: string;
  bold?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ paddingHorizontal: 6, paddingVertical: 10, opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}
    >
      <Text style={{ color: colors.accent, fontSize: 17, fontWeight: bold ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export default function MemoryFileScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ name?: string }>();
  const rawName = typeof params.name === 'string' ? params.name : '';
  const name: MemoryFileName | null = isMemoryFileName(rawName) ? rawName : null;

  const [content, setContent] = useState<string | null>(null); // null = not loaded yet
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = editing && content != null && draft !== content;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const load = useCallback(async () => {
    if (!name) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await withAuthRetry((r) => readMemoryFile(r, name));
      setContent(res.content);
    } catch (e) {
      if (e instanceof AuthError) {
        router.replace('/');
        return;
      }
      setError(memoryWriteErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  // Guard hardware/gesture/header-back navigation while there are unsaved edits.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'You have unsaved edits to this file.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation]);

  function startEditing() {
    if (content == null) return;
    setDraft(content);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (!dirty) {
      setEditing(false);
      setError(null);
      return;
    }
    Alert.alert('Discard changes?', 'You have unsaved edits to this file.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setEditing(false);
          setError(null);
        },
      },
    ]);
  }

  async function save() {
    if (!name || saving) return;
    if (memoryFileTooLarge(draft)) {
      setError(
        `Too large — ${formatBytes(utf8ByteLength(draft))} exceeds the ${formatBytes(MEMORY_FILE_MAX_BYTES)} cap.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await withAuthRetry((r) => writeMemoryFile(r, name, draft));
      setContent(draft);
      setEditing(false);
    } catch (e) {
      if (e instanceof AuthError) {
        router.replace('/');
        return;
      }
      setError(memoryWriteErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const title = name ? memoryFileLabel(name) : 'Memory file';
  const draftBytes = editing ? utf8ByteLength(draft) : 0;
  const overCap = editing && draftBytes > MEMORY_FILE_MAX_BYTES;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title,
          gestureEnabled: !dirty,
          headerRight: () =>
            !name || content == null ? null : editing ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <HeaderButton label="Cancel" disabled={saving} onPress={cancelEditing} />
                <HeaderButton label={saving ? 'Saving…' : 'Save'} bold disabled={saving || !dirty} onPress={save} />
              </View>
            ) : (
              <HeaderButton label="Edit" onPress={startEditing} />
            ),
        }}
      />

      {!name ? (
        <View style={{ alignItems: 'center', gap: 14, paddingTop: 96, paddingHorizontal: 32 }}>
          <Icon sf="questionmark.folder" size={44} color={colors.textFaint} />
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600' }}>Unknown file</Text>
          <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
            Only MEMORY.md and USER.md can be opened here.
          </Text>
        </View>
      ) : editing ? (
        <View style={{ flex: 1 }}>
          {error ? (
            <Text selectable style={{ color: colors.danger, fontSize: 14, paddingHorizontal: 20, paddingTop: 12 }}>
              {error}
            </Text>
          ) : null}
          <TextInput
            accessibilityLabel={`${title} content`}
            multiline
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            value={draft}
            onChangeText={setDraft}
            editable={!saving}
            style={{
              flex: 1,
              color: colors.text,
              fontFamily: 'Menlo',
              fontSize: 13.5,
              lineHeight: 19,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 12,
            }}
          />
          <Text
            accessibilityLabel={`File size ${formatBytes(draftBytes)} of ${formatBytes(MEMORY_FILE_MAX_BYTES)} allowed`}
            style={{
              color: overCap ? colors.danger : colors.textFaint,
              fontSize: 12,
              textAlign: 'right',
              paddingHorizontal: 20,
              paddingVertical: 6,
            }}
          >
            {`${formatBytes(draftBytes)} / ${formatBytes(MEMORY_FILE_MAX_BYTES)}`}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.textDim} />}
        >
          {error ? (
            <Text selectable style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>
              {error}
            </Text>
          ) : null}
          {content == null ? (
            !error ? (
              <Text style={{ color: colors.textFaint, fontSize: 14, textAlign: 'center', paddingTop: 48 }}>
                Loading…
              </Text>
            ) : null
          ) : content.trim() === '' ? (
            <View style={{ alignItems: 'center', gap: 14, paddingTop: 72, paddingHorizontal: 16 }}>
              <Icon sf="doc.text" size={40} color={colors.textFaint} />
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Empty</Text>
              <Text style={{ color: colors.textDim, fontSize: 14, textAlign: 'center' }}>
                The agent fills this in as you chat — or tap Edit to write it yourself.
              </Text>
            </View>
          ) : (
            <MarkdownView text={content} />
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}
