import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { persistFile } from '../memoryLog';
import { adoptMyPhoto, knowsMyFace } from '../myFace';
import { setUserProfile } from '../userProfile';
import { colors, fonts } from '../theme';

// Asked once on Home, for someone who skipped the photo in setup or had
// Recall before it asked: without their face, the photo stories can't tell
// them apart from the people they photograph. "Not now" hides it for good —
// Profile still takes a photo any time.

const DISMISSED = 'myPhotoCardDismissed';

export default function MyPhotoCard() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([AsyncStorage.getItem(DISMISSED), knowsMyFace()])
        .then(([dismissed, known]) => setShow(!dismissed && !known))
        .catch(() => setShow(false));
    }, []),
  );

  const pick = async (from: 'camera' | 'library') => {
    const perm =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 };
    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    const permanent = await persistFile(result.assets[0].uri, 'me');
    await setUserProfile({ photoUri: permanent });
    const learned = await adoptMyPhoto(permanent);
    setBusy(false);
    if (learned === 'learned') setShow(false);
    else Alert.alert('Couldn’t see your face', 'Try a clear photo of your face, looking at the camera.');
  };

  const choose = () =>
    Alert.alert('A photo of you', undefined, [
      { text: 'Take a selfie', onPress: () => pick('camera') },
      { text: 'Choose a photo', onPress: () => pick('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const dismiss = () => {
    setShow(false);
    AsyncStorage.setItem(DISMISSED, '1').catch(() => {});
  };

  if (!show) return null;
  return (
    <Pressable style={styles.card} onPress={choose} disabled={busy}>
      <View style={styles.icon}>
        {busy ? <ActivityIndicator color={colors.white} /> : <Ionicons name="person-outline" size={22} color={colors.white} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>Add a photo of you</Text>
        <Text style={styles.text}>So Recall knows which one is you in your photos.</Text>
      </View>
      <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Not now">
        <Ionicons name="close" size={20} color="#8B9394" />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#C9CDCE',
    borderRadius: 24,
    padding: 16,
    marginTop: 24,
    backgroundColor: colors.white,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.ink },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#8B9394', marginTop: 2 },
});
