import { Tabs } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import MemoryFab from '../../src/components/MemoryFab';
import { ICONS } from '../../src/images';
import { colors, fonts } from '../../src/theme';

function TabIcon({ source, color }: { source: any; color: string }) {
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
        {/* Pages that keep the tab bar visible but aren't tab buttons */}
        <Tabs.Screen name="people" options={{ href: null }} />
        <Tabs.Screen name="places" options={{ href: null }} />
        <Tabs.Screen name="on-this-day" options={{ href: null }} />
        <Tabs.Screen name="chat" options={{ href: null }} />
        <Tabs.Screen name="recap" options={{ href: null }} />
        <Tabs.Screen name="person/[name]" options={{ href: null }} />
        <Tabs.Screen name="place/[name]" options={{ href: null }} />
        <Tabs.Screen name="day/[offset]/index" options={{ href: null }} />
        <Tabs.Screen name="day/[offset]/people" options={{ href: null }} />
        <Tabs.Screen name="day/[offset]/places" options={{ href: null }} />
        <Tabs.Screen name="day/[offset]/source" options={{ href: null }} />
        <Tabs.Screen name="devices/index" options={{ href: null }} />
        <Tabs.Screen name="devices/glasses" options={{ href: null }} />
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
