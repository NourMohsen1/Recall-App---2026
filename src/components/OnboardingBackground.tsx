import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme';

// Dark teal backdrop with a soft glow in the middle, matching the
// radial-gradient look of the onboarding frames.
export default function OnboardingBackground({
  children,
  light = false,
}: {
  children: ReactNode;
  light?: boolean;
}) {
  if (light) {
    return (
      <LinearGradient
        colors={[colors.muted, colors.soft, colors.slate]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.fill}
      >
        {children}
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.ink }]}>
      <LinearGradient
        colors={['transparent', 'rgba(51,105,112,0.55)', 'transparent']}
        start={{ x: 0.5, y: 0.15 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
