import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export default function Placeholder({ title }: { title: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Screen coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.pale,
    fontFamily: fonts.semiBold,
    fontSize: 18,
  },
  subtitle: {
    color: colors.slate,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 8,
  },
});
