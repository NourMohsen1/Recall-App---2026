import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PhotoImage from './PhotoImage';
import { colors, fonts } from '../theme';

// What you can do with a person's face: set it, use it to search your
// photos, or clear it.
//
// This sheet used to also suggest photos "from your days together" and
// offer to look the person up in Contacts. Both are gone. The suggestions
// pulled the first few photos of each shared day, which in a real library
// means screenshots, receipts and app captures — a grid of things with no
// face in them, offered as a face. Contacts matched on name and was wrong
// often enough not to justify asking for the address book.
//
// What's left is the one path that always works, plus the button that
// actually uses the face once it's set.

export default function PersonPhotoSheet({
  visible,
  personName,
  hasPhoto,
  faceUri,
  cuttingFace,
  scanning,
  onPickFromLibrary,
  onRunFaceMatch,
  onRemove,
  onClose,
}: {
  visible: boolean;
  personName: string;
  hasPhoto: boolean;
  /** The face the app cut out of the photo — what the search actually
   *  compares against, as opposed to the photo the user sees. */
  faceUri?: string;
  cuttingFace?: boolean;
  scanning: boolean;
  onPickFromLibrary: () => void;
  onRunFaceMatch: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const firstName = personName.trim().split(/\s+/)[0];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Photo for {personName}</Text>

          {/* The crop, shown rather than left implicit.
              The app cuts the face out of the photo and matches against that,
              not against the picture in the circle — so without this there is
              no way to tell whether it found the right face, or found one at
              all. A wrong crop explains a run of wrong guesses, and you can
              only see that if you can see the crop. */}
          {hasPhoto && (
            <View style={styles.faceRow}>
              {faceUri ? (
                <PhotoImage uri={faceUri} style={styles.faceThumb} />
              ) : (
                <View style={[styles.faceThumb, styles.faceThumbEmpty]}>
                  {cuttingFace ? (
                    <ActivityIndicator size="small" color={colors.teal} />
                  ) : (
                    <MaterialCommunityIcons name="face-recognition" size={20} color="#A9B0B1" />
                  )}
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.faceTitle}>
                  {faceUri
                    ? 'The face it matches against'
                    : cuttingFace
                      ? 'Finding the face…'
                      : 'No face found in this photo'}
                </Text>
                <Text style={styles.faceHint}>
                  {faceUri
                    ? 'Cut from the photo above. If this is the wrong face, change the photo and it is cut again.'
                    : cuttingFace
                      ? 'Done once, then kept.'
                      : 'Searching still works, but it compares the whole picture. A photo where the face is clear and front-on works better.'}
                </Text>
              </View>
            </View>
          )}

          <Pressable style={styles.action} onPress={onPickFromLibrary}>
            <MaterialCommunityIcons name="image-outline" size={22} color={colors.teal} />
            <View style={{ flex: 1 }}>
              <Text style={styles.actionText}>
                {hasPhoto ? 'Change photo' : 'Choose a photo'}
              </Text>
              <Text style={styles.actionHint}>
                A clear, front-on face works best — it's what the search compares against.
              </Text>
            </View>
          </Pressable>

          {/* Only useful once there's a face to search for. */}
          <Pressable
            style={[styles.action, (!hasPhoto || scanning) && styles.actionOff]}
            onPress={onRunFaceMatch}
            disabled={!hasPhoto || scanning}
          >
            <MaterialCommunityIcons
              name="account-search-outline"
              size={22}
              color={!hasPhoto || scanning ? '#B4BBBB' : colors.teal}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionText, (!hasPhoto || scanning) && styles.actionTextOff]}>
                {scanning ? 'Looking through your photos…' : 'Run face match'}
              </Text>
              <Text style={styles.actionHint}>
                {!hasPhoto
                  ? `Add a photo of ${firstName} first`
                  : scanning
                    ? 'You can close this — it keeps going in the background.'
                    : `Search your photos for ${firstName}. Anything it finds is a suggestion you confirm.`}
              </Text>
            </View>
          </Pressable>

          {hasPhoto && (
            <Pressable style={styles.action} onPress={onRemove}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#B24545" />
              <Text style={[styles.actionText, { color: '#B24545' }]}>Remove photo</Text>
            </Pressable>
          )}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  faceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  faceThumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: colors.pale },
  faceThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  faceTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
  faceHint: { fontFamily: fonts.regular, fontSize: 12, color: '#8B9394', marginTop: 2, lineHeight: 16 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grabber: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#DDE3E3',
    marginBottom: 14,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 19, color: '#1B1B1B', marginBottom: 6 },

  action: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EDF1F1',
  },
  actionOff: { opacity: 0.6 },
  actionText: { fontFamily: fonts.medium, fontSize: 16, color: '#2B2B2B' },
  actionTextOff: { color: '#8B9394' },
  actionHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: '#8B9394',
    marginTop: 3,
  },

  cancel: { alignItems: 'center', paddingTop: 18 },
  cancelText: { fontFamily: fonts.medium, fontSize: 15, color: '#8B9394' },
});
