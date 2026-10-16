import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { explorePastAsked, markExplorePastAsked, startExplorePast } from '../explorePast';
import { quietSyncRunning, watchQuietSync } from '../photoImport';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// "Explore your past" on Home, once, for anyone who never saw it in setup
// (everyone who had Recall before it existed). Tapping it brings the past
// year in; the card then shows how far it has got and goes when it's done.
// The × hides it for good; Profile → Import photos stays the way in.

export default function ExplorePastCard({ onDone }: { onDone?: () => void }) {
  const c = useColors();
  const styles = useStyles();
  const [show, setShow] = useState(false);
  const [running, setRunning] = useState(false);
  const [imported, setImported] = useState(0);

  useFocusEffect(
    useCallback(() => {
      // Asked already but still coming in (said yes in setup): the card
      // shows the progress. Never asked: the card asks.
      explorePastAsked()
        .then((asked) => {
          const syncing = asked && quietSyncRunning();
          setRunning(syncing);
          setShow(!asked || syncing);
        })
        .catch(() => setShow(false));
    }, []),
  );

  useEffect(() => {
    if (!running) return;
    const stop = watchQuietSync((p) => setImported(p.imported));
    // Done when the sync is: checked every couple of seconds.
    const timer = setInterval(() => {
      if (!quietSyncRunning()) {
        setRunning(false);
        setShow(false);
        onDone?.();
      }
    }, 2000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [running, onDone]);

  const start = async () => {
    const granted = await startExplorePast();
    if (!granted) {
      Alert.alert('Photo access is off', 'Allow access to your photos in Settings and Recall will bring your past in.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    setRunning(true);
  };

  const dismiss = () => {
    setShow(false);
    markExplorePastAsked();
    console.log('[explore] not now, on Home');
  };

  if (!show) return null;
  return (
    <Pressable style={styles.card} onPress={running ? undefined : start}>
      <View style={styles.icon}>
        {running ? (
          <ActivityIndicator color={c.onTile} />
        ) : (
          <MaterialCommunityIcons name="image-multiple-outline" size={22} color={c.onTile} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{running ? 'Bringing back your past…' : 'Explore your past'}</Text>
        <Text style={styles.text}>
          {running
            ? imported > 0
              ? `${imported.toLocaleString()} photos placed on their days so far`
              : 'Looking through your photos'
            : 'Your photos already hold the last year. Tap to fill in your past days.'}
        </Text>
      </View>
      {!running && (
        <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Not now">
          <Ionicons name="close" size={20} color={c.textFaint} />
        </Pressable>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1.5,
    borderColor: c.accent,
    borderRadius: 24,
    padding: 16,
    marginTop: 24,
    backgroundColor: c.fill,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.tileAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { fontFamily: fonts.semiBold, fontSize: 16, color: c.ink },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: c.textMuted, marginTop: 2 },
}));
