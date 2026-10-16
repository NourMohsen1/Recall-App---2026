import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fonts } from '../theme';
import { makeStyles, useColors } from '../appearance';

// A short list of things a screen can do, from its top-right menu button.
//
// Deliberately a bottom sheet rather than a dropdown: it's the same shape as
// every other choice in the app, it's reachable one-handed at the bottom of
// a tall phone, and each row has room for a line explaining what it does —
// which matters when one of the options can't be undone.

export type MenuAction = {
  key: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  hint?: string;
  disabled?: boolean;
  onPress: () => void;
};

export default function ActionMenuSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const c = useColors();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          {title && <Text style={styles.title}>{title}</Text>}

          {actions.map((a) => (
            <Pressable
              key={a.key}
              style={[styles.row, a.disabled && styles.rowOff]}
              onPress={a.disabled ? undefined : a.onPress}
              disabled={a.disabled}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons
                  name={a.icon}
                  size={22}
                  color={a.disabled ? c.textGhost : c.brandSoft}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, a.disabled && styles.labelOff]}>{a.label}</Text>
                {a.hint && <Text style={styles.hint}>{a.hint}</Text>}
              </View>
            </Pressable>
          ))}

          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.backdrop },
  sheet: {
    backgroundColor: c.raised,
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
    backgroundColor: c.grabber,
    marginBottom: 14,
  },
  title: { fontFamily: fonts.semiBold, fontSize: 17, color: c.text, marginBottom: 6 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  rowOff: { opacity: 0.55 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: fonts.medium, fontSize: 16, color: c.text },
  labelOff: { color: c.textFaint },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: c.textFaint, marginTop: 2 },

  cancel: { alignItems: 'center', paddingTop: 14, marginTop: 6 },
  cancelText: { fontFamily: fonts.medium, fontSize: 15, color: c.textFaint },
}));
