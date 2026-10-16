import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import type { Attachment } from '../memoryLog';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

type Shown = Pick<Attachment, 'uri' | 'kind' | 'name' | 'previewUri' | 'text'>;

/** A small tile for an attachment — the screenshot itself, or a PDF's
 *  first page. Tapping opens the viewer. */
export function AttachmentThumb({ attachment, size = 64 }: { attachment: Shown; size?: number }) {
  const c = useColors();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const image = attachment.kind === 'image' ? attachment.uri : attachment.previewUri;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.thumb, { width: size, height: size * 1.3 }]}>
        {image ? (
          <PhotoImage uri={image} style={StyleSheet.absoluteFill} />
        ) : (
          <MaterialCommunityIcons name="file-pdf-box" size={size * 0.5} color={c.brandSoft} />
        )}
      </Pressable>
      <AttachmentViewer attachment={open ? attachment : null} onClose={() => setOpen(false)} />
    </>
  );
}

export default function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: Shown | null;
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useStyles();
  const [showText, setShowText] = useState(false);
  // A Modal is its own window: SafeAreaView measures nothing inside it, so
  // the header sat under the Dynamic Island with its button untappable.
  // The insets are applied by hand instead.
  const insets = useSafeAreaInsets();
  if (!attachment) return null;
  const image = attachment.kind === 'image' ? attachment.uri : attachment.previewUri;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.safe, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.back}>
            <Ionicons name="arrow-back" size={28} color={c.brand} />
          </Pressable>
          <Text numberOfLines={1} style={styles.title}>
            {attachment.kind === 'pdf' ? 'Document' : 'Screenshot'}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          {image ? (
            <PhotoImage uri={image} style={styles.image} resizeMode="contain" />
          ) : (
            <View style={styles.noImage}>
              <MaterialCommunityIcons name="file-pdf-box" size={64} color={c.brandSoft} />
            </View>
          )}
          {attachment.kind === 'pdf' && image && (
            <Text style={styles.caption}>First page</Text>
          )}
          {!!attachment.text?.trim() && (
            <>
              <Pressable onPress={() => setShowText((v) => !v)} style={styles.textToggle}>
                <Text style={styles.textToggleLabel}>
                  {showText ? 'Hide what Recall read' : 'Show what Recall read from it'}
                </Text>
              </Pressable>
              {showText && <Text style={styles.readText}>{attachment.text}</Text>}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  thumb: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: c.fill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.divider,
  },
  safe: { flex: 1, backgroundColor: c.bg },
  // The same header as every other screen: back arrow left, title centred
  // on the screen (not between the arrow and the edge).
  header: {
    paddingTop: 12,
    paddingBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  back: { position: 'absolute', left: 20, top: 14 },
  title: { fontFamily: fonts.medium, fontSize: 24, color: c.textBody, maxWidth: '70%' },
  body: { padding: 20, paddingBottom: 60 + 34 },
  image: { width: '100%', aspectRatio: 0.62, borderRadius: 14 },
  noImage: { height: 200, alignItems: 'center', justifyContent: 'center' },
  caption: { fontFamily: fonts.regular, fontSize: 12, color: c.textFaint, textAlign: 'center', marginTop: 8 },
  textToggle: { alignSelf: 'center', marginTop: 18, paddingVertical: 10, paddingHorizontal: 16 },
  textToggleLabel: { fontFamily: fonts.medium, fontSize: 14, color: c.brand },
  readText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: c.textSoft },
}));
