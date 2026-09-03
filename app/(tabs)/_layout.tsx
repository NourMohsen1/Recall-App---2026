import { Tabs } from 'expo-router';
import { ColorValue, Image, StyleSheet, View } from 'react-native';
import MemoryFab from '../../src/components/MemoryFab';
import { ICONS } from '../../src/images';
import { colors, fonts } from '../../src/theme';

// `color` is whatever the tab bar hands us, which is a ColorValue — it can
// be a platform color object, not just a string. Image's tintColor accepts
// the same type, so this just matches the caller instead of narrowing it.
function TabIcon({ source, color }: { source: any; color: ColorValue }) {
  return (
    <Image source={source} style={{ width: 26, height: 26 }} tintColor={color} resizeMode="contain" />
  );
}

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.primary,
          tabBarStyle: {
            backgroundColor: colors.white,
            borderTopColor: colors.pale,
            height: 84,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontFamily: fonts.regular, fontSize: 11 },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <TabIcon source={ICONS.home} color={color} />,
          }}
        />
        <Tabs.Screen
          name="timeline"
          options={{
            title: 'Timeline',
            tabBarIcon: ({ color }) => <TabIcon source={ICONS.timeline} color={color} />,
          }}
        />
        <Tabs.Screen
          name="tasks"
          options={{
            title: 'Tasks',
            tabBarIcon: ({ color }) => <TabIcon source={ICONS.tasks} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color }) => <TabIcon source={ICONS.profile} color={color} />,
          }}
        />
      </Tabs>

      {/* Center memory button: taps open the fan-out actions */}
      <MemoryFab />
    </View>
  );
}
