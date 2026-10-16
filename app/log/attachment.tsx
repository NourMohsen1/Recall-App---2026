import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import PillButton from '../../src/components/PillButton';
import {
  PrivatePhotoError,
  isPdf,
  saveAttachmentMemory,
  textReaderAvailable,
  type PickedFile,
} from '../../src/attachments';
import { colors, fonts } from '../../src/theme';
import { useReturnTo } from '../../src/useReturnTo';
import { makeStyles, useColors } from '../../src/appearance';

// Save a screenshot or file — an appointment, a ticket, a bill. The phone
// reads it; anything coming up becomes a task with its details. See
// src/attachments.ts.

export default function LogAttachment() {
  const c = useColors();
  const styles = useStyles();
  const returnTo = useReturnTo();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to choose a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setFile({ uri: a.uri, name: a.fileName ?? undefined, mimeType: a.mimeType ?? 'image/jpeg' });
  };

  const pickFile = async () => {
    // Loaded only when used: a build made before the file picker was added
    // has no native side for it, and importing it at startup would crash.
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = require('expo-document-picker');
    } catch (e) {
      console.warn('[attach] file picker unavailable in this build:', e);
      Alert.alert('Needs the app update', 'This version of Recall cannot open files yet.');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined });
  };

  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const { words } = await saveAttachmentMemory(file, note);
      if (words === 0) {
        Alert.alert(
          'Saved, but no words found',
          "Recall couldn't read any text in this one, so it can't pick out dates or details. It's kept with your note.",
        );
      }
      returnTo();
    } catch (e) {
      if (e instanceof PrivatePhotoError) {
        Alert.alert('Not added', 'This image looks private, so Recall left it out. Nothing was saved or sent.');
        setSaving(false);
        return;
      }
      console.warn('[attach] save failed:', e);
      Alert.alert('Could not save', 'Something went wrong saving this file. Try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => returnTo()} hitSlop={12} style={styles.back}>
          <Ionicons name="close" size={26} color={c.brand} />
        </Pressable>
        <Text style={styles.headerTitle}>Screenshot or File</Text>
      </View>

      {/* The note's keyboard would otherwise cover Save. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.intro}>
          <MaterialCommunityIcons name="shield-lock-outline" size={20} color={c.brandSoft} />
          <Text style={styles.introText}>
            An appointment, a ticket, a bill. Recall reads it on your phone and puts anything
            coming up in Tasks, with its details and a reminder. The file never leaves your phone.
          </Text>
        </View>

        {!textReaderAvailable && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>
              This version of Recall can't read files yet. Install the latest build to use this.
            </Text>
          </View>
        )}

        <View style={styles.sourceRow}>
          <Pressable style={styles.sourceBtn} onPress={pickImage} disabled={!textReaderAvailable}>
            <MaterialCommunityIcons name="cellphone-screenshot" size={28} color={c.onTile} />
            <Text style={styles.sourceLabel}>Screenshot</Text>
          </Pressable>
          <Pressable style={styles.sourceBtn} onPress={pickFile} disabled={!textReaderAvailable}>
            <MaterialCommunityIcons name="file-document-outline" size={28} color={c.onTile} />
            <Text style={styles.sourceLabel}>File (PDF)</Text>
          </Pressable>
        </View>

        {file && (
          <>
            <View style={styles.chosen}>
              {isPdf(file) ? (
                <View style={styles.pdfCard}>
                  <MaterialCommunityIcons name="file-pdf-box" size={40} color={c.brandSoft} />
                  <Text numberOfLines={2} style={styles.pdfName}>
                    {file.name ?? 'Document.pdf'}
                  </Text>
                </View>
              ) : (
                <Image source={{ uri: file.uri }} style={styles.shot} resizeMode="contain" />
              )}
              <Pressable style={styles.removeBtn} onPress={() => setFile(null)} hitSlop={8}>
                <Ionicons name="close" size={14} color={c.onTile} />
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>Add a note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Mum's check-up, I'm taking her"
              placeholderTextColor={c.textGhost}
              multiline
            />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {saving ? (
          <View style={styles.reading}>
            <ActivityIndicator color={c.brandSoft} />
            <Text style={styles.readingText}>Reading it on your phone…</Text>
          </View>
        ) : (
          <PillButton label="Save" onPress={save} style={!file && styles.saveDisabled} />
        )}
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  safe: { flex: 1, backgroundColor: c.bg },
  header: {
    paddingTop: 12,
    paddingBottom: 18,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  back: { position: 'absolute', left: 20, top: 14 },
  headerTitle: { fontFamily: fonts.medium, fontSize: 22, color: c.textBody },
  scroll: { padding: 24, paddingBottom: 40 },

  intro: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: c.fill,
    borderRadius: 16,
    padding: 14,
  },
  introText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: c.textSoft },
  warn: { marginTop: 14, backgroundColor: c.warnWash, borderRadius: 12, padding: 12 },
  warnText: { fontFamily: fonts.medium, fontSize: 13, color: c.warn },

  sourceRow: { flexDirection: 'row', gap: 14, marginTop: 20 },
  sourceBtn: {
    flex: 1,
    backgroundColor: c.tileAlt,
    borderRadius: 18,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  sourceLabel: { fontFamily: fonts.medium, fontSize: 14, color: c.onTile },

  chosen: { marginTop: 22, alignSelf: 'center' },
  shot: { width: 220, height: 360, borderRadius: 16 },
  pdfCard: {
    width: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: c.fill,
  },
  pdfName: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: c.textBody },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: c.text, marginTop: 24, marginBottom: 10 },
  noteInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: c.brandFaint,
    borderRadius: 14,
    padding: 14,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: c.text,
    textAlignVertical: 'top',
  },

  footer: { padding: 24, paddingBottom: 36 },
  saveDisabled: { opacity: 0.5 },
  reading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 56 },
  readingText: { fontFamily: fonts.medium, fontSize: 15, color: c.brandSoft },
}));
